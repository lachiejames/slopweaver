/**
 * What a fleet-ceiling morning's delivery can come to: the receipts it reports when it lands, and the typed errors it
 * stops short on. Pure shapes and their constructors only — the effects that produce them live in
 * `./fleetCeilingDelivery.ts`.
 */
import { appendVerbFailureWhy } from "../../../live/automation/verbFailureWhy.js";
import { EXIT_OK } from "../../exitCodes.js";

/**
 * What the card under today's slug came to: none earned, placed now, already standing, already settled by the owner, or
 * placed by an earlier attempt and withdrawn now that this reading no longer earns it.
 *
 * @internal
 */
export type FleetCeilingCardReceipt = "none" | "placed" | "existing" | "settled" | "withdrawn";

/**
 * What became of yesterday's card: none stood open, withdrawn now, or the withdrawal failed and why.
 *
 * @internal
 */
export type FleetCeilingPreviousReceipt =
  | { readonly kind: "none" }
  | { readonly kind: "withdrawn" }
  | { readonly kind: "withdraw-failed"; readonly why: string };

/** What one delivered morning placed. */
export interface FleetCeilingDelivered {
  readonly pageUrl: string;
  readonly card: FleetCeilingCardReceipt;
  readonly previous: FleetCeilingPreviousReceipt;
}

/** The page would not publish. */
export interface FleetCeilingPagePublishFailedError {
  readonly code: "PAGE_PUBLISH_FAILED";
  readonly message: string;
  readonly slug: string;
}

/** The card's slug could not be read back, or `handover register` refused it and no card stands. */
export interface FleetCeilingCardFailedError {
  readonly code: "CARD_FAILED";
  readonly message: string;
  readonly slug: string;
}

/** The card was placed but the page would not attach to it. */
export interface FleetCeilingArtifactFailedError {
  readonly code: "ARTIFACT_FAILED";
  readonly message: string;
  readonly slug: string;
}

/** A card an earlier attempt at this slot left may still stand open: it would not read back, or would not withdraw. */
export interface FleetCeilingCardNotWithdrawnError {
  readonly code: "CARD_NOT_WITHDRAWN";
  readonly message: string;
  readonly slug: string;
}

/** Every way a morning's delivery stops short. */
export type FleetCeilingDeliveryError =
  | FleetCeilingPagePublishFailedError
  | FleetCeilingCardFailedError
  | FleetCeilingArtifactFailedError
  | FleetCeilingCardNotWithdrawnError;

/**
 * Construct one {@link FleetCeilingDeliveryError}.
 *
 * @internal
 */
export const FleetCeilingDeliveryErrors = {
  artifactFailed: ({
    slug,
    code,
    diagnostics,
  }: {
    slug: string;
    code: number;
    /** What `handover artifact` wrote to stderr, kept as the cause on the firing's record. */
    diagnostics: string;
  }): FleetCeilingArtifactFailedError => ({
    code: "ARTIFACT_FAILED",
    message: appendVerbFailureWhy({
      diagnostics,
      line: `the card ${slug} was placed, and handover artifact exited ${String(code)} attaching its page`,
    }),
    slug,
  }),
  cardFailed: ({ slug, why }: { slug: string; why: string }): FleetCeilingCardFailedError => ({
    code: "CARD_FAILED",
    message: `the Queue card ${slug} was not placed: ${why}`,
    slug,
  }),
  cardNotWithdrawn: ({ slug, why }: { slug: string; why: string }): FleetCeilingCardNotWithdrawnError => ({
    code: "CARD_NOT_WITHDRAWN",
    message: `the Queue card ${slug} an earlier attempt left may still be open, NOT withdrawn: ${why}`,
    slug,
  }),
  pagePublishFailed: ({ slug, why }: { slug: string; why: string }): FleetCeilingPagePublishFailedError => ({
    code: "PAGE_PUBLISH_FAILED",
    message: `the page ${slug} would not publish: ${why}`,
    slug,
  }),
} as const;

/**
 * What yesterday's card's withdrawal leg left: withdrawn on a zero, else a failure whose why ends with the leg's own
 * closing stderr, so the outcome line names the cause rather than only an exit code. PURE.
 *
 * @param code the `handover withdraw` leg's exit
 * @param diagnostics what that leg wrote to stderr while it ran
 * @returns the receipt the outcome line reports
 */
export function withdrawReceipt({
  code,
  diagnostics,
}: {
  code: number;
  diagnostics: string;
}): FleetCeilingPreviousReceipt {
  if (code === EXIT_OK) {
    return { kind: "withdrawn" };
  }
  return {
    kind: "withdraw-failed",
    why: appendVerbFailureWhy({ diagnostics, line: `handover withdraw exited ${String(code)}` }),
  };
}
