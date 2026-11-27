/**
 * The app's half of replacing the pinned supervisor chat at its bar WITHOUT THE MODEL DOING IT: read what one
 * `slopweaver supervisor chair-watch --json` pass concluded (`src/supervisor/chairWatch.ts`'s `ChairWatchReport`),
 * strictly, decide whether this reading starts `slopweaver supervisor hand-off`, and draw the menu bar's lines.
 * Restated here because this package cannot import `src/`, exactly as `./fleetRecoveryChair.ts` restates its result.
 * Pure; the timer and the two processes are `./chairWatchShell.ts`.
 *
 * The verb decides and the app only presses. The watch decides whether a hand-off is due; the hand-off re-reads the
 * watch itself and journals every step under a lock, so it is the authority on what has happened. The app saves one
 * attempt for EVERY outgoing chat it has pressed, before it presses, so it presses AT MOST ONCE per episode, across
 * restarts and however many chats come between, whatever the press ends in: a deferred run (exit 4), a refusal or a
 * failure is shown in the menu bar and left for a session or the owner to run again, never pressed again by the app.
 */
import { err, ok, type Result } from "neverthrow";

import { isRecord } from "./desktopBridge";

/** What one watch pass concluded about the chair. */
export type ChairWatchStatus = "stay" | "hand-off" | "held" | "unmeasured" | "unsupported";

/** One plan the watch judged on: its alias and its reading as one phrase, never an account address. */
export interface ChairWatchPlan {
  readonly alias: string;
  readonly reading: string;
  /** Whether the chair spends this plan. */
  readonly chair: boolean;
}

/** One watch pass, as the app shows it. */
export interface ChairWatchView {
  readonly status: ChairWatchStatus;
  readonly observedAtIso: string;
  /** The outgoing chat's app session, when the chair sits in this app: the only chair the app hands off. */
  readonly appSessionId?: string;
  readonly reasons: readonly string[];
  /** The plan the successor would start on, when the watch named one. */
  readonly successorAlias?: string;
  readonly plans: readonly ChairWatchPlan[];
  /** The owner's hold on automatic hand-off, when one is in force. */
  readonly holdReason?: string;
}

/** How one press of `supervisor hand-off` ended, by its exit code (`src/cli/commands/supervisor/chairHandOffRun.ts`). */
export type HandOffOutcome = "running" | "seated" | "nothing-to-do" | "not-yet" | "refused" | "failed";

/** The app's one attempt for an outgoing chat. */
export interface HandOffAttempt {
  /** `chair-hand-off:<app session id>`, the verb's own episode key. */
  readonly episode: string;
  readonly outcome: HandOffOutcome;
  readonly atIso: string;
  /** The last line the verb printed, naming the step it reached or why it stopped. */
  readonly line: string;
}

const STATUSES: readonly ChairWatchStatus[] = ["stay", "hand-off", "held", "unmeasured", "unsupported"];

const OUTCOMES: readonly HandOffOutcome[] = ["running", "seated", "nothing-to-do", "not-yet", "refused", "failed"];

/** How each status opens the menu bar's chair line. */
const STATUS_WORDS: Readonly<Record<ChairWatchStatus, string>> = {
  "hand-off": "hand-off due",
  held: "hand-off held",
  stay: "stays",
  unmeasured: "not measured",
  unsupported: "not handed off here",
};

/** How each outcome reads in the menu bar. */
const OUTCOME_WORDS: Readonly<Record<HandOffOutcome, string>> = {
  failed: "failed",
  "not-yet": "not yet, not pressed again",
  "nothing-to-do": "nothing to do",
  refused: "refused",
  running: "running",
  seated: "successor started",
};

/** A list of strings, or `undefined` when any member is not one. */
function stringsOf({ value }: { value: unknown }): readonly string[] | undefined {
  if (!Array.isArray(value) || !value.every((one) => typeof one === "string")) {
    return undefined;
  }
  return value;
}

/** One plan reading, or `undefined` when it is not the shape the watch prints. */
function planOf({ value }: { value: unknown }): ChairWatchPlan | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { alias, reading, chair } = value;
  if (typeof alias !== "string" || typeof reading !== "string" || typeof chair !== "boolean") {
    return undefined;
  }
  return { alias, chair, reading };
}

/** The app session the chair sits in, `null` for a chair elsewhere, or `undefined` for a malformed chair. */
function appSessionOf({ value }: { value: unknown }): string | null | undefined {
  if (!isRecord(value) || typeof value["kind"] !== "string") {
    return undefined;
  }
  if (value["kind"] !== "app") {
    return null;
  }
  const id = value["appSessionId"];
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

/** The optional successor alias and hold reason, or `undefined` when either is present and malformed. */
function optionalsOf({
  report,
}: {
  report: Record<string, unknown>;
}): Pick<ChairWatchView, "holdReason" | "successorAlias"> | undefined {
  const { successor, hold } = report;
  const alias = isRecord(successor) ? successor["alias"] : undefined;
  const holdReason = isRecord(hold) ? hold["reason"] : undefined;
  const malformed =
    (successor !== undefined && !isRecord(successor)) ||
    (alias !== undefined && typeof alias !== "string") ||
    (hold !== undefined && typeof holdReason !== "string");
  if (malformed) {
    return undefined;
  }
  return {
    ...(typeof alias === "string" ? { successorAlias: alias } : {}),
    ...(typeof holdReason === "string" ? { holdReason } : {}),
  };
}

/**
 * Read one `chair-watch --json` document strictly: a field the app relies on that is missing or the wrong shape
 * refuses the whole reading, so a changed verb is a visible problem rather than a hand-off pressed on a guess.
 *
 * @param text what the verb printed to stdout
 * @returns the reading, or why the document is not one
 */
export function parseChairWatch({ text }: { text: string }): Result<ChairWatchView, string> {
  let report: unknown;
  try {
    report = JSON.parse(text);
  } catch {
    return err("the chair watch printed no JSON document");
  }
  if (!isRecord(report)) {
    return err("the chair watch printed something other than one report");
  }
  const status = STATUSES.find((one) => one === report["status"]);
  const { observedAtIso } = report;
  const reasons = stringsOf({ value: report["reasons"] });
  const readings = report["readings"];
  const plans = Array.isArray(readings) ? readings.map((value) => planOf({ value })) : undefined;
  const appSessionId = appSessionOf({ value: report["chair"] });
  const optionals = optionalsOf({ report });
  // Required by the verb's report though unread here: one missing means the verb changed, so nothing is pressed.
  const unreadRequired =
    stringsOf({ value: report["notes"] }) !== undefined &&
    stringsOf({ value: report["overrides"] }) !== undefined &&
    isRecord(report["usage"]);
  const wellFormed =
    unreadRequired &&
    status !== undefined &&
    typeof observedAtIso === "string" &&
    reasons !== undefined &&
    plans !== undefined &&
    plans.every((plan) => plan !== undefined) &&
    appSessionId !== undefined &&
    optionals !== undefined;
  if (!wellFormed) {
    return err("the chair watch's report is not the shape this app reads");
  }
  return ok({
    observedAtIso,
    plans,
    reasons,
    status,
    ...(appSessionId === null ? {} : { appSessionId }),
    ...optionals,
  });
}

/**
 * The verb's episode key for the chair this reading names, when it sits in this app.
 *
 * @param view the reading
 * @returns `chair-hand-off:<app session id>`, or `undefined` for a chair the app does not host
 */
export function handOffEpisodeOf({ view }: { view: ChairWatchView }): string | undefined {
  return view.appSessionId === undefined ? undefined : `chair-hand-off:${view.appSessionId}`;
}

/**
 * Whether this reading presses `supervisor hand-off`: the watch says it is due, for a chair in this app, and the
 * app has never pressed for this outgoing chat, whatever that press ended in and however many chats came between.
 *
 * @param view the newest reading
 * @param pressed every attempt the app has saved, one per episode
 * @returns true to press now
 */
export function handOffDue({ view, pressed }: { view: ChairWatchView; pressed: readonly HandOffAttempt[] }): boolean {
  const episode = handOffEpisodeOf({ view });
  if (view.status !== "hand-off" || episode === undefined) {
    return false;
  }
  return !pressed.some((attempt) => attempt.episode === episode);
}

/**
 * The saved attempts with one attempt recorded: it replaces the attempt for its own episode, else it is appended,
 * so an episode is never dropped and the newest attempt is always last.
 *
 * @param pressed every attempt saved so far
 * @param attempt the attempt to record
 * @returns the attempts to save
 */
export function withAttempt({
  pressed,
  attempt,
}: {
  pressed: readonly HandOffAttempt[];
  attempt: HandOffAttempt;
}): readonly HandOffAttempt[] {
  return [...pressed.filter((one) => one.episode !== attempt.episode), attempt];
}

/** One saved attempt, or `undefined` when it is not the shape this app writes. */
function attemptOf({ value }: { value: unknown }): HandOffAttempt | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { episode, atIso, line } = value;
  const outcome = OUTCOMES.find((one) => one === value["outcome"]);
  const wellFormed =
    typeof episode === "string" &&
    episode.startsWith("chair-hand-off:") &&
    typeof atIso === "string" &&
    typeof line === "string" &&
    outcome !== undefined;
  if (!wellFormed) {
    return undefined;
  }
  return { atIso, episode, line, outcome };
}

/**
 * Read the app's saved attempts strictly: a file the app cannot read as a list of attempts is a reason to press
 * nothing, since an episode it recorded may be this one.
 *
 * @param text the saved file's contents
 * @returns every saved attempt, or why the file is not that list
 */
export function parseHandOffAttempts({ text }: { text: string }): Result<readonly HandOffAttempt[], string> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return err("the saved hand-off attempts are not JSON");
  }
  if (!Array.isArray(value)) {
    return err("the saved hand-off attempts are not a list");
  }
  const attempts = value.map((one) => attemptOf({ value: one }));
  if (!attempts.every((one) => one !== undefined)) {
    return err("a saved hand-off attempt is not the shape this app writes");
  }
  return ok(attempts);
}

/**
 * How a finished press ended, by the verb's exit code: 0 seated or recorded, 3 nothing to do, 4 not yet, 1 refused.
 *
 * @param code the exit code
 * @returns the outcome
 */
export function handOffOutcomeOf({ code }: { code: number }): HandOffOutcome {
  if (code === 0) {
    return "seated";
  }
  if (code === 3) {
    return "nothing-to-do";
  }
  if (code === 4) {
    return "not-yet";
  }
  return code === 1 ? "refused" : "failed";
}

/**
 * The last line a verb printed that says something, for an attempt's line.
 *
 * @param text what it printed
 * @returns the line, or a sentence saying it printed nothing
 */
export function lastPrintedLine({ text }: { text: string }): string {
  const line = text
    .split("\n")
    .map((one) => one.trim())
    .findLast((one) => one.length > 0);
  if (line === undefined) {
    return "it printed nothing";
  }
  return line;
}

/**
 * The menu bar's chair lines: what the watch concluded and its first reason, the chair's plan readings, where the
 * successor would start, the owner's hold, and the app's attempt for this chat — or why the watch could not be read.
 *
 * @param view the newest reading, when there is one
 * @param problem why the newest read produced none
 * @param last the app's attempt for the most recent episode
 * @param paused why the app presses nothing at all, while its saved attempts cannot be read or written
 * @returns the lines, in menu order
 */
export function chairTrayLines({
  view,
  problem,
  last,
  paused,
}: {
  view: ChairWatchView | undefined;
  problem: string | undefined;
  last: HandOffAttempt | undefined;
  paused: string | undefined;
}): readonly string[] {
  const lines: string[] = [];
  if (view === undefined) {
    lines.push(problem === undefined ? "Chair: reading…" : `Chair: could not be read · ${problem}`);
  } else {
    const reason = view.reasons[0];
    lines.push(`Chair: ${STATUS_WORDS[view.status]}${reason === undefined ? "" : ` · ${reason}`}`);
    for (const plan of view.plans.filter((one) => one.chair)) {
      lines.push(`Chair plan ${plan.alias}: ${plan.reading}`);
    }
    if (view.successorAlias !== undefined) {
      lines.push(`Next chair on ${view.successorAlias}`);
    }
    if (view.holdReason !== undefined) {
      lines.push(`Held by you: ${view.holdReason}`);
    }
  }
  if (last !== undefined) {
    lines.push(`Hand-off ${OUTCOME_WORDS[last.outcome]} · ${last.line}`);
  }
  if (paused !== undefined) {
    lines.push(`Hand-off paused, nothing pressed · ${paused}`);
  }
  return lines;
}
