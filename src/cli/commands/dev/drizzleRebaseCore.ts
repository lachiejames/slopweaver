/**
 * The pure half of `slopweaver dev drizzle-rebase`: what a conflicted journal says should be discarded.
 *
 * Ported as DESIGN from the archive's `cli drizzle-rebase` (AGENTS.md § "Porting from private sources"),
 * which existed because the same thing happens to every repository that generates migrations from a
 * schema on more than one branch at a time. Two branches each run the generator, each writes an entry
 * into `meta/_journal.json`, and the merge keeps both — so the tree now claims an apply order nobody
 * chose, and `drizzle-orm`'s migrator will apply it.
 *
 * **This repository lands many branches a day**, which is what makes the class routine here rather than
 * occasional. The fix is not to hand-edit the journal: it is to discard the entries that arrived out of
 * order along with their files and snapshots, and regenerate from the schema — which is the one artefact
 * the merge resolved correctly, because it is code and git merged it as code.
 *
 * Pure by construction: it takes the journal's entries and answers what to discard. The deletion and the
 * regeneration are the caller's, so this half is testable over real journals with no filesystem.
 */

/** One entry in `meta/_journal.json`. */
export interface RebaseJournalEntry {
  /** Position in the apply order. */
  readonly idx: number;
  /** The migration's file name without its extension. */
  readonly tag: string;
  /** When drizzle-kit generated it, in epoch milliseconds. */
  readonly when: number;
}

/** What a rebase would do, without having done any of it. */
export interface RebasePlan {
  /** The entries to drop, newest-conflicting first as they appear in the journal. */
  readonly discard: readonly RebaseJournalEntry[];
  /** The entries that stay, in their existing order. */
  readonly keep: readonly RebaseJournalEntry[];
  /** Why each discarded entry is being discarded, one line each. */
  readonly reasons: readonly string[];
}

/**
 * Which journal entries arrived out of order, and therefore have to be regenerated rather than kept.
 *
 * The rule is a single pass holding the highest `when` seen so far: an entry generated no later than one
 * already applied before it cannot be in the position the journal claims, because drizzle-kit stamps
 * `when` at generation time and generation is strictly monotonic within one branch. So a violation is
 * exactly the signature of a SECOND branch's entry landing after the first branch's.
 *
 * **The earliest conflicting entry is kept, not dropped.** Both branches' migrations are equally valid as
 * SQL; what is invalid is their relative order. Keeping the first and regenerating the rest produces one
 * migration carrying whatever the merged schema now says, which is the state the tree actually wants —
 * and it means a rebase never discards a migration that has already been applied somewhere, because an
 * applied one is by definition earlier than the branch that is being rebased onto it.
 *
 * @param entries the journal's entries, in the order the file lists them
 * @returns what to discard, what to keep, and why
 */
export function planRebase({ entries }: { entries: readonly RebaseJournalEntry[] }): RebasePlan {
  const keep: RebaseJournalEntry[] = [];
  const discard: RebaseJournalEntry[] = [];
  const reasons: string[] = [];

  let highestWhen = Number.NEGATIVE_INFINITY;
  let highestTag = "";
  for (const entry of entries) {
    const outOfOrder = entry.when <= highestWhen;
    if (outOfOrder) {
      discard.push(entry);
      reasons.push(
        `${entry.tag} was generated at ${String(entry.when)}, no later than ${highestTag}'s ${String(highestWhen)} — a second branch generated it`,
      );
      continue;
    }
    keep.push(entry);
    highestWhen = entry.when;
    highestTag = entry.tag;
  }

  return { discard, keep, reasons };
}

/**
 * The files one discarded entry owns, relative to the migrations directory.
 *
 * Both, always: the `.sql` and the snapshot drizzle-kit writes beside it under `meta/`. Deleting the SQL
 * and leaving the snapshot is worse than deleting neither, because the generator diffs against snapshots
 * and would then emit a migration for changes it believes are already applied.
 *
 * @param entry the entry being discarded
 * @returns the two paths, SQL first
 */
export function filesOfEntry({ entry }: { entry: RebaseJournalEntry }): readonly string[] {
  return [`${entry.tag}.sql`, `meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`];
}

/**
 * Render a plan for a reader, whether or not it is about to be applied.
 *
 * @param plan what the rebase would do
 * @param dryRun whether this is a preview
 * @returns the lines to print
 */
export function renderRebasePlan({ plan, dryRun }: { plan: RebasePlan; dryRun: boolean }): readonly string[] {
  if (plan.discard.length === 0) {
    return [`drizzle-rebase: the journal's ${String(plan.keep.length)} entr(ies) are already in order — nothing to do`];
  }
  const verb = dryRun ? "would discard" : "discarding";
  return [
    `drizzle-rebase: ${verb} ${String(plan.discard.length)} out-of-order entr(ies), keeping ${String(plan.keep.length)}`,
    ...plan.reasons.map((reason) => `  ${reason}`),
    ...plan.discard.flatMap((entry) =>
      filesOfEntry({ entry }).map((file) => `  ${dryRun ? "would remove" : "removing"} ${file}`),
    ),
    dryRun
      ? "  then: slopweaver store push — one migration carrying whatever the merged schema now says"
      : "  now run: slopweaver store push",
  ];
}
