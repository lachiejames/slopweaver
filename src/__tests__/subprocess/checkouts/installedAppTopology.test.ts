/**
 * `checkout console`'s installed-app comparison over a real repository with a real squash topology — the shape
 * that misled the sidebar: an app installed from a pull request's PRE-SQUASH branch head, a commit on
 * no first-parent line, whose app source was byte-identical to origin/main's. Fake git answers cannot prove the
 * range and pathspec semantics; this runs the real reader, real fetch included, against a local bare remote.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { productionConsoleBuildDeps } from "../../../checkouts/consoleBuildDeps.js";
import { readConsoleBuild } from "../../../checkouts/consoleBuildRead.js";
import { STAMP_KEYS } from "../../../desktop/buildStamp.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp directory, removed after the test. */
function tempDir({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  fixtureDirs.push(dir);
  return dir;
}

/** Write one file and commit it, returning the new commit. */
function commitFile({ cwd, path, text }: { cwd: string; path: string; text: string }): string {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), text);
  gitInTemp({ args: ["add", "-A"], cwd });
  gitInTemp({ args: ["commit", "-q", "-m", `edit ${path}`], cwd });
  return gitInTemp({ args: ["rev-parse", "HEAD"], cwd });
}

/** An installed bundle's `Info.plist` stamped with a clean build of `sha`. */
function plistFor({ sha }: { sha: string }): string {
  return [
    `<key>${STAMP_KEYS.sha}</key><string>${sha}</string>`,
    `<key>${STAMP_KEYS.committedIso}</key><string>2026-10-08T06:48:50Z</string>`,
    `<key>${STAMP_KEYS.tree}</key><string>clean</string>`,
  ].join("\n");
}

/**
 * A checkout on main tracking a bare origin, with a pull request's branch head (`prebuilt`) and its squash on main
 * that ALSO carries a later commit's non-app edit, so the two trees differ while the app source does not.
 */
function squashWorld(): { work: string; cacheRoot: string; prebuilt: string; fork: string; root: string } {
  const origin = tempDir({ prefix: "sw-origin-" });
  gitInTemp({ args: ["init", "-q", "--bare", "-b", "main"], cwd: origin });
  const work = tempDir({ prefix: "sw-work-" });
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: work });
  gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: work });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: work });
  const root = commitFile({ cwd: work, path: "desktop/src/main.ts", text: "shell v1\n" });
  const fork = commitFile({ cwd: work, path: "site/page.ts", text: "page v1\n" });
  gitInTemp({ args: ["remote", "add", "origin", origin], cwd: work });
  gitInTemp({ args: ["push", "-q", "-u", "origin", "main"], cwd: work });
  gitInTemp({ args: ["checkout", "-q", "-b", "orb"], cwd: work });
  const prebuilt = commitFile({ cwd: work, path: "site/orb.ts", text: "points of light\n" });
  commitFile({ cwd: work, path: "site/orb.ts", text: "points of light, with a slider\n" });
  gitInTemp({ args: ["checkout", "-q", "main"], cwd: work });
  gitInTemp({ args: ["merge", "-q", "--squash", "orb"], cwd: work });
  gitInTemp({ args: ["commit", "-q", "-m", "The orb draws points of light (#1977)"], cwd: work });
  commitFile({ cwd: work, path: "site/later.ts", text: "a later landing\n" });
  gitInTemp({ args: ["push", "-q", "origin", "main"], cwd: work });
  return { cacheRoot: tempDir({ prefix: "sw-cache-" }), fork, prebuilt, root, work };
}

/** The real reader over the world, the installed app stamped at `installed`. */
function readWith({
  world,
  installed,
  nowMs,
}: {
  world: ReturnType<typeof squashWorld>;
  installed: string;
  nowMs: number;
}): ReturnType<typeof readConsoleBuild> {
  const deps = {
    ...productionConsoleBuildDeps(),
    installedPlist: () => ({ kind: "read", text: plistFor({ sha: installed }) }) as const,
  };
  return readConsoleBuild({ cacheRoot: world.cacheRoot, cwd: world.work, deps, nowMs });
}

describe("installed app against origin/main, by content", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("calls a pre-squash build current when no landing since touched the app — the fold", () => {
    const world = squashWorld();
    const report = readWith({ installed: world.prebuilt, nowMs: Date.now(), world });
    const onLine = report.mainline.commits.map((commit) => commit.sha);
    expect(onLine.includes(world.prebuilt)).toBe(false);
    expect(report.installedApp).toEqual({
      forkSha: undefined,
      kind: "read",
      shellDiffers: false,
      stamp: { committedIso: "2026-10-08T06:48:50Z", sha: world.prebuilt, tree: "clean" },
    });
  });

  it("names a new version once a landing changes the app, with the fork it is placed by", () => {
    const world = squashWorld();
    const change = commitFile({ cwd: world.work, path: "desktop/src/main.ts", text: "shell v2\n" });
    gitInTemp({ args: ["push", "-q", "origin", "main"], cwd: world.work });
    const report = readWith({ installed: world.prebuilt, nowMs: Date.now(), world });
    expect(report.installedApp).toEqual({
      forkSha: world.fork,
      kind: "read",
      shellDiffers: true,
      stamp: { committedIso: "2026-10-08T06:48:50Z", sha: world.prebuilt, tree: "clean" },
    });
    // The window here is the whole history, so the root commit that created the app is flagged too; the page lists
    // only what lies after the fork it places the build by.
    const changing = report.mainline.commits.filter((commit) => commit.changesShell === true);
    expect(changing.map((commit) => commit.sha)).toEqual([change, world.root]);
  });

  it("calls an app current again when a later landing puts its source back", () => {
    const world = squashWorld();
    commitFile({ cwd: world.work, path: "desktop/src/main.ts", text: "shell v2\n" });
    commitFile({ cwd: world.work, path: "desktop/src/main.ts", text: "shell v1\n" });
    gitInTemp({ args: ["push", "-q", "origin", "main"], cwd: world.work });
    const report = readWith({ installed: world.prebuilt, nowMs: Date.now(), world });
    expect(report.installedApp).toEqual({
      forkSha: undefined,
      kind: "read",
      shellDiffers: false,
      stamp: { committedIso: "2026-10-08T06:48:50Z", sha: world.prebuilt, tree: "clean" },
    });
  });
});
