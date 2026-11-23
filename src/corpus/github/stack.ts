/**
 * The REST-shaped native GitHub stack used by the live stack verbs. GitHub's stack REST endpoints have no
 * generated Octokit type yet (`@octokit/openapi-types` doesn't cover
 * them), so this is a small, defensive, hand-narrowed projection of `client.request(...)`'s raw response —
 * matching `write.ts`'s own `toWrittenPr` in spirit: trust the shape, narrow only where a real field could
 * legitimately be absent.
 */
import { isRecord } from "../../lib/parsers.js";

/**
 * One pull request within a native GitHub stack.
 *
 * `baseRef`/`headRef` are branch names, not the stack's own recorded/live distinction — `sync` (Phase 3)
 * deliberately does not trust either as a staleness signal; it re-derives staleness from git's own ancestry
 * instead, since what this field means (recorded at join time, or always live-computed) is unverified.
 */
export interface GithubStackEntry {
  readonly number: number;
  readonly headRef: string;
  readonly baseRef: string;
  readonly state: string;
  readonly mergedAtIso: string | undefined;
}

/** A native GitHub stack, as returned by the REST `/repos/{owner}/{repo}/stacks` endpoints. */
export interface GithubStack {
  readonly id: number;
  readonly number: number;
  readonly open: boolean;
  /** Bottom to top. */
  readonly entries: readonly GithubStackEntry[];
}

/** One raw `pull_requests[]` entry, narrowed defensively. */
function toGithubStackEntry({ entry, index }: { entry: unknown; index: number }): GithubStackEntry {
  if (!isRecord(entry) || typeof entry["number"] !== "number" || typeof entry["state"] !== "string") {
    throw new Error(`stack.pull_requests[${String(index)}] is missing number or state`);
  }
  const { head, base } = entry;
  if (!isRecord(head) || typeof head["ref"] !== "string" || !isRecord(base) || typeof base["ref"] !== "string") {
    throw new Error(`stack.pull_requests[${String(index)}] is missing head.ref or base.ref`);
  }
  const mergedAt = entry["merged_at"];
  return {
    baseRef: base["ref"],
    headRef: head["ref"],
    mergedAtIso: typeof mergedAt === "string" ? mergedAt : undefined,
    number: entry["number"],
    state: entry["state"],
  };
}

/**
 * Narrow a raw stack REST response into {@link GithubStack}.
 *
 * @param value the raw response body from a stacks GET/POST call
 * @returns the narrowed stack
 */
export function toGithubStack({ value }: { value: unknown }): GithubStack {
  if (!isRecord(value)) {
    throw new Error("GitHub's stack response was not an object");
  }
  const { id, number, open, pull_requests: pullRequests } = value;
  if (typeof id !== "number" || typeof number !== "number" || typeof open !== "boolean") {
    throw new Error("GitHub's stack response is missing id, number or open");
  }
  if (!Array.isArray(pullRequests)) {
    throw new Error("GitHub's stack response is missing a pull_requests array");
  }
  return { entries: pullRequests.map((entry, index) => toGithubStackEntry({ entry, index })), id, number, open };
}

/**
 * Narrow the response of GitHub's `unstack` endpoint, which reports 200 with a real stack body when a
 * locked or already-merged entry could not be removed and the stack survives with what's left, or 204 with
 * no body once every entry is gone and the stack is fully dissolved.
 *
 * @param value the raw response body — absent (not a record) on a 204
 * @returns the surviving stack, or `undefined` once nothing of it remains
 */
export function toGithubStackOrDissolved({ value }: { value: unknown }): GithubStack | undefined {
  return isRecord(value) ? toGithubStack({ value }) : undefined;
}
