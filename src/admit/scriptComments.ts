/**
 * Comments removed from an `osascript` program, so a browser named only inside one does not read as addressed.
 *
 * Strings are kept whole, so a comment marker inside one (`"a -- b"`, `'https://x'`) never cuts the line. AppleScript
 * delimits strings with `"` only — `window 1's name` is code — while JavaScript also has `'` and backticks, which is
 * why the language is a parameter rather than a guess.
 */

/** The scripting language `osascript -l` selects. */
export type ScriptLanguage = "applescript" | "javascript";

/** Each language's string delimiters. */
const QUOTES: Readonly<Record<ScriptLanguage, readonly string[]>> = {
  applescript: ['"'],
  javascript: ['"', "'", "`"],
};

/** Each language's line comments, and its block comment's opening and closing markers. */
const COMMENTS: Readonly<Record<ScriptLanguage, { line: readonly string[]; open: string; close: string }>> = {
  applescript: { close: "*)", line: ["--", "#"], open: "(*" },
  // `<!--` is ECMAScript's Annex B HTML-like line comment, which JavaScriptCore still honours (the r3 review).
  javascript: { close: "*/", line: ["//", "<!--"], open: "/*" },
};

/**
 * The index just past the string opening at `start`, a backslash escaping the next character.
 *
 * @param text the program
 * @param start where the opening quote sits
 * @returns the index after the closing quote, or the end of the text when it never closes
 */
function stringEnd({ start, text }: { start: number; text: string }): number {
  const quote = text[start]!;
  let index = start + 1;
  while (index < text.length && text[index] !== quote) {
    index += text[index] === "\\" ? 2 : 1;
  }
  return Math.min(index + 1, text.length);
}

/**
 * The index just past the block comment opening at `start`; AppleScript's `(* *)` nests, so depth is counted.
 *
 * @param text the program
 * @param start where the opening marker sits
 * @param language decides the markers and whether they nest
 * @returns the index after the closing marker, or the end of the text when it never closes
 */
function blockEnd({ language, start, text }: { language: ScriptLanguage; start: number; text: string }): number {
  const { close, open } = COMMENTS[language];
  let depth = 0;
  let index = start;
  while (index < text.length) {
    if (text.startsWith(close, index)) {
      depth -= 1;
      index += close.length;
      if (depth === 0) {
        return index;
      }
    } else if (text.startsWith(open, index) && (depth === 0 || language === "applescript")) {
      depth += 1;
      index += open.length;
    } else {
      index += 1;
    }
  }
  return text.length;
}

/**
 * The characters after which a JavaScript `/` opens a regular expression rather than dividing. `)`, `]`, `}`, `+`, `-`
 * and a word (bar a {@link REGEX_KEYWORDS} one) are left out because a division can follow each (`({}) / x`, `a++ / x`), so reading one as a regex could
 * hide code; leaving a real regex as code only ever refuses more.
 */
const REGEX_PRECEDERS = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", ";", "*", "%", "<", ">", "~", "^"]);

/**
 * The index just past a regular expression body whose opening `/` is at `start`: closed by an unescaped `/` outside a
 * `[…]` class on the same line. A `//` inside one (`/\//`) is its text, never a line comment.
 *
 * @param text the program
 * @param start where the opening `/` sits
 * @returns the index after the closing `/`, or `undefined` when the line ends first
 */
function regexBodyEnd({ start, text }: { start: number; text: string }): number | undefined {
  let inClass = false;
  let index = start + 1;
  while (index < text.length && text[index] !== "\n") {
    const char = text[index];
    if (char === "\\") {
      index += text[index + 1] === "\n" ? text.length : 2;
    } else if (char === "/" && !inClass) {
      return index + 1;
    } else {
      inClass = char === "[" || (inClass && char !== "]");
      index += 1;
    }
  }
  return undefined;
}

/**
 * The last non-whitespace character before `end`, walking back over whitespace only so a long program costs nothing
 * extra per `/`.
 *
 * @param text the code read so far, comments already removed
 * @param end where to start walking back from, exclusive
 * @returns that character, or `undefined` when only whitespace precedes `end`
 */
function lastSignificant({ end, text }: { end: number; text: string }): string | undefined {
  let index = end - 1;
  while (index >= 0 && /\s/.test(text[index]!)) {
    index -= 1;
  }
  return text[index];
}

/**
 * Reserved words after which a `/` can only open a regular expression (`return /x/`). Only words no binding can take:
 * `of`, `yield` and `await` are left out, since `var of = 4; of / x` divides in sloppy-mode JavaScript.
 */
const REGEX_KEYWORDS: ReadonlySet<string> = new Set([
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "return",
  "throw",
  "typeof",
  "void",
]);

/**
 * Whether the code before `end` closes on a {@link REGEX_KEYWORDS} word standing as a keyword — not a property
 * named like one (`a.return / 2` divides), so a `/` after it opens a regular expression.
 *
 * @param end where the code before the `/` ends
 * @param text comment-free code
 * @returns true when that word is a keyword a regex follows
 */
function followsRegexKeyword({ end, text }: { end: number; text: string }): boolean {
  let wordEnd = end;
  while (wordEnd > 0 && /\s/.test(text[wordEnd - 1]!)) {
    wordEnd -= 1;
  }
  let wordStart = wordEnd;
  while (wordStart > 0 && /[\w$]/.test(text[wordStart - 1]!)) {
    wordStart -= 1;
  }
  const word = text.slice(wordStart, wordEnd);
  return REGEX_KEYWORDS.has(word) && lastSignificant({ end: wordStart, text }) !== ".";
}

/**
 * Where the code character at `start` ends: past a whole JavaScript regular expression literal when one opens there —
 * a `/` following nothing but whitespace or a {@link REGEX_PRECEDERS} character — else just past that one character.
 * AppleScript has no regular expression literal.
 *
 * @param language which language's literals apply
 * @param start where the character sits
 * @param text the program
 * @param code comment-free code whose last character before `codeEnd` decides whether a `/` opens a literal
 * @param codeEnd where the code before `start` ends inside `code`
 * @returns the index after the literal or the character; more than `start + 1` only for a literal
 */
function codeTokenEnd({
  code,
  codeEnd,
  language,
  start,
  text,
}: {
  code: string;
  codeEnd: number;
  language: ScriptLanguage;
  start: number;
  text: string;
}): number {
  if (language !== "javascript" || text[start] !== "/") {
    return start + 1;
  }
  const before = lastSignificant({ end: codeEnd, text: code });
  const opensRegex =
    before === undefined || REGEX_PRECEDERS.has(before) || followsRegexKeyword({ end: codeEnd, text: code });
  const end = opensRegex ? regexBodyEnd({ start, text }) : undefined;
  if (end === undefined) {
    return start + 1;
  }
  return end;
}

/**
 * The program with every comment replaced by a single space, strings and JavaScript regular expression literals left
 * exactly as written — `/\//; Application("Safari")` carries no comment, so the call after it is kept.
 *
 * @param program the `osascript` program text
 * @param language which language's strings and comments apply
 * @returns the program without its comments
 */
export function withoutScriptComments({ language, program }: { language: ScriptLanguage; program: string }): string {
  const { line, open } = COMMENTS[language];
  let kept = "";
  let index = 0;
  while (index < program.length) {
    if (QUOTES[language].includes(program[index]!)) {
      const end = quotedEnd({ language, start: index, text: program });
      kept += program.slice(index, end);
      index = end;
    } else if (program.startsWith(open, index)) {
      kept += " ";
      index = blockEnd({ language, start: index, text: program });
    } else if (line.some((marker) => program.startsWith(marker, index))) {
      const newline = program.indexOf("\n", index);
      kept += " ";
      index = newline === -1 ? program.length : newline;
    } else {
      const next = codeTokenEnd({ code: kept, codeEnd: kept.length, language, start: index, text: program });
      kept += program.slice(index, next);
      index = next;
    }
  }
  return kept;
}

/**
 * Where each string literal of a comment-free program starts and ends, so a caller can tell code from text a script
 * only holds — `var note = 'Application("Arc")'` addresses nothing (the r3 review). A JavaScript template carrying a
 * `${…}` runs that expression, so each `${…}` is left as code — `` `${Application("Safari").activate()}` `` activates
 * Safari — while the text around it is a span like any other string's. A
 * JavaScript regular expression literal is a span too.
 *
 * @param program the program, its comments already removed by {@link withoutScriptComments}
 * @param language which language's string delimiters apply
 * @returns each literal's span, its opening quote at `start` and `end` just past its closing one
 */
export function stringSpans({
  language,
  program,
}: {
  language: ScriptLanguage;
  program: string;
}): readonly { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let index = 0;
  while (index < program.length) {
    const end = QUOTES[language].includes(program[index]!)
      ? quotedEnd({ language, start: index, text: program })
      : codeTokenEnd({ code: program, codeEnd: index, language, start: index, text: program });
    spans.push(...literalSpans({ end, language, program, start: index }));
    index = end;
  }
  return spans;
}

/**
 * The spans one token of a comment-free program contributes: a template's text around its `${…}`, a string or regular
 * expression literal whole, and nothing for a single code character.
 *
 * @param end just past the token
 * @param language which language's string delimiters apply
 * @param program the program text
 * @param start where the token opens
 * @returns the token's text spans
 */
function literalSpans({
  end,
  language,
  program,
  start,
}: {
  end: number;
  language: ScriptLanguage;
  program: string;
  start: number;
}): readonly { start: number; end: number }[] {
  if (language === "javascript" && program[start] === "`") {
    return templateTextSpans({ end, program, start });
  }
  const isLiteral = QUOTES[language].includes(program[start]!) || end > start + 1;
  return isLiteral ? [{ end, start }] : [];
}

/**
 * The text spans of one JavaScript template literal: the whole template when it interpolates nothing, else each run of
 * text around its `${…}` expressions, which stay code.
 *
 * @param end just past the template's closing backtick
 * @param program the program text
 * @param start the template's opening backtick
 * @returns each text span, its `start` the character before the text and `end` the character after it
 */
function templateTextSpans({
  end,
  program,
  start,
}: {
  end: number;
  program: string;
  start: number;
}): readonly { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let textStart = start;
  let at = start + 1;
  while (at < end - 1) {
    if (program[at] === "\\") {
      at += 2;
    } else if (program.startsWith("${", at)) {
      spans.push({ end: at, start: textStart });
      const closed = interpolationEnd({ end: end - 1, program, start: at + 2 });
      // An interpolation it cannot read to its close leaves the rest of the template as code.
      if (closed === undefined) {
        return spans;
      }
      textStart = closed;
      at = textStart + 1;
    } else {
      at += 1;
    }
  }
  spans.push({ end, start: textStart });
  return spans;
}

/**
 * Where a template's `${…}` expression closes, counting the braces nested inside it and skipping the strings and
 * templates it holds — `${"}", Application("Safari")}` closes at its last `}`, not inside `"}"`. A
 * `/` inside one may open a regular expression holding a brace, which this does not read, so it gives up there.
 *
 * @param end the furthest the expression can reach
 * @param program the program text
 * @param start the first character after `${`
 * @returns the index of the closing `}`, or `undefined` when none closes it before `end` or a `/` stops the reading
 */
function interpolationEnd({
  end,
  program,
  start,
}: {
  end: number;
  program: string;
  start: number;
}): number | undefined {
  let depth = 1;
  let at = start;
  while (at < end) {
    const char = program[at]!;
    if (char === "/") {
      return undefined;
    }
    if (JAVASCRIPT_QUOTES.has(char)) {
      const closed = javascriptLiteralEnd({ start: at, text: program });
      if (closed === undefined) {
        return undefined;
      }
      at = closed;
      continue;
    }
    depth += Number(char === "{") - Number(char === "}");
    if (depth === 0) {
      return at;
    }
    at += 1;
  }
  return undefined;
}

/** The characters that open a JavaScript string or template literal. */
const JAVASCRIPT_QUOTES: ReadonlySet<string> = new Set(['"', "'", "`"]);

/**
 * The index just past the JavaScript string or template literal opening at `start`.
 *
 * @param start where the opening quote or backtick sits
 * @param text the program
 * @returns the index after the literal, or `undefined` when a template never closes or an interpolation is unreadable
 */
function javascriptLiteralEnd({ start, text }: { start: number; text: string }): number | undefined {
  if (text[start] === "`") {
    return templateEnd({ start, text });
  }
  return stringEnd({ start, text });
}

/**
 * The index just past a JavaScript template opening at `start`, each `${…}` read whole by {@link interpolationEnd}, so
 * a backtick inside an interpolated string (`` `${"`"}` ``) does not close it.
 *
 * @param start where the opening backtick sits
 * @param text the program
 * @returns the index after the closing backtick, or `undefined` when it never closes or an interpolation is unreadable
 */
function templateEnd({ start, text }: { start: number; text: string }): number | undefined {
  let at = start + 1;
  while (at < text.length) {
    if (text[at] === "\\") {
      at += 2;
    } else if (text[at] === "`") {
      return at + 1;
    } else if (text.startsWith("${", at)) {
      const closed = interpolationEnd({ end: text.length, program: text, start: at + 2 });
      if (closed === undefined) {
        return undefined;
      }
      at = closed + 1;
    } else {
      at += 1;
    }
  }
  return undefined;
}

/**
 * The index just past the string or template literal opening at `start`. A JavaScript template that cannot be read
 * to its end runs to the end of the program, so nothing after it is mistaken for text.
 *
 * @param language which language's literals apply
 * @param start where the opening quote sits
 * @param text the program
 * @returns the index after the literal
 */
function quotedEnd({ language, start, text }: { language: ScriptLanguage; start: number; text: string }): number {
  if (language === "javascript" && text[start] === "`") {
    const closed = templateEnd({ start, text });
    if (closed === undefined) {
      return text.length;
    }
    return closed;
  }
  return stringEnd({ start, text });
}

/**
 * The language an `osascript` command line selects with `-l`, AppleScript when it names none.
 *
 * @param args the words after `osascript`
 * @returns the selected language
 */
export function osascriptLanguage({ args }: { args: readonly string[] }): ScriptLanguage {
  const flag = args.findIndex((word) => word.startsWith("-l"));
  if (flag === -1) {
    return "applescript";
  }
  const named = args[flag] === "-l" ? args[flag + 1] : args[flag]!.slice(2);
  return named?.toLowerCase() === "javascript" ? "javascript" : "applescript";
}
