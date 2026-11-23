/**
 * The primitives `ambient-heap-ceiling` is built on: what the flag and the variable ARE, and how a string of
 * SHELL is read for an assignment of one to the other.
 *
 * This is a separate module because it is a separate job. The gate next door decides WHICH files to offer
 * and what to print; everything here decides whether one string assigns a ceiling, and it is asked that
 * question about three unrelated kinds of input — a `.sh` file, a `package.json` script, and a workflow
 * step's `run:` body. Seven of the seventeen evasions found on this branch were in this layer rather than in
 * the filter, so it earns its own file and its own tests.
 */
/** The V8 flag that names a heap ceiling, in the spelling a refusal prints. */
export const HEAP_FLAG = "max-old-space-size";

/**
 * How the flag is RECOGNISED, which is not how it is printed. V8 accepts `--max_old_space_size` as well as
 * `--max-old-space-size`, and node applies the same ceiling either way (measured: both spellings reported a
 * 320 MiB heap limit in a child process). Matching the hyphenated literal alone let the underscore alias
 * through, found by the r1 review pass on this gate's own branch.
 */
const HEAP_FLAG_PATTERN = "max[-_]old[-_]space[-_]size";
const HEAP_FLAG_RE = new RegExp(HEAP_FLAG_PATTERN);

/** The variable that makes a ceiling AMBIENT — inherited by every Node process started under it. */
export const AMBIENT_VAR = "NODE_OPTIONS";

/** One place an ambient heap ceiling was found, named precisely enough to open the file at it. */
export interface CeilingSite {
  /** Repo-relative path of the file carrying it. */
  readonly file: string;
  /** Where inside that file — `jobs.lint.env`, `scripts.build`, `line 42`. */
  readonly where: string;
  /**
   * The assignment AS FOUND, whitespace-collapsed — what identifies one ceiling apart from another.
   *
   * It exists because the standing-debt entry has to name a SITE rather than a file. Carried as a file
   * alone, the exemption covered anything in `bin/slopweaver`: a second `export
   * NODE_OPTIONS=--max-old-space-size=128` inserted beside the real one was reported as "standing debt, 2
   * site(s)" and exited 0, while giving a real `node` child a 320 MiB limit against 4,288 MiB. A line
   * NUMBER would identify it too and drift on every unrelated edit to the launcher; the assignment's own
   * text does not, and it is what a reader of the finding line actually wants to see.
   */
  readonly text: string;
}

/**
 * One found assignment reduced to its identifying text — every run of whitespace one space, ends trimmed.
 *
 * A shell assignment can be split across continuations and indented arbitrarily without changing what it
 * sets, so the raw slice is not an identity. This is not a security boundary: it decides whether a site is
 * the DECLARED debt or a new one, and anything it normalises away could not have changed the ceiling.
 *
 * @param raw the assignment's source text, however many physical lines it spanned
 * @returns the same assignment on one line
 */
export function siteText({ raw }: { raw: string }): string {
  return raw.replaceAll(/\s+/gu, " ").trim();
}

/**
 * Whether a string names the heap flag in either of V8's two spellings.
 *
 * @param text any candidate — an `env:` value, or one word read off a shell line
 * @returns true when the flag appears anywhere in it
 */
export function namesHeapFlag({ text }: { text: string }): boolean {
  return HEAP_FLAG_RE.test(text);
}

/** The two quote characters a shell word can be wrapped in. Inside either, a `#` is data. */
const QUOTES = new Set(["'", '"']);

/** What ends an UNQUOTED shell word: whitespace, or the operators that separate one command from the next. */
const WORD_END = new Set([" ", "\t", ";", "&", "|", "<", ">", "(", ")"]);

/** The shell's escape character, which quotes exactly the one character after it. */
const BACKSLASH = "\\";

/** The only four characters a backslash escapes inside DOUBLE quotes; before anything else it stays literal. */
const DOUBLE_QUOTE_ESCAPES = new Set(["$", "`", '"', BACKSLASH]);

/**
 * What a backslash-escaped character contributes to the word, which depends on the quoting it sits in.
 *
 * Unquoted, a backslash always disappears and the character after it is literal — so
 * `--max-old-\space-size=128` IS the heap flag, and keeping the backslash hid it from the matcher. Inside
 * double quotes the backslash survives before anything but `$`, a backtick, `"` or another backslash, so
 * dropping it there unconditionally would invent a flag the shell never sets.
 */
function escapedChar({ ch, quote }: { ch: string; quote: string }): string {
  if (quote === '"' && !DOUBLE_QUOTE_ESCAPES.has(ch)) {
    return `${BACKSLASH}${ch}`;
  }
  return ch;
}

/** Where the word scanner is: what it has collected, what quoting it is inside, and whether the word ended. */
interface WordScan {
  /** True once an unquoted word terminator was reached, so the caller stops. */
  readonly done: boolean;
  /** True when the previous character was a backslash that has not been applied yet. */
  readonly escape: boolean;
  /** The quote character currently open, or "" outside quotes. */
  readonly quote: string;
  /** The word collected so far, already dequoted. */
  readonly value: string;
}

/** One character's effect on the scan — the shell's own quoting rules, one branch each. */
function scanChar({ ch, scan }: { ch: string; scan: WordScan }): WordScan {
  if (scan.escape) {
    return { ...scan, escape: false, value: scan.value + escapedChar({ ch, quote: scan.quote }) };
  }
  if (ch === BACKSLASH && scan.quote !== "'") {
    return { ...scan, escape: true };
  }
  if (scan.quote !== "") {
    return ch === scan.quote ? { ...scan, quote: "" } : { ...scan, value: scan.value + ch };
  }
  if (QUOTES.has(ch)) {
    return { ...scan, quote: ch };
  }
  if (WORD_END.has(ch)) {
    return { ...scan, done: true };
  }
  return { ...scan, value: scan.value + ch };
}
/** The state a word scan starts in. */
const FRESH_WORD: WordScan = { done: false, escape: false, quote: "", value: "" };

/**
 * One logical line's shell WORDS, each DEQUOTED — the shell's own word splitting, not a pattern that tries
 * to anticipate its spellings.
 *
 * Reading the line with a regex is what the first four drafts did, and a review pass split the same word
 * somewhere the pattern did not expect every single time: `"--enable-source-maps --max-old-space-size=128"`
 * (a space inside quotes), `--max-old-\` + newline (a continuation), `"--max-old-"space-size=128` (a quote
 * boundary inside the flag), `--max-old-\space-size=128` (a backslash inside it), and finally
 * `NODE_'OPTIONS'=…` — a quote boundary inside the variable NAME, which no pattern anchored on the literal
 * name can ever see. That last one is why the whole word is dequoted, name and value together, rather than
 * the name being matched and only the value read: quoting decides where a word ENDS and contributes nothing
 * to what it SAYS, so removing it first makes every one of those spellings the same string.
 *
 * @param text one logical line, comments and continuations already resolved by the caller
 * @returns each word in order, with quoting and escapes removed
 */
function shellWords({ text }: { text: string }): readonly string[] {
  const words: string[] = [];
  let scan = FRESH_WORD;
  for (const ch of text) {
    const next = scanChar({ ch, scan });
    if (!next.done) {
      scan = next;
      continue;
    }
    words.push(scan.value);
    scan = FRESH_WORD;
  }
  words.push(scan.value);
  return words.filter((word) => word !== "");
}

/**
 * How a dequoted word opens when it ASSIGNS the ambient variable. `+=` is bash's append, which sets the
 * variable just as effectively; a mention such as `${NODE_OPTIONS:-}` opens with neither and is not one.
 */
const ASSIGNMENT_OPENINGS = [`${AMBIENT_VAR}=`, `${AMBIENT_VAR}+=`] as const;

/** What one word assigns to the ambient variable, or "" when the word is not an assignment of it. */
function assignedValue({ word }: { word: string }): string {
  const opening = ASSIGNMENT_OPENINGS.find((prefix) => word.startsWith(prefix));
  if (opening === undefined) {
    return "";
  }
  return word.slice(opening.length);
}

/**
 * Whether one logical line of shell ASSIGNS the ambient variable a heap ceiling, as opposed to mentioning it.
 *
 * Every word is tested, not the first: `NODE_OPTIONS=--enable-source-maps; export
 * NODE_OPTIONS=--max-old-space-size=128; node …` is one line that assigns twice, and reading only the first
 * reported it clean while the second was the one that applied.
 *
 * @param text the line, comment tail already removed and continuations already joined by the caller
 * @returns true when some word assigns the variable a value naming the heap flag
 */
export function assignsCeiling({ text }: { text: string }): boolean {
  return shellWords({ text }).some((word) => namesHeapFlag({ text: assignedValue({ word }) }));
}
/**
 * Where the LINE scanner is: quoting, a pending escape, whether a comment is running, and the logical
 * line's text so far with comment tails already dropped and backslashes left verbatim for {@link shellWords}.
 */
interface ShellScan {
  /** Whether a `#` comment is running; the next newline ends it. */
  readonly comment: boolean;
  /** Whether a backslash is pending, so the next character — or newline — is escaped. */
  readonly escape: boolean;
  /** The quote character currently open, `""` when none. */
  readonly quote: string;
  /** The logical line collected so far. */
  readonly text: string;
}

/** The state a logical line starts in. */
const FRESH_SCAN: ShellScan = { comment: false, escape: false, quote: "", text: "" };

/** Whether a `#` here opens a comment, which the shell requires to sit at the start of a word. */
function opensComment({ text }: { text: string }): boolean {
  return text === "" || /\s$/.test(text);
}

/** One NON-newline character's effect on the line scan — the shell's own quoting rules, one branch each. */
function scanLineChar({ ch, scan }: { ch: string; scan: ShellScan }): ShellScan {
  if (scan.comment) {
    return scan;
  }
  if (scan.escape) {
    return { ...scan, escape: false, text: scan.text + BACKSLASH + ch };
  }
  if (ch === BACKSLASH && scan.quote !== "'") {
    return { ...scan, escape: true };
  }
  if (scan.quote !== "") {
    const closing = ch === scan.quote;
    return { ...scan, quote: closing ? "" : scan.quote, text: scan.text + ch };
  }
  if (QUOTES.has(ch)) {
    return { ...scan, quote: ch, text: scan.text + ch };
  }
  if (ch === "#" && opensComment({ text: scan.text })) {
    return { ...scan, comment: true };
  }
  return { ...scan, text: scan.text + ch };
}

/**
 * What a newline does, which is the whole of this module's correctness and is NOT "join if the line ends in
 * a backslash".
 *
 * A comment runs to the newline and a backslash inside it is comment TEXT, so `# build options \` followed
 * by a real `export NODE_OPTIONS=…` is two statements to the shell and the export runs — measured with
 * `/bin/sh`, the child reporting a 320 MiB heap limit, while a reader that joined first and stripped
 * comments afterwards pulled the export into the comment and saw nothing. That was the fourteenth evasion
 * found on this branch and it is why comment state is carried through the newline rather than applied to a
 * line that has already been joined.
 *
 * The other three cases are the shell's: an escaped newline is REMOVED, splicing the next line onto this one
 * with nothing between; a newline inside quotes is literal data and keeps the same logical line open; and
 * anything else ends the line.
 */
function endOfLine({ scan }: { scan: ShellScan }): { readonly emit: boolean; readonly next: ShellScan } {
  if (scan.comment) {
    return { emit: true, next: FRESH_SCAN };
  }
  if (scan.escape) {
    return { emit: false, next: { ...scan, escape: false } };
  }
  if (scan.quote !== "") {
    return { emit: false, next: { ...scan, text: `${scan.text}\n` } };
  }
  return { emit: true, next: FRESH_SCAN };
}

/**
 * One shell script's LOGICAL lines — what the shell reads as one statement — each numbered by the physical
 * line it started on, and each already free of its comment tail.
 *
 * @param content the script's text
 * @returns one entry per logical line, in document order
 */
function logicalLines({ content }: { content: string }): readonly { line: number; text: string }[] {
  const lines: { line: number; text: string }[] = [];
  let scan = FRESH_SCAN;
  let start = 1;
  let physical = 1;
  for (const ch of content) {
    if (ch !== "\n") {
      scan = scanLineChar({ ch, scan });
      continue;
    }
    physical += 1;
    const step = endOfLine({ scan });
    if (step.emit) {
      lines.push({ line: start, text: scan.text });
      start = physical;
    }
    scan = step.next;
  }
  if (scan.text !== "") {
    lines.push({ line: start, text: scan.text });
  }
  return lines;
}

/**
 * Every ambient heap ceiling assigned in one shell script.
 *
 * @param content the script's text
 * @param file the repo-relative path, carried onto each site
 * @returns one site per assigning logical line, numbered from 1 by where that line starts
 */
export function shellSites({ content, file }: { content: string; file: string }): readonly CeilingSite[] {
  return logicalLines({ content }).flatMap(({ line, text }): readonly CeilingSite[] => {
    if (!assignsCeiling({ text })) {
      return [];
    }
    return [{ file, text: siteText({ raw: text }), where: `line ${String(line)}` }];
  });
}
