/*
 * Judging what occupies a lock path, each shape seeded on disk under a throwaway directory: nothing there, a
 * directory holding two files, a lock directory whose holder aged out, and a plain-file lock whose holder aged
 * out. Every record is older than the threshold, so no case reaches the liveness probe.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { judgeOccupant } from "../../../admit/operationLockTakeover.js";

const RECORD = JSON.stringify({ acquiredAtIso: "2026-10-22T00:00:00Z", pid: 4242 });
const NOW_ISO = "2026-10-22T00:00:10Z";
const STALE_AFTER_MS = 5000;

let dir: string;
let path: string;
let candidate: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lock-takeover-"));
  path = join(dir, "key.lock");
  candidate = join(dir, "key.lock.candidate-1");
  mkdirSync(candidate);
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("judgeOccupant", () => {
  it("goes round again, clearing nothing, when the path is already empty", () => {
    expect(judgeOccupant({ candidate, nowIso: NOW_ISO, path, staleAfterMs: STALE_AFTER_MS })).toEqual({
      clearedPid: undefined,
      kind: "again",
    });
  });

  it("refuses a lock directory it cannot read, leaving it in place", () => {
    mkdirSync(path);
    writeFileSync(join(path, "tok-1"), RECORD);
    writeFileSync(join(path, "tok-2"), RECORD);

    const outcome = judgeOccupant({ candidate, nowIso: NOW_ISO, path, staleAfterMs: STALE_AFTER_MS });

    expect(outcome).toEqual({
      kind: "refuse",
      reason: {
        code: "LOCK_REFUSED",
        message: `a lock already exists at ${path} and could not be read to check its age`,
      },
    });
    expect(readdirSync(path).toSorted()).toEqual(["tok-1", "tok-2"]);
  });

  it("clears an aged-out lock directory by its holder's token file, naming the pid it cleared", () => {
    mkdirSync(path);
    writeFileSync(join(path, "tok-1"), RECORD);

    const outcome = judgeOccupant({ candidate, nowIso: NOW_ISO, path, staleAfterMs: STALE_AFTER_MS });

    expect(outcome).toEqual({ clearedPid: 4242, kind: "again" });
    expect(existsSync(path)).toBe(false);
  });

  it("clears an aged-out plain-file lock through the candidate, leaving the candidate empty", () => {
    writeFileSync(path, RECORD);

    const outcome = judgeOccupant({ candidate, nowIso: NOW_ISO, path, staleAfterMs: STALE_AFTER_MS });

    expect(outcome).toEqual({ clearedPid: 4242, kind: "again" });
    expect(existsSync(path)).toBe(false);
    expect(readdirSync(candidate)).toEqual([]);
  });
});
