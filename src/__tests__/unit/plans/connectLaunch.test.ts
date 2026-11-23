/**
 * `launchConnectWorker`'s refusals, which come before anything is spawned: a launcher that is not an absolute path
 * to an executable file never reaches the shell, and the caller is told why. Two cases do launch: one removes its
 * home the instant the launch answers, because the backgrounded child once recreated its log under that removal,
 * and one hands the shell a log it cannot open, which must still launch.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { launchConnectWorker } from "../../../plans/connectLaunch.js";

describe("launchConnectWorker", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "connect-launch-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a launcher that is not an absolute path", () => {
    const launched = launchConnectWorker({
      home,
      id: "0123abcd4567ef89",
      launcher: "bin/slopweaver",
      logPath: join(home, "worker.log"),
    });

    const failure = unwrapErr(launched);
    expect(failure.code).toBe("CONNECTION_LAUNCH_FAILED");
    expect(failure.message).toContain("bin/slopweaver is not an executable launcher");
  });

  it("refuses an absolute path to a file this process may not execute", () => {
    const launcher = join(home, "slopweaver");
    writeFileSync(launcher, "#!/bin/sh\n", { mode: 0o644 });

    const launched = launchConnectWorker({ home, id: "0123abcd4567ef89", launcher, logPath: join(home, "worker.log") });

    const failure = unwrapErr(launched);
    expect(failure.code).toBe("CONNECTION_LAUNCH_FAILED");
    expect(failure.message).toContain(`${launcher} is not an executable launcher`);
  });

  it("answers once the launching shell has backgrounded an executable launcher, leaving the home removable at once", () => {
    // The launcher lives outside the home, so removing the home leaves the child's exec of it untouched.
    const bin = mkdtempSync(join(tmpdir(), "connect-launch-bin-"));
    const launcher = join(bin, "slopweaver");
    writeFileSync(launcher, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    try {
      const launched = launchConnectWorker({
        home,
        id: "0123abcd4567ef89",
        launcher,
        logPath: join(home, "worker.log"),
      });

      expect(launched.isOk()).toBe(true);
      expect(unwrap(launched)).toBe(undefined);
      // The log is already open when the launch answers, so the backgrounded child cannot recreate it under a removal.
      rmSync(home, { force: true, recursive: true });
      expect(existsSync(home)).toBe(false);
    } finally {
      rmSync(bin, { force: true, recursive: true });
    }
  });

  it("still answers when the shell cannot open the log, falling back to /dev/null rather than ending the shell", () => {
    // A directory where the log should be: the foreground shell's own open of it fails.
    const bin = mkdtempSync(join(tmpdir(), "connect-launch-bin-"));
    const launcher = join(bin, "slopweaver");
    writeFileSync(launcher, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const logPath = join(home, "worker.log");
    mkdirSync(logPath);

    try {
      const launched = launchConnectWorker({ home, id: "0123abcd4567ef89", launcher, logPath });

      expect(launched.isOk()).toBe(true);
      expect(unwrap(launched)).toBe(undefined);
    } finally {
      rmSync(bin, { force: true, recursive: true });
    }
  });

  it("refuses a directory, which is executable but not a file", () => {
    const launched = launchConnectWorker({
      home,
      id: "0123abcd4567ef89",
      launcher: home,
      logPath: join(home, "worker.log"),
    });

    expect(unwrapErr(launched).code).toBe("CONNECTION_LAUNCH_FAILED");
  });
});
