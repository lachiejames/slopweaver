/*
 * `branchesByRemote`, pinned against literal listings: each tracking ref grouped under the longest remote that owns
 * it, with the HEAD symref dropped.
 */
import { describe, expect, it } from "vitest";

import { branchesByRemote } from "../../../../worktree/pruneRemote.js";

describe("branchesByRemote", () => {
  it("groups each tracking ref under the longest remote that owns it and drops the HEAD symref", () => {
    const refs = [
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/feat/x",
      "refs/remotes/origin/main",
      "refs/remotes/up/stream/topic",
      "refs/remotes/gone/branch",
    ].join("\n");

    expect([...branchesByRemote({ refs, remotes: "origin\nup\nup/stream\n" })]).toEqual([
      ["origin", ["refs/heads/feat/x", "refs/heads/main"]],
      ["up/stream", ["refs/heads/topic"]],
    ]);
  });

  it("is empty when no tracking ref contains the commit", () => {
    expect(branchesByRemote({ refs: "", remotes: "origin" }).size).toBe(0);
  });
});
