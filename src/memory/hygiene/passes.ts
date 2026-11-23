/**
 * How long since the last memory hygiene pass, folded out of the hygiene ledger. Pure.
 *
 * The atlas page asks how long it has been since the last memory hygiene pass, and nothing
 * answered it: `memory hygiene` RUNS a pass and writes rows, `memory sweep` lays out the corpus, and neither
 * reports when a pass last happened. The ledger already holds it — `./ledger.ts` appends one row per
 * proposal stamped `tsIso` — so this is a fold over rows that exist rather than new state.
 *
 * **A PASS is a distinct `tsIso`, not a row.** One run writes one row per proposal and stamps them all with
 * the same instant, so counting rows reports more passes than ran — count both and compare:
 * `slopweaver memory passes --json | jq '.passes | length'` against the ledger's own row count. The
 * grouping key is the exact timestamp rather than the calendar day, because two passes on one day are two
 * passes — `./ledger.ts`'s own `daysSeen` counts days deliberately and for a different question, which is
 * recurrence rather than cadence.
 */

import type { HygieneRow } from "./ledger.js";

/**
 * One hygiene pass, as the ledger's rows reveal it.
 *
 * @internal — reached as an element of {@link HygienePassReport.passes}.
 */
export interface HygienePass {
  /** The instant every row of this pass carries. */
  readonly tsIso: string;
  /** How many proposals it wrote. */
  readonly proposals: number;
  /** How many of its rows record the owner accepting a proposal. */
  readonly accepted: number;
  /** How many record the owner refusing one. A refusal is terminal, per `./ledger.ts`. */
  readonly refused: number;
}

/** The whole answer: every pass, newest first, and how stale the newest one is. */
export interface HygienePassReport {
  /** Every pass the ledger records, NEWEST FIRST. */
  readonly passes: readonly HygienePass[];
  /** The newest pass's instant, absent on a home whose pass has never run. */
  readonly lastPassIso: string | undefined;
  /**
   * Whole days between the newest pass and the instant this report was taken.
   *
   * Absent rather than zero when no pass has ever run: a home with no pass and a home swept this morning are
   * opposite facts, and a zero would read as the second.
   */
  readonly daysSinceLastPass: number | undefined;
  /** When the report was taken, so a reader can age the age itself. */
  readonly observedAtIso: string;
  /** The ledger this was folded from, so the figure names the file that recomputes it. */
  readonly ledgerPath: string;
}

/** Milliseconds in a day, for the staleness figure. */
const DAY_MS = 86_400_000;

/**
 * Fold the ledger's rows into one row per pass, newest first, with the newest one's age.
 *
 * @param rows every hygiene-ledger row, in file order
 * @param nowIso the instant to measure staleness against, passed in rather than read from a clock so the
 *   fold stays pure and a test can state its own now
 * @param ledgerPath the ledger's path, carried through so the report names its own source
 * @returns every pass and how stale the newest is
 */
export function hygienePasses({
  rows,
  nowIso,
  ledgerPath,
}: {
  rows: readonly HygieneRow[];
  nowIso: string;
  ledgerPath: string;
}): HygienePassReport {
  const byInstant = new Map<string, { proposals: number; accepted: number; refused: number }>();
  for (const row of rows) {
    let tally = byInstant.get(row.tsIso);
    if (tally === undefined) {
      tally = { accepted: 0, proposals: 0, refused: 0 };
      byInstant.set(row.tsIso, tally);
    }
    tally.proposals += 1;
    if (row.disposition === "accepted") {
      tally.accepted += 1;
    }
    if (row.disposition === "refused") {
      tally.refused += 1;
    }
  }
  const passes = [...byInstant.entries()]
    .map(([tsIso, tally]): HygienePass => ({
      accepted: tally.accepted,
      proposals: tally.proposals,
      refused: tally.refused,
      tsIso,
    }))
    .toSorted((left, right) => right.tsIso.localeCompare(left.tsIso));

  const newest = passes[0];
  if (newest === undefined) {
    return { daysSinceLastPass: undefined, lastPassIso: undefined, ledgerPath, observedAtIso: nowIso, passes };
  }
  const elapsed = Date.parse(nowIso) - Date.parse(newest.tsIso);
  return {
    daysSinceLastPass: Math.floor(elapsed / DAY_MS),
    lastPassIso: newest.tsIso,
    ledgerPath,
    observedAtIso: nowIso,
    passes,
  };
}
