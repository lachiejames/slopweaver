/**
 * What `launchConnectWorker` does once it reaches the shell, which a launcher that only exits 0 cannot show: the
 * worker really starts, with the exact argv, working directory and home it was handed, its output reaches the log
 * the foreground shell opened, it runs in the background rather than holding the caller, and a log the shell cannot
 * open still starts it. The refusals and the home staying removable the instant the launch answers stay on the unit
 * lane (`src/__tests__/unit/plans/connectLaunch.test.ts`), whose two launching cases cannot see whether the worker ran.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { launchConnectWorker } from "../../../plans/connectLaunch.js";

/**
 * How long a wait on the backgrounded worker may take. Well past the milliseconds it needs, so only a launch that
 * never started it, or one starved far beyond ordinary load, fails; well inside the lane's 60-second test budget.
 */
const WAIT_MS = 20_000;

/** The paths one fake launcher lives at and writes, all beside it in `bin`, never in the home. */
interface WitnessPaths {
  readonly launcher: string;
  readonly pid: string;
  readonly release: string;
  readonly witness: string;
}

describe("launchConnectWorker, through the real shell", () => {
  let home: string;
  let bin: string;

  beforeEach(() => {
    // Canonical, so the child's physical working directory and the argv carry the same spelling on macOS, where
    // `tmpdir()` is `/var/folders/...` and the directory itself is `/private/var/folders/...`.
    home = realpathSync(mkdtempSync(join(tmpdir(), "connect-launch-home-")));
    // The launcher and everything it writes live outside the home, so removing the home leaves them untouched.
    bin = realpathSync(mkdtempSync(join(tmpdir(), "connect-launch-bin-")));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
    rmSync(bin, { force: true, recursive: true });
  });

  it("starts the worker in the background with its exact argv, directory and home, its output in the log", async () => {
    const paths = witnessPaths({ bin });
    writeWitnessLauncher({ paths });
    const logPath = join(home, "worker.log");

    const launched = launchConnectWorker({ home, id: "0123abcd4567ef89", launcher: paths.launcher, logPath });
    // Released only once the launch has answered: a launch that ran the worker in the foreground would wait on
    // this file until the launching shell's own timeout, and answer an error.
    writeFileSync(paths.release, "");

    expect(launched.isOk()).toBe(true);
    expect(unwrap(launched)).toBe(undefined);
    expect(await waitForFile({ path: paths.witness, withinMs: WAIT_MS })).toBe(true);
    expect(readFileSync(paths.witness, "utf8")).toBe(expectedWitness({ home, id: "0123abcd4567ef89" }));
    expect(readFileSync(logPath, "utf8")).toBe("connect worker ran\n");
    expect(await waitForExit({ pidPath: paths.pid, withinMs: WAIT_MS })).toBe(true);
  });

  it("still starts the worker when the shell cannot open the log, on /dev/null rather than ending the shell", async () => {
    const paths = witnessPaths({ bin });
    writeWitnessLauncher({ paths });
    // A directory where the log should be: the foreground shell's own open of it fails.
    const logPath = join(home, "worker.log");
    mkdirSync(logPath);

    const launched = launchConnectWorker({ home, id: "fedcba9876543210", launcher: paths.launcher, logPath });
    writeFileSync(paths.release, "");

    expect(launched.isOk()).toBe(true);
    expect(unwrap(launched)).toBe(undefined);
    expect(await waitForFile({ path: paths.witness, withinMs: WAIT_MS })).toBe(true);
    expect(readFileSync(paths.witness, "utf8")).toBe(expectedWitness({ home, id: "fedcba9876543210" }));
    expect(await waitForExit({ pidPath: paths.pid, withinMs: WAIT_MS })).toBe(true);
  });
});

/** Where one fake launcher lives and what it writes. */
function witnessPaths({ bin }: { bin: string }): WitnessPaths {
  return {
    launcher: join(bin, "slopweaver"),
    pid: join(bin, "pid"),
    release: join(bin, "release"),
    witness: join(bin, "witness"),
  };
}

/**
 * A fake `slopweaver` that records what it was started with. It writes its own pid, prints one line to stdout,
 * then publishes its argv, physical working directory and `SLOPWEAVER_HOME` by renaming a finished file into
 * place, so the witness existing means its whole content is readable and the pid and stdout line came first. It
 * then waits, at most ten seconds, for the test's release file, and exits.
 */
function writeWitnessLauncher({ paths }: { paths: WitnessPaths }): void {
  const script = [
    "#!/bin/sh",
    `echo "$$" >'${paths.pid}'`,
    `printf '%s\\n' "$@" >'${paths.witness}.pending'`,
    `printf 'PWD=%s\\nSLOPWEAVER_HOME=%s\\n' "$(pwd -P)" "$SLOPWEAVER_HOME" >>'${paths.witness}.pending'`,
    "echo 'connect worker ran'",
    `/bin/mv '${paths.witness}.pending' '${paths.witness}'`,
    "i=0",
    `while [ ! -e '${paths.release}' ] && [ "$i" -lt 100 ]; do /bin/sleep 0.1; i=$((i + 1)); done`,
    "",
  ].join("\n");
  writeFileSync(paths.launcher, script, { mode: 0o755 });
}

/** Exactly what the witness launcher records when started as the Connect worker for `id` in `home`. */
function expectedWitness({ home, id }: { home: string; id: string }): string {
  return ["plans", "connect-worker", "--id", id, "--home", home, `PWD=${home}`, `SLOPWEAVER_HOME=${home}`, ""].join(
    "\n",
  );
}

/** Poll for a file to exist, bounded, so a launch that never started the worker fails rather than hangs. */
async function waitForFile({ path, withinMs }: { path: string; withinMs: number }): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline && !existsSync(path)) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return existsSync(path);
}

/**
 * Poll for the launcher whose pid it wrote to have exited, bounded, so cleanup never removes its directory under a
 * live process and a launcher that never let go fails rather than leaks.
 */
async function waitForExit({ pidPath, withinMs }: { pidPath: string; withinMs: number }): Promise<boolean> {
  const pid = Number(readFileSync(pidPath, "utf8").trim());
  if (!Number.isInteger(pid) || pid <= 0) {
    // A pid that reads as no process would make the wait pass at once and prove nothing.
    throw new Error(`the launcher wrote no pid to ${pidPath}`);
  }
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline && running({ pid })) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !running({ pid });
}

/** Whether a process with this pid exists; signal 0 checks without delivering anything. */
function running({ pid }: { pid: number }): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
