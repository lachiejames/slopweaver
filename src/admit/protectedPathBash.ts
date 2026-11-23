/**
 * Refuses a `Bash` command that would write into an owner-protected path, or name a `no-access` one at all — the
 * `Bash` half of the protected-path tripwire (`./protectedPathGuard.ts` is the file-tool half). Pure, no I/O: the
 * registry's entries are handed in, and no path is named in this file or any other in the repository.
 *
 * ## The criterion, per command segment
 *
 * - **Every protected path, `read-only` included — a write.** What the call-state guard refuses as destruction
 *   (`./callStateGuard.ts`'s `evaluateDestructiveReach`: a remover, a mover, a copy's destination, `tee`, an in-place
 *   edit, `find -delete`, a git clean or discard, a truncating `>`), plus what `./protectedPathWrites.ts` reads as a
 *   write: every redirection that writes (`>>`, `&>>`, `<>`), the operands of a program that creates or re-modes what
 *   it names (`touch`, `mkdir`, `chmod`…), a copier's destination, and a `git` command that is not a read, run in a
 *   protected path (`cd <it> && git commit`, `git -C <it> add .`).
 * - **A `no-access` path — any mention.** A word the command names, or a redirection's file, at or under it, or a
 *   segment that runs inside it. A word naming an ANCESTOR is not a mention (`ls ~` is no read of what is under it),
 *   which is the largest residue below.
 *
 * Words are read exactly as the call-state guard reads an operand — a leading `~`, `$HOME`, `$SLOPWEAVER_HOME` or
 * `$PWD` expanded, a glob matched component by component, case folded — under each environment the command's own
 * assignments can leave, from each directory its `cd`s land in. A redirection is read from that directory; a
 * program's words also from where a wrapper's chdir (`env -C`) moves it, and a `git`'s from where its `-C`s do. Each
 * `-C` is read once, by `./protectedPathWrites.ts`, from the shell's own directory (`MainCheckoutCommandTarget.shellCwd`).
 *
 * ## A tripwire, not a fence
 *
 * Every session runs as the owner's own user, so nothing here is an operating-system boundary. Not judged: a reader
 * that recurses from an ancestor (`grep -r x ~`, `find ~`), an interpreter's -c or a nested shell (`sh -c`), a
 * variable or command substitution this cannot expand, `xargs`, a symlink or hard link reaching the path by another
 * name (a `..` collapses lexically, so `git -C link/..` is judged where the spelling points, not where git's physical
 * `chdir` lands), a `git --git-dir`/`--work-tree`, and everything `./callStateGuard.ts` lists as its own residue. Its
 * silence proves nothing.
 */
import { isAtOrUnder } from "../protectedPaths/decide.js";
import type { ProtectedPath } from "../protectedPaths/registry.js";
import { commandPieces, programName, unhatchedPieces } from "./callStateArgs.js";
import { evaluateDestructiveReach } from "./callStateGuard.js";
import { judgedText } from "./callStateJudgedText.js";
import { globComponentMatches } from "./globComponent.js";
import { homeCdTarget } from "./homeCdTarget.js";
import {
  hasSegmentInlineEnvironmentOverride,
  type MainCheckoutCommandTarget,
  resolveMainCheckoutCommandTargets,
} from "./mainCheckoutCommandTarget.js";
import { absolutePatterns, piecePlace, pieceWrites } from "./protectedPathWrites.js";
import { assignedEnvironments } from "./shellAssignments.js";
import { redirectionTargets } from "./shellFileRedirections.js";
import { type ShellWord, shellWords, splitOperators, withoutRedirections } from "./shellLexing.js";
import { programAt } from "./wrappedProgram.js";

/** The ambient hatch this tripwire is opened with — declared as `protected-path` in `../hatch/toolAdmissionHatches.ts`. */
export const PROTECTED_PATH_HATCH = "SLOPWEAVER_ALLOW_PROTECTED_PATH";

/** One refused segment. */
export interface ProtectedPathBashHit {
  /** The segment's own text. */
  readonly segment: string;
  /** What it names, as resolved — or the directory it runs in. */
  readonly operand: string;
  /** The entry it reaches. */
  readonly entry: ProtectedPath;
  /** Whether it was refused as a write or as a read of a `no-access` path. */
  readonly access: "read" | "write";
}

/**
 * Whether an absolute operand pattern names the target or something under it — never an ancestor of it. A whole `**`
 * component matches any number of them.
 */
function patternWithin({ ours, theirs }: { ours: readonly string[]; theirs: readonly string[] }): boolean {
  const [pattern, ...below] = ours;
  const [name, ...under] = theirs;
  if (name === undefined) {
    return true;
  }
  if (pattern === undefined) {
    return false;
  }
  if (pattern === "**") {
    return patternWithin({ ours: below, theirs }) || patternWithin({ ours, theirs: under });
  }
  return globComponentMatches({ name, pattern }) && patternWithin({ ours: below, theirs: under });
}

/** The parts of an absolute path, case folded. */
function partsOf({ path }: { path: string }): readonly string[] {
  return path
    .normalize("NFC")
    .toLowerCase()
    .split("/")
    .filter((part) => part !== "");
}

/** The first entry an absolute operand pattern names, at or under. */
function entryNamed({
  operand,
  entries,
}: {
  operand: string;
  entries: readonly ProtectedPath[];
}): ProtectedPath | undefined {
  return entries.find((entry) =>
    patternWithin({ ours: partsOf({ path: operand }), theirs: partsOf({ path: entry.path }) }),
  );
}

/** Whether one simple command is `slopweaver protect …`, which names a protected path because that is its job. */
function isProtectVerb({ piece }: { piece: readonly ShellWord[] }): boolean {
  const run = programAt({ words: withoutRedirections({ words: piece }) });
  if (run.at === undefined) {
    return false;
  }
  return programName({ text: run.words[run.at]!.text }) === "slopweaver" && run.words[run.at + 1]?.text === "protect";
}

/** The first hit in one segment, written or named, from the pieces no inline hatch arms. */
function segmentHit({
  line,
  target,
  env,
  entries,
}: {
  line: string;
  target: MainCheckoutCommandTarget;
  env: Readonly<Record<string, string | undefined>>;
  entries: readonly ProtectedPath[];
}): ProtectedPathBashHit | undefined {
  const { cwd } = target;
  const segment = target.command.trim();
  const noAccess = entries.filter((entry) => entry.mode === "no-access");
  const insideNoAccess =
    cwd === undefined ? undefined : noAccess.find((entry) => isAtOrUnder({ path: cwd, root: entry.path }));
  if (insideNoAccess !== undefined) {
    return { access: "read", entry: insideNoAccess, operand: cwd!, segment };
  }
  const lexed = shellWords({ text: target.command });
  if (lexed.unterminated) {
    return undefined;
  }
  const hatched = hasSegmentInlineEnvironmentOverride({
    command: line,
    name: PROTECTED_PATH_HATCH,
    segmentIndex: target.segmentIndex,
  });
  const pieces = unhatchedPieces({
    hatched,
    name: PROTECTED_PATH_HATCH,
    pieces: commandPieces({ words: splitOperators({ words: lexed.words }) }),
  });
  for (const piece of pieces) {
    const hit = pieceHit({ entries, env, noAccess, piece, segment, shellCwd: target.shellCwd });
    if (hit !== undefined) {
      return hit;
    }
  }
  return undefined;
}

/**
 * The first hit in one simple command, judged from where the SHELL stands: a redirection opens there before any
 * wrapper's chdir or `git -C` runs, and `pieceWrites`/`piecePlace` read those moves themselves, so handing them a
 * directory one `-C` already moved would climb twice. A program's own words are read from the directory it runs in
 * as well (`env -C <dir> cat x`), a `git`'s from its `-C` directory too (a pathspec is git's), and a program run
 * inside a `no-access` path is a read of it.
 */
function pieceHit({
  piece,
  shellCwd,
  env,
  entries,
  noAccess,
  segment,
}: {
  piece: readonly ShellWord[];
  shellCwd: string | undefined;
  env: Readonly<Record<string, string | undefined>>;
  entries: readonly ProtectedPath[];
  noAccess: readonly ProtectedPath[];
  segment: string;
}): ProtectedPathBashHit | undefined {
  for (const operand of pieceWrites({ cwd: shellCwd, env, piece })) {
    const entry = entryNamed({ entries, operand });
    if (entry !== undefined) {
      return { access: "write", entry, operand, segment };
    }
  }
  if (isProtectVerb({ piece })) {
    // `slopweaver protect add|remove|check <path>` is the door that names a protected path on purpose.
    return undefined;
  }
  const { dir, gitDir } = piecePlace({ cwd: shellCwd, env, piece });
  for (const ran of [dir, gitDir]) {
    const inside =
      ran === undefined ? undefined : noAccess.find((entry) => isAtOrUnder({ path: ran, root: entry.path }));
    if (inside !== undefined) {
      return { access: "read", entry: inside, operand: ran!, segment };
    }
  }
  const words = withoutRedirections({ words: piece });
  // The program's own words, from the shell's directory (an unknown one still judges an absolute word) and from each
  // known directory its wrapper or git moves it to.
  const moved = [...new Set([dir, gitDir])].filter((from): from is string => from !== undefined && from !== shellCwd);
  const named = [
    ...absolutePatterns({
      cwd: shellCwd,
      env,
      words: [...words, ...redirectionTargets({ words: piece, writing: false })],
    }),
    ...moved.flatMap((from) => absolutePatterns({ cwd: from, env, words })),
  ];
  for (const operand of named) {
    const entry = entryNamed({ entries: noAccess, operand });
    if (entry !== undefined) {
      return { access: "read", entry, operand, segment };
    }
  }
  return undefined;
}

/**
 * The first segment of a `Bash` command that would write into a protected path or name a `no-access` one.
 *
 * @param command the raw `Bash` command
 * @param cwd the directory the tool call runs in
 * @param entries the registry's entries, the registry file itself among them
 * @param env the environment a leading variable in a word is expanded from
 * @returns the refused segment, or `undefined` to allow
 */
export function evaluateProtectedPathBash({
  command,
  cwd,
  entries,
  env,
}: {
  command: string;
  cwd: string;
  entries: readonly ProtectedPath[];
  env: Readonly<Record<string, string | undefined>>;
}): ProtectedPathBashHit | undefined {
  if (entries.length === 0) {
    return undefined;
  }
  const paths = entries.map((entry) => entry.path);
  const destroyed = evaluateDestructiveReach({
    command,
    cwd,
    env,
    hatchName: PROTECTED_PATH_HATCH,
    homes: paths,
    protectedPaths: paths,
  });
  if (destroyed !== undefined) {
    const entry = entries.find((candidate) => isAtOrUnder({ path: destroyed.protectedPath, root: candidate.path }))!;
    return { access: "write", entry, operand: destroyed.operand, segment: destroyed.segment };
  }
  const text = judgedText({ command });
  for (const assigned of assignedEnvironments({ command: text, env })) {
    const targets = resolveMainCheckoutCommandTargets({
      cdPath: assigned["CDPATH"],
      command: text,
      cwd,
      expandCdTarget: (token) => homeCdTarget({ env: assigned, token }),
    });
    for (const target of targets) {
      const hit = segmentHit({ entries, env: assigned, line: text, target });
      if (hit !== undefined) {
        return hit;
      }
    }
  }
  return undefined;
}
