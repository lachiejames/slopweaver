/**
 * What one reap did to the browser sessions, and the lines it prints — the report half of
 * `./sessionReap.ts`, kept apart so the judgement stays a judgement.
 *
 * The one rule this file keeps: **a tab is never reported closed unless the client said it closed.** A
 * forgotten record's tab was unreachable before the reap ran, and a close the client could not confirm is
 * UNKNOWN; both are printed as what they are, because a report that says "closed" of a window still on the owner's
 * screen is the exact confusion the owner asked this to end.
 */
import type { BrowserReapVerdict } from "./sessionReap.js";

/** What the executor did, per session id. */
export interface BrowserReapExecution {
  /** Tab closed and client detached, both confirmed by the client; record removed. */
  readonly closed: readonly string[];
  /** Record removed; no daemon held the tab, so nothing here could reach it. */
  readonly forgotten: readonly string[];
  /** The client could not confirm the close; record removed, daemon terminated when exactly one matched. */
  readonly unknownTabs: readonly { readonly id: string; readonly why: string }[];
  /** A close not attempted this run because the relay had already failed to answer one — retried next tick. */
  readonly deferred: readonly string[];
  /** Daemon pids sent SIGTERM after an unconfirmed close. */
  readonly terminated: readonly number[];
  /** Every other failure — a record that would not delete, a daemon that could not be signalled. */
  readonly failed: readonly { readonly id: string; readonly why: string }[];
  /** Judged idle past its expiry, but touched again before the reap acted, so left alone — nothing was done. */
  readonly superseded: readonly string[];
}

/** The browser half of one reap run: the judgement and what came of it. */
export interface BrowserReapOutcome {
  readonly verdicts: readonly BrowserReapVerdict[];
  readonly execution: BrowserReapExecution;
}

/**
 * An execution that did nothing — what a dry run, or a run over no sessions, carries.
 *
 * @returns the empty execution
 */
export function emptyBrowserReapExecution(): BrowserReapExecution {
  return { closed: [], deferred: [], failed: [], forgotten: [], superseded: [], terminated: [], unknownTabs: [] };
}

/* A page as a line names it. */
function pageLabel({ verdict }: { verdict: BrowserReapVerdict }): string {
  if (verdict.url === null) {
    return "(never read)";
  }
  return verdict.url;
}

/* What a real run did to one session it did not keep — only ever what the execution records. */
function actOf({ execution, verdict }: { execution: BrowserReapExecution; verdict: BrowserReapVerdict }): string {
  if (execution.closed.includes(verdict.id)) {
    return "CLOSED";
  }
  if (execution.forgotten.includes(verdict.id)) {
    return "FORGOT";
  }
  if (execution.unknownTabs.some((unknown) => unknown.id === verdict.id)) {
    return "UNCONFIRMED CLOSE of";
  }
  if (execution.deferred.includes(verdict.id)) {
    return "DEFERRED (relay not answering) the close of";
  }
  if (execution.superseded.includes(verdict.id)) {
    return "LEFT (used again since it was judged)";
  }
  return `FAILED to ${verdict.action}`;
}

/**
 * The lines a reap prints about browser sessions: one per session let go of or left alone, one per failure,
 * and a summary last.
 *
 * @param outcome the judgement and what the executor did
 * @param dryRun whether the run only planned
 * @returns the lines, in display order
 */
export function renderBrowserReapLines({
  outcome,
  dryRun,
}: {
  outcome: BrowserReapOutcome;
  dryRun: boolean;
}): readonly string[] {
  if (outcome.verdicts.length === 0) {
    return [];
  }
  const lines: string[] = [];
  const execution = outcome.execution;
  for (const verdict of outcome.verdicts) {
    if (verdict.action === "keep") {
      continue;
    }
    const act = dryRun ? `WOULD ${verdict.action.toUpperCase()}` : actOf({ execution, verdict });
    lines.push(
      `${act} browser session ${verdict.id} · owner ${verdict.owner} · ${pageLabel({ verdict })} — ${verdict.why}`,
    );
  }
  for (const verdict of outcome.verdicts) {
    if (verdict.action !== "keep") {
      continue;
    }
    lines.push(`left browser session ${verdict.id} alone: ${verdict.why}`);
  }
  for (const unknown of execution.unknownTabs) {
    lines.push(
      `browser session ${unknown.id}: its tab may still be open — the client could not confirm the close (${unknown.why})`,
    );
  }
  for (const failure of execution.failed) {
    lines.push(`browser session ${failure.id}: ${failure.why}`);
  }
  const kept = outcome.verdicts.filter((verdict) => verdict.action === "keep").length;
  if (dryRun) {
    const closing = outcome.verdicts.filter((verdict) => verdict.action === "close").length;
    const forgetting = outcome.verdicts.filter((verdict) => verdict.action === "forget").length;
    lines.push(
      `machine reap: would close ${String(closing)} browser session(s), forget ${String(forgetting)} ` +
        `whose tab no daemon holds, and keep ${String(kept)}`,
    );
    return lines;
  }
  lines.push(
    `machine reap: closed ${String(execution.closed.length)} browser tab(s), forgot ${String(execution.forgotten.length)} ` +
      `record(s) whose tab no daemon held (Chrome shows any such tab as "not connected"), ` +
      `${String(execution.unknownTabs.length)} close(s) unconfirmed, ${String(execution.deferred.length)} deferred, ` +
      `${String(execution.failed.length)} failed — kept ${String(kept + execution.superseded.length)}`,
  );
  return lines;
}
