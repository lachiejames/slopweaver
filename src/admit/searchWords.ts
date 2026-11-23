/**
 * What one `grep`-family or `rg` command line SEARCHES — its path operands and whether it recurses — read
 * from its words by each program's own option grammar (`./searchGrammars.ts`), for `./diskScan.ts` to judge.
 *
 * ## Why a grammar rather than "every word that is not a flag"
 *
 * A search's FIRST positional word is its pattern unless an `-e`/`-f` supplied one, and several options take
 * the next word as a value. Read naively, `grep -r / src` would name `/` as a root to walk, and
 * `grep -A 3 x file` would name `3` as a file. Each program's value-taking options are tabled, and a
 * short-option CLUSTER is walked the way `getopt` walks it: `-rA3` is recurse plus a context of `3`, and
 * `-rlie pat` is four flags whose last takes `pat`.
 *
 * ## The two families, and the one letter that differs
 *
 * `grep`, `egrep`, `fgrep`, `ggrep`, `ugrep` and `ug` recurse only when asked (`-r`, `-R`, `--recursive`,
 * `-d recurse`). `rg` always recurses into a directory operand, and its `-r` is `--replace`, which takes a
 * value — so the same letter means opposite things and the tables cannot be shared.
 *
 * ## A bare `grep` is two programs
 *
 * In Claude Code's Bash tool `grep` is its ugrep shim; anywhere else on this Mac it is BSD `grep`, and they
 * disagree on letters such as `-O`. So a `grep`-family name other than `ugrep` is read under BOTH grammars and
 * the union of their paths is judged: a path either would search is named, and a reading that refuses an
 * option it does not accept names nothing, because that program exits with usage.
 *
 * Pure: words in, a reading out. An unknown long option is treated as a flag, which at worst reads its
 * value as an operand; the judge only refuses an operand that IS a whole-world root or sits inside the
 * corpus, so that misreading cannot refuse an ordinary search.
 */
import {
  GREP_PATTERN_LONG,
  GREP_RECURSIVE_LONG,
  type Grammar,
  grammarsFor,
  longPrintsAndExits,
  shortPrintsAndExits,
} from "./searchGrammars.js";

/** What one search command line reads. */
export interface SearchWords {
  /** The program's basename. */
  readonly binary: string;
  /** Whether a directory operand is walked rather than refused — always true for `rg`. */
  readonly recursive: boolean;
  /** The path operands, as written, after the pattern. */
  readonly paths: readonly string[];
}

/** The long spelling of `-d`, whose value `recurse` recurses; a `grep`-family prefix of it counts. */
const DIRECTORIES_LONG = "--directories";

/** The running state of one left-to-right pass over a command's words. */
interface Pass {
  recursive: boolean;
  patternSupplied: boolean;
  optionsEnded: boolean;
  /** A ugrep `--and`-family option is waiting on its PATTERN, which an `-e` may still precede. */
  dashEMayFollow: boolean;
  /** The pending value is `-d`/`--directories`'s, so a `recurse` there recurses — and a pattern `recurse` does not. */
  awaitingDirectories: boolean;
  /** A print-and-exit option was read, so the program reads no file at all. */
  printsAndExits: boolean;
  /** An option the program does not accept was read, so it exits with usage and reads no file at all. */
  rejected: boolean;
  readonly positionals: string[];
}

/**
 * Walk one short-option cluster the way `getopt` does.
 *
 * @param cluster the word without its leading dash, e.g. `rli` or `rA3`
 * @param grammar the program's option tables
 * @param pass the running state, updated in place
 * @returns whether the cluster's last option consumes the NEXT word as its value
 */
function walkCluster({ cluster, grammar, pass }: { cluster: string; grammar: Grammar; pass: Pass }): boolean {
  for (let at = 0; at < cluster.length; at += 1) {
    const letter = cluster[at]!;
    if (grammar.known !== undefined && !grammar.known.short.has(letter)) {
      pass.rejected = true;
      return false;
    }
    if (shortPrintsAndExits({ grammar, letter })) {
      pass.printsAndExits = true;
    } else if (grammar.grepFamily && (letter === "r" || letter === "R")) {
      pass.recursive = true;
    } else if (grammar.valueShort.has(letter)) {
      return takeShortValue({ grammar, inline: cluster.slice(at + 1), letter, pass });
    }
  }
  return false;
}

/**
 * Read one value-taking short option, whose value is the rest of its cluster or else the next word.
 *
 * @param letter the option letter
 * @param inline what follows it in the same cluster, empty when its value is the next word
 * @param grammar the program's option tables
 * @param pass the running state, updated in place
 * @returns whether it consumes the NEXT word as its value
 */
function takeShortValue({
  letter,
  inline,
  grammar,
  pass,
}: {
  letter: string;
  inline: string;
  grammar: Grammar;
  pass: Pass;
}): boolean {
  if (letter === "e" || letter === "f") {
    pass.patternSupplied = true;
  }
  if (grammar.grepFamily && letter === "d" && inline === "recurse") {
    pass.recursive = true;
  }
  pass.awaitingDirectories = grammar.grepFamily && letter === "d" && inline.length === 0;
  return inline.length === 0;
}

/**
 * Read one long option, which either carries its value after `=` or takes the next word. Whether an EMPTY
 * `--opt=` takes the next word is the grammar's own (`Grammar.emptyValueTakesNext`).
 *
 * @param word the whole word, e.g. `--include=*.ts` or `--regexp`
 * @param grammar the program's option tables
 * @param pass the running state, updated in place
 * @returns whether it consumes the NEXT word as its value
 */
function readLong({ word, grammar, pass }: { word: string; grammar: Grammar; pass: Pass }): boolean {
  const written = word.includes("=") ? word.slice(0, word.indexOf("=")) : word;
  const minimumInline = grammar.emptyValueTakesNext ? written.length + 1 : written.length;
  const valueInline = word.length > minimumInline;
  const name = resolveLong({ grammar, written });
  if (name === undefined) {
    pass.rejected = true;
    return false;
  }
  if (grammar.grepFamily && GREP_RECURSIVE_LONG.has(name + word.slice(written.length))) {
    pass.recursive = true;
  }
  if (longPrintsAndExits({ grammar, name })) {
    pass.printsAndExits = true;
  }
  if (name === "--regexp" || name === "--file") {
    pass.patternSupplied = true;
  }
  if (grammar.grepFamily && GREP_PATTERN_LONG.has(name)) {
    pass.patternSupplied = true;
    pass.dashEMayFollow = !valueInline;
    return pass.dashEMayFollow;
  }
  const takesNext = !valueInline && takesLongValue({ grammar, name });
  pass.awaitingDirectories = takesNext && grammar.grepFamily && name.length > 3 && DIRECTORIES_LONG.startsWith(name);
  return takesNext;
}

/**
 * The long option a written name means. Under a measured grammar that is the exact name or its one unambiguous
 * prefix, the way `getopt_long` resolves it — two spellings of one option are not ambiguous, so
 * `/usr/bin/grep -c --colo sh /etc/shells` prints 9 — and `undefined` for anything else, which the program
 * refuses with usage. Under an unmeasured one the name is taken as written.
 */
function resolveLong({ grammar, written }: { grammar: Grammar; written: string }): string | undefined {
  if (grammar.known === undefined || grammar.known.long.includes(written)) {
    return written;
  }
  const candidates = new Set(
    grammar.known.long
      .filter((long) => long.startsWith(written))
      .map((long) => (long === "--colour" ? "--color" : long)),
  );
  if (candidates.size !== 1) {
    return undefined;
  }
  return [...candidates][0];
}

/**
 * Whether a long option's name takes a value. GNU and BSD `grep` read an unambiguous PREFIX as the whole
 * option, the way `getopt_long` does — `/usr/bin/grep -e foo --exclude-d /nonexistent -r /dev/null` exits 1 with
 * no warning, `/nonexistent` read as `--exclude-dir`'s value — so under ugrep's table, which also stands in for
 * a GNU `ggrep`, a grep-family prefix of any value-taking long counts. ugrep and `rg` refuse an abbreviation
 * outright, so reading one as value-taking can only under-refuse.
 */
function takesLongValue({ grammar, name }: { grammar: Grammar; name: string }): boolean {
  if (grammar.valueLong.has(name)) {
    return true;
  }
  return grammar.grepFamily && name.length > 3 && [...grammar.valueLong].some((long) => long.startsWith(name));
}

/**
 * One grammar's reading of a command's words: the paths it would search, or none when it prints and exits or
 * refuses an option it does not accept.
 */
function readUnder({ args, grammar }: { args: readonly string[]; grammar: Grammar }): {
  paths: readonly string[];
  recursive: boolean;
} {
  const pass: Pass = {
    awaitingDirectories: false,
    dashEMayFollow: false,
    optionsEnded: false,
    patternSupplied: false,
    positionals: [],
    printsAndExits: false,
    recursive: !grammar.grepFamily,
    rejected: false,
  };
  let takesValue = false;
  for (const word of args) {
    takesValue = readWord({ grammar, pass, takesValue, word });
  }
  if (pass.printsAndExits || pass.rejected) {
    return { paths: [], recursive: false };
  }
  return { paths: pass.patternSupplied ? pass.positionals : pass.positionals.slice(1), recursive: pass.recursive };
}

/**
 * Read one word of a search's argv, after the program.
 *
 * @param word the word
 * @param takesValue whether the previous option consumes this word as its value
 * @param grammar the program's option tables
 * @param pass the running state, updated in place
 * @returns whether THIS word's option consumes the next word as its value
 */
function readWord({
  word,
  takesValue,
  grammar,
  pass,
}: {
  word: string;
  takesValue: boolean;
  grammar: Grammar;
  pass: Pass;
}): boolean {
  if (takesValue) {
    const dashE = pass.dashEMayFollow && word === "-e";
    pass.dashEMayFollow = false;
    if (dashE) {
      return true;
    }
    if (pass.awaitingDirectories && word === "recurse") {
      pass.recursive = true;
    }
    pass.awaitingDirectories = false;
    return false;
  }
  if (pass.optionsEnded || word === "-" || !word.startsWith("-")) {
    pass.positionals.push(word);
    return false;
  }
  if (word === "--") {
    pass.optionsEnded = true;
    return false;
  }
  if (word.startsWith("--")) {
    return readLong({ grammar, pass, word });
  }
  return walkCluster({ cluster: word.slice(1), grammar, pass });
}

/**
 * The search a command's words run, when its program is a `grep`-family search or `rg` — under every grammar
 * the name may be, so a path ANY of them would search is named and a recursion any of them would do counts.
 *
 * @param words the segment's words, redirections removed, leading assignments removed, program first
 * @returns the reading, or `undefined` when the program is not a search this module knows
 */
export function searchWords({ words }: { words: readonly string[] }): SearchWords | undefined {
  const program = words[0];
  if (program === undefined) {
    return undefined;
  }
  const binary = program.slice(program.lastIndexOf("/") + 1);
  const grammars = grammarsFor({ binary });
  if (grammars.length === 0) {
    return undefined;
  }
  const readings = grammars.map((grammar) => readUnder({ args: words.slice(1), grammar }));
  const paths = [...new Set(readings.flatMap((reading) => reading.paths))];
  const recursive = readings.some((reading) => reading.recursive);
  return { binary, paths, recursive };
}
