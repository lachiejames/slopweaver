/**
 * One row of the reclaim ledger, and how it reads back.
 *
 * A reclaim cannot be undone — `sweep restore` replays a board row's text, and there is no equivalent for
 * bytes. So the rail this row carries is a different one: every applied run says which root it entered,
 * how much it took and whether its post-apply witness held, under the name of the session that ran it. A
 * row is how a wrong act is found afterwards by somebody who was not there, which is the only recourse
 * left once the bytes are gone.
 *
 * **`survivingDigests` is optional because the class that filled it is retired, not because a row may skip
 * it.** The `duplicate-copy` take counted distinct surviving contents; it was removed after a run
 * deleted live supervisor-chair state (`./roots.ts` § Why there is no `duplicate-copy`
 * class). Dropping the field from the TYPE would have made that row unreadable, and a ledger that cannot
 * print the act it most needs to explain is worse than one carrying a field nothing writes any more.
 *
 * The column renders only for that class, and the reason is the one that retired it. The old code wrote the
 * field on EVERY row, so an old `build-tree` run carries `survivingDigests: 0` — which
 * renders as a claim that nothing survived, on a run whose whole design was that everything outside the
 * pruned trees did. A number from a criterion the run never applied is not a fact about that run.
 *
 * Pure: shape and rendering only, no I/O and no clock.
 */

/**
 * The one class that ever judged content identity. Retired; see the header. Named here because it is the
 * only row shape for which `survivingDigests` describes something the run actually did.
 */
const CONTENT_IDENTITY_CLASS = "duplicate-copy";

/** One `home reclaim --apply` run over one declared root. */
export interface ReclaimJournalRow {
  /** ISO instant the run finished. */
  readonly atIso: string;
  /** The declared root's name, from `./roots.ts`. */
  readonly root: string;
  /**
   * Which class was taken. `finished-scratch` is the only one a run still writes; a row from before it reads
   * `build-tree` (the package and build trees inside a finished scratch) and renders unchanged.
   */
  readonly takes: string;
  /** How many entries were removed. */
  readonly removedEntries: number;
  /** Bytes the removal actually freed — entries sharing an inode are excluded. */
  readonly freedBytes: number;
  /** Distinct contents that survived a retired `duplicate-copy` run; absent on every row written since. */
  readonly survivingDigests?: number;
  /** Whether the post-apply witness held. */
  readonly witnessHeld: boolean;
  /** The session that ran it, so a wrong act has an author. */
  readonly session: string;
}

/**
 * Render one row as the line a reader sees.
 *
 * @param row the ledger row
 * @returns one line, ready to write
 */
export function renderReclaimRow({ row }: { row: ReclaimJournalRow }): string {
  const mib = (row.freedBytes / (1024 * 1024)).toFixed(1);
  const witness = row.witnessHeld ? "witness held" : "WITNESS FAILED";
  const surviving = survivingColumn({ row });
  return (
    `  ${row.atIso}  ${row.root} (${row.takes})\n` +
    `    removed ${String(row.removedEntries)} entr(ies), freed ${mib} MiB${surviving} — ` +
    `${witness}; ran by ${row.session}`
  );
}

/** The surviving-contents column, empty for every class that never judged content. */
function survivingColumn({ row }: { row: ReclaimJournalRow }): string {
  if (row.takes !== CONTENT_IDENTITY_CLASS) {
    return "";
  }
  if (row.survivingDigests === undefined) {
    return "";
  }
  return `, ${String(row.survivingDigests)} content(s) survive`;
}
