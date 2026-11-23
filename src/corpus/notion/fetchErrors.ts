/**
 * The fatal failures of the Notion READ lanes — activity, members and structure discovery.
 *
 * Its own small union per `.claude/rules/error-handling.md`, scoped to this directory's hydration edge. The
 * three are different lanes failing, not three spellings of one: a caller reporting a refresh wants to say
 * WHICH lane lost its run, and a per-item failure inside any of them is a warning or a skip, never one of
 * these. Each keeps the thrown value as `cause`; the `message` is what the lane has always printed.
 *
 * Pure: every factory takes what it names.
 */

/** The activity crawl's top-level search threw — a rejected token, or the search itself failing. */
export interface NotionActivityFetchFailedError {
  readonly code: "FETCH_FAILED";
  readonly message: string;
  readonly cause: unknown;
}

/** Paging `users.list` threw, so no member row is trustworthy. */
export interface NotionMemberHydrationFailedError {
  readonly code: "MEMBER_HYDRATION_FAILED";
  readonly message: string;
  readonly cause: unknown;
}

/** Discovering the accessible data sources threw, so no schema could be retrieved. */
export interface NotionStructureDiscoveryFailedError {
  readonly code: "STRUCTURE_DISCOVERY_FAILED";
  readonly message: string;
  readonly cause: unknown;
}

/** Every fatal failure of a Notion read lane. */
export type NotionFetchError =
  NotionActivityFetchFailedError | NotionMemberHydrationFailedError | NotionStructureDiscoveryFailedError;

/** The thrown value's own message, or `unknown` when it is not an `Error`. */
function causeText({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : "unknown";
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const NotionFetchErrors = {
  fetchFailed: ({ cause }: { cause: unknown }): NotionActivityFetchFailedError => ({
    cause,
    code: "FETCH_FAILED",
    message: `fetch failed: ${causeText({ cause })}`,
  }),
  memberHydrationFailed: ({ cause }: { cause: unknown }): NotionMemberHydrationFailedError => ({
    cause,
    code: "MEMBER_HYDRATION_FAILED",
    message: `notion member hydration failed: ${causeText({ cause })}`,
  }),
  structureDiscoveryFailed: ({ cause }: { cause: unknown }): NotionStructureDiscoveryFailedError => ({
    cause,
    code: "STRUCTURE_DISCOVERY_FAILED",
    message: `notion structure discovery failed: ${causeText({ cause })}`,
  }),
} as const;
