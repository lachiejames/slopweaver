/*
 * The head-checks projection of one pull-request node: a snapshot that was READ is told apart from one that is
 * merely empty, and the node's own mergeability is folded onto a read one.
 */
import { describe, expect, it } from "vitest";

import { checksOf } from "../../../../live/github/reviewStateChecks.js";

/** The empty snapshot every unread answer carries. */
const EMPTY = {
  baseRef: undefined,
  checks: [],
  headSha: "",
  mergeable: undefined,
  residue: [],
  rollupState: "PENDING",
  supersededChecks: [],
  truncated: false,
};

describe("checksOf", () => {
  it("reads a node with no head commit as unread, naming why, over the empty snapshot", () => {
    expect(checksOf({ node: { commits: { nodes: [] } } })).toEqual({
      read: { kind: "unread", why: "GitHub returned no head commit, so nothing was read" },
      snapshot: EMPTY,
    });
  });

  it("reads a head commit the checks parser refuses as unread, carrying the parser's own message", () => {
    expect(checksOf({ node: { commits: { nodes: [{ commit: { statusCheckRollup: null } }] } } })).toEqual({
      read: { kind: "unread", why: "GitHub returned a checks rollup with no head commit SHA" },
      snapshot: EMPTY,
    });
  });

  it("reads a parseable rollup as read, with the pull request's own mergeable folded on", () => {
    const node = {
      commits: {
        nodes: [
          {
            commit: {
              oid: "4219a284",
              statusCheckRollup: { contexts: { nodes: [], pageInfo: { hasNextPage: false } }, state: "SUCCESS" },
            },
          },
        ],
      },
      mergeable: "CONFLICTING",
    };
    expect(checksOf({ node })).toEqual({
      read: { kind: "read" },
      snapshot: {
        baseRef: undefined,
        checks: [],
        headSha: "4219a284",
        mergeable: "CONFLICTING",
        residue: [],
        rollupState: "SUCCESS",
        supersededChecks: [],
        truncated: false,
      },
    });
  });

  it("reads an absent mergeable on a read head as UNKNOWN, never as mergeable", () => {
    const { snapshot } = checksOf({ node: { commits: { nodes: [{ commit: { oid: "4219a284" } }] } } });
    expect(snapshot.mergeable).toBe("UNKNOWN");
  });
});
