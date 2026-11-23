/**
 * How each pull request ended, read from the GitHub bronze the corpus already holds.
 *
 * Keyed by the pull request's own `url`, because that is exactly the string Linear puts in an issue's
 * `attachments` — so the join needs no parsing of owner, repo or number, and cannot mis-key `#7` in one
 * repository onto `#7` in another. Bronze's `sourceId` for a pull request is the bare `#7` and its
 * `container` carries the repository, which is why the URL is the right key rather than the id.
 *
 * Pure: the caller streams the lines.
 */

import { isRecord } from "../lib/parsers.js";
import type { PullRequestState } from "./classify.js";

/** One pull request's ending, with the record instant used to pick the newest row. */
export interface PullRequestOutcome {
  readonly url: string;
  readonly state: PullRequestState;
  readonly recordTsIso: string;
}

/**
 * Read one GitHub bronze line into an outcome.
 *
 * @param line one raw JSONL line
 * @returns the outcome, or `undefined` when the line is not a usable pull-request row
 */
export function pullRequestOutcomeOf({ line }: { line: string }): PullRequestOutcome | undefined {
  const parsed: unknown = safeParse({ line });
  if (!isRecord(parsed) || parsed["kind"] !== "pr" || typeof parsed["url"] !== "string") {
    return undefined;
  }
  const attrs: unknown = parsed["attrs"];
  const state = isRecord(attrs) ? attrs["state"] : undefined;
  if (state !== "MERGED" && state !== "CLOSED" && state !== "OPEN") {
    return undefined;
  }
  const recordTsIso = typeof parsed["tsIso"] === "string" ? parsed["tsIso"] : "";
  return { recordTsIso, state, url: parsed["url"] };
}

/** `JSON.parse` that answers `undefined` rather than throwing. */
function safeParse({ line }: { line: string }): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/**
 * The newest known ending for each pull request URL.
 *
 * @param outcomes every pull-request row read, in any order
 * @returns the state of each pull request, keyed by its URL
 */
export function pullRequestStates({
  outcomes,
}: {
  outcomes: readonly PullRequestOutcome[];
}): ReadonlyMap<string, PullRequestState> {
  const newest = new Map<string, PullRequestOutcome>();
  for (const outcome of outcomes) {
    const held = newest.get(outcome.url);
    if (held === undefined || held.recordTsIso < outcome.recordTsIso) {
      newest.set(outcome.url, outcome);
    }
  }
  const states = new Map<string, PullRequestState>();
  for (const [url, outcome] of newest) {
    states.set(url, outcome.state);
  }
  return states;
}
