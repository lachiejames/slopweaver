/**
 * What one simple `Bash` command WRITES, as absolute path patterns — the write half of the protected-path tripwire's
 * `Bash` criterion (`./protectedPathBash.ts` decides what a write or a mention reaches). Pure, no I/O.
 *
 * A write is a writing redirection (`>`, `>>`, `&>>`, `<>`), every operand of a program that creates or re-modes what
 * it names (`touch`, `mkdir`, `chmod`, `tee`…), a copier's destination whatever its flags say (`cp -n` and a `-t`
 * directory included), `dd of=`, and the directory a `git` command acts in when its subcommand is not a known read
 * (`git -C <dir> add .`). Words are read exactly as the call-state guard reads an operand (`./callStateGuard.ts`'s
 * `operandPattern`): a leading `~`, `$HOME`, `$SLOPWEAVER_HOME` or `$PWD` expanded — a redirection's from where the
 * shell stands, a program's from where its wrappers' chdir (`env -C`, `sudo -D`) moves it, a `git`'s from each of its
 * `-C`s in turn, read here once.
 */
import { resolve } from "node:path";

import { isOption, opensOnUnknownExpansion, programName } from "./callStateArgs.js";
import { operandPattern } from "./callStateGuard.js";
import { redirectionTargets } from "./shellFileRedirections.js";
import { type ShellWord, withoutRedirections } from "./shellLexing.js";
import { programAt, wrapperChdir } from "./wrappedProgram.js";

/**
 * Programs that write, create, or change the mode, owner or flags of, every operand they name — `tee` among them
 * because the call-state grammar skips an appending `tee -a`, which still writes.
 */
const CREATORS: ReadonlySet<string> = new Set(["touch", "mkdir", "chmod", "chown", "chgrp", "chflags", "xattr", "tee"]);

/**
 * Programs that write their DESTINATION — its `-t` directory, else the last operand — whatever their flags say. The
 * call-state grammar models destruction, so it skips a destination nothing existing is lost at (`cp -n`, a new file);
 * a read-only path is written all the same.
 */
const COPIERS: ReadonlySet<string> = new Set(["cp", "mv", "ln", "install", "rsync", "ditto"]);

/** `git` subcommands that only read the repository; any other is judged a write. */
const GIT_READS: ReadonlySet<string> = new Set([
  "blame",
  "cat-file",
  "check-attr",
  "check-ignore",
  "count-objects",
  "describe",
  "diff",
  "for-each-ref",
  "grep",
  "help",
  "log",
  "ls-files",
  "ls-tree",
  "merge-base",
  "name-rev",
  "rev-list",
  "rev-parse",
  "shortlog",
  "show",
  "show-ref",
  "status",
  "version",
  "whatchanged",
]);

/** `git` subcommands that LIST when given no operand, and write when given one (`git branch x`). */
const GIT_LISTS_BARE: ReadonlySet<string> = new Set(["branch", "remote", "stash", "tag"]);

/**
 * Each word as an absolute path pattern from the segment's directory, dropping one this cannot read.
 *
 * @param words the shell words to resolve
 * @param cwd the segment's directory, when its `cd`s leave one known
 * @param env the environment a leading variable in a word is expanded from
 * @returns the absolute patterns, one per word this could read
 */
export function absolutePatterns({
  words,
  cwd,
  env,
}: {
  words: readonly ShellWord[];
  cwd: string | undefined;
  env: Readonly<Record<string, string | undefined>>;
}): readonly string[] {
  return words.flatMap((word) => {
    const pattern = operandPattern({ cwd, env, oldPwd: undefined, word });
    if (pattern === undefined || (cwd === undefined && !pattern.startsWith("/"))) {
      return [];
    }
    return [cwd === undefined ? resolve(pattern) : resolve(cwd, pattern)];
  });
}

/**
 * The directory a `git` command acts in — each `-C <dir>` applied in turn, from the SHELL's directory — and its
 * subcommand's index. This is the one read of a `git`'s `-C` here, wrapped or not, so the caller hands in the
 * directory before any `-C` (`MainCheckoutCommandTarget.shellCwd`): given one a `-C` already moved, a relative value
 * climbs twice (`git -C .. add .` from `<protected>/sub` read `<protected>/..`).
 */
function gitPlace({
  args,
  cwd,
  env,
}: {
  args: readonly ShellWord[];
  cwd: string | undefined;
  env: Readonly<Record<string, string | undefined>>;
}): {
  dir: string | undefined;
  at: number;
} {
  let dir = cwd;
  let at = 0;
  while (at < args.length && isOption({ word: args[at]! })) {
    const option = args[at]!.text;
    if (option === "-C" && args[at + 1] !== undefined) {
      // Expanded as the shell would (`~`, `$HOME`), from the directory so far — one this cannot read leaves it unknown.
      dir = absolutePatterns({ cwd: dir, env, words: [args[at + 1]!] })[0];
      at += 2;
    } else {
      at += /^(?:-c|--git-dir|--work-tree|--namespace)$/u.test(option) ? 2 : 1;
    }
  }
  return { at, dir };
}

/** The directory a `git` command would write in, or `undefined` when it only reads. */
function gitWriteDir({
  args,
  cwd,
  env,
}: {
  args: readonly ShellWord[];
  cwd: string | undefined;
  env: Readonly<Record<string, string | undefined>>;
}): string | undefined {
  const { at, dir } = gitPlace({ args, cwd, env });
  const subcommand = args[at]?.text.toLowerCase();
  if (subcommand === undefined || GIT_READS.has(subcommand)) {
    return undefined;
  }
  const operands = args.slice(at + 1).filter((word) => !isOption({ word }));
  if (GIT_LISTS_BARE.has(subcommand) && (operands.length === 0 || operands[0]!.text === "list")) {
    return undefined;
  }
  return dir;
}

/**
 * The program one simple command runs (`undefined` for a bare assignment or redirection), the words after it, and the
 * directory it runs in: the shell's, moved by a wrapper's own chdir (`env -C`, `sudo -D`).
 */
function pieceRun({
  piece,
  cwd,
  env,
}: {
  piece: readonly ShellWord[];
  cwd: string | undefined;
  env: Readonly<Record<string, string | undefined>>;
}): { program: string | undefined; args: readonly ShellWord[]; dir: string | undefined } {
  const run = programAt({ words: withoutRedirections({ words: piece }) });
  if (run.at === undefined) {
    return { args: [], dir: cwd, program: undefined };
  }
  const moved = wrapperChdir({ leading: run.words.slice(0, run.at) });
  // Expanded as the shell would, from where the shell stands — one this cannot read leaves the directory unknown.
  const dir = moved === undefined ? cwd : absolutePatterns({ cwd, env, words: [moved] })[0];
  return { args: run.words.slice(run.at + 1), dir, program: programName({ text: run.words[run.at]!.text }) };
}

/**
 * Where one simple command acts: the directory its program runs in, a wrapper's own chdir applied (`env -C <dir>`),
 * and, for a `git`, the directory each of its `-C <dir>` options then moves it to.
 *
 * @param piece the simple command's words, redirections included
 * @param cwd the directory the SHELL stands in, before any wrapper's chdir or `git -C`
 * @param env the environment a leading variable in a directory is expanded from
 * @returns the program's directory, and the git's (`undefined` for any other program, or one this cannot read)
 */
export function piecePlace({
  piece,
  cwd,
  env,
}: {
  piece: readonly ShellWord[];
  cwd: string | undefined;
  env: Readonly<Record<string, string | undefined>>;
}): { dir: string | undefined; gitDir: string | undefined } {
  const run = pieceRun({ cwd, env, piece });
  if (run.program !== "git") {
    return { dir: run.dir, gitDir: undefined };
  }
  return { dir: run.dir, gitDir: gitPlace({ args: run.args, cwd: run.dir, env }).dir };
}

/**
 * A moved program's operands as absolute patterns from the directory it runs in — and, for one opening on an unknown
 * expansion that may already be absolute, from where the shell stands too (`env -C /tmp touch "$OTHER"`).
 */
function movedPatterns({
  words,
  cwd,
  dir,
  env,
}: {
  words: readonly ShellWord[];
  cwd: string | undefined;
  dir: string | undefined;
  env: Readonly<Record<string, string | undefined>>;
}): readonly string[] {
  const unknown = dir === cwd ? [] : words.filter((word) => opensOnUnknownExpansion({ word }));
  return [...absolutePatterns({ cwd: dir, env, words }), ...absolutePatterns({ cwd, env, words: unknown })];
}

/** A copier's destination words: every `-t`/`--target-directory` value, else its last operand. */
function copyDestinations({ args }: { args: readonly ShellWord[] }): readonly ShellWord[] {
  const targets: ShellWord[] = [];
  const operands: ShellWord[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index]!;
    if ((word.text === "-t" || word.text === "--target-directory") && args[index + 1] !== undefined) {
      targets.push(args[index + 1]!);
      index += 1;
    } else if (word.text.startsWith("--target-directory=")) {
      targets.push({ ...word, text: word.text.slice("--target-directory=".length) });
    } else if (!isOption({ word })) {
      operands.push(word);
    }
  }
  const last = operands.at(-1);
  if (targets.length > 0 || last === undefined) {
    return targets;
  }
  return [last];
}

/**
 * What one simple command writes, as absolute patterns: its writing redirections, a creator's operands, a copier's
 * destination, `dd of=`, and a writing `git`'s directory.
 *
 * @param piece the simple command's words, redirections included
 * @param cwd the directory the SHELL stands in, when its `cd`s leave one known — before any `git -C`, since a
 *   redirection opens from there and a `git`'s `-C` is read here
 * @param env the environment a leading variable in a word is expanded from
 * @returns every absolute pattern the command would write at
 */
export function pieceWrites({
  piece,
  cwd,
  env,
}: {
  piece: readonly ShellWord[];
  cwd: string | undefined;
  env: Readonly<Record<string, string | undefined>>;
}): readonly string[] {
  // The shell opens a redirection where it stands, before any wrapper or `git -C` moves the program.
  const redirected = absolutePatterns({ cwd, env, words: redirectionTargets({ words: piece, writing: true }) });
  const { program, args, dir } = pieceRun({ cwd, env, piece });
  if (program === undefined) {
    return redirected;
  }
  if (CREATORS.has(program)) {
    const operands = args.filter((word) => !isOption({ word }));
    return [...redirected, ...movedPatterns({ cwd, dir, env, words: operands })];
  }
  if (COPIERS.has(program)) {
    return [...redirected, ...movedPatterns({ cwd, dir, env, words: copyDestinations({ args }) })];
  }
  if (program === "dd") {
    const outputs = args.flatMap((word) =>
      word.text.startsWith("of=") ? [{ ...word, text: word.text.slice(3) }] : [],
    );
    return [...redirected, ...movedPatterns({ cwd, dir, env, words: outputs })];
  }
  const gitDir = program === "git" ? gitWriteDir({ args, cwd: dir, env }) : undefined;
  return gitDir === undefined ? redirected : [...redirected, gitDir];
}
