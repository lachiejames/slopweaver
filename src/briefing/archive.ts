/**
 * The pure core of `slopweaver briefing archive`: move a form's oldest folded notes and sections out of it,
 * so the form fits `SECTION_MAX_NOTES` and `HISTORY_MAX_SECTIONS` again without anything being lost.
 *
 * It works on the form as RAW JSON rather than on a validated `BriefingForm`, deliberately: the form that
 * needs archiving is exactly the one the schema refuses, so validating it first would refuse the remedy. It
 * touches only `earlierToday.notes` and `history`, leaves every other field byte-for-byte alone, and never
 * reads a note's contents — which is why it needs no cap of its own and cannot invent a note.
 *
 * Order is the form's own, and the form is NEWEST-FIRST. `slopweaver briefing sweep-block` is the one writer of
 * `earlierToday` and puts each rolled block at the FRONT, and the renderer emits notes in form order, so the
 * newest is what the owner meets first. MEASURED on a chair's form: `jq -r '.earlierToday.notes | (.[0], .[-1]) | .headline[0].text[0:10]' form.json` prints the newest block's time first, then the oldest's.
 * So the overflow is cut from the END by default, because cutting from the front would move out the NEWEST
 * notes; `oldestFirst` is for a hand-built form that APPENDS, whose last `keepNotes` are what stays. Sections follow the same rule.
 */
import { isRecord } from "../lib/parsers.js";
import { HISTORY_MAX_SECTIONS, SECTION_MAX_NOTES } from "./caps.js";

/**
 * What one archive pass moved out of the form.
 *
 * @internal
 */
export interface BriefingArchive {
  /** The trimmed form, ready to render. */
  readonly form: Readonly<Record<string, unknown>>;
  /** The notes moved out of `earlierToday`, in the form's own order. */
  readonly earlierNotes: readonly unknown[];
  /** The whole `history` sections moved out, in the form's own order. */
  readonly historySections: readonly unknown[];
}

/**
 * Trim a form to the caps, returning what was removed beside what stays.
 *
 * @param form the form as parsed JSON, whatever shape it is in
 * @param keepNotes how many of the newest `earlierToday` notes stay (defaults to `SECTION_MAX_NOTES`)
 * @param keepSections how many of the newest `history` sections stay (defaults to `HISTORY_MAX_SECTIONS`)
 * @param oldestFirst the form APPENDS, holding its oldest notes and sections first, so the overflow is cut from
 *   the start rather than the end
 * @returns the trimmed form and the overflow, in the form's own order; a form with nothing over the caps comes
 *   back unchanged with empty overflow
 */
export function archiveBriefingForm({
  form,
  keepNotes = SECTION_MAX_NOTES,
  keepSections = HISTORY_MAX_SECTIONS,
  oldestFirst = false,
}: {
  form: unknown;
  keepNotes?: number;
  keepSections?: number;
  oldestFirst?: boolean;
}): BriefingArchive {
  if (!isRecord(form)) {
    return { earlierNotes: [], form: {}, historySections: [] };
  }
  const trimmed: Record<string, unknown> = { ...form };
  let earlierNotes: readonly unknown[] = [];
  let historySections: readonly unknown[] = [];
  const earlier = form["earlierToday"];
  if (isRecord(earlier) && Array.isArray(earlier["notes"]) && earlier["notes"].length > keepNotes) {
    const split = splitKept({ items: earlier["notes"], keep: keepNotes, oldestFirst });
    earlierNotes = split.moved;
    trimmed["earlierToday"] = { ...earlier, notes: split.kept };
  }
  const history = form["history"];
  if (Array.isArray(history) && history.length > keepSections) {
    const split = splitKept({ items: history, keep: keepSections, oldestFirst });
    historySections = split.moved;
    trimmed["history"] = split.kept;
  }
  return { earlierNotes, form: trimmed, historySections };
}

/**
 * One over-long array split into the `keep` newest entries and the rest, whichever end the newest are at.
 *
 * @param items the array, longer than `keep`
 * @param keep how many of the newest entries stay
 * @param oldestFirst the newest entries are at the END of the array
 * @returns what stays and what moves, each in the array's own order
 */
function splitKept({ items, keep, oldestFirst }: { items: readonly unknown[]; keep: number; oldestFirst: boolean }): {
  kept: readonly unknown[];
  moved: readonly unknown[];
} {
  if (!oldestFirst) {
    return { kept: items.slice(0, keep), moved: items.slice(keep) };
  }
  const cut = items.length - keep;
  return { kept: items.slice(cut), moved: items.slice(0, cut) };
}

/**
 * A form's `earlierToday` notes, in the form's own order — empty when it has no such section.
 *
 * @returns the notes
 */
export function earlierNotesOf({ form }: { form: unknown }): readonly unknown[] {
  if (!isRecord(form)) {
    return [];
  }
  const earlier = form["earlierToday"];
  if (!isRecord(earlier) || !Array.isArray(earlier["notes"])) {
    return [];
  }
  return earlier["notes"];
}

/**
 * How many of a newest-first section's notes to keep so a page `overBytes` over its cap fits: the oldest
 * notes come off the end until their own JSON weighs at least the overshoot, at least one of them, and never
 * past `floor`.
 *
 * JSON bytes are a GUESS at what a note costs the rendered page, never the measurement — the caller re-renders
 * whatever this proposes and asks again while the page is still over. What the guess buys is one render per
 * step instead of one per note, which matters because each render re-reads from GitHub every pull request the
 * page's cards rest on.
 *
 * @param notes the notes the too-large page carried, newest first
 * @param overBytes how far over its cap that page was, in bytes
 * @param floor the fewest notes the section may keep
 * @returns the next count to try, below `notes.length` and never below `floor`; `notes.length` itself when it is
 *   already at the floor, which means there is nothing left to move
 */
export function keepForOvershoot({
  notes,
  overBytes,
  floor,
}: {
  notes: readonly unknown[];
  overBytes: number;
  floor: number;
}): number {
  let next = notes.length;
  let freed = 0;
  while (next > floor && (next === notes.length || freed < overBytes)) {
    next -= 1;
    freed += Buffer.byteLength(JSON.stringify(notes[next]), "utf8");
  }
  return next;
}

/**
 * Two passes over one newest-first form joined into the one archive they amount to: `later` ran on what
 * `earlier` left, after newer notes were added at the front, so what `later` moved is NEWER than what `earlier`
 * moved and leads the joined lists.
 *
 * @param earlier the first pass, whose overflow is the oldest
 * @param later the second pass, whose form is the one that stays
 * @returns every moved note and section exactly once, newest first, beside `later`'s form
 */
export function joinArchives({
  earlier,
  later,
}: {
  earlier: BriefingArchive;
  later: BriefingArchive;
}): BriefingArchive {
  return {
    earlierNotes: [...later.earlierNotes, ...earlier.earlierNotes],
    form: later.form,
    historySections: [...later.historySections, ...earlier.historySections],
  };
}

/**
 * The archive file's content: what left the form, with when and from where, so nothing archived is ever
 * an orphan.
 *
 * @param archive the pass's result
 * @param archivedAtIso when the pass ran
 * @param formPath the form the notes came from
 * @returns the JSON object to write
 */
export function archiveDocument({
  archive,
  archivedAtIso,
  formPath,
}: {
  archive: BriefingArchive;
  archivedAtIso: string;
  formPath: string;
}): Readonly<Record<string, unknown>> {
  return {
    archivedAtIso,
    earlierNotes: archive.earlierNotes,
    formPath,
    historySections: archive.historySections,
  };
}
