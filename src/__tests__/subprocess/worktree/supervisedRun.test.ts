/**
 * `runSupervised` over REAL processes: nothing a yarn run started may outlive the call that started it.
 *
 * The job under test is a shell that starts a grandchild which ignores TERM and INT and writes a heartbeat file every
 * 200ms, which is how the native TypeScript 7 compiler behaves under a signal. A fake
 * seam records a call, never a pid, so only real processes can show the grandchild is gone and its writes have
 * stopped.
 *
 * The negative control runs the same tree under the plain `execFileSync` + SIGKILL the supervisor replaced, and
 * asserts the grandchild SURVIVES it and keeps writing: a witness that could not see a survivor would pass either way.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";

import { runSupervised, SUPERVISOR_GRACE_SECONDS, SUPERVISOR_SHELL, supervisorArgv } from "../../../worktree/shell.js";

/** Long enough for the grandchild to have started and written its pid, short enough to keep the lane quick. */
const BOUND_MS = 1500;

/**
 * The grace a witness gives a TERM-ignoring group before SIGKILL. Production's ten seconds would only make every
 * stubborn-grandchild case wait ten seconds longer for the same verdict.
 */
const TEST_GRACE_SECONDS = 1;

/** How long after the call returns the heartbeat is watched for a further write. */
const WATCH_MS = 800;

const dirs: string[] = [];
const strays: number[] = [];

afterEach(() => {
  for (const pid of strays.splice(0)) {
    if (isAlive({ pid })) {
      process.kill(pid, "SIGKILL");
    }
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * Whether a pid still names a RUNNING process. Signal zero alone is not that: on Darwin it reaches an exited zombie
 * too, and a reaped straggler's parent has already gone, so launchd reaps it on its own schedule and the reap can
 * finish before launchd does. So only a row `ps` printed, in state `Z`, reads as exited. Any other answer, an empty
 * one, a failed `ps` or a status that is not 0, falls back to signal zero ASKED AGAIN: a pid that has vanished since
 * was reaped in between, and one still there reads as running, so a broken probe can never make a leak assertion
 * pass.
 */
function isAlive({ pid }: { pid: number }): boolean {
  if (!signalZeroReaches({ pid })) {
    return false;
  }
  const probe = spawnSync("/bin/ps", ["-o", "stat=", "-p", String(pid)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const state = probe.error === undefined && probe.status === 0 ? probe.stdout.trim() : "";
  if (state.length > 0) {
    return !state.startsWith("Z");
  }
  return signalZeroReaches({ pid });
}

/** Whether `kill(pid, 0)` reaches a pid at all, a zombie included. */
function signalZeroReaches({ pid }: { pid: number }): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A directory holding the stubborn grandchild's script, and where it writes its pid and heartbeat. */
function fixture(): {
  readonly dir: string;
  readonly stubborn: string;
  readonly pidFile: string;
  readonly beat: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "sw-supervised-"));
  dirs.push(dir);
  const stubborn = join(dir, "stubborn.sh");
  writeFileSync(
    stubborn,
    [
      "#!/bin/sh",
      "trap '' TERM INT",
      'echo $$ > "$1"',
      "while true; do",
      '  date > "$2"',
      "  sleep 0.2",
      "done",
      "",
    ].join("\n"),
  );
  chmodSync(stubborn, 0o755);
  return { beat: join(dir, "beat"), dir, pidFile: join(dir, "grandchild.pid"), stubborn };
}

/** What became of the grandchild once the call returned: its pid, whether it lives, whether it still writes. */
async function aftermath({ pidFile, beat }: { pidFile: string; beat: string }): Promise<{
  readonly pid: number;
  readonly alive: boolean;
  readonly stillWriting: boolean;
}> {
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  strays.push(pid);
  const alive = isAlive({ pid });
  const before = mtimeOrZero({ path: beat });
  await delay(WATCH_MS);
  return { alive, pid, stillWriting: mtimeOrZero({ path: beat }) !== before };
}

/** How long a witness waits for the grandchild to start before giving up, on a machine under heavy load. */
const START_WAIT_MS = 20_000;

/**
 * Resolve once a file exists, so a signal is sent only after the grandchild has started — and therefore after the
 * supervisor's traps, which precede the fork. A fixed delay raced bash's own startup at load average 41.
 */
async function untilWritten({ path }: { path: string }): Promise<void> {
  const deadline = Date.now() + START_WAIT_MS;
  while (!existsSync(path)) {
    if (Date.now() > deadline) {
      throw new Error(`${path} was not written within ${String(START_WAIT_MS)}ms`);
    }
    await delay(50);
  }
}

/**
 * Resolve once `ps` shows a pid exited and unreaped (state `Z`), so the zombie case proves its fixture rather than
 * assuming one: a pid that never reaches `Z` within the start budget throws instead of letting the case pass.
 */
async function untilZombie({ pid }: { pid: number }): Promise<void> {
  const deadline = Date.now() + START_WAIT_MS;
  while (
    !execFileSync("/bin/ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" })
      .trim()
      .startsWith("Z")
  ) {
    if (Date.now() > deadline) {
      throw new Error(`${String(pid)} did not become a zombie within ${String(START_WAIT_MS)}ms`);
    }
    await delay(50);
  }
}

/** The modification time of a file, or 0 while it does not exist. */
function mtimeOrZero({ path }: { path: string }): number {
  if (!existsSync(path)) {
    return 0;
  }
  return statSync(path).mtimeMs;
}

/**
 * What a supervisor signalled at an arbitrary instant left behind: every grandchild pid it started that still lives,
 * and whether the heartbeat still advances. A signal landing before the traps finds no job forked, so no pid file.
 */
async function leftRunning({ pidFile, beat }: { pidFile: string; beat: string }): Promise<{
  readonly livePids: readonly number[];
  readonly stillWriting: boolean;
}> {
  const pids = existsSync(pidFile) ? [Number(readFileSync(pidFile, "utf8").trim())] : [];
  strays.push(...pids);
  const livePids = pids.filter((pid) => isAlive({ pid }));
  const before = mtimeOrZero({ path: beat });
  await delay(WATCH_MS);
  return { livePids, stillWriting: mtimeOrZero({ path: beat }) !== before };
}

describe("runSupervised", () => {
  it("negative control: a plain execFileSync SIGKILL leaves the TERM-ignoring grandchild running and writing", async () => {
    const { dir, stubborn, pidFile, beat } = fixture();
    expect(() =>
      execFileSync("/bin/sh", ["-c", `trap '' TERM INT; ${stubborn} ${pidFile} ${beat} & wait`], {
        cwd: dir,
        killSignal: "SIGKILL",
        stdio: "pipe",
        timeout: BOUND_MS,
      }),
    ).toThrow(/ETIMEDOUT/);
    const seen = await aftermath({ beat, pidFile });
    expect(seen.pid).toBeGreaterThan(0);
    expect(seen.alive).toBe(true);
    expect(seen.stillWriting).toBe(true);
  });

  it("past its bound, returns within it and leaves no grandchild alive or writing", async () => {
    const { dir, stubborn, pidFile, beat } = fixture();
    // The monotonic clock, so a wall-clock step during the run cannot move either edge below.
    const started = performance.now();
    const detail = runSupervised({
      args: ["-c", `trap '' TERM INT; ${stubborn} ${pidFile} ${beat}`],
      cwd: dir,
      graceSeconds: TEST_GRACE_SECONDS,
      program: "/bin/sh",
      timeoutMs: BOUND_MS,
    });
    const elapsedMs = performance.now() - started;
    expect(detail).toBe(
      `\`/bin/sh -c trap '' TERM INT; ${stubborn} ${pidFile} ${beat}\` ran past ${String(BOUND_MS)}ms and was killed, ` +
        "with everything it started, with no text on stderr",
    );
    // Read first: a pid file proves the job's shell ran its `trap '' TERM INT` before the bound fell, so the group
    // ignored the TERM. A job load kept from starting leaves none, and fails here rather than on the floor below.
    const seen = await aftermath({ beat, pidFile });
    expect(seen.pid).toBeGreaterThan(0);
    expect(seen.alive).toBe(false);
    expect(seen.stillWriting).toBe(false);
    // The floor is causal: the bound fell, then the supervisor TERMed and waited the whole grace before SIGKILL, since
    // the group ignores TERM and the grace loop is a hundred `sleep 0.01` per second; load only lengthens it, and a
    // supervisor that SIGKILLs at once returns under it. The ceiling is not causal, it is the tightest bound that still
    // catches a dropped grace: a run that dropped `graceSeconds` waits SUPERVISOR_GRACE_SECONDS, so it takes at least
    // this ceiling, while one honouring its grace crosses it only after about 14s of descheduling (3s before). Measured dropping `graceSeconds` above, then passing it 0, and running `yarn vitest
    // run --config config/vitest/subprocess.ts <this file> -t "returns within it" --retry 0`: 36891ms against the
    // ceiling's 16500, then 1503ms against the floor's 2500. The slack ceiling this replaced, bound + grace + 3s,
    // reddened loaded laps at 5674ms, 6460ms and 11298ms. A supervisor that never returns is the lane's `testTimeout`.
    expect(elapsedMs).toBeGreaterThanOrEqual(BOUND_MS + TEST_GRACE_SECONDS * 1000);
    expect(elapsedMs).toBeLessThan(BOUND_MS + SUPERVISOR_GRACE_SECONDS * 1000);
  });

  it("on its job's own failing exit, passes the failure back and reaps a straggler the job left behind", async () => {
    const { dir, stubborn, pidFile, beat } = fixture();
    // The job exits only once the straggler has written its pid, and so has already run its `trap '' TERM INT`: the
    // reap then meets a started, TERM-ignoring grandchild every time. A fixed `sleep 1` here raced the grandchild's
    // startup under load; the reap killed it before it wrote its pid, and `aftermath` read no file. Measured by
    // prepending `sleep 1.5` to the stubborn script, so its start lands past that second, and running `yarn vitest
    // run --config config/vitest/subprocess.ts <this file> -t "own failing exit" --retry 0` on the case repeated:
    // the fixed sleep failed 10 of 10 on ENOENT, and this wait never read a missing pid file in the 170 runs whose
    // failure detail was kept.
    const detail = runSupervised({
      args: [
        "-c",
        `"${stubborn}" "${pidFile}" "${beat}" & while [ ! -s "${pidFile}" ]; do sleep 0.05; done; echo build broke >&2; exit 3`,
      ],
      cwd: dir,
      program: "/bin/sh",
      timeoutMs: START_WAIT_MS,
    });
    expect(detail).toBe("build broke");
    const seen = await aftermath({ beat, pidFile });
    expect(seen.pid).toBeGreaterThan(0);
    expect(seen.alive).toBe(false);
    expect(seen.stillWriting).toBe(false);
  });

  it("past its bound, TERMs the job first, so a job that owns a group of its own gets to reap it before SIGKILL", () => {
    const { dir } = fixture();
    const cleaned = join(dir, "cleaned");
    const detail = runSupervised({
      args: ["-c", `trap 'echo reaped > ${cleaned}; exit 0' TERM; sleep 30 & wait`],
      cwd: dir,
      graceSeconds: 5,
      program: "/bin/sh",
      timeoutMs: BOUND_MS,
    });
    expect(detail).toBe(
      `\`/bin/sh -c trap 'echo reaped > ${cleaned}; exit 0' TERM; sleep 30 & wait\` ran past ${String(BOUND_MS)}ms ` +
        "and was killed, with everything it started, with no text on stderr",
    );
    expect(readFileSync(cleaned, "utf8")).toBe("reaped\n");
  });

  it("passes back only the job's own stderr when the job dies by a signal, with no shell notice appended", () => {
    const { dir } = fixture();
    const detail = runSupervised({
      args: ["-c", "echo own >&2; kill -KILL $$"],
      cwd: dir,
      program: "/bin/sh",
      timeoutMs: 10_000,
    });
    expect(detail).toBe("own");
  });

  it.each([0, 5, 20, 80, 200, 400, 700])(
    "on SIGTERM %ims after it starts, either side of the traps, leaves nothing it started running",
    async (afterMs) => {
      const { dir, stubborn, pidFile, beat } = fixture();
      const supervisor = spawn(
        SUPERVISOR_SHELL,
        supervisorArgv({
          args: ["-c", `trap '' TERM INT; ${stubborn} ${pidFile} ${beat}`],
          graceSeconds: TEST_GRACE_SECONDS,
          name: "supervise",
          program: "/bin/sh",
        }),
        { cwd: dir, stdio: "ignore" },
      );
      const exited = new Promise<void>((resolve) => {
        supervisor.on("exit", () => {
          resolve();
        });
      });
      await delay(afterMs);
      supervisor.kill("SIGTERM");
      await exited;
      const seen = await leftRunning({ beat, pidFile });
      expect(seen.livePids).toEqual([]);
      expect(seen.stillWriting).toBe(false);
    },
  );

  it("past its bound, keeps what the job wrote to stderr after the bound message", () => {
    const { dir } = fixture();
    const detail = runSupervised({
      args: ["-c", "echo diagnostic >&2; sleep 30"],
      cwd: dir,
      program: "/bin/sh",
      timeoutMs: 4000,
    });
    expect(detail).toBe(
      "`/bin/sh -c echo diagnostic >&2; sleep 30` ran past 4000ms and was killed, with everything it started: diagnostic",
    );
  });

  it.each([
    { script: "exit 3", wrote: "nothing" },
    { script: "printf '  ' >&2; exit 3", wrote: "only whitespace" },
  ])(
    "names the job and its status, never the supervisor script, when a failing job wrote $wrote to stderr",
    ({ script }) => {
      const { dir } = fixture();
      const detail = runSupervised({ args: ["-c", script], cwd: dir, program: "/bin/sh", timeoutMs: 10_000 });
      expect(detail).toBe(`\`/bin/sh -c ${script}\` exited 3 with no text on stderr`);
    },
  );

  it.each([
    { script: "kill -KILL $$", signal: "SIGKILL", status: 137 },
    { script: "kill -TERM $$", signal: "SIGTERM", status: 143 },
  ])("names $signal when a job killed by it wrote nothing to stderr", ({ script, signal, status }) => {
    const { dir } = fixture();
    const detail = runSupervised({ args: ["-c", script], cwd: dir, program: "/bin/sh", timeoutMs: 10_000 });
    expect(detail).toBe(
      `\`/bin/sh -c ${script}\` exited ${status}, as a job killed by ${signal} does, with no text on stderr`,
    );
  });

  it("keeps a job's own stderr that looks like bash's line prefix, since only this run's supervisor name is stripped", () => {
    const { dir } = fixture();
    const script = "printf 'supervise: line 12: ' >&2; exit 3";
    const detail = runSupervised({ args: ["-c", script], cwd: dir, program: "/bin/sh", timeoutMs: 10_000 });
    expect(detail).toBe("supervise: line 12:");
  });

  it("reports a program that does not exist in bash's own words, without the supervisor's line prefix", () => {
    const { dir } = fixture();
    const program = join(dir, "no-such-program");
    expect(runSupervised({ args: [], cwd: dir, program, timeoutMs: 10_000 })).toBe(
      `${program}: No such file or directory`,
    );
  });

  it("gives the job the caller's stderr after the fork and closes the parked descriptor before the job runs", () => {
    const { dir } = fixture();
    const detail = runSupervised({
      args: ["-c", "echo job stderr >&2; if [ -e /dev/fd/3 ]; then echo fd 3 leaked >&2; fi; exit 3"],
      cwd: dir,
      program: "/bin/sh",
      timeoutMs: 10_000,
    });
    expect(detail).toBe("job stderr");
  });

  it("still runs its job, and passes back its status, when the caller's own stderr is closed", () => {
    const { dir } = fixture();
    const ran = join(dir, "ran");
    // `exec 2>&-` closes the outer shell's stderr, so the supervisor it execs inherits no fd 2 at all.
    const argv = supervisorArgv({
      args: ["-c", `echo yes > "${ran}"; exit 3`],
      graceSeconds: TEST_GRACE_SECONDS,
      name: "supervise",
      program: "/bin/sh",
    });
    const outcome = spawnSync("/bin/sh", ["-c", 'exec 2>&-; exec "$@"', "outer", SUPERVISOR_SHELL, ...argv], {
      cwd: dir,
      stdio: ["ignore", "ignore", "ignore"],
    });
    expect(outcome.status).toBe(3);
    expect(readFileSync(ran, "utf8")).toBe("yes\n");
  });

  it("reads an exited, unreaped zombie as not running, though signal zero still reaches its pid", async () => {
    // The parent execs into a sleep that never reaps, so the child it started stays a zombie until the parent dies.
    const parent = spawn("/bin/sh", ["-c", "sleep 0 & echo $!; exec sleep 30"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    try {
      const pid = await new Promise<number>((resolve) => {
        parent.stdout.once("data", (chunk: Buffer) => {
          resolve(Number(chunk.toString("utf8").trim()));
        });
      });
      await untilZombie({ pid });
      expect(() => process.kill(pid, 0)).not.toThrow();
      expect(isAlive({ pid })).toBe(false);
    } finally {
      parent.kill("SIGKILL");
    }
  });

  it("answers undefined for a job that exits 0", () => {
    const { dir } = fixture();
    expect(runSupervised({ args: ["-c", "exit 0"], cwd: dir, program: "/bin/sh", timeoutMs: 10_000 })).toBe(undefined);
  });

  it.each([
    { signal: "SIGINT", status: 130 },
    { signal: "SIGTERM", status: 143 },
    { signal: "SIGHUP", status: 129 },
  ] as const)("on $signal to the supervisor, exits $status and reaps the grandchild", async ({ signal, status }) => {
    const { dir, stubborn, pidFile, beat } = fixture();
    const supervisor = spawn(
      SUPERVISOR_SHELL,
      supervisorArgv({
        args: ["-c", `trap '' TERM INT; ${stubborn} ${pidFile} ${beat}`],
        graceSeconds: TEST_GRACE_SECONDS,
        name: "supervise",
        program: "/bin/sh",
      }),
      { cwd: dir, stdio: "ignore" },
    );
    const exited = new Promise<number | null>((resolve) => {
      supervisor.on("exit", (code) => {
        resolve(code);
      });
    });
    await untilWritten({ path: pidFile });
    supervisor.kill(signal);
    expect(await exited).toBe(status);
    const seen = await aftermath({ beat, pidFile });
    expect(seen.pid).toBeGreaterThan(0);
    expect(seen.alive).toBe(false);
    expect(seen.stillWriting).toBe(false);
  });
});
