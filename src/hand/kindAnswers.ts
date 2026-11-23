/**
 * THE TWO KIND ANSWERS — "Never for this kind" and "When it gets worse", the note's answers that speak about a
 * monitor KIND rather than one step, named and read off disk here.
 *
 * The note writes `<id>.mute-kind` or `<id>.when-worse` into the marker directory, carrying the press instant.
 * They are deliberately NOT {@link NoteMarker}s: `../reconcile.ts` settles every marker it recognises as Done, and
 * neither answer says the step happened. The monitor lane turns them into a mute or an escalation hold
 * (`../monitor/kindAnswerPresses.ts`); this module stays monitor-free, so the hand register never learns what a
 * monitor is. Which answers a note offers is the monitor lane's decision too, handed in as a {@link KindAnswerOffer}.
 */
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "../lib/errorMessage.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import { type HandStepError, HandStepErrors } from "./errors.js";
import { isHandStepId } from "./step.js";

/** Every kind answer, as the marker suffix the note writes. */
export const KIND_ANSWERS = ["mute-kind", "when-worse"] as const;

/** One kind answer: mute the monitor kind's note, or hold the note down until the subject reads worse. */
export type KindAnswer = (typeof KIND_ANSWERS)[number];

/** Which of the two kind answers one step's note offers. A step that is no monitor card offers neither. */
export interface KindAnswerOffer {
  /** "Never for this kind" — refused for a notice kind, whose note is its only delivery. */
  readonly muteKind: boolean;
  /** "When it gets worse" — only where the monitor declares what worse means for its subject. */
  readonly whenWorse: boolean;
}

/** The offer of a step no monitor speaks for: both answers absent, and the note's band exactly as before. */
export const NO_KIND_ANSWERS: KindAnswerOffer = { muteKind: false, whenWorse: false };

/**
 * The words a kind answer's button carries.
 *
 * @param answer the kind answer
 * @returns its button title
 */
export function kindAnswerLabel({ answer }: { answer: KindAnswer }): string {
  if (answer === "mute-kind") {
    return "Never for this kind";
  }
  return "When it gets worse";
}

/**
 * Which kind answer a marker suffix is, if it is one.
 *
 * @param suffix the text after a marker file's last dot
 * @returns the answer, or undefined for any other suffix
 */
function kindAnswerOfSuffix({ suffix }: { suffix: string }): KindAnswer | undefined {
  return KIND_ANSWERS.find((answer) => answer === suffix);
}

/** One kind-answer press on disk: whose step, which answer, where, and the instant the note stamped into it. */
export interface KindAnswerMarker {
  readonly id: string;
  readonly answer: KindAnswer;
  readonly path: string;
  /** The marker's own bytes, trimmed — the press instant, or an empty string when the file would not read. */
  readonly pressedIso: string;
  /** Why the file would not read, when it would not — a press that may yet read, so it is kept, never refused. */
  readonly unreadable?: string;
}

/**
 * Every kind-answer press currently in the marker directory, sorted by step id. An absent directory is none.
 *
 * @param markerDir where the note writes its answers
 * @returns the presses, or why the directory would not list
 */
export function readKindAnswerMarkers({
  markerDir,
}: {
  markerDir: string;
}): Result<readonly KindAnswerMarker[], HandStepError> {
  let names: readonly string[];
  try {
    names = readdirSync(markerDir);
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return ok([]);
    }
    return err(HandStepErrors.storeUnreadable({ cause: errorMessage({ error }), path: markerDir }));
  }
  const markers = names.flatMap((name): KindAnswerMarker[] => {
    // Read lower-cased, as macOS's own volume resolves the lower-case path every note and every lookup uses: an
    // upper-cased entry there IS that marker, so it is listed under the id that names it — and removed by its own path.
    const folded = name.toLowerCase();
    const dot = folded.lastIndexOf(".");
    if (dot <= 0) {
      return [];
    }
    const answer = kindAnswerOfSuffix({ suffix: folded.slice(dot + 1) });
    const id = folded.slice(0, dot);
    // A name no step could carry is no note's press — no note writes one — so it keeps nothing down, and is never
    // listed with a remove the verb would refuse.
    if (answer === undefined || !isHandStepId({ id })) {
      return [];
    }
    const path = join(markerDir, name);
    return [{ answer, id, path, ...markerStamp({ path }) }];
  });
  return ok(markers.toSorted((a, b) => a.id.localeCompare(b.id)));
}

/**
 * Remove one consumed kind-answer press. Recursive, because ANY entry under an answer's suffix is read as a press and
 * keeps its note down — a directory there included — so the remove that releases it must be able to take it. A
 * marker that will not go is named, never thrown: it is read again next pass, and every consumer is idempotent over a
 * press it already recorded.
 *
 * @param marker the press to remove
 * @returns nothing, or why the marker would not go
 */
export function consumeKindAnswerMarker({ marker }: { marker: KindAnswerMarker }): Result<void> {
  try {
    rmSync(marker.path, { force: true, recursive: true });
    return ok(undefined);
  } catch (error: unknown) {
    return err([`the press at ${marker.path} would not go: ${errorMessage({ error })}`]);
  }
}

/**
 * The stamp a marker carries, trimmed. An empty one a consumer refuses by name; one whose read FAILED carries why,
 * so a consumer keeps it — the owner's press is still on disk, and refusing it would throw their answer away. Only a REGULAR
 * file is read: a FIFO would block the read forever, so anything else is unreadable.
 *
 * @param path the marker file
 * @returns the stamp text, and why the read failed when it did
 */
function markerStamp({ path }: { path: string }): { pressedIso: string; unreadable?: string } {
  try {
    if (!statSync(path).isFile()) {
      return { pressedIso: "", unreadable: "the press is no regular file" };
    }
    return { pressedIso: readFileSync(path, "utf8").trim() };
  } catch (error: unknown) {
    return { pressedIso: "", unreadable: errorMessage({ error }) };
  }
}
