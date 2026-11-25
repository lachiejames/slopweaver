/**
 * The Recovery check's scratch directories, over a throwaway home: fresh and owner-only, never through a link, and
 * cleared whole.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearRecoveryScratch, makeRecoveryScratch, recoveryScratchRoot } from "../../../fleet/recoveryScratch.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "recovery-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("makeRecoveryScratch", () => {
  it("makes an empty owner-only directory whose last segment never changes", () => {
    const first = unwrap(makeRecoveryScratch({ attemptId: "run-1-1", home }));
    const second = unwrap(makeRecoveryScratch({ attemptId: "run-1-2", home }));
    expect(first).toBe(join(home, "sessions", "recovery-scratch", "run-1-1", "fleet-recovery"));
    expect(second).toBe(join(home, "sessions", "recovery-scratch", "run-1-2", "fleet-recovery"));
    expect(readdirSync(first)).toEqual([]);
    expect(statSync(first).mode & 0o777).toBe(0o700);
  });

  it("refuses an attempt whose directory is already there rather than sharing it", () => {
    unwrap(makeRecoveryScratch({ attemptId: "run-1-1", home }));
    expect(unwrapErr(makeRecoveryScratch({ attemptId: "run-1-1", home })).code).toBe("IO_FAILED");
  });

  it("refuses to make anything through a link on the way down", () => {
    const elsewhere = join(home, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(home, "sessions"));
    const refused = unwrapErr(makeRecoveryScratch({ attemptId: "run-1-1", home }));
    expect(refused).toEqual({
      code: "SCRATCH_LINKED",
      message: `${join(home, "sessions")} is a link, so the Recovery check neither made nor removed anything through it`,
      path: join(home, "sessions"),
    });
    expect(readdirSync(elsewhere)).toEqual([]);
  });
});

describe("clearRecoveryScratch", () => {
  it("removes every attempt's directory and keeps the root", () => {
    const directory = unwrap(makeRecoveryScratch({ attemptId: "run-1-1", home }));
    writeFileSync(join(directory, "left.txt"), "a session wrote this");
    unwrap(makeRecoveryScratch({ attemptId: "run-2-1", home }));
    expect(clearRecoveryScratch({ home }).isOk()).toBe(true);
    expect(readdirSync(recoveryScratchRoot({ home }))).toEqual([]);
  });

  it("succeeds on a home that never ran a check", () => {
    expect(clearRecoveryScratch({ home }).isOk()).toBe(true);
    expect(existsSync(recoveryScratchRoot({ home }))).toBe(true);
  });

  it("removes a link inside the scratch without touching what it names", () => {
    const elsewhere = join(home, "elsewhere");
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, "kept.txt"), "kept");
    mkdirSync(recoveryScratchRoot({ home }), { recursive: true });
    symlinkSync(elsewhere, join(recoveryScratchRoot({ home }), "run-1-1"));
    expect(clearRecoveryScratch({ home }).isOk()).toBe(true);
    expect(readdirSync(elsewhere)).toEqual(["kept.txt"]);
  });
});
