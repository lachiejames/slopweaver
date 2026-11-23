/**
 * The Claude fallback review — what the rule-9 review floor accepts when Codex is CAPPED or unregistered.
 *
 * ## The defect this closes
 *
 * `codex status --check`, `github enqueue` and `github merge --admin` all require one CURRENT, conclusive
 * review pass before a landing. Every one of those reviews was a Codex pass, so the moment Codex reported a
 * workspace spend cap the floor became unmeetable: a branch with eight review rounds behind it could not land,
 * and the only ways through were the `unreviewed` hatch or a door acknowledgement — both of which describe
 * reviewed work as an EXCEPTION. The rule for a capped Codex is that a visible Claude session takes the review pass instead. This module is
 * that rule as a mechanism.
 *
 * ## The shape, and why it is a RECEIPT rather than an if-capped-skip
 *
 * A bare `if (capped) return []` would make a cap itself satisfy the review floor, so a capped account would
 * land unreviewed code with nothing on the record. The floor needs EVIDENCE that a review happened, which is
 * two immutable documents:
 *
 * - a {@link ClaudeFallbackReviewRequest}, written by `codex review-fallback prepare` BEFORE the review: the
 *   exact diff under review (by digest, and as a packet on disk), the tree it was cut from, the single
 *   property the review must answer, and the ground that justified going to Claude at all — a cap, a
 *   review Codex refused on policy twice (`./policyFallback.ts`), or an adopted register naming no Codex plan
 *   (`./providerUnregistered.ts`, never read as a cap); and
 * - a {@link ClaudeFallbackReviewReceipt}, written by `codex review-fallback record` AFTER it: the request it
 *   answers (by id AND by digest of the request's own bytes), the property-shaped answer, and which visible
 *   session gave it.
 *
 * A receipt folds into the ledger as a review row with `provider: "claude-code"`, judged by the SAME
 * freshness rule as a Codex row — the tree it describes must be the tree being landed — and the SAME verdict
 * rule: a current `BROKEN` from either provider still vetoes. The provider field is an attestation, not a
 * proof: nothing here can establish that a model rather than a hand wrote the answer, and nothing in the
 * Codex path can either. What the shape guarantees is that a fallback review is EXACTLY as visible and
 * exactly as checkable as a Codex one, and that a cap on its own is never a clean result.
 *
 * ## The ground is captured at preparation time
 *
 * On the cap ground `prepare` refuses unless Codex is closed RIGHT NOW, and writes what it saw into the
 * request. A later quota recovery does not erase a legitimately completed fallback review — the review
 * happened, over this diff, and that is what the floor asks about. On the refusal ground (`--after-refusal`)
 * it refuses unless the named pass record is this same review, refused on policy on its initial attempt AND
 * its one retry.
 *
 * ## The plan half has its own receipt, taken BEFORE the work
 *
 * A cap is not a plan either, and a review receipt never stands in for one. The plan half's substitute is
 * `./fallbackPlan.ts` — the same request/receipt pair, recorded over the tree the work has not yet touched,
 * so the row goes STALE exactly as a Codex plan does once the work lands on top of it. The parsers for the
 * tree, the cap evidence and the visible session (`./fallbackReviewParse.ts`) are shared with it, so the two
 * receipts cannot disagree about what any of those are.
 *
 * Pure. Every function here takes values and returns values; `./fallbackPort.ts` is the store.
 */

import { createHash } from "node:crypto";

import { parseJson } from "#lib/jsonParse.js";
import { err, ok, type Result } from "#lib/result.js";
import { stableStringify } from "#lib/stableStringify.js";
import { parseFallbackRequest } from "./fallbackReviewParse.js";
import type { TreeFingerprint } from "./fingerprint.js";
import { type FallbackGroundKind, type LedgerEntry, treeFreshness } from "./ledger.js";
import { parseReviewAnswer } from "./output.js";
import { POLICY_REFUSAL_REVIEW_MODE, type PolicyRefusalEvidence } from "./policyFallback.js";
import {
  CODEX_UNREGISTERED_GROUND,
  CODEX_UNREGISTERED_REVIEW_MODE,
  type CodexProviderUnregisteredEvidence,
  providerUnregisteredLine,
} from "./providerUnregistered.js";
import type { CodexPassTree, ReviewAnswer, ReviewPassId, ReviewProperty } from "./types.js";

/**
 * What `prepare` saw that justified going to Claude — a provider cap, or the fleet held at the routing pause.
 *
 * Structured rather than a sentence so a reader of the request can tell a member usage cap from an exhausted
 * window from a spent balance, and so a receipt written against a cap that was never real is findable later.
 * The field keeps its `capEvidence` name on disk, so no request or receipt changes schema.
 */
export interface FallbackCapEvidence {
  /**
   * Why Codex could not take the pass: the fleet's own verdict (`./fleetCap.ts`'s `why`) naming every refusing
   * destination, or its routing-pause sentence naming every excluded one.
   */
  readonly blockedBy: string;
  /** The freshest refusal's or near-cap reading's own instant — when it was OBSERVED, never when `prepare` ran. */
  readonly observedAtIso: string;
  /**
   * `rate_limit_reached_type` verbatim, or null. A fleet cap records null: its evidence is merged from a
   * cache, a log and a live answer, so no one rollout event's reached type can be named for it.
   */
  readonly reachedType: string | null;
  /** The `limit_id` the reading was about, or null when the event named none. */
  readonly limitId: string | null;
}

/** The fields every fallback review request carries, whatever grounded going to Claude. */
export interface FallbackReviewRequestCore {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly createdAtIso: string;
  /** The checkout the review is about — the grain the ledger is keyed at, exactly as a pass record's is. */
  readonly repoRoot: string;
  /** The tree the diff was cut from. Compared against the tree being landed, like a pass record's `tree`. */
  readonly tree: CodexPassTree;
  /** Which review slot this stands in for. */
  readonly pass: ReviewPassId;
  /** The ONE falsifiable claim the review must answer. */
  readonly property: ReviewProperty;
  readonly baseRef: string;
  readonly baseSha: string;
  readonly headSha: string;
  /** The exact diff under review, by digest; the bytes are the packet beside the request on disk. */
  readonly diffSha256: string;
  readonly diffBytes: number;
}

/**
 * What grounded going to Claude: a cap (no `mode`), a review Codex refused on policy twice, or no Codex plan
 * registered at all (`./providerUnregistered.ts`). Each non-cap arm declares a mode an older build reads as FOREIGN.
 */
export type FallbackReviewGround =
  | { readonly mode?: undefined; readonly capEvidence: FallbackCapEvidence }
  | { readonly mode: typeof POLICY_REFUSAL_REVIEW_MODE; readonly ground: PolicyRefusalEvidence }
  | { readonly mode: typeof CODEX_UNREGISTERED_REVIEW_MODE; readonly ground: CodexProviderUnregisteredEvidence };

/**
 * Everything a visible Claude session needs to perform ONE review, frozen before it starts, and the ground
 * that justified going to Claude: a cap (no `mode`, the shape every request had before the refusal ground), or
 * a review Codex refused on policy twice (`mode: "review-policy-refusal"`, see `./policyFallback.ts`). The
 * refusal arm declares a mode so a build that predates it counts it FOREIGN rather than misreading it.
 */
export type ClaudeFallbackReviewRequest = FallbackReviewRequestCore & FallbackReviewGround;

/**
 * The one clause naming why this review went to Claude — the cap in the gauge's words, or the refused pass.
 *
 * @returns the ground, as a reader of the ledger or of `prepare`'s output sees it
 */
export function fallbackGroundLine({ request }: { request: ClaudeFallbackReviewRequest }): string {
  if (request.mode === POLICY_REFUSAL_REVIEW_MODE) {
    return `Codex refused this review on policy twice (pass ${request.ground.artifactId})`;
  }
  if (request.mode === CODEX_UNREGISTERED_REVIEW_MODE) {
    return providerUnregisteredLine({ evidence: request.ground });
  }
  return fallbackCapLine({ evidence: request.capEvidence });
}

/**
 * Which ground a review request stood on, as the ledger row names it.
 *
 * @returns `cap` for a capacity ground, `cyber-policy` for a twice-refused pass, `codex-provider-unregistered` for none registered
 */
function reviewFallbackGround({ request }: { request: ClaudeFallbackReviewRequest }): FallbackGroundKind {
  if (request.mode === POLICY_REFUSAL_REVIEW_MODE) {
    return "cyber-policy";
  }
  if (request.mode === CODEX_UNREGISTERED_REVIEW_MODE) {
    return CODEX_UNREGISTERED_GROUND;
  }
  return "cap";
}

/**
 * The capacity ground of a fallback as one clause, worded so it is true of BOTH grounds `./fallbackCap.ts`
 * licenses — a provider cap and the routing pause. "Codex was capped" was false over a pause; the
 * `blockedBy` sentence underneath says which ground it was.
 *
 * @returns `Codex could not take the pass: <blockedBy>`
 */
export function fallbackCapLine({ evidence }: { evidence: FallbackCapEvidence }): string {
  return `Codex could not take the pass: ${evidence.blockedBy}`;
}

/** Which visible session answered. An attestation the recording session makes about itself. */
export interface VisibleClaudeReviewer {
  readonly host: "claude-code";
  /** The cmux workspace the session ran in, or null when it was not in one — visible on the sidebar either way. */
  readonly workspace: string | null;
  /** The model the session reports itself as, or null when it did not say. */
  readonly model: string | null;
}

/** The record that a fallback review was completed, bound to the request it answers. */
export interface ClaudeFallbackReviewReceipt {
  readonly schemaVersion: 1;
  readonly receiptId: string;
  readonly requestId: string;
  /** sha256 of the request file's exact bytes, so a request edited after the fact no longer matches its receipt. */
  readonly requestSha256: string;
  /** The request, embedded, so the ledger can fold a receipt without a second read. */
  readonly request: ClaudeFallbackReviewRequest;
  readonly answer: ReviewAnswer;
  readonly reviewer: VisibleClaudeReviewer;
  readonly completedAtIso: string;
}

/**
 * Digest a document's exact bytes. The one hash function both the writer and the validator use.
 *
 * @returns the lowercase hex sha256
 */
export function fallbackDocumentSha256({ bytes }: { bytes: string }): string {
  return createHash("sha256").update(bytes, "utf8").digest("hex");
}

/**
 * Whether the checkout, right now, is still the tree the request was cut from.
 *
 * Both HEAD and the fingerprint, deliberately. HEAD alone misses a dirty tree on the same commit; the
 * fingerprint alone would let two different commits with byte-identical trees pass, which is fine for a
 * verdict but not for a receipt that names a head commit. The fan-out defect `docs/doctrine-rationale/rule-9.md`
 * records — a queued property capturing a newer tree than its supplied diff — cannot recur here, because the
 * request captures diff and tree together and this check refuses to record over any other tree.
 *
 * @param request the frozen request — a review's or a plan's, since only the tree it captured is compared
 * @param now the tree as it stands at recording time
 * @returns the reason the tree no longer matches, or `undefined` when it does
 */
export function fallbackTreeDrift({
  request,
  now,
}: {
  request: { readonly tree: CodexPassTree };
  now: TreeFingerprint;
}): string | undefined {
  if (request.tree.headSha !== now.headSha) {
    return `the request was prepared at HEAD ${request.tree.headSha} and the checkout is now at ${now.headSha}`;
  }
  if (request.tree.fingerprint !== now.digest) {
    return "the working tree changed after the request was prepared — the packet no longer describes this checkout";
  }
  return undefined;
}

/**
 * Validate an answer against its request and bind the two into a receipt.
 *
 * The answer is parsed by the SAME validator a Codex review's response goes through, against the SAME
 * property — so a fallback answer that names a different property, or a `BROKEN` with no counterexample, is
 * refused exactly as a Codex one would be. That is the whole basis for treating the two rows alike downstream.
 *
 * @param request the frozen request being answered
 * @param requestBytes the request file's exact bytes, so the receipt can bind to them by digest
 * @param answer the raw answer document — the review-output JSON a Codex pass would have returned
 * @param reviewer which visible session answered
 * @param now the tree at recording time, refused unless it is still the request's tree
 * @param receiptId the id to mint the receipt under
 * @param completedAtIso when the review finished
 * @returns the receipt, or every reason it could not be made
 */
export function validateFallbackReview({
  request,
  requestBytes,
  answer,
  reviewer,
  now,
  receiptId,
  completedAtIso,
}: {
  request: ClaudeFallbackReviewRequest;
  requestBytes: string;
  answer: string;
  reviewer: VisibleClaudeReviewer;
  now: TreeFingerprint;
  receiptId: string;
  completedAtIso: string;
}): Result<ClaudeFallbackReviewReceipt> {
  const errors: string[] = [];
  const drift = fallbackTreeDrift({ now, request });
  if (drift !== undefined) {
    errors.push(`${drift}; prepare a new request over the tree you actually have`);
  }
  const parsed = parseReviewAnswer({ property: request.property, response: answer });
  if (parsed.isErr()) {
    errors.push(...parsed.error);
  }
  if (errors.length > 0 || parsed.isErr()) {
    return err(errors);
  }
  return ok({
    answer: parsed.value,
    completedAtIso,
    receiptId,
    request,
    requestId: request.requestId,
    requestSha256: fallbackDocumentSha256({ bytes: requestBytes }),
    reviewer,
    schemaVersion: 1,
  });
}

/**
 * Why a receipt read off disk cannot be trusted to speak for its request, or `undefined` when it can.
 *
 * A receipt is only evidence when it still binds to the request bytes beside it: an edited request, or a
 * receipt whose embedded copy disagrees with the file, is doc rot at best and forgery at worst, and either
 * way it satisfies nothing. The ledger fold below treats an unbound receipt as unreadable rather than as a
 * row, because a row that reads CLEAN over an edited question is the exact overclaim the floor refuses.
 *
 * @param receipt the receipt as read
 * @param requestBytes the request file's exact bytes, as read beside it
 * @returns the reason, or `undefined`
 */
export function receiptBindingFailure({
  receipt,
  requestBytes,
}: {
  receipt: ClaudeFallbackReviewReceipt;
  requestBytes: string;
}): string | undefined {
  if (receipt.requestSha256 !== fallbackDocumentSha256({ bytes: requestBytes })) {
    return `receipt ${receipt.receiptId} binds to request bytes that no longer match ${receipt.requestId}`;
  }
  if (receipt.request.requestId !== receipt.requestId) {
    return `receipt ${receipt.receiptId} embeds request ${receipt.request.requestId} but claims ${receipt.requestId}`;
  }
  const onDisk = parseJson({ text: requestBytes }).andThen((value) => parseFallbackRequest({ value }));
  if (onDisk.isErr()) {
    return `receipt ${receipt.receiptId} binds to request ${receipt.requestId}, which does not parse`;
  }
  if (stableStringify({ value: onDisk.value }) !== stableStringify({ value: receipt.request })) {
    return `receipt ${receipt.receiptId} embeds a copy of ${receipt.requestId} that disagrees with the request file`;
  }
  if (receipt.answer.propertyId !== receipt.request.property.id) {
    return `receipt ${receipt.receiptId} answers ${receipt.answer.propertyId} but its request asked ${receipt.request.property.id}`;
  }
  return undefined;
}

/**
 * Fold receipts into ledger rows for ONE checkout's branch.
 *
 * The same filter `ledgerForBranch` applies to pass records — this checkout, this branch — and the same
 * freshness rule. A receipt for another checkout or another branch is simply not a row here; it is not an
 * error, because the receipt is true about the checkout it names.
 *
 * @param receipts every receipt that read and bound
 * @param repoRoot the checkout the query is about
 * @param branch the branch to report on
 * @param now the current tree fingerprint, or `undefined` when it could not be captured
 * @returns the matching rows, newest first
 */
export function fallbackReviewEntries({
  receipts,
  repoRoot,
  branch,
  now,
}: {
  receipts: readonly ClaudeFallbackReviewReceipt[];
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
      diffSha256: receipt.request.diffSha256,
      fallbackGround: reviewFallbackGround({ request: receipt.request }),
      freshness: treeFreshness({ now, tree: receipt.request.tree }),
      mode: "review",
      outcomeContext: `Claude fallback review${receipt.reviewer.workspace === null ? "" : ` in ${receipt.reviewer.workspace}`} — ${fallbackGroundLine({ request: receipt.request })}`,
      pass: receipt.request.pass,
      propertyId: receipt.request.property.id,
      provider: "claude-code",
      reviewSummary: receipt.answer.summary,
      superseded: undefined,
      verdict: receipt.answer.verdict,
    }))
    .toSorted((a, b) => b.createdAtIso.localeCompare(a.createdAtIso) || b.artifactId.localeCompare(a.artifactId));
}
