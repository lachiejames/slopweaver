/**
 * Shell LEXING shared by {@link ./shellSegments.commandSegments} and `./pythonInvocation.ts`: words that
 * remember whether they were quoted or expanded, the command lines an unquoted heredoc body expands, which
 * heredoc a command's stdin finally reads, and redirection removal. Balanced groups and substitutions are
 * `./shellBrackets.ts`.
 *
 * Pure, no I/O. A narrow static lexer rather than a shell: it expands no parameter, glob or alias, and a
 * `case` pattern's bare `)` inside a substitution closes that substitution early. Every consumer states what
 * that leaves it unable to see.
 */
import { ansiCQuoted, DOUBLE_QUOTE_ESCAPES } from "./heredocDelimiter.js";
import { type OpenQuote, substitutionAt } from "./shellBrackets.js";

/** One shell word, quotes removed, with the facts a consumer must not guess from its text. */
export interface ShellWord {
  /** The word with quoting removed; a substitution's raw text stays inside it. */
  readonly text: string;
  /** Any quote or backslash was used, so the word is not wholly literal. */
  readonly quoted: boolean;
  /** An expansion (`$x`, `$(…)`, backticks) sits in it, so its text is not the value a shell would run. */
  readonly dynamic: boolean;
  /**
   * The leading run of characters written OUTSIDE any quote or escape — what an operator has to be spelled
   * in. `<<'EOF'` opens with the unquoted `<<` and is a redirection; `'>'` opens with nothing and is data.
   */
  readonly unquotedPrefix: string;
  /**
   * The text with every character written inside a quote, after a backslash or within a substitution masked to
   * `_`, index for index — so an operator spelled unquoted ANYWHERE in the word shows, as in `"a">out`.
   */
  readonly shape: string;
}

/** The mutable state one tokenizer pass threads through its step functions. */
interface WordScan {
  readonly text: string;
  readonly words: ShellWord[];
  readonly substitutions: string[];
  word: string;
  shape: string;
  inWord: boolean;
  quoted: boolean;
  dynamic: boolean;
  quote: OpenQuote;
  /** The word's leading unquoted run so far, and whether it is still being extended. */
  prefix: string;
  prefixOpen: boolean;
  /** Where each bare `&` sits in `text`, and where the last character read as plain, unquoted text sits. */
  readonly ampersands: number[];
  plainAt: number;
  /** An unquoted line continuation sat inside a word. */
  splitsWord: boolean;
}

/** Close the word in progress, if there is one. */
function endWord({ scan }: { scan: WordScan }): void {
  if (scan.inWord) {
    scan.words.push({
      dynamic: scan.dynamic,
      quoted: scan.quoted,
      shape: scan.shape,
      text: scan.word,
      unquotedPrefix: scan.prefix,
    });
  }
  scan.word = "";
  scan.shape = "";
  scan.inWord = false;
  scan.quoted = false;
  scan.dynamic = false;
  scan.prefix = "";
  scan.prefixOpen = true;
}

/** One step inside a quoted run. @returns the characters consumed */
function stepQuoted({ scan, index }: { scan: WordScan; index: number }): number {
  const ch = scan.text[index]!;
  if (ch === scan.quote) {
    scan.quote = undefined;
    return 1;
  }
  const next = scan.text[index + 1];
  // Inside double quotes a backslash escapes only `$`, a backtick, `"`, `\` and a newline (which it removes).
  if (scan.quote === '"' && ch === "\\" && next !== undefined && DOUBLE_QUOTE_ESCAPES.has(next)) {
    if (next === "\n") return 2;
    scan.word += next;
    scan.shape += "_";
    return 2;
  }
  if (scan.quote === '"' && ch === "$") scan.dynamic = true;
  scan.word += ch;
  scan.shape += "_";
  return 1;
}

/**
 * A quote, `$'…'`, `$"…"` or backslash escape opening at `index` outside any quote.
 * @returns the characters consumed, or 0 when none opens here
 */
function stepQuoteOpen({ scan, index }: { scan: WordScan; index: number }): number {
  const ch = scan.text[index]!;
  const next = scan.text[index + 1];
  if (ch === "'" || ch === '"') {
    scan.quote = ch;
    scan.quoted = true;
    scan.prefixOpen = false;
    return 1;
  }
  // `$'-c'` is the word `-c` to bash, so its escapes are decoded here rather than left as `$` and a quote.
  if (ch === "$" && next === "'") {
    const decoded = ansiCQuoted({ at: index + 2, command: scan.text });
    scan.word += decoded.text;
    scan.shape += "_".repeat(decoded.text.length);
    scan.quoted = true;
    scan.prefixOpen = false;
    return decoded.end - index;
  }
  // `$"…"` is double quoting (a message catalog aside).
  if (ch === "$" && next === '"') {
    scan.quote = '"';
    scan.quoted = true;
    scan.prefixOpen = false;
    return 2;
  }
  if (ch === "\\" && next !== undefined) {
    scan.word += next;
    scan.shape += "_";
    scan.quoted = true;
    scan.prefixOpen = false;
    return 2;
  }
  return 0;
}

/** One step outside any quote. @returns the characters consumed, or 0 when a comment ends the words */
function stepUnquoted({ scan, index }: { scan: WordScan; index: number }): number {
  const ch = scan.text[index]!;
  if (ch === "#" && !scan.inWord) return 0;
  // A line continuation is removed before words are read, so `sl\⏎eep` is the unquoted word `sleep`. One inside a
  // word is recorded, because it can join characters a caller reads as a token of their own (`$\⏎[`).
  if (ch === "\\" && scan.text[index + 1] === "\n") {
    scan.splitsWord = scan.splitsWord || scan.inWord;
    return 2;
  }
  if (ch === " " || ch === "\t" || ch === "\n") {
    endWord({ scan });
    return 1;
  }
  scan.inWord = true;
  const quoting = stepQuoteOpen({ index, scan });
  if (quoting > 0) return quoting;
  if (ch === "$") scan.dynamic = true;
  if (ch === "&" && bareAmpersand({ index, scan })) scan.ampersands.push(index);
  scan.word += ch;
  scan.shape += ch;
  if (scan.prefixOpen) scan.prefix += ch;
  scan.plainAt = index;
  return 1;
}

/**
 * Whether the plain `&` at `index` runs the command before it in the background: not half of `&&`, and not
 * a redirection's `>&`, `&>`, `<&` or a `|&` pipe. An operator character only counts when it was plain
 * text itself, so `echo \>&yarn typecheck` still backgrounds `echo`.
 */
function bareAmpersand({ index, scan }: { index: number; scan: WordScan }): boolean {
  const operatorBefore = scan.plainAt === index - 1 && "&<>|".includes(scan.text[index - 1]!);
  const after = scan.text[index + 1];
  return !operatorBefore && after !== "&" && after !== ">";
}

/**
 * Cut one command segment into shell words, stopping at an unquoted `#` that starts a word, and collecting
 * every substitution's inner command line for a caller to walk on its own. `'python3'` lexes as `python3`;
 * `$(which python3)` lexes as a DYNAMIC word, never as a name.
 *
 * @param text one segment's command text
 * @returns the words, the substituted command lines in source order, where each bare `&` sits in `text`,
 *   whether an unquoted line continuation sat inside a word, and whether a quote was still open at the end — a
 *   command the shell would refuse to parse
 */
export function shellWords({ text }: { text: string }): {
  readonly words: readonly ShellWord[];
  readonly substitutions: readonly string[];
  readonly ampersands: readonly number[];
  readonly splitsWord: boolean;
  readonly unterminated: boolean;
} {
  const scan: WordScan = {
    ampersands: [],
    dynamic: false,
    inWord: false,
    plainAt: -1,
    prefix: "",
    prefixOpen: true,
    quote: undefined,
    quoted: false,
    shape: "",
    splitsWord: false,
    substitutions: [],
    text,
    word: "",
    words: [],
  };
  let index = 0;
  while (index < text.length) {
    const substitution = substitutionAt({ index, quote: scan.quote, text });
    if (substitution !== undefined) {
      scan.substitutions.push(substitution.inner);
      scan.word += text.slice(index, substitution.end);
      scan.shape += "_".repeat(substitution.end - index);
      scan.inWord = true;
      scan.dynamic = true;
      scan.prefixOpen = false;
      index = substitution.end;
      continue;
    }
    const advance = scan.quote === undefined ? stepUnquoted({ index, scan }) : stepQuoted({ index, scan });
    if (advance === 0) break;
    index += advance;
  }
  const unterminated = scan.quote !== undefined;
  endWord({ scan });
  return {
    ampersands: scan.ampersands,
    splitsWord: scan.splitsWord,
    substitutions: scan.substitutions,
    unterminated,
    words: scan.words,
  };
}

/**
 * The command lines an UNQUOTED heredoc body expands while the shell builds the input — `$(…)` and backticks,
 * with a backslash escaping the next character. A quoted delimiter's body expands nothing, so a caller asks
 * only for an unquoted one.
 *
 * @param body the heredoc body
 * @returns the substituted command lines, in order
 */
export function bodySubstitutions({ body }: { body: string }): readonly string[] {
  const found: string[] = [];
  let index = 0;
  while (index < body.length) {
    if (body[index] === "\\") {
      index += 2;
      continue;
    }
    const substitution = substitutionAt({ index, quote: '"', text: body });
    if (substitution === undefined) {
      index += 1;
    } else {
      found.push(substitution.inner);
      index = substitution.end;
    }
  }
  return found;
}

// Longest operators first: `<<<` before `<<-` before `<<` before `<`, `&>>` before `&>`.
const REDIRECTION = /^(\d*)(<<<|<<-|<<|<>|<&|&>>|&>|>>|>&|>\||<|>)/;

/**
 * A word that is a redirection operator rather than an argument. The operator must be spelled OUTSIDE any
 * quote — `<<'EOF'` is a heredoc whose delimiter happens to be quoted, while `'>'` is the character as data —
 * and a process substitution (`<(…)`) is a word, not a redirection. Shared with `./shellFileRedirections.ts`.
 *
 * @returns the match — `[1]` the descriptor, `[2]` the operator — or `undefined` for an argument
 */
export function redirectionOf({ word }: { word: ShellWord }): RegExpExecArray | undefined {
  if (word.text.startsWith("<(") || word.text.startsWith(">(")) return undefined;
  const present = REDIRECTION.exec(word.unquotedPrefix);
  if (present === null) {
    return undefined;
  }
  return present;
}

/**
 * A command's words with every redirection operator and its operand removed, heredoc operators included —
 * so a redirection written BEFORE the program resolves to the program, and a file named after an interpreter
 * sitting after a `>` is the redirection's target rather than anything that runs.
 *
 * @param words the command's words
 * @returns the words a shell would pass as the command and its arguments
 */
export function withoutRedirections({ words }: { words: readonly ShellWord[] }): readonly ShellWord[] {
  const kept: ShellWord[] = [];
  let index = 0;
  while (index < words.length) {
    const operator = redirectionOf({ word: words[index]! });
    if (operator === undefined) {
      kept.push(words[index]!);
      index += 1;
    } else {
      index += words[index]!.text.length > operator[0].length ? 1 : 2;
    }
  }
  return kept;
}

/** The output operators that truncate their target first: `>`, `>|`, `&>`, each with or without a descriptor. */
const TRUNCATING_OUTPUT: ReadonlySet<string> = new Set([">", ">|", "&>"]);

/**
 * The words a command's TRUNCATING output redirections name as their targets — `> f`, `2>f`, `>| f`, `&> f`, and a
 * bare `>& f` naming a file, which bash reads as `&> f` — the operator spelled outside any quote, attached or
 * separate. `>>` and `&>>` append, `<>` opens without truncating and `>&` onto a descriptor number or `-` duplicates
 * or closes it, so none of those is a target here.
 *
 * @param words the command's words, redirections still on them (after {@link splitOperators})
 * @returns each target word, quoting facts kept, in order
 */
export function truncatingTargets({ words }: { words: readonly ShellWord[] }): readonly ShellWord[] {
  const found: ShellWord[] = [];
  for (const [index, word] of words.entries()) {
    const operator = redirectionOf({ word });
    if (operator === undefined) continue;
    const attached = word.text.length > operator[0].length;
    const target = attached ? slicedWord({ end: word.text.length, start: operator[0].length, word }) : words[index + 1];
    if (target !== undefined && truncatesInto({ operator, target })) found.push(target);
  }
  return found;
}

/** Whether a redirection truncates its target: a truncating operator, or a descriptor-less `>&` onto a file name. */
function truncatesInto({ operator, target }: { operator: RegExpExecArray; target: ShellWord }): boolean {
  if (TRUNCATING_OUTPUT.has(operator[2]!)) {
    return true;
  }
  return operator[2] === ">&" && operator[1] === "" && !/^(?:\d+|-)$/u.test(target.text);
}

/**
 * The literal operands of a command's here-strings (`<<< 'text'` or `<<<'text'`), quotes removed — the text a
 * reader of stdin receives. An operand built at run time (`<<< "$x"`) is not literal and is left out.
 *
 * @param words the command's words, redirections still on them
 * @returns each literal here-string's text, in order
 */
export function hereStrings({ words }: { words: readonly ShellWord[] }): readonly string[] {
  const found: string[] = [];
  for (const [index, word] of words.entries()) {
    const operator = redirectionOf({ word });
    if (operator?.[2] !== "<<<") continue;
    const attached = word.text.length > operator[0].length;
    const operand = attached ? { ...word, text: word.text.slice(operator[0].length) } : words[index + 1];
    if (operand !== undefined && !operand.dynamic) found.push(operand.text);
  }
  return found;
}

// Which heredoc a command's stdin finally reads is NOT decided here. It needs the segment's raw text: a Codex
// review measured `bash <<'A'</dev/null` arriving as ONE whitespace word, whose leading operator is the heredoc
// and whose later `</dev/null` — the redirection that actually wins — is invisible to a word-level check.
// `./stdinHeredoc.ts`'s `stdinHeredocIndex` scans the text instead, where quotes, substitutions and heredoc
// operators are already understood.

/**
 * The slice of a word from `start` to `end`, as its own word. Its unquoted prefix is re-derived as the leading run
 * its shape leaves unmasked, so the `x=1` of `"a"&x=1` still reads as an assignment, and it is quoted or dynamic
 * only when its own characters are, so the `bash` of `bash<<<"$x"` is still a program name.
 *
 * @returns the piece, with every field recomputed for its own characters
 */
export function slicedWord({ word, start, end }: { word: ShellWord; start: number; end: number }): ShellWord {
  const shape = word.shape.slice(start, end);
  const text = word.text.slice(start, end);
  let open = 0;
  while (open < text.length && shape[open] === text[open]) open += 1;
  return {
    dynamic: word.dynamic && /[$`]/.test(text),
    quoted: shape !== text,
    shape,
    text,
    unquotedPrefix: text.slice(0, open),
  };
}

/**
 * Where a word holds a redirection operator after other characters, which bash reads as two words: `bash<<<x`,
 * `echo"a">out`, `x=>out`. An all-digit run before it is the operator's descriptor (`2>&1`), so it does not cut.
 */
function operatorCuts({ word }: { word: ShellWord }): readonly number[] {
  const cuts: number[] = [];
  let start = 0;
  for (let index = 1; index < word.shape.length; index += 1) {
    const opens = /[<>]/.test(word.shape[index]!) || (word.shape[index] === "&" && word.shape[index + 1] === ">");
    const before = word.shape.slice(start, index);
    if (!opens || /[<>&]$/.test(before) || /^\d+$/.test(before)) continue;
    cuts.push(index);
    start = index;
  }
  return cuts;
}

/**
 * A stage's words with every redirection operator glued to a word cut out into a word of its own.
 *
 * @returns the words, each glued operator now starting a word
 */
export function splitOperators({ words }: { words: readonly ShellWord[] }): readonly ShellWord[] {
  return words.flatMap((word) => {
    const bounds = [0, ...operatorCuts({ word }), word.text.length];
    if (bounds.length === 2) return [word];
    return bounds.slice(1).map((end, index) => slicedWord({ end, start: bounds[index]!, word }));
  });
}
