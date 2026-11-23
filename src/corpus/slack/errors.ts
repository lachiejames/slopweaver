/**
 * Typed discriminated-union domain errors for `src/corpus/slack/fetch.ts`'s workspace discovery — the only
 * Slack connector seam whose failures split into genuinely different kinds (a thrown exception vs. an
 * `auth.test` response that came back without a URL). `structures.ts`/`members.ts` each throw exactly one
 * flavour of "the underlying call failed", so they stay on the default `Result<T, readonly string[]>`. The two
 * resume-store writes (`threadCursors.ts`, `channelWatermark.ts`) have their own bounded union in
 * `./cursorWriteErrors.ts`: the directory passed the `error-shape-threshold` gate's four distinct shapes once
 * strings reached through a conditional were counted.
 */

/** Channel discovery (or the workspace pre-fetch) threw — fatal, nothing to crawl at all. */
export interface SlackFetchFailedError {
  readonly code: "FETCH_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/** `auth.test` resolved with no team URL — a token-scope gap, not a network failure. */
export interface SlackWorkspaceUrlUnresolvedError {
  readonly code: "WORKSPACE_URL_UNRESOLVED";
  readonly message: string;
}

/** Every failure `discoverSlackWorkspace`/`fetchSlackActivity` can produce. */
export type SlackFetchError = SlackFetchFailedError | SlackWorkspaceUrlUnresolvedError;

export const SlackFetchErrors = {
  /**
   * Build a {@link SlackFetchFailedError} from a caught exception.
   *
   * @param message the already-composed context + cause message
   * @param cause the original thrown value, verbatim
   * @returns the typed error
   */
  fetchFailed: ({ message, cause }: { message: string; cause?: unknown }): SlackFetchFailedError => ({
    code: "FETCH_FAILED",
    message,
    ...(cause !== undefined ? { cause } : {}),
  }),
  /**
   * Build a {@link SlackWorkspaceUrlUnresolvedError} — `auth.test` returned no team URL.
   *
   * @returns the typed error
   */
  workspaceUrlUnresolved: (): SlackWorkspaceUrlUnresolvedError => ({
    code: "WORKSPACE_URL_UNRESOLVED",
    message: "could not resolve the workspace URL (auth.test) — check the token scopes",
  }),
} as const;
