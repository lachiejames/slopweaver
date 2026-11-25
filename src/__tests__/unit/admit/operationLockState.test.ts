/**
 * Reading what stands at a lock path, each shape seeded on disk under a throwaway directory: nothing, a
 * directory with one token file, an empty directory, a directory with two files, a plain-file lock, and a
 * record that does not parse.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readLockState, readPlainFileLock } from "../../../admit/operationLockState.js";

const RECORD = JSON.stringify({ acquiredAtIso: "2026-10-22T00:00:00Z", pid: 4242, start: "Thu Oct 22 00:00:00 2026" });

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lock-state-"));
  path = join(dir, "key.lock");
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("readLockState", () => {
  it("reads a path with nothing at it as absent", () => {
    expect(readLockState({ path })).toEqual({ kind: "absent" });
  });

  it("reads a directory holding one token file as held by that token", () => {
    mkdirSync(path);
    writeFileSync(join(path, "tok-1"), RECORD);
    expect(readLockState({ path })).toEqual({
      holder: {
        contents: { acquiredAtIso: "2026-10-22T00:00:00Z", pid: 4242, start: "Thu Oct 22 00:00:00 2026" },
        token: "tok-1",
      },
      kind: "held",
    });
  });

  it("reads an empty directory as in-flux", () => {
    mkdirSync(path);
    expect(readLockState({ path })).toEqual({ kind: "in-flux" });
  });

  it("reads a directory holding two files as unreadable", () => {
    mkdirSync(path);
    writeFileSync(join(path, "tok-1"), RECORD);
    writeFileSync(join(path, "tok-2"), RECORD);
    expect(readLockState({ path })).toEqual({ kind: "unreadable" });
  });

  it("reads a plain file at the path as held with no token", () => {
    writeFileSync(path, JSON.stringify({ acquiredAtIso: "2026-10-22T00:00:00Z", pid: 4242 }));
    expect(readLockState({ path })).toEqual({
      holder: { contents: { acquiredAtIso: "2026-10-22T00:00:00Z", pid: 4242, start: undefined }, token: undefined },
      kind: "held",
    });
  });

  it("reads a token file whose record does not parse as unreadable", () => {
    mkdirSync(path);
    writeFileSync(join(path, "tok-1"), "{not json");
    expect(readLockState({ path })).toEqual({ kind: "unreadable" });
  });
});

describe("readPlainFileLock", () => {
  it("reads a plain file a peer already removed as absent, so the caller goes round again", () => {
    expect(readPlainFileLock({ path })).toEqual({ kind: "absent" });
  });

  it("reads a directory a peer seated in the file's place as in-flux", () => {
    mkdirSync(path);
    expect(readPlainFileLock({ path })).toEqual({ kind: "in-flux" });
  });

  it("reads a record missing its pid as unreadable rather than a path in motion", () => {
    writeFileSync(path, JSON.stringify({ acquiredAtIso: "2026-10-22T00:00:00Z" }));
    expect(readPlainFileLock({ path })).toEqual({ kind: "unreadable" });
  });
});

describe("a lock record's guardian", () => {
  const GUARDED = {
    acquiredAtIso: "2026-11-25T00:00:00Z",
    guardian: { pid: 5151, start: "Wed Nov  5 09:01:02 2026" },
    pid: 4242,
    start: undefined,
  };

  it("round-trips a guardian the writer recorded, its double-spaced day intact", () => {
    writeFileSync(path, JSON.stringify(GUARDED));
    expect(readPlainFileLock({ path })).toEqual({ holder: { contents: GUARDED, token: undefined }, kind: "held" });
  });

  it("round-trips a record written before the guardian field exactly as it always read", () => {
    writeFileSync(path, RECORD);
    expect(readPlainFileLock({ path })).toEqual({
      holder: {
        contents: { acquiredAtIso: "2026-10-22T00:00:00Z", pid: 4242, start: "Thu Oct 22 00:00:00 2026" },
        token: undefined,
      },
      kind: "held",
    });
  });

  it.each([
    ["a string pid", { pid: "5151", start: "Wed Nov  5 09:01:02 2026" }],
    ["a zero pid", { pid: 0, start: "Wed Nov  5 09:01:02 2026" }],
    ["a fractional pid", { pid: 51.5, start: "Wed Nov  5 09:01:02 2026" }],
    ["a blank stamp", { pid: 5151, start: "  " }],
    ["a missing stamp", { pid: 5151 }],
    ["a non-object", "5151 Wed Nov  5 09:01:02 2026"],
  ])("drops a malformed guardian (%s), reading the record as an unguarded one", (_label, guardian) => {
    writeFileSync(path, JSON.stringify({ ...GUARDED, guardian }));
    expect(readPlainFileLock({ path })).toEqual({
      holder: { contents: { acquiredAtIso: "2026-11-25T00:00:00Z", pid: 4242, start: undefined }, token: undefined },
      kind: "held",
    });
  });
});
