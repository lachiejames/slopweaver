/**
 * The option grammars `./searchWords.ts` reads a search's words by — which options each program accepts, which
 * take the next word as a value, and which print and exit — each table read off the program's own help or
 * measured against the binary, with the command that rebuilds it beside it.
 *
 * Pure data and two lookups. The walk that applies them is `./searchWords.ts`.
 */

/** The option tables one program reads by. */
export interface Grammar {
  readonly valueShort: ReadonlySet<string>;
  readonly valueLong: ReadonlySet<string>;
  readonly grepFamily: boolean;
  /** Every option the program accepts, when measured — anything else is refused with usage, reading no file. */
  readonly known?: { readonly short: ReadonlySet<string>; readonly long: readonly string[] };
  /**
   * Whether an EMPTY `--opt=` takes the next word as its value. ugrep's does — `echo foo | grep -e foo
   * --exclude-from= /nonexistent -` fails reading `/nonexistent` — while BSD `grep` and `rg` read an
   * empty value inline: `/usr/bin/grep -c --label= sh /etc/shells` and `rg -c --glob= sh /etc/shells` both print 9
   *.
   */
  readonly emptyValueTakesNext: boolean;
}

/** Programs whose option grammar is `grep`'s — Claude Code's own `grep` is `ugrep` (`../live/machine/runawaySearch.ts`). */
const GREP_FAMILY: ReadonlySet<string> = new Set(["grep", "egrep", "fgrep", "ggrep", "ugrep", "ug"]);

/** Names that are ugrep and nothing else, read by ugrep's table alone. */
const UGREP_ONLY: ReadonlySet<string> = new Set(["ugrep", "ug"]);

/**
 * BSD `grep`'s short options, MEASURED on macOS 2.6.0-FreeBSD, because a bare `grep` may be it rather than
 * Claude Code's ugrep shim, and the two disagree: `-O` is a FLAG here and takes a value in ugrep. Every other letter is refused with usage, reading no file. Repro, one letter per line:
 * `for L in {a..z} {A..Z}; do /usr/bin/grep -$L zzq /dev/null </dev/null; echo "$L $?"; done`.
 */
const BSD_VALUE_SHORT: ReadonlySet<string> = new Set(["A", "B", "C", "D", "d", "e", "f", "m"]);
const BSD_KNOWN_SHORT: ReadonlySet<string> = new Set([
  ...BSD_VALUE_SHORT,
  ...Array.from("0123456789abchilnopqrsuvwxyzEFGHIJLMORSUVXZ"),
]);

/**
 * BSD `grep`'s long options, off `man grep | col -b | grep -oE -- "--[a-z0-9-]+"`. Those that take the next word
 * were measured by count, `/usr/bin/grep -c --label sh /etc/shells </dev/null` printing 0 where a flag prints 9;
 * `--context` and `--colo(u)r` take a value only after `=`.
 */
const BSD_VALUE_LONG: ReadonlySet<string> = new Set([
  "--after-context",
  "--before-context",
  "--binary-files",
  "--devices",
  "--directories",
  "--exclude",
  "--exclude-dir",
  "--file",
  "--include",
  "--include-dir",
  "--label",
  "--max-count",
  "--regexp",
]);
const BSD_KNOWN_LONG: readonly string[] = [
  ...BSD_VALUE_LONG,
  "--basic-regexp",
  "--byte-offset",
  "--bz2decompress",
  "--color",
  "--colour",
  "--context",
  "--count",
  "--decompress",
  "--extended-regexp",
  "--files-with-matches",
  "--files-without-match",
  "--fixed-strings",
  "--help",
  "--ignore-case",
  "--invert-match",
  "--line-buffered",
  "--line-number",
  "--line-regexp",
  "--lzma",
  "--mmap",
  "--no-filename",
  "--no-messages",
  "--null",
  "--null-data",
  "--only-matching",
  "--quiet",
  "--recursive",
  "--silent",
  "--text",
  "--version",
  "--word-regexp",
  "--xz",
];

/**
 * `grep`-family short options that consume a value — GNU grep's plus ugrep's, read off `grep --help` under
 * Claude Code 2.1.310's shim (`grep --help | grep -oE "^ +-[a-zA-Z0-9] [^ ,]+"`, which also catches a bracketed
 * value such as `-K [MIN,][MAX]`). A bare `grep` is also read by BSD's measured
 * table above, so a letter that is a flag THERE still names the word after it as a path.
 */
const GREP_VALUE_SHORT: ReadonlySet<string> = new Set([
  "e",
  "f",
  "m",
  "A",
  "B",
  "C",
  "d",
  "D",
  "g",
  "J",
  "K",
  "M",
  "N",
  "O",
  "t",
]);

/**
 * `grep`-family long options that consume the NEXT word without `=` — every required-value long on an option
 * line, whatever its metavariable: `grep --help | grep -E "^    -" | grep -oE -- "--[a-z0-9-]+="`.
 */
const GREP_VALUE_LONG: ReadonlySet<string> = new Set([
  "--regexp",
  "--file",
  "--max-count",
  "--after-context",
  "--before-context",
  "--context",
  "--devices",
  "--directories",
  "--exclude",
  "--include",
  "--exclude-dir",
  "--include-dir",
  "--label",
  "--binary-files",
  "--group-separator",
  "--colors",
  "--colours",
  "--config",
  "--context-separator",
  "--delay",
  "--depth",
  "--encoding",
  "--exclude-from",
  "--exclude-fs",
  "--file-extension",
  "--file-magic",
  "--file-type",
  "--filter",
  "--filter-magic-label",
  "--format",
  "--from",
  "--glob",
  "--iglob",
  "--include-from",
  "--include-fs",
  "--jobs",
  "--max-files",
  "--max-line",
  "--max-size",
  "--min-count",
  "--min-line",
  "--min-size",
  "--neg-regexp",
  "--range",
  "--replace",
  "--zmax",
]);

/**
 * ugrep's Boolean pattern options, `--and [-e] PATTERN` — the next word is a PATTERN, optionally after an `-e`,
 * and either form supplies the pattern so every positional after is a path. `grep --help | grep -E "^ +--[a-z-]+ \["`
 * prints the three; `echo "foo bar" | grep -e foo --and -e bar -` reads `-` alone.
 */
export const GREP_PATTERN_LONG: ReadonlySet<string> = new Set(["--and", "--andnot", "--not"]);

/** The `grep`-family long options that mean "recurse". */
export const GREP_RECURSIVE_LONG: ReadonlySet<string> = new Set([
  "--recursive",
  "--dereference-recursive",
  "--directories=recurse",
]);

/** `rg` short options that consume a value — `-r` is `--replace` here, never recursion. */
const RG_VALUE_SHORT: ReadonlySet<string> = new Set([
  "e",
  "f",
  "g",
  "t",
  "T",
  "E",
  "j",
  "m",
  "M",
  "A",
  "B",
  "C",
  "d",
  "r",
]);

/**
 * `rg` long options that consume the NEXT word when written without `=` — complete against ripgrep's own help,
 * `rg --help | grep -oE "^ +(-[a-zA-Z] [A-Z]+, )?--[a-z0-9-]+=[A-Z]+"`.
 */
const RG_VALUE_LONG: ReadonlySet<string> = new Set([
  "--regexp",
  "--file",
  "--glob",
  "--iglob",
  "--type",
  "--type-not",
  "--type-add",
  "--encoding",
  "--threads",
  "--max-count",
  "--max-columns",
  "--max-depth",
  "--max-filesize",
  "--after-context",
  "--before-context",
  "--context",
  "--replace",
  "--pre",
  "--pre-glob",
  "--sort",
  "--sortr",
  "--path-separator",
  "--colors",
  "--color",
  "--ignore-file",
  "--type-clear",
  "--engine",
  "--dfa-size-limit",
  "--regex-size-limit",
  "--context-separator",
  "--field-context-separator",
  "--field-match-separator",
  "--hyperlink-format",
  "--generate",
  "--hostname-bin",
]);

/**
 * Options that make every one of these programs print and exit without reading a file — so the rest of the
 * line, `--help [WHAT]`'s topic included, names no path. They are read by the same
 * walk as every other option, so a clustered letter counts — `/usr/bin/grep -e x -rV /` prints its version
 * — and a VALUE never does: `grep -r -e -V /` searches `/` for `-V`. `-h` is `rg`'s alone: in
 * the `grep` family it is `--no-filename`. Built from each program's help, `ugrep --help | grep -B3 exit` and
 * `rg --help | grep -B3 "then exit\|then quit"` — `rg --type-list needle /nonexistent` lists types and exits 0.
 * ugrep's `--save-config[=FILE]` writes its configuration and exits. This set is the claim, and
 * it is ENUMERATED: ugrep's value-borne `-t list` is outside it, so a line using it is read as a search.
 */
const GREP_PRINT_AND_EXIT_LONG: readonly string[] = ["--help", "--version", "--save-config"];
const RG_PRINT_AND_EXIT_LONG: readonly string[] = [
  "--help",
  "--version",
  "--pcre2-version",
  "--type-list",
  "--generate",
];
const PRINT_AND_EXIT_SHORT: ReadonlySet<string> = new Set(["V", "?"]);

/**
 * Whether one short option letter prints and exits under this program's grammar.
 *
 * @returns true for `-V` and `-?` everywhere, and `rg`'s `-h`
 */
export function shortPrintsAndExits({ grammar, letter }: { grammar: Grammar; letter: string }): boolean {
  return PRINT_AND_EXIT_SHORT.has(letter) || (!grammar.grepFamily && letter === "h");
}

/**
 * Whether one long option name prints and exits — a `grep`-family unambiguous prefix included.
 *
 * @returns true when the program prints and exits on reading this option
 */
export function longPrintsAndExits({ grammar, name }: { grammar: Grammar; name: string }): boolean {
  const longs = grammar.grepFamily ? GREP_PRINT_AND_EXIT_LONG : RG_PRINT_AND_EXIT_LONG;
  return longs.some((long) => long === name || (grammar.grepFamily && name.length > 3 && long.startsWith(name)));
}

/**
 * Every option grammar a program name may be read by. A bare `grep` is Claude Code's ugrep shim in its own Bash
 * tool and BSD `grep` anywhere else, so it is read BOTH ways.
 *
 * @param binary the program's basename
 * @returns the grammars, empty when the program is not a search this module knows
 */
export function grammarsFor({ binary }: { binary: string }): readonly Grammar[] {
  const ugrep: Grammar = {
    emptyValueTakesNext: true,
    grepFamily: true,
    valueLong: GREP_VALUE_LONG,
    valueShort: GREP_VALUE_SHORT,
  };
  if (UGREP_ONLY.has(binary)) {
    return [ugrep];
  }
  if (GREP_FAMILY.has(binary)) {
    const bsd: Grammar = {
      emptyValueTakesNext: false,
      grepFamily: true,
      known: { long: BSD_KNOWN_LONG, short: BSD_KNOWN_SHORT },
      valueLong: BSD_VALUE_LONG,
      valueShort: BSD_VALUE_SHORT,
    };
    return [ugrep, bsd];
  }
  if (binary === "rg") {
    return [{ emptyValueTakesNext: false, grepFamily: false, valueLong: RG_VALUE_LONG, valueShort: RG_VALUE_SHORT }];
  }
  return [];
}
