/**
 * The head-checks projection of one pull-request node in the fleet read behind `slopweaver github
 * review-state`: the checks snapshot, and whether it was actually READ rather than merely empty. Pure.
 * `./reviewState.ts` shapes the rest of the node and asks this module for the checks.
 */

import { isRecord } from "#lib/parsers.js";
import { asGithubMergeable } from "../../review/reviewState.js";
import { type GithubChecksSnapshot, parseChecksForCommit } from "./checks.js";
import type { ChecksRead } from "./headChecksRead.js";
import { nodesOf, str } from "./reviewStateConnection.js";

/** The head commit node of a pull-request node, when GraphQL returned one. */
function headCommitOf({ node }: { node: Record<string, unknown> }): Record<string, unknown> | undefined {
  const first = nodesOf({ connection: node["commits"] })[0];
  const commit = first === undefined ? undefined : first["commit"];
  return isRecord(commit) ? commit : undefined;
}

/** An empty, already-terminal checks snapshot — what a pull request with no head commit node reads as. */
const NO_CHECKS: GithubChecksSnapshot = {
  baseRef: undefined,
  checks: [],
  headSha: "",
  mergeable: undefined,
  residue: [],
  rollupState: "PENDING",
  supersededChecks: [],
  truncated: false,
};

/**
 * The checks snapshot for a pull-request node, and whether it was actually read.
 *
 * An unparseable rollup still yields the empty snapshot rather than throwing — every other answer about the
 * pull request is fine and must survive — but it now says so, so `checks-read` can hold a dispatch verdict
 * back instead of a green being inferred from an absence.
 *
 * @param node one pull-request node from the search
 * @returns the snapshot and whether it was read
 */
export function checksOf({ node }: { node: Record<string, unknown> }): {
  snapshot: GithubChecksSnapshot;
  read: ChecksRead;
} {
  const commit = headCommitOf({ node });
  if (commit === undefined) {
    const read: ChecksRead = { kind: "unread", why: "GitHub returned no head commit, so nothing was read" };
    return { read, snapshot: NO_CHECKS };
  }
  const parsed = parseChecksForCommit({ commit });
  if (parsed.isErr()) {
    return { read: { kind: "unread", why: parsed.error.message }, snapshot: NO_CHECKS };
  }
  // The commit node carries no mergeability, and this fleet query already selects the pull request's own
  // `mergeable` — fold it on, so a required context that NEVER RAN can name its cause here too.
  const mergeable = asGithubMergeable({ token: str({ value: node["mergeable"] }) });
  return { read: { kind: "read" }, snapshot: { ...parsed.value, mergeable } };
}
