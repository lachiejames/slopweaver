/**
 * Which lines of the retired register a `knowledge prune` has already retired — read back from its archives.
 *
 * `knowledge prune` is the memories table's one delete path, and it deletes imported rows too: their import
 * keys leave the table. Both readers that compare the retired register against the table
 * (`./importLessons.ts`'s `appendPlan` and `./lessonsDrift.ts`) assumed the table's keys were a PREFIX of the
 * file, so a prune that retired a line from the middle looked like a line edited out of an append-only file.
 * Measured: an owner-approved pass removed 676 imported rows, every `knowledge record`
 * then named `import-lessons --apply` as the fix, and that apply refused with a hole. Re-importing those lines
 * would have resurrected 676 claims the owner had retired.
 *
 * The prune ARCHIVE is the record that settles it: `../cli/commands/knowledge/prune.ts` writes every deleted
 * recording, `importKey` included, in `knowledge export` format BEFORE its transaction runs. So a key in an
 * archive is a line that was imported and then deliberately retired — accounted for, never an orphan.
 *
 * The archive keys and the table's keys are disjoint straight after a prune, and NOT afterwards: the archive
 * is also the way back, and `knowledge restore` over it puts a row into the table with its import key while
 * the archive still names it. So every consumer treats a line as accounted when EITHER side holds it, and a
 * count never adds the two sides without excluding one from the other.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";

import { type KnowledgeError, KnowledgeErrors } from "./errors.js";
import { parseExportedLine } from "./restore.js";

/** The suffixes `knowledge prune` gives the plan and recall files it writes beside each archive. */
const SIBLING_SUFFIXES: readonly string[] = [".jsonl.plan.jsonl", ".jsonl.recalls.jsonl"];

/**
 * Where `knowledge prune` writes its archives.
 *
 * @param home the state home, when the caller named one
 * @returns the archive directory, which need not exist yet
 */
export function prunedArchiveDir({ home }: { home: string | undefined }): string {
  return join(stateHomePaths(home === undefined ? {} : { home }).knowledge, "pruned");
}

/**
 * Whether a file in the archive directory is a recording archive rather than one of its siblings.
 *
 * @param name a bare file name from that directory
 * @returns true for `<stamp>.jsonl`, false for its `.plan.jsonl` and `.recalls.jsonl` siblings and anything else
 */
export function isPruneArchiveName({ name }: { name: string }): boolean {
  return name.endsWith(".jsonl") && !SIBLING_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * Every import key a prune archive holds — the retired register's lines a prune deliberately removed.
 *
 * A missing directory is an empty set: the ordinary state of an install that never pruned. A line that does
 * not decode is a refusal naming the file, never a skip, because a dropped key would make its line read as
 * an orphan and invite the very re-import this exists to prevent.
 *
 * @param home the state home, when the caller named one
 * @returns the archived import keys, or the typed failure
 */
export function readPrunedImportKeys({
  home,
}: {
  home: string | undefined;
}): Result<ReadonlySet<string>, KnowledgeError> {
  const dir = prunedArchiveDir({ home });
  if (!existsSync(dir)) {
    return ok(new Set());
  }
  const keys = new Set<string>();
  let path = dir;
  try {
    for (const name of readdirSync(dir)
      .filter((entry) => isPruneArchiveName({ name: entry }))
      .toSorted()) {
      path = join(dir, name);
      let corrupt: KnowledgeError | undefined;
      readJsonlLines({
        onLine: ({ line, index }) => {
          if (corrupt !== undefined || line.trim().length === 0) {
            return;
          }
          const decoded = parseExportedLine({ line, lineNumber: index + 1 });
          if (decoded.isErr()) {
            corrupt = decoded.error;
            return;
          }
          if (decoded.value.importKey !== null) {
            keys.add(decoded.value.importKey);
          }
        },
        path,
      });
      if (corrupt !== undefined) {
        return err(KnowledgeErrors.storeUnreadable({ cause: corrupt, path }));
      }
    }
  } catch (cause) {
    return err(KnowledgeErrors.storeUnreadable({ cause, path }));
  }
  return ok(keys);
}
