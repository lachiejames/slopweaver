/**
 * The chair watch's timer, applied to Electron: read `slopweaver supervisor chair-watch --json` every minute and, on
 * a reading that says a hand-off is due, press `slopweaver supervisor hand-off` once for that outgoing chat. Neither
 * process ever overlaps itself, and no reading is taken while a hand-off runs. What a reading means and when it
 * presses is `./chairHandOffAutomation.ts`; this module runs the two verbs and keeps the saved attempts.
 *
 * Nothing here starts a model itself. The one model session a press causes is the successor, which the verb opens
 * as a visible card in this app the owner can see and stop as it runs (`cmux spawn --harness app`), after asking the
 * outgoing chat for its note; it journals every step under its own lock. One attempt per pressed chat is saved to
 * `userData` BEFORE its press and the list is read back before the first one, so neither a restart nor a chat
 * returning as the chair presses the same chat twice: an attempt that will not save presses nothing, and a saved file
 * that will not read pauses the app's presses for as long as it runs.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";
import { errAsync, okAsync, type Result, ResultAsync } from "neverthrow";

import {
  type ChairWatchView,
  chairTrayLines,
  type HandOffAttempt,
  handOffDue,
  handOffEpisodeOf,
  handOffOutcomeOf,
  lastPrintedLine,
  parseChairWatch,
  parseHandOffAttempts,
  withAttempt,
} from "./chairHandOffAutomation";
import type { CheckoutError } from "./errors";
import { run } from "./fleetProcess";

/** What the timer reads from, and tells, the rest of the shell: the fleet shell's own host fits it. */
export interface ChairWatchHost {
  /** The checkout whose `bin/slopweaver` runs. */
  readonly checkout: () => Result<string, CheckoutError>;
  /** A reading, a failed read or an attempt changed what the menu bar shows. */
  readonly redrawTray: () => void;
}

/** How often the chair is watched: `chair-watch` starts a CLI and reads recorded state, so once a minute. */
const WATCH_INTERVAL_MS = 60_000;

/** One watch pass reads recorded readings and asks the app for its sessions: well inside two minutes. */
const WATCH_TIMEOUT_MS = 120_000;

/** One hand-off waits up to its default ten minutes for the note, then seats and reconciles the successor. */
const HAND_OFF_TIMEOUT_MS = 20 * 60_000;

let host: ChairWatchHost | undefined;
let watching = false;
let handingOff = false;
let view: ChairWatchView | undefined;
let problem: string | undefined;
/** Every attempt the app has saved, one per pressed chat, the newest last. */
let pressed: readonly HandOffAttempt[] = [];
/** Why the saved attempts could not be read at start: the app presses nothing for as long as it runs. */
let unreadMemory: string | undefined;
/** Why the newest save failed, until one succeeds. */
let unsavedMemory: string | undefined;

/**
 * The host, once `startChairWatch` has run.
 *
 * @returns the host
 */
function hostOf(): ChairWatchHost {
  if (host === undefined) {
    throw new Error("the chair watch was used before startChairWatch");
  }
  return host;
}

/** The saved attempts' file, beside the fleet's own. */
function attemptPath(): string {
  return join(app.getPath("userData"), "chair-hand-off.json");
}

/**
 * Why the app presses nothing at all right now, when it does not.
 *
 * @returns the reason, or `undefined` while it may press
 */
function pausedReason(): string | undefined {
  if (unreadMemory !== undefined) {
    return unreadMemory;
  }
  return unsavedMemory;
}

/**
 * The menu bar's chair lines, from the newest reading, why the newest read produced none, the app's attempt and why
 * it is paused.
 *
 * @returns the lines, in menu order
 */
export function chairTray(): readonly string[] {
  return chairTrayLines({ last: pressed.at(-1), paused: pausedReason(), problem, view });
}

/**
 * Read the saved attempts: none on a first launch.
 *
 * @returns every saved attempt, none when there is no file, or why the file could not be used
 */
function readAttempts(): ResultAsync<readonly HandOffAttempt[], string> {
  return ResultAsync.fromPromise(
    readFile(attemptPath(), "utf8").then(
      (text): string | undefined => text,
      (cause: unknown) => {
        if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
          return undefined;
        }
        throw cause;
      },
    ),
    (cause) =>
      `the saved hand-off attempts could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
  ).andThen((text) => {
    if (text === undefined) {
      return okAsync([]);
    }
    const parsed = parseHandOffAttempts({ text });
    return parsed.isErr() ? errAsync(parsed.error) : okAsync(parsed.value);
  });
}

/**
 * Save every attempt atomically, recording why when it fails.
 *
 * @param attempts the whole list to save, one per pressed chat
 * @returns whether it is on disk
 */
async function saveAttempts({ attempts }: { attempts: readonly HandOffAttempt[] }): Promise<boolean> {
  // One temporary file per write, so two writes can never share one and land each other's bytes.
  const path = attemptPath();
  const temporary = `${path}.${String(process.pid)}.${randomUUID()}.tmp`;
  const saved = await ResultAsync.fromPromise(
    writeFile(temporary, `${JSON.stringify(attempts, null, 2)}\n`, "utf8").then(() => rename(temporary, path)),
    (cause) => (cause instanceof Error ? cause.message : String(cause)),
  );
  unsavedMemory = saved.isErr() ? `the hand-off attempts could not be saved: ${saved.error}` : undefined;
  return saved.isOk();
}

/**
 * Press `supervisor hand-off` for one episode once its attempt is on disk, then save how it ended and read the chair
 * again so the menu shows the new chair rather than the old one for up to a minute.
 *
 * @param checkout the checkout whose `bin/slopweaver` runs
 * @param episode the verb's episode key for the outgoing chat
 */
async function pressHandOff({ checkout, episode }: { checkout: string; episode: string }): Promise<void> {
  handingOff = true;
  const running: HandOffAttempt = {
    atIso: new Date().toISOString(),
    episode,
    line: "started by the chair watch",
    outcome: "running",
  };
  const before = withAttempt({ attempt: running, pressed });
  if (!(await saveAttempts({ attempts: before }))) {
    handingOff = false;
    hostOf().redrawTray();
    return;
  }
  pressed = before;
  hostOf().redrawTray();
  const ran = await run({
    cwd: checkout,
    label: join(checkout, "bin", "slopweaver"),
    launch: ({ done, options }) =>
      execFile(join(checkout, "bin", "slopweaver"), ["supervisor", "hand-off"], options, done),
    timeoutMs: HAND_OFF_TIMEOUT_MS,
  });
  const atIso = new Date().toISOString();
  let ended: HandOffAttempt;
  if (ran.isErr()) {
    ended = { atIso, episode, line: lastPrintedLine({ text: ran.error }), outcome: "failed" };
  } else {
    const printed = ran.value.code === 0 ? ran.value.stdout : `${ran.value.stdout}\n${ran.value.stderr}`;
    ended = {
      atIso,
      episode,
      line: lastPrintedLine({ text: printed }),
      outcome: handOffOutcomeOf({ code: ran.value.code }),
    };
  }
  pressed = withAttempt({ attempt: ended, pressed });
  // The running attempt already on disk keeps this episode pressed once, so a failed save here loses only the words.
  await saveAttempts({ attempts: pressed });
  handingOff = false;
  hostOf().redrawTray();
  checkChair();
}

/**
 * Read the chair through one checkout, and press a hand-off the reading makes due while the saved attempts read.
 *
 * @param checkout the checkout whose `bin/slopweaver` runs
 */
async function readChair({ checkout }: { checkout: string }): Promise<void> {
  const ran = await run({
    cwd: checkout,
    label: join(checkout, "bin", "slopweaver"),
    launch: ({ done, options }) =>
      execFile(join(checkout, "bin", "slopweaver"), ["supervisor", "chair-watch", "--json"], options, done),
    timeoutMs: WATCH_TIMEOUT_MS,
  });
  watching = false;
  if (ran.isErr()) {
    problem = lastPrintedLine({ text: ran.error });
    hostOf().redrawTray();
    return;
  }
  const parsed = parseChairWatch({ text: ran.value.stdout });
  if (parsed.isErr()) {
    problem = `${parsed.error}: ${lastPrintedLine({ text: ran.value.stderr })}`;
    hostOf().redrawTray();
    return;
  }
  problem = undefined;
  view = parsed.value;
  const episode = handOffEpisodeOf({ view: parsed.value });
  if (unreadMemory === undefined && episode !== undefined && handOffDue({ pressed, view: parsed.value })) {
    await pressHandOff({ checkout, episode });
    return;
  }
  hostOf().redrawTray();
}

/** Read the chair now, unless a read or a hand-off is already running. */
function checkChair(): void {
  if (watching || handingOff) {
    return;
  }
  const chosen = hostOf().checkout();
  if (chosen.isErr()) {
    problem = chosen.error.message;
    hostOf().redrawTray();
    return;
  }
  watching = true;
  void readChair({ checkout: chosen.value });
}

/**
 * Start the timer: read the saved attempts, then read the chair now and every minute after.
 *
 * @param watchHost what the timer reads from the rest of the shell
 */
export function startChairWatch({ watchHost }: { watchHost: ChairWatchHost }): void {
  host = watchHost;
  void (async () => {
    const saved = await readAttempts();
    if (saved.isErr()) {
      unreadMemory = saved.error;
    } else {
      pressed = saved.value;
    }
    checkChair();
    setInterval(checkChair, WATCH_INTERVAL_MS);
  })();
}
