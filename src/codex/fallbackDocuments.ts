/**
 * What one Claude fallback request and its receipt ARE, judged from their texts, and the scan every reader of
 * rule 9's fallback evidence folds them into.
 *
 * Pure: texts in, a classification out. The texts are the store's (`./fallbackPort.ts`) — the
 * `codex_fallback_request` and `codex_fallback_receipt` rows are the record, and the old
 * `$SLOPWEAVER_HOME/codex-fallback/` directory is only the one-time import's source. A scan reports what it
 * could not read rather than dropping it: a receipt that will not parse or no longer binds to its request is
 * not "no receipt" — it is an unreadable one, and the landing gate fails closed on that count
 * (`./landingGateRun.ts`) rather than judging the survivors.
 *
 * ## A kind this build does not know
 *
 * The store is shared by every worktree on a machine, so a request is written by whichever checkout is newest
 * and read by whichever is oldest. MEASURED: a commit added the plan kind, a
 * checkout holding it wrote a plan request, and a later
 * worktree that predated that commit read it through the review parser and reported it unreadable — which
 * `./scanReasons.ts`'s `incompleteScanReason` turns into a lost review floor on EVERY branch of that
 * install, permanently, because the record is append-only. Replaying that reader over the receipts of the
 * moment reports `{ bad: 2, ok: 305 }`, both failures plan receipts.
 *
 * So the scan classifies on the request's DECLARED mode into three, not two, and a mode this build has no
 * parser for is FOREIGN: counted, named, and excluded from `unreadable`, so it never fails the gate closed on
 * every branch. Every genuinely ambiguous case still reaches the review reader and still fails closed: an
 * absent `mode`, a `mode` that is not a string, and a request that is not JSON. `mode: "review"` reads as a
 * review too — no writer here emits one, and a later build that starts saying it out loud must not have its
 * reviews skipped by this one.
 *
 * Excluded from `unreadable` is not the same as harmless. A newer build may add a mode that IS a plan or a
 * review on another ground (`./providerUnregistered.ts` did), and its receipt can be the BLOCKED plan or BROKEN
 * review that outranks an older READY or CLEAN row this build can read. So an ANSWERED foreign request that
 * names its checkout and branch is kept as a {@link ForeignFallbackReceipt}, and `./scanReasons.ts` refuses to
 * judge THAT branch — one branch, never the install. A build older than that rule cannot apply it, which the
 * store's reader epoch fences (`../store/schema/codexFallback.ts` § "The reader epoch").
 */

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";
import { type CodexError, CodexErrors, codexErrorLines } from "./errors.js";
import { type ClaudeFallbackPlanReceipt, parseFallbackPlanReceipt, planReceiptBindingFailure } from "./fallbackPlan.js";
import { isFallbackPlanDocument } from "./fallbackPlanGround.js";
import { type ClaudeFallbackReviewReceipt, receiptBindingFailure } from "./fallbackReview.js";
import { parseFallbackReceipt } from "./fallbackReviewParse.js";
import { POLICY_REFUSAL_REVIEW_MODE } from "./policyFallback.js";
import { CODEX_UNREGISTERED_REVIEW_MODE } from "./providerUnregistered.js";

/** One request's documents as the store holds them: the exact texts a receipt's digest binds to. */
export interface FallbackDocuments {
  readonly requestId: string;
  readonly requestText: string;
  /** `null` when no receipt row was recorded — the request is pending. */
  readonly receiptText: string | null;
}

/** What one request turned out to be. */
type FallbackOutcome =
  | { readonly kind: "pending" }
  | { readonly kind: "pending-plan" }
  | { readonly kind: "bound"; readonly receipt: ClaudeFallbackReviewReceipt }
  | { readonly kind: "bound-plan"; readonly receipt: ClaudeFallbackPlanReceipt }
  | { readonly kind: "foreign"; readonly mode: string; readonly placed: ForeignFallbackReceipt | undefined }
  | { readonly kind: "unbound"; readonly placed: readonly UnboundFallbackReceipt[] }
  | { readonly kind: "unreadable"; readonly problems: readonly string[] };

/**
 * A receipt that parsed but no longer binds to its request's bytes, placed on every checkout and branch either
 * document names — the request as stored AND the copy the receipt embeds. It could be the one BROKEN review or
 * BLOCKED plan that decides THAT branch, so `./scanReasons.ts`'s `unboundReceiptScanReason` refuses to judge
 * it; it cannot decide a branch neither document names, so it no longer refuses every branch on the install.
 * Both places count because either document alone can be edited: a request rewritten to name another branch
 * still leaves the receipt's own copy naming the branch it answered. MEASURED: a home carried through a
 * name-rewriting sanitiser held four such receipts, all naming the old machine's checkout, and refused the
 * landing gate on every branch of the new one (`codex status --check`).
 */
interface UnboundFallbackReceipt {
  readonly requestId: string;
  readonly repoRoot: string;
  readonly branch: string;
  /** Why it does not bind, as the binding check said. */
  readonly problem: string;
}

/**
 * An ANSWERED request in a mode this build cannot read, placed on the checkout and branch it names. Its receipt
 * may be a BLOCKED plan or a BROKEN review this build cannot see, so `./scanReasons.ts`'s
 * `foreignReceiptScanReason` refuses to judge THAT branch rather than the survivors beside it.
 */
interface ForeignFallbackReceipt {
  readonly requestId: string;
  readonly mode: string;
  readonly repoRoot: string;
  readonly branch: string;
}

/**
 * Where a foreign request says it was prepared: its `repoRoot` and `tree.branch`, the provenance envelope
 * every fallback request carries whatever its mode. Read from the request's own bytes, the document its receipt
 * binds to, never from the store's best-effort filter columns.
 *
 * @param requestText the request as the store holds it
 * @returns the checkout and branch, or `undefined` for a detached HEAD or a document carrying neither
 */
function foreignPlacement({ requestText }: { requestText: string }): { repoRoot: string; branch: string } | undefined {
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: "fallback request", text: requestText });
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !isRecord(parsed["tree"])) {
    return undefined;
  }
  const repoRoot = parsed["repoRoot"];
  const branch = parsed["tree"]["branch"];
  if (typeof repoRoot !== "string" || repoRoot.length === 0 || typeof branch !== "string" || branch.length === 0) {
    return undefined;
  }
  return { branch, repoRoot };
}

/**
 * Place an unbound receipt on every checkout and branch its two documents name, or say it cannot be placed.
 *
 * @param documents the stored request and its id
 * @param embedded the request copy the receipt carries
 * @param problem why the receipt does not bind
 * @returns the unbound outcome when at least one place is named, else the install-wide unreadable outcome
 */
function placedUnbound({
  documents,
  embedded,
  problem,
}: {
  documents: FallbackDocuments;
  embedded: { readonly repoRoot: string; readonly tree: { readonly branch: string | null } };
  problem: string;
}): FallbackOutcome {
  const places = new Map<string, { repoRoot: string; branch: string }>();
  const stored = foreignPlacement({ requestText: documents.requestText });
  if (stored !== undefined) {
    places.set(`${stored.repoRoot}\u0000${stored.branch}`, stored);
  }
  const { branch } = embedded.tree;
  if (embedded.repoRoot.length > 0 && branch !== null && branch.length > 0) {
    places.set(`${embedded.repoRoot}\u0000${branch}`, { branch, repoRoot: embedded.repoRoot });
  }
  if (places.size === 0) {
    return { kind: "unreadable", problems: [problem] };
  }
  const placed = [...places.values()].map((place) => ({ ...place, problem, requestId: documents.requestId }));
  return { kind: "unbound", placed };
}

/** Which of the three kinds a request declares itself to be. */
type DeclaredKind =
  { readonly kind: "review" } | { readonly kind: "plan" } | { readonly kind: "foreign"; readonly mode: string };

/**
 * The `mode` a parsed request document declares, when it declares one as a string.
 *
 * @param value the parsed request
 * @returns the declared mode, or `undefined` when there is none or it is not a string
 */
export function declaredMode({ value }: { value: unknown }): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const mode = value["mode"];
  if (typeof mode !== "string") {
    return undefined;
  }
  return mode;
}

/**
 * Whether a declared mode is one a REVIEW request carries: none, an explicit `review`, or one of the two
 * non-cap grounds (`./policyFallback.ts`, `./providerUnregistered.ts`). The one list both the scan and the
 * `record` verb's reader (`./fallbackRequestRead.ts`) consult, so the two can never disagree about a review.
 *
 * @param mode the request's declared mode, `undefined` when it declares none as a string
 * @returns true when the review parser owns the document
 */
export function isReviewMode({ mode }: { mode: string | undefined }): boolean {
  return (
    mode === undefined ||
    mode === "review" ||
    mode === POLICY_REFUSAL_REVIEW_MODE ||
    mode === CODEX_UNREGISTERED_REVIEW_MODE
  );
}

/**
 * How a problem line names a stored receipt.
 *
 * @param requestId the request the receipt answers
 * @returns the label, naming the table and the key
 */
export function storedReceiptLabel({ requestId }: { requestId: string }): string {
  return `store codex_fallback_receipt ${requestId}`;
}

/**
 * What a request declares itself to be, from its `mode` alone.
 *
 * Every ambiguous shape answers `review`: a request that is not JSON, a `mode` that is absent (the review
 * discriminator), and a `mode` that is not a string (a corrupt discriminator is not a declaration). Only a
 * STRING naming a kind with no parser here is foreign — see the module header. An explicit `mode: "review"`
 * is the same declaration the absence makes, and the refusal mode is a review on another ground
 * (`./policyFallback.ts`).
 */
function declaredRequestKind({ requestText }: { requestText: string }): DeclaredKind {
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: "fallback request", text: requestText });
  } catch {
    return { kind: "review" };
  }
  if (isFallbackPlanDocument({ value: parsed })) {
    return { kind: "plan" };
  }
  const mode = declaredMode({ value: parsed });
  if (mode === undefined || isReviewMode({ mode })) {
    return { kind: "review" };
  }
  return { kind: "foreign", mode };
}

/** A receipt's parsed JSON, before any parser has judged the shape. */
function parsedReceipt({ label, receiptText }: { label: string; receiptText: string }): Result<unknown, CodexError> {
  try {
    return ok(safeJsonParse({ label, text: receiptText }));
  } catch (error: unknown) {
    return err(CodexErrors.documentNotJson({ cause: error, label }));
  }
}

/** A plan receipt, parsed and checked against its request's bytes. */
function boundPlanReceipt({
  documents,
  receiptText,
}: {
  documents: FallbackDocuments;
  receiptText: string;
}): FallbackOutcome {
  const label = storedReceiptLabel({ requestId: documents.requestId });
  const json = parsedReceipt({ label, receiptText });
  if (json.isErr()) {
    return { kind: "unreadable", problems: codexErrorLines({ error: json.error }) };
  }
  const parsed = parseFallbackPlanReceipt({ value: json.value });
  if (parsed.isErr()) {
    return {
      kind: "unreadable",
      problems: codexErrorLines({ error: parsed.error }).map((reason) => `${label}: ${reason}`),
    };
  }
  const unbound = planReceiptBindingFailure({ receipt: parsed.value, requestBytes: documents.requestText });
  if (unbound !== undefined) {
    return placedUnbound({ documents, embedded: parsed.value.request, problem: `${label}: ${unbound}` });
  }
  return { kind: "bound-plan", receipt: parsed.value };
}

/** A review receipt, parsed and checked against its request's bytes. */
function boundReviewReceipt({
  documents,
  receiptText,
}: {
  documents: FallbackDocuments;
  receiptText: string;
}): FallbackOutcome {
  const label = storedReceiptLabel({ requestId: documents.requestId });
  const json = parsedReceipt({ label, receiptText });
  if (json.isErr()) {
    return { kind: "unreadable", problems: codexErrorLines({ error: json.error }) };
  }
  const parsed = parseFallbackReceipt({ value: json.value });
  if (parsed.isErr()) {
    return {
      kind: "unreadable",
      problems: codexErrorLines({ error: parsed.error }).map((reason) => `${label}: ${reason}`),
    };
  }
  const unbound = receiptBindingFailure({ receipt: parsed.value, requestBytes: documents.requestText });
  if (unbound !== undefined) {
    return placedUnbound({ documents, embedded: parsed.value.request, problem: `${label}: ${unbound}` });
  }
  return { kind: "bound", receipt: parsed.value };
}

/**
 * Classify one request: awaiting its receipt, bound (either kind), a kind this build does not know, or
 * broken. The KIND is the request's `mode`, read from the request rather than the receipt, because the
 * request is the document the receipt binds to — a receipt cannot relabel what was asked.
 *
 * @param documents the request and receipt texts as the store holds them
 * @returns what the request is
 */
function classifyFallbackDocuments({ documents }: { documents: FallbackDocuments }): FallbackOutcome {
  const declared = declaredRequestKind({ requestText: documents.requestText });
  if (declared.kind === "foreign") {
    // Counted answered or not; only an ANSWERED one is placed, because only a receipt carries a verdict.
    const placed =
      documents.receiptText === null ? undefined : foreignPlacement({ requestText: documents.requestText });
    return {
      kind: "foreign",
      mode: declared.mode,
      placed: placed === undefined ? undefined : { ...placed, mode: declared.mode, requestId: documents.requestId },
    };
  }
  const { receiptText } = documents;
  const plan = declared.kind === "plan";
  if (receiptText === null) {
    return { kind: plan ? "pending-plan" : "pending" };
  }
  return plan ? boundPlanReceipt({ documents, receiptText }) : boundReviewReceipt({ documents, receiptText });
}

/** What a scan found, including what it could not read. */
export interface FallbackReceiptScan {
  /** Every REVIEW receipt that parsed AND still binds to its request's bytes. */
  readonly receipts: readonly ClaudeFallbackReviewReceipt[];
  /** Every PLAN receipt that parsed AND still binds to its request's bytes. */
  readonly planReceipts: readonly ClaudeFallbackPlanReceipt[];
  /**
   * Receipts that are present but will not parse or no longer bind to their request. Reported, never
   * dropped: the landing gate fails closed on this count (`./landingGateRun.ts`).
   */
  readonly unreadable: number;
  /** Why each unreadable one was, for the report. */
  readonly problems: readonly string[];
  /** Review requests prepared but not yet answered — not evidence, but a reader wants to see them. */
  readonly pending: number;
  /** Plan requests prepared but not yet answered. */
  readonly pendingPlans: number;
  /**
   * Requests declaring a kind this build has no parser for, answered or not. Deliberately NOT part of
   * `unreadable`: one must not fail the landing gate closed on EVERY branch. See the module header's § A kind
   * this build does not know.
   */
  readonly foreign: number;
  /** The distinct modes those requests declared, sorted — so a reader learns which build is ahead. */
  readonly foreignModes: readonly string[];
  /** The ANSWERED foreign requests that name a checkout and branch — the ones that refuse THAT branch. */
  readonly foreignReceipts: readonly ForeignFallbackReceipt[];
  /**
   * Receipts that no longer bind but name where they belong, one entry per place named — each refuses THAT
   * branch alone. Deliberately NOT part of `unreadable`; an unbound receipt naming nowhere still is.
   */
  readonly unboundReceipts: readonly UnboundFallbackReceipt[];
}

/**
 * Classify every stored request and count the outcomes into one scan.
 *
 * @param documents every request the store holds, each with its receipt's text when one was recorded
 * @returns the bound receipts of both kinds, plus what could not be read
 */
export function scanFallbackDocuments({ documents }: { documents: readonly FallbackDocuments[] }): FallbackReceiptScan {
  const receipts: ClaudeFallbackReviewReceipt[] = [];
  const planReceipts: ClaudeFallbackPlanReceipt[] = [];
  const problems: string[] = [];
  const foreignModes = new Set<string>();
  const foreignReceipts: ForeignFallbackReceipt[] = [];
  const unboundReceipts: UnboundFallbackReceipt[] = [];
  let pending = 0;
  let pendingPlans = 0;
  let foreign = 0;
  for (const one of documents) {
    const outcome = classifyFallbackDocuments({ documents: one });
    switch (outcome.kind) {
      case "pending":
        pending += 1;
        break;
      case "pending-plan":
        pendingPlans += 1;
        break;
      case "bound":
        receipts.push(outcome.receipt);
        break;
      case "bound-plan":
        planReceipts.push(outcome.receipt);
        break;
      case "foreign":
        foreign += 1;
        foreignModes.add(outcome.mode);
        if (outcome.placed !== undefined) {
          foreignReceipts.push(outcome.placed);
        }
        break;
      case "unbound":
        unboundReceipts.push(...outcome.placed);
        break;
      case "unreadable":
        problems.push(...outcome.problems);
        break;
      default: {
        const unhandled: never = outcome;
        return unhandled;
      }
    }
  }
  return {
    foreign,
    foreignModes: [...foreignModes].toSorted(),
    foreignReceipts,
    pending,
    pendingPlans,
    planReceipts,
    problems,
    receipts,
    unboundReceipts,
    unreadable: problems.length,
  };
}
