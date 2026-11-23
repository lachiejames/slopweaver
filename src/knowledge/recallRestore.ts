/**
 * Decoding one line of a recall-ledger export back into the row it came from. Pure: no I/O.
 *
 * The sibling of `./restore.ts`, and it exists for one reason: a backup that carried the register and left
 * the accounting behind would DELETE by recovery the counts that decide what a recall page shows first —
 * and nothing is ever deleted. So `knowledge export` writes a second file beside
 * the first and `knowledge restore` reads it when it is there.
 *
 * An export written BEFORE the ledger existed has no sibling at all, and that is a restore with zero
 * recalls rather than a failure: the accounting genuinely did not exist then.
 */
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import { type KnowledgeError, KnowledgeErrors } from "./errors.js";
import { RECALL_OUTCOMES, type RecallOutcome } from "./recallAccounting.js";

/** One recall as an insert takes it — every identity preserved verbatim, exactly as `./restore.ts` does. */
export interface RecallRecord {
  readonly recallId: string;
  readonly seq: number;
  readonly memoryId: string;
  readonly recordingId: string;
  readonly outcome: RecallOutcome;
  readonly evidence: string;
  readonly run: string;
  readonly recordedAt: Date;
  readonly createdAt: Date;
}

/** Whether a value is one of the three outcomes. Positional: TS1230 forbids destructuring in a predicate. */
function isOutcome(value: unknown): value is RecallOutcome {
  return RECALL_OUTCOMES.some((entry) => entry === value);
}

/**
 * Decode one exported recall back into the row an insert takes.
 *
 * `seq` and both instants are required rather than defaulted, for the reason `./restore.ts` gives about the
 * register: they are what order two rows, and a restore that regenerated them would change what the counts
 * describe.
 *
 * @param line one line of the recalls export file
 * @param lineNumber the 1-based line number, carried into a corruption error so the file can be inspected
 * @returns the recall, or a corruption error naming the line
 */
export function parseExportedRecall({
  line,
  lineNumber,
}: {
  line: string;
  lineNumber: number;
}): Result<RecallRecord, KnowledgeError> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch {
    return err(KnowledgeErrors.corruptRow({ lineNumber }));
  }
  if (!isRecord(decoded)) {
    return err(KnowledgeErrors.corruptRow({ lineNumber }));
  }
  const { recallId, memoryId, recordingId, outcome, evidence, run, recordedAt, createdAt, seq } = decoded;
  const textsOk =
    typeof recallId === "string" &&
    typeof memoryId === "string" &&
    typeof recordingId === "string" &&
    typeof evidence === "string" &&
    typeof run === "string" &&
    typeof recordedAt === "string" &&
    typeof createdAt === "string";
  // A positive safe integer, for the reason `./restore.ts`'s `orderingFields` gives.
  if (!textsOk || !isOutcome(outcome) || typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1) {
    return err(KnowledgeErrors.corruptRow({ lineNumber }));
  }
  const when = new Date(recordedAt);
  const entered = new Date(createdAt);
  if (Number.isNaN(when.getTime()) || Number.isNaN(entered.getTime())) {
    return err(KnowledgeErrors.corruptRow({ lineNumber }));
  }
  return ok({
    createdAt: entered,
    evidence,
    memoryId,
    outcome,
    recallId,
    recordedAt: when,
    recordingId,
    run,
    seq,
  });
}
