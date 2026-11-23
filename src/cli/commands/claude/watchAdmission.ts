/**
 * `claude watch`'s start-up admission — the effectful shell around `claude/watchStart.ts`'s pure decision.
 *
 * Every real run is admitted here BEFORE it reads its configuration or writes anything, `--once` included,
 * because a one-shot tick touches stores and may rotate the active credential exactly as a standing tick
 * does. A plain start that finds another watch running — or cannot read the process table to rule one out —
 * prints the registered `claude-watch-admission` refusal and exits. `--wait` instead re-checks against a
 * FRESH snapshot every {@link ADMISSION_POLL_MS} and starts once none is running, writing and stamping
 * nothing while it waits.
 *
 * **This is a snapshot admission check, not a fence** — `claude/watchStart.ts` carries the residue: two
 * starts inside one snapshot window both pass, and two `--wait` successors are released together — their
 * released loops re-check admission, so they both run or, each seeing the other, both refuse. The next
 * `session standing` sweep exposes either structurally and exits non-clear; nothing here prevents it.
 */
import { execFileSync } from "node:child_process";

import { parseWatchSession, WATCH_SESSION_FILE } from "../../../claude/watchSession.js";
import { claudeWatchStartDecision, claudeWatchStartDetail } from "../../../claude/watchStart.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusal } from "../../../hatch/render.js";
import { readJsonFile } from "../../../lib/jsonFile.js";
import { logger } from "../../../lib/logger.js";
import { readProcessSnapshot, sameCheckoutOnDisk } from "../../../live/standing/inspect.js";

/**
 * How long a `--wait` start pauses between admission checks. Short against the five-minute tick it is
 * waiting to take over, so a successor starts within a sliver of one interval of its incumbent exiting.
 */
const ADMISSION_POLL_MS = 15_000;

/**
 * The pid and checkout the keep-alive record names, read tolerantly — admission only needs to know which
 * running `--wait` watch has taken over, and an unreadable record simply names none.
 *
 * @param home the Slopweaver home the record lives under
 * @returns the recorded owner, or undefined when there is no readable record
 */
function recordedWatchOwner({ home }: { home: string }): { pid: number; cwd: string } | undefined {
  const parsed = parseWatchSession({ value: readJsonFile({ path: `${home}/${WATCH_SESSION_FILE}` }) });
  return parsed.isOk() && parsed.value !== undefined ? { cwd: parsed.value.cwd, pid: parsed.value.pid } : undefined;
}

/**
 * Admit this watch, or refuse it, before it writes anything.
 *
 * @param home the Slopweaver home the keep-alive record lives under
 * @param wait whether to queue behind a running watch rather than refuse — `claude watch --wait`
 * @returns true once admitted, false when refused
 */
export async function admitClaudeWatch({ home, wait }: { home: string; wait: boolean }): Promise<boolean> {
  let lastDetail: string | undefined;
  for (;;) {
    const decision = claudeWatchStartDecision({
      processId: process.pid,
      recorded: recordedWatchOwner({ home }),
      sameCheckout: sameCheckoutOnDisk,
      snapshot: readProcessSnapshot(),
    });
    if (decision.kind === "ready") {
      return true;
    }
    const detail = claudeWatchStartDetail({ decision });
    if (!wait) {
      logger.error({ msg: hatchRefusal({ detail, hatch: hatchFor({ id: "claude-watch-admission" }) }) });
      return false;
    }
    if (detail !== lastDetail) {
      logger.error({
        msg: `claude watch --wait: ${detail} — re-checking every ${String(ADMISSION_POLL_MS / 1000)}s, writing nothing until none is`,
      });
      lastDetail = detail;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ADMISSION_POLL_MS);
    });
  }
}

/**
 * The command a released `--wait` start runs: this very invocation, minus `--wait`.
 *
 * ## Why a released waiter does not simply carry on
 *
 * Because its argv would still say `--wait` for the rest of its life, and the argv is all the process
 * table offers. A review built the counterexample: a released waiter ticking as 4242, a
 * duplicate that stamps the record and dies, and until 4242's next tick the gauge read it as QUEUED — "NOT
 * running" — while admission let a third watch in. Running the loop as a child WITHOUT the flag makes
 * "carries `--wait`" mean exactly "still queued": the waiting parent becomes the decoded parent of a decoded
 * child, which `standingWatchProcesses` already collapses exactly as it collapses the tsx launcher.
 *
 * The node options are carried over so the child loads the same tsx loader its parent runs under.
 *
 * @param argv the parent's `process.argv`
 * @param execArgv the parent's `process.execArgv` — the tsx `--require`/`--import` loader flags
 * @param execPath the parent's `process.execPath`
 * @returns the file and arguments to run
 */
export function releasedWatchCommand({
  argv,
  execArgv,
  execPath,
}: {
  readonly argv: readonly string[];
  readonly execArgv: readonly string[];
  readonly execPath: string;
}): { readonly file: string; readonly args: readonly string[] } {
  return { args: [...execArgv, ...argv.slice(1).filter((arg) => arg !== "--wait")], file: execPath };
}

/**
 * Run the released watch in the FOREGROUND, blocking until it exits, and exit with its status.
 *
 * `execFileSync` with inherited stdio, which is the one child-process member the `no-headless` gate
 * permits: it blocks, so the child can never outlive this visible session, and an interrupt reaches both.
 *
 * @returns the child's exit code
 */
export function runReleasedWatch(): number {
  const { args, file } = releasedWatchCommand({
    argv: process.argv,
    execArgv: process.execArgv,
    execPath: process.execPath,
  });
  try {
    // sync-child-timeout-exempt: the released watch is a foreground session that runs until they interrupt it,
    // with stdio inherited so any prompt is on their screen; a bound here would end the watch they asked for.
    execFileSync(file, [...args], { stdio: "inherit" });
    return 0;
  } catch (cause: unknown) {
    const status = typeof cause === "object" && cause !== null && "status" in cause ? cause.status : undefined;
    return typeof status === "number" ? status : 1;
  }
}
