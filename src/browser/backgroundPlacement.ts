/**
 * Background placement: after the foreground restore (`./foreground.ts`), the owner's own Chrome window is raised back over
 * the agent's in Chrome's own order, so coming back to Chrome lands them in their window rather than the walk's.
 *
 * `./foreground.ts` holds the primitives — the probes, the commands and the restore that hands the front app back.
 * This module holds what reads and changes Chrome's window ORDER on top of them: naming the agent window across an
 * attach, raising the window behind it, a close's restore checked against the windows Chrome still has, and the
 * lines a refused restore or raise is said in. Why it reads Chrome's order at all — Chrome
 * is not always the front app — is in `./foreground.ts` § background by default.
 */
import {
  actOn,
  CHROME_BUNDLE_ID,
  chromeWindowIdsCommand,
  closeRestoreAction,
  type ForegroundRestoreAction,
  type ForegroundRun,
  type ForegroundSnapshot,
  parseChromeWindowIds,
  readForeground,
  restoreCommandFailed,
  restoreForeground,
  wasWatchingAgentWindow,
} from "./foreground.js";

/**
 * Check a close's raise against the windows Chrome still has. Pure.
 *
 * The window in front before a close can be the very one it closed — the owner had gone to the agent's window to watch
 * it, or the run was one the owner chose to be shown — and raising a window that is gone is a refused Apple Event, which
 * would be reported as a failed restore. MEASURED: closing a `SLOPWEAVER_BROWSER_FOREGROUND=1` session
 * printed "an agent Chrome window may still be in front of yours" while the owner's own window was already on top.
 *
 * @param action what {@link closeRestoreAction} decided
 * @param ids Chrome's windows after the close, or `null` when it would not list them
 * @returns the action, or a `leave` when the window it would raise no longer exists
 */
export function unlessClosedAction({
  action,
  ids,
}: {
  action: ForegroundRestoreAction;
  ids: readonly number[] | null;
}): ForegroundRestoreAction {
  if (action.kind !== "raise-window" || ids === null || ids.includes(action.windowId)) {
    return action;
  }
  return { kind: "leave", why: "the window in front before the close was the one it closed" };
}

/**
 * Put back whatever a close moved, given the readings on both sides of it.
 *
 * @param before the snapshot taken immediately before the close
 * @param now the snapshot taken once the close finished
 * @param run the command seam
 * @returns what was done, or why nothing was
 */
export function actOnCloseRestore({
  before,
  now,
  run,
}: {
  before: ForegroundSnapshot | null;
  now: ForegroundSnapshot | null;
  run: ForegroundRun;
}): ForegroundRestoreAction {
  const action = closeRestoreAction({ before, now });
  if (action.kind !== "raise-window") {
    return actOn({ action, run });
  }
  return actOn({ action: unlessClosedAction({ action, ids: readChromeWindowIds({ run }) }), run });
}

/**
 * Put back whatever the close moved.
 *
 * @param before the snapshot taken immediately before the close
 * @param run the command seam
 * @returns what was done, or why nothing was
 */
export function restoreAfterClose({
  before,
  run,
}: {
  before: ForegroundSnapshot | null;
  run: ForegroundRun;
}): ForegroundRestoreAction {
  return actOnCloseRestore({ before, now: readForeground({ run }), run });
}

/**
 * Decide which window to raise so the agent's is no longer the top of Chrome's own stack. Pure.
 *
 * Restoring Slack leaves the agent window at the top of Chrome's order, so the next Cmd-Tab back to Chrome would
 * land the owner — and their keystrokes — in the agent's page. The window just behind it is what was Chrome's front window
 * before the attach took the top, which is the one to put back.
 *
 * @param ids Chrome's windows, front to back
 * @param agentWindowId Chrome's id for the agent window
 * @returns the window to raise, or why none is
 */
export function raiseBehindAgentAction({
  ids,
  agentWindowId,
}: {
  ids: readonly number[];
  agentWindowId: number;
}): ForegroundRestoreAction {
  if (ids[0] !== agentWindowId) {
    return { kind: "leave", why: "the agent window is not the top of Chrome's own stack" };
  }
  const behind = ids.find((id) => id !== agentWindowId);
  if (behind === undefined) {
    return { kind: "leave", why: "Chrome has no other window to put on top" };
  }
  return { kind: "raise-window", windowId: behind };
}

/**
 * Read Chrome's window order and raise whatever sits just behind the agent window. Best effort: a Chrome that will
 * not list its windows is a `leave`, and a refused raise is the same failed `leave` every restore returns.
 *
 * @param agentWindowId Chrome's id for the agent window, or `null` when it was never identified
 * @param run the command seam
 * @returns what was done, or why nothing was
 */
export function raiseWindowBehindAgent({
  agentWindowId,
  run,
}: {
  agentWindowId: number | null;
  run: ForegroundRun;
}): ForegroundRestoreAction {
  if (agentWindowId === null) {
    return { kind: "leave", why: "the agent window was never identified" };
  }
  const ids = readChromeWindowIds({ run });
  if (ids === null) {
    return { kind: "leave", why: "Chrome would not list its windows" };
  }
  return actOn({ action: raiseBehindAgentAction({ agentWindowId, ids }), run });
}

/**
 * Read Chrome's windows front to back, asking nothing of a Chrome that is not running.
 *
 * @param run the command seam
 * @returns the ids, empty for none, or `null` when Chrome would not list them
 */
export function readChromeWindowIds({ run }: { run: ForegroundRun }): readonly number[] | null {
  try {
    return parseChromeWindowIds({ output: run(chromeWindowIdsCommand()) });
  } catch {
    return null;
  }
}

/**
 * Name the agent window from Chrome's own order across an attach or activation: the window that newly tops
 * Chrome's stack. Pure.
 *
 * The foreground snapshot names Chrome's front window only when Chrome is the front APP. MEASURED with
 * cmux in front for a whole aether resync: Chrome was never sampled front, the agent window topped Chrome's own
 * stack throughout, and so the walk never learned its id and never raised the owner's window back over it. The extension
 * focuses the window it connects whether or not Chrome is active, so a change at the TOP is the attach's doing; an
 * unchanged top — an attach that failed before opening anything — names nothing, so nothing of the owner's is moved.
 *
 * @param before Chrome's windows before, or `null` when they could not be listed
 * @param after Chrome's windows after, or `null` when they could not be listed
 * @returns the agent window's id, or `null` when the order does not name one
 */
export function agentWindowFromOrder({
  before,
  after,
}: {
  before: readonly number[] | null;
  after: readonly number[] | null;
}): number | null {
  if (before === null || after === null) {
    return null;
  }
  const top = after[0];
  if (top === undefined || top === before[0]) {
    return null;
  }
  return top;
}

/**
 * Name the agent window after an attach: Chrome's front window when Chrome is the front app, else whatever newly
 * topped Chrome's own order ({@link agentWindowFromOrder}).
 *
 * Either way a window that was ALREADY the top of Chrome's stack names nothing: a failed attach can leave Chrome
 * activated on the owner's own window, and naming that the agent's would raise whatever sits behind it over theirs.
 * `unnamed` is the one state nothing can see through — Chrome in front naming no
 * window, or a window list it refused — and is what a caller SAYS rather than raising nothing in silence.
 *
 * @param now the foreground snapshot taken after the attach
 * @param beforeIds Chrome's windows before the attach
 * @param run the command seam
 * @returns the agent window's id or `null`, and whether Chrome refused to say
 */
export function agentWindowAfterAttach({
  now,
  beforeIds,
  run,
}: {
  now: ForegroundSnapshot | null;
  beforeIds: readonly number[] | null;
  run: ForegroundRun;
}): { windowId: number | null; unnamed: boolean } {
  if (now?.bundleId === CHROME_BUNDLE_ID && now.chromeWindowId === null) {
    return { unnamed: true, windowId: null };
  }
  if (now !== null && now.chromeWindowId !== null) {
    const topUnchanged = beforeIds !== null && beforeIds[0] === now.chromeWindowId;
    return { unnamed: false, windowId: topUnchanged ? null : now.chromeWindowId };
  }
  const afterIds = readChromeWindowIds({ run });
  if (beforeIds === null || afterIds === null) {
    return { unnamed: true, windowId: null };
  }
  return { unnamed: false, windowId: agentWindowFromOrder({ after: afterIds, before: beforeIds }) };
}

/**
 * Say a restore or raise macOS refused, and nothing else. The walk lane's close and its failed attach route here,
 * so neither discards a refusal the terminal-client lane would have printed.
 *
 * @param outcome what the restore did
 * @param report where a refusal is said
 */
export function sayIfRefused({
  outcome,
  report,
}: {
  outcome: ForegroundRestoreAction;
  report: (line: string) => void;
}): void {
  if (outcome.kind === "leave" && restoreCommandFailed({ outcome })) {
    report(unrestoredLine({ why: outcome.why }));
  }
}

/**
 * Put the agent window back where a background run keeps it: give the foreground back, THEN make sure the agent's
 * is not the top of Chrome's own stack. The order is the rule — the restore (`./foreground.ts`) asks whether the
 * agent window is in front NOW, and raising the window behind it first would make every restore a `leave`.
 *
 * "Give back only what was taken" holds here too: when the agent window was ALREADY in front before the
 * operation, the owner had gone to it — to watch — and it is not this function's to bury.
 *
 * A command macOS refused is SAID, never swallowed — the same rule the terminal-client lane keeps
 * (`./keepForeground.ts`): a run must not believe it gave the owner's screen back when it did not.
 *
 * @param before what was in front before the operation that may have taken the foreground
 * @param agentWindowId Chrome's id for the agent window
 * @param run the command seam
 * @param report where a refused restore or raise is said
 * @returns what the restore did, or why it did nothing
 */
export function giveBackForeground({
  before,
  agentWindowId,
  run,
  report,
}: {
  before: ForegroundSnapshot | null;
  agentWindowId: number | null;
  run: ForegroundRun;
  report: (line: string) => void;
}): ForegroundRestoreAction {
  const restored = restoreForeground({ agentWindowId, before, run });
  sayIfRefused({ outcome: restored, report });
  if (!wasWatchingAgentWindow({ agentWindowId, before })) {
    const raised = raiseWindowBehindAgent({ agentWindowId, run });
    if (raised.kind === "leave" && restoreCommandFailed({ outcome: raised })) {
      report(unraisedLine({ why: raised.why }));
    }
  }
  return restored;
}

/**
 * What is said when the restore that gives the owner's foreground back was refused.
 *
 * @param why the refusal the failed `leave` carries
 * @returns the line, for stderr
 */
export function unrestoredLine({ why }: { why: string }): string {
  return `browser: an agent Chrome window may still be in front of yours — ${why}`;
}

/**
 * What is said when Chrome would not name or list its windows after an attach — Automation withdrawn — so the
 * agent's could not be told from the owner's, and the owner's could not be raised over it. Said once per attach, never per
 * operation: a locked screen also identifies no agent window, and names `loginwindow` rather than Chrome.
 */
export const UNNAMED_AGENT_WINDOW_LINE =
  "browser: Chrome would not name the agent's window, so yours could not be raised over it — switching to Chrome may land on it";

/**
 * What is said when raising the owner's window back over the agent's was refused.
 *
 * @param why the refusal the failed `leave` carries
 * @returns the line, for stderr
 */
export function unraisedLine({ why }: { why: string }): string {
  return `browser: your Chrome window could not be raised over the agent's, so switching to Chrome may land on it — ${why}`;
}
