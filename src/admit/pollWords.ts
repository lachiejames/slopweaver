/**
 * A poll's words as the shell will read them — the lexing the change token rests on. `./pollShape.ts` decides whether
 * a call is a poll and what it waits on; this decides which of its words name a file, and refuses (`undefined`) the
 * moment one could hide a file the token would not see. Every rule here leans conservative: a word it cannot read
 * exactly costs one call the 60-second clock rule, never a re-read of a file that moved.
 */

/** A leading `FOO=bar` assignment. */
export const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;

/** File extensions that mark a file as a log whatever directory it sits in. */
export const LOG_EXTENSIONS = /\.(log|out|err|txt|jsonl|ndjson|status|pid|lock)$/;

/**
 * The short options that take a file, for every command whose operands the token reads: grep's pattern file, sort's
 * output file and temp directory, date's reference file. A command absent from this map is not known to take none.
 */
const FILE_OPTION_LETTERS: ReadonlyMap<string, readonly string[]> = new Map([
  ...["grep", "egrep", "fgrep"].map((word): [string, readonly string[]] => [word, ["f"]]),
  ["sort", ["o", "T"]],
  ["date", ["r"]],
  ...["tail", "head", "cut", "wc", "uniq", "tr", "column", "cat", "ls", "stat", "test", "["].map(
    (word): [string, readonly string[]] => [word, []],
  ),
  ...["cd", "echo", "true", ":", "export", "set", "printf", "pwd"].map((word): [string, readonly string[]] => [
    word,
    [],
  ]),
]);

/**
 * Whether an option word could hold a file the token would not see. A long option with `=` (`--file=x`) and `--`
 * (every later dash word is a file name) can. A short cluster can when one of its command's file-taking letters
 * (`FILE_OPTION_LETTERS`) has anything after it in the same word — `grep -fpatterns`, `sort -oresult` — and, for a
 * command the map does not know, whenever it is more than one letter. `-n`, `-25`, `-oE`, `-B4`, a range such as
 * `cut -c1-200` and `--count` cannot. A separate value (`-f pats`) is its own word, an operand the token stats.
 *
 * @param option the option word, starting with `-`
 * @param command the command word the option belongs to, path stripped
 * @returns true when the word may carry a file
 */
function optionHidesAFile({ option, command }: { option: string; command: string }): boolean {
  if (option.startsWith("--")) {
    return option === "--" || option.includes("=");
  }
  if (!/^-[A-Za-z0-9][A-Za-z0-9,-]*$/.test(option)) {
    return true;
  }
  const letters = FILE_OPTION_LETTERS.get(command);
  if (letters === undefined) {
    return option.length > 2;
  }
  return letters.some((letter) => option.slice(1, -1).includes(letter));
}

/** The characters bash and zsh end an unquoted word on. */
const SHELL_BLANK = /[ \t\n]/;

/** Redirects that read or write no file a token would need: stderr folded into stdout, or discarded. */
const INERT_REDIRECT = /^(?:\d*>&\d|&?\d*>>?\/dev\/null)$/;

/** An unquoted character the shell passes through as itself, in bash and in the owner's zsh alike. */
const LITERAL_CHARACTER = /[\w./@%+,:-]/;

/** One shell word: what the shell passes on, the text it was written as, and whether nothing in it is expanded. */
interface ShellWord {
  /** The word with its quotes removed. */
  readonly value: string;
  /** The word as written, quotes and all. */
  readonly raw: string;
  /** True when no part of the word is expanded, globbed or redirected before the command sees it. */
  readonly literal: boolean;
}

/**
 * Split a segment into shell words, tracking quotes, and mark each word literal or not.
 *
 * A single-quoted run is literal whatever it holds; a double-quoted run is literal unless it holds `$`, a backtick or a
 * backslash; an unquoted character is literal only when it is a letter, digit or one of `_ . / @ % + , : -`. Anything
 * else — a glob, a brace, a tilde, a parenthesis, a backslash, zsh's `=cmd`, `^` and `<1-10>` — may be expanded or
 * redirected into files the token would not see. An ALLOWLIST rather than a list of expansions, because the Bash tool
 * runs the owner's zsh and its expansions outnumber any list. An unclosed quote makes its word not literal.
 *
 * @param text the segment text
 * @returns every word, in order
 */
export function shellWords({ text }: { text: string }): readonly ShellWord[] {
  const found: ShellWord[] = [];
  let start = -1;
  let value = "";
  let literal = true;
  let index = 0;
  while (index < text.length) {
    // Only the shell's own blanks end a word: bash and zsh keep a no-break space inside one.
    if (SHELL_BLANK.test(text[index]!)) {
      if (start !== -1) {
        found.push({ literal, raw: text.slice(start, index), value });
      }
      start = -1;
      value = "";
      literal = true;
      index += 1;
      continue;
    }
    if (start === -1) {
      start = index;
    }
    const step = wordStep({ index, text });
    literal = literal && step.literal;
    value += step.value;
    index = step.next;
  }
  if (start !== -1) {
    found.push({ literal, raw: text.slice(start), value });
  }
  return found;
}

/**
 * Read one step of a word at `index`, which is not a blank: a whole quoted run, or one unquoted character.
 *
 * @param text the segment text
 * @param index where the step starts
 * @returns what the step adds to the word's value, whether it is literal, and where the next step starts
 */
function wordStep({ text, index }: { text: string; index: number }): { value: string; literal: boolean; next: number } {
  const character = text[index]!;
  if (character === "'" || character === '"') {
    const close = text.indexOf(character, index + 1);
    const end = close === -1 ? text.length : close;
    const inner = text.slice(index + 1, end);
    const expands = character === '"' && /[$`\\]/.test(inner);
    return { literal: close !== -1 && !expands, next: end + 1, value: inner };
  }
  return { literal: LITERAL_CHARACTER.test(character), next: index + 1, value: character };
}

/**
 * Every operand of a read segment, split into the path-looking ones and the rest — or `undefined` when a word could
 * hide a file the read opens. A word that is not literal (`shellWords`), an option that may carry a file
 * (`optionHidesAFile`) and any redirect but an inert one are that: the token would not see the file, so it must not
 * vouch. Options and `/dev/null` are not operands. A bare number is one: `cat 123` reads a file named `123`, and
 * `-n 5` costs one stat of a `5` that is not there.
 *
 * @param text the segment, command word included
 * @returns the path-looking operands and the others, or `undefined` when the segment cannot be fingerprinted
 */
export function readOperands({
  text,
}: {
  text: string;
}): { paths: readonly string[]; operands: readonly string[] } | undefined {
  const paths: string[] = [];
  const operands: string[] = [];
  const [first, ...rest] = shellWords({ text });
  const command = first === undefined ? "" : first.value.replace(/^.*\//, "");
  // Whether the word before was an option, which may take this word as its file whatever it starts with:
  // `grep -f -patterns run.log` reads a file called `-patterns`, and so does `wc --files0-from -list`.
  let afterAnOption = false;
  for (const { raw, value: word, literal } of rest) {
    if (INERT_REDIRECT.test(raw)) {
      continue;
    }
    const placement = operandPlacement({ afterAnOption, command, literal, word });
    if (placement === "void") {
      return undefined;
    }
    afterAnOption = word.startsWith("-");
    if (placement === "path") {
      paths.push(word);
    } else if (placement === "operand") {
      operands.push(word);
    }
  }
  return { operands, paths };
}

/**
 * Where one word of a read segment goes — a path, another operand, nowhere — or `void` when it could hide a file.
 *
 * @param word the word with its quotes removed
 * @param literal whether nothing in the word is expanded
 * @param command the segment's command word, path stripped
 * @param afterAnOption whether the word before was an option, which may take this word as its file
 * @returns the word's placement
 */
function operandPlacement({
  word,
  literal,
  command,
  afterAnOption,
}: {
  word: string;
  literal: boolean;
  command: string;
  afterAnOption: boolean;
}): "void" | "none" | "path" | "operand" {
  const option = word.startsWith("-");
  if (!literal || (option && optionHidesAFile({ command, option: word }))) {
    return "void";
  }
  // A dash word after an option is judged as an option AND counted as a possible file: an operand, so a name that
  // is not there is skipped rather than voiding the token.
  if (option) {
    return afterAnOption ? "operand" : "none";
  }
  if (word === "/dev/null") {
    return "none";
  }
  return word.includes("/") || LOG_EXTENSIONS.test(word) ? "path" : "operand";
}

/**
 * Names whose value steers which file a later command runs or reads — command lookup, a timezone or locale file, word
 * splitting, the directory a relative word lands in, a startup file. An assignment to one in the command voids the token
 *. zsh ties lowercase `path`, `cdpath` and `fpath` to their uppercase arrays. The same names
 * INHERITED from the hook's environment are the residue `./pollFingerprint.ts` accepts.
 */
const STEERING_NAMES =
  /^(?:PATH|path|CDPATH|cdpath|FPATH|fpath|TZ|LANG|LANGUAGE|LC_[A-Z]+|LOCPATH|NLSPATH|IFS|HOME|PWD|OLDPWD|ENV|BASH_ENV|ZDOTDIR|TMPDIR|GREP_OPTIONS|POSIXLY_CORRECT)$/;

/**
 * Whether a name is one no shell gives special meaning, so `$NAME` expands to exactly the word assigned to it.
 *
 * An ALLOWLIST by shape, because the special parameters are not a list a gate can finish: zsh seeds its generator on
 * `RANDOM=1` and the next `$RANDOM` reads 16807, and `SECONDS`, `LINENO`, `path` and the
 * rest each answer something other than what was assigned. Every special name in bash and zsh is either all one case
 * and longer than two characters, or `_`. So a name binds only when it is one or two letters and digits, or carries
 * both cases — `S`, `SP`, `logDir` — and is not a steering name (`TZ`). Any other assignment keeps the clock rule.
 *
 * @param name the assigned name
 * @returns true when the shell expands it to the literal assigned
 */
function ordinaryName({ name }: { name: string }): boolean {
  if (STEERING_NAMES.test(name) || name.startsWith("_")) {
    return false;
  }
  return name.length <= 2 || (/[a-z]/.test(name) && /[A-Z]/.test(name));
}

/**
 * What a bare `NAME=value` segment adds to the token: nothing, when it binds one literal word to a name that steers no
 * file — or `undefined`. `PATH=/tmp; tail x` runs `/tmp/tail`, and `TZ=:/z; date` opens `/z`: no later word names
 * that file.
 *
 * @param name the assigned name
 * @param value the value as written
 * @returns no operands, or `undefined` when the assignment voids the token
 */
function assignmentReads({ name, value }: { name: string; value: string }): readonly string[] | undefined {
  if (!ordinaryName({ name })) {
    return undefined;
  }
  const words = shellWords({ text: value });
  return words.length <= 1 && words.every((word) => word.literal) ? [] : undefined;
}

/** Filters whose own program can open a file (`sed 'r x'`, awk's `getline <`, jq's `--rawfile`): no word says which. */
const PROGRAMMABLE_FILTERS: ReadonlySet<string> = new Set(["sed", "awk", "jq"]);

/** Neutral words that read no file whatever their arguments. `date` is not one: `date -r <file>` reads that file. */
const READS_NOTHING: ReadonlySet<string> = new Set(["cd", "echo", "true", ":", "export", "set", "printf", "pwd"]);

/**
 * What a segment that is not a probe adds to the change token, or `undefined` when it could read a file the token
 * would not see. Neutral segments ride along with the probe (`echo ---; tail -5 x`, `cat x | grep -f pats`), and the
 * token speaks for the WHOLE call, so each must either name its files or void the token: a word the shell expands
 * (`echo "$(cat secret)"`), a redirect, a programmable filter, or an assignment whose value is more than one literal
 * word. A filter's and `date`'s words are operands — statted, and counted only when one exists.
 *
 * @param text the segment, assignments already substituted
 * @returns the operands it reads, or `undefined`
 */
export function neutralReads({ text }: { text: string }): readonly string[] | undefined {
  const trimmed = text.trim();
  const assignment = ASSIGNMENT.exec(trimmed);
  if (assignment !== null) {
    return assignmentReads({ name: assignment[1]!, value: assignment[2]! });
  }
  const word = shellWords({ text: trimmed })[0]?.value.replace(/^.*\//, "");
  if (word === undefined) {
    return [];
  }
  // `export` hands a value to every later command's environment, where `TZ` or `LANG` names a file no word does.
  if (word === "export") {
    return undefined;
  }
  // `printf -v NAME` assigns, in bash and zsh alike, so a later `$NAME` reads a value no substitution here saw.
  if (word === "printf" && shellWords({ text: trimmed })[1]?.value.startsWith("-") === true) {
    return undefined;
  }
  const operands = PROGRAMMABLE_FILTERS.has(word) ? undefined : readOperands({ text: trimmed });
  if (operands === undefined) {
    return undefined;
  }
  return READS_NOTHING.has(word) ? [] : [...operands.paths, ...operands.operands];
}

/**
 * Substitute the leading assignments the way the shell would — the rule the change token needs. Only a value that is
 * one literal shell word of plain characters is bound (`S=~/x` and `S=$(…)` are expanded by the shell at assignment,
 * so their `$S` stays in place), and `$NAME` is replaced only where the name ends, so `S` never rewrites the front of
 * `$SHELL`, and never before a `:` or `[`, where zsh reads a modifier or a subscript (`$S:r`, `$S[1]`). Where this and `substituteAssignments` disagree the shallow target is not the file the shell reads, so
 * the call names no file.
 *
 * @param segments the segment texts in order
 * @returns the same segments with each bound `$NAME` and `${NAME}` replaced, or `undefined` once the expansion
 *   outgrows `MAX_EXPANDED_CHARS` — a call this pass will not vouch for
 */
export function substituteLiteralAssignments({
  segments,
}: {
  segments: readonly string[];
}): readonly string[] | undefined {
  const bindings = new Map<string, string>();
  const expanded: string[] = [];
  // A short value repeated many times grows linear text quadratically (`A=xxxx; tail $A$A$A…`), so every splice is
  // charged against one budget for the whole call, and once it is spent a splice adds nothing and the pass gives up.
  const budget = { remaining: MAX_EXPANDED_CHARS };
  for (const segment of segments) {
    budget.remaining -= segment.length;
    const text = spliceBindings({ bindings, budget, text: segment });
    if (text === undefined) {
      return undefined;
    }
    const binding = literalBinding({ segment });
    // An assignment this pass will not bind still rebinds its name in the shell, so the earlier value would be spliced
    // where the shell reads the new one (`A=/x; A='/y z'; tail "$A/run.log"`): the call names no file.
    if (binding.kind === "refused") {
      return undefined;
    }
    // Bounded, so this pass stays linear in the command: a call binding past the cap names no file.
    if (binding.kind === "bound") {
      bindings.set(binding.name, binding.value);
    }
    if (bindings.size > MAX_LITERAL_BINDINGS) {
      return undefined;
    }
    expanded.push(text);
  }
  return expanded;
}

/**
 * Splice every binding into one segment, charging each splice against the call's one budget.
 *
 * @param text the segment as written
 * @param bindings the names bound so far, with their values
 * @param budget the characters the whole call may still build; spent in place
 * @returns the spliced segment, or `undefined` once the budget is spent
 */
function spliceBindings({
  text,
  bindings,
  budget,
}: {
  text: string;
  bindings: ReadonlyMap<string, string>;
  budget: { remaining: number };
}): string | undefined {
  let spliced = text;
  for (const [name, value] of bindings) {
    const splice = (): string => {
      budget.remaining -= value.length;
      return budget.remaining < 0 ? "" : value;
    };
    // Never before a `:` or a `[`: zsh reads `$S:r` as a modifier and `$S[1,-1]` as a subscript on the value, even
    // inside double quotes, so the file it opens is not the text spliced.
    const passes = [`\${${name}}`, new RegExp(`\\$${name}(?![A-Za-z0-9_:[])`, "g")] as const;
    for (const pattern of passes) {
      // Checked before every pass, so no pass scans or builds text once the budget is gone.
      if (budget.remaining < 0) {
        return undefined;
      }
      spliced = typeof pattern === "string" ? spliced.replaceAll(pattern, splice) : spliced.replace(pattern, splice);
    }
  }
  return budget.remaining < 0 ? undefined : spliced;
}

/**
 * What a segment's leading assignment binds for the strict pass: nothing, a refusal, or one literal value.
 *
 * The value is judged AS WRITTEN, before an earlier binding is spliced in: `B=$A/run.log` binds nothing. It is spliced
 * back into text that is lexed again, so a space or a quote in it would re-split differently.
 *
 * @param segment the segment as written
 * @returns `none` for no assignment, `refused` for one this pass will not bind, or the name and value bound
 */
function literalBinding({
  segment,
}: {
  segment: string;
}): { kind: "none" } | { kind: "refused" } | { kind: "bound"; name: string; value: string } {
  const match = ASSIGNMENT.exec(segment.trim());
  if (match === null) {
    return { kind: "none" };
  }
  const assigned = shellWords({ text: match[2]! });
  const only = assigned[0];
  const name = match[1]!;
  if (
    !ordinaryName({ name }) ||
    assigned.length !== 1 ||
    only === undefined ||
    !only.literal ||
    !/^[\w./@%+,:-]+$/.test(only.value)
  ) {
    return { kind: "refused" };
  }
  return { kind: "bound", name, value: only.value };
}

/** The most assignments the strict pass binds; a poll carrying more is no poll a token needs to vouch for. */
const MAX_LITERAL_BINDINGS = 32;

/**
 * The most text the strict pass builds for one call, segments and splices together, and the longest call it reads at
 * all — an empty segment costs the pass nothing, so a call padded with separators is capped by its own length instead.
 * Past either the call names no file.
 */
export const MAX_EXPANDED_CHARS = 65_536;

/**
 * Whether a `$` in the text is one the shell passes through unexpanded — inside single quotes (`$'…'` included) or
 * after a backslash. Assignment substitution is quote-blind, so where it rewrote the text such a `$` may have become
 * a name the command never reads.
 *
 * @param text one segment of the command, as written
 * @returns true when at least one `$` is single-quoted or escaped
 */
export function hasInertDollar({ text }: { text: string }): boolean {
  let double = false;
  let index = 0;
  while (index < text.length) {
    const step = inertDollarStep({ double, index, text });
    if (step.inert) {
      return true;
    }
    double = step.double;
    index = step.next;
  }
  return false;
}

/**
 * Read one step of the quote walk at `index`: an escape and the character after it, a double quote, a whole
 * single-quoted run (to its close, or to the end when unclosed — nothing in it is special), or one other character.
 *
 * @param text one segment of the command, as written
 * @param index where the step starts
 * @param double whether the walk is inside double quotes
 * @returns whether the step holds an inert `$`, where the next step starts, and the double-quote state after it
 */
function inertDollarStep({ text, index, double }: { text: string; index: number; double: boolean }): {
  inert: boolean;
  next: number;
  double: boolean;
} {
  const char = text[index];
  if (char === "\\") {
    return { double, inert: text[index + 1] === "$", next: index + 2 };
  }
  if (char === '"') {
    return { double: !double, inert: false, next: index + 1 };
  }
  if (char === "'" && !double) {
    const close = text.indexOf("'", index + 1);
    const end = close === -1 ? text.length : close;
    return { double, inert: text.slice(index + 1, end).includes("$"), next: end + 1 };
  }
  return { double, inert: false, next: index + 1 };
}

/**
 * Whether a segment's command word is one unquoted literal word with no path in it, or the segment has no word at all.
 *
 * @param text one segment of the command, as written
 * @returns true when the word the shell runs is exactly the bare name written
 */
export function bareCommandWord({ text }: { text: string }): boolean {
  const commandWord = shellWords({ text })[0];
  return (
    commandWord === undefined ||
    (commandWord.literal && commandWord.raw === commandWord.value && !commandWord.value.includes("/"))
  );
}
