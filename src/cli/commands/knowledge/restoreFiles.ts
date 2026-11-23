/**
 * Decoding a `knowledge export` file and the recall ledger beside it, completely, before a restore opens a
 * connection — so a bad line in either file is refused with nothing written.
 *
 * Its own module so the decode is testable against real fixture files without a database: the verb in
 * `./restoreMemories.ts` is everything else, and everything else needs a store.
 */
import { existsSync } from "node:fs";

import { readJsonlLines } from "../../../corpus/corpusStore.js";
import { type KnowledgeError, KnowledgeErrors } from "../../../knowledge/errors.js";
import { parseExportedRecall, type RecallRecord } from "../../../knowledge/recallRestore.js";
import { parseExportedLine, type RestoredRecording } from "../../../knowledge/restore.js";
import type { RestoreInput } from "../../../knowledge/restoreMerge.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { recallsFileFor } from "./exportMemories.js";

/** Both files decoded, and whether the ledger was there at all. */
export interface DecodedRestore {
  readonly incoming: RestoreInput;
  /** Where the ledger was looked for — derived from the register's path, never named separately. */
  readonly ledgerPath: string;
  /**
   * False for an export written before the ledger existed: a complete restore with zero recalls, which the
   * verb says out loud, because an accidentally separated modern ledger looks exactly the same.
   */
  readonly ledgerPresent: boolean;
}

/**
 * Decode every non-blank line of one file, stopping at the first that will not decode.
 *
 * @param path the file
 * @param decode the per-line decoder, which names the line in its refusal
 * @returns every row, or the first refusal — an unreadable file included, never read as an empty one
 */
function decodeLines<Row>({
  path,
  decode,
}: {
  path: string;
  decode: (args: { line: string; lineNumber: number }) => Result<Row, KnowledgeError>;
}): Result<readonly Row[], KnowledgeError> {
  const rows: Row[] = [];
  let failure: KnowledgeError | undefined;
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (failure !== undefined || line.trim().length === 0) {
          return;
        }
        const decoded = decode({ line, lineNumber: index + 1 });
        if (decoded.isErr()) {
          failure = decoded.error;
          return;
        }
        rows.push(decoded.value);
      },
      path,
    });
  } catch (cause) {
    return err(KnowledgeErrors.storeUnreadable({ cause, path }));
  }
  if (failure !== undefined) {
    return err(failure);
  }
  return ok(rows);
}

/**
 * Decode a register export and the recall ledger beside it, both completely.
 *
 * @param file the register export the caller named; the ledger's path is derived from it
 * @returns both files' rows and whether the ledger existed, or the first refusal in either file
 */
export function decodeRestoreFiles({ file }: { file: string }): Result<DecodedRestore, KnowledgeError> {
  const memories = decodeLines<RestoredRecording>({ decode: parseExportedLine, path: file });
  if (memories.isErr()) {
    return err(memories.error);
  }
  const ledgerPath = recallsFileFor({ out: file });
  if (!existsSync(ledgerPath)) {
    return ok({ incoming: { memories: memories.value, recalls: [] }, ledgerPath, ledgerPresent: false });
  }
  const recalls = decodeLines<RecallRecord>({ decode: parseExportedRecall, path: ledgerPath });
  if (recalls.isErr()) {
    return err(recalls.error);
  }
  return ok({ incoming: { memories: memories.value, recalls: recalls.value }, ledgerPath, ledgerPresent: true });
}
