/**
 * One recovery pass's own record: what it refused, what it printed, and how each step reaches the journal — the
 * ONLY channel from this tab to the desktop page (`../../../fleet/journal.ts`). Plus the console, recovery's first
 * step, which needs nothing but this record.
 *
 * The pass itself is `./resumeRun.ts`; the supervisor's half is `./resumeChair.ts`.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { logger } from "#lib/logger.js";
import { installedTreeRoot } from "#lib/pluginRoot.js";

import { readConsoleBuild } from "../../../checkouts/consoleBuildRead.js";
import type { FleetJournalEvent } from "../../../fleet/journal.js";
import type { FleetPort } from "../../../fleet/port.js";
import type { FleetAccountNames, FleetRefusal } from "../../../fleet/refusals.js";
import { attemptOutcome, type FleetAttemptOutcome } from "../../../fleet/resumePlan.js";
import { mainCheckoutRoot } from "../../../worktree/shell.js";

/** How long `docs-site.sh --serve` may take: it rebuilds a down console before serving — measured near 25s. */
const CONSOLE_SERVE_TIMEOUT_MS = 180_000;

/** One poll of the reorientation wait and the wall re-check, milliseconds. */
export const POLL_MS = 1000;

/** How the pass ended. */
export interface FleetResumeResult {
  readonly attemptId: string;
  readonly outcome: FleetAttemptOutcome;
  readonly refusals: readonly FleetRefusal[];
  readonly lines: readonly string[];
}

/** The pass's state across steps: what it recorded, so the finish line can judge it. */
export interface PassState {
  readonly home: string;
  /** Where the journal lives — the store, through the port the composition root built. */
  readonly fleet: FleetPort;
  readonly attemptId: string;
  readonly refusals: FleetRefusal[];
  readonly lines: string[];
  /** A capacity hold or the reorientation wait stopped the pass early: every later seat waits for the next one. */
  deferred: boolean;
  /** A refusal of the whole pass rather than of one seat — the finish line carries it, since no seat line does. */
  passRefusal: FleetRefusal | undefined;
  /** Release the recovery lock this pass holds; it removes only this pass's own hold. */
  readonly releaseLock: () => void;
}

/**
 * One pause.
 *
 * @param ms how long, in milliseconds
 */
export async function pause({ ms }: { ms: number }): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The instant, as the journal writes it.
 *
 * @returns now, ISO-8601
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * How the pass ended, and whether its finish line reached the journal — the one thing the tab's own close waits
 * on, since an attempt the journal never saw finish is one the page still reads as running. Kept off
 * {@link FleetResumeResult} so `--json` prints what it always has.
 */
export interface FleetResumeCompletion {
  readonly result: FleetResumeResult;
  readonly finishJournalled: boolean;
}

/**
 * Append one event, saying so on stderr when the journal will not take it — the pass itself carries on.
 *
 * @param state the pass whose home the journal lives under
 * @param event the line to append
 * @returns whether the journal took it
 */
export async function journal({ state, event }: { state: PassState; event: FleetJournalEvent }): Promise<boolean> {
  const written = await state.fleet.appendResumeEvent({ event, home: state.home });
  if (written.isErr()) {
    logger.error({ msg: `fleet resume: the journal did not take a line: ${written.error.message}` });
    return false;
  }
  return true;
}

/**
 * Stop the pass on a refusal that is about no one seat.
 *
 * @param state the pass to record it on
 * @param refusal what stopped it
 */
export function refusePass({ state, refusal }: { state: PassState; refusal: FleetRefusal }): void {
  state.refusals.push(refusal);
  state.passRefusal = refusal;
  state.lines.push(`fleet\trefused ${refusal.code} — ${refusal.message}`);
}

/** The workspace a seat refusal is filed under: the refusal's own, else the seat's role when it names none. */
function seatRef({ refusal, role }: { refusal: FleetRefusal; role: "supervisor" | "worker" }): string {
  if (refusal.workspaceRef === undefined) {
    return role;
  }
  return refusal.workspaceRef;
}

/**
 * Record one refusal against a seat, journalled and kept for the finish line.
 *
 * @param state the pass to record it on
 * @param refusal what the seat was refused with
 * @param role whether the seat is the supervisor's
 * @param sessionId the seat's Claude session, when known
 * @param phase `refused`, or `held` for a seat deliberately left alone
 */
export async function refuseSeat({
  state,
  refusal,
  role,
  sessionId,
  phase = "refused",
}: {
  state: PassState;
  refusal: FleetRefusal;
  role: "supervisor" | "worker";
  sessionId: string | undefined;
  phase?: "refused" | "held";
}): Promise<void> {
  state.refusals.push(refusal);
  const workspaceRef = seatRef({ refusal, role });
  state.lines.push(`${workspaceRef}\t${phase} ${refusal.code} — ${refusal.message}`);
  await journal({
    event: {
      atIso: nowIso(),
      attemptId: state.attemptId,
      kind: "seat",
      phase,
      refusal,
      role,
      schemaVersion: 1,
      workspaceRef,
      ...(sessionId === undefined ? {} : { sessionId }),
    },
    state,
  });
}

/**
 * Record the console not coming back: journalled, and kept as a `CONSOLE_FAILED` refusal so the attempt's outcome and
 * the page's reason say so, rather than a pass that reads healthy over a console that is down.
 *
 * @param state the pass to record it on
 * @param detail what stopped it, for the fold
 */
async function consoleFailed({ state, detail }: { state: PassState; detail: string }): Promise<void> {
  await journal({
    event: { atIso: nowIso(), attemptId: state.attemptId, detail, kind: "console", schemaVersion: 1, state: "failed" },
    state,
  });
  state.refusals.push({ code: "CONSOLE_FAILED", message: detail });
  state.lines.push(`console\trefused CONSOLE_FAILED — ${detail}`);
}

/**
 * Bring the console back when it is not serving. A console that will not start never holds the seats back.
 *
 * @param state the pass to journal each step on
 */
export async function resumeConsole({ state }: { state: PassState }): Promise<void> {
  const root = mainCheckoutRoot({ cwd: installedTreeRoot({ importMetaUrl: import.meta.url }) });
  const base = { attemptId: state.attemptId, kind: "console" as const, schemaVersion: 1 as const };
  if (root === undefined) {
    await consoleFailed({ detail: "not inside a checkout", state });
    return;
  }
  const before = readConsoleBuild({ cwd: root, nowMs: Date.now() }).served;
  if (before.kind !== "none" && before.live) {
    await journal({
      event: { ...base, atIso: nowIso(), detail: "already serving", port: before.port, state: "serving" },
      state,
    });
    state.lines.push(`console\talready serving on :${String(before.port)}`);
    return;
  }
  const script = join(root, "scripts", "docs-site.sh");
  if (!existsSync(script)) {
    await consoleFailed({ detail: `no ${script}`, state });
    return;
  }
  const run = spawnSync("bash", [script, "--serve"], {
    cwd: root,
    encoding: "utf8",
    timeout: CONSOLE_SERVE_TIMEOUT_MS,
  });
  const after = readConsoleBuild({ cwd: root, nowMs: Date.now() }).served;
  if (after.kind !== "none" && after.live) {
    await journal({
      event: { ...base, atIso: nowIso(), detail: "started", port: after.port, state: "started" },
      state,
    });
    state.lines.push(`console\tstarted on :${String(after.port)}`);
    return;
  }
  await consoleFailed({ detail: `docs-site.sh --serve exited ${String(run.status)} and nothing is serving`, state });
}

/**
 * Close the attempt: its outcome journalled, the lock released.
 *
 * @param state the pass to close
 * @param accounts each plan's email, so the outcome's "is there a button" is the page's own
 * @returns how the pass ended, and whether the journal took its finish line
 */
export async function finish({
  state,
  accounts,
}: {
  state: PassState;
  accounts: FleetAccountNames;
}): Promise<FleetResumeCompletion> {
  const outcome = attemptOutcome({ accounts, deferred: state.deferred, refusals: state.refusals });
  const last = state.passRefusal;
  const finishJournalled = await journal({
    event: {
      atIso: nowIso(),
      attemptId: state.attemptId,
      kind: "attempt-finished",
      outcome,
      schemaVersion: 1,
      ...(last === undefined ? {} : { refusal: last }),
    },
    state,
  });
  state.releaseLock();
  return {
    finishJournalled,
    result: { attemptId: state.attemptId, lines: state.lines, outcome, refusals: state.refusals },
  };
}
