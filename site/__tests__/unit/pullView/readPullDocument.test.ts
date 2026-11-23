/*
 * The pull-request view's reader: a `github read <pr> --files --json` document into what the page draws, the whole
 * document refused on a shape it does not know. A reader that guessed would draw a confident pull request nobody read.
 */

import { describe, expect, it } from "vitest";

import { readPullDocument } from "../../../lib/pullView";
import { comment, DATA, document, nodes, VIEW } from "./harness";

describe("readPullDocument", () => {
  it("reads the header, the size and what the read did not cover", () => {
    expect(VIEW.lifecycle).toBe("open");
    expect(VIEW.author).toBe("author");
    expect([VIEW.baseRef, VIEW.headRef]).toEqual(["main", "topic"]);
    expect([VIEW.additions, VIEW.deletions, VIEW.changedFiles]).toEqual([12, 3, 2]);
    expect(VIEW.mergeStateStatus).toBe("BLOCKED");
    expect(VIEW.residue).toEqual(["data.files has another provider page"]);
  });

  it("reads each file, a binary one with no patch and a rename with its old name", () => {
    expect(VIEW.files).toEqual([
      {
        additions: 10,
        deletions: 3,
        filename: "a.ts",
        patch: "@@ -1 +1 @@\n-x\n+y",
        previousFilename: undefined,
        status: "modified",
      },
      {
        additions: 2,
        deletions: 0,
        filename: "logo.png",
        patch: undefined,
        previousFilename: "old.png",
        status: "renamed",
      },
    ]);
  });

  it("reads a check run's conclusion and a status's state, with the head commit", () => {
    expect(VIEW.checks).toEqual({
      items: [
        { name: "lint", result: "SUCCESS", url: "https://ci/1" },
        { name: "codeowners", result: "PENDING", url: undefined },
      ],
      state: "PENDING",
      total: 2,
    });
    expect(VIEW.headOid).toBe("abcdef1234");
  });

  it("reads requested people and teams, and a thread's code and state", () => {
    expect(VIEW.requested).toEqual([
      { asCodeOwner: true, kind: "user", name: "dave" },
      { asCodeOwner: true, kind: "team", name: "acme/eng" },
    ]);
    const thread = VIEW.threads.at(0)!;
    expect(thread.diffHunk).toBe("@@ -1,2 +1,2 @@\n a\n+b");
    expect([thread.resolved, thread.line, thread.side]).toEqual([true, 1, "RIGHT"]);
  });

  it("refuses a read with no commits list or no merge state, rather than drawing no checks or an empty state", () => {
    const { commits: _commits, ...withoutCommits } = DATA;
    const { mergeStateStatus: _merge, ...withoutMergeState } = DATA;
    expect(readPullDocument({ payload: document(withoutCommits) })).toBeUndefined();
    expect(readPullDocument({ payload: document(withoutMergeState) })).toBeUndefined();
  });

  it("reads a head commit GitHub reports no checks on as no checks", () => {
    const unchecked = { ...DATA, commits: nodes({ commit: { oid: "abcdef1234", statusCheckRollup: null } }) };
    expect(readPullDocument({ payload: document(unchecked) })!.checks).toBeUndefined();
  });

  it("refuses a thread whose side it does not know, rather than guessing which file its line counts in", () => {
    const [thread] = DATA.reviewThreads.nodes;
    const unsided = { ...DATA, reviewThreads: nodes({ ...thread, diffSide: "MIDDLE" }) };
    expect(readPullDocument({ payload: document(unsided) })).toBeUndefined();
  });

  it("reads a draft, a merged and a closed pull request", () => {
    expect(readPullDocument({ payload: document({ ...DATA, isDraft: true }) })!.lifecycle).toBe("draft");
    expect(readPullDocument({ payload: document({ ...DATA, state: "MERGED" }) })!.lifecycle).toBe("merged");
    expect(readPullDocument({ payload: document({ ...DATA, state: "CLOSED" }) })!.lifecycle).toBe("closed");
  });

  it("reads a deleted account's comment as a person with no login", () => {
    const deleted = { ...DATA, comments: nodes(comment({ at: "2026-09-29T01:00:00Z", id: "c1", login: null })) };
    expect(readPullDocument({ payload: document(deleted) })!.comments.at(0)!.author).toBeUndefined();
  });

  it("refuses a document read without --files", () => {
    const { files: _files, ...withoutFiles } = DATA;
    expect(readPullDocument({ payload: document(withoutFiles) })).toBeUndefined();
  });

  it("refuses an issue, a file of the wrong shape, and a state it does not know", () => {
    expect(readPullDocument({ payload: document({ ...DATA, __typename: "Issue" }) })).toBeUndefined();
    expect(readPullDocument({ payload: document({ ...DATA, files: nodes({ filename: "a.ts" }) }) })).toBeUndefined();
    expect(readPullDocument({ payload: document({ ...DATA, state: "LOCKED" }) })).toBeUndefined();
    expect(readPullDocument({ payload: "not a document" })).toBeUndefined();
  });
});
