/**
 * The one property a fake cannot show: the caller of the unasked prune — a capacity read, a `PreToolUse` hook —
 * gets control back as soon as the launching shell has backgrounded the command, never when the command has
 * finished. A hook budget is seconds and an apply is up to half an hour, so a launch that waited would turn
 * every tool call of the hour into a hook timeout.
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { launchDetached, launchLogPath, noteLaunch } from "../../../worktree/pruneTriggerDetach.js";
import { productionPruneTriggerDeps } from "../../../worktree/pruneTriggerLaunch.js";

let dir = "";

/** Launch-then-remove rounds: one round rarely loses the race, so the witness is a bounded loop. */
const LAUNCH_THEN_REMOVE_ITERATIONS = 200;

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("launchDetached", () => {
  it("returns before a command that runs for seconds has finished", () => {
    dir = mkdtempSync(join(tmpdir(), "prune-detach-"));
    const startedMs = Date.now();
    const launched = launchDetached({
      argv: ["/bin/sleep", "3"],
      cwd: dir,
      env: process.env,
      logPath: join(dir, "log"),
      markerPath: join(dir, "window"),
    });
    const elapsedMs = Date.now() - startedMs;
    expect(unwrap(launched)).toBe(undefined);
    expect(elapsedMs).toBeLessThan(2_000);
  });

  it("appends the command's output to the log, with argv reaching it as arguments rather than shell", async () => {
    dir = mkdtempSync(join(tmpdir(), "prune-detach-"));
    const log = join(dir, "log");
    unwrap(
      launchDetached({
        argv: ["/bin/echo", "free=49GB; $(touch nope)"],
        cwd: dir,
        env: process.env,
        logPath: log,
        markerPath: join(dir, "window"),
      }),
    );
    expect(await waitForContent({ path: log, withinMs: 5_000 })).toBe("free=49GB; $(touch nope)\n");
    expect(existsSync(join(dir, "nope"))).toBe(false);
  });

  it("leaves the log's directory removable the instant the launch answers, so the job never recreates the log", () => {
    // Measured on the by-path redirect this replaced: 12 and 24 of 300 iterations failed ENOTEMPTY, each directory
    // holding only a fresh `log`. At that rate every one of these iterations passing on that code is vanishingly rare.
    const failures: string[] = [];
    for (let iteration = 0; iteration < LAUNCH_THEN_REMOVE_ITERATIONS; iteration += 1) {
      const home = mkdtempSync(join(tmpdir(), "prune-detach-remove-"));
      unwrap(
        launchDetached({
          argv: ["/usr/bin/true"],
          cwd: tmpdir(),
          env: process.env,
          logPath: join(home, "log"),
          markerPath: join(home, "window"),
        }),
      );
      try {
        rmSync(home, { recursive: true });
      } catch {
        failures.push(readdirSync(home).join(","));
        rmSync(home, { force: true, maxRetries: 5, recursive: true });
      }
    }
    expect(failures).toEqual([]);
  });

  it("refuses a bare name the shell would resolve to an imported function", () => {
    dir = mkdtempSync(join(tmpdir(), "prune-detach-"));
    const pwned = join(dir, "pwned");
    const launched = launchDetached({
      argv: ["pwn"],
      cwd: dir,
      env: { ...process.env, "BASH_FUNC_pwn%%": `() { touch ${pwned}; }` },
      logPath: join(dir, "log"),
      markerPath: join(dir, "window"),
    });
    expect(unwrapErr(launched).code).toBe("COMMAND_NOT_ABSOLUTE");
    expect(existsSync(pwned)).toBe(false);
  });

  it("refuses a builtin such as eval, which would parse the next argument as source", () => {
    dir = mkdtempSync(join(tmpdir(), "prune-detach-"));
    const pwned = join(dir, "pwned");
    const launched = launchDetached({
      argv: ["eval", `touch ${pwned}`],
      cwd: dir,
      env: process.env,
      logPath: join(dir, "log"),
      markerPath: join(dir, "window"),
    });
    expect(unwrapErr(launched).code).toBe("COMMAND_NOT_ABSOLUTE");
    expect(existsSync(pwned)).toBe(false);
  });

  it("starts the job outside the caller's process group, so a group kill after the hook exits misses it", async () => {
    dir = mkdtempSync(join(tmpdir(), "prune-detach-"));
    const out = join(dir, "pgid");
    unwrap(
      launchDetached({
        argv: ["/bin/sh", "-c", '/bin/ps -o pgid= -p $$ >"$0"', out],
        cwd: dir,
        env: process.env,
        logPath: "/dev/null",
        markerPath: join(dir, "window"),
      }),
    );
    const childPgid = (await waitForContent({ path: out, withinMs: 5_000 })).trim();
    const ownPgid = execFileSync("/bin/ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf8" }).trim();
    expect(childPgid).toMatch(/^\d+$/u);
    expect(childPgid).not.toBe(ownPgid);
  });

  it("refuses a launcher it cannot execute, rather than answering launched while nothing runs", () => {
    dir = mkdtempSync(join(tmpdir(), "prune-detach-"));
    const launcher = join(dir, "slopweaver");
    writeFileSync(launcher, "#!/bin/sh\n");
    chmodSync(launcher, 0o644);
    const markerPath = join(dir, "window");
    const outcome = launchDetached({ argv: [launcher], cwd: dir, env: process.env, logPath: "/dev/null", markerPath });
    expect(unwrapErr(outcome).code).toBe("COMMAND_NOT_EXECUTABLE");
    const directory = launchDetached({ argv: [dir], cwd: dir, env: process.env, logPath: "/dev/null", markerPath });
    expect(unwrapErr(directory).code).toBe("COMMAND_NOT_EXECUTABLE");
  });

  it("hands the window back when the command it backgrounded could not be executed", async () => {
    dir = mkdtempSync(join(tmpdir(), "prune-detach-"));
    const handedBack = join(dir, "handed-back");
    const kept = join(dir, "kept");
    writeFileSync(handedBack, "");
    writeFileSync(kept, "");
    const exits = ({ code, markerPath }: { code: number; markerPath: string }): void => {
      unwrap(
        launchDetached({
          argv: ["/bin/sh", "-c", `exit ${String(code)}`],
          cwd: dir,
          env: process.env,
          logPath: "/dev/null",
          markerPath,
        }),
      );
    };
    exits({ code: 1, markerPath: kept });
    exits({ code: 127, markerPath: handedBack });
    expect(await waitForGone({ path: handedBack, withinMs: 5_000 })).toBe(true);
    expect(existsSync(kept)).toBe(true);
  });

  it("runs an absolute path as that file even when a same-named function is exported", async () => {
    dir = mkdtempSync(join(tmpdir(), "prune-detach-"));
    const log = join(dir, "log");
    const pwned = join(dir, "pwned");
    unwrap(
      launchDetached({
        argv: ["/bin/echo", "ran the file"],
        cwd: dir,
        env: { ...process.env, "BASH_FUNC_/bin/echo%%": `() { touch ${pwned}; }` },
        logPath: log,
        markerPath: join(dir, "window"),
      }),
    );
    expect(await waitForContent({ path: log, withinMs: 5_000 })).toBe("ran the file\n");
    expect(existsSync(pwned)).toBe(false);
  });
});

describe("launchLogPath", () => {
  it("keeps a regular log, and an absent one the launch will create", () => {
    dir = mkdtempSync(join(tmpdir(), "prune-log-"));
    const log = join(dir, "log");
    expect(launchLogPath({ logPath: log })).toBe(log);
    noteLaunch({ line: "heading", logPath: log });
    expect(launchLogPath({ logPath: log })).toBe(log);
  });

  it("sends the output to /dev/null when a directory stands at the log path, so the verb still runs", async () => {
    dir = mkdtempSync(join(tmpdir(), "prune-log-"));
    const log = join(dir, "log");
    mkdirSync(log);
    const marker = join(dir, "ran");
    expect(launchLogPath({ logPath: log })).toBe("/dev/null");
    unwrap(
      launchDetached({
        argv: ["/usr/bin/touch", marker],
        cwd: dir,
        env: process.env,
        logPath: launchLogPath({ logPath: log }),
        markerPath: join(dir, "window"),
      }),
    );
    expect(await waitForFile({ path: marker, withinMs: 5_000 })).toBe(true);
  });

  it("still runs the verb when a log the shell itself cannot open reaches it, rather than ending the shell", async () => {
    // Past `launchLogPath`, as a log turned into a directory after that check would be: the shell's own open fails.
    dir = mkdtempSync(join(tmpdir(), "prune-log-"));
    const log = join(dir, "log");
    mkdirSync(log);
    const marker = join(dir, "ran");
    unwrap(
      launchDetached({
        argv: ["/usr/bin/touch", marker],
        cwd: dir,
        env: process.env,
        logPath: log,
        markerPath: join(dir, "window"),
      }),
    );
    expect(await waitForFile({ path: marker, withinMs: 5_000 })).toBe(true);
  });

  it("still runs the verb when the log is a regular file nobody may write", async () => {
    dir = mkdtempSync(join(tmpdir(), "prune-log-"));
    const log = join(dir, "log");
    writeFileSync(log, "");
    chmodSync(log, 0o444);
    const marker = join(dir, "ran");
    expect(launchLogPath({ logPath: log })).toBe(log);
    unwrap(
      launchDetached({
        argv: ["/usr/bin/touch", marker],
        cwd: dir,
        env: process.env,
        logPath: launchLogPath({ logPath: log }),
        markerPath: join(dir, "window"),
      }),
    );
    expect(await waitForFile({ path: marker, withinMs: 5_000 })).toBe(true);
    expect(readFileSync(log, "utf8")).toBe("");
  });
});

describe("noteLaunch", () => {
  it("appends the heading to a regular log", () => {
    dir = mkdtempSync(join(tmpdir(), "prune-note-"));
    const log = join(dir, "log");
    noteLaunch({ line: "first", logPath: log });
    noteLaunch({ line: "second", logPath: log });
    expect(readFileSync(log, "utf8")).toBe("first\nsecond\n");
  });

  it("returns at once when the log path is a FIFO nobody reads, rather than holding its caller", () => {
    dir = mkdtempSync(join(tmpdir(), "prune-note-"));
    const fifo = join(dir, "log");
    execFileSync("/usr/bin/mkfifo", [fifo]);
    const startedMs = Date.now();
    noteLaunch({ line: "heading", logPath: fifo });
    expect(Date.now() - startedMs).toBeLessThan(1_000);
    expect(statSync(fifo).isFIFO()).toBe(true);
  });
});

describe("productionPruneTriggerDeps — a marker path that is a FIFO", () => {
  it("reads it as no claim, never reading it, and takes the window over", () => {
    dir = mkdtempSync(join(tmpdir(), "prune-marker-"));
    const markers = stateHomePaths({ home: dir }).worktreePruneTriggerDir;
    mkdirSync(markers, { recursive: true });
    const name = "schedule-2026-10-12T10-00-00Z";
    execFileSync("/usr/bin/mkfifo", [join(markers, name)]);
    const deps = productionPruneTriggerDeps({ home: dir, importMetaUrl: import.meta.url });
    const startedMs = Date.now();
    expect(deps.markerExists({ name })).toBe(false);
    expect(unwrap(deps.claim({ name }))).toBe(true);
    deps.confirm({ name });
    expect(Date.now() - startedMs).toBeLessThan(1_000);
    expect(readFileSync(join(markers, name), "utf8")).toBe("launched");
  });
});

/** Poll for a file to exist, bounded, so a broken launch fails rather than hangs. */
async function waitForFile({ path, withinMs }: { path: string; withinMs: number }): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline && !existsSync(path)) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return existsSync(path);
}

/** Poll for a file to be removed, bounded, so a broken hand-back fails rather than hangs. */
async function waitForGone({ path, withinMs }: { path: string; withinMs: number }): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline && existsSync(path)) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !existsSync(path);
}

/** Poll for a file to carry content, bounded, so a broken launch fails rather than hangs. */
async function waitForContent({ path, withinMs }: { path: string; withinMs: number }): Promise<string> {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline && !(existsSync(path) && readFileSync(path, "utf8").length > 0)) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}
