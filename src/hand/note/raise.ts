/**
 * Raising and taking down the floating note — the one effectful edge of `./panel.ts`, `./bundle.ts` and
 * `./liveness.ts`.
 *
 * Everything that decides anything is pure and sits in those files. This reads what is on disk for a step,
 * asks `./liveness.ts` whether to draw, writes the bundle and hands it to `open`, which is the only synchronous
 * primitive that starts something outliving this process (see `./bundle.ts` for why that matters and why it is
 * not a way around `no-headless`).
 *
 * ## One bundle per raise, never one shared bundle
 *
 * Each raise writes its own `notes/<token>/note.app` and never touches another. With one shared `note.app`, two
 * raises close together rewrote the program before either launched process had read it, so both could draw
 * the same step under the same token and each believe it was the one wanted. A
 * bundle is only read at launch, so {@link sweepOldNotes} removes the ones past {@link BUNDLE_SWEEP_MS}.
 *
 * ## Best effort, with the failure reported rather than thrown
 *
 * The precedent is `../../browser/foreground.ts`: a macOS surface that cannot be raised leaves behaviour
 * exactly what it was and says so. The difference here is that the caller CAN act on it — the step is in the
 * register either way, and a verb that could not draw the note still tells the owner where to read it.
 */
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { errorMessage } from "../../lib/errorMessage.js";
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { CONSOLE_URL_ENV, consoleBaseFrom } from "../consoleLink.js";
import { type HandStepError, HandStepErrors } from "../errors.js";
import type { KindAnswerOffer } from "../kindAnswers.js";
import { laterHeld, laterLedgerDir } from "../laterPresses.js";
import { snoozeActive } from "../snooze.js";
import { forgetSnooze, snoozeOf } from "../snoozeStore.js";
import type { HandStep } from "../step.js";

import { handNoteBundleFiles } from "./bundle.js";
import { decideNoteRaise, type NoteObservation, noteShowing, raiseToken, type WhenLive } from "./liveness.js";
import { markerPaths } from "./markers.js";
import { handNotePanelBuild, handNotePanelSource, type NoteLevel } from "./panel.js";
import { NEVER_LAUNCHED, reserveSlot, sweepReservations } from "./slots.js";
import { triageNotePaths } from "./triagePaths.js";

/** Owner-only permissions, matching the register the bundle is written beside. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const EXECUTABLE_MODE = 0o700;

/**
 * How old a bundle or a beat must be before a raise sweeps it, in milliseconds.
 *
 * A bundle is read once, when LaunchServices starts it, and a running panel re-writes its beat every second —
 * so ten minutes is far past any launch and any live beat, and small enough that `notes/` never grows past a
 * handful of entries.
 */
const BUNDLE_SWEEP_MS = 600_000;

/**
 * The bundle's own file name inside its token directory. macOS names the process after it, so it stays
 * `note` in Activity Monitor and the window list rather than a UUID.
 */
const NOTE_APP = "note.app";

/** One command, as argv — nothing here is ever joined into a shell line. */
export interface NoteCommand {
  readonly file: string;
  readonly args: readonly string[];
}

/** The seam every launch runs through, so a test drives the whole raise and touches no real app. */
export type NoteRun = (command: NoteCommand) => void;

/**
 * What a raise did: drew a note under a fresh token in the cascade slot it reserved, or found this step's note
 * up and kept it. A note of another step never stops a raise: notes stack.
 */
export type RaisedNote =
  | {
      readonly kind: "launched";
      readonly token: string;
      readonly slot: number;
      readonly bundlePath: string;
      readonly command: NoteCommand;
    }
  | { readonly kind: "kept" };

/** The files one step's liveness protocol reads and writes. See `./liveness.ts` for who writes which. */
interface LivePaths {
  /** The newest raise's token, written by the raiser alone. */
  readonly wantPath: string;
  /** The live directory, where every panel's `<id>.<token>.beat` and every raise's `<token>.slot` sits. */
  readonly liveDir: string;
}

/**
 * The liveness files for one step, under `$home/hand-steps/live` — the protocol is `./liveness.ts`.
 *
 * @param home the state home
 * @param id the step's id — a validated slug, so it is a safe file name
 * @returns where its wanted token lives, and the directory its beats sit in
 */
function livePaths({ home, id }: { home: string; id: string }): LivePaths {
  const liveDir = join(stateHomePaths({ home }).handSteps, "live");
  return { liveDir, wantPath: join(liveDir, `${id}.want`) };
}

/**
 * The beat file one panel of one step writes.
 *
 * @param liveDir the live directory
 * @param id the step's id
 * @param token the panel's raise token
 * @returns the beat's path
 */
function beatPath({ liveDir, id, token }: { liveDir: string; id: string; token: string }): string {
  return join(liveDir, `${id}.${token}.beat`);
}

/**
 * Read one file's text and modification time, or `undefined` when it is not there.
 *
 * Only a MISSING file is absence. Any other failure — a permission, a directory where a file should be — is
 * thrown, and {@link raiseHandNote} reports it: reading it as "no note is up" would draw a second one over it.
 *
 * @param path the file
 * @returns its trimmed text and mtime, or `undefined`
 */
function readStamped({ path }: { path: string }): { text: string; atMs: number } | undefined {
  try {
    // Whole milliseconds, like every instant it is judged against: an ISO clock read in the same millisecond as a
    // write would otherwise put that write a fraction of a millisecond in its future, which `fresh` refuses.
    return { atMs: Math.floor(statSync(path).mtimeMs), text: readFileSync(path, "utf8").trim() };
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return undefined;
    }
    throw cause;
  }
}

/**
 * The tombstone a failed raise leaves for its own token, in place of deleting what it wrote.
 *
 * @param liveDir the live directory
 * @param token the failed raise's token
 * @returns `<liveDir>/<token>.failed`
 */
function failedPath({ liveDir, token }: { liveDir: string; token: string }): string {
  return join(liveDir, `${token}.failed`);
}

/**
 * Whether the raise that wrote a token failed — its want is then read as never written.
 *
 * @param liveDir the live directory
 * @param token the token a want names
 * @returns true when that raise left a tombstone
 */
function raiseFailed({ liveDir, token }: { liveDir: string; token: string }): boolean {
  return readStamped({ path: failedPath({ liveDir, token }) }) !== undefined;
}

/**
 * What is on disk for one step: whether a raise is wanted, and whether that raise's panel is beating.
 *
 * @param paths the step's liveness files
 * @param id the step's id
 * @returns the observation `./liveness.ts` decides over
 */
function observe({ paths, id }: { paths: LivePaths; id: string }): NoteObservation {
  const want = readStamped({ path: paths.wantPath });
  if (want === undefined || want.text.length === 0 || raiseFailed({ liveDir: paths.liveDir, token: want.text })) {
    return { kind: "absent" };
  }
  const beat = readStamped({ path: beatPath({ id, liveDir: paths.liveDir, token: want.text }) });
  if (beat === undefined) {
    return { kind: "wanted", wantedAtMs: want.atMs };
  }
  return { beat: { atMs: beat.atMs, build: beat.text }, kind: "wanted", wantedAtMs: want.atMs };
}

/**
 * The command that launches a written bundle.
 *
 * `-n` is not optional garnish. Without it `open` resolves the bundle ID, sees an instance of a note already
 * running and merely ACTIVATES it — so a second step posted while a first note is up draws nothing at all,
 * silently, which is the failure mode this whole feature exists to remove. Measured: `open -a`
 * against a running note left the pasteboard untouched and no window appeared, and `open -n -a` drew it.
 *
 * @param bundlePath the `.app` directory
 * @returns `open -n -a <bundle>`
 */
function openNoteCommand({ bundlePath }: { bundlePath: string }): NoteCommand {
  return { args: ["-n", "-a", bundlePath], file: "open" };
}

/**
 * Whether this machine has the surfaces at all.
 *
 * @param platform `process.platform`
 * @returns `undefined` when it does, the refusal when it does not
 */
export function macosOnly({ platform }: { platform: string }): HandStepError | undefined {
  if (platform === "darwin") {
    return undefined;
  }
  return HandStepErrors.notThisPlatform({ platform });
}

/**
 * Everything a raise that draws writes before it launches: its slot reservation, the bundle, then the want.
 *
 * @param bundlePath where this raise's app bundle goes
 * @param live the step's live paths
 * @param nowMs the instant old bundles and slots are swept against
 * @param token this raise's fresh token
 * @param level the window level the note floats at
 * @param kindAnswers which kind answers the note's More… page offers
 * @returns the cascade slot the note draws in
 */
function writeRaise({
  bundlePath,
  home,
  kindAnswers,
  level,
  live,
  nowMs,
  step,
  token,
}: {
  bundlePath: string;
  home: string;
  kindAnswers: KindAnswerOffer;
  level: NoteLevel;
  live: LivePaths;
  nowMs: number;
  step: HandStep;
  token: string;
}): number {
  const paths = stateHomePaths({ home });
  mkdirSync(paths.handNoteDismiss, { mode: DIR_MODE, recursive: true });
  sweepOldNotes({ appsDir: paths.handNoteApps, liveDir: live.liveDir, nowMs });
  clearMarkers({ id: step.id, markerDir: paths.handNoteDismiss });
  const slot = reserveSlot({ id: step.id, level, liveDir: live.liveDir, nowMs, token });
  writeBundle({
    bundlePath,
    panelSource: handNotePanelSource({
      beatPath: beatPath({ id: step.id, liveDir: live.liveDir, token }),
      consoleBase: consoleBaseFrom({ configured: process.env[CONSOLE_URL_ENV] }),
      kindAnswers,
      level,
      liveDir: live.liveDir,
      markerDir: paths.handNoteDismiss,
      slot,
      step,
      token,
      triage: triageNotePaths({ home }),
      wantPath: live.wantPath,
    }),
  });
  writeFileSync(live.wantPath, `${token}\n`, { mode: FILE_MODE });
  return slot;
}

/**
 * Write the note's bundle for one step and launch it — or keep the note already up, under `keep`.
 *
 * The marker directory is CLEARED of this step's own markers first: a step the owner snoozed yesterday
 * would otherwise leave a marker that closes today's note the instant it opens. A raise that keeps writes
 * nothing at all, least of all that — it would clear an answer the standing note may be about to give.
 *
 * The wanted token is written BEFORE the launch, so the newest raise is decided by the order raises
 * happened. A raise that fails anywhere after its slot reservation leaves a tombstone for its own token, so a
 * note that never drew does not suppress the next raise of its step. One that never called `open` frees its slot at
 * once; one whose launch failed holds it through the startup window, since a launcher may report failure for a
 * panel still starting (`./slots.ts`). Nothing here closes
 * another step's note: notes stack, each in its own cascade slot (`./cascade.ts`), and a replaced note of THIS
 * step closes only once the new one has drawn, so a raise that fails leaves whatever was up where it was.
 *
 * @param step the step to draw
 * @param home the state home
 * @param run the launch seam
 * @param whenLive what to do when this step's note is already up — see `./liveness.ts`
 * @param level the window level the note floats at — a meeting's prep note draws above ordinary notes
 * @param nowIso the instant the liveness check judges at
 * @param kindAnswers which kind answers its More… page offers — `NO_KIND_ANSWERS` for a step no monitor speaks for
 * @returns what the raise did, or the failure
 */
export function raiseHandNote({
  step,
  home,
  run,
  whenLive,
  level,
  nowIso,
  kindAnswers,
}: {
  step: HandStep;
  home: string;
  run: NoteRun;
  whenLive: WhenLive;
  level: NoteLevel;
  nowIso: string;
  kindAnswers: KindAnswerOffer;
}): Result<RaisedNote, HandStepError> {
  const paths = stateHomePaths({ home });
  const live = livePaths({ home, id: step.id });
  const nowMs = Date.parse(nowIso);
  const token = raiseToken({ atMs: Date.now(), unique: randomUUID() });
  const bundlePath = join(paths.handNoteApps, token, NOTE_APP);
  // Every failure past this point takes back whatever this raise claimed, on BOTH paths: a want or a slot left
  // naming a note that was never drawn reads as one still starting for the startup window — a raise of its step
  // kept, a slot held — that the owner cannot see the cause of.
  const withdrawClaims = ({ launched }: { launched: boolean }): void => {
    markRaiseFailed({ launched, liveDir: live.liveDir, token });
  };
  let slot: number;
  try {
    mkdirSync(live.liveDir, { mode: DIR_MODE, recursive: true });
    const decision = decideNoteRaise({
      currentBuild: handNotePanelBuild(),
      nowMs,
      observation: observe({ id: step.id, paths: live }),
      whenLive,
    });
    if (decision === "keep") {
      return ok({ kind: "kept" });
    }
    slot = writeRaise({ bundlePath, home, kindAnswers, level, live, nowMs, step, token });
  } catch (cause) {
    withdrawClaims({ launched: false });
    return err(HandStepErrors.surfaceFailed({ cause: errorMessage({ error: cause }), surface: "note" }));
  }
  const command = openNoteCommand({ bundlePath });
  try {
    run(command);
  } catch (cause) {
    withdrawClaims({ launched: true });
    return err(HandStepErrors.surfaceFailed({ cause: errorMessage({ error: cause }), surface: "note" }));
  }
  const released = releaseHolds({ home, id: step.id });
  if (released !== undefined) {
    return err(released);
  }
  return ok({ bundlePath, command, kind: "launched", slot, token });
}

/**
 * Forget the older Later and the snooze that held one step's note down, once its note is up again.
 *
 * Only once the launch went through is the note back up, so only then does either stop holding it down:
 * forgotten before, a failed launch would erase a lapsed snooze `hand wake` retries next tick.
 *
 * @param home the state home
 * @param id the step whose note was raised
 * @returns the first failure, or undefined when both are gone
 */
function releaseHolds({ home, id }: { home: string; id: string }): HandStepError | undefined {
  try {
    rmSync(join(laterLedgerDir({ home }), id), { force: true });
  } catch (cause) {
    return HandStepErrors.laterLedger({ cause: errorMessage({ error: cause }), path: laterLedgerDir({ home }) });
  }
  return forgetSnooze({ home, id })[0];
}

/** Where one step's note stands: on the owner's screen or starting, taken down by them or a settle, or neither. */
export type NoteStanding = "up" | "dismissed" | "absent";

/**
 * Where one step's note stands now — on screen by {@link noteShowing}, on whatever build drew it — plus the two
 * markers a panel or a settle leaves, and the owner's Later once a reconcile has consumed its marker (`../laterPresses.ts`).
 * `absent` is the case no register row shows: a raise that failed, a panel that died, or a machine that restarted
 * under it. A note of another step never takes this one down, so `absent` is never "another note is up".
 *
 * Two false `absent`s this avoids, both of which refused `tick close` while the note was in front of the owner.
 * The instant is taken AFTER the files are read, so a live panel's beat — re-written about once a second —
 * can never land in its future; judged before the read, a beat written in between read as a clock stepped back. And
 * the build is not asked: a note drawn by the program before this checkout's last `panel.ts` change is still up,
 * though the next raise replaces it.
 *
 * @param id the step's id
 * @param home the state home
 * @param clock the instant the note's beat is judged at, read once the note's files have been
 * @returns the standing, or the failure to read the files it sits in
 */
export function noteStanding({
  id,
  home,
  clock,
}: {
  id: string;
  home: string;
  clock: () => string;
}): Result<NoteStanding, HandStepError> {
  try {
    const observation = observe({ id, paths: livePaths({ home, id }) });
    if (noteShowing({ nowMs: Date.parse(clock()), observation })) {
      return ok("up");
    }
    const marked = markerPaths({ id, markerDir: stateHomePaths({ home }).handNoteDismiss }).some(
      (path) => readStamped({ path }) !== undefined,
    );
    // The ledger AFTER the marker: a reconcile writes the owner's Later there before it removes the marker, so a marker
    // gone at the first read is already a ledger entry at the second, and that Later never reads as absent. The
    // snooze store is read after the marker for the same reason, and holds the note down only until it lapses.
    if (marked || laterHeld({ home, id })) {
      return ok("dismissed");
    }
    const snoozed = snoozeOf({ home, id });
    if (snoozed.isErr()) {
      return err(snoozed.error);
    }
    const held = snoozed.value !== undefined && snoozeActive({ nowIso: clock(), untilIso: snoozed.value.untilIso });
    return ok(held ? "dismissed" : "absent");
  } catch (cause) {
    return err(HandStepErrors.surfaceFailed({ cause: errorMessage({ error: cause }), surface: "note" }));
  }
}

/**
 * Take back what a failed raise claimed by leaving a tombstone for its OWN token, never by deleting a file.
 *
 * A step's want is a shared file a newer raise may have rewritten a moment ago, so reading it and then deleting
 * it could remove that newer claim. The tombstone names this raise alone; every
 * reader — a raise's `observe`, a panel's `failedRaise`, the slot reservations (`./slots.ts`) — treats a want or
 * a slot naming it as never written.
 *
 * Best effort by design: it runs on a path that is already reporting a failure, and a claim it could not
 * mark ages out of the startup window on its own.
 *
 * @param liveDir the live directory
 * @param token this raise's own token
 * @param launched whether `open` was called: a raise that never launched frees its slot at once, one whose launch
 *   failed holds it through the startup window, since its panel may yet start
 */
function markRaiseFailed({ liveDir, token, launched }: { liveDir: string; token: string; launched: boolean }): void {
  const text = launched ? "launch failed" : NEVER_LAUNCHED;
  try {
    writeFileSync(failedPath({ liveDir, token }), `${text}\n`, { mode: FILE_MODE });
  } catch {
    // Reported by the caller as the failure it is; the startup window bounds what is left behind.
  }
}

/**
 * Remove bundles, beats and failed-raise tombstones past {@link BUNDLE_SWEEP_MS}, and every slot reservation
 * whose note no longer holds it. A bundle is read only at launch, a live panel re-writes its beat every second,
 * and a tombstone matters only while its token's want is inside the startup window, so nothing this removes is
 * still in use; a reservation is judged by its note, never its own age, since a note may stand for hours.
 *
 * @param appsDir where the per-raise token directories are
 * @param liveDir where the beats are
 * @param nowMs the instant being judged at
 */
function sweepOldNotes({ appsDir, liveDir, nowMs }: { appsDir: string; liveDir: string; nowMs: number }): void {
  mkdirSync(appsDir, { mode: DIR_MODE, recursive: true });
  sweepReservations({ liveDir, nowMs });
  // An entry gone between the listing and the stat was removed by a closing note or another raise: not old.
  const old = ({ path }: { path: string }): boolean => {
    const stamped = statSync(path, { throwIfNoEntry: false });
    return stamped !== undefined && nowMs - stamped.mtimeMs > BUNDLE_SWEEP_MS;
  };
  for (const name of readdirSync(appsDir)) {
    const path = join(appsDir, name);
    if (old({ path })) {
      rmSync(path, { force: true, recursive: true });
    }
  }
  for (const name of readdirSync(liveDir)) {
    const path = join(liveDir, name);
    if ((name.endsWith(".beat") || name.endsWith(".failed")) && old({ path })) {
      rmSync(path, { force: true });
    }
  }
}

/**
 * Write every file of the bundle, creating each one's directory first.
 *
 * @param bundlePath the `.app` directory
 * @param panelSource the composed JXA program
 */
function writeBundle({ bundlePath, panelSource }: { bundlePath: string; panelSource: string }): void {
  for (const file of handNoteBundleFiles({ panelSource })) {
    const path = join(bundlePath, ...file.relativePath.split("/"));
    mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
    writeFileSync(path, file.contents, { mode: FILE_MODE });
    if (file.executable) {
      chmodSync(path, EXECUTABLE_MODE);
    }
  }
}

/**
 * Remove any marker this step already carries, so a stale one cannot close a fresh note.
 *
 * @param markerDir where markers live
 * @param id the step's id
 */
function clearMarkers({ markerDir, id }: { markerDir: string; id: string }): void {
  for (const path of markerPaths({ id, markerDir })) {
    rmSync(path, { force: true });
  }
}
