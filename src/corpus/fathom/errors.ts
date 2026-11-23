/**
 * The `fathom` lane's own typed failures.
 *
 * A union rather than `readonly string[]` because callers genuinely branch on these: a missing key is the
 * owner's to fix and the refresh should say so in one line, a 401 means the key was revoked or its user
 * deactivated (Fathom's own FAQ: a deactivated user's key returns 4xx), and a transport failure is
 * retryable and must NOT move the cursor. Those are three different next actions, so they are three codes.
 *
 * Per `.claude/rules/error-handling.md`: no shared base type, no umbrella — this union stands alone beside
 * the GitHub one and is never merged with it however similar the shapes look.
 */

/** No API key is configured, so the lane cannot be reached at all. */
export interface FathomKeyMissingError {
  readonly code: "KEY_MISSING";
  readonly message: string;
}

/** A key was presented and Fathom refused it. */
export interface FathomUnauthorisedError {
  readonly code: "UNAUTHORISED";
  readonly message: string;
}

/** The crawl failed on the wire, or the provider answered in a shape the SDK would not parse. */
export interface FathomFetchFailedError {
  readonly code: "FETCH_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/** Every way the Fathom lane can fail. */
export type FathomError = FathomKeyMissingError | FathomUnauthorisedError | FathomFetchFailedError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const FathomErrors = {
  fetchFailed: ({ cause }: { cause: unknown }): FathomFetchFailedError => ({
    cause,
    code: "FETCH_FAILED",
    message: cause instanceof Error ? cause.message : "fathom fetch failed",
  }),
  keyMissing: (): FathomKeyMissingError => ({
    code: "KEY_MISSING",
    message:
      "no Fathom API key is configured — mint one at https://fathom.video/customize#api-access-header " +
      "(User Settings → API Access) and store it with `slopweaver secrets set fathom-api-key`",
  }),
  unauthorised: (): FathomUnauthorisedError => ({
    code: "UNAUTHORISED",
    message:
      "Fathom refused the stored API key — it was revoked, or the user it belongs to was deactivated " +
      "(a deactivated user's key returns 4xx). Mint a fresh one at " +
      "https://fathom.video/customize#api-access-header and re-run `slopweaver secrets set fathom-api-key`",
  }),
} as const;
