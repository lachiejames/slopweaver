/**
 * One row of the sweep ledger — the RAIL that makes aggressive deletion safe, and the pure half of it.
 *
 * ## The rail is FINDABILITY, and saying which it is matters
 *
 * Pruning superseded context is aggressive: delete by default, with one rail — **a deletion is journalled so it
 * can be found afterwards**. An approval step would have made
 * every deletion cost the owner a decision, which is the throughput this mechanism exists to protect; a findable
 * record costs nobody anything and answers the only question a wrong deletion raises.
 *
 * ## Why this is not an undo log
 *
 * The first cut of this file carried each row's whole prior text so a `sweep restore` could rewrite it. That
 * was wrong twice over, and both are the repository's own canon rather than taste. The board's state is
 * DERIVED, with the second copy deleted — **nothing here
 * writes a `status:` line**, so a restore that wrote one would have restored a field no reader consults. And
 * the derivation is deliberately MONOTONE toward terminal (`skills/handover/reference/derived-row-state.md`),
 * so "put this row back" is not expressible in the model at all.
 *
 * So a sweep act IS one of the register's own verbs, and this ledger records which verdict and which witness
 * chose it. `slopweaver sweep list` is the rail: it answers what the sweep took, on what evidence, without a
 * session having to know where the run journals live.
 *
 * Pure: records in, records out. `./journalStore.ts` is the effectful half.
 */
import type { SweepAct, SweepVerdict } from "./classify.js";

/**
 * Why the sweep acted: a board verdict, or `SWEEP_CARD_RETIRED` — `--queue` settling one of its own earlier daily
 * cards (`./cardRetirement.ts`). The second is a ledger reason only and never enters the board census, whose verdict
 * object is exact.
 */
export type SweepJournalReason = SweepVerdict | "SWEEP_CARD_RETIRED";

/** One performed sweep act, as the ledger holds it. */
export interface SweepJournalRow {
  /** This act's own id — what `sweep list --slug` and any later audit quote. */
  readonly id: string;
  readonly atIso: string;
  readonly slug: string;
  readonly path: string;
  /** The persisted key keeps its name for every ledger already written; its type is the wider reason. */
  readonly verdict: SweepJournalReason;
  readonly act: SweepAct;
  /** The evidence that condemned the row, copied from the candidate so the ledger stands alone. */
  readonly witness: string;
  /** The register verb this act ran, spelled exactly as it was invoked, so a reader can re-derive it. */
  readonly verbLine: string;
  /** The session that performed it. */
  readonly session: string;
}

/**
 * One printable block per ledger row.
 *
 * @param row the act
 * @returns the two lines `sweep list` prints
 */
export function renderJournalRow({ row }: { row: SweepJournalRow }): string {
  return `${row.id}  ${row.atIso}  ${row.verdict}/${row.act}  ${row.slug}\n    ${row.verbLine}\n    witness: ${row.witness}`;
}

/**
 * The id one act is recorded under.
 *
 * Derived from the instant and the slug rather than minted randomly, so re-running the same act at the same
 * recorded instant produces the same id — which is what lets a test assert the id rather than match a shape.
 *
 * @param atIso when the act happened
 * @param slug the row acted on
 * @returns the act id
 */
export function actId({ atIso, slug }: { atIso: string; slug: string }): string {
  const stamp = atIso.replaceAll(/[^0-9]/gu, "").slice(0, 14);
  return `sw-${stamp}-${slug.slice(0, 24)}`;
}
