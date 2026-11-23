/**
 * THE SWEEP GATE — a tick that left capacity unused while a ready row under one of the owner's kept outcomes had
 * nobody on it cannot be RECORDED without saying why.
 *
 * ## The thing it makes impossible
 *
 * The owner expects capacity-maxxing: most chats should not sit idle while outcomes (the stated Workstreams candidates in
 * the state home's `workstreams/stated-candidates.json`, once kept) have nobody on them. The outcomes it
 * judges are the ones on the owner's Workstreams register (`./coverage.ts`); the mistake is made structurally impossible to repeat.
 *
 * The mistake has a mechanical shape. A tick reads `slopweaver machine capacity --json`, sees no hold, fills
 * from the reconciliation's five-row window, and records itself as a clean tick. Nothing anywhere compared
 * what it spawned against what the owner said they want, so a shift could be internally consistent and completely
 * off the owner's direction — and the record it left behind said so too. This gate is that comparison, run at the
 * moment the tick is written down, which is the last moment at which the answer is still cheap.
 *
 * ## The predicate, exactly
 *
 * It refuses when ALL of these hold:
 *
 * 1. the tick's capacity reading says the machine was NOT holding spawns (so the fleet could have grown);
 * 2. the reconciliation reports at least one UNCOVERED outcome — one with ready rows and no live session;
 * 3. and for each such outcome the draft carries NEITHER a `spawned` action on one of that outcome's own
 *    unspawned rows NOR a `hold-rationale` judgement naming it (or `all-outcomes`).
 *
 * Point 3 is why this is not a ratchet on a number: **the tick is free to leave an outcome alone**, exactly
 * as `skills/supervisor/reference/fleet-capacity.md` says a tick may leave capacity unused. What it may no
 * longer do is leave it alone SILENTLY. The other direction is legitimate: holding off because the load is heavy is a
 * choice, narrated.
 *
 * ## A gate that cannot SEE refuses too
 *
 * A reconciliation carrying no `outcomeSource`, a count its rows disagree with, or a malformed row
 * (`./reconciledOutcomes.ts`) is one produced before this existed, or by something else; a capacity observation
 * that is not `read` is a reading the tick never took. Both are reported as what they are — the gate could not
 * judge — and both refuse, because a check that reports clean when it saw nothing is the silent-failure class
 * this repository names everywhere else. A reconciliation that read NO register (`outcomeSource: absent`, no
 * rows) is different: the owner has kept no outcome yet, so there is nothing to answer for and the tick is clean.
 *
 * Pure: the draft's own values and the reconciliation's in, a verdict out. No filesystem, no clock, no env —
 * `../../cli/commands/supervisor/tickRecordRun.ts` reads the hatch and renders the refusal.
 */

import { isRecord } from "../../lib/parsers.js";

import { readReconciledOutcomes } from "./reconciledOutcomes.js";

/** Why a tick is being refused, or that it is not. */
export type SweepVerdict =
  /** Nothing to answer for: the machine held spawns, or every uncovered outcome is answered. */
  | { readonly kind: "clean" }
  /** The gate could not judge, and says which input it could not read. */
  | { readonly kind: "unreadable"; readonly why: string }
  /** Capacity was free and these outcomes were left with ready rows, nobody on them, and no reason given. */
  | { readonly kind: "refused"; readonly outcomes: readonly UnansweredOutcome[] };

/**
 * One outcome the tick neither spawned into nor gave a reason for.
 *
 * @internal — the element type of {@link SweepVerdict}'s refused arm; a caller reads the verdict.
 */
export interface UnansweredOutcome {
  readonly id: string;
  readonly title: string;
  readonly anchor: string;
  /** How many ready rows under it nobody is on. */
  readonly unspawned: number;
  /** The highest-ranked unspawned row, so the refusal names something a reader can spawn immediately. */
  readonly firstRow: string;
}

/** The judgement kind that answers for an outcome, and the action kind that satisfies it by acting instead. */
const HOLD_RATIONALE = "hold-rationale";

/** The subject id a tick uses to answer for EVERY uncovered outcome in one judgement. */
export const ALL_OUTCOMES = "all-outcomes";

/** A string field on a record, or "" when it is absent or not a string — read off the tick's OWN draft only. */
function str({ key, on }: { key: string; on: Record<string, unknown> }): string {
  const value = on[key];
  return typeof value === "string" ? value : "";
}

/** Every row id this tick recorded spawning something onto. */
function spawnedRowIds({ actions }: { actions: unknown }): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!Array.isArray(actions)) {
    return ids;
  }
  for (const action of actions) {
    if (!isRecord(action) || action["kind"] !== "spawned" || !isRecord(action["subject"])) {
      continue;
    }
    ids.add(str({ key: "id", on: action["subject"] }));
  }
  return ids;
}

/** Every outcome id this tick recorded a hold rationale against. */
function excusedOutcomeIds({ judgements }: { judgements: unknown }): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!Array.isArray(judgements)) {
    return ids;
  }
  for (const judgement of judgements) {
    if (!isRecord(judgement) || judgement["kind"] !== HOLD_RATIONALE || !isRecord(judgement["subject"])) {
      continue;
    }
    const subject = judgement["subject"];
    if (subject["kind"] === "outcome") {
      ids.add(str({ key: "id", on: subject }));
    }
  }
  return ids;
}

/**
 * Whether the tick's capacity reading says the machine was holding spawns, or that it could not be read.
 *
 * @param sources the draft's `sources` record
 * @returns `true`/`false` for a reading, or the reason there was none
 */
function machineHeld({ sources }: { sources: unknown }): boolean | { readonly why: string } {
  if (!isRecord(sources) || !isRecord(sources["capacity"])) {
    return { why: "the draft carries no capacity observation at all" };
  }
  const capacity = sources["capacity"];
  const status = str({ key: "status", on: capacity });
  if (status !== "read" && status !== "partial") {
    return {
      why: `the draft's capacity observation is "${status === "" ? "malformed" : status}", so this tick never read whether the machine could take another session`,
    };
  }
  const facts = capacity["facts"];
  if (!isRecord(facts) || typeof facts["hold"] !== "boolean") {
    return { why: "the draft's capacity observation carries no `hold` reading" };
  }
  return facts["hold"];
}

/**
 * Judge one tick against the owner's kept outcomes.
 *
 * @param sources the draft's twelve source observations, of which the capacity one is read
 * @param actions what the tick did
 * @param judgements what the tick concluded
 * @param reconciliation the `handover reconcile --json` document this tick already read
 * @returns the verdict the recorder acts on
 */
export function judgeSweep({
  sources,
  actions,
  judgements,
  reconciliation,
}: {
  sources: unknown;
  actions: unknown;
  judgements: unknown;
  reconciliation: unknown;
}): SweepVerdict {
  const coverage = readReconciledOutcomes({ reconciliation });
  if (coverage.isErr()) {
    return { kind: "unreadable", why: coverage.error.message };
  }
  const held = machineHeld({ sources });
  if (typeof held !== "boolean") {
    return { kind: "unreadable", why: held.why };
  }
  if (held) {
    return { kind: "clean" };
  }
  const spawned = spawnedRowIds({ actions });
  const excused = excusedOutcomeIds({ judgements });
  const unanswered = coverage.value.outcomes
    .filter((entry) => entry.liveSessions.length === 0 && entry.unspawned.length > 0)
    .filter((entry) => !excused.has(entry.id) && !excused.has(ALL_OUTCOMES))
    .filter((entry) => !entry.unspawned.some((row) => spawned.has(row.id)))
    .map((entry): UnansweredOutcome => ({
      anchor: entry.anchor,
      // Non-empty by the first filter above, so the row really is there.
      firstRow: entry.unspawned[0]!.id,
      id: entry.id,
      title: entry.title,
      unspawned: entry.unspawned.length,
    }));
  return unanswered.length === 0 ? { kind: "clean" } : { kind: "refused", outcomes: unanswered };
}
