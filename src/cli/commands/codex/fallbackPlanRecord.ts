/**
 * `slopweaver codex plan-fallback record`'s body: read the request it answers, validate the answer against it,
 * refuse a tree that moved since `prepare`, and write the receipt row exactly once.
 *
 * Split from `./fallbackPlanRun.ts`, which keeps the parser, the `prepare` half and the flag checks, along the
 * same seam `./fallbackReviewRecord.ts` draws for the review fallback: what is here only ever runs once a
 * request id and an answer file are both in hand.
 */
import { randomUUID } from "node:crypto";

import { logger } from "#lib/logger.js";

import { codexErrorLines } from "../../../codex/errors.js";
import { storedReceiptLabel } from "../../../codex/fallbackDocuments.js";
import {
  type ClaudeFallbackPlanReceipt,
  type ClaudeFallbackPlanRequest,
  validateFallbackPlan,
} from "../../../codex/fallbackPlan.js";
import type { FallbackRegisterPort } from "../../../codex/fallbackPort.js";
import {
  fallbackReceiptText,
  type ReadFallbackRequest,
  storedPlanRequest,
} from "../../../codex/fallbackRequestRead.js";
import type { VisibleClaudeReviewer } from "../../../codex/fallbackReview.js";
import { captureTreeFingerprint } from "../../../codex/gitDiff.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { readFallbackAnswerFile } from "./fallbackReviewRecord.js";

/**
 * The plan request to answer — present, parsed and not yet answered — or the exit code to stop on, its reason
 * already printed.
 *
 * @param port where the stored request row is read
 * @returns the request and the exact bytes a receipt binds to, or an exit code
 */
export async function readUnansweredPlanRequest({
  home,
  port,
  requestId,
}: {
  home: string;
  port: FallbackRegisterPort;
  requestId: string;
}): Promise<ReadFallbackRequest<ClaudeFallbackPlanRequest> | number> {
  const stored = await port.readRequest({ home, requestId });
  if (stored.isErr()) {
    logger.error({ msg: `codex plan-fallback record: ${stored.error.message}` });
    return EXIT_ERROR;
  }
  const read = storedPlanRequest({ stored: stored.value });
  if (read.isErr()) {
    for (const problem of codexErrorLines({ error: read.error })) {
      logger.error({ msg: `codex plan-fallback record: ${problem}` });
    }
    return EXIT_ERROR;
  }
  if (read.value.answered) {
    logger.error({
      msg: `codex plan-fallback record: request ${requestId} already has a receipt — one request is one plan; prepare a new one`,
    });
    return EXIT_ERROR;
  }
  return read.value;
}

/**
 * Validate one answer against its stored request, refuse drift, and write the receipt once.
 *
 * @param answerFile the plan-output JSON the visible session wrote, outside the checkout
 * @param planner which visible session planned, as the flags and the ambient workspace attest
 * @param repo the checkout whose tree must still be the one `prepare` captured
 * @returns the process exit code
 */
export async function recordFallbackPlan({
  answerFile,
  home,
  json,
  planner,
  port,
  repo,
  requestId,
}: {
  answerFile: string;
  home: string;
  json: boolean;
  planner: VisibleClaudeReviewer;
  port: FallbackRegisterPort;
  repo: string;
  requestId: string;
}): Promise<number> {
  const read = await readUnansweredPlanRequest({ home, port, requestId });
  if (typeof read === "number") {
    return read;
  }
  const answer = readFallbackAnswerFile({ path: answerFile, verb: "codex plan-fallback record" });
  if (typeof answer === "number") {
    return answer;
  }
  const now = captureTreeFingerprint({ cwd: repo });
  if (now.isErr()) {
    logger.error({ msg: `codex plan-fallback record: could not fingerprint the tree: ${now.error.message}` });
    return EXIT_ERROR;
  }
  const receipt = validateFallbackPlan({
    answer,
    completedAtIso: new Date().toISOString(),
    now: now.value,
    planner,
    receiptId: randomUUID(),
    request: read.request,
    requestBytes: read.bytes,
  });
  if (receipt.isErr()) {
    for (const problem of receipt.error) {
      logger.error({ msg: `codex plan-fallback record: REFUSED — ${problem}` });
    }
    return EXIT_ERROR;
  }
  return persistPlanReceipt({ home, json, port, receipt: receipt.value });
}

/** Write the receipt row, exactly once, and say where it landed. */
async function persistPlanReceipt({
  home,
  json,
  port,
  receipt,
}: {
  home: string;
  json: boolean;
  port: FallbackRegisterPort;
  receipt: ClaudeFallbackPlanReceipt;
}): Promise<number> {
  const written = await port.writeReceipt({
    home,
    receiptText: fallbackReceiptText({ receipt }),
    requestId: receipt.requestId,
  });
  if (written.isErr()) {
    logger.error({ msg: `codex plan-fallback record: ${written.error.message}` });
    return EXIT_ERROR;
  }
  const where = storedReceiptLabel({ requestId: receipt.requestId });
  if (json) {
    logger.out({ line: JSON.stringify({ receipt, stored: where }) });
    return EXIT_OK;
  }
  logger.out({
    line: `recorded fallback plan ${receipt.receiptId}: ${receipt.request.pass} ${receipt.answer.verdict}`,
  });
  logger.out({ line: `  receipt: ${where}` });
  logger.out({
    line: "  It is a plan row in `codex status` now, marked [claude-code]. It counts once the work moves the tree past it.",
  });
  return EXIT_OK;
}
