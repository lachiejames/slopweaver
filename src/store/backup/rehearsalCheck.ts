/**
 * The PURE verdicts of a restore rehearsal: is the restored copy's schema the live one's, do its row counts
 * reconcile with the live store, and are its newest rows byte-equal to the same rows on live.
 *
 * ## Why "reconcile" and not "equal"
 *
 * The rehearsal restores the NEWEST backup in the destination, and the live store has kept moving since that dump
 * was taken — hours of ingest on a normal day. Demanding every count be equal would make every rehearsal red
 * and teach the reader to ignore it; comparing only "roughly" would pass a restore that lost rows. So a table
 * whose counts differ is judged against the one thing that separates the two: the rows live has gained SINCE
 * the copy's own newest row. A table with an insertion-time column reconciles when the copy holds exactly the
 * rows live holds up to the copy's own frontier on that column. What is left over — a table with no such
 * column, or whose rows are replaced rather than appended — is reported as `drifted`, with both counts, and
 * judged by the byte-equal sample instead.
 *
 * ## Why a changed sampled row can still pass
 *
 * A row the copy holds may have been UPDATED on live since the dump. The sample compares a SHA-256 of the
 * row's own text form on both sides, and when they differ it asks live whether any of that row's timestamp
 * columns now reads LATER than the dump began. Yes is `changed-after-backup`, explained by live moving.
 *
 * No is only evidence when the table RECORDS a change at all. `public.content` has `occurred_at` and
 * `created_at` and nothing a rewrite bumps, and its loader rewrites a row in place: MEASURED, the
 * first full rehearsal failed on one GitHub review comment resolved after the dump — live read
 * `"resolved": true` and a `[resolved]` body, and no column on the row could say so. So a differing row in a
 * table with a change-time column ({@link recordsChangeTime}) that does not read later is `different`, which
 * fails; in a table with none it is `untracked-change`, reported by key and not failing. Repro: `slopweaver
 * store rehearse`, then read the named row on live.
 */
import { flattenAndChains } from "./flattenAndChains.js";

/** One table's counts, and how they were judged. */
export interface CountVerdict {
  readonly table: string;
  readonly live: number | null;
  readonly copy: number | null;
  /**
   * `equal` — the same on both sides. `reconciled` — different, and live's count up to the copy's own frontier
   * equals the copy. `drifted` — different with no frontier that explains it; reported, judged by the sample.
   * `missing` — one side has no such table, which always fails.
   */
  readonly verdict: "equal" | "reconciled" | "drifted" | "missing";
  /** The column and frontier a `reconciled` or `drifted` verdict was judged on, when the table has one. */
  readonly frontier: { readonly column: string; readonly copyMax: string; readonly liveUpTo: number } | null;
}

/** One sampled row's verdict. */
export interface SampleVerdict {
  readonly table: string;
  /** The row's primary key, rendered as text. */
  readonly key: string;
  /**
   * `equal` — the row's text form hashes identically on both sides. `changed-after-backup` — it differs, and a
   * timestamp on the live row is later than the dump began. `missing-on-live` — live no longer holds that key.
   * `untracked-change` — it differs, and the table has no column a rewrite bumps, so nothing could say.
   * `different` — it differs and the table's change-time column says it was not touched, which fails.
   */
  readonly verdict: "equal" | "changed-after-backup" | "missing-on-live" | "untracked-change" | "different";
}

/** What one side returned for one sampled row, before judging. */
export interface SampleReading {
  readonly table: string;
  readonly key: string;
  /** SHA-256 of the copy row's `t::text`, as UTF-8. */
  readonly copySha256: string;
  /** SHA-256 of the live row's `t::text`, or `null` when live holds no row with that key. */
  readonly liveSha256: string | null;
  /** Whether any timestamp column on the live row reads later than the dump began. */
  readonly liveTouchedAfterDump: boolean;
  /** Whether the table has a column a rewrite bumps, so an untouched reading is evidence. */
  readonly tableRecordsChanges: boolean;
}

/** Timestamp column names a writer bumps when it rewrites a row, as opposed to stamping it once. */
const CHANGE_TIME_COLUMN = /^(updated_at|loaded_at|derived_at|last_[a-z_]+_at|[a-z_]*modified_at|[a-z_]*edited_at)$/u;

/**
 * Whether a table records when a row was last rewritten, read off its timestamp column names.
 *
 * @param columns the table's timestamp column names
 * @returns true when one of them is a change-time column
 */
export function recordsChangeTime({ columns }: { columns: readonly string[] }): boolean {
  return columns.some((name) => CHANGE_TIME_COLUMN.test(name));
}

/**
 * Judge one sampled row.
 *
 * @param reading both sides' digests of the row, and whether live says it was touched
 * @returns the verdict
 */
export function judgeSample({ reading }: { reading: SampleReading }): SampleVerdict {
  const { table, key, copySha256, liveSha256, liveTouchedAfterDump, tableRecordsChanges } = reading;
  if (liveSha256 === null) {
    return { key, table, verdict: "missing-on-live" };
  }
  if (liveSha256 === copySha256) {
    return { key, table, verdict: "equal" };
  }
  if (liveTouchedAfterDump) {
    return { key, table, verdict: "changed-after-backup" };
  }
  return { key, table, verdict: tableRecordsChanges ? "different" : "untracked-change" };
}

/** What a schema comparison found — the catalog lines only one side has. */
export interface SchemaVerdict {
  readonly identical: boolean;
  /** How many catalog lines each side produced, so an empty comparison is visible as one. */
  readonly liveLines: number;
  readonly copyLines: number;
  readonly onlyLive: readonly string[];
  readonly onlyCopy: readonly string[];
}

/** What one table's count query returned on both sides, before judging. */
export interface CountReading {
  readonly table: string;
  readonly live: number | null;
  readonly copy: number | null;
  /** The table's insertion-time column, the copy's max of it, and live's count up to that max — or `null`. */
  readonly frontier: { readonly column: string; readonly copyMax: string; readonly liveUpTo: number } | null;
}

/** The columns read as "when this row was first written", most specific first. */
const INSERTION_COLUMNS = [
  "created_at",
  "first_imported_at",
  "recorded_at",
  "imported_at",
  "first_seen_at",
  "first_detected_at",
  "first_event_at",
  "executed_at",
  "at_iso",
  "occurred_at",
] as const;

/**
 * Pick a table's insertion-time column from the columns it has.
 *
 * @param columns the table's column names
 * @returns the first of {@link INSERTION_COLUMNS} it has, or `null` when it has none
 */
export function insertionColumn({ columns }: { columns: readonly string[] }): string | null {
  const found = INSERTION_COLUMNS.find((name) => columns.includes(name));
  if (found === undefined) {
    return null;
  }
  return found;
}

/**
 * The catalog line kinds whose payload is a DEPARSED expression (`pg_get_constraintdef`, `pg_get_expr`,
 * `indexdef`, `pg_get_triggerdef`, a policy's `qual`/`with_check`), as `rehearsalVerify.ts` formats them.
 * Every other kind carries raw text — an enum's labels are joined unquoted — where brackets and ` AND ` are
 * data, so regrouping them could call two different values equal.
 */
const EXPRESSION_LINE_KINDS = ["column ", "constraint ", "index ", "policy ", "trigger "] as const;

/**
 * One catalog line as it is compared: AND chains flattened when its kind carries a deparsed expression, and
 * byte for byte otherwise.
 *
 * @param line one catalog line
 * @returns the line to compare
 */
function canonicalCatalogLine({ line }: { line: string }): string {
  if (!EXPRESSION_LINE_KINDS.some((kind) => line.startsWith(kind))) {
    return line;
  }
  return flattenAndChains({ text: line });
}

/**
 * Compare the two sides' catalog fingerprints, line by line, after canonicalising the associative AND
 * grouping of every line that carries a deparsed expression ({@link flattenAndChains}) — a dump and restore
 * regroups a nested AND without changing it. The line counts and both difference lists are of unique
 * CANONICAL lines.
 *
 * Refuses to call two EMPTY fingerprints identical: a catalog query that read nothing proves nothing.
 *
 * @param live the live store's catalog lines
 * @param copy the restored copy's catalog lines
 * @returns the verdict with every canonical line only one side has
 */
export function compareSchema({ live, copy }: { live: readonly string[]; copy: readonly string[] }): SchemaVerdict {
  const liveSet = new Set(live.map((line) => canonicalCatalogLine({ line })));
  const copySet = new Set(copy.map((line) => canonicalCatalogLine({ line })));
  const onlyLive = [...liveSet].filter((line) => !copySet.has(line)).toSorted();
  const onlyCopy = [...copySet].filter((line) => !liveSet.has(line)).toSorted();
  return {
    copyLines: copySet.size,
    identical: liveSet.size > 0 && onlyLive.length === 0 && onlyCopy.length === 0,
    liveLines: liveSet.size,
    onlyCopy,
    onlyLive,
  };
}

/**
 * Judge one table's counts.
 *
 * @param reading what both sides returned
 * @returns the verdict
 */
export function judgeCount({ reading }: { reading: CountReading }): CountVerdict {
  const { table, live, copy, frontier } = reading;
  if (live === null || copy === null) {
    return { copy, frontier, live, table, verdict: "missing" };
  }
  if (live === copy) {
    return { copy, frontier, live, table, verdict: "equal" };
  }
  const reconciled = frontier?.liveUpTo === copy;
  return { copy, frontier, live, table, verdict: reconciled ? "reconciled" : "drifted" };
}

/** The two legs that are not the database, as read off the fetched backup and the destination. */
export interface LegsReading {
  /** `storage.tar` listed as a tar, or what `tar` said when it would not. */
  readonly storage:
    { readonly status: "listed"; readonly entries: number } | { readonly status: "unreadable"; readonly why: string };
  /** How many files `files.json` names, and every object among them the destination does not hold. */
  readonly files: { readonly named: number; readonly missing: readonly string[] };
}

/**
 * The Vault leg, restored into the throwaway and counted there: what the manifest recorded against what the
 * throwaway's Vault holds and can open afterwards, or why it never got that far. `absent` is a backup that
 * carried no Vault leg at all, which a restore from it would silently lose.
 */
export type VaultReading =
  | { readonly status: "absent" }
  | { readonly status: "restored"; readonly expected: number; readonly restored: number }
  | { readonly status: "failed"; readonly why: string };

/**
 * The failure lines one Vault reading contributes to a verdict.
 *
 * @param vault the Vault leg's reading
 * @returns nothing when every recorded secret came back, else why it did not
 */
function vaultFailures({ vault }: { vault: VaultReading }): readonly string[] {
  if (vault.status === "absent") {
    return ["the backup carries no Vault leg, so a restore from it would lose every Vault secret"];
  }
  if (vault.status === "failed") {
    return [`the Vault leg did not restore: ${vault.why}`];
  }
  if (vault.restored !== vault.expected) {
    return [
      `the Vault leg recorded ${String(vault.expected)} secret(s) and the copy holds ${String(vault.restored)} it can open`,
    ];
  }
  return [];
}

/** The whole rehearsal's verdict over its three checks. */
export interface RehearsalVerdict {
  readonly passed: boolean;
  /** Why it did not pass, one line each — empty when it passed. */
  readonly failures: readonly string[];
}

/**
 * Judge the rehearsal from the database's three checks and the other two legs.
 *
 * Fails on: a schema that is not identical; a table either side lacks; a sampled row that differs while its
 * table's change-time column says it was not touched since the dump; a sample with no `equal` row at all; a
 * `storage.tar` that does not list; any object `files.json` names that the destination lacks; a Vault leg that is
 * absent, did not restore, or came back short. A `drifted` count and
 * a `changed-after-backup`, `untracked-change` or `missing-on-live` row are reported and do not fail it — the
 * live store moving is
 * not the backup being wrong — but a sample where EVERY row moved proves nothing about the copy's bytes, so it
 * needs at least one row that matched.
 *
 * @param schema the schema comparison
 * @param counts every table's count verdict
 * @param sample every sampled row's verdict
 * @param legs the storage tar's listing and the files leg's held objects
 * @param vault the Vault leg as restored into the throwaway
 * @returns whether it passed, and every reason it did not
 */
export function judgeRehearsal({
  schema,
  counts,
  sample,
  legs,
  vault,
}: {
  schema: SchemaVerdict;
  counts: readonly CountVerdict[];
  sample: readonly SampleVerdict[];
  legs: LegsReading;
  vault: VaultReading;
}): RehearsalVerdict {
  const failures = [
    ...(schema.identical
      ? []
      : [
          `schema differs: ${String(schema.onlyLive.length)} catalog line(s) only on live, ` +
            `${String(schema.onlyCopy.length)} only in the copy (live ${String(schema.liveLines)}, copy ${String(schema.copyLines)})`,
        ]),
    ...counts
      .filter((row) => row.verdict === "missing")
      .map((row) => `${row.table}: on ${row.live === null ? "the copy only" : "live only"}`),
    ...sample
      .filter((row) => row.verdict === "different")
      .map(
        (row) =>
          `${row.table} ${row.key}: differs from live, and live's change-time column says it was not touched since the dump`,
      ),
    ...(sample.some((row) => row.verdict === "equal") ? [] : ["the byte-equal sample matched no row at all"]),
    ...(counts.length === 0 ? ["the count comparison read no tables at all"] : []),
    ...(legs.storage.status === "unreadable" ? [`storage.tar does not list as a tar: ${legs.storage.why}`] : []),
    ...(legs.files.missing.length === 0
      ? []
      : [
          `the destination lacks ${String(legs.files.missing.length)} object(s) files.json names, first ${legs.files.missing[0]!}`,
        ]),
    ...vaultFailures({ vault }),
  ];
  return { failures, passed: failures.length === 0 };
}
