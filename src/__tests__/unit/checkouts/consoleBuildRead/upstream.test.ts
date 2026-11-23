import { describe, expect, it } from "vitest";

import { LOG_FIELD, MAINLINE_FORMAT, MAINLINE_LIMIT } from "../../../../checkouts/consoleBuild.js";
import { CONSOLE_PATHSPEC, pathChangeLogArgs, SHELL_PATHSPEC } from "../../../../checkouts/shellChanges.js";
import { CONSOLE_LOG, read, SHA_A, SHELL_LOG, UPSTREAM_READ, useConsoleBuildRoots, worldAt } from "./harness.js";

useConsoleBuildRoots();

describe("readConsoleBuild", () => {
  it("says there is no latest build on a detached HEAD", () => {
    const world = worldAt();
    world.git.delete("symbolic-ref --quiet HEAD");
    expect(read({ world }).problems).toEqual([
      "this checkout's branch tracks no upstream, so there is no latest build to compare with",
    ]);
  });

  it("says there is no latest build when the branch tracks nothing", () => {
    const world = worldAt();
    world.git.set(UPSTREAM_READ, "");
    const report = read({ world });
    expect(report.upstream).toBe(undefined);
    expect(report.mainline).toEqual({ commits: [], limit: MAINLINE_LIMIT, truncated: false });
    expect(report.problems).toEqual([
      "this checkout's branch tracks no upstream, so there is no latest build to compare with",
    ]);
  });

  it("names a tracking ref that does not resolve", () => {
    const world = worldAt();
    world.git.delete("rev-parse refs/remotes/origin/main");
    const report = read({ world });
    expect(report.upstream).toBe(undefined);
    expect(report.problems).toEqual(["origin/main could not be resolved"]);
  });

  it("names a drift it could not count", () => {
    const world = worldAt();
    world.git.delete(`rev-list --left-right --count ${SHA_A}...HEAD`);
    const report = read({ world });
    expect(report.upstream).toBe(undefined);
    expect(report.problems).toEqual(["origin/main could not be compared with HEAD"]);
  });

  it("keeps the upstream but names a history it could not read", () => {
    const world = worldAt();
    world.git.delete(`log --first-parent -n ${String(MAINLINE_LIMIT + 1)} --format=${MAINLINE_FORMAT} ${SHA_A}`);
    const report = read({ world });
    expect(report.upstream!.sha).toBe(SHA_A);
    expect(report.mainline.commits).toEqual([]);
    expect(report.problems).toEqual(["origin/main's history could not be read"]);
  });

  it("marks which of the window's commits change the desktop app, and which the console or its voice", () => {
    const report = read({ world: worldAt() });
    expect(report.mainline.commits.map((commit) => [commit.changesShell, commit.changesConsole])).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it("bounds a cut window's app-change and console-change reads to the window", () => {
    const world = worldAt();
    const many = Array.from({ length: MAINLINE_LIMIT + 1 }, (_, at) =>
      [at === 0 ? SHA_A : at.toString(16).padStart(40, "0"), "2026-09-28T06:00:00+00:00", "x"].join(LOG_FIELD),
    ).join("\n");
    world.git.set(`log --first-parent -n ${String(MAINLINE_LIMIT + 1)} --format=${MAINLINE_FORMAT} ${SHA_A}`, many);
    for (const pathspec of [SHELL_PATHSPEC, CONSOLE_PATHSPEC]) {
      world.git.set(pathChangeLogArgs({ limit: MAINLINE_LIMIT, pathspec, sha: SHA_A, truncated: true }).join(" "), "");
    }
    const report = read({ world });
    expect(report.problems).toEqual([]);
    expect(report.mainline.truncated).toBe(true);
    expect(report.mainline.commits.filter((commit) => commit.changesShell === false).length).toBe(MAINLINE_LIMIT);
    expect(report.mainline.commits.filter((commit) => commit.changesConsole === false).length).toBe(MAINLINE_LIMIT);
  });

  it("names app changes it could not read, leaving that flag unknown and the console's answer standing", () => {
    const world = worldAt();
    world.git.delete(SHELL_LOG);
    const report = read({ world });
    expect(report.mainline.commits.map((commit) => [commit.changesShell, commit.changesConsole])).toEqual([
      [undefined, false],
      [undefined, true],
    ]);
    expect(report.problems).toEqual(["which of origin/main's commits change the desktop app could not be read"]);
  });

  it("names console changes it could not read, leaving that flag unknown and the app's answer standing", () => {
    const world = worldAt();
    world.git.set(CONSOLE_LOG, "fatal: bad revision");
    const report = read({ world });
    expect(report.mainline.commits.map((commit) => [commit.changesShell, commit.changesConsole])).toEqual([
      [true, undefined],
      [false, undefined],
    ]);
    expect(report.problems).toEqual([
      "which of origin/main's commits change the console or its voice could not be read",
    ]);
  });

  it("names a HEAD it could not read", () => {
    const world = worldAt();
    world.git.delete("rev-parse HEAD");
    const report = read({ world });
    expect(report.head).toBe(undefined);
    expect(report.problems).toEqual(["HEAD could not be read"]);
  });
});
