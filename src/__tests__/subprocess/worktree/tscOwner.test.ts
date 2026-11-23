/**
 * `scripts/tsc-owner.sh` over REAL processes: the compiler owner's outcomes, its exit mapping, its memory sampling
 * and its reaping — and, last, the real installed TypeScript compiler run under it inside `runSupervised`, the
 * concrete owner of a `yarn build`.
 *
 * Every case reads the owner's two stderr records (`TSC_OWNER_START`, `TSC_OWNER_RESULT`) and its exit status; a
 * fake seam records a call, never a pid, so only real processes can show a group is gone. The stubborn grandchild
 * ignores TERM and INT and writes a heartbeat, as the native TypeScript 7 compiler behaves under a signal.
 */
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";

import { repoRootOf } from "#lib/gitRepo.js";

import { runSupervised, SUPERVISOR_GRACE_SECONDS } from "../../../worktree/shell.js";

const ROOT = repoRootOf({ importMetaUrl: import.meta.url });
const OWNER = join(ROOT, "scripts", "tsc-owner.sh");
const TSC = join(ROOT, "node_modules", "typescript", "bin", "tsc");

/** How long after a run the heartbeat is watched for a further write. */
const WATCH_MS = 800;

/** How long a witness waits for a job to start before giving up, on a machine under heavy load. */
const START_WAIT_MS = 20_000;

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

/** Whether a pid still names a live process. */
function isAlive({ pid }: { pid: number }): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}

/** Whether any process is still in a process group. */
function groupAlive({ pgid }: { pgid: number }): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error: unknown) {
    // Only "no such process" means gone; "not permitted" means a member this user cannot signal is still there.
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}

/** A directory holding the stubborn grandchild's script, and where it writes its pid and heartbeat. */
function fixture(): {
  readonly dir: string;
  readonly stubborn: string;
  readonly pidFile: string;
  readonly beat: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "sw-tsc-owner-"));
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

/** The owner's options for a case, in the order the contract spells them. */
function ownerArgs({
  timeout,
  grace,
  ceiling,
  command,
}: {
  timeout: number;
  grace: number;
  ceiling: number;
  command: readonly string[];
}): readonly string[] {
  return [
    OWNER,
    "--timeout-seconds",
    String(timeout),
    "--grace-seconds",
    String(grace),
    "--rss-ceiling-mib",
    String(ceiling),
    "--",
    ...command,
  ];
}

/** One `TSC_OWNER_<kind>` record's fields, read off stderr; every record of that kind is returned. */
function records({ stderr, kind }: { stderr: string; kind: "START" | "RESULT" }): readonly Record<string, string>[] {
  return stderr
    .split("\n")
    .filter((line) => line.startsWith(`TSC_OWNER_${kind} `))
    .map((line) =>
      Object.fromEntries(
        line
          .split(" ")
          .slice(1)
          .map((pair) => {
            const equals = pair.indexOf("=");
            return [pair.slice(0, equals), pair.slice(equals + 1)];
          }),
      ),
    );
}

/** Run the owner to completion and return its status, stdout and stderr. */
function runOwner({
  args,
  cwd,
  env = process.env,
}: {
  args: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}): {
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
} {
  const result = spawnSync("bash", args, { cwd, encoding: "utf8", env, timeout: 60_000 });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

/**
 * A `ps` placed first on PATH that hands every call to `/bin/ps`, except the owner's bare group listing
 * (`-ax -o pgid=`): once the job has written its leader's pid, that listing also shows the job's group, for its
 * first two calls or for every call. That is the shape a member still exiting takes on macOS: the group signal
 * already answers ESRCH, while the listing shows the member for a moment. A failed real listing stays failed.
 */
function exitingMemberPs({ dir, listings }: { dir: string; listings: "two" | "forever" }): {
  readonly countFile: string;
  readonly env: NodeJS.ProcessEnv;
  readonly leaderFile: string;
} {
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const leaderFile = join(dir, "leader.pid");
  const countFile = join(dir, "listings");
  writeFileSync(
    join(bin, "ps"),
    [
      "#!/bin/sh",
      // Each argument compared on its own: a joined "$*" also matches the two-argument `-ax '-o pgid='`.
      'if [ "$#" -ne 3 ] || [ "$1" != -ax ] || [ "$2" != -o ] || [ "$3" != pgid= ] || [ ! -s "$FAKE_PS_LEADER" ]; then',
      '  exec /bin/ps "$@"',
      "fi",
      '/bin/ps "$@" || exit "$?"',
      "n=0",
      '[ -s "$FAKE_PS_COUNT" ] && read -r n < "$FAKE_PS_COUNT"',
      "n=$((n + 1))",
      'printf "%s\\n" "$n" > "$FAKE_PS_COUNT"',
      'if [ "$FAKE_PS_LISTINGS" = forever ] || [ "$n" -le 2 ]; then',
      '  read -r leader < "$FAKE_PS_LEADER"',
      '  printf "%s\\n" "$leader"',
      "fi",
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "ps"), 0o755);
  return {
    countFile,
    env: {
      ...process.env,
      FAKE_PS_COUNT: countFile,
      FAKE_PS_LEADER: leaderFile,
      FAKE_PS_LISTINGS: listings,
      PATH: `${bin}${delimiter}${process.env["PATH"]!}`,
    },
    leaderFile,
  };
}

/** A job that records its own pid, which is its process group's id, and exits 0 at once. */
function leaderRecordingJob({ leaderFile }: { leaderFile: string }): readonly string[] {
  return ["sh", "-c", 'echo "$$" > "$1"; exit 0', "settle-witness", leaderFile];
}

/** A shell fragment printing, on its stdout, whether file descriptor 3 reached the job open. */
const FD3_PROBE = "if { : >&3; } 2>/dev/null; then echo fd3=open; else echo fd3=closed; fi";

/** The modification time of a file, or 0 while it does not exist. */
function mtimeOrZero({ path }: { path: string }): number {
  return existsSync(path) ? statSync(path).mtimeMs : 0;
}

/** Resolve once a file exists, so a signal is sent only after the job has started. */
async function untilWritten({ path }: { path: string }): Promise<void> {
  const deadline = Date.now() + START_WAIT_MS;
  while (!existsSync(path)) {
    if (Date.now() > deadline) {
      throw new Error(`${path} was not written within ${String(START_WAIT_MS)}ms`);
    }
    await delay(50);
  }
}

/** What became of the grandchild: whether it lives, and whether its heartbeat still advances. */
async function aftermath({ pidFile, beat }: { pidFile: string; beat: string }): Promise<{
  readonly alive: boolean;
  readonly stillWriting: boolean;
}> {
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  strays.push(pid);
  const alive = isAlive({ pid });
  const before = mtimeOrZero({ path: beat });
  await delay(WATCH_MS);
  return { alive, stillWriting: mtimeOrZero({ path: beat }) !== before };
}

describe("tsc-owner.sh", () => {
  it("passes a zero exit through and writes exactly one start record and one result record", () => {
    const { dir } = fixture();
    const run = runOwner({ args: ownerArgs({ ceiling: 1024, command: ["true"], grace: 1, timeout: 30 }), cwd: dir });
    expect(run.status).toBe(0);
    const starts = records({ kind: "START", stderr: run.stderr });
    const results = records({ kind: "RESULT", stderr: run.stderr });
    expect(starts.length).toBe(1);
    expect(results.length).toBe(1);
    expect(results[0]!["outcome"]).toBe("exited");
    expect(results[0]!["commandExit"]).toBe("0");
    expect(results[0]!["pid"]).toBe(starts[0]!["pid"]);
    expect(results[0]!["pgid"]).toBe(starts[0]!["pid"]);
  });

  it("passes the command's own non-zero status through, and leaves its own output untouched", () => {
    const { dir } = fixture();
    const run = runOwner({
      args: ownerArgs({ ceiling: 1024, command: ["sh", "-c", "echo own >&2; exit 3"], grace: 1, timeout: 30 }),
      cwd: dir,
    });
    expect(run.status).toBe(3);
    expect(run.stderr.split("\n")).toContain("own");
    expect(records({ kind: "RESULT", stderr: run.stderr })[0]!["commandExit"]).toBe("3");
  });

  it("forks the job with its own stderr on /dev/null and the caller's parked on fd 3, so bash's child-setpgid line cannot reach the job's", () => {
    const lines = readFileSync(OWNER, "utf8").split("\n");
    const park = lines.indexOf("exec 3>&2 2>/dev/null || exec 3>/dev/null 2>/dev/null");
    expect(lines.slice(park, park + 6)).toEqual([
      "exec 3>&2 2>/dev/null || exec 3>/dev/null 2>/dev/null",
      "set -m",
      'GOMEMLIMIT="$((ceiling_mib * 70 / 100))MiB" "$@" 2>&3 3>&- &',
      "pid=$!",
      "exec 2>&3 3>&-",
      "set +m",
    ]);
  });

  it("hands the job the caller's stderr across the parked fork, and never the parked descriptor itself", () => {
    const { dir } = fixture();
    const run = runOwner({
      args: ownerArgs({
        ceiling: 1024,
        command: ["sh", "-c", `echo job-stderr >&2; ${FD3_PROBE} >&2`],
        grace: 1,
        timeout: 30,
      }),
      cwd: dir,
    });
    expect(run.status).toBe(0);
    expect(run.stderr.split("\n").filter((line) => line !== "" && !line.startsWith("TSC_OWNER_"))).toEqual([
      "job-stderr",
      "fd3=closed",
    ]);
    expect(records({ kind: "START", stderr: run.stderr }).length).toBe(1);
    expect(records({ kind: "RESULT", stderr: run.stderr })[0]!["outcome"]).toBe("exited");
  });

  it("still runs the job when its own caller's stderr is closed, parking /dev/null in its place", () => {
    const { dir } = fixture();
    const owner = ownerArgs({ ceiling: 1024, command: ["sh", "-c", `${FD3_PROBE}; echo ran`], grace: 1, timeout: 30 });
    const result = spawnSync("bash", ["-c", 'exec 2>&-; exec bash "$@"', "closed-stderr", ...owner], {
      cwd: dir,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("fd3=closed\nran\n");
    expect(result.stderr).toBe("");
  });

  it("hands the command a Go soft memory limit at 70% of the ceiling, over whatever the caller's environment set", () => {
    const { dir } = fixture();
    const result = spawnSync(
      "bash",
      ownerArgs({ ceiling: 10_240, command: ["sh", "-c", 'echo "limit=$GOMEMLIMIT" >&2'], grace: 1, timeout: 30 }),
      { cwd: dir, encoding: "utf8", env: { ...process.env, GOMEMLIMIT: "off" }, timeout: 60_000 },
    );
    expect(result.status).toBe(0);
    expect(result.stderr.split("\n")).toContain("limit=7168MiB");
  });

  it("reports a timeout as 124 even when the command answers TERM by exiting 0", () => {
    const { dir } = fixture();
    const run = runOwner({
      args: ownerArgs({
        ceiling: 1024,
        command: ["sh", "-c", "trap 'exit 0' TERM; sleep 30 & wait"],
        grace: 1,
        timeout: 1,
      }),
      cwd: dir,
    });
    expect(run.status).toBe(124);
    const [result] = records({ kind: "RESULT", stderr: run.stderr });
    expect(result!["outcome"]).toBe("timed-out");
    expect(result!["commandExit"]).toBe("none");
    expect(groupAlive({ pgid: Number(result!["pgid"]) })).toBe(false);
  });

  it("past its timeout, SIGKILLs a TERM-ignoring grandchild after the grace and leaves nothing writing", async () => {
    const { dir, stubborn, pidFile, beat } = fixture();
    const run = runOwner({
      args: ownerArgs({ ceiling: 1024, command: ["sh", "-c", `${stubborn} ${pidFile} ${beat}`], grace: 1, timeout: 2 }),
      cwd: dir,
    });
    expect(run.status).toBe(124);
    const seen = await aftermath({ beat, pidFile });
    expect(seen.alive).toBe(false);
    expect(seen.stillWriting).toBe(false);
  });

  it.each([
    { outcome: "cancelled-int", signal: "SIGINT", status: 130 },
    { outcome: "cancelled-term", signal: "SIGTERM", status: 143 },
    { outcome: "cancelled-hup", signal: "SIGHUP", status: 129 },
  ] as const)("on $signal, exits $status as $outcome and reaps a TERM-ignoring grandchild", async (expected) => {
    const { dir, stubborn, pidFile, beat } = fixture();
    const owner = spawn(
      "bash",
      ownerArgs({ ceiling: 1024, command: ["sh", "-c", `${stubborn} ${pidFile} ${beat}`], grace: 1, timeout: 60 }),
      { cwd: dir, stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    owner.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const exited = new Promise<number | null>((resolve) => {
      owner.on("close", (code) => {
        resolve(code);
      });
    });
    await untilWritten({ path: pidFile });
    owner.kill(expected.signal);
    expect(await exited).toBe(expected.status);
    expect(records({ kind: "RESULT", stderr })[0]!["outcome"]).toBe(expected.outcome);
    const seen = await aftermath({ beat, pidFile });
    expect(seen.alive).toBe(false);
    expect(seen.stillWriting).toBe(false);
  });

  it("counts a child's resident memory, and stops the group as rss-ceiling once the sum passes the ceiling", () => {
    const { dir } = fixture();
    // The witness keeps touching every page rather than sleeping on them: under memory pressure the kernel takes an
    // idle holder's pages out of its resident set, whatever they hold, and a witness whose pages go before a sample
    // sees them never brings them back, so it sleeps out the timeout and the owner rightly reports 124. MEASURED on
    // macOS while a lap ran (1-minute load 21 to 42, 3.9 GB of swap in use), `ps -o rss=` every 100 ms for 5 to 8 s:
    // an idle 300 MiB holder fell below 100 MiB while alive in 5 of 36 rounds (random fill too, so not only the
    // compressor), the touching one never below 338 MiB in 12. Repro one idle round, repeated while a lap runs:
    //   node -e 'const held=Buffer.alloc(300*1024*1024,1);setTimeout(()=>held.length,8000)' & p=$!; while kill -0 $p; do ps -o rss= -p $p; sleep 0.1; done
    // Residue, stated: the owner judges discrete `ps` samples 100 ms apart, so this only narrows the window. A
    // thrash that keeps this busy witness under 100 MiB at every sample for the whole 30 s still times out, even if
    // it peaks above the ceiling between two samples, and 124 is then the honest outcome; only mlock, which node
    // lacks, pins pages.
    // No single quote may enter this string: it rides inside `node -e '...'`.
    const hold =
      "const held = Buffer.alloc(300 * 1024 * 1024, 1); for (;;) for (let i = 0; i < held.length; i += 4096) held[i]++;";
    const run = runOwner({
      args: ownerArgs({ ceiling: 100, command: ["sh", "-c", `node -e '${hold}'; exit 0`], grace: 1, timeout: 30 }),
      cwd: dir,
    });
    // The owner's stderr rides the status assertion, so a 125 names which owner-error path fired.
    expect(run.status, run.stderr).toBe(126);
    const [result] = records({ kind: "RESULT", stderr: run.stderr });
    expect(result!["outcome"]).toBe("rss-ceiling");
    expect(Number(result!["peakRssKiB"])).toBeGreaterThan(100 * 1024);
    expect(groupAlive({ pgid: Number(result!["pgid"]) })).toBe(false);
  });

  it("waits out a member the listing still shows after the group signal reports it gone, and keeps the clean end", () => {
    const { dir } = fixture();
    const { env, leaderFile } = exitingMemberPs({ dir, listings: "two" });
    const run = runOwner({
      args: ownerArgs({ ceiling: 1024, command: leaderRecordingJob({ leaderFile }), grace: 1, timeout: 30 }),
      cwd: dir,
      env,
    });
    expect(run.status, run.stderr).toBe(0);
    const results = records({ kind: "RESULT", stderr: run.stderr });
    expect(results.length).toBe(1);
    expect(results[0]!["outcome"]).toBe("exited");
    expect(results[0]!["commandExit"]).toBe("0");
  });

  it("still reports owner-error once a member stays listed past the settle bound, having polled the listing", () => {
    const { dir } = fixture();
    const { countFile, env, leaderFile } = exitingMemberPs({ dir, listings: "forever" });
    const run = runOwner({
      args: ownerArgs({ ceiling: 1024, command: leaderRecordingJob({ leaderFile }), grace: 1, timeout: 30 }),
      cwd: dir,
      env,
    });
    expect(run.status, run.stderr).toBe(125);
    expect(records({ kind: "RESULT", stderr: run.stderr })[0]!["outcome"]).toBe("owner-error");
    expect(run.stderr).toContain(`process group ${readFileSync(leaderFile, "utf8").trim()} survived SIGKILL`);
    // One listing before the KILL and one verdict after it would be two; more is settle() polling the listing.
    expect(Number(readFileSync(countFile, "utf8").trim())).toBeGreaterThan(2);
  });

  it("refuses a descendant that leaves the owned group as owner-error, since neither the sum nor the reap covers it", () => {
    const { dir } = fixture();
    const run = runOwner({
      args: ownerArgs({ ceiling: 1024, command: ["bash", "-c", "set -m; sleep 3 & wait"], grace: 1, timeout: 30 }),
      cwd: dir,
    });
    expect(run.status).toBe(125);
    expect(records({ kind: "RESULT", stderr: run.stderr })[0]!["outcome"]).toBe("owner-error");
  });

  it.each([
    { args: ["--timeout-seconds", "1", "--grace-seconds", "1", "--rss-ceiling-mib", "1", "true"], why: "no --" },
    { args: ["--timeout-seconds", "0", "--grace-seconds", "1", "--rss-ceiling-mib", "1", "--", "true"], why: "a zero" },
    { args: ["--timeout-seconds", "1", "--grace-seconds", "1", "--rss-ceiling-mib", "1", "--"], why: "no command" },
    { args: ["--grace-seconds", "1", "--rss-ceiling-mib", "1", "--", "true"], why: "a missing timeout" },
    {
      args: [
        "--timeout-seconds",
        "1",
        "--timeout-seconds",
        "2",
        "--grace-seconds",
        "1",
        "--rss-ceiling-mib",
        "1",
        "--",
        "true",
      ],
      why: "a repeated option",
    },
    {
      args: ["--timeout-seconds", "1", "--grace-seconds", "6", "--rss-ceiling-mib", "1", "--", "true"],
      why: "a grace past five seconds",
    },
    {
      args: [
        "--timeout-seconds",
        "18446744073709551616",
        "--grace-seconds",
        "1",
        "--rss-ceiling-mib",
        "1",
        "--",
        "true",
      ],
      why: "a timeout past Bash's integer range, whose comparison would never fire (Codex 8b r2)",
    },
  ])("refuses $why as owner-error 125, before running anything", ({ args }) => {
    const { dir } = fixture();
    const run = runOwner({ args: [OWNER, ...args], cwd: dir });
    expect(run.status).toBe(125);
    expect(records({ kind: "START", stderr: run.stderr })).toEqual([]);
    expect(records({ kind: "RESULT", stderr: run.stderr })[0]!["outcome"]).toBe("owner-error");
  });

  it("accepts the largest grace it allows, whose worst case still ends inside the supervisor's grace", () => {
    const { dir } = fixture();
    const run = runOwner({ args: ownerArgs({ ceiling: 64, command: ["true"], grace: 5, timeout: 5 }), cwd: dir });
    expect(run.status).toBe(0);
    // The owner's worst case after TERM: the grace, then up to five seconds for SIGKILL to land.
    const ownerWorstCaseSeconds = 5 + 5;
    expect(SUPERVISOR_GRACE_SECONDS).toBeGreaterThan(ownerWorstCaseSeconds);
  });

  it("under runSupervised's bound, an owner its command has stopped is woken, and still reaps the command's group", () => {
    const { dir } = fixture();
    const detail = runSupervised({
      args: [
        ...ownerArgs({
          ceiling: 4096,
          command: ["/bin/sh", "-c", 'sleep 1; kill -STOP "$PPID"; while :; do sleep 1; done'],
          grace: 2,
          timeout: 120,
        }),
      ],
      cwd: dir,
      graceSeconds: 5,
      program: "bash",
      timeoutMs: 4000,
    });
    expect(detail).toMatch(/ran past 4000ms and was killed, with everything it started: /u);
    const startLine = /TSC_OWNER_START [^·]*/u.exec(detail!)![0].trim();
    const [start] = records({ kind: "START", stderr: startLine });
    const pid = Number(start!["pid"]);
    strays.push(pid);
    expect(pid).toBeGreaterThan(0);
    expect(groupAlive({ pgid: Number(start!["pgid"]) })).toBe(false);
  });

  it("under runSupervised's bound, the installed TypeScript compiler in watch mode is cancelled and its group is gone", () => {
    const { dir } = fixture();
    writeFileSync(join(dir, "index.ts"), "export const answer: number = 42;\n");
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { noEmit: true, strict: true }, files: ["index.ts"] }),
    );
    const detail = runSupervised({
      // The project by absolute path, so the process listing below can find this compiler and no other.
      args: [
        ...ownerArgs({
          ceiling: 4096,
          command: [TSC, "-p", join(dir, "tsconfig.json"), "--watch"],
          grace: 2,
          timeout: 120,
        }),
      ],
      cwd: dir,
      graceSeconds: 5,
      program: "bash",
      timeoutMs: 8000,
    });
    expect(detail).toMatch(
      /^`bash .*tsc-owner\.sh .* --watch` ran past 8000ms and was killed, with everything it started: /u,
    );
    // Only the START record can be here. Node's execFileSync closes the child's pipes the moment its timeout
    // fires, so the RESULT record the owner writes after reaping never reaches this detail; the direct TERM
    // case above asserts that record. What this case proves is the composition: the group the owner started is
    // gone once runSupervised returns.
    const startLine = /TSC_OWNER_START [^·]*/u.exec(detail!)![0].trim();
    const [start] = records({ kind: "START", stderr: startLine });
    const pid = Number(start!["pid"]);
    strays.push(pid);
    expect(pid).toBeGreaterThan(0);
    expect(isAlive({ pid })).toBe(false);
    expect(groupAlive({ pgid: Number(start!["pgid"]) })).toBe(false);
    const listing = spawnSync("ps", ["-ax", "-o", "args="], { encoding: "utf8" }).stdout;
    expect(
      listing.split("\n").filter((line) => line.includes(TSC) && line.includes("--watch") && line.includes(dir)),
    ).toEqual([]);
  });
});
