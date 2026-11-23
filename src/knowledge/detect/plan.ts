/**
 * How many recall detectives to fan out, and what each one opens on. Pure: no I/O, no clock, no model.
 *
 * Recall is not the worker reading the register itself. A cheap detective finds every relevant memory, so the
 * worker knows what to do and what to avoid, and the token window of whoever does the work stays pure: the
 * detectives hand over only what is relevant for the task.
 *
 * ## The number is COUNTED, not chosen — the same rule the store wave uses
 *
 * `../../detective/fanout.ts` sizes a store wave off the probe that already ran, and this sizes a recall
 * wave off the counts the register already answers: one lead per term that matches something, because a
 * term nothing matches gives a detective nothing to read. The ceiling is that module's {@link MAX_DETECTIVES}
 * rather than a second number, because what bounds a wave is the visible session's own context — every
 * detective is an in-process sub-agent of it and every report comes back into it, which is true of both.
 *
 * ## The discovery lead is never skipped, and it is the one that makes a thin page honest
 *
 * Full-text search stems and has no synonyms (`../recall.ts`), so a query for `tracing` never reaches a row
 * that only says `spans`. One lead is always added with no term: it asks the register in words the task did
 * not use. It is also the ONLY lead when nothing matched — a wave of one, rather than zero detectives and a
 * confident "nothing has been learned about this".
 */
import { MAX_DETECTIVES } from "../../detective/fanout.js";

/** What the register holds for one term. */
export interface TermCount {
  /** The term as the caller typed it. */
  readonly term: string;
  /** How many claims match it, all kinds together. */
  readonly total: number;
  /** How many of those are traces — where somebody already looked. */
  readonly traces: number;
}

/** One recall detective's starting lead. */
export interface RecallLead {
  /** The term to open on, or null for the discovery detective. */
  readonly term: string | null;
  /** How many claims that term matches. Zero for the discovery lead, which has no term to count. */
  readonly total: number;
  /** How many of them are traces. */
  readonly traces: number;
  /** Why this detective exists, printed into its brief. */
  readonly why: string;
}

/** One planned wave. */
export interface RecallWave {
  /** Every detective's lead, discovery last. */
  readonly leads: readonly RecallLead[];
  /** Leads the ceiling or the caller's remaining slots left out, so a wave never drops one silently. */
  readonly deferred: readonly RecallLead[];
}

/**
 * The fewest detectives a wave spawns: one, and it is the discovery lead.
 *
 * Below one there is no wave — the worker reads the register itself, which is the thing this verb exists to
 * stop — and a floor above one would invent leads to fill it.
 */
const MIN_RECALL_DETECTIVES = 1;

/** The discovery lead, added to every wave. */
function discoveryLead(): RecallLead {
  return {
    term: null,
    total: 0,
    traces: 0,
    why: "no term, on purpose — ask the register in words the task did not use, since search stems and has no synonyms",
  };
}

/**
 * Plan one recall wave from what the register answered per term.
 *
 * A term that matched nothing is NOT a lead: there is nothing for that detective to read, and the discovery
 * lead already covers the possibility that the register says it in other words. Leads are ordered by what
 * they match, most first, so the deferred tail is the thinnest rather than whatever came last.
 *
 * @param counts what the register holds per term, in the order the caller named them
 * @param slots the caller's own remaining capacity, when it knows it is smaller than the ceiling
 * @returns the wave, with anything past the bound reported as deferred rather than dropped
 */
export function planRecallWave({ counts, slots }: { counts: readonly TermCount[]; slots?: number }): RecallWave {
  const matched = [...counts]
    .filter((count) => count.total > 0)
    .toSorted((a, b) => b.total - a.total || a.term.localeCompare(b.term))
    .map((count): RecallLead => ({
      term: count.term,
      total: count.total,
      traces: count.traces,
      why: `${String(count.total)} claim(s) match "${count.term}", ${String(count.traces)} of them traces`,
    }));
  let ceiling = MAX_DETECTIVES;
  if (slots !== undefined && slots < ceiling) {
    ceiling = slots;
  }
  if (ceiling < MIN_RECALL_DETECTIVES) {
    ceiling = MIN_RECALL_DETECTIVES;
  }
  // The discovery lead takes the last slot rather than being dropped: a wave without it can only ever
  // return what the caller's own words already reach, which is the failure this whole verb exists to avoid.
  const keep = matched.slice(0, ceiling - 1);
  const deferred = matched.slice(ceiling - 1);
  return { deferred, leads: [...keep, discoveryLead()] };
}
