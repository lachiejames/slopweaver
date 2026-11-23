/** The tabs in an open ledger row's worktree that no open row paired to, a pure cold-seat guard driven directly. */
import { rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unclaimedWorktreeTabs } from "../../../../../../cli/commands/fleet/resumeCold.js";
import { pairRowsToWorkspaces } from "../../../../../../sessions/closeDone.js";
import { makeHome, workspace } from "../fleetKit.js";
import { dispatchRow } from "./harness.js";

let home = "";

beforeEach(() => {
  home = makeHome();
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("unclaimedWorktreeTabs", () => {
  /** A filesystem with no links: every path is its own key. */
  const lexical = ({ path }: { path: string }): string => path;

  it("names a tab lexically under the worktree whose interior link resolves outside it", () => {
    const open = [dispatchRow({ cwd: "/work/repo", workspaceRef: "workspace:40" })];
    const escaped = { ...workspace({ id: "7" }), currentDirectory: "/work/repo/link/sub" };
    const workspaces = [escaped];
    const paired = pairRowsToWorkspaces({ rows: open, workspaces });
    const keyOf = ({ path }: { path: string }): string => path.replace(/^\/work\/repo\/link\//u, "/outside/tree/");
    expect(keyOf({ path: escaped.currentDirectory })).toBe("/outside/tree/sub");
    expect(unclaimedWorktreeTabs({ keyOf, open, paired, workspaces }).map((tab) => tab.workspaceId)).toEqual(["7"]);
  });

  it("names a tab under a symlinked root AND an interior link that resolves outside the worktree", () => {
    const open = [dispatchRow({ cwd: "/real/checkouts/repo", workspaceRef: "workspace:40" })];
    const both = { ...workspace({ id: "7" }), currentDirectory: "/links/repo/escape/sub" };
    const workspaces = [both];
    const paired = pairRowsToWorkspaces({ rows: open, workspaces });
    const links: readonly (readonly [RegExp, string])[] = [
      [/^\/links\/repo\/escape(?=\/|$)/u, "/outside/tree"],
      [/^\/links\/repo(?=\/|$)/u, "/real/checkouts/repo"],
      [/^\/real\/checkouts\/repo\/escape(?=\/|$)/u, "/outside/tree"],
    ];
    const keyOf = ({ path }: { path: string }): string =>
      links.reduce((key, [link, target]) => key.replace(link, target), path);
    expect(keyOf({ path: both.currentDirectory })).toBe("/outside/tree/sub");
    expect(unclaimedWorktreeTabs({ keyOf, open, paired, workspaces }).map((tab) => tab.workspaceId)).toEqual(["7"]);
  });

  it("names a tab reached through a link from outside that resolves into the worktree", () => {
    const open = [dispatchRow({ cwd: "/real/checkouts/repo", workspaceRef: "workspace:40" })];
    const inbound = { ...workspace({ id: "7" }), currentDirectory: "/shortcuts/api" };
    const workspaces = [inbound];
    const paired = pairRowsToWorkspaces({ rows: open, workspaces });
    const keyOf = ({ path }: { path: string }): string =>
      path.replace(/^\/shortcuts\/api$/u, "/real/checkouts/repo/packages/api");
    expect(unclaimedWorktreeTabs({ keyOf, open, paired, workspaces }).map((tab) => tab.workspaceId)).toEqual(["7"]);
  });

  it("names a tab in a subdirectory reached through a symlinked worktree root", () => {
    const open = [dispatchRow({ cwd: "/real/checkouts/repo", workspaceRef: "workspace:40" })];
    const linked = { ...workspace({ id: "7" }), currentDirectory: "/links/repo/packages/api" };
    const workspaces = [linked];
    const paired = pairRowsToWorkspaces({ rows: open, workspaces });
    const keyOf = ({ path }: { path: string }): string => path.replace(/^\/links\//u, "/real/checkouts/");
    expect(unclaimedWorktreeTabs({ keyOf: lexical, open, paired, workspaces })).toEqual([]);
    expect(unclaimedWorktreeTabs({ keyOf, open, paired, workspaces }).map((tab) => tab.workspaceId)).toEqual(["7"]);
  });

  it("names a renumbered dispatch child's tab, which pairing alone passes over", () => {
    const open = [dispatchRow({ cwd: "/w/repo", workspaceRef: "workspace:40" })];
    const renumbered = { ...workspace({ id: "7" }), currentDirectory: "/w/repo" };
    const workspaces = [workspace({ id: "other" }), renumbered];
    const paired = pairRowsToWorkspaces({ rows: open, workspaces });
    expect(paired.size).toBe(0);
    expect(unclaimedWorktreeTabs({ keyOf: lexical, open, paired, workspaces }).map((tab) => tab.workspaceId)).toEqual([
      "7",
    ]);
  });

  it("names a second tab in a worktree whose open row paired to the first", () => {
    const open = [dispatchRow({ cwd: "/w/a", workspaceRef: "workspace:a" })];
    const second = { ...workspace({ id: "b" }), currentDirectory: "/w/a" };
    const workspaces = [workspace({ id: "a" }), second];
    const paired = pairRowsToWorkspaces({ rows: open, workspaces });
    expect([...paired.values()].map((tab) => tab.workspaceId)).toEqual(["a"]);
    expect(unclaimedWorktreeTabs({ keyOf: lexical, open, paired, workspaces }).map((tab) => tab.workspaceId)).toEqual([
      "b",
    ]);
  });

  it("names a tab whose shell sits in a subdirectory of an open row's worktree", () => {
    const open = [dispatchRow({ cwd: "/w/repo", workspaceRef: "workspace:40" })];
    const nested = { ...workspace({ id: "7" }), currentDirectory: "/w/repo/apps/web" };
    const sibling = { ...workspace({ id: "8" }), currentDirectory: "/w/repository" };
    const workspaces = [nested, sibling];
    const paired = pairRowsToWorkspaces({ rows: open, workspaces });
    expect(unclaimedWorktreeTabs({ keyOf: lexical, open, paired, workspaces }).map((tab) => tab.workspaceId)).toEqual([
      "7",
    ]);
  });

  it("names nothing outside every open row's worktree, nor a tab a row paired to", () => {
    const open = [dispatchRow({ cwd: "/w/a", workspaceRef: "workspace:a" })];
    const workspaces = [workspace({ id: "a" }), workspace({ id: "b" })];
    const paired = pairRowsToWorkspaces({ rows: open, workspaces });
    expect(unclaimedWorktreeTabs({ keyOf: lexical, open, paired, workspaces })).toEqual([]);
  });

  it("names each tab once when several unpaired children share one worktree", () => {
    const open = [
      dispatchRow({ cwd: "/w/repo", workspaceRef: "workspace:40" }),
      dispatchRow({ cwd: "/w/repo", workspaceRef: "workspace:41" }),
    ];
    const tab = { ...workspace({ id: "7" }), currentDirectory: "/w/repo" };
    const paired = pairRowsToWorkspaces({ rows: open, workspaces: [tab] });
    expect(
      unclaimedWorktreeTabs({ keyOf: lexical, open, paired, workspaces: [tab] }).map((each) => each.workspaceId),
    ).toEqual(["7"]);
  });
});
