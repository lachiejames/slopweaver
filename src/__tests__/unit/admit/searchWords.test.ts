/**
 * What a `grep`-family or `rg` command line searches: its path operands after the pattern, and whether it
 * recurses — read by each program's own option grammar, so a value word is never mistaken for a root.
 */
import { describe, expect, it } from "vitest";

import { searchWords } from "../../../admit/searchWords.js";

/** Split a command the way the disk-scan gate hands it over: program first, words after. */
function read({ command }: { command: string }): ReturnType<typeof searchWords> {
  return searchWords({ words: command.split(" ") });
}

describe("searchWords", () => {
  it.each([
    { command: "grep -r needle /", paths: ["/"], recursive: true },
    { command: "grep -R needle src lib", paths: ["src", "lib"], recursive: true },
    { command: "grep --recursive needle .", paths: ["."], recursive: true },
    { command: "grep --dereference-recursive needle .", paths: ["."], recursive: true },
    { command: "grep --directories=recurse needle .", paths: ["."], recursive: true },
    { command: "grep -d recurse needle .", paths: ["."], recursive: true },
    { command: "grep -drecurse needle .", paths: ["."], recursive: true },
    { command: "grep -rli needle /etc", paths: ["/etc"], recursive: true },
    { command: "grep needle file.txt", paths: ["file.txt"], recursive: false },
  ])("reads $command", ({ command, paths, recursive }) => {
    expect(read({ command })).toEqual({ binary: "grep", paths, recursive });
  });

  it("reads `recurse` as recursion only as -d or --directories' value, never as a pattern", () => {
    expect(read({ command: "/usr/bin/grep -e recurse /Users/a" })).toEqual({
      binary: "grep",
      paths: ["/Users/a"],
      recursive: false,
    });
    expect(read({ command: "grep --regexp recurse /" })!.recursive).toBe(false);
    expect(read({ command: "grep --directories recurse x /" })!.recursive).toBe(true);
    expect(read({ command: "grep --dir recurse x /" })!.recursive).toBe(true);
    expect(read({ command: "grep -id recurse x /" })!.recursive).toBe(true);
  });

  it("never reads a value-taking option's value as a path", () => {
    expect(read({ command: "grep -A 3 needle file" })!.paths).toEqual(["file"]);
    expect(read({ command: "grep -rA3 needle src" })).toEqual({ binary: "grep", paths: ["src"], recursive: true });
    expect(read({ command: "grep --include *.ts -r needle src" })!.paths).toEqual(["src"]);
    expect(read({ command: "grep --include=*.ts -r needle src" })!.paths).toEqual(["src"]);
  });

  it("reads every positional as a path once -e or -f supplied the pattern", () => {
    expect(read({ command: "grep -e needle -r / src" })!.paths).toEqual(["/", "src"]);
    expect(read({ command: "grep -rlie needle /" })!.paths).toEqual(["/"]);
    expect(read({ command: "grep --regexp needle a b" })!.paths).toEqual(["a", "b"]);
    expect(read({ command: "grep -f patterns.txt a" })!.paths).toEqual(["a"]);
  });

  it("reads ugrep's --and, --andnot and --not as taking a PATTERN, with or without an -e before it", () => {
    // The --and value under the corpus was read as a path and refused a search of stdin.
    expect(read({ command: "ugrep -e needle --and /h/.slopweaver/corpus" })!.paths).toEqual([]);
    expect(read({ command: "ugrep -e foo --and -e bar -" })!.paths).toEqual(["-"]);
    expect(read({ command: "ugrep --andnot bar foo src" })!.paths).toEqual(["foo", "src"]);
    expect(read({ command: "ugrep --not=bar needle src" })!.paths).toEqual(["needle", "src"]);
    expect(read({ command: "rg --and needle src" })!.paths).toEqual(["src"]);
  });

  it("reads no path from a line that only prints help or a version, and never reads grep's -h as help", () => {
    // `--help [WHAT]`'s topic under the corpus was read as a path.
    expect(read({ command: "ugrep -e needle --help /h/.slopweaver/corpus" })!.paths).toEqual([]);
    expect(read({ command: "grep -V /" })!.paths).toEqual([]);
    expect(read({ command: "rg -h /h/.slopweaver/corpus" })!.paths).toEqual([]);
    expect(read({ command: "grep -rh needle /" })!.paths).toEqual(["/"]);
    expect(read({ command: "grep -h needle /h/.slopweaver/corpus" })!.paths).toEqual(["/h/.slopweaver/corpus"]);
    expect(read({ command: "grep -r -- --help /" })!.paths).toEqual(["/"]);
  });

  it("reads a print-and-exit letter inside a cluster, and never a pattern VALUE as one", () => {
    expect(read({ command: "grep -e x -rV /" })!.paths).toEqual([]);
    expect(read({ command: "rg -e x -ih /h/.slopweaver/corpus" })!.paths).toEqual([]);
    expect(read({ command: "grep -e x --vers /" })!.paths).toEqual([]);
    expect(read({ command: "grep -r -e -V /" })!.paths).toEqual(["/"]);
    expect(read({ command: "grep -r --include -V needle /" })!.paths).toEqual(["/"]);
    // rg's own print-and-exit flags, from `rg --help`.
    expect(read({ command: "rg --pcre2-version needle /h/.slopweaver/corpus" })!.paths).toEqual([]);
    expect(read({ command: "rg --type-list needle /" })!.paths).toEqual([]);
    expect(read({ command: "rg --generate man needle /" })!.paths).toEqual([]);
    expect(read({ command: "rg --generate=man needle /" })!.paths).toEqual([]);
    expect(read({ command: "grep --save-config=- needle /h/.slopweaver/corpus/x.jsonl" })!.paths).toEqual([]);
    expect(read({ command: "rg --save-config needle /" })!.paths).toEqual(["/"]);
  });

  it("reads a bare grep as BSD grep too, where -O is a flag, and names nothing BSD grep would refuse", () => {
    expect(read({ command: "/usr/bin/grep -e needle -O /h/.slopweaver/corpus/x.jsonl /dev/null" })!.paths).toEqual([
      "/dev/null",
      "/h/.slopweaver/corpus/x.jsonl",
    ]);
    expect(read({ command: "ugrep -e needle -O /h/.slopweaver/corpus/x.jsonl src" })!.paths).toEqual(["src"]);
    // `--colo` resolves under BSD's getopt_long, its two spellings one option: `--colo sh /etc/shells` counts 9.
    expect(read({ command: "grep --colo needle /h/.slopweaver/corpus" })!.paths).toEqual(["/h/.slopweaver/corpus"]);
    expect(read({ command: "grep --recur needle /" })).toEqual({ binary: "grep", paths: ["/"], recursive: true });
    // An ambiguous BSD prefix is refused there, and ugrep reads `--line-` as a flag.
    expect(read({ command: "grep -e needle --line- src" })!.paths).toEqual(["src"]);
  });

  it("reads a dash-led operand as a path after --, and a lone - as stdin", () => {
    expect(read({ command: "grep -- -needle -file" })!.paths).toEqual(["-file"]);
    expect(read({ command: "grep needle -" })!.paths).toEqual(["-"]);
  });

  it("names the program's basename whatever directory it was run from", () => {
    expect(read({ command: "/usr/bin/grep -r x /" })!.binary).toBe("grep");
    expect(read({ command: "ugrep -r x /" })!.binary).toBe("ugrep");
  });

  it("reads rg as always recursive, and its -r as --replace with a value", () => {
    expect(read({ command: "rg needle /" })).toEqual({ binary: "rg", paths: ["/"], recursive: true });
    expect(read({ command: "rg -r X needle src" })).toEqual({ binary: "rg", paths: ["src"], recursive: true });
    expect(read({ command: "rg -g *.ts needle src" })!.paths).toEqual(["src"]);
    // An --ignore-file value under the corpus was read as a path and refused a bounded search.
    expect(read({ command: "rg -e needle --ignore-file /h/.slopweaver/corpus/ignore src" })!.paths).toEqual(["src"]);
    expect(read({ command: "rg -e needle --hostname-bin /h/.slopweaver/corpus/h README.md" })!.paths).toEqual([
      "README.md",
    ]);
    expect(read({ command: "grep -e needle --exclude-from /h/.slopweaver/corpus/x -r src" })!.paths).toEqual(["src"]);
    // A bracketed metavariable (`-K [MIN,][MAX]`) slipped the help regex that built the tables.
    expect(read({ command: "grep -e needle -K /h/.slopweaver/corpus src" })!.paths).toEqual(["src"]);
    expect(read({ command: "grep -e needle --range /h/.slopweaver/corpus src" })!.paths).toEqual(["src"]);
    expect(read({ command: "grep -e needle --depth /h/.slopweaver/corpus -r src" })!.paths).toEqual(["src"]);
    // An EMPTY `--opt=` takes the next word as its value, as ugrep reads it.
    expect(read({ command: "ugrep -e needle --exclude-from= /h/.slopweaver/corpus/x README.md" })!.paths).toEqual([
      "README.md",
    ]);
    // BSD grep's getopt_long reads an unambiguous prefix as the whole option.
    expect(read({ command: "grep -e needle --exclude-d /h/.slopweaver/corpus -r src" })!.paths).toEqual(["src"]);
    expect(read({ command: "grep -e needle --count -r src" })!.paths).toEqual(["src"]);
    expect(read({ command: "ugrep --directories= recurse needle ." })).toEqual({
      binary: "ugrep",
      paths: ["."],
      recursive: true,
    });
    // BSD grep and rg read an empty `--opt=` INLINE, so the next word is the pattern.
    expect(read({ command: "/usr/bin/grep -r --exclude= needle /" })).toEqual({
      binary: "grep",
      paths: ["/"],
      recursive: true,
    });
    expect(read({ command: "rg --glob= needle /" })!.paths).toEqual(["/"]);
  });

  it("reads nothing from a program that is not a search, or from no words at all", () => {
    expect(read({ command: "find / -name x" })).toBeUndefined();
    expect(read({ command: "grepx needle /" })).toBeUndefined();
    expect(searchWords({ words: [] })).toBeUndefined();
  });
});
