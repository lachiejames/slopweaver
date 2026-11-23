/**
 * `automation run-due` runs each row's verb in a CHILD process with default signal disposition, and this is the one
 * place that child is launched.
 *
 * ## Why a child, when a row's verb used to run in this process
 *
 * Run-due traps SIGHUP, SIGINT and SIGTERM from its first run-here effect onwards (`./runDueSignal.ts`), so that a
 * caller's signal retires the attempt `KILLED_BY_SIGNAL` instead of leaving it for the next tick to find abandoned.
 * A JS signal handler only runs when the event loop does. While a row's verb ran in this process and blocked the
 * loop in a synchronous call (on TypeScript 7.1, the checker is reached through `typescript/sync`, which blocks the
 * thread for the whole request), a signal was caught by a handler that could not run: the process neither retired
 * the attempt nor died. A process with no listener dies on the same signal at once, by the kernel's default.
 *
 * So the verb runs in a child that installs no listener of its own, and this process only AWAITS it: its loop stays
 * free, its trap runs, and the first signal ends the child before the retirement is written.
 *
 * ## What the child is
 *
 * This process's own node, with this process's exec arguments and the entry script of the tree this module loaded
 * from: the exact CLI tier already running (built `dist-cli`, or the source under tsx's loader), never
 * `bin/slopweaver`, which would re-resolve the tier and could pick another. It is a slopweaver verb process, not a model: rule 2 bans a headless MODEL, and the
 * `no-headless` gate recognizes this one spawn by its exact shape, `process.execPath` included, so naming any other
 * program here fails lint. The child passes `cli/main.ts` as a typed invocation does, so its door, its ledger and its
 * ruling gate are the ones a seat's own call meets; the tick's state home reaches that gate through
 * `../../callerGateHomesEnv.ts`, because `withCallerGateHomes` does not cross a process boundary. Every argv word is
 * one argument and no shell is involved.
 *
 * Its stdout and stderr are piped through to this process's own, and the closing 64 KiB of each are kept, so a failed
 * row's record still says why (`../../../live/automation/verbFailureWhy.ts`). Its exit code passes through unchanged.
 *
 * ## Who owns a signal
 *
 * The outermost run-due's child leads its own process group, so a terminal's Ctrl-C or a deadline's group signal
 * reaches that run-due alone, and its trap SIGKILLs the child's whole group before it retires the attempt. A nested
 * `automation run-due` row therefore never handles the signal its parent was sent: one signal retires one attempt and
 * exits once. The nested run-due's OWN child does not lead a group (it is told by `RUN_DUE_VERB_CHILD_ENV` naming its
 * parent's pid, so a mark inherited further down reads as outermost), so it stays in the group the outer
 * kill reaches; a detached one would lead a second group nothing kills.
 * The cost of that, stated: a nested run-due signalled DIRECTLY (nothing does; a terminal or a deadline signals the
 * outer one) can only SIGKILL its child alone, so that child's own descendants outlive it. Also stated rather than
 * discovered: a SIGKILL to THIS process cannot be caught, so the child it was running
 * is left to finish on its own, outside any group anything signals; the next tick judges the attempt by holder
 * liveness, exactly as the no-deadline rule already says of a SIGKILL.
 *
 * Its stdin is `/dev/null`: a child in a background process group that read a terminal would be stopped by SIGTTIN
 * and hang the tick, and no declared row's verb reads stdin. The difference from a typed invocation, stated: a row naming a verb that DOES read it (`talk list-add`) reads end-of-input and fails visibly, where it once
 * read the tick's own stdin, which a scheduled tick never feeds.
 *
 * ## What it costs
 *
 * One CLI boot per generic row. MEASURED on the built tier, 30 runs of `catalog` (which loads every
 * manifest, as a boot does) under a load average of 36 to 44 on 15 cores: median 4.25 s, fastest 2.09 s, slowest
 * 9.14 s; `bin/slopweaver`'s header measured 0.63 s for the same verb unloaded. A tick runs rows one at a time on
 * cadences of minutes to days, so it pays this per due row, never per poll. Repro, from the checkout root after
 * `slopweaver dev build`:
 * `for i in {1..30}; do /usr/bin/time -p node dist-cli/cli/index.js catalog >/dev/null; done 2>&1 | grep real | sort -n -k2 | sed -n "15p;16p"`
 */
import { type ChildProcess, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";

import { err, ok, type Result } from "#lib/result.js";
import { keptTail } from "#lib/writeTee.js";

import { CALLER_GATE_HOMES_ENV, encodeCallerGateHomes } from "../../callerGateHomesEnv.js";
import { callerGateHomes } from "../../rulingGateDoor.js";
import {
  childLeadsGroup,
  closedChildExit,
  killVerbGroup,
  RUN_DUE_VERB_CHILD_ENV,
  type RunDueCliLaunch,
  type RunDueVerbTermination,
  runDueVerbChildMark,
  verbChildArgv,
} from "./runDueVerbProcessPure.js";

/** How much of each stream is kept, in UTF-16 code units: far more than the few closing lines a record quotes. */
const KEPT_CHARS = 64 * 1024;

/** What one finished verb child answers. */
export interface RunDueVerbRun {
  readonly exitCode: number;
  /** The closing {@link KEPT_CHARS} of its stderr, which is where a verb says why it failed. */
  readonly diagnostics: string;
  /** The closing {@link KEPT_CHARS} of its stdout. */
  readonly output: string;
}

/** Why a verb child could not be run at all. */
export interface RunDueVerbProcessError {
  readonly code: "VERB_PROCESS_LAUNCH_FAILED";
  readonly message: string;
  readonly argv: readonly string[];
}

/**
 * The child this process is running right now, if any, and whether it leads its own group: there is at most one,
 * because rows run one at a time.
 */
let active: { readonly child: ChildProcess; readonly leadsGroup: boolean } | null = null;

/**
 * The CLI's entry script in the source tree, beside this module. Two literals and a picker rather than one
 * expression, exactly as `../../../devLint/gateRunner.ts` resolves its worker: under tsx this module is `.ts` and
 * the entry is too; in the emitted tree both are `.js`.
 */
const CLI_ENTRY_SOURCE = new URL("../../index.ts", import.meta.url);

/** The same entry in the emitted tree. */
const CLI_ENTRY_BUILT = new URL("../../index.js", import.meta.url);

/**
 * The tier this process is running, which a verb child must run too: this process's exec arguments (tsx's loader
 * flags under the source, none under the built tree) and the entry script of the tree this module was loaded from,
 * leading a group of its own unless this process is itself a run-due verb child.
 *
 * @returns this process's exec arguments, the matching entry script, and whether the child leads its own group
 */
export function currentCliLaunch(): RunDueCliLaunch {
  let entry = CLI_ENTRY_BUILT;
  if (import.meta.url.endsWith(".ts")) {
    entry = CLI_ENTRY_SOURCE;
  }
  return {
    entrypoint: fileURLToPath(entry),
    execArgv: [...process.execArgv],
    leadsGroup: childLeadsGroup({ inherited: process.env[RUN_DUE_VERB_CHILD_ENV], parentPid: process.ppid }),
  };
}

/**
 * The environment a verb child runs under: this process's, plus every caller state home its ruling gate must add, and
 * the mark that tells a nested run-due its own child must stay in this group.
 *
 * @returns the environment, or why the inherited homes could not be read
 */
export function verbChildEnv(): Result<NodeJS.ProcessEnv> {
  return callerGateHomes().map((homes) => ({
    ...process.env,
    [CALLER_GATE_HOMES_ENV]: encodeCallerGateHomes({ homes }),
    [RUN_DUE_VERB_CHILD_ENV]: runDueVerbChildMark({ pid: process.pid }),
  }));
}

/**
 * Run one verb in a child and wait for it to close, both its pipes drained.
 *
 * @param argv the whole-process argv the row would have handed the dispatcher
 * @param env the child's environment, from {@link verbChildEnv}
 * @param launch the tier to run, from {@link currentCliLaunch}
 * @returns the child's exit code and the kept tails of its output, or why it could not start
 */
export async function runVerbInChild({
  argv,
  env,
  launch,
}: {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  launch: RunDueCliLaunch;
}): Promise<Result<RunDueVerbRun, RunDueVerbProcessError>> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, verbChildArgv({ argv, launch }), {
      detached: launch.leadsGroup,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    active = { child, leadsGroup: launch.leadsGroup };
    const stdout = keptStream({ from: child.stdout, to: process.stdout });
    const stderr = keptStream({ from: child.stderr, to: process.stderr });
    let settled = false;
    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearActive({ child });
      resolve(
        err({
          argv,
          code: "VERB_PROCESS_LAUNCH_FAILED",
          message: `automation run-due: could not run ${argv.slice(2).join(" ")} in a child: ${error.message}`,
        }),
      );
    });
    child.once("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearActive({ child });
      const closed = closedChildExit({ code, signal });
      const diagnostics = closed.line === null ? stderr.kept() : `${stderr.kept()}${closed.line}\n`;
      resolve(
        ok({
          diagnostics: keptTail({ keepChars: KEPT_CHARS, text: diagnostics }),
          exitCode: closed.exitCode,
          output: stdout.kept(),
        }),
      );
    });
  });
}

/**
 * SIGKILL the running verb child, the first thing a signal handler does: its whole process group when it leads one,
 * the child alone when it shares this nested run-due's group.
 *
 * @returns what happened to the child: killed, already gone, none running, or a kill that failed
 */
export function killActiveVerbGroup(): RunDueVerbTermination {
  const running = active;
  if (running?.child.pid === undefined) {
    return { kind: "none-running" };
  }
  return killVerbGroup({
    kill: ({ pid, signal }) => {
      process.kill(pid, signal);
    },
    leadsGroup: running.leadsGroup,
    pid: running.child.pid,
  });
}

/** Forget the active child once it has closed, unless a later one already replaced it. */
function clearActive({ child }: { child: ChildProcess }): void {
  if (active?.child === child) {
    active = null;
  }
}

/** Pipe a child's stream through to this process's own, keeping its closing {@link KEPT_CHARS} as text. */
function keptStream({ from, to }: { from: NodeJS.ReadableStream; to: NodeJS.WritableStream }): {
  readonly kept: () => string;
} {
  const decoder = new StringDecoder("utf8");
  let kept = "";
  from.on("data", (chunk: Buffer) => {
    kept = keptTail({ keepChars: KEPT_CHARS, text: `${kept}${decoder.write(chunk)}` });
  });
  from.pipe(to, { end: false });
  return { kept: () => keptTail({ keepChars: KEPT_CHARS, text: `${kept}${decoder.end()}` }) };
}
