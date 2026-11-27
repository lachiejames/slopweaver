/**
 * The one thing the outgoing chair writes in a hand-off: its note, recorded by `slopweaver supervisor hand-off note`.
 *
 * It records `note-arrived` with the note's text ONLY while the episode is waiting on its note
 * (`./chairHandOff.ts`'s `noteRefusal`), under the journal's lock, so a note racing the deadline either lands before
 * the run gives up or is refused as late — never both. It finishes no run and spawns nothing: the control plane does
 * both, and the model supplies only what to hand over.
 */
import { readFileSync, statSync } from "node:fs";

import { err, type Result } from "#lib/result.js";

import { noteRefusal } from "./chairHandOff.js";
import { type ChairHandOffError, ChairHandOffErrors } from "./chairHandOffErrors.js";
import { appendEpisodeEventIf } from "./chairHandOffStore.js";

/** The largest note recorded: a hand-off note is a page, not a transcript. */
const NOTE_MAX_BYTES = 64 * 1024;

/**
 * Record the outgoing chair's note against its episode.
 *
 * @param home the state home the episode is journalled under
 * @param episodeId the episode the hand-off request named
 * @param file the file the chair wrote its note to
 * @param nowIso the instant it is recorded
 * @returns the note's length in characters, or why it was not recorded
 */
export function recordChairHandOffNote({
  home,
  episodeId,
  file,
  nowIso,
}: {
  home: string;
  episodeId: string;
  file: string;
  nowIso: string;
}): Result<number, ChairHandOffError> {
  let note: string;
  try {
    if (statSync(file).size > NOTE_MAX_BYTES) {
      return err(
        ChairHandOffErrors.noteRefused({
          why: `${file} is over ${String(NOTE_MAX_BYTES)} bytes; a hand-off note is a page, so cut it to what the files do not already say`,
        }),
      );
    }
    note = readFileSync(file, "utf8");
  } catch (cause: unknown) {
    return err(ChairHandOffErrors.io({ cause, path: file }));
  }
  if (note.trim() === "") {
    return err(ChairHandOffErrors.noteRefused({ why: `${file} is empty, so there is no note to record` }));
  }
  return appendEpisodeEventIf({
    episodeId,
    event: { atIso: nowIso, kind: "note-arrived", note },
    home,
    nowIso,
    refusal: ({ events }) => noteRefusal({ episodeId, events }),
  }).map(() => note.length);
}
