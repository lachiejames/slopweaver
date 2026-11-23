/**
 * The escape-hatch rows for the SCOPE of a command a session runs — a disk-wide scan, an unbounded search,
 * an implicit git operation under the state home, and a whole-tree check that belongs to CI.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position. Add a row for a
 * new command-scope refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on a command's scope, in register order. */
export const COMMAND_SCOPE_HATCHES = [
  {
    caught:
      "this walks the whole filesystem or the whole home directory, which is minutes of every core rather than a read — and it is almost always a seat hunting for a file a brief named relatively, where the answer is under $SLOPWEAVER_HOME and one `ls` away",
    command: "a find or bfs rooted at / or $HOME",
    exceptions: [
      "you are genuinely auditing the whole disk — a duplicate hunt, a stray-worktree sweep — and have said so",
      "the scan is already bounded by something this gate cannot read, such as -prune or -xdev",
      "you have already tried the state home and the repository and the file is provably in neither",
    ],
    id: "disk-wide-scan",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_DISK_WIDE_SCAN" },
    lane: "ambient",
    reader: "src/admit/diskScan.ts",
    standing: "proposed",
  },
  {
    caught:
      "this greps inside the corpus, whose bronze compact.jsonl files run to 17.5 GB each, or recurses a grep from / or the home — six such searches from one seat's sub-agents held the owner's machine at 0% idle for an hour and dropped the console call",
    command: "a grep or rg inside $SLOPWEAVER_HOME/corpus, or a recursive grep from / or $HOME",
    exceptions: [
      "the file you are searching is one you know is small, such as a watermark or a manifest, and no store verb reads it",
      "you are measuring the store verb against a raw search once, as its parity check, with a timeout bounding it",
      "you are diagnosing the corpus files themselves — a corrupt line, an encoding fault — and have said so",
    ],
    id: "unbounded-search",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNBOUNDED_SEARCH" },
    lane: "ambient",
    reader: "src/admit/diskScan.ts",
    standing: "proposed",
  },
  {
    caught:
      "this git names no repository and its directory sits inside $SLOPWEAVER_HOME, which is itself a git checkout of the state repository — so a fetch, pull or origin/… read answers about THAT repository's main, not the one you mean (a handoff graded slopweaver's main as moved off the state repository's c77e0fdd, twice)",
    command: "a bare git fetch, pull, merge, rebase, push, ls-remote or origin/… read under $SLOPWEAVER_HOME",
    exceptions: [
      "you are deliberately working on the state repository itself and cannot spell the home as a literal -C path",
      "the git is already aimed at another repository by something this gate cannot read, such as a GIT_DIR exported by an earlier tool call in the same shell",
    ],
    id: "home-git-implicit",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_HOME_GIT_IMPLICIT" },
    lane: "ambient",
    reader: "src/admit/homeGitGuard.ts",
    standing: "proposed",
  },
  {
    caught:
      "this re-proves the whole tree — it builds the TypeScript type checker over it, runs a whole test lane, or re-checks the whole tree's format or dependency graph, and tsgolint, tsc, vitest, prettier and knip each hold several cores for minutes — and that is CI's lane, never a seat's: a gate runs on this machine only when CI cannot see its subject",
    command: "a whole-tree lint lap, type-aware oxlint, tsc, a whole test lane, a whole-tree prettier check or knip",
    exceptions: [
      "CI is down or cannot run the lap at all, and you have said so",
      "you are measuring the lap itself — its wall time, its heap, a gate's cost — and the number is the deliverable",
      "the owner asked for a local lap in this session",
    ],
    id: "whole-tree-check",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_WHOLE_TREE_CHECK" },
    lane: "ambient",
    reader: "src/admit/wholeTreeCheck.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
