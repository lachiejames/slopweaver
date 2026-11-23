/** Whether a row's pairing to its tab would be a guess, a pure cold-seat guard driven directly. */
import { rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pairingGuess } from "../../../../../../cli/commands/fleet/resumeCold.js";
import { makeHome, workspace } from "../fleetKit.js";

let home = "";

beforeEach(() => {
  home = makeHome();
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("pairingGuess", () => {
  it("trusts a pairing whose worktree only the row's own tab is in", () => {
    const workspaces = [workspace({ id: "a" }), workspace({ id: "b" })];
    expect(pairingGuess({ rowCwd: "/w/a", workspaces })).toBe(undefined);
  });

  it("hands over a row naming no worktree, since its ref is one cmux reissues on reopen", () => {
    expect(pairingGuess({ rowCwd: undefined, workspaces: [workspace({ id: "a" })] })).toBe(
      "its ledger row names no worktree, so it paired on a ref cmux reissues on reopen",
    );
  });

  it("hands over a worktree two tabs share, since which is the row's seat would be a guess", () => {
    const twin = { ...workspace({ id: "twin" }), currentDirectory: "/w/a" };
    expect(pairingGuess({ rowCwd: "/w/a", workspaces: [workspace({ id: "a" }), twin] })).toBe(
      "another tab is open in the same worktree, so which one is this row's seat would be a guess",
    );
  });
});
