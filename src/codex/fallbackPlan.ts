/**
 * The Claude fallback PLAN — what the rule-9 plan floor accepts when Codex is CAPPED, or when the install
 * registered no Codex plan at all (`./providerUnregistered.ts`, a ground that is never cap evidence).
 *
 * ## The defect this closes
 *
 * The plan floor wants one conclusive, STALE `READY` planning pass: a plan read on a tree the work has since
 * moved past. Until this existed every planning row was a Codex pass, so while Codex sat capped no branch
 * could ever carry one. The rule is that nothing waits on Codex, and the review half has a visible
 * Claude substitute (`./fallbackReview.ts`); the plan half only ever rode a `codex-loop-incomplete`
 * acknowledgement, which made gold unearnable for every landing under the cap — 38 of them in one day, with
 * one gold-owed row between them. The plan half therefore gets a visible Claude substitute run before the work
 * while capped.
 *
 * ## Why this proves order where a plan written at landing time does not
 *
 * A request freezes the tree it was prepared over, and `record` REFUSES unless the checkout is still exactly
 * that tree — the plan is on the record before a single edit lands. The work then moves the tree, the row
 * goes STALE, and `loopFailures` (`./ledger.ts`) accepts it by the rule it already applies to a Codex plan.
 * A plan prepared and recorded after the work is CURRENT at landing and satisfies nothing, which is the same
 * post-hoc refusal a Codex plan gets. The one bypass the Codex path has — plan post-hoc, make one more edit —
 * survives here identically, as a deliberate act with a record of it.
 *
 * ## What it does not do
 *
 * It is not an independent second brain: the session that plans is the model that then writes the code, so
 * it will catch less than Codex would. The ORDER property is what the floor checks, and that is preserved.
 * A `BLOCKED` fallback plan blocks exactly as a Codex one does. The provider field is an attestation, not a
 * proof, for the reasons `./fallbackReview.ts` gives.
 *
 * Pure. Every function here takes values and returns values; `./fallbackPort.ts` is the store, one request
 * row per request for every kind, told apart by the request's `mode` — a mode a build has no parser for is
 * FOREIGN, skipped rather than counted unreadable, per `./fallbackDocuments.ts`'s § A kind this build does not
 * know.
 */

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { type CodexError, CodexErrors, codexErrorLines } from "./errors.js";
import {
  type FallbackPlanGround,
  isFallbackPlanDocument,
  parsePlanGround,
  planFallbackGround,
  planGroundLine,
} from "./fallbackPlanGround.js";
import {
  type ClaudeFallbackReviewReceipt,
  fallbackDocumentSha256,
  fallbackReviewEntries,
  fallbackTreeDrift,
  type VisibleClaudeReviewer,
} from "./fallbackReview.js";
import { notAnObject, parseFallbackTree, parseVisibleClaudeSession } from "./fallbackReviewParse.js";
import type { TreeFingerprint } from "./fingerprint.js";
import { type LedgerEntry, treeFreshness } from "./ledger.js";
import { originRepositoryField } from "./originBinding.js";
import { parsePlanAnswer } from "./output.js";
import { CODEX_UNREGISTERED_PLAN_MODE } from "./providerUnregistered.js";
import type { CodexPassTree, PlanAnswer, PlanPassId } from "./types.js";

/** The fields every plan request carries, whatever grounded going to Claude. */
interface FallbackPlanRequestCore {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly createdAtIso: string;
  /** The checkout the plan is about — the grain the ledger is keyed at. */
  readonly repoRoot: string;
  /** That checkout's `origin` as `owner/name`, read at prepare time (`./originBinding.ts`); absent on older requests. */
  readonly originRepository?: string;
  /** The tree the plan was prepared over. `record` refuses any other; the work then makes it STALE. */
  readonly tree: CodexPassTree;
  /** Which planning slot this stands in for. */
  readonly pass: PlanPassId;
  /** sha256 of the task text, so a reader can tell which question was planned. */
  readonly taskSha256: string;
  /** The exact prompt a Codex pass would have read, by digest; the bytes are the packet beside the request. */
  readonly promptSha256: string;
  readonly promptBytes: number;
}

/**
 * Everything a visible Claude session needs to write ONE plan, frozen before the work starts. Its `mode` is the
 * discriminator the store reads — `plan` on a capacity ground, the unregistered plan mode when no Codex plan is
 * registered (`./fallbackPlanGround.ts`); a review request carries none, and any OTHER mode is a kind the
 * reading build does not know.
 */
export type ClaudeFallbackPlanRequest = FallbackPlanRequestCore & FallbackPlanGround;

/** The record that a fallback plan was written, bound to the request it answers. */
export interface ClaudeFallbackPlanReceipt {
  readonly schemaVersion: 1;
  readonly receiptId: string;
  readonly requestId: string;
  /** sha256 of the request file's exact bytes, so a request edited after the fact no longer matches. */
  readonly requestSha256: string;
  /** The request, embedded, so the ledger can fold a receipt without a second read. */
  readonly request: ClaudeFallbackPlanRequest;
  readonly answer: PlanAnswer;
  readonly planner: VisibleClaudeReviewer;
  readonly completedAtIso: string;
}

/**
 * Validate a plan answer against its request and bind the two into a receipt.
 *
 * The answer goes through the SAME validator a Codex plan's response does, so a `BLOCKED` naming no blocker
 * or an empty body is refused exactly as it would be from Codex. The tree check is what makes this a plan
 * rather than a post-hoc note: recording is refused once the checkout has moved off the prepared tree.
 *
 * @param requestBytes the request file's exact bytes, so the receipt can bind to them by digest
 * @param answer the raw answer document — the plan-output JSON a Codex pass would have returned
 * @param now the tree at recording time, refused unless it is still the request's tree
 * @returns the receipt, or every reason it could not be made
 */
export function validateFallbackPlan({
  request,
  requestBytes,
  answer,
  planner,
  now,
  receiptId,
  completedAtIso,
}: {
  request: ClaudeFallbackPlanRequest;
  requestBytes: string;
  answer: string;
  planner: VisibleClaudeReviewer;
  now: TreeFingerprint;
  receiptId: string;
  completedAtIso: string;
}): Result<ClaudeFallbackPlanReceipt> {
  const errors: string[] = [];
  const drift = fallbackTreeDrift({ now, request });
  if (drift !== undefined) {
    errors.push(
      `${drift}; a plan is recorded BEFORE the work, so prepare a new request over the tree you have — ` +
        "and if the work has already begun, no plan recorded now can show it came first",
    );
  }
  const parsed = parsePlanAnswer({ response: answer });
  if (parsed.isErr()) {
    errors.push(...parsed.error);
  }
  if (errors.length > 0 || parsed.isErr()) {
    return err(errors);
  }
  return ok({
    answer: parsed.value,
    completedAtIso,
    planner,
    receiptId,
    request,
    requestId: request.requestId,
    requestSha256: fallbackDocumentSha256({ bytes: requestBytes }),
    schemaVersion: 1,
  });
}

/**
 * Why a plan receipt read off disk cannot be trusted to speak for its request, or `undefined` when it can.
 *
 * @param receipt the receipt as read
 * @param requestBytes the request file's exact bytes, as read beside it
 * @returns the reason, or `undefined`
 */
export function planReceiptBindingFailure({
  receipt,
  requestBytes,
}: {
  receipt: ClaudeFallbackPlanReceipt;
  requestBytes: string;
}): string | undefined {
  if (receipt.requestSha256 !== fallbackDocumentSha256({ bytes: requestBytes })) {
    return `plan receipt ${receipt.receiptId} binds to request bytes that no longer match ${receipt.requestId}`;
  }
  if (receipt.request.requestId !== receipt.requestId) {
    return `plan receipt ${receipt.receiptId} embeds request ${receipt.request.requestId} but claims ${receipt.requestId}`;
  }
  return undefined;
}

/**
 * Fold plan receipts into ledger rows for ONE checkout's branch — the same filter and freshness rule a Codex
 * plan record gets.
 *
 * @param receipts every plan receipt that read and bound
 * @param repoRoot the checkout the query is about
 * @param now the current tree fingerprint, or `undefined` when it could not be captured
 * @returns the matching rows, newest first
 */
export function fallbackPlanEntries({
  receipts,
  repoRoot,
  branch,
  now,
}: {
  receipts: readonly ClaudeFallbackPlanReceipt[];
  repoRoot: string;
  branch: string;
  now: TreeFingerprint | undefined;
}): readonly LedgerEntry[] {
  return receipts
    .filter((receipt) => receipt.request.repoRoot === repoRoot && receipt.request.tree.branch === branch)
    .map((receipt): LedgerEntry => ({
      artifactId: receipt.receiptId,
      capped: false,
      createdAtIso: receipt.completedAtIso,
      diffSha256: undefined,
      fallbackGround: planFallbackGround({ request: receipt.request }),
      freshness: treeFreshness({ now, tree: receipt.request.tree }),
      mode: "plan",
      outcomeContext: `Claude fallback plan${receipt.planner.workspace === null ? "" : ` in ${receipt.planner.workspace}`} — ${planGroundLine({ request: receipt.request })}`,
      pass: receipt.request.pass,
      propertyId: undefined,
      provider: "claude-code",
      reviewSummary: undefined,
      superseded: undefined,
      verdict: receipt.answer.verdict,
    }))
    .toSorted((a, b) => b.createdAtIso.localeCompare(a.createdAtIso) || b.artifactId.localeCompare(a.artifactId));
}

/**
 * Every Claude fallback row for one checkout's branch — reviews and plans together.
 *
 * The one call the status report, both landing verbs and `codex supersede` make, so none of them can fold
 * one kind of receipt and forget the other.
 *
 * @param scan the bound receipts of both kinds, as `scanFallbackReceipts` returns them
 * @param repoRoot the checkout the query is about
 * @param now the current tree fingerprint, or `undefined` when it could not be captured
 * @returns the rows, reviews then plans; `ledgerForBranch` orders the merged list
 */
export function fallbackLedgerEntries({
  scan,
  repoRoot,
  branch,
  now,
}: {
  scan: {
    readonly receipts: readonly ClaudeFallbackReviewReceipt[];
    readonly planReceipts: readonly ClaudeFallbackPlanReceipt[];
  };
  repoRoot: string;
  branch: string;
  now: TreeFingerprint | undefined;
}): readonly LedgerEntry[] {
  return [
    ...fallbackReviewEntries({ branch, now, receipts: scan.receipts, repoRoot }),
    ...fallbackPlanEntries({ branch, now, receipts: scan.planReceipts, repoRoot }),
  ];
}

/** The plan passes a request may stand in for. */
const PLAN_PASSES: ReadonlySet<string> = new Set<PlanPassId>(["p1", "p2", "p3"]);

/** Narrow a value to a plan pass id. A predicate, so TS1230 rules out destructuring. */
function isPlanPassId(value: unknown): value is PlanPassId {
  return typeof value === "string" && PLAN_PASSES.has(value);
}

/** The request's flat fields, or every reason one is missing. */
function parsePlanRequestScalars({
  value,
}: {
  value: Record<string, unknown>;
}): Result<Omit<FallbackPlanRequestCore, "schemaVersion" | "tree">, CodexError> {
  const errors: string[] = [];
  const text = ({ key }: { key: string }): string | undefined => {
    const field = value[key];
    return typeof field === "string" ? field : undefined;
  };
  const createdAtIso = text({ key: "createdAtIso" });
  const promptSha256 = text({ key: "promptSha256" });
  const repoRoot = text({ key: "repoRoot" });
  const requestId = text({ key: "requestId" });
  const taskSha256 = text({ key: "taskSha256" });
  const pass = value["pass"];
  const promptBytes = value["promptBytes"];
  if (value["schemaVersion"] !== 1 || !isFallbackPlanDocument({ value })) {
    errors.push(`schemaVersion must be 1 and mode must be "plan" or "${CODEX_UNREGISTERED_PLAN_MODE}"`);
  }
  for (const [key, present] of Object.entries({ createdAtIso, promptSha256, repoRoot, requestId, taskSha256 })) {
    if (present === undefined) {
      errors.push(`${key} must be a string`);
    }
  }
  if (!isPlanPassId(pass)) {
    errors.push("pass must be p1, p2 or p3");
  }
  if (typeof promptBytes !== "number" || !Number.isFinite(promptBytes)) {
    errors.push("promptBytes must be a number");
  }
  if (
    errors.length > 0 ||
    createdAtIso === undefined ||
    promptSha256 === undefined ||
    repoRoot === undefined ||
    requestId === undefined ||
    taskSha256 === undefined ||
    !isPlanPassId(pass) ||
    typeof promptBytes !== "number"
  ) {
    return err(CodexErrors.documentInvalid({ reasons: errors }));
  }
  return ok({
    createdAtIso,
    // Validated as `owner/name`; a malformed value reads as absent, never as a binding (`./originBinding.ts`).
    ...originRepositoryField({ value: value["originRepository"] }),
    pass,
    promptBytes,
    promptSha256,
    repoRoot,
    requestId,
    taskSha256,
  });
}

/**
 * Decode a plan request off disk, refusing any shape a receipt could not honestly bind to.
 *
 * @param value the parsed JSON
 * @returns the request, or every reason it is not one
 */
export function parseFallbackPlanRequest({ value }: { value: unknown }): Result<ClaudeFallbackPlanRequest, CodexError> {
  if (!isRecord(value)) {
    return notAnObject({ field: "request" });
  }
  const scalars = parsePlanRequestScalars({ value });
  const tree = parseFallbackTree({ value: value["tree"] });
  const ground = parsePlanGround({ value });
  const errors = [
    ...(scalars.isErr() ? codexErrorLines({ error: scalars.error }) : []),
    ...(tree.isErr() ? codexErrorLines({ error: tree.error }) : []),
    ...(ground.isErr() ? codexErrorLines({ error: ground.error }) : []),
  ];
  if (errors.length > 0 || scalars.isErr() || tree.isErr() || ground.isErr()) {
    return err(CodexErrors.documentInvalid({ reasons: errors }));
  }
  return ok({ ...scalars.value, ...ground.value, schemaVersion: 1, tree: tree.value });
}

/**
 * Decode a plan receipt off disk. Shape only — binding is {@link planReceiptBindingFailure}.
 *
 * @param value the parsed JSON
 * @returns the receipt, or every reason it is not one
 */
export function parseFallbackPlanReceipt({ value }: { value: unknown }): Result<ClaudeFallbackPlanReceipt, CodexError> {
  if (!isRecord(value)) {
    return notAnObject({ field: "receipt" });
  }
  const errors: string[] = [];
  const ids = {
    completedAtIso: value["completedAtIso"],
    receiptId: value["receiptId"],
    requestId: value["requestId"],
    requestSha256: value["requestSha256"],
  };
  if (value["schemaVersion"] !== 1) {
    errors.push("schemaVersion must be 1");
  }
  for (const [key, present] of Object.entries(ids)) {
    if (typeof present !== "string") {
      errors.push(`${key} must be a string`);
    }
  }
  const request = parseFallbackPlanRequest({ value: value["request"] });
  if (request.isErr()) {
    errors.push(...codexErrorLines({ error: request.error }).map((reason) => `request: ${reason}`));
  }
  const planner = parseVisibleClaudeSession({ value: value["planner"] });
  if (planner.isErr()) {
    errors.push(...codexErrorLines({ error: planner.error }).map((reason) => `planner: ${reason}`));
  }
  // Round-trip through the plan-output validator so a hand-written BLOCKED with no blockers is refused at
  // read time exactly as it would have been at record time.
  const answer = parsePlanAnswer({ response: JSON.stringify(value["answer"]) });
  if (answer.isErr()) {
    errors.push(...answer.error.map((reason) => `answer: ${reason}`));
  }
  const { completedAtIso, receiptId, requestId, requestSha256 } = ids;
  if (
    errors.length > 0 ||
    typeof completedAtIso !== "string" ||
    typeof receiptId !== "string" ||
    typeof requestId !== "string" ||
    typeof requestSha256 !== "string" ||
    request.isErr() ||
    planner.isErr() ||
    answer.isErr()
  ) {
    return err(CodexErrors.documentInvalid({ reasons: errors }));
  }
  return ok({
    answer: answer.value,
    completedAtIso,
    planner: planner.value,
    receiptId,
    request: request.value,
    requestId,
    requestSha256,
    schemaVersion: 1,
  });
}
