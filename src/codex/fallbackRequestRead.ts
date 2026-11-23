/**
 * Turning one stored fallback request into the review or plan request a `record` verb answers — pure.
 *
 * The store (`./fallbackPort.ts`) answers which bytes exist; this module judges what they MEAN, with the same
 * parsers and kind checks the scan uses, so the bytes a receipt's digest binds to are exactly the stored text.
 */
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";
import { type CodexError, CodexErrors, codexErrorLines } from "./errors.js";
import { declaredMode, isReviewMode } from "./fallbackDocuments.js";
import { type ClaudeFallbackPlanRequest, parseFallbackPlanRequest } from "./fallbackPlan.js";
import { isFallbackPlanDocument } from "./fallbackPlanGround.js";
import type { StoredFallbackRequest } from "./fallbackPort.js";
import type { ClaudeFallbackReviewRequest } from "./fallbackReview.js";
import { parseFallbackRequest } from "./fallbackReviewParse.js";

/** A request as read, with the exact bytes a receipt binds to. */
export interface ReadFallbackRequest<Request> {
  readonly request: Request;
  readonly bytes: string;
  /** Whether a receipt row already stands for it. */
  readonly answered: boolean;
}

/** The stored request's parsed JSON, before either parser has judged its shape. */
function parsedRequest({ stored }: { stored: StoredFallbackRequest }): Result<unknown, CodexError> {
  try {
    return ok(safeJsonParse({ label: `fallback request ${stored.requestId}`, text: stored.requestText }));
  } catch (error: unknown) {
    return err(CodexErrors.requestNotJson({ cause: error, requestId: stored.requestId }));
  }
}

/**
 * The kind a mismatch names: `plan` or `review` for every mode this build parses, so a ground-specific mode is
 * never reported as one "this build has no parser for"; the raw mode only for a genuinely foreign one.
 */
function mismatchKind({ declared, value }: { declared: string; value: unknown }): string {
  if (isFallbackPlanDocument({ value })) {
    return "plan";
  }
  if (isReviewMode({ mode: declared })) {
    return "review";
  }
  return declared;
}

/**
 * Read one stored request as a REVIEW request. A plan or a kind with no parser here is refused by name.
 *
 * @param stored the request row as the store returned it
 * @returns the request with its bytes, or why it is not a readable review request
 */
export function storedReviewRequest({
  stored,
}: {
  stored: StoredFallbackRequest;
}): Result<ReadFallbackRequest<ClaudeFallbackReviewRequest>, CodexError> {
  const parsed = parsedRequest({ stored });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { requestId } = stored;
  // An explicit `mode: "review"` declares what the absence of one already means here, so it reads normally.
  const declared = declaredMode({ value: parsed.value });
  if (declared !== undefined && !isReviewMode({ mode: declared })) {
    return err(
      CodexErrors.requestKindMismatch({
        declared: mismatchKind({ declared, value: parsed.value }),
        requestId,
        wanted: "review",
      }),
    );
  }
  const request = parseFallbackRequest({ value: parsed.value });
  if (request.isErr()) {
    return err(
      CodexErrors.requestInvalid({ kind: "review", reasons: codexErrorLines({ error: request.error }), requestId }),
    );
  }
  return ok({ answered: stored.receiptRecorded, bytes: stored.requestText, request: request.value });
}

/**
 * Read one stored request as a PLAN request. A review request under that id is refused by the plan parser,
 * by name.
 *
 * @param stored the request row as the store returned it
 * @returns the request with its bytes, or why it is not a readable plan request
 */
export function storedPlanRequest({
  stored,
}: {
  stored: StoredFallbackRequest;
}): Result<ReadFallbackRequest<ClaudeFallbackPlanRequest>, CodexError> {
  const parsed = parsedRequest({ stored });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { requestId } = stored;
  // A review request (no `mode`) still falls to the plan parser, which already names the difference. Only a
  // kind with no parser here is short-circuited, because that parser's complaint would describe fields the
  // document was never meant to carry.
  const declared = declaredMode({ value: parsed.value });
  if (declared !== undefined && !isFallbackPlanDocument({ value: parsed.value })) {
    return err(
      CodexErrors.requestKindMismatch({
        declared: mismatchKind({ declared, value: parsed.value }),
        requestId,
        wanted: "plan",
      }),
    );
  }
  const request = parseFallbackPlanRequest({ value: parsed.value });
  if (request.isErr()) {
    return err(
      CodexErrors.requestInvalid({ kind: "plan", reasons: codexErrorLines({ error: request.error }), requestId }),
    );
  }
  return ok({ answered: stored.receiptRecorded, bytes: stored.requestText, request: request.value });
}

/**
 * The exact text a request is stored as — pretty JSON and a trailing newline, the shape `request.json` always
 * had, so a receipt written by any build binds to the same bytes.
 *
 * @param request the frozen request
 * @returns the text the request row holds
 */
export function fallbackRequestText({
  request,
}: {
  request: ClaudeFallbackReviewRequest | ClaudeFallbackPlanRequest;
}): string {
  return `${JSON.stringify(request, null, 2)}\n`;
}

/**
 * The exact text a receipt is stored as — the shape `receipt.json` always had.
 *
 * @param receipt the validated receipt
 * @returns the text the receipt row holds
 */
export function fallbackReceiptText({ receipt }: { receipt: unknown }): string {
  return `${JSON.stringify(receipt, null, 2)}\n`;
}
