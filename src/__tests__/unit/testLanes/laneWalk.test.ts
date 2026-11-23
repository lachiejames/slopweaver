/**
 * The lane walk over a real temporary tree, per `.claude/rules/testing.md`'s fixture allowance: the subject is
 * what the filesystem answers for an unreadable directory, which a fake would only restate.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unreadableLaneDirectories } from "../../../testLanes/laneWalk.js";

const ROOTS = ["site/__tests__/unit"];
let cwd: string;
const locked: string[] = [];

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "lane-walk-"));
  mkdirSync(join(cwd, "site", "__tests__", "unit"), { recursive: true });
  writeFileSync(join(cwd, "site", "__tests__", "unit", "a.test.ts"), "");
});

afterEach(() => {
  for (const dir of locked.splice(0)) {
    chmodSync(dir, 0o755);
  }
  rmSync(cwd, { force: true, recursive: true });
});

/** Make a directory under the lane root holding one test, then lock it. */
function lockedDirectory({ relative }: { relative: string }): string {
  const dir = join(cwd, "site", "__tests__", "unit", relative);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "secret.test.ts"), "");
  chmodSync(dir, 0o000);
  locked.push(dir);
  return dir;
}

describe("unreadableLaneDirectories", () => {
  it("names a directory under a lane root that cannot be read, ignored by git or not", () => {
    const dir = lockedDirectory({ relative: "hidden" });
    const lines = unreadableLaneDirectories({ cwd, roots: ROOTS });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain(`${dir}: Error: EACCES`);
  });

  it("names a symlink into an unreadable directory, which Vitest's walk follows", () => {
    const dir = join(cwd, "elsewhere");
    mkdirSync(dir);
    writeFileSync(join(dir, "secret.test.ts"), "");
    chmodSync(dir, 0o000);
    locked.push(dir);
    const link = join(cwd, "site", "__tests__", "unit", "link");
    symlinkSync(dir, link);
    const lines = unreadableLaneDirectories({ cwd, roots: ROOTS });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain(`${link}: Error: EACCES`);
  });

  it("walks a readable tree with a dot directory and answers nothing", () => {
    mkdirSync(join(cwd, "site", "__tests__", "unit", ".cache"));
    writeFileSync(join(cwd, "site", "__tests__", "unit", ".cache", "b.test.ts"), "");
    expect(unreadableLaneDirectories({ cwd, roots: ROOTS })).toEqual([]);
  });

  it("never enters node_modules, which Vitest's default exclude drops", () => {
    lockedDirectory({ relative: "node_modules" });
    expect(unreadableLaneDirectories({ cwd, roots: ROOTS })).toEqual([]);
  });

  it("ends at a symlink cycle and skips a dangling link", () => {
    symlinkSync(join(cwd, "site", "__tests__", "unit"), join(cwd, "site", "__tests__", "unit", "loop"));
    symlinkSync(join(cwd, "gone"), join(cwd, "site", "__tests__", "unit", "dangling"));
    expect(unreadableLaneDirectories({ cwd, roots: ROOTS })).toEqual([]);
  });

  it("lets a root that does not exist go, since it holds no test", () => {
    expect(unreadableLaneDirectories({ cwd, roots: ["desktop/__tests__/unit"] })).toEqual([]);
  });
});
