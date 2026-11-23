/**
 * The two local readings `slopweaver wait` compares: a pid (this very process is alive) and a file (a real
 * temp-dir round trip).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { fileSettled, readFileForWait, readPid } from "../../../wait/probes.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp directory, removed after the test. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wait-probe-"));
  dirs.push(dir);
  return dir;
}

describe("readPid", () => {
  it("reads this process as alive", () => {
    expect(readPid({ pid: process.pid })).toEqual({ kind: "alive" });
  });

  it("reads a pid past the kernel's range as exited", () => {
    expect(readPid({ pid: 2_147_483_000 })).toEqual({ kind: "exited" });
  });
});

describe("readFileForWait", () => {
  it("reads a missing file as absent", () => {
    expect(readFileForWait({ contains: undefined, path: join(tempDir(), "nope.log") })).toEqual({ kind: "absent" });
  });

  it("reads whether an existing file carries the marker", () => {
    const path = join(tempDir(), "run.log");
    writeFileSync(path, "step 1\nstep 2\n");
    expect(readFileForWait({ contains: "DONE", path })).toEqual({ kind: "present", matched: false });
    writeFileSync(path, "step 1\nstep 2\nDONE\n");
    expect(readFileForWait({ contains: "DONE", path })).toEqual({ kind: "present", matched: true });
  });
});

describe("fileSettled", () => {
  it("waits on an absent file", () => {
    expect(fileSettled({ contains: undefined, reading: { kind: "absent" } })).toBe(false);
  });

  it("settles on a present file when no marker was asked for", () => {
    expect(fileSettled({ contains: undefined, reading: { kind: "present", matched: true } })).toBe(true);
  });

  it("waits on a present file that does not carry the marker yet", () => {
    expect(fileSettled({ contains: "DONE", reading: { kind: "present", matched: false } })).toBe(false);
  });

  it("settles on an unreadable file rather than spinning on it", () => {
    expect(fileSettled({ contains: "DONE", reading: { kind: "unreadable", reason: "EACCES" } })).toBe(true);
  });
});
