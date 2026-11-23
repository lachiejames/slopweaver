/**
 * The typed failures of one `fathom share` run, from the page read to the store leg.
 *
 * A union of its own, beside {@link ../../../corpus/fathom/shareErrors.FathomShareError} rather than merged
 * into it: that one names what the PAGE showed, and is carried here whole as `PAGE_REFUSED`'s cause. These
 * five name which step of the run stopped, because each step leaves bronze and the store in a different state
 * — nothing written, bronze written without the store, or the hand-written row still present.
 */
import type { FathomShareError } from "../../../corpus/fathom/shareErrors.js";

/** The browser could not hand the page back at all — the relay's setup or its transport failed. */
export interface FathomPageUnreadError {
  readonly code: "PAGE_UNREAD";
  readonly message: string;
}

/** The page came back and the pure reader refused it; `cause` says what the page showed. */
export interface FathomPageRefusedError {
  readonly code: "PAGE_REFUSED";
  readonly message: string;
  readonly cause: FathomShareError;
}

/** Bronze could not be written or rewritten: the commit, or the removal of the hand-written row. */
export interface FathomBronzeWriteError {
  readonly code: "BRONZE_WRITE_FAILED";
  readonly message: string;
}

/** The sync denylist excluded the call's host, so the commit stored nothing. */
export interface FathomDenylistExcludedError {
  readonly code: "DENYLIST_EXCLUDED";
  readonly message: string;
  readonly url: string;
}

/** Bronze holds the transcript, and retiring or replaying the store rows failed after it. */
export interface FathomStoreLegFailedError {
  readonly code: "STORE_LEG_FAILED";
  readonly message: string;
}

/** Every way one `fathom share` run can stop. */
export type FathomCommandError =
  | FathomPageUnreadError
  | FathomPageRefusedError
  | FathomBronzeWriteError
  | FathomDenylistExcludedError
  | FathomStoreLegFailedError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const FathomCommandErrors = {
  bronzeWriteFailed: ({ problems }: { problems: readonly string[] }): FathomBronzeWriteError => ({
    code: "BRONZE_WRITE_FAILED",
    message: problems.join("; "),
  }),
  denylistExcluded: ({ url }: { url: string }): FathomDenylistExcludedError => ({
    code: "DENYLIST_EXCLUDED",
    message: `the sync denylist excluded this call's host, so nothing was stored for ${url}`,
    url,
  }),
  pageRefused: ({ cause }: { cause: FathomShareError }): FathomPageRefusedError => ({
    cause,
    code: "PAGE_REFUSED",
    message: `${cause.code}: ${cause.message}`,
  }),
  pageUnread: ({ problems }: { problems: readonly string[] }): FathomPageUnreadError => ({
    code: "PAGE_UNREAD",
    message: problems.join("; "),
  }),
  storeLegFailed: ({ problems }: { problems: readonly string[] }): FathomStoreLegFailedError => ({
    code: "STORE_LEG_FAILED",
    message: `bronze holds the transcript, but the store leg failed: ${problems.join("; ")}`,
  }),
} as const;
