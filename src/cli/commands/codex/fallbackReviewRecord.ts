/**
 * `slopweaver codex review-fallback record` — the second half of the Claude fallback review.
 *
 * What a Codex review does AFTER its model call: validate the answer against the property that was asked,
 * and persist it. It refuses when the tree has moved since `prepare`, because the packet then describes a
 * diff nobody is landing. Split out of `./fallbackReviewRun.ts` (the dispatch and `prepare`) along the
 * subverb seam; the document rules themselves are pure and live in `../../../codex/fallbackReview.ts`.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { codexErrorLines } from "../../../codex/errors.js";
import { storedReceiptLabel } from "../../../codex/fallbackDocuments.js";
import type { FallbackRegisterPort } from "../../../codex/fallbackPort.js";
import {
  fallbackReceiptText,
  type ReadFallbackRequest,
  storedReviewRequest,
} from "../../../codex/fallbackRequestRead.js";
import {
  type ClaudeFallbackReviewReceipt,
  type ClaudeFallbackReviewRequest,
  type VisibleClaudeReviewer,
  validateFallbackReview,
} from "../../../codex/fallbackReview.js";
import { captureTreeFingerprint } from "../../../codex/gitDiff.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";

/**
 * An answer file's text, or the exit code to stop on. Shared by both fallback verbs' `record`.
 *
 * @param path the `--answer-file` value
 * @param verb the verb label the failure line is prefixed with
 * @returns the text, or the exit code
 */
export function readFallbackAnswerFile({ path, verb }: { path: string; verb: string }): string | number {
  try {
    return readFileSync(path, "utf8");
  } catch (error: unknown) {
    logger.error({
      msg: `${verb}: could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return EXIT_ERROR;
  }
}

/** The request to answer — present, parsed and not yet answered — or the exit code to stop on. */
async function readUnansweredRequest({
  home,
  port,
  requestId,
}: {
  home: string;
  port: FallbackRegisterPort;
  requestId: string;
}): Promise<ReadFallbackRequest<ClaudeFallbackReviewRequest> | number> {
  const stored = await port.readRequest({ home, requestId });
  if (stored.isErr()) {
    logger.error({ msg: `codex review-fallback record: ${stored.error.message}` });
    return EXIT_ERROR;
  }
  const read = storedReviewRequest({ stored: stored.value });
  if (read.isErr()) {
    for (const problem of codexErrorLines({ error: read.error })) {
      logger.error({ msg: `codex review-fallback record: ${problem}` });
    }
    return EXIT_ERROR;
  }
  if (read.value.answered) {
    logger.error({
      msg: `codex review-fallback record: request ${requestId} already has a receipt — one request is one review; prepare a new one`,
    });
    return EXIT_ERROR;
  }
  return read.value;
}

/**
 * The `record` half: validate against the request, refuse drift, write once.
 *
 * @param model the `--model` the reviewing session names, if any
 * @param workspace the `--workspace` the reviewer attests to, if any
 * @param port where the request is read and the receipt written
 * @returns the exit code
 */
export async function recordFallbackReview({
  requestId,
  answerFile,
  model,
  workspace,
  home,
  port,
  repo,
  json,
}: {
  requestId: string;
  answerFile: string;
  model: string | undefined;
  workspace: string | undefined;
  home: string;
  port: FallbackRegisterPort;
  repo: string;
  json: boolean;
}): Promise<number> {
  const read = await readUnansweredRequest({ home, port, requestId });
  if (typeof read === "number") {
    return read;
  }
  const answer = readFallbackAnswerFile({ path: answerFile, verb: "codex review-fallback record" });
  if (typeof answer === "number") {
    return answer;
  }
  const now = captureTreeFingerprint({ cwd: repo });
  if (now.isErr()) {
    logger.error({ msg: `codex review-fallback record: could not fingerprint the tree: ${now.error.message}` });
    return EXIT_ERROR;
  }
  const reviewer: VisibleClaudeReviewer = {
    host: "claude-code",
    model: reviewerModel({ flag: model }),
    workspace: reviewerWorkspace({ flag: workspace }),
  };
  const receipt = validateFallbackReview({
    answer,
    completedAtIso: new Date().toISOString(),
    now: now.value,
    receiptId: randomUUID(),
    request: read.request,
    requestBytes: read.bytes,
    reviewer,
  });
  if (receipt.isErr()) {
    for (const problem of receipt.error) {
      logger.error({ msg: `codex review-fallback record: REFUSED — ${problem}` });
    }
    return EXIT_ERROR;
  }
  return persistReceipt({ home, json, port, receipt: receipt.value });
}

/** Write the receipt row, exactly once, and say where it landed. */
async function persistReceipt({
  home,
  json,
  port,
  receipt,
}: {
  home: string;
  json: boolean;
  port: FallbackRegisterPort;
  receipt: ClaudeFallbackReviewReceipt;
}): Promise<number> {
  const written = await port.writeReceipt({
    home,
    receiptText: fallbackReceiptText({ receipt }),
    requestId: receipt.requestId,
  });
  if (written.isErr()) {
    logger.error({ msg: `codex review-fallback record: ${written.error.message}` });
    return EXIT_ERROR;
  }
  const where = storedReceiptLabel({ requestId: receipt.requestId });
  if (json) {
    logger.out({ line: JSON.stringify({ receipt, stored: where }) });
    return EXIT_OK;
  }
  const { request } = receipt;
  logger.out({
    line: `recorded fallback review ${receipt.receiptId}: ${request.pass} ${request.property.id} ${receipt.answer.verdict}`,
  });
  logger.out({ line: `  receipt: ${where}` });
  logger.out({ line: "  It is a review row in `codex status` now, marked [claude-code], judged like any other." });
  return EXIT_OK;
}

/**
 * The workspace the reviewer attests to: `--workspace` when given, else the cmux workspace this session runs
 * in, else none — a session outside cmux is still visible, just not on a sidebar.
 */
function reviewerWorkspace({ flag }: { flag: string | undefined }): string | null {
  if (flag !== undefined) {
    return flag;
  }
  const cmux = process.env["CMUX_WORKSPACE_ID"];
  if (cmux !== undefined) {
    return cmux;
  }
  return null;
}

/** The model the reviewer names, or none when `--model` was not given — never a guessed one. */
function reviewerModel({ flag }: { flag: string | undefined }): string | null {
  if (flag === undefined) {
    return null;
  }
  return flag;
}
