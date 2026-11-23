/**
 * The word a heredoc operator is terminated by, after the shell's own quote removal — the delimiter half of
 * `./shellSpans.ts`.
 *
 * A misread delimiter is the costliest lexing error the raw-Bash gate can make: the body is read to a line that
 * never comes, so every command after it vanishes into the "heredoc" and a three-command script passes as one.
 * So `$'…'` is decoded the way bash decodes it (MEASURED, /bin/bash 3.2 on darwin: `cat <<$'E\x4fF'` closes on
 * a line reading `EOF`), and `$"…"` is plain double quoting.
 *
 * Pure: text in, the delimiter out.
 */

/** Characters that end an unquoted heredoc delimiter word. */
const DELIMITER_END = new Set([" ", "\t", "\n", ";", "&", "|", "<", ">", "(", ")"]);

/** The single-character escapes of `$'…'`. */
const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "'": "'",
  "?": "?",
  "\\": "\\",
  E: "\u001b",
  a: "\u0007",
  b: "\b",
  e: "\u001b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

/**
 * The numeric escapes of `$'…'`: a leading letter (or none, for octal), its digit class, its widest run and the
 * modulus its value wraps at.
 */
const NUMERIC_ESCAPES: readonly {
  readonly lead: string;
  readonly digits: RegExp;
  readonly width: number;
  readonly radix: number;
  readonly modulus: number;
}[] = [
  { digits: /[0-7]/, lead: "", modulus: 0x100, radix: 8, width: 3 },
  { digits: /[0-9A-Fa-f]/, lead: "x", modulus: 0x100, radix: 16, width: 2 },
  { digits: /[0-9A-Fa-f]/, lead: "u", modulus: 0x10000, radix: 16, width: 4 },
  { digits: /[0-9A-Fa-f]/, lead: "U", modulus: Infinity, radix: 16, width: 8 },
];

/**
 * Decode one `$'…'` body from `at` (just past the opening quote) to its unescaped closing quote.
 *
 * @param command the whole command text
 * @param at the index just past `$'`
 * @returns the decoded text and the index just past the closing quote (the end of input when it never closes)
 */
export function ansiCQuoted({ command, at: from }: { command: string; at: number }): {
  readonly text: string;
  readonly end: number;
} {
  let at = from;
  let text = "";
  while (at < command.length && command[at] !== "'") {
    if (command[at] !== "\\" || at + 1 >= command.length) {
      text += command[at]!;
      at += 1;
      continue;
    }
    const escaped = escapeAt({ at: at + 1, command });
    text += escaped.text;
    at = escaped.end;
  }
  // A shell word cannot hold a NUL, so bash cuts the string there: `$'\0'` (or `\x00`, `\c@`) names the EMPTY word.
  const nul = text.indexOf("\u0000");
  return { end: Math.min(at + 1, command.length), text: nul === -1 ? text : text.slice(0, nul) };
}

/** The characters a backslash escapes inside double quotes; before any other, the backslash stays. */
export const DOUBLE_QUOTE_ESCAPES: ReadonlySet<string> = new Set(["$", "`", '"', "\\", "\n"]);

/**
 * Read one `"…"` body from `at` (just past the opening quote) to its unescaped closing quote, so `"E\"OF"`
 * names `E"OF` rather than closing at the escaped quote.
 *
 * @param command the whole command text
 * @param at the index just past `"`
 * @returns the text after quote removal and the index just past the closing quote (the end of input when it never closes)
 */
export function doubleQuoted({ command, at: from }: { command: string; at: number }): {
  readonly text: string;
  readonly end: number;
} {
  let at = from;
  let text = "";
  while (at < command.length && command[at] !== '"') {
    const next = command[at + 1];
    if (command[at] === "\\" && next !== undefined && DOUBLE_QUOTE_ESCAPES.has(next)) {
      text += next === "\n" ? "" : next;
      at += 2;
    } else {
      text += command[at]!;
      at += 1;
    }
  }
  return { end: Math.min(at + 1, command.length), text };
}

/** Decode the escape whose letter sits at `at` (just past its backslash). @returns its text and where it ends */
function escapeAt({ command, at }: { command: string; at: number }): { readonly text: string; readonly end: number } {
  const letter = command[at]!;
  const simple = SIMPLE_ESCAPES[letter];
  if (simple !== undefined) return { end: at + 1, text: simple };
  if (letter === "c" && at + 1 < command.length) {
    return { end: at + 2, text: String.fromCharCode(command.charCodeAt(at + 1) & 0x1f) };
  }
  const numeric = numericEscape({ at, command });
  if (numeric !== undefined) return numeric;
  return { end: at + 1, text: `\\${letter}` };
}

/** Decode an octal, hex or Unicode escape whose letter sits at `at`. @returns its text and end, or `undefined` */
function numericEscape({
  command,
  at,
}: {
  command: string;
  at: number;
}): { readonly text: string; readonly end: number } | undefined {
  const letter = command[at]!;
  for (const numeric of NUMERIC_ESCAPES) {
    if (numeric.lead !== "" && letter !== numeric.lead) continue;
    const start = numeric.lead === "" ? at : at + 1;
    const end = digitsEnd({ command, numeric, start });
    if (end === start) continue;
    // An octal escape is one BYTE, so bash wraps a three-digit value past 0377: `$'\400'` is NUL, not U+0100.
    const value = Number.parseInt(command.slice(start, end), numeric.radix) % numeric.modulus;
    // A value past the last code point has no character; kept literal rather than thrown on.
    if (value > 0x10ffff) return { end, text: command.slice(at - 1, end) };
    return { end, text: String.fromCodePoint(value) };
  }
  return undefined;
}

/** Where a numeric escape's digits end: at its width, the first non-digit, or the end of the command. */
function digitsEnd({
  command,
  numeric,
  start,
}: {
  command: string;
  numeric: (typeof NUMERIC_ESCAPES)[number];
  start: number;
}): number {
  let end = start;
  while (end < command.length && end - start < numeric.width && numeric.digits.test(command[end]!)) end += 1;
  return end;
}

/**
 * Read a delimiter word from `at`, removing quotes and backslashes the way the shell does: `'EOF'`, `"EOF"`,
 * `\EOF`, `E'O'F`, `$'EOF'` (escapes decoded) and `$"EOF"` all name `EOF`.
 *
 * @param command the whole command text
 * @param at the index of the delimiter word's first character, past the operator and any blanks
 * @returns the delimiter, whether any part of it was quoted (so the body is not expanded), whether any part was
 *   `$'…'` or `$"…"` (escapes each bash version decodes its own way; a string the locale may translate), and
 *   where it ended
 */
export function delimiterWord({ command, at: from }: { command: string; at: number }): {
  readonly delimiter: string;
  readonly quoted: boolean;
  readonly dollarQuoted: boolean;
  readonly end: number;
} {
  let at = from;
  let delimiter = "";
  let quoted = false;
  let dollarQuoted = false;
  while (at < command.length && !DELIMITER_END.has(command[at]!)) {
    const part = delimiterPart({ at, command });
    delimiter += part.text;
    if (part.quoted) quoted = true;
    if (part.dollarQuoted) dollarQuoted = true;
    at = part.end;
  }
  return { dollarQuoted, delimiter, end: Math.min(at, command.length), quoted };
}

/** One piece of a delimiter word: its text once quoting is removed, how it was quoted, and where it ends. */
interface DelimiterPart {
  readonly text: string;
  readonly quoted: boolean;
  readonly dollarQuoted: boolean;
  readonly end: number;
}

/** Read the delimiter-word piece starting at `at`: a quoted run, an escape, or one plain character. */
function delimiterPart({ command, at }: { command: string; at: number }): DelimiterPart {
  const ch = command[at]!;
  const next = command[at + 1];
  if (ch === "\\") return backslashPart({ at, command });
  if (ch === "$" && next === "'") {
    const decoded = ansiCQuoted({ at: at + 2, command });
    return { dollarQuoted: true, end: decoded.end, quoted: true, text: decoded.text };
  }
  const doubleStart = ch === "$" ? at + 2 : at + 1;
  if (ch === '"' || (ch === "$" && next === '"')) {
    const read = doubleQuoted({ at: doubleStart, command });
    return { dollarQuoted: ch === "$", end: read.end, quoted: true, text: read.text };
  }
  if (ch === "'") {
    const close = command.indexOf("'", at + 1);
    const stop = close === -1 ? command.length : close;
    return { dollarQuoted: false, end: stop + 1, quoted: true, text: command.slice(at + 1, stop) };
  }
  return { dollarQuoted: false, end: at + 1, quoted: false, text: ch };
}

/** Read the backslash at `at` in a delimiter word: a continuation, an escaped character, or a trailing `\`. */
function backslashPart({ command, at }: { command: string; at: number }): DelimiterPart {
  const next = command[at + 1];
  // A line continuation is removed before the word is read, so `EO\<newline>F` is the unquoted `EOF`.
  if (next === "\n") return { dollarQuoted: false, end: at + 2, quoted: false, text: "" };
  if (next === undefined) return { dollarQuoted: false, end: at + 1, quoted: false, text: "\\" };
  return { dollarQuoted: false, end: at + 2, quoted: true, text: next };
}

/**
 * Read one LOGICAL line of a heredoc body from `at`. In an unquoted body bash removes a backslash-newline before
 * it compares a line with the delimiter (MEASURED, /bin/bash 3.2: `tr\⏎ue` closes `<<true`, while `a\\` does not
 * fold), so a line ending in an odd run of backslashes is joined to the next. A quoted body folds nothing.
 * Repro: `printf 'cat <<true\ntr\\\nue\necho hidden\ntrue\n' | /bin/bash` prints `hidden`.
 *
 * @param command the whole command text
 * @param at the index the line starts at
 * @param fold whether the body is unquoted, so a backslash-newline joins two physical lines
 * @returns the logical line and the index just past its newline (the end of input when there is none)
 */
export function heredocLine({ command, at: from, fold }: { command: string; at: number; fold: boolean }): {
  readonly line: string;
  readonly end: number;
} {
  let at = from;
  let line = "";
  for (;;) {
    const newline = command.indexOf("\n", at);
    const physical = command.slice(at, newline === -1 ? command.length : newline);
    at = newline === -1 ? command.length : newline + 1;
    const trailing = /\\*$/.exec(physical)![0].length;
    if (!fold || newline === -1 || trailing % 2 === 0) return { end: at, line: line + physical };
    line += physical.slice(0, -1);
  }
}
