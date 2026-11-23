/**
 * Noticing that the retired append-only register has grown past what the `memories` table holds.
 *
 * The register lives in the table and the file has no writer, so this repository never appends to
 * `$SLOPWEAVER_HOME/knowledge/lessons.jsonl`. **The machine still can.**
 * `slopweaver` is a shell function running `$(git rev-parse --show-toplevel)/bin/slopweaver`, so a session
 * gets the CLI in its OWN checkout, and a worktree whose HEAD predates the cutover still carries the deleted
 * `knowledge/store.ts` and its `appendFileSync`. Measured: seven of 89 worktrees under
 * `.claude/worktrees.noindex` predated the cutover, the file's last two lines were appended by them, and
 * neither claim was in the table — those observations existed nowhere else. Repro:
 * `find .claude/worktrees.noindex -maxdepth 3 -name store.ts -path "*knowledge*"`.
 *
 * ## Why this is a notice and not a monitor, a gate or a fix
 *
 * `../monitor/registry.ts` rules itself out in one line — "a condition a session would simply fix is not a
 * monitor", and every card it draws must name an action only the OWNER can take. This one is fixed by a command a
 * session already has. It is not a gate either: a lesson write must never be refused because an unrelated
 * legacy file drifted. So it is one advisory line on `knowledge record`, the verb every up-to-date run
 * already calls at close, and rule 10 does the rest.
 *
 * Nothing here can reach the stale code. What it can do is make sure the appends are RECOVERED rather than
 * lost, which the per-line import key already guarantees (`./importLessons.ts`).
 *
 * ## The predicate is exact, and `appendPlan` is why
 *
 * `./importLessons.ts`'s apply REFUSES a hole — an accounted key after an absent one — so the keys the
 * table holds, together with the keys a `knowledge prune` retired into its archive, are always a PREFIX of
 * the file's lines. `fileLines > importedCount + prunedCount` is therefore precisely "lines were appended
 * after the imported prefix", with no parse of the file needed. The reverse is ordinary and not drift: the
 * table outruns the file by every lesson recorded since the cutover (measured: 1,739 lesson rows against 1,125
 * lines), so only a STRICT excess of lines says anything.
 *
 * **Pruned keys are subtracted, and leaving them out was a measured defect.** Measured: an
 * owner-approved prune removed 676 imported rows, this notice then called all 676 orphans on every
 * `knowledge record`, and the fix it named refused with a hole — `./prunedImportKeys.ts` carries the rest.
 * The table count leaves out every archived key, so the two counts add to the union even after a restore
 * from an archive has put a pruned row back ({@link countImportedRows}).
 *
 * **The count is a LOWER BOUND, and the direction is the safety property.** The import-key count is over
 * the whole table, and `import-lessons --file` takes any path, so a second file's rows would inflate it —
 * and its pruned rows the archive count — which can only make the shortfall read SMALLER, never larger. So
 * this can under-report and fall silent; it cannot invent an orphan or overstate one. On this install there
 * has only ever been one source file.
 *
 * The notice builder is pure. The reads it composes — the file's line count, the table's import-key count
 * and the archives' — live here beside it rather than in `./memoryStore.ts`.
 */
import { existsSync } from "node:fs";

import { sql } from "drizzle-orm";

import { readJsonlLines } from "../corpus/corpusStore.js";
import type { IngestError } from "../lib/ingestError.js";
import { ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import { stateHomePaths } from "../stateHome.js";
import type { StoreClient } from "../store/client.js";
import { memoriesTable } from "../store/schema/memories.js";

import { readPrunedImportKeys } from "./prunedImportKeys.js";

/**
 * The advisory a caller prints when the retired register holds lines the table has not imported.
 *
 * @param filePath the register's absolute path, printed so the fix can be pasted without deriving it
 * @param fileLines how many importable (non-blank) lines the file holds
 * @param importedCount how many rows in the table carry an import key
 * @param prunedCount how many import keys a prune archive holds — lines retired on purpose, not orphans
 * @returns one line per printed row, in order, or an EMPTY array when there is nothing to say
 */
export function lessonsDriftNotice({
  filePath,
  fileLines,
  importedCount,
  prunedCount,
}: {
  filePath: string;
  fileLines: number;
  importedCount: number;
  prunedCount: number;
}): readonly string[] {
  const orphans = fileLines - importedCount - prunedCount;
  if (orphans <= 0) {
    return [];
  }
  return [
    `  note: ${String(orphans)} line(s) of the retired register are not in the memories table —` +
      ` a checkout predating the cutover is still appending to ${filePath}`,
    `  fix:  slopweaver knowledge import-lessons --file ${filePath} --apply`,
  ];
}

/**
 * Count the IMPORTABLE lines of the retired register, streaming rather than reading it into one string.
 *
 * Streamed because the file is data-sized by construction — it is every lesson the fleet ever recorded —
 * and `typescript-patterns.md` § "Never let a data-sized payload through one JS string" covers exactly
 * this shape.
 *
 * **Blank lines are skipped, and that is the counted thing rather than a tidy-up.** The import
 * (`../cli/commands/knowledge/importLessons.ts`) skips them too, so one import key exists per NON-BLANK
 * line — counting physical lines instead would report the file's trailing newline as a permanent orphan
 * and the notice would never go quiet.
 *
 * A missing file reads as zero. It is the ordinary state of an install that never had one, and a typed
 * failure there would turn an advisory into noise on every `knowledge record`.
 *
 * @param path the register's absolute path
 * @returns the importable line count, zero when the file is absent, or the boundary's typed failure
 */
export function countLessonFileLines({ path }: { path: string }): Result<number, IngestError> {
  if (!existsSync(path)) {
    return ok(0);
  }
  return safeFs({
    execute: () => {
      let lines = 0;
      readJsonlLines({
        onLine: ({ line }) => {
          if (line.trim().length === 0) {
            return;
          }
          lines += 1;
        },
        path,
      });
      return lines;
    },
    operation: "countLessonFileLines",
    path,
  });
}

/**
 * How many recordings carry an import key no prune archive holds — the table's share of the accounted prefix.
 *
 * A COUNT rather than `./memoryRewriteStore.ts`'s `readImportedKeys`, which pulls every stored claim: this caller
 * wants one integer on a path that runs after every lesson write.
 *
 * **The archived keys are excluded so the two counts add to a UNION.** A prune deletes the rows it archives,
 * but the archive is also the way back: `knowledge restore` over it puts a row, import key and all, into the
 * table again while the archive still names it. Counted on both sides, that line would be subtracted twice
 * and could mask a genuinely appended one.
 *
 * NULL on a failure rather than zero, and the difference is the whole notice: an unreachable count read as
 * zero would make every line of the file look orphaned and print a 1,125-line false alarm.
 *
 * @param client an open connection
 * @param excluding the import keys a prune archive holds, counted on the archive side instead
 * @returns the number of rows whose `import_key` is set and not archived, or `null` when the count could not be taken
 */
export async function countImportedRows({
  client,
  excluding,
}: {
  client: StoreClient;
  excluding: ReadonlySet<string>;
}): Promise<number | null> {
  try {
    const rows = await client.db.execute<{ imported: number }>(
      sql`select count(*)::int as imported from ${memoriesTable}
          where import_key is not null and import_key <> all(${sql.param([...excluding])})`,
    );
    // `count(*)` over a table always returns exactly one row, so the index is total rather than optimistic.
    return [...rows][0]!.imported;
  } catch {
    return null;
  }
}

/**
 * The advisory lines `knowledge record` prints after a successful write, or none.
 *
 * **Swallows its own failures, and that is the contract rather than laziness.** This is a nudge about an
 * unrelated legacy file; a lesson that WAS written must never look like a failure — or draw a false alarm —
 * because a count of something else could not be taken. Any of the three reads failing — the file, the archives, the table — means silence.
 *
 * The store read arrives as a SEAM rather than a connection, so this decision is exercised by a test
 * passing a plain function. {@link countImportedRows} is what the verb supplies.
 *
 * @param countImported the table side of the comparison, leaving out the archived keys it is handed, answering
 *   `null` when it could not be taken
 * @param home the `--home` override, when one was given
 * @returns the lines to print, empty when there is nothing to say or nothing could be read
 */
export async function lessonsDriftLines({
  countImported,
  home,
}: {
  countImported: (args: { excluding: ReadonlySet<string> }) => Promise<number | null>;
  home: string | undefined;
}): Promise<readonly string[]> {
  const filePath = stateHomePaths(home === undefined ? {} : { home }).knowledgeLessonsJsonl;
  const fileLines = countLessonFileLines({ path: filePath });
  if (fileLines.isErr()) {
    return [];
  }
  const pruned = readPrunedImportKeys({ home });
  if (pruned.isErr()) {
    return [];
  }
  const importedCount = await countImported({ excluding: pruned.value });
  if (importedCount === null) {
    return [];
  }
  return lessonsDriftNotice({ fileLines: fileLines.value, filePath, importedCount, prunedCount: pruned.value.size });
}
