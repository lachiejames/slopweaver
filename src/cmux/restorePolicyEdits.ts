/**
 * The three edits `./restorePolicy.ts` can plan on cmux's `cmux.json` — the literal flipped, the key inserted into
 * an existing `terminal` object, or a `terminal` object inserted at the root — each a splice at scanned offsets that
 * copies the file's own indent and line ending, and each naming the one token change its self-check holds it to.
 *
 * Pure: a located policy in, a candidate edit out. The self-check itself stays in `./restorePolicy.ts`, beside the
 * reading it re-runs.
 */
import type { JsoncMember, JsoncObject, JsoncToken } from "./restorePolicyJsonc.js";

/** The top-level key whose object holds the policy. */
export const TERMINAL_KEY = "terminal";

/** The policy key itself. */
export const RESUME_KEY = "autoResumeAgentSessions";

/** What one level of nesting adds when the file gives no member line to copy an indent from. */
const DEFAULT_INDENT_UNIT = "  ";

/** Where the policy sits in one parsed file. */
export interface PolicyLocation {
  readonly root: JsoncObject;
  readonly terminal: JsoncObject | undefined;
  /** The policy member and the index of its boolean literal, when the key is present. */
  readonly resume: { readonly member: JsoncMember; readonly valueIndex: number } | undefined;
}

/** A file that scanned and parsed, and where its policy sits. */
export interface Analysed {
  readonly tokens: readonly JsoncToken[];
  readonly location: PolicyLocation;
}

/** The token-stream change an edit is allowed to make, so the self-check can hold it to exactly that. */
export type IntendedChange =
  | { readonly kind: "swap"; readonly index: number; readonly raw: string }
  | { readonly kind: "insert"; readonly index: number; readonly run: readonly Pick<JsoncToken, "kind" | "raw">[] };

/** An edit before its self-check: the new text and the one token change it claims to make. */
export interface CandidateEdit {
  readonly configText: string;
  readonly how: "flipped" | "inserted-key" | "inserted-terminal";
  readonly change: IntendedChange;
}

/**
 * The comment written above the key, so the next reader of the owner's config knows who set it, why, and how to undo it.
 *
 * @param nowIso the instant of the edit; only its UTC date is written
 * @returns the comment line, without indent or line ending
 */
export function restorePolicyComment({ nowIso }: { nowIso: string }): string {
  return (
    `// ${nowIso.slice(0, 10)}: slopweaver fleet restore-policy --apply. cmux's own restore relaunches Claude seats ` +
    "bare (no setup token); slopweaver fleet resume brings them back, supervisor first. Revert: delete this key."
  );
}

/** The offset the line holding `offset` starts at. */
function lineStartOf({ text, offset }: { text: string; offset: number }): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

/** The leading spaces and tabs of the line starting at `lineStart`. */
function indentAt({ text, lineStart }: { text: string; lineStart: number }): string {
  let end = lineStart;
  while (text.charAt(end) === " " || text.charAt(end) === "\t") {
    end += 1;
  }
  return text.slice(lineStart, end);
}

/**
 * The indent of the first non-blank line after the line holding an object's `{`, or `undefined` when there is no
 * such line before its `}` — the object closes on the line it opens on, or the next non-blank line IS its `}`.
 */
function nextLineIndent({
  text,
  tokens,
  object,
}: {
  text: string;
  tokens: readonly JsoncToken[];
  object: JsoncObject;
}): string | undefined {
  const open = tokens[object.open]!;
  const close = tokens[object.close]!;
  let eol = text.indexOf("\n", open.end);
  while (eol !== -1 && eol < close.start) {
    const lineStart = eol + 1;
    const indent = indentAt({ lineStart, text });
    const first = lineStart + indent.length;
    const rest = text.charAt(first);
    if (rest !== "\n" && rest !== "\r" && first < text.length) {
      return first >= close.start ? undefined : indent;
    }
    eol = text.indexOf("\n", lineStart);
  }
  return undefined;
}

/** One indent level as the file spells it: the root's own member indent, or two spaces when it gives none. */
function indentUnit({ text, analysed }: { text: string; analysed: Analysed }): string {
  const rootIndent = nextLineIndent({ object: analysed.location.root, text, tokens: analysed.tokens });
  if (rootIndent === undefined || rootIndent.length === 0) {
    return DEFAULT_INDENT_UNIT;
  }
  return rootIndent;
}

/** The indent a new first member of `object` takes: copied from its next line, else one level past its `{` line. */
function memberIndent({ text, analysed, object }: { text: string; analysed: Analysed; object: JsoncObject }): {
  readonly member: string;
  readonly outer: string;
} {
  const open = analysed.tokens[object.open]!;
  const outer = indentAt({ lineStart: lineStartOf({ offset: open.start, text }), text });
  const copied = nextLineIndent({ object, text, tokens: analysed.tokens });
  if (copied !== undefined) {
    return { member: copied, outer };
  }
  return { member: `${outer}${indentUnit({ analysed, text })}`, outer };
}

/** Whether an object's `}` sits on the same line as its `{`. */
function closesOnOpenLine({
  text,
  tokens,
  object,
}: {
  text: string;
  tokens: readonly JsoncToken[];
  object: JsoncObject;
}): boolean {
  const open = tokens[object.open]!;
  const close = tokens[object.close]!;
  return !text.slice(open.end, close.start).includes("\n");
}

/** The tokens an inserted `"autoResumeAgentSessions": false` member adds, with its comma when one follows. */
function keyRun({ comma }: { comma: boolean }): readonly Pick<JsoncToken, "kind" | "raw">[] {
  const run: Pick<JsoncToken, "kind" | "raw">[] = [
    { kind: "string", raw: `"${RESUME_KEY}"` },
    { kind: "punct", raw: ":" },
    { kind: "word", raw: "false" },
  ];
  if (comma) {
    run.push({ kind: "punct", raw: "," });
  }
  return run;
}

/**
 * Edit 1: the literal `true` swapped for `false`, with the comment on its own line above the key.
 *
 * @param text the whole config, which the splice keeps byte for byte outside its own run
 * @param resume the located policy member and its literal
 * @param comment the explanatory line, from {@link restorePolicyComment}
 * @param eol the file's own line ending
 * @returns the edited text and the one swap it claims
 */
export function flipEdit({
  text,
  analysed,
  resume,
  comment,
  eol,
}: {
  text: string;
  analysed: Analysed;
  resume: NonNullable<PolicyLocation["resume"]>;
  comment: string;
  eol: string;
}): CandidateEdit {
  const key = analysed.tokens[resume.member.keyIndex]!;
  const { valueIndex } = resume;
  const value = analysed.tokens[valueIndex]!;
  const lineStart = lineStartOf({ offset: key.start, text });
  const indent = indentAt({ lineStart, text });
  const configText =
    text.slice(0, lineStart) +
    `${indent}${comment}${eol}` +
    text.slice(lineStart, value.start) +
    "false" +
    text.slice(value.end);
  return { change: { index: valueIndex, kind: "swap", raw: "false" }, configText, how: "flipped" };
}

/**
 * Edit 2: the key inserted as the first member of the existing `terminal` object.
 *
 * @param text the whole config, which the splice keeps byte for byte outside its own run
 * @param terminal the existing `terminal` object the key goes into
 * @param comment the explanatory line, from {@link restorePolicyComment}
 * @param eol the file's own line ending
 * @returns the edited text and the one inserted run it claims
 */
export function insertKeyEdit({
  text,
  analysed,
  terminal,
  comment,
  eol,
}: {
  text: string;
  analysed: Analysed;
  terminal: JsoncObject;
  comment: string;
  eol: string;
}): CandidateEdit {
  const open = analysed.tokens[terminal.open]!;
  const comma = terminal.members.length > 0;
  const { member, outer } = memberIndent({ analysed, object: terminal, text });
  const closeAfter = !comma && closesOnOpenLine({ object: terminal, text, tokens: analysed.tokens });
  const insertion =
    `${eol}${member}${comment}${eol}${member}"${RESUME_KEY}": false` +
    (comma ? "," : "") +
    (closeAfter ? `${eol}${outer}` : "");
  return {
    change: { index: terminal.open + 1, kind: "insert", run: keyRun({ comma }) },
    configText: text.slice(0, open.end) + insertion + text.slice(open.end),
    how: "inserted-key",
  };
}

/**
 * Edit 3: a `terminal` object holding only the key, inserted as the first root member.
 *
 * @param text the whole config, which the splice keeps byte for byte outside its own run
 * @param comment the explanatory line, from {@link restorePolicyComment}
 * @param eol the file's own line ending
 * @returns the edited text and the one inserted run it claims
 */
export function insertTerminalEdit({
  text,
  analysed,
  comment,
  eol,
}: {
  text: string;
  analysed: Analysed;
  comment: string;
  eol: string;
}): CandidateEdit {
  const root = analysed.location.root;
  const open = analysed.tokens[root.open]!;
  const comma = root.members.length > 0;
  const { member, outer } = memberIndent({ analysed, object: root, text });
  const inner = `${member}${indentUnit({ analysed, text })}`;
  const closeAfter = !comma && closesOnOpenLine({ object: root, text, tokens: analysed.tokens });
  const insertion =
    `${eol}${member}"${TERMINAL_KEY}": {` +
    `${eol}${inner}${comment}${eol}${inner}"${RESUME_KEY}": false` +
    `${eol}${member}}` +
    (comma ? "," : "") +
    (closeAfter ? `${eol}${outer}` : "");
  const run: Pick<JsoncToken, "kind" | "raw">[] = [
    { kind: "string", raw: `"${TERMINAL_KEY}"` },
    { kind: "punct", raw: ":" },
    { kind: "punct", raw: "{" },
    ...keyRun({ comma: false }),
    { kind: "punct", raw: "}" },
  ];
  if (comma) {
    run.push({ kind: "punct", raw: "," });
  }
  return {
    change: { index: root.open + 1, kind: "insert", run },
    configText: text.slice(0, open.end) + insertion + text.slice(open.end),
    how: "inserted-terminal",
  };
}
