/**
 * How many detectives to fan out, and which lead each one starts on. Pure: no I/O, no clock, no model.
 *
 * ## The question, and why a constant would have been the wrong answer
 *
 * How many haiku agents to fan out has no fixed answer: sometimes eight is right, sometimes four, sometimes
 * thirty.
 *
 * And the constraint that rules out dividing a corpus into N slices: each detective is told what to do so it
 * works efficiently and does not duplicate work too much (a little is fine), and the work is not separated by
 * artificial bounds that make things carry diminishing returns.
 *
 * **A detective is worth spawning when it has a lead nobody else is working.** So the number is not chosen
 * at all: it is COUNTED, off the probe that already ran. Four when the probe found three seams, eight when
 * it found seven, thirty when it found twenty-nine — three numbers, each derived rather than picked.
 *
 * ## What counts as one lead
 *
 * One `(keyword, source)` pair with a positive count. **Not one per shape**: the seven shapes of one
 * keyword select overlapping populations of the same records, so spawning a detective per shape sends
 * seven readers at the same rows and calls the duplication a fan-out. The lead carries every shape count
 * with it and names the NARROWEST non-empty one as where to start reading, which is the progressive
 * disclosure the ladder exists for.
 *
 * Splitting by SOURCE, on the other hand, is real: a keyword's Slack rows and its Linear rows are
 * different conversations held by different people, and a detective that has both will read the larger
 * one and report on it. That is the artificial-bounds failure in the other direction, and the measured
 * shape of this store makes it concrete — one Slack alert channel holds about half of a couple of million
 * rows, so an unsplit fan-out spends every slot on it and never opens the few dozen Linear rows that answer
 * the question.
 *
 * ## The discovery lead, which is never skipped
 *
 * One lead is always added and it is bound to no keyword and no source: it re-asks the question in other
 * words, hunts the name form the pre-planning step ({@link ./nameProbe}) did not think to probe, and
 * challenges every exclusion the recalled memories proposed. It is also the ONLY lead when the probe came
 * back empty everywhere — a fan-out of one, which is the honest answer to a question whose vocabulary we
 * have not found yet, rather than zero detectives and a confident "nothing in the corpus".
 *
 * ## The ceiling, and what actually sets it
 *
 * Not the machine. Every detective is an in-process sub-agent of the ONE visible bot-turn session (rule
 * 2 — no headless model, anywhere), so what bounds the wave is how many reports that session can hold and
 * still compose an answer. Lap two ran 28 readers in one visible session and composed from all of them,
 * which is the only measurement this repository actually has, so {@link MAX_DETECTIVES} is 30 and is
 * declared as a measured-adjacent bound rather than a law. `slots` narrows it further whenever the caller
 * knows its own remaining capacity is smaller; a wave that hits the ceiling reports the leads it deferred
 * rather than dropping them silently.
 */
import { absentAs, absentAsNumber } from "#lib/absent.js";
import { pushInto } from "#lib/collections.js";
import type { ProbeReport, ProbeRow } from "../store/probe/result.js";
import { narrowestHit, orderCells } from "../store/probe/result.js";

/**
 * The fewest detectives a fan-out ever spawns.
 *
 * One, and it is the discovery lead. Below one there is no fan-out — the visible session reads the probe
 * itself — and a floor above one would invent leads to fill it.
 *
 * @internal
 */
export const MIN_DETECTIVES = 1;

/**
 * The most detectives one wave spawns.
 *
 * Bounded by the visible session's own context rather than by the machine: every detective is an
 * in-process sub-agent of it and every report comes back into it. 28 readers in one session is what lap
 * two actually ran, so 30 is the nearest round number above a measurement rather than a number chosen for
 * its own sake. Raise it when a wave is measured composing cleanly from more.
 */
export const MAX_DETECTIVES = 30;

/**
 * The count above which a `(keyword, source)` cell is noise rather than a lead.
 *
 * A cell this wide is not readable by one detective in one wave, and handing it over as a lead produces a
 * reader that samples the top of an alert channel and reports the template. It becomes a lead by being
 * SPLIT first — `slopweaver store groups` over its container or author — which turns one unreadable cell
 * into several readable ones. Proposed from the shape of this store rather than measured: the widest
 * genuinely-readable cell seen on the four lap-two questions was in the low hundreds.
 */
export const LEAD_CEILING = 500;

/** One thing one detective starts on. */
export interface Lead {
  /** Which keyword put this lead on the board, or nothing for the discovery lead. */
  readonly keyword: string | null;
  /** Which source the lead's records are in, or nothing for the discovery lead. */
  readonly source: string | null;
  /** The narrowest shape that found rows here — where the detective opens its reading. */
  readonly startShape: string | null;
  /** How many rows that shape found in this source. */
  readonly rows: number;
  /** Why this lead is on the board, in one line the brief prints verbatim. */
  readonly why: string;
}

/** What a wave came to, including what it could not fit. */
export interface Wave {
  /** The leads this wave actually spawns a detective for, in the order they are assigned. */
  readonly leads: readonly Lead[];
  /** Leads that did not fit under the ceiling — carried, never dropped. */
  readonly deferred: readonly Lead[];
  /** Cells too wide to be a lead without splitting first. */
  readonly tooWide: readonly Lead[];
  /** How many detectives to spawn. Always `leads.length`; named so a caller reads it without counting. */
  readonly detectives: number;
}

/**
 * The bucket key the discovery lead sorts under, since it belongs to no source.
 *
 * Named rather than an empty string: the house rule against coalescing to `""` is not cosmetic here — an
 * empty key is indistinguishable from a source whose name failed to resolve, and the two would silently
 * share a round-robin bucket.
 */
const DISCOVERY_SOURCE_KEY = "(discovery)";

/** The lead that is always present, bound to no keyword and no source. */
const DISCOVERY_LEAD: Lead = {
  keyword: null,
  rows: 0,
  source: null,
  startShape: null,
  why: "ask the question in other words, find the name form nobody proposed, and challenge every recalled exclusion",
};

/**
 * The per-source leads one probed subject contributes.
 *
 * Each source gets at most one lead, taken from the NARROWEST shape that found rows in it — so a keyword
 * whose `exact` count is 3 in Slack and whose `wild-both` count is 900 in Slack produces one Slack lead
 * starting at `exact`, not two leads and not a lead starting at the wide end.
 *
 * @param row one subject's ladder
 * @returns its leads, each already carrying where to start — and, being read off a probed cell, each naming the
 *   keyword, the source and the shape that found it, none of which the discovery lead's `null` can stand in for
 */
function leadsFromRow({
  row,
}: {
  row: ProbeRow;
}): readonly (Lead & { readonly keyword: string; readonly source: string; readonly startShape: string })[] {
  const narrowestBySource = new Map<string, { shape: string; rows: number }>();
  for (const cell of orderCells({ cells: row.cells })) {
    for (const count of cell.bySource) {
      if (!narrowestBySource.has(count.source)) {
        narrowestBySource.set(count.source, { rows: count.rows, shape: cell.shape });
      }
    }
  }
  return [...narrowestBySource.entries()].map(([source, found]) => ({
    keyword: row.subject,
    rows: found.rows,
    source,
    startShape: found.shape,
    why: `${String(found.rows)} ${source} record(s) matched "${row.subject}" at its narrowest shape, ${found.shape}`,
  }));
}

/**
 * Order leads so one source cannot take every slot, and so a scarce slot goes where there is most to read.
 *
 * **Round-robin across sources** is the anti-monopoly half: one lead per source per round, so a keyword
 * with six Slack leads cannot exhaust the wave before the two Linear leads are reached.
 *
 * **Largest first INSIDE a round** is the other half, and it was measured wrong the other way round first.
 * Ordering a round by the smallest count reads well — a small cell can be read to the bottom — but when the
 * slots run out mid-round it spends them on the cells that need a detective least. MEASURED on
 * `what are Tobyn Barten's top five pain points` at six slots: smallest-first assigned github 1, gmail 1,
 * linear 1 and notion 8, and **cut slack 17 entirely** — the richest seam in the probe, and the one a
 * detective was actually needed for. Three one-record leads are three records the visible session could
 * have opened itself. So the round-robin stops the monopoly and the size ordering spends what is left.
 *
 * Ties break on the keyword so two runs of the same probe assign the same way.
 *
 * @param leads every lead the probe produced
 * @returns the leads in assignment order
 *
 * @internal
 */
export function orderLeads({ leads }: { leads: readonly Lead[] }): readonly Lead[] {
  const bySource = new Map<string, Lead[]>();
  for (const lead of leads.toSorted((left, right) => compareLeads({ left, right }))) {
    const key = absentAs({ value: lead.source, whenAbsent: DISCOVERY_SOURCE_KEY });
    pushInto({ buckets: bySource, key, value: lead });
  }
  // Sources themselves are visited largest-lead-first, for the same reason the leads inside a round are:
  // when the slots run out mid-round, the source with most to read is the one that should still have one.
  const sources = [...bySource.keys()].toSorted((left, right) => {
    const leftBest = absentAsNumber({ value: bySource.get(left)?.[0]?.rows, whenAbsent: 0 });
    const rightBest = absentAsNumber({ value: bySource.get(right)?.[0]?.rows, whenAbsent: 0 });
    return leftBest === rightBest ? left.localeCompare(right) : rightBest - leftBest;
  });
  const ordered: Lead[] = [];
  let round = 0;
  let placed = true;
  while (placed) {
    placed = false;
    for (const source of sources) {
      const lead = bySource.get(source)?.[round];
      if (lead !== undefined) {
        ordered.push(lead);
        placed = true;
      }
    }
    round += 1;
  }
  return ordered;
}

/**
 * The stable order two leads from the same source take: most to read first.
 *
 * @param left one lead
 * @param right the other
 * @returns the comparison
 */
function compareLeads({ left, right }: { left: Lead; right: Lead }): number {
  if (left.rows !== right.rows) {
    return right.rows - left.rows;
  }
  return absentAs({ value: left.keyword, whenAbsent: DISCOVERY_SOURCE_KEY }).localeCompare(
    absentAs({ value: right.keyword, whenAbsent: DISCOVERY_SOURCE_KEY }),
  );
}

/**
 * Plan one wave from a probe: how many detectives, and what each one starts on.
 *
 * @param probe the count matrix the probe came back with
 * @param slots how many sub-agents the visible session can actually hold, when it knows
 * @param extra leads a source outside the store contributed — today, the Datadog catalogue gate
 *   ({@link ./datadogLead}). Merged into the ordering rather than appended, so a Datadog lead competes for a
 *   slot on the same terms as a Slack one and the round-robin's anti-monopoly rule covers it too
 * @returns the wave, including every lead it deferred and every cell too wide to be one
 */
export function planWave({
  probe,
  slots,
  extra = [],
}: {
  probe: ProbeReport;
  slots?: number;
  extra?: readonly Lead[];
}): Wave {
  const raw = probe.rows.flatMap((row) => (narrowestHit({ row }) === null ? [] : leadsFromRow({ row })));
  const tooWide = raw.filter((lead) => lead.rows > LEAD_CEILING);
  // `extra` bypasses the LEAD_CEILING on purpose: the ceiling is a count of ROWS a detective would have to
  // read, and a Datadog lead's `rows` is a nominal weight rather than a row count — nothing has been counted
  // yet, which is the whole point of a gate that touches no network. Applying a row ceiling to a number that
  // is not rows would discard exactly the leads that matched most.
  const readable = [...raw.filter((lead) => lead.rows <= LEAD_CEILING), ...extra];
  const ceiling = Math.max(
    MIN_DETECTIVES,
    Math.min(MAX_DETECTIVES, absentAsNumber({ value: slots, whenAbsent: MAX_DETECTIVES })),
  );
  const ordered = [DISCOVERY_LEAD, ...orderLeads({ leads: readable })];
  return {
    deferred: ordered.slice(ceiling),
    detectives: Math.min(ordered.length, ceiling),
    leads: ordered.slice(0, ceiling),
    tooWide: tooWide.map((lead) => ({
      ...lead,
      why: `${String(lead.rows)} ${lead.source} record(s) — too wide to read; split it first with \`slopweaver store groups --term "${lead.keyword}" --shape ${lead.startShape} --facet container\``,
    })),
  };
}
