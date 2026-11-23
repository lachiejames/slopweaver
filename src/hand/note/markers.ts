/**
 * THE NOTE'S ANSWERS ON DISK — the marker files a floating note, a settle or another surface leaves in
 * `hand-steps/dismiss/`, written and read back as values. `../reconcile.ts` decides what each one does; this
 * module only names, writes and lists them.
 *
 * A marker is `<id>.done`, `<id>.later` or `<id>.snooze-<choice>`, carrying the instant it was written; any other
 * file in the directory is not one and is left alone — including a kind answer, `<id>.mute-kind` or
 * `<id>.when-worse`, which the monitor lane reads through `../kindAnswers.ts` rather than the reconcile.
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "../../lib/errorMessage.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { type HandStepError, HandStepErrors } from "../errors.js";
import { KIND_ANSWERS } from "../kindAnswers.js";
import { SNOOZE_MARKER_SUFFIXES, type SnoozeChoice, snoozeChoiceOfSuffix, snoozeMarkerSuffix } from "../snooze.js";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** One marker on disk: whose step, and which answer — Done, a legacy Later, or a snooze with its choice. */
export type NoteMarker =
  | { readonly id: string; readonly answer: "done" | "later"; readonly path: string }
  | { readonly id: string; readonly answer: "snooze"; readonly choice: SnoozeChoice; readonly path: string };

/**
 * Every marker one step's panel or a settle can leave: Done, a snooze per choice, the Later a settle writes, and
 * the two kind answers (`../kindAnswers.ts`) — so a pending kind press reads as a dismissed note, and a raise
 * clears a stale one exactly as it clears a stale snooze.
 *
 * @param markerDir where markers live
 * @param id the step's id
 * @returns every marker path, present or not
 */
export function markerPaths({ markerDir, id }: { markerDir: string; id: string }): readonly string[] {
  return ["done", "later", ...SNOOZE_MARKER_SUFFIXES, ...KIND_ANSWERS].map((suffix) =>
    join(markerDir, `${id}.${suffix}`),
  );
}

/**
 * Write one step's marker carrying the instant it was dropped, creating the marker directory first.
 *
 * @param home the state home
 * @param name the marker's file name, `<id>.<suffix>`
 * @param nowIso the instant the marker carries
 * @returns the marker's path, or the failure
 */
function writeMarker({
  home,
  name,
  nowIso,
}: {
  home: string;
  name: string;
  nowIso: string;
}): Result<string, HandStepError> {
  const markerDir = stateHomePaths({ home }).handNoteDismiss;
  const path = join(markerDir, name);
  try {
    mkdirSync(markerDir, { mode: DIR_MODE, recursive: true });
    writeFileSync(path, `${nowIso}\n`, { mode: FILE_MODE });
  } catch (cause) {
    return err(HandStepErrors.surfaceFailed({ cause: errorMessage({ error: cause }), surface: "note" }));
  }
  return ok(path);
}

/**
 * Take a running note down with the owner's snooze answer — the marker the note's own band writes, so a running panel
 * closes on it and a reconcile records it exactly as if the owner had pressed the button.
 *
 * @param id the id of the step whose note should close
 * @param choice the snooze the owner chose on another surface
 * @param home the state home
 * @param nowIso the press instant, which the wake time counts from
 * @returns the marker's path, or the failure
 */
export function snoozeHandNote({
  id,
  choice,
  home,
  nowIso,
}: {
  id: string;
  choice: SnoozeChoice;
  home: string;
  nowIso: string;
}): Result<string, HandStepError> {
  return writeMarker({ home, name: `${id}.${snoozeMarkerSuffix({ choice })}`, nowIso });
}

/**
 * Take a running note down without saying anything about whether the step happened — the close a SETTLE
 * leaves (`hand done`, a retraction, a supersede, evidence), never the owner's answer, which is a snooze.
 *
 * A `later` marker rather than a `done` one, and that asymmetry is the rule: closing a window is not doing
 * the thing, and a register that recorded it as one would let a dismissed note read as finished work.
 *
 * It takes the step's ID rather than the step. `hand done` has just settled a row and knows nothing but an
 * id, and asking it to reconstruct a whole step to close a window would mean assembling a literal no rule
 * ever checked.
 *
 * @param id the id of the step whose note should close
 * @param home the state home
 * @param nowIso what to write into the marker, so a reader can see when it was dropped
 * @returns the marker's path, or the failure
 */
export function dismissHandNote({
  id,
  home,
  nowIso,
}: {
  id: string;
  home: string;
  nowIso: string;
}): Result<string, HandStepError> {
  return writeMarker({ home, name: `${id}.later`, nowIso });
}

/**
 * Which marker a file name is, if it is one.
 *
 * @param name the file name inside the marker directory
 * @param markerDir the marker directory, joined into the marker's path
 * @returns the marker, or undefined for a file this reader does not recognise
 */
function markerOfName({ name, markerDir }: { name: string; markerDir: string }): NoteMarker | undefined {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return undefined;
  }
  const id = name.slice(0, dot);
  const suffix = name.slice(dot + 1);
  const path = join(markerDir, name);
  if (suffix === "done" || suffix === "later") {
    return { answer: suffix, id, path };
  }
  const choice = snoozeChoiceOfSuffix({ suffix });
  if (choice === undefined) {
    return undefined;
  }
  return { answer: "snooze", choice, id, path };
}

/**
 * Every marker currently in the directory, sorted by step id. An absent directory is no markers, which is the
 * ordinary case.
 *
 * @param markerDir where the note writes its answer
 * @returns the markers, or why the directory would not list
 */
export function readNoteMarkers({ markerDir }: { markerDir: string }): Result<readonly NoteMarker[], HandStepError> {
  let names: readonly string[];
  try {
    names = readdirSync(markerDir);
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return ok([]);
    }
    return err(HandStepErrors.storeUnreadable({ cause: errorMessage({ error }), path: markerDir }));
  }
  const markers = names.flatMap((name) => {
    const marker = markerOfName({ markerDir, name });
    return marker === undefined ? [] : [marker];
  });
  return ok(markers.toSorted((a, b) => a.id.localeCompare(b.id)));
}
