/**
 * `scripts/tsc-owner.sh`'s compile LEASE over real processes: one compile at a time for this OS user, a lap's lease
 * inherited by the lap's own compiles, a stale holder taken over, and a live one waited out to a bounded refusal.
 *
 * Every case gives the owner its own runtime root (`SLOPWEAVER_RUNTIME_ROOT`), so no case can meet the machine's real
 * lease or another case's. A holder is either a real owner or a record written exactly as the operation lock writes
 * one (`src/admit/operationLock.ts`), naming a real process; the bash owner and the TypeScript lap must read each
 * other's records, so the record shape is the contract under test.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";

import { repoRootOf } from "#lib/gitRepo.js";

import { acquireOperationLockDetailed } from "../../../admit/operationLock.js";
import { COMPILE_LEASE_KEY, compileLeasePath } from "../../../cli/commands/github/lapCompileLease.js";
import { unwrapErr } from "../../../lib/result.js";
import { processStartOf } from "../../../talk/relayLease.js";

const ROOT = repoRootOf({ importMetaUrl: import.meta.url });
const OWNER = join(ROOT, "scripts", "tsc-owner.sh");

/** A pid no process on a test machine holds: above every platform's default pid ceiling. */
const DEAD_PID = 2 ** 30;

const dirs: string[] = [];
const strays: number[] = [];

afterEach(() => {
  for (const pid of strays.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone, which is what a stray should be.
    }
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh runtime root, the lease path the owner will use under it, and an environment pointing the owner at it. */
function sandbox(): {
  readonly dir: string;
  readonly lease: string;
  readonly locks: string;
  readonly env: NodeJS.ProcessEnv;
} {
  const dir = mkdtempSync(join(tmpdir(), "sw-lease-"));
  dirs.push(dir);
  const locks = join(dir, `slopweaver-${String(userInfo().uid)}`, "user-locks");
  return {
    dir,
    env: { ...process.env, SLOPWEAVER_RUNTIME_ROOT: dir },
    lease: compileLeasePath({ directory: locks }),
    locks,
  };
}

/**
 * Seat a lease record as the operation lock writes one: a directory holding one token file.
 *
 * @param body the token file's whole text
 */
function seat({ lease, locks, body }: { lease: string; locks: string; body: string }): string {
  mkdirSync(lease, { mode: 0o700, recursive: true });
  mkdirSync(locks, { recursive: true });
  const token = "4242-1-0123456789abcdef0123456789abcdef";
  writeFileSync(join(lease, token), body);
  return token;
}

/** A record naming a pid and a start stamp, in the operation lock's own key order. */
function record({ pid, start }: { pid: number; start: string }): string {
  return JSON.stringify({ acquiredAtIso: "2026-11-20T03:00:00.000Z", pid, start });
}

/** A live process that is no ancestor of any owner a case starts, and its real start stamp. */
function liveStranger(): { readonly pid: number; readonly start: string } {
  const child = spawn("sleep", ["60"], { detached: true, stdio: "ignore" });
  child.unref();
  const pid = child.pid!;
  strays.push(pid);
  return { pid, start: processStartOf({ pid }).start! };
}

/** The owner's argv for a case: a short compile bound, a lease wait, and the command. */
function ownerArgs({
  command,
  lockWait = 30,
  timeout = 30,
}: {
  command: readonly string[];
  lockWait?: number;
  timeout?: number;
}): readonly string[] {
  return [
    OWNER,
    "--timeout-seconds",
    String(timeout),
    "--grace-seconds",
    "1",
    "--rss-ceiling-mib",
    "4096",
    "--lock-timeout-seconds",
    String(lockWait),
    "--",
    ...command,
  ];
}

/** Every `TSC_OWNER_<kind>` record on stderr, its fields read as `key=value` pairs. */
function records({
  stderr,
  kind,
}: {
  stderr: string;
  kind: "LOCK" | "START" | "RESULT";
}): readonly Record<string, string>[] {
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

/** The waiting lines an owner printed. */
function waitingLines({ stderr }: { stderr: string }): readonly string[] {
  return stderr
    .split("\n")
    .filter((line) => line.startsWith("tsc-owner: waiting for the machine's TypeScript compile lease"));
}

/** Run the owner to completion. */
function runOwner({ args, env }: { args: readonly string[]; env: NodeJS.ProcessEnv }): {
  readonly status: number | null;
  readonly stderr: string;
} {
  const result = spawnSync("bash", args, { cwd: ROOT, encoding: "utf8", env, timeout: 60_000 });
  return { status: result.status, stderr: result.stderr };
}

/** Start the owner and collect what it writes, resolving with its status once it exits. */
function startOwner({ args, env }: { args: readonly string[]; env: NodeJS.ProcessEnv }): {
  readonly pid: number;
  readonly stderr: () => string;
  readonly done: Promise<number | null>;
} {
  const child = spawn("bash", args, { cwd: ROOT, env, stdio: ["ignore", "ignore", "pipe"] });
  strays.push(child.pid!);
  let text = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    text += chunk;
  });
  const done = new Promise<number | null>((resolve) => {
    child.on("close", (status) => {
      resolve(status);
    });
  });
  return { done, pid: child.pid!, stderr: () => text };
}

/** Wait until a condition holds, or fail the case after `ms`. */
async function until({ holds, ms = 20_000 }: { holds: () => boolean; ms?: number }): Promise<void> {
  const deadline = Date.now() + ms;
  while (!holds()) {
    if (Date.now() > deadline) {
      throw new Error("the condition never held");
    }
    await delay(25);
  }
}

describe("tsc-owner's compile lease", () => {
  it("takes the lease, says so before START, and leaves nothing behind once the command ends", () => {
    const box = sandbox();
    const run = runOwner({ args: ownerArgs({ command: ["true"] }), env: box.env });
    expect(run.status).toBe(0);
    const locks = records({ kind: "LOCK", stderr: run.stderr });
    expect(locks.length).toBe(1);
    expect(locks[0]!["mode"]).toBe("acquired");
    expect(locks[0]!["waitedSeconds"]).toBe("0");
    expect(locks[0]!["holderPid"]).toMatch(/^[1-9]\d*$/u);
    expect(run.stderr.indexOf("TSC_OWNER_LOCK")).toBeLessThan(run.stderr.indexOf("TSC_OWNER_START"));
    expect(records({ kind: "RESULT", stderr: run.stderr })[0]!["outcome"]).toBe("exited");
    expect(existsSync(box.lease)).toBe(false);
    expect(readdirSync(box.locks)).toEqual([]);
  });

  it("runs a second owner's command only after the first's has ended, saying once what it waits on", async () => {
    const box = sandbox();
    const marker = join(box.dir, "first.done");
    const first = startOwner({
      args: ownerArgs({ command: ["sh", "-c", `sleep 2; touch '${marker}'`] }),
      env: box.env,
    });
    await until({ holds: () => first.stderr().includes("TSC_OWNER_START") });
    const second = runOwner({ args: ownerArgs({ command: ["test", "-f", marker] }), env: box.env });
    expect(await first.done).toBe(0);
    expect(second.status).toBe(0);
    expect(waitingLines({ stderr: second.stderr }).length).toBe(1);
    expect(waitingLines({ stderr: second.stderr })[0]).toContain(`held by pid ${String(first.pid)}`);
    expect(records({ kind: "LOCK", stderr: second.stderr })[0]!["mode"]).toBe("acquired");
    expect(Number(records({ kind: "LOCK", stderr: second.stderr })[0]!["waitedSeconds"])).toBeGreaterThan(0);
  });

  it("lets at most one of several racing owners run at a time, a stale record among them", async () => {
    const box = sandbox();
    seat({ body: record({ pid: DEAD_PID, start: "Thu Jan  1 00:00:00 1970" }), lease: box.lease, locks: box.locks });
    const inside = join(box.dir, "inside");
    // `mkdir` fails if another body is still inside, so an overlap is a non-zero exit rather than a timing guess.
    const body = ["sh", "-c", `mkdir '${inside}' && sleep 0.3 && rmdir '${inside}'`];
    const owners = Array.from({ length: 4 }, () => startOwner({ args: ownerArgs({ command: body }), env: box.env }));
    expect(await Promise.all(owners.map((owner) => owner.done))).toEqual([0, 0, 0, 0]);
    expect(existsSync(box.lease)).toBe(false);
  });

  it("takes over a lease whose holder is gone, removing only that holder's record", () => {
    const box = sandbox();
    seat({ body: record({ pid: DEAD_PID, start: "Thu Jan  1 00:00:00 1970" }), lease: box.lease, locks: box.locks });
    const run = runOwner({ args: ownerArgs({ command: ["true"] }), env: box.env });
    expect(run.status).toBe(0);
    expect(records({ kind: "LOCK", stderr: run.stderr })[0]!["mode"]).toBe("acquired");
    expect(waitingLines({ stderr: run.stderr })).toEqual([]);
    expect(existsSync(box.lease)).toBe(false);
  });

  it("takes over a live pid whose start no longer matches its record: the pid was handed out again", () => {
    const box = sandbox();
    // The test process is alive and the owner's own ancestor, so only the start stamp can make this record stale.
    seat({ body: record({ pid: process.pid, start: "Thu Jan  1 00:00:00 1970" }), lease: box.lease, locks: box.locks });
    const run = runOwner({ args: ownerArgs({ command: ["true"] }), env: box.env });
    expect(run.status).toBe(0);
    expect(records({ kind: "LOCK", stderr: run.stderr })[0]!["mode"]).toBe("acquired");
    expect(existsSync(box.lease)).toBe(false);
  });

  it("inherits an ANCESTOR's lease — a lap's own compile — and never touches it", () => {
    const box = sandbox();
    const token = seat({
      body: record({ pid: process.pid, start: processStartOf({ pid: process.pid }).start! }),
      lease: box.lease,
      locks: box.locks,
    });
    const run = runOwner({ args: ownerArgs({ command: ["true"] }), env: box.env });
    expect(run.status).toBe(0);
    expect(records({ kind: "LOCK", stderr: run.stderr })).toEqual([
      { holderPid: String(process.pid), mode: "inherited", waitedSeconds: "0" },
    ]);
    expect(readdirSync(box.lease)).toEqual([token]);
    expect(readdirSync(box.locks)).toEqual([basename(box.lease)]);
  });

  it("gives up lock-timed-out (75) on a live holder past --lock-timeout-seconds, running nothing", () => {
    const box = sandbox();
    const holder = liveStranger();
    const token = seat({ body: record(holder), lease: box.lease, locks: box.locks });
    const marker = join(box.dir, "ran");
    const run = runOwner({ args: ownerArgs({ command: ["touch", marker], lockWait: 1 }), env: box.env });
    expect(run.status).toBe(75);
    expect(records({ kind: "START", stderr: run.stderr })).toEqual([]);
    expect(records({ kind: "LOCK", stderr: run.stderr })).toEqual([]);
    expect(records({ kind: "RESULT", stderr: run.stderr })[0]!["outcome"]).toBe("lock-timed-out");
    expect(waitingLines({ stderr: run.stderr }).length).toBe(1);
    expect(existsSync(marker)).toBe(false);
    expect(readdirSync(box.lease)).toEqual([token]);
    expect(readdirSync(box.locks)).toEqual([basename(box.lease)]);
  });

  it("is cancelled by TERM while it waits (143), leaving the holder's lease and no candidate of its own", async () => {
    const box = sandbox();
    const holder = liveStranger();
    const token = seat({ body: record(holder), lease: box.lease, locks: box.locks });
    const owner = startOwner({ args: ownerArgs({ command: ["true"] }), env: box.env });
    await until({ holds: () => waitingLines({ stderr: owner.stderr() }).length === 1 });
    process.kill(owner.pid, "SIGTERM");
    expect(await owner.done).toBe(143);
    expect(records({ kind: "START", stderr: owner.stderr() })).toEqual([]);
    expect(records({ kind: "RESULT", stderr: owner.stderr() })[0]!["outcome"]).toBe("cancelled-term");
    expect(readdirSync(box.lease)).toEqual([token]);
    expect(readdirSync(box.locks).filter((name) => name.includes(".candidate-"))).toEqual([]);
  });

  it("stops an inherited compile (125) once the ancestor's record goes while it runs", async () => {
    const box = sandbox();
    const token = seat({
      body: record({ pid: process.pid, start: processStartOf({ pid: process.pid }).start! }),
      lease: box.lease,
      locks: box.locks,
    });
    const owner = startOwner({ args: ownerArgs({ command: ["sleep", "20"] }), env: box.env });
    await until({ holds: () => owner.stderr().includes("TSC_OWNER_START") });
    rmSync(join(box.lease, token));
    expect(await owner.done).toBe(125);
    expect(owner.stderr()).toContain("was released while its compile ran");
    expect(records({ kind: "RESULT", stderr: owner.stderr() })[0]!["outcome"]).toBe("owner-error");
  });

  it("writes a record the operation lock judges HELD while the owner lives, so a lap waits rather than takes over", async () => {
    const box = sandbox();
    const owner = startOwner({ args: ownerArgs({ command: ["sleep", "20"] }), env: box.env });
    await until({ holds: () => owner.stderr().includes("TSC_OWNER_START") });
    const [token] = readdirSync(box.lease);
    const written = JSON.parse(readFileSync(join(box.lease, token!), "utf8")) as { pid: number; start: string };
    expect(written.pid).toBe(owner.pid);
    expect(written.start).toBe(processStartOf({ pid: owner.pid }).start);
    const lap = acquireOperationLockDetailed({
      directory: box.locks,
      home: box.dir,
      key: COMPILE_LEASE_KEY,
      nowIso: new Date().toISOString(),
      staleAfterMs: Number.POSITIVE_INFINITY,
    });
    expect(unwrapErr(lap).code).toBe("LOCK_CONTENDED");
    expect(readdirSync(box.lease)).toEqual([token]);
    process.kill(owner.pid, "SIGTERM");
    expect(await owner.done).toBe(143);
  });

  it("releases the lease when the compile is stopped at its own timeout", () => {
    const box = sandbox();
    const run = runOwner({ args: ownerArgs({ command: ["sleep", "10"], timeout: 1 }), env: box.env });
    expect(run.status).toBe(124);
    expect(existsSync(box.lease)).toBe(false);
  });

  it("refuses owner-error (125) on a record it cannot read, and leaves it where it is", () => {
    const box = sandbox();
    const token = seat({ body: "not a lease record", lease: box.lease, locks: box.locks });
    const run = runOwner({ args: ownerArgs({ command: ["true"] }), env: box.env });
    expect(run.status).toBe(125);
    expect(run.stderr).toContain("cannot be judged (its record is not one the compile lease writes)");
    expect(readFileSync(join(box.lease, token), "utf8")).toBe("not a lease record");
  });

  it("refuses owner-error (125) on a runtime root other users can open", () => {
    const box = sandbox();
    mkdirSync(join(box.dir, `slopweaver-${String(userInfo().uid)}`), { mode: 0o755 });
    const run = runOwner({ args: ownerArgs({ command: ["true"] }), env: box.env });
    expect(run.status).toBe(125);
    expect(run.stderr).toContain("is open to other users (drwxr-xr-x)");
    expect(records({ kind: "START", stderr: run.stderr })).toEqual([]);
  });
});
