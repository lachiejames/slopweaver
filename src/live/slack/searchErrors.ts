/**
 * The typed failures of the live Slack search leg — its own union, scoped to this one bounded module.
 *
 * Separate from the corpus's `../../corpus/slack/errors.ts` on purpose: a caller branches on these to decide
 * whether an ABSENCE may be reported at all, and an ingest failure and a search failure lead to different
 * sentences. There is no shared base type across domains here, by house rule.
 */

/** The search call itself did not complete — a token problem, a rate limit, a network fault. */
export interface SlackSearchCallFailedError {
  readonly code: "SEARCH_CALL_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/** Slack answered, but the body was not the shape `search.messages` documents. */
export interface SlackSearchUnreadableError {
  readonly code: "SEARCH_UNREADABLE";
  readonly message: string;
  readonly detail: string;
}

/** Every way the live search leg can fail. */
export type SlackLiveSearchError = SlackSearchCallFailedError | SlackSearchUnreadableError;

/** The factories, so a test builds a failure the same way the code does. */
export const SlackLiveSearchErrors = {
  callFailed: ({ cause, message }: { cause: unknown; message: string }): SlackSearchCallFailedError => ({
    cause,
    code: "SEARCH_CALL_FAILED",
    message: `slack search could not be read: ${message}`,
  }),
  unreadable: ({ detail }: { detail: string }): SlackSearchUnreadableError => ({
    code: "SEARCH_UNREADABLE",
    detail,
    message: `slack search answered in an unexpected shape — ${detail}`,
  }),
} as const;
