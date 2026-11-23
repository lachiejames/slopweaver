/**
 * `storeDirLive.ts` over a real temp directory: the directory a store path names on disk, and the Codex home a
 * new row's add creates. A genuine round trip — a `mkdtempSync` directory written and read back, removed after
 * each case (`.claude/rules/testing.md`). `run.test.ts` drives the add's refusals through the verb.
 */
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureStoreDirLive, resolveStoreLive } from "../../../../../cli/commands/plans/storeDirLive.js";
import { unwrap } from "../../../../../lib/result.js";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "store-dir-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("resolveStoreLive", () => {
  it("answers nothing for a store path with no directory behind it", () => {
    expect(resolveStoreLive({ storeDir: join(root, "absent") })).toBeUndefined();
  });

  it("names one directory the same through a second path to it, and two directories apart", () => {
    const one = join(root, "one");
    const two = join(root, "two");
    const alias = join(root, "alias-of-one");
    mkdirSync(one);
    mkdirSync(two);
    symlinkSync(one, alias);

    const { dev, ino } = statSync(one);
    expect(resolveStoreLive({ storeDir: one })).toBe(`${String(dev)}:${String(ino)}`);
    expect(resolveStoreLive({ storeDir: alias })).toBe(resolveStoreLive({ storeDir: one }));
    expect(resolveStoreLive({ storeDir: two })).not.toBe(resolveStoreLive({ storeDir: one }));
  });
});

describe("ensureStoreDirLive", () => {
  it("leaves a directory already there as it was, and says so", () => {
    const home = join(root, "codex-home");
    mkdirSync(home, { mode: 0o755 });

    expect(unwrap(ensureStoreDirLive({ storeDir: home }))).toBe("existed");
    expect(statSync(home).mode & 0o777).toBe(0o755);
  });

  it("creates every missing parent of an absent home, the home itself 0700", () => {
    const home = join(root, "nested", "deeper", "codex-home");

    expect(unwrap(ensureStoreDirLive({ storeDir: home }))).toBe("created");
    expect(statSync(home).isDirectory()).toBe(true);
    expect(statSync(home).mode & 0o777).toBe(0o700);
  });
});
