/**
 * The reader criterion: which `find` / `bfs` commands walk the whole machine or the whole home — and
 * which searches read the corpus or recurse from a whole-world root.
 *
 * Every table is a declared REGISTRY guarded by a non-empty assertion, per `.claude/rules/testing.md` —
 * `filter(bad).toEqual([])` and every loop body below are equally true of an empty list.
 */
import { describe, expect, it } from "vitest";

import { classifyDiskScan, expandHomeOperand } from "../../../admit/diskScan.js";

/** The home directory every case below is judged against. */
const HOME = "/Users/someone";

/** The state home every case below is judged against. */
const STATE = `${HOME}/.slopweaver`;

/** What every case is judged against unless it says otherwise: no cwd, no ambient hatch. */
const BASE = { cwd: undefined, env: {}, homeDir: HOME, stateHome: STATE } as const;

/** The incident's own corpus file, by its absolute path. */
const SLACK_BRONZE = `${STATE}/corpus/bronze/slack/compact.jsonl`;

/** Searches that must be refused, each with the target and scope the gate should name. */
const SEARCH_REFUSED: readonly {
  readonly command: string;
  readonly binary: string;
  readonly target: string;
  readonly scope: "corpus" | "home";
}[] = [
  { binary: "grep", command: `grep -c nonconformity ${SLACK_BRONZE}`, scope: "corpus", target: SLACK_BRONZE },
  {
    binary: "grep",
    command: `SLOPWEAVER_ALLOW_POLL=1 /usr/bin/grep -o -E ".{0,300}(audit|nc).{0,400}" ${SLACK_BRONZE}`,
    scope: "corpus",
    target: SLACK_BRONZE,
  },
  {
    binary: "grep",
    command: "grep -rli nonconform $SLOPWEAVER_HOME/corpus/bronze --exclude=compact.jsonl",
    scope: "corpus",
    target: `${STATE}/corpus/bronze`,
  },
  {
    binary: "grep",
    command: 'grep -c x "${SLOPWEAVER_HOME}/corpus/bronze/github/compact.jsonl"',
    scope: "corpus",
    target: `${STATE}/corpus/bronze/github/compact.jsonl`,
  },
  { binary: "ugrep", command: "ugrep -i x ~/.slopweaver/corpus", scope: "corpus", target: `${STATE}/corpus` },
  { binary: "rg", command: `rg -c x ${SLACK_BRONZE}`, scope: "corpus", target: SLACK_BRONZE },
  { binary: "grep", command: `grep -e x -e y ${SLACK_BRONZE}`, scope: "corpus", target: SLACK_BRONZE },
  { binary: "grep", command: `cat /dev/null && grep -A 3 x ${SLACK_BRONZE}`, scope: "corpus", target: SLACK_BRONZE },
  { binary: "grep", command: "grep -r password ~", scope: "home", target: HOME },
  { binary: "grep", command: "grep -R x /", scope: "home", target: "/" },
  { binary: "grep", command: "grep --recursive x /Users", scope: "home", target: "/Users" },
  { binary: "grep", command: "grep -d recurse x $HOME", scope: "home", target: HOME },
  { binary: "grep", command: "grep -rA3 x $SLOPWEAVER_HOME", scope: "home", target: STATE },
  { binary: "egrep", command: "egrep -ril x /home", scope: "home", target: "/home" },
  // An absolute operand is normalised, so a doubled separator or a dot segment is the same path.
  { binary: "rg", command: "rg x $SLOPWEAVER_HOME//corpus/bronze", scope: "corpus", target: `${STATE}/corpus/bronze` },
  { binary: "grep", command: `grep x ${STATE}/./corpus/x`, scope: "corpus", target: `${STATE}/corpus/x` },
  { binary: "grep", command: "grep -r x //", scope: "home", target: "/" },
  // A known variable expands wherever it sits in an unquoted or double-quoted word.
  { binary: "grep", command: "grep x /$SLOPWEAVER_HOME/corpus/x", scope: "corpus", target: `${STATE}/corpus/x` },
  { binary: "grep", command: 'grep -r x "/${HOME}"', scope: "home", target: HOME },
  // A redirection glued to the operand is cut off it, so the operand is still the root.
  { binary: "grep", command: "grep -r needle />/tmp/results", scope: "home", target: "/" },
  { binary: "grep", command: "grep -rn x ~ 2>/dev/null", scope: "home", target: HOME },
  { binary: "rg", command: `rg -c x ${SLACK_BRONZE}>out`, scope: "corpus", target: SLACK_BRONZE },
];

/** Searches that must pass — each one is a shape the gate would be WRONG to refuse. */
const SEARCH_ALLOWED: readonly string[] = [
  "grep -rn runawaySearch src",
  "grep -r x ~/dev/personal/slopweaver",
  // A quoted `~` is a literal directory name, never the home directory.
  "grep -r x '~/.slopweaver/corpus'",
  'grep -r x "~"',
  // A single-quoted or escaped `$` is a literal directory name, never the variable.
  "grep x '$SLOPWEAVER_HOME/corpus'",
  "grep -r x \\$HOME",
  "grep -r x /'$HOME'",
  "grep -r x $HOMEBREW_PREFIX",
  `grep -r x ${STATE}/handovers`,
  "grep x /etc/hosts",
  "grep -r / src",
  "grep -r -e / src",
  "grep -A 3 x README.md",
  "grep -rn x src>/tmp/out",
  `tail -n0 -F ${STATE}/listener/logs/f5627195.err | grep -E --line-buffered "error|warn"`,
  "rg x /",
  "rg -r replacement x ~",
  "rg --files /",
  "grep x ~",
  `echo ${SLACK_BRONZE} | grep corpus`,
  `slopweaver store read question --search nonconformity --contains ${SLACK_BRONZE}`,
  `SLOPWEAVER_ALLOW_UNBOUNDED_SEARCH=1 grep -c x ${SLACK_BRONZE}`,
  "SLOPWEAVER_ALLOW_UNBOUNDED_SEARCH=1 grep -r x ~",
];

/** Commands that must be refused, each with the root the gate should name. */
const REFUSED: readonly { readonly command: string; readonly root: string; readonly binary: string }[] = [
  { binary: "find", command: "find /", root: "/" },
  { binary: "find", command: "find / -name owner-turn-291-18-images", root: "/" },
  { binary: "find", command: "find -L / -name x", root: "/" },
  { binary: "find", command: 'find "$HOME" -name x', root: HOME },
  { binary: "find", command: "find $HOME -type f", root: HOME },
  { binary: "find", command: "find ${HOME} -type f", root: HOME },
  { binary: "find", command: "find ~ -name x", root: HOME },
  { binary: "find", command: "find ~/ -name x", root: HOME },
  { binary: "find", command: "find /Users -name x", root: "/Users" },
  { binary: "find", command: "find /home -name x", root: "/home" },
  { binary: "bfs", command: "bfs / -name owner-turn-291-18-images", root: "/" },
  { binary: "find", command: "cd /tmp && find / -name x", root: "/" },
  { binary: "find", command: "find / -maxdepth 3 -name x", root: "/" },
  { binary: "find", command: "find / -maxdepth deep -name x", root: "/" },
  { binary: "find", command: "/usr/bin/find / -name x", root: "/" },
  { binary: "find", command: "find / -name x | head -5", root: "/" },
];

/** Commands that must pass — each one is a shape the gate would be WRONG to refuse. */
const ALLOWED: readonly string[] = [
  "find . -name x",
  "find src -name x",
  'find "$HOME/dev/personal/slopweaver" -name x',
  "find ~/dev -name x",
  "find /Users/someone/.slopweaver/pages -name x",
  "find /Users/someone/.slopweaver -name x",
  "find / -maxdepth 1",
  "find / -maxdepth 2 -name x",
  "bfs / -maxdepth 2 -name x",
  "find -name x",
  "echo find /",
  "grep find /etc/hosts",
  "rg --files /",
  "rg --files ~/dev -g '*owner-turn-291-18-images*'",
  "du -sh /",
  "ls -R /",
];

describe("classifyDiskScan", () => {
  it("has cases to judge", () => {
    expect(REFUSED.length).toBeGreaterThan(0);
    expect(ALLOWED.length).toBeGreaterThan(0);
  });

  it.each(REFUSED)("refuses $command, naming $root", ({ command, root, binary }) => {
    expect(classifyDiskScan({ command, ...BASE })).toEqual({ binary, kind: "scan", root });
  });

  it.each(ALLOWED.map((command) => ({ command })))("allows $command", ({ command }) => {
    expect(classifyDiskScan({ command, ...BASE })).toEqual({ kind: "not-scan" });
  });

  it("reads -maxdepth on BOTH sides of the boundary", () => {
    expect(classifyDiskScan({ command: "find / -maxdepth 2 -name x", ...BASE })).toEqual({ kind: "not-scan" });
    expect(classifyDiskScan({ command: "find / -maxdepth 3 -name x", ...BASE })).toEqual({
      binary: "find",
      kind: "scan",
      root: "/",
    });
  });

  it("does not read a find primary's argument as a path to scan", () => {
    expect(classifyDiskScan({ command: "find -name /", ...BASE })).toEqual({ kind: "not-scan" });
  });
});

describe("classifyDiskScan — the search row", () => {
  it("has cases to judge", () => {
    expect(SEARCH_REFUSED.length).toBeGreaterThan(0);
    expect(SEARCH_ALLOWED.length).toBeGreaterThan(0);
  });

  it.each(SEARCH_REFUSED)("refuses $command, naming $target", ({ command, binary, target, scope }) => {
    expect(classifyDiskScan({ command, ...BASE })).toEqual({
      binary,
      kind: "search",
      scope,
      target,
    });
  });

  it.each(SEARCH_ALLOWED.map((command) => ({ command })))("allows $command", ({ command }) => {
    expect(classifyDiskScan({ command, ...BASE })).toEqual({ kind: "not-scan" });
  });

  it("opens a hatch for its own segment only, never the next one", () => {
    const command = `SLOPWEAVER_ALLOW_UNBOUNDED_SEARCH=1 grep -c x ${SLACK_BRONZE}; grep -r y ~`;
    expect(classifyDiskScan({ command, ...BASE })).toEqual({
      binary: "grep",
      kind: "search",
      scope: "home",
      target: HOME,
    });
  });

  it("opens the scanner row by its own inline hatch, which the hook's environment never carried", () => {
    expect(classifyDiskScan({ command: "SLOPWEAVER_ALLOW_DISK_WIDE_SCAN=1 find / -name x", ...BASE })).toEqual({
      kind: "not-scan",
    });
  });

  it("resolves a relative operand against the payload's cwd, and leaves it alone with none", () => {
    const command = "grep -c x bronze/slack/compact.jsonl";
    expect(classifyDiskScan({ ...BASE, command, cwd: `${STATE}/corpus` })).toEqual({
      binary: "grep",
      kind: "search",
      scope: "corpus",
      target: SLACK_BRONZE,
    });
    expect(classifyDiskScan({ ...BASE, command })).toEqual({ kind: "not-scan" });
  });

  it("reads a recursive search with no path as walking its cwd, unless it reads a pipe", () => {
    expect(classifyDiskScan({ ...BASE, command: "grep -r x", cwd: HOME })).toEqual({
      binary: "grep",
      kind: "search",
      scope: "home",
      target: HOME,
    });
    expect(classifyDiskScan({ ...BASE, command: "rg x", cwd: `${STATE}/corpus/bronze` })).toEqual({
      binary: "rg",
      kind: "search",
      scope: "corpus",
      target: `${STATE}/corpus/bronze`,
    });
    expect(classifyDiskScan({ ...BASE, command: "cat notes.txt | grep -r x", cwd: HOME })).toEqual({
      kind: "not-scan",
    });
  });

  it("keeps a sibling of the corpus outside it", () => {
    expect(classifyDiskScan({ ...BASE, command: `grep -c x ${STATE}/corpus-old/a.jsonl` })).toEqual({
      kind: "not-scan",
    });
  });

  it("opens each row by its own AMBIENT hatch only", () => {
    const corpus = `grep -c x ${SLACK_BRONZE}`;
    expect(classifyDiskScan({ ...BASE, command: corpus, env: { SLOPWEAVER_ALLOW_UNBOUNDED_SEARCH: "1" } })).toEqual({
      kind: "not-scan",
    });
    expect(
      classifyDiskScan({
        ...BASE,
        command: `find / -name x; ${corpus}`,
        env: { SLOPWEAVER_ALLOW_DISK_WIDE_SCAN: "1" },
      }),
    ).toEqual({ binary: "grep", kind: "search", scope: "corpus", target: SLACK_BRONZE });
  });

  it("does not let one row's hatch open the other", () => {
    expect(classifyDiskScan({ command: `SLOPWEAVER_ALLOW_DISK_WIDE_SCAN=1 grep x ${SLACK_BRONZE}`, ...BASE })).toEqual({
      binary: "grep",
      kind: "search",
      scope: "corpus",
      target: SLACK_BRONZE,
    });
  });
});

describe("expandHomeOperand", () => {
  it.each([
    { expanded: HOME, operand: "~" },
    { expanded: HOME, operand: "~/" },
    { expanded: `${HOME}/dev`, operand: "~/dev" },
    { expanded: HOME, operand: "$HOME" },
    { expanded: HOME, operand: "${HOME}" },
    { expanded: `${HOME}/dev`, operand: "$HOME/dev" },
    { expanded: `${HOME}/dev`, operand: "${HOME}/dev" },
    { expanded: "/", operand: "/" },
    { expanded: "/Users", operand: "/Users/" },
    { expanded: "src", operand: "src/" },
  ])("expands $operand to $expanded", ({ operand, expanded }) => {
    expect(expandHomeOperand({ homeDir: HOME, operand })).toBe(expanded);
  });
});
