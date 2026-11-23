/**
 * `fleet-unhealthy`'s shell: read every slot attempt started inside the window, probe each holder pid, take the
 * pass's listener heartbeat read and read the arm record beside it, the repairs in hand and what the last note showed (`./fleetHealthShown.ts`), and hand them to
 * the pure verdict (`./fleetHealth.ts`).
 *
 * The ledger is one small file per firing, named by a hash, so nothing can be filtered by name: a file whose mtime is
 * older than the window cannot hold an attempt started inside it, and is skipped before it is parsed (653 files by
 * `ls ~/.slopweaver/live/recipe/slot-attempts | wc -l`).
 */
import { lstatSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { Result } from "#lib/result.js";

import { readFileIfPresent } from "../atlas/atlasFile.js";
import type { SignInProvider } from "../browser/signInPress.js";
import { noteStanding } from "../hand/note/raise.js";
import { readPlanEmails } from "../hand/planSignIn.js";
import { openHandSteps } from "../hand/row.js";
import type { HandStep } from "../hand/step.js";
import { handRegisterPath, readHandRows } from "../hand/store.js";
import { errorMessage } from "../lib/errorMessage.js";
import { isRecord } from "../lib/parsers.js";
import { safeJsonParse } from "../lib/safeJson.js";
import { loadLiftedRecipeDefinitions } from "../live/automation/definitionStore.js";
import { holdStands } from "../live/automation/failureHold.js";
import { type ProcessAlive, recipeHolderAlive } from "../live/automation/holderLiveness.js";
import { attemptOf } from "../live/automation/slotAttemptCodec.js";
import type { ListenerStateError } from "../live/listen/supervise/errors.js";
import type { ListenerHeartbeat } from "../live/listen/supervise/heartbeat.js";
import { readListenerArm } from "../live/listen/supervise/store.js";
import { readActiveResyncStates } from "../live/resync/activeState.js";
import { stateHomePaths } from "../stateHome.js";

import { evaluateFleetUnhealthy, listenerNeverArmed, tallyAttempts } from "./fleetHealth.js";
import { FLEET_HEALTH_WINDOW_MS, type ProbedAttempt } from "./fleetHealthAttempts.js";
import { type RowFate, rowFatesOf } from "./fleetHealthFate.js";
import { fleetNoteUp, yourSteps } from "./fleetHealthHand.js";
import { readFleetHealthShown } from "./fleetHealthShown.js";
import { hostOf, signInWallRows } from "./resyncSignedOut.js";
import { readRepairs } from "./stoppedSource.js";
import type { MonitorReading } from "./types.js";

/** Every attempt the window can hold, and the files that did not read. */
interface LedgerRead {
  readonly attempts: readonly ProbedAttempt[];
  readonly unread: readonly string[];
}

/**
 * Read the slot ledger's attempts that may have started inside the window.
 *
 * An absent directory is a ledger nothing has written yet — no firing, so none failed. Any other failure to list it
 * is returned as the reason, which the caller reads as unmeasurable.
 *
 * @param directory the slot-attempt directory
 * @param sinceMs the window's start, epoch milliseconds
 * @param processAlive probes a holder pid
 * @returns the attempts and the unread files, or why the directory would not list
 */
export function readWindowAttempts({
  directory,
  sinceMs,
  processAlive,
}: {
  directory: string;
  sinceMs: number;
  processAlive: ProcessAlive;
}): LedgerRead | { readonly because: string } {
  let names: readonly string[];
  try {
    names = readdirSync(directory).filter((name) => name.endsWith(".json"));
  } catch (cause) {
    if (isRecord(cause) && cause["code"] === "ENOENT") {
      return { attempts: [], unread: [] };
    }
    return { because: `the slot ledger ${directory} would not list: ${errorMessage({ error: cause })}` };
  }
  const attempts: ProbedAttempt[] = [];
  const unread: string[] = [];
  for (const name of names) {
    const path = join(directory, name);
    const one = readOneAttempt({ path, processAlive, sinceMs });
    if (one === "unread") {
      unread.push(name);
    } else if (one !== "outside") {
      attempts.push(one);
    }
  }
  return { attempts, unread };
}

/** One ledger file: its probed attempt, `outside` when it predates the window, or `unread`. */
function readOneAttempt({
  path,
  sinceMs,
  processAlive,
}: {
  path: string;
  sinceMs: number;
  processAlive: ProcessAlive;
}): ProbedAttempt | "outside" | "unread" {
  try {
    if (statSync(path).mtimeMs < sinceMs) {
      return "outside";
    }
  } catch {
    return "unread";
  }
  const raw = readFileIfPresent({ path });
  if (raw.isErr() || raw.value === null) {
    return "unread";
  }
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: path, text: raw.value });
  } catch {
    return "unread";
  }
  const attempt = attemptOf({ value: decoded });
  if (attempt === undefined) {
    return "unread";
  }
  const holderAlive = attempt.holderPid === null ? null : processAlive({ pid: attempt.holderPid });
  return { attempt, holderAlive };
}

/**
 * The window's slot attempts of rows that still exist. A retired row's failures are not the fleet's health: its row
 * will never run again (a retired schedule leaves no live row). Kept whole when the definitions cannot say
 * which rows exist (`../live/resync/activeState.ts`).
 *
 * @param home the Slopweaver home
 * @param nowIso the instant the window ends at
 * @returns the filtered read and why it may have kept a retired row, or why the ledger would not list
 */
function liveWindowAttempts({ home, nowIso }: { home: string; nowIso: string }):
  | { readonly because: string }
  | {
      readonly read: Exclude<ReturnType<typeof readWindowAttempts>, { readonly because: string }>;
      readonly definitionProblem: string | null;
    } {
  const recipe = stateHomePaths({ home }).live.recipe;
  const windowRead = readWindowAttempts({
    directory: recipe.slotAttemptsDir,
    processAlive: recipeHolderAlive,
    sinceMs: Date.parse(nowIso) - FLEET_HEALTH_WINDOW_MS,
  });
  if ("because" in windowRead) {
    return { because: windowRead.because };
  }
  const active = readActiveResyncStates({ definitionsDir: recipe.definitionsDir, stateDir: recipe.resyncStateDir });
  return {
    definitionProblem: active.definitionProblem,
    read: {
      ...windowRead,
      attempts: windowRead.attempts.filter((probed) => active.isLive({ recipeId: probed.attempt.recipeId })),
    },
  };
}

/**
 * Whether no supervised listener ever armed on this home, judged off the pass's ONE heartbeat read — never a second,
 * since a re-read could find absent what `bot-off-the-air` found unreadable — beside the arm record and the arm
 * journal, so a listener that armed and was cleared before its first beat is never excused as one that never armed.
 * The journal is measured in raw bytes rather than through `readListenerArmEvents`, which drops a line that will not
 * decode: a torn `armed` line, or anything else a writer left, is still a listener that existed. Nothing past the heartbeat is read unless
 * that heartbeat read absent, and neither file is opened unless it is absent or a regular file, so a pass that
 * reported a blind spot before this exception existed still reaches it without a read that could block.
 *
 * @param heartbeat the heartbeat read `bot-off-the-air` judged this pass
 * @param home the Slopweaver home
 * @returns the never-armed verdict
 */
function neverArmedOn({
  heartbeat,
  home,
}: {
  heartbeat: Result<ListenerHeartbeat | undefined, ListenerStateError>;
  home: string;
}): boolean {
  const { armJson, armsJsonl } = stateHomePaths({ home }).live.listener;
  const candidate = heartbeat.isOk() && heartbeat.value === undefined;
  if (!candidate || !absentOrRegular({ path: armJson }) || !absentOrRegular({ path: armsJsonl })) {
    return false;
  }
  // The REVERSE of the writer's order (arm, then journal, then the first beat — `listen/selfRecord.ts`), so a
  // registration racing this pass can never read as three absences: any write it lands first is read here last.
  const journalBytes = readFileIfPresent({ path: armsJsonl }).map((text) =>
    text === null ? 0 : Buffer.byteLength(text, "utf8"),
  );
  const arm = readListenerArm({ home });
  return listenerNeverArmed({ arm, heartbeat, journalBytes });
}

/**
 * Whether a path is safe to read whole: absent, or a regular file. A FIFO, a socket or a directory there is not
 * a listener state file at all, and a blocking read of a writerless FIFO would hang the pass. `lstat`, never
 * `stat`: a symlink, dangling or not, is something that is there, and following one would read a dangling link as
 * an absence.
 *
 * @param path the listener state file about to be read
 * @returns false for anything that exists and is not a regular file, or that would not even stat
 */
function absentOrRegular({ path }: { path: string }): boolean {
  try {
    return lstatSync(path).isFile();
  } catch (error: unknown) {
    return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
  }
}

/**
 * Read and evaluate `fleet-unhealthy`.
 *
 * @param home the Slopweaver home
 * @param nowIso the instant to judge at
 * @param listener `bot-off-the-air`'s reading this same pass, so the listener is read once, and the raw heartbeat
 *   read it was judged from, which with the arm record and journal says never-armed
 * @returns the reading — unmeasurable only when the ledger itself would not list
 */
export async function readFleetUnhealthy({
  home,
  nowIso,
  listener,
  signIn,
}: {
  home: string;
  nowIso: string;
  listener: {
    readonly reading: MonitorReading;
    readonly heartbeat: Result<ListenerHeartbeat | undefined, ListenerStateError>;
  };
  /** `resync-signed-out`'s reading this same pass, so a row's line says its sign-in card only when one is carried. */
  signIn: MonitorReading;
}): Promise<MonitorReading> {
  const live = liveWindowAttempts({ home, nowIso });
  if ("because" in live) {
    return { because: live.because, monitorId: "fleet-unhealthy", state: "unmeasurable" };
  }
  const { read, definitionProblem } = live;
  const tally = tallyAttempts({ attempts: read.attempts, nowIso });
  const repairs = readRepairs({ home, stopped: new Set([...tally.failing, ...tally.died]) });
  const unreadSpot =
    read.unread.length === 0 ? [] : [`${String(read.unread.length)} slot-attempt file(s) did not read`];
  const repairSpot = repairs.problem === undefined ? [] : [repairs.problem];
  // An unreadable memory is read as none — every failing row is then news, so nothing is swallowed — and the next
  // fired post overwrites it.
  const memory = readFleetHealthShown({ home });
  const memorySpot = memory.problem === undefined ? [] : [memory.problem];
  // An unreadable register joins no card, so every row falls to what the fleet is doing — named, never guessed.
  const register = readHandRows({ missing: "empty", path: handRegisterPath({ home }) });
  const registerSpot = register.isErr() ? [`the hand register did not read: ${register.error.message}`] : [];
  const definitionSpot = definitionProblem === null ? [] : [definitionProblem];
  const spots = [...unreadSpot, ...definitionSpot, ...repairSpot, ...memorySpot, ...registerSpot];
  const openSteps = register.isErr() ? [] : openHandSteps({ rows: register.value.rows });
  return evaluateFleetUnhealthy({
    inputs: {
      attempts: read.attempts,
      blindSpot: spots.length === 0 ? undefined : spots.join("; "),
      bot: listener.reading,
      fates: await fatesOf({
        failing: [...new Set([...tally.failing, ...tally.died])],
        home,
        openSteps,
        repairing: repairs.taken,
        signIn,
      }),
      listenerNeverArmed: neverArmedOn({ heartbeat: listener.heartbeat, home }),
      noteUp: fleetNoteUp({ openSteps, showing: (stepId) => cardNoteUp({ home, stepId }) }),
      repairing: repairs.taken.size,
      shown: memory.shown,
    },
    nowIso,
  });
}

/**
 * Each failing row's fate, joined off the open hand register, the failure holds, the sign-in walls and the repairs a
 * seat has taken (`./fleetHealthFate.ts` § rowFatesOf).
 *
 * @param failing every recipe id failing or dying in the window
 * @param openSteps every open card on the hand register
 * @param repairing the seat's board row, for each row a seat has taken the repair of
 * @param signIn `resync-signed-out`'s reading this same pass
 * @returns each failing row's fate, by recipe id
 */
async function fatesOf({
  home,
  failing,
  openSteps,
  repairing,
  signIn,
}: {
  home: string;
  failing: readonly string[];
  openSteps: readonly HandStep[];
  repairing: ReadonlyMap<string, string>;
  signIn: MonitorReading;
}): Promise<ReadonlyMap<string, RowFate>> {
  const held = failureHolds({ home });
  const { fleetPresses, pending, signedIn } = signInCarried({ home, signIn });
  const yours = yourSteps({
    openSteps,
    plans: await readPlanEmails({ home }),
    rows: failing.map((recipeId) => ({
      holdFinding: held.get(recipeId),
      recipeId,
      repairRow: repairing.get(recipeId),
      signInHost: pending.get(recipeId),
    })),
  });
  return rowFatesOf({ failing, fleetPresses, held: new Set(held.keys()), repairing, signedIn, yours });
}

/**
 * Whether one card's note is on the owner's screen now. A note whose files will not read counts as not up: the cost is a
 * closed card's button left standing until the next note, never a note the owner put away raised again.
 *
 * @param home the Slopweaver home
 * @param stepId the open card whose note is read
 * @returns true only when the note reads as up
 */
function cardNoteUp({ home, stepId }: { home: string; stepId: string }): boolean {
  const standing = noteStanding({ clock: () => new Date().toISOString(), home, id: stepId });
  return standing.isOk() && standing.value === "up";
}

/**
 * The rows a failure hold pauses, each with the board finding it pauses on, read in the LIFTED view `run-due` fires
 * from: a hold whose finding has settled no longer pauses its row, so the note never calls a row paused that ran
 * since. A roster that will not read pauses none here — every failing row then says its next slot runs it, which the
 * hold would contradict only in wording, never in action.
 *
 * @param home the Slopweaver home
 * @returns the finding slug, by held recipe id
 */
export function failureHolds({ home }: { home: string }): ReadonlyMap<string, string> {
  const { definitions } = loadLiftedRecipeDefinitions({ home });
  const holds = new Map<string, string>();
  for (const definition of definitions) {
    const hold = definition.hold;
    if (hold?.finding !== undefined && holdStands({ hold })) {
      holds.set(definition.recipeId, hold.finding);
    }
  }
  return holds;
}

/**
 * Which failing rows' sign-in cards `resync-signed-out` carries this pass: those still waiting on the owner's sign-in, and
 * those whose card the owner pressed Done on, and those whose Datadog or GitHub wall the fleet presses itself.
 *
 * Keyed off that monitor's own reading rather than the register, so the line never names a sign-in the pass did not
 * carry: a row it could not read is simply not a sign-in here.
 *
 * @param home the Slopweaver home, for each row's newest attempt
 * @param signIn `resync-signed-out`'s reading this pass
 * @returns the host each carried row stopped at, by recipe id, split on whether the owner pressed Done or the fleet presses
 */
function signInCarried({ home, signIn }: { home: string; signIn: MonitorReading }): {
  pending: ReadonlyMap<string, string>;
  signedIn: ReadonlyMap<string, string>;
  fleetPresses: ReadonlyMap<string, { readonly host: string; readonly provider: SignInProvider }>;
} {
  if (signIn.state !== "firing") {
    return { fleetPresses: new Map(), pending: new Map(), signedIn: new Map() };
  }
  const carried = new Set(signIn.subjects.map((subject) => subject.id));
  // A hold the fleet presses through is not the owner's Done, so it is read first and never counted as one.
  const pressedBy = new Map(
    signIn.subjects.flatMap((subject) =>
      subject.fleetPresses === undefined ? [] : [[subject.id, subject.fleetPresses] as const],
    ),
  );
  const done = new Set(
    signIn.subjects
      .filter((subject) => subject.delivery?.kind === "hold" && subject.fleetPresses === undefined)
      .map((subject) => subject.id),
  );
  const recipe = stateHomePaths({ home }).live.recipe;
  const { states } = readActiveResyncStates({ definitionsDir: recipe.definitionsDir, stateDir: recipe.resyncStateDir });
  const pending = new Map<string, string>();
  const signedIn = new Map<string, string>();
  const fleetPresses = new Map<string, { readonly host: string; readonly provider: SignInProvider }>();
  for (const row of signInWallRows({ states: [...states.values()] })) {
    const host = hostOf({ origin: row.origin });
    const provider = pressedBy.get(host);
    if (provider !== undefined) {
      fleetPresses.set(row.recipeId, { host, provider });
    } else if (done.has(host)) {
      signedIn.set(row.recipeId, host);
    } else if (carried.has(host)) {
      pending.set(row.recipeId, host);
    }
  }
  return { fleetPresses, pending, signedIn };
}
