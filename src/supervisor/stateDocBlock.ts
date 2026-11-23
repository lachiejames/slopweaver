/**
 * The boot block's locator, its finished-doc judge, the single-line field check and the refusal union that all
 * three state-doc edits share: `state-amend` and `state-archive` in `./stateDocEdit.ts`, and `state-fold` in
 * `./stateDocFold.ts`.
 *
 * A leaf: it imports neither edit module, type-only included, so the `StateDocEditError` declarations live here
 * rather than beside the edits that return them. Why the heading these helpers locate is not the one
 * `stateDoc.ts` parses is `./stateDocEdit.ts`'s header.
 *
 * Pure: no I/O and no clock.
 */
import { err, ok, type Result } from "#lib/result.js";

import { MAX_BOOT_BLOCK_LINES, MAX_STATE_DOC_LINES, parseStateDoc, stateDocOffences } from "./stateDoc.js";

/** The rulings subheading, spelled the way the live doc spells it. */
export const RULINGS_LINE_PREFIX = "### RULINGS";
/** The heading a PRIOR state-doc format carried, and `parseStateDoc` still reads. An edit must not reintroduce one. */
export const PRIOR_BOOT_HEADING = "## SUCCESSOR BOOT BLOCK";

/**
 * No line opens the named seat's boot block, or more than one does.
 *
 * @internal — one arm of {@link StateDocEditError}; callers read `code` and `message` off the union.
 */
export interface BlockNotFoundError {
  readonly code: "BLOCK_NOT_FOUND";
  readonly message: string;
  readonly handoff: string;
  readonly matches: number;
}

/**
 * The named block exists, but another top-level section follows it, so it is not the doc's tail.
 *
 * @internal — one arm of {@link StateDocEditError}.
 */
export interface BlockNotTailError {
  readonly code: "BLOCK_NOT_TAIL";
  readonly message: string;
  readonly heading: string;
}

/**
 * The block has no rulings subheading.
 *
 * @internal — one arm of {@link StateDocEditError}.
 */
export interface RulingsNotFoundError {
  readonly code: "RULINGS_NOT_FOUND";
  readonly message: string;
}

/**
 * What the caller supplied, or what the edit would produce, is malformed.
 *
 * @internal — one arm of {@link StateDocEditError}.
 */
export interface InputRejectedError {
  readonly code: "INPUT_REJECTED";
  readonly message: string;
}

/**
 * The edit would leave the doc or its current block over a cap. Refused, never truncated.
 *
 * @internal — one arm of {@link StateDocEditError}.
 */
export interface CapExceededError {
  readonly code: "CAP_EXCEEDED";
  readonly message: string;
  readonly lines: number;
  readonly cap: number;
}

/**
 * The predecessor's own archive note, which the new note is placed after, is absent from a chain another seat's
 * note already started, or appears more than once. A doc carrying no seat's note at all is seeded, not refused.
 *
 * @internal — one arm of {@link StateDocEditError}.
 */
export interface ArchiveNoteNotFoundError {
  readonly code: "ARCHIVE_NOTE_NOT_FOUND";
  readonly message: string;
  readonly matches: number;
}

/** Every way a state-doc edit is refused. */
export type StateDocEditError =
  | ArchiveNoteNotFoundError
  | BlockNotFoundError
  | BlockNotTailError
  | CapExceededError
  | InputRejectedError
  | RulingsNotFoundError;

/**
 * The factories every refusal above is built through.
 *
 * @internal — built here and by `./stateDocEdit.ts` and `./stateDocFold.ts`; tests observe them through the edits.
 */
export const StateDocEditErrors = {
  archiveNoteNotFound: ({ anchor, matches }: { anchor: string; matches: number }): ArchiveNoteNotFoundError => ({
    code: "ARCHIVE_NOTE_NOT_FOUND",
    matches,
    message: `the preamble carries ${String(matches)} copies of "${anchor}", not exactly one — the new archive note goes straight after the predecessor's own, so that note has to be unambiguous`,
  }),
  blockNotFound: ({ handoff, matches }: { handoff: string; matches: number }): BlockNotFoundError => ({
    code: "BLOCK_NOT_FOUND",
    handoff,
    matches,
    message: `the doc has ${String(matches)} line(s) opening "${bootHeadingPrefix({ handoff })}", not exactly one`,
  }),
  blockNotTail: ({ heading }: { heading: string }): BlockNotTailError => ({
    code: "BLOCK_NOT_TAIL",
    heading,
    message: `"${heading.slice(0, 80)}" is not the doc's last top-level section, so an edit there would land mid-doc`,
  }),
  capExceeded: ({ what, lines, cap }: { what: string; lines: number; cap: number }): CapExceededError => ({
    cap,
    code: "CAP_EXCEEDED",
    lines,
    message: `${what} would be ${String(lines)} lines, over the ${String(cap)}-line cap — nothing was written; fold the live block's older rows out with \`slopweaver supervisor state-fold\`, or cut a block being installed (skills/supervisor/reference/state-doc.md)`,
  }),
  inputRejected: ({ reason }: { reason: string }): InputRejectedError => ({
    code: "INPUT_REJECTED",
    message: reason,
  }),
  rulingsNotFound: ({ heading }: { heading: string }): RulingsNotFoundError => ({
    code: "RULINGS_NOT_FOUND",
    message: `"${heading.slice(0, 80)}" has no "${RULINGS_LINE_PREFIX}" line`,
  }),
} as const;

/**
 * The heading prefix that opens one seat's boot block.
 *
 * @param handoff the seat's handoff number, as typed (`249`)
 * @returns the prefix, e.g. `## handoff-9249 boot`
 */
export function bootHeadingPrefix({ handoff }: { handoff: string }): string {
  return `## handoff-${handoff} boot`;
}

/**
 * Whether a line opens the block a prefix names: the prefix, then end of line or a character that cannot
 * continue the word — so `## handoff-9024 boot` never matches `## handoff-90249 boot` and `bootstrap` never matches.
 *
 * @param line the doc line
 * @param prefix the heading prefix from {@link bootHeadingPrefix}
 * @returns true when the line opens that block
 */
export function opensBlock({ line, prefix }: { line: string; prefix: string }): boolean {
  if (!line.startsWith(prefix)) {
    return false;
  }
  return !/^[\w-]/.test(line.slice(prefix.length));
}

/**
 * Count newline characters — `wc -l` over a newline-terminated text, which is every text this module returns.
 *
 * @returns the line count
 */
export function wcLines({ text }: { text: string }): number {
  return text.split("\n").length - 1;
}

/**
 * Drop trailing empty entries from a line array, in place.
 *
 * @param lines the array to trim
 */
export function popTrailingBlank({ lines }: { lines: string[] }): void {
  while (lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
  }
}

/**
 * Find the one line opening a seat's boot block, and require the block to be the doc's tail.
 *
 * @internal — shared with `./stateDocFold.ts`, the third edit, which addresses the same block.
 * @param lines the doc's lines
 * @param handoff the seat's handoff number
 * @returns the 0-based index of the heading line
 */
export function locateTailBlock({
  lines,
  handoff,
}: {
  lines: readonly string[];
  handoff: string;
}): Result<number, StateDocEditError> {
  const prefix = bootHeadingPrefix({ handoff });
  const matches = lines.flatMap((line, index) => (opensBlock({ line, prefix }) ? [index] : []));
  const start = matches[0];
  if (start === undefined || matches.length > 1) {
    return err(StateDocEditErrors.blockNotFound({ handoff, matches: matches.length }));
  }
  if (lines.slice(start + 1).some((line) => line.startsWith("## "))) {
    return err(StateDocEditErrors.blockNotTail({ heading: lines[start]! }));
  }
  return ok(start);
}

/**
 * Judge a finished doc against both caps and the no-double-blank rule, the block measured from its heading
 * line to the end of the file with blank lines included — `state-check`'s own semantics.
 *
 * @internal — shared with `./stateDocFold.ts`, so a fold is judged exactly as an amend is.
 * @param text the doc as it would be written, ending in exactly one newline
 * @param blockStart the 0-based line the current block's heading sits on
 * @returns both measurements, or the refusal
 */
export function judgeFinished({
  text,
  blockStart,
}: {
  text: string;
  blockStart: number;
}): Result<{ readonly docLines: number; readonly blockLines: number }, StateDocEditError> {
  if (text.includes("\n\n\n")) {
    return err(StateDocEditErrors.inputRejected({ reason: "the edit would leave two consecutive blank lines" }));
  }
  const docLines = wcLines({ text });
  if (docLines > MAX_STATE_DOC_LINES) {
    return err(StateDocEditErrors.capExceeded({ cap: MAX_STATE_DOC_LINES, lines: docLines, what: "the state doc" }));
  }
  const blockLines = docLines - blockStart;
  if (blockLines > MAX_BOOT_BLOCK_LINES) {
    return err(
      StateDocEditErrors.capExceeded({ cap: MAX_BOOT_BLOCK_LINES, lines: blockLines, what: "the current boot block" }),
    );
  }
  // The same text judged the way `state-check` judges it, which sizes blocks between LEGACY headings: a doc
  // still carrying one of those has a block this module cannot see, and an edit that left it over the cap
  // would be refused by the very gate this module exists to stay inside.
  const checker = stateDocOffences({ docPath: "the finished doc", shape: parseStateDoc({ text }) }).find(
    (offence) => offence.code === "boot-block-too-long",
  );
  if (checker !== undefined) {
    return err(
      StateDocEditErrors.capExceeded({
        cap: checker.cap,
        lines: checker.lines,
        what: `a "${PRIOR_BOOT_HEADING}" block still in the doc`,
      }),
    );
  }
  return ok({ blockLines, docLines });
}

/**
 * Refuse a free-text field that is empty or spans lines — it is interpolated into a heading-adjacent sentence.
 *
 * @internal — shared with `./stateDocFold.ts`, whose note row interpolates the same kinds of field.
 * @param value the field
 * @param flag the flag it came from, for the refusal
 * @returns nothing on success, or the refusal
 */
export function singleLine({ value, flag }: { value: string; flag: string }): Result<void, StateDocEditError> {
  if (/[\r\n]/.test(value) || value.trim().length === 0) {
    return err(StateDocEditErrors.inputRejected({ reason: `${flag} must be one non-empty line` }));
  }
  // Every one of these is interpolated into the note sentence, two of them inside backticks: a line break
  // would split the restore paragraph into a new block, a backtick would end the inline-code path early, and
  // a NUL would reach the file. Refused as given rather than rewritten — a destination is never silently renamed.
  if (/[`\0]/.test(value)) {
    return err(StateDocEditErrors.inputRejected({ reason: `${flag} must not carry a backtick or a NUL` }));
  }
  return ok(undefined);
}
