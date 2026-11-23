/**
 * The typed failures of reading one Fathom SHARE page (`slopweaver fathom share <url>`).
 *
 * A union beside {@link ./errors.FathomError}, never merged into it: that one is the API lane's, whose next
 * actions are a key to mint or a transport to retry. These four are a page's: an address that is not a share
 * link is the caller's to fix, a sign-in wall is the owner's Chrome's, a redesigned page is this code's, and a page
 * with no transcript yet is Fathom's still processing the call. Four next actions, so four codes.
 */

/** The address given is not `https://fathom.video/share/<token>`. */
export interface FathomShareUrlInvalidError {
  readonly code: "URL_INVALID";
  readonly message: string;
  readonly url: string;
}

/** The browser landed somewhere other than the share page — a sign-in wall, most often. */
export interface FathomShareNotShownError {
  readonly code: "NOT_SHOWN";
  readonly message: string;
  readonly url: string;
  readonly landedOn: string;
}

/** The page loaded but no longer carries what the read expects: Fathom changed it. */
export interface FathomShareShapeChangedError {
  readonly code: "SHAPE_CHANGED";
  readonly message: string;
  readonly url: string;
}

/** The page loaded and carries no spoken line yet. */
export interface FathomShareTranscriptAbsentError {
  readonly code: "TRANSCRIPT_ABSENT";
  readonly message: string;
  readonly url: string;
}

/** Every way reading one share page can fail. */
export type FathomShareError =
  | FathomShareUrlInvalidError
  | FathomShareNotShownError
  | FathomShareShapeChangedError
  | FathomShareTranscriptAbsentError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const FathomShareErrors = {
  notShown: ({ url, landedOn }: { url: string; landedOn: string }): FathomShareNotShownError => ({
    code: "NOT_SHOWN",
    landedOn,
    message:
      `the browser was sent to ${url} and landed on ${landedOn} — the Chrome the relay drives is not signed ` +
      "in to Fathom as someone the call was shared with",
    url,
  }),
  shapeChanged: ({ url, what }: { url: string; what: string }): FathomShareShapeChangedError => ({
    code: "SHAPE_CHANGED",
    message: `${url}: ${what} — Fathom's share page no longer has the shape browser/fathomShareSnippet.ts reads`,
    url,
  }),
  transcriptAbsent: ({ url }: { url: string }): FathomShareTranscriptAbsentError => ({
    code: "TRANSCRIPT_ABSENT",
    message: `${url} carries no spoken line yet — Fathom may still be processing the recording`,
    url,
  }),
  urlInvalid: ({ url, why }: { url: string; why: string }): FathomShareUrlInvalidError => ({
    code: "URL_INVALID",
    message: `${url} is not a Fathom share link (https://fathom.video/share/<token>): ${why}`,
    url,
  }),
} as const;
