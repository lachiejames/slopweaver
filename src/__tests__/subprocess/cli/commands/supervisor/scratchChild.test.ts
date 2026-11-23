/**
 * The child launcher every tick reading and refresh runs through, against real processes: output lands in its
 * two files, a spent budget is its own named outcome with the child killed, and a binary that is not there
 * says it did not start rather than reading as an exit code.
 */
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  runBoundedChild,
  runBoundedChildWithStderr,
  runChildToFiles,
} from "../../../../../cli/commands/supervisor/scratchChild.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "scratch-child-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("runChildToFiles", () => {
  it("streams stdout and stderr to their files and reports the exit", async () => {
    const outcome = await runChildToFiles({
      argv: ["-c", "echo out; echo err >&2; exit 3"],
      bin: "/bin/sh",
      stderrPath: join(dir, "err"),
      stdoutPath: join(dir, "out"),
      timeoutMs: 10_000,
    });

    expect(outcome.kind).toBe("exited");
    expect(outcome).toMatchObject({ exitCode: 3 });
    expect(readFileSync(join(dir, "out"), "utf8")).toBe("out\n");
    expect(readFileSync(join(dir, "err"), "utf8")).toBe("err\n");
  });

  it("replaces a link at an output path rather than writing through it", async () => {
    writeFileSync(join(dir, "precious"), "keep me\n");
    symlinkSync("precious", join(dir, "err"));

    await runChildToFiles({
      argv: ["-c", "echo err >&2"],
      bin: "/bin/sh",
      stderrPath: join(dir, "err"),
      stdoutPath: join(dir, "out"),
      timeoutMs: 10_000,
    });

    expect(readFileSync(join(dir, "precious"), "utf8")).toBe("keep me\n");
    expect(lstatSync(join(dir, "err")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(dir, "err"), "utf8")).toBe("err\n");
  });

  it("replaces a hard link at an output path rather than truncating the inode it shares", async () => {
    writeFileSync(join(dir, "precious"), "keep me\n");
    linkSync(join(dir, "precious"), join(dir, "err"));

    await runChildToFiles({
      argv: ["-c", "echo err >&2"],
      bin: "/bin/sh",
      stderrPath: join(dir, "err"),
      stdoutPath: join(dir, "out"),
      timeoutMs: 10_000,
    });

    expect(readFileSync(join(dir, "precious"), "utf8")).toBe("keep me\n");
    expect(readFileSync(join(dir, "err"), "utf8")).toBe("err\n");
  });

  it("kills a child that overruns its budget and names the budget", async () => {
    const outcome = await runChildToFiles({
      argv: ["-c", "sleep 30"],
      bin: "/bin/sh",
      stderrPath: join(dir, "err"),
      stdoutPath: join(dir, "out"),
      timeoutMs: 200,
    });

    expect(outcome).toMatchObject({ kind: "timed-out", signal: "SIGKILL", timeoutMs: 200 });
    expect(outcome.durationMs).toBeLessThan(10_000);
  });

  it("says a missing binary did not start", async () => {
    const outcome = await runChildToFiles({
      argv: [],
      bin: join(dir, "no-such-binary"),
      stderrPath: join(dir, "err"),
      stdoutPath: join(dir, "out"),
      timeoutMs: 10_000,
    });

    expect(outcome.kind).toBe("launch-failed");
    expect(readFileSync(join(dir, "err"), "utf8")).toContain("ENOENT");
  });

  it("runs the child in the directory it is given", async () => {
    const where = mkdtempSync(join(dir, "cwd-"));
    await runChildToFiles({
      argv: ["-c", "pwd -P"],
      bin: "/bin/sh",
      cwd: where,
      stderrPath: join(dir, "err"),
      stdoutPath: join(dir, "out"),
      timeoutMs: 10_000,
    });
    expect(readFileSync(join(dir, "out"), "utf8")).toBe(`${realpathSync(where)}\n`);
  });

  it("says a child given a directory that is not there did not start", async () => {
    const outcome = await runChildToFiles({
      argv: ["-c", "exit 0"],
      bin: "/bin/sh",
      cwd: join(dir, "no-such-worktree"),
      stderrPath: join(dir, "err"),
      stdoutPath: join(dir, "out"),
      timeoutMs: 10_000,
    });
    expect(outcome.kind).toBe("launch-failed");
  });
});

describe("runBoundedChild", () => {
  /** The throwaway output directories standing in this file's temp root. */
  function childDirs(): readonly string[] {
    return readdirSync(tmpdir()).filter((name) => name.startsWith("slopweaver-child-"));
  }

  it("reports how the child ended and leaves no output directory behind", async () => {
    const outcome = await runBoundedChild({ argv: ["-c", "echo out; exit 4"], bin: "/bin/sh", timeoutMs: 10_000 });
    expect(outcome).toMatchObject({ exitCode: 4, kind: "exited" });
    expect(childDirs()).toEqual([]);
  });

  it("removes its directory after a spent budget too", async () => {
    const outcome = await runBoundedChild({ argv: ["-c", "sleep 30"], bin: "/bin/sh", timeoutMs: 200 });
    expect(outcome).toMatchObject({ kind: "timed-out", timeoutMs: 200 });
    expect(childDirs()).toEqual([]);
  });
});

describe("runBoundedChildWithStderr", () => {
  /** The throwaway output directories standing in this file's temp root. */
  function childDirs(): readonly string[] {
    return readdirSync(tmpdir()).filter((name) => name.startsWith("slopweaver-child-"));
  }

  it("keeps a refusal's whole stderr beside the exit, and leaves no output directory behind", async () => {
    const child = await runBoundedChildWithStderr({
      argv: ["-c", "echo out; printf 'refused:\\n  because\\n' >&2; exit 1"],
      bin: "/bin/sh",
      stderrMaxBytes: 1024,
      timeoutMs: 10_000,
    });
    expect(child.outcome).toMatchObject({ exitCode: 1, kind: "exited" });
    expect([child.stderr, child.stderrBytes, child.stderrTruncated]).toEqual(["refused:\n  because\n", 19, false]);
    expect(childDirs()).toEqual([]);
  });

  it("keeps only the cap's worth of a long stderr, says it was cut, and never splits a character", async () => {
    // 4 ASCII bytes then "é" (2 bytes) straddling a 5-byte cap: the split character is dropped, not mangled.
    const child = await runBoundedChildWithStderr({
      argv: ["-c", "printf 'abcd\\303\\251xyz' >&2; exit 1"],
      bin: "/bin/sh",
      stderrMaxBytes: 5,
      timeoutMs: 10_000,
    });
    expect([child.stderr, child.stderrBytes, child.stderrKeptBytes, child.stderrTruncated]).toEqual([
      "abcd",
      9,
      4,
      true,
    ]);
  });

  // Each invalid byte decodes to a three-byte U+FFFD, so a count re-encoded from the text read 3x the truth.
  it("counts the raw bytes kept, never the decoded text re-encoded, when stderr is not UTF-8", async () => {
    const child = await runBoundedChildWithStderr({
      argv: ["-c", "printf '\\377\\377\\377\\377\\377\\377' >&2; exit 1"],
      bin: "/bin/sh",
      stderrMaxBytes: 4,
      timeoutMs: 10_000,
    });
    expect([child.stderr, child.stderrBytes, child.stderrKeptBytes, child.stderrTruncated]).toEqual([
      "����",
      6,
      4,
      true,
    ]);
  });

  // A cleanup that fails after the child ran must not replace its outcome with a rejection.
  it("resolves with the child's outcome when its directory cannot be removed after", async () => {
    const sandbox = process.env["TMPDIR"]!;
    const root = mkdtempSync(join(dir, "locked-"));
    process.env["TMPDIR"] = root;
    try {
      const child = await runBoundedChildWithStderr({
        argv: ["-c", `chmod 0555 '${root}'; exit 0`],
        bin: "/bin/sh",
        stderrMaxBytes: 1024,
        timeoutMs: 10_000,
      });
      expect(child.outcome).toMatchObject({ exitCode: 0, kind: "exited" });
    } finally {
      process.env["TMPDIR"] = sandbox;
      chmodSync(root, 0o755);
    }
  });

  // A default decoder strips a leading byte-order mark, so a stderr of only that read as nothing at all.
  it("keeps a leading byte-order mark as text", async () => {
    const child = await runBoundedChildWithStderr({
      argv: ["-c", "printf '\\357\\273\\277' >&2; exit 1"],
      bin: "/bin/sh",
      stderrMaxBytes: 1024,
      timeoutMs: 10_000,
    });
    expect([child.stderr, child.stderrBytes, child.stderrTruncated]).toEqual(["﻿", 3, false]);
  });

  // A streaming decode of a whole read held back a dangling lead byte, so one byte read as nothing.
  it("decodes a dangling byte at the end of a whole stderr as a replacement character", async () => {
    const child = await runBoundedChildWithStderr({
      argv: ["-c", "printf 'x\\303' >&2; exit 1"],
      bin: "/bin/sh",
      stderrMaxBytes: 1024,
      timeoutMs: 10_000,
    });
    expect([child.stderr, child.stderrBytes, child.stderrTruncated]).toEqual(["x�", 2, false]);
  });

  it("removes its directory after a spent budget, a missing binary, and a child that printed nothing", async () => {
    const timedOut = await runBoundedChildWithStderr({
      argv: ["-c", "sleep 30"],
      bin: "/bin/sh",
      stderrMaxBytes: 1024,
      timeoutMs: 200,
    });
    const missing = await runBoundedChildWithStderr({
      argv: [],
      bin: join(dir, "no-such-binary"),
      stderrMaxBytes: 1024,
      timeoutMs: 10_000,
    });
    const quiet = await runBoundedChildWithStderr({
      argv: ["-c", "exit 0"],
      bin: "/bin/sh",
      stderrMaxBytes: 1024,
      timeoutMs: 10_000,
    });
    expect([timedOut.outcome.kind, missing.outcome.kind, quiet.stderr, quiet.stderrBytes]).toEqual([
      "timed-out",
      "launch-failed",
      "",
      0,
    ]);
    expect(missing.stderr).toContain("ENOENT");
    expect(childDirs()).toEqual([]);
  });

  // A failure setting up the child's output is a child that did not start, never a rejection.
  it("names a child whose output directory could not be made as one that did not start", async () => {
    const sandbox = process.env["TMPDIR"]!;
    process.env["TMPDIR"] = join(dir, "no-such-temp-root");
    try {
      const child = await runBoundedChildWithStderr({
        argv: ["-c", "exit 0"],
        bin: "/bin/sh",
        stderrMaxBytes: 1024,
        timeoutMs: 10_000,
      });
      expect([child.outcome.kind, child.stderr, child.stderrBytes]).toEqual(["launch-failed", "", 0]);
      expect(child.outcome).toMatchObject({ message: expect.stringContaining("ENOENT") });
    } finally {
      process.env["TMPDIR"] = sandbox;
    }
  });
});
