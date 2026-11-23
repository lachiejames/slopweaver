/**
 * What the shell makes of one `slopweaver cmux revive --json`: whether cmux answered, and so whether the automatic
 * recovery may type into it.
 *
 * The shell is started by Finder, outside cmux, so it is the one process that can knock on cmux's socket and, when
 * cmux hangs, quit and reopen it without dying with it (`src/cmux/hang.ts` carries both measured hangs). A recovery
 * launched into a hung cmux types into an app that cannot draw a tab, so the launch is held while the newest run
 * found cmux hung — its socket unanswered, or the seats' calls timing out — and no restart since brought it back.
 *
 * Pure: the verb's output in, a reading and a decision out. The process is `fleetProcess.ts`.
 */
import { err, ok, type Result } from "neverthrow";

import { isRecord } from "./desktopBridge";

/**
 * What one knock heard, read with what the seats' own calls last heard: answering, a reply while the seats' calls
 * time out, a reply with nothing recent to judge it by, a refused connect, no reply, or no app.
 */
const STATES = ["answering", "stalled", "unprobed", "refused", "silent", "absent"] as const;

/** What the run decided: nothing, wait out the bound, restart, or hold a restart. */
const ACTIONS = ["none", "wait", "restart", "held"] as const;

/** One `cmux revive` run, as the shell reads it. */
export interface CmuxReviveReading {
  readonly state: (typeof STATES)[number];
  /** The run's own verdict: an `unprobed` knock can still be a hang the run is waiting out. */
  readonly action: (typeof ACTIONS)[number];
  /** The restart this run made, when it made one: whether the reopened app answered. */
  readonly restartOutcome: string | undefined;
}

/**
 * Read the verb's one JSON line. Every exit it takes — answering, waiting, held, absent, a failed restart — prints
 * the document, so the exit code decides nothing here.
 *
 * @param text what the verb printed
 * @returns the reading, or why the output carried none
 */
export function parseCmuxRevive({ text }: { text: string }): Result<CmuxReviveReading, string> {
  const line = text
    .split("\n")
    .map((candidate) => candidate.trim())
    .findLast((candidate) => candidate.startsWith("{"));
  if (line === undefined) {
    return err("cmux revive printed no JSON document");
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return err("cmux revive printed a line that is not JSON");
  }
  if (!isRecord(value)) {
    return err("cmux revive printed a document that is not an object");
  }
  const state = STATES.find((candidate) => candidate === value["state"]);
  if (state === undefined) {
    return err("cmux revive printed a document with no known state");
  }
  const action = ACTIONS.find((candidate) => candidate === value["action"]);
  if (action === undefined) {
    return err("cmux revive printed a document with no known action");
  }
  const restart = value["restart"];
  if (isRecord(restart) && typeof restart["outcome"] === "string") {
    return ok({ action, restartOutcome: restart["outcome"], state });
  }
  return ok({ action, restartOutcome: undefined, state });
}

/**
 * Whether the automatic recovery must wait: the newest run found a hang it is waiting out, restarting or holding —
 * or a knock unanswered while the app ran — and no restart in that same run brought it back. No reading yet holds
 * nothing — the shell never stalls a recovery on a verb it has not heard from.
 *
 * @param reading the newest run, or `undefined` before the first
 * @returns whether to hold the launch
 */
export function reviveHoldsLaunch({ reading }: { reading: CmuxReviveReading | undefined }): boolean {
  if (reading === undefined || reading.restartOutcome === "answering") {
    return false;
  }
  if (reading.action !== "none") {
    return true;
  }
  return reading.state === "refused" || reading.state === "silent" || reading.state === "stalled";
}
