/**
 * `automation run-due`'s verb child over real processes: what it is launched as, what its ending maps to, and the
 * two signal properties the whole child exists for.
 *
 * This cannot live on the unit lane. A process group, a SIGKILL that reaches a grandchild, and a signal that kills a
 * thread blocked in a synchronous call are properties of the kernel and of Node's signal handling, and a fake edge
 * reproduces none of them.
 *
 * ## The falsifiable witness
 *
 * "A blocked child with no listener dies on SIGTERM" proves nothing alone, because a fixture that never blocked would
 * die too. So the NEGATIVE fixture is the same block with a SIGTERM listener installed first, which is the in-process
 * shape run-due used to run in: it is sent the same signal and is still alive afterwards. The pair is the evidence.
 *
 * The fixture is a plain `.mjs` program standing in for the CLI entry, handed to {@link runVerbInChild} as its launch,
 * so each case controls exactly what the child does. Synchronous blocking is `Atomics.wait`, the same thread-blocking
 * shape as `typescript/sync`.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { CALLER_GATE_HOMES_ENV } from "../../../../../cli/callerGateHomesEnv.js";
import {
  currentCliLaunch,
  killActiveVerbGroup,
  runVerbInChild,
  verbChildEnv,
} from "../../../../../cli/commands/automation/runDueVerbProcess.js";
import {
  childLeadsGroup,
  RUN_DUE_VERB_CHILD_ENV,
} from "../../../../../cli/commands/automation/runDueVerbProcessPure.js";
import { withCallerGateHomes } from "../../../../../cli/rulingGateDoor.js";

/** Room for several real child processes per case. */
const CASE_TIMEOUT_MS = 60_000;

/** How long a case waits for a fixture to say it is blocked, or for a killed pid to be gone. */
const SETTLE_DEADLINE_MS = 10_000;

/** How long the negative fixture is given to die after its signal, which it must not. */
const SURVIVAL_WINDOW_MS = 1_500;

/**
 * The stand-in entry. `argv[2]` is the mode and `argv[3]` a directory it reports into:
 * - `exit <dir> <code>` writes a line to each stream and exits with `<code>`;
 * - `env <dir>` prints the caller gate homes, the run-due mark and its own parent's pid;
 * - `block <dir>` and `block-trapped <dir>` start a grandchild, write both pids, then block the thread for 30s —
 *   `block-trapped` after installing a SIGTERM listener, as run-due's own trap does.
 */
const FIXTURE = [
  'import { spawn } from "node:child_process";',
  'import { writeFileSync } from "node:fs";',
  'import { join } from "node:path";',
  "const [mode, dir, code] = process.argv.slice(2);",
  'if (mode === "exit") {',
  "  process.stdout.write(`out ${code}\\n`);",
  "  process.stderr.write(`why ${code}\\n`);",
  "  process.exitCode = Number(code);",
  '} else if (mode === "env") {',
  `  process.stdout.write(JSON.stringify({ homes: JSON.parse(String(process.env[${JSON.stringify(CALLER_GATE_HOMES_ENV)}])), mark: process.env[${JSON.stringify(RUN_DUE_VERB_CHILD_ENV)}], ppid: String(process.ppid) }));`,
  "} else {",
  '  if (mode === "block-trapped") {',
  '    process.on("SIGTERM", () => {});',
  "  }",
  '  const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
  '  writeFileSync(join(dir, "pids.json"), JSON.stringify({ child: process.pid, grandchild: grandchild.pid }));',
  "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);",
  "}",
  "",
].join("\n");

const dirs: string[] = [];
const strays: number[] = [];

afterEach(() => {
  strays.splice(0).forEach((pid) => {
    if (alive({ pid })) {
      process.kill(pid, "SIGKILL");
    }
  });
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/** A throwaway directory holding the fixture entry. */
function fixtureDir(): { readonly dir: string; readonly entrypoint: string } {
  const dir = mkdtempSync(join(tmpdir(), "rdvc-"));
  dirs.push(dir);
  const entrypoint = join(dir, "entry.mjs");
  writeFileSync(entrypoint, FIXTURE, "utf8");
  return { dir, entrypoint };
}

/** Whether a pid still names a live process. */
function alive({ pid }: { pid: number }): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Wait, up to the settle deadline, for a condition to hold; answer whether it did. */
async function eventually({ holds }: { holds: () => boolean }): Promise<boolean> {
  const deadline = Date.now() + SETTLE_DEADLINE_MS;
  while (!holds()) {
    if (Date.now() > deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return true;
}

/** Start a blocking fixture and wait until it has written its pids, i.e. is blocked. */
async function blocked({
  mode,
  leadsGroup = true,
}: {
  mode: "block" | "block-trapped";
  /** False launches the child as a NESTED run-due does, in this process's own group. */
  leadsGroup?: boolean;
}): Promise<{
  readonly running: ReturnType<typeof runVerbInChild>;
  readonly child: number;
  readonly grandchild: number;
}> {
  const { dir, entrypoint } = fixtureDir();
  const running = runVerbInChild({
    argv: ["node", "slopweaver", mode, dir],
    env: process.env,
    launch: { entrypoint, execArgv: [], leadsGroup },
  });
  const pidsPath = join(dir, "pids.json");
  expect(await eventually({ holds: () => existsSync(pidsPath) && readFileSync(pidsPath, "utf8").length > 0 })).toBe(
    true,
  );
  const pids = JSON.parse(readFileSync(pidsPath, "utf8")) as { child: number; grandchild: number };
  strays.push(pids.child, pids.grandchild);
  return { child: pids.child, grandchild: pids.grandchild, running };
}

describe("run-due's verb child", { timeout: CASE_TIMEOUT_MS }, () => {
  it("launches the source entry under tsx's own exec arguments when this module is the source", () => {
    const launch = currentCliLaunch();
    expect(launch.entrypoint.endsWith(join("src", "cli", "index.ts"))).toBe(true);
    expect(existsSync(launch.entrypoint)).toBe(true);
    expect(launch.execArgv).toEqual(process.execArgv);
    // This process was not launched by a run-due, so its child leads a group of its own.
    expect(launch.leadsGroup).toBe(true);
  });

  it("passes 0, 2, 3 and 4 through unchanged, keeping each stream's text", async () => {
    const { dir, entrypoint } = fixtureDir();
    const runs = await Promise.all(
      [0, 2, 3, 4].map((code) =>
        runVerbInChild({
          argv: ["node", "slopweaver", "exit", dir, String(code)],
          env: process.env,
          launch: { entrypoint, execArgv: [], leadsGroup: true },
        }),
      ),
    );
    expect(runs.map((run) => unwrap(run))).toEqual(
      [0, 2, 3, 4].map((code) => ({ diagnostics: `why ${code}\n`, exitCode: code, output: `out ${code}\n` })),
    );
  });

  it("hands the child every caller gate home, and a mark naming exactly the child's own parent", async () => {
    const { dir, entrypoint } = fixtureDir();
    const env = withCallerGateHomes({ homes: ["/tmp/a home", "/tmp/b"], run: () => unwrap(verbChildEnv()) });
    const ran = unwrap(
      await runVerbInChild({
        argv: ["node", "slopweaver", "env", dir],
        env,
        launch: { entrypoint, execArgv: [], leadsGroup: true },
      }),
    );
    const seen = JSON.parse(ran.output) as { homes: string[]; mark: string; ppid: string };
    expect(seen.homes).toEqual(["/tmp/a home", "/tmp/b"]);
    expect(seen.mark).toBe(String(process.pid));
    // The binding the nested check relies on: what the child was handed is its own parent's pid.
    expect(seen.mark).toBe(seen.ppid);
    expect(childLeadsGroup({ inherited: seen.mark, parentPid: Number(seen.ppid) })).toBe(false);
  });

  it("SIGKILLs the child's whole group, its grandchild included, and maps the death to 137", async () => {
    const { running, child, grandchild } = await blocked({ mode: "block" });

    expect(killActiveVerbGroup()).toEqual({ kind: "killed", pid: child, scope: "group" });
    const ran = unwrap(await running);

    expect(ran.exitCode).toBe(137);
    expect(ran.diagnostics).toBe("automation run-due: the verb child was ended by SIGKILL\n");
    expect(await eventually({ holds: () => !alive({ pid: grandchild }) })).toBe(true);
    expect(killActiveVerbGroup()).toEqual({ kind: "none-running" });
  });

  it("kills a nested run-due's child alone, never the group this process shares with it", async () => {
    const { running, child, grandchild } = await blocked({ leadsGroup: false, mode: "block" });

    expect(killActiveVerbGroup()).toEqual({ kind: "killed", pid: child, scope: "process" });

    expect(unwrap(await running).exitCode).toBe(137);
    // The grandchild shares this process's group, and a group kill would have ended this test process with it.
    expect(alive({ pid: grandchild })).toBe(true);
  });

  it("dies on SIGTERM while blocked in a synchronous call, because it installs no listener", async () => {
    const { running, child } = await blocked({ mode: "block" });

    process.kill(child, "SIGTERM");
    const ran = unwrap(await running);

    expect(ran.exitCode).toBe(143);
    expect(ran.diagnostics).toBe("automation run-due: the verb child was ended by SIGTERM\n");
  });

  it("NEGATIVE: the same block with a SIGTERM listener installed survives the same signal", async () => {
    const { running, child } = await blocked({ mode: "block-trapped" });

    process.kill(child, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, SURVIVAL_WINDOW_MS));
    expect(alive({ pid: child })).toBe(true);

    expect(killActiveVerbGroup()).toEqual({ kind: "killed", pid: child, scope: "group" });
    expect(unwrap(await running).exitCode).toBe(137);
  });
});
