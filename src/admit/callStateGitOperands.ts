/**
 * What a `git` command removes or overwrites in its work tree — the git half of the call-state tripwire's program
 * grammars (`./callStateOperands.ts`). The live home is a git repository tracking its call files, so each of these is
 * a plain cleanup there (`git -C <home> rm -f -- talk/calls/<id>.jsonl`). Pure, no I/O.
 */
import {
  type DestructiveOperands,
  isOption,
  NOTHING_DESTROYED,
  readingsUnder,
  splitArgs,
  under,
} from "./callStateArgs.js";
import { gitSubcommand } from "./commandTokens.js";
import { type ShellWord, slicedWord } from "./shellLexing.js";

/** The `git clean` options that take the next word as their value. */
const CLEAN_VALUED: ReadonlySet<string> = new Set(["-e", "--exclude"]);

/** A pathspec git reads as a glob or as magic (`:/`), which no lexical resolution can bound. */
const PATHSPEC_PATTERN = /^:|[*?[]/u;

/** A `git clean`'s option texts and pathspec words, each valued option's value in neither. */
function cleanArgs({ args }: { args: readonly ShellWord[] }): {
  options: readonly string[];
  pathspecs: readonly ShellWord[];
} {
  const options: string[] = [];
  const pathspecs: ShellWord[] = [];
  let ended = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!ended && arg.text === "--" && !arg.quoted) {
      ended = true;
    } else if (!ended && CLEAN_VALUED.has(arg.text)) {
      index += 1;
    } else if (!ended && isOption({ word: arg })) {
      options.push(arg.text);
    } else {
      pathspecs.push(arg);
    }
  }
  return { options, pathspecs };
}

/**
 * What a `git` command that is a `clean`, bar a dry run, removes: its pathspecs, or the whole directory it cleans
 * when it names none or one git would read as a pattern (`clean -fdx -- unrelated.tmp` touches nothing else).
 */
function cleanedBy({ words }: { words: readonly ShellWord[] }): DestructiveOperands {
  const { sub, flags } = gitSubcommand({ tokens: words.map((word) => word.text) });
  if (sub !== "clean") {
    return NOTHING_DESTROYED;
  }
  const { options, pathspecs } = cleanArgs({ args: words.slice(words.length - flags.length) });
  // `-en` excludes the pattern `n` rather than dry-running, so an `n` after an `e` is a value, and so is the word
  // after a spaced `-e` (`clean -fd -e -n` deletes).
  const dryRun = options.some((option) => option === "--dry-run" || /^-[A-Za-df-z]*n/u.test(option));
  if (dryRun && !negates({ full: "--dry-run", options })) {
    return NOTHING_DESTROYED;
  }
  // A pathspec holding an expansion goes to the caller as a word, where an unknowable one is allowed.
  if (pathspecs.length === 0 || pathspecs.some((word) => !word.dynamic && PATHSPEC_PATTERN.test(word.text))) {
    return { cleansCwd: true, words: [] };
  }
  return { cleansCwd: false, words: pathspecs };
}

/** The git subcommands whose operands name paths they remove or overwrite in the work tree. */
const GIT_PATH_WRITERS: ReadonlySet<string> = new Set(["rm", "mv", "restore", "checkout"]);

/**
 * Whether an option is a long option git would read as `full`: git accepts any unambiguous prefix (`reset --har`). `shortest` is where the prefix stops being shared with a sibling, and a shorter one only over-refuses.
 */
function abbreviates({ option, full, shortest }: { option: string; full: string; shortest: number }): boolean {
  return option.length >= shortest && full.startsWith(option);
}

/**
 * Whether any option negates the long option `full` as git reads one: `--no-<name>`, or any prefix of it past `--no-`
 * (`rm -n --no-dry-run -f` removes). Git obeys the last of an option and its negation; a negation anywhere is
 * read as winning, which only over-refuses.
 */
function negates({ options, full }: { options: readonly string[]; full: string }): boolean {
  const negated = `--no-${full.slice(2)}`;
  return options.some((option) => abbreviates({ full: negated, option, shortest: 6 }));
}

/**
 * Whether a git command throws away every uncommitted change in its work tree: `reset --hard`, or a forced
 * `checkout`/`switch` (`-f`, `--force`, `--discard-changes`) with or without paths (`git checkout -f`).
 */
function gitDiscardsWorkTree({ sub, options }: { sub: string | undefined; options: readonly string[] }): boolean {
  if (sub === "reset") {
    return options.some((option) => abbreviates({ full: "--hard", option, shortest: 4 }));
  }
  // A short cluster carrying `f` forces too (`checkout -fq`); one where `f` is a `-b` value only over-refuses.
  const forced = options.some(
    (option) =>
      abbreviates({ full: "--force", option, shortest: 3 }) ||
      abbreviates({ full: "--discard-changes", option, shortest: 4 }) ||
      /^-[A-Za-z]*f/u.test(option),
  );
  return (sub === "checkout" || sub === "switch") && forced;
}

/**
 * Whether a path-writing git subcommand's options leave the work tree alone. Each letter that ALLOWS is read only
 * where no value-taking letter precedes it in its cluster — `restore -sS` is a `--source` of `S`, not `--staged`.
 */
function gitLeavesWorkTree({ sub, options }: { sub: string; options: readonly string[] }): boolean {
  const dryRun = options.some((option) => option === "--dry-run" || /^-[A-Za-z]*n/u.test(option));
  if ((sub === "rm" || sub === "mv") && dryRun && !negates({ full: "--dry-run", options })) {
    return true;
  }
  if (sub === "rm") {
    return options.includes("--cached") && !negates({ full: "--cached", options });
  }
  if (sub === "restore") {
    const staged = options.some((option) => option === "--staged" || /^-[A-RT-Za-rt-z]*S/u.test(option));
    const worktree = options.some((option) => option === "--worktree" || /^-[A-Za-z]*W/u.test(option));
    return staged && !worktree && !negates({ full: "--staged", options });
  }
  return false;
}

/**
 * A `clean` ({@link cleanedBy}); every operand of an `rm` (bar `--cached`), `mv`, `restore` (bar `--staged` alone) or
 * `checkout`, a branch name read as a path only over-refusing; and the whole directory for `reset --hard`.
 */
function gitDestroyed({ words }: { words: readonly ShellWord[] }): DestructiveOperands {
  const { sub, flags } = gitSubcommand({ tokens: words.map((word) => word.text) });
  if (sub === "clean") {
    return cleanedBy({ words });
  }
  const { options, operands } = splitArgs({ args: words.slice(words.length - flags.length) });
  if (gitDiscardsWorkTree({ options, sub })) {
    return { cleansCwd: true, words: [] };
  }
  if (sub === undefined || !GIT_PATH_WRITERS.has(sub) || gitLeavesWorkTree({ options, sub })) {
    return NOTHING_DESTROYED;
  }
  // Git matches a magic (`:/talk/calls/x.jsonl`) or glob pathspec itself, so it is judged as the whole tree.
  // So is a `--pathspec-from-file`, whose paths are on disk rather than in the command, abbreviated or not (`restore --pathspec-from-f=<list>`); a prefix shared with `--patch` only over-refuses.
  const fromFile = options.some((option) =>
    abbreviates({ full: "--pathspec-from-file", option: option.split("=")[0]!, shortest: 4 }),
  );
  if (fromFile || operands.some((word) => !word.dynamic && PATHSPEC_PATTERN.test(word.text))) {
    return { cleansCwd: true, words: [] };
  }
  return { cleansCwd: false, words: operands };
}

/**
 * What a `git` command destroys. One aimed at another work tree — `--work-tree=<dir>`, `--work-tree <dir>` or a
 * `GIT_WORK_TREE=<dir>` assignment — destroys in THAT directory, not the one it runs in, so the work tree itself is
 * judged whatever the pathspecs (`git --work-tree=<home> clean -fdx`). Judging the whole tree only ever
 * over-refuses.
 *
 * @param words the whole command, assignments and wrappers included
 * @param at where `git` itself sits among them
 * @returns the words to judge, and whether it cleans its own directory
 */
export function gitWorkTreeDestroyed({ words, at }: { words: readonly ShellWord[]; at: number }): DestructiveOperands {
  const aliased = inlineAlias({ at, words });
  const destroyed = aliased ? { cleansCwd: true, words: [] } : gitDestroyed({ words: words.slice(at) });
  if (!destroyed.cleansCwd && destroyed.words.length === 0) {
    return destroyed;
  }
  const trees = words.flatMap((_word, index) => workTreeAt({ index, words }));
  const judged = trees.length === 0 ? destroyed : { cleansCwd: false, words: trees };
  // Git's `-C` is applied here and only here, wrapped or not (`command git -C <home> restore -- talk/call-index.txt`):
  // the caller resolves these words from where the SHELL stands, since the segment resolver also applies a `-C` behind
  // `env` or an assignment, and a second read climbed past the home (`A=1 git -C .. rm -- talk/x` from `<home>/corpus`).
  const dir = gitChdir({ words: words.slice(at) });
  if (dir === undefined) {
    return judged;
  }
  const moved = judged.words.flatMap((word) => readingsUnder({ dir, word }));
  // Still cleaning: the caller judges the repository holding `dir` too, as it does the segment's own directory.
  return { cleansCwd: judged.cleansCwd, words: judged.cleansCwd ? [dir, ...moved] : moved };
}

/**
 * Whether the command defines its own git subcommand as an alias — by `-c`, `--config-env` or a `GIT_CONFIG_*`
 * assignment — which may run anything, so it is judged as the whole tree (`git -c 'alias.nuke=reset --hard'
 * nuke`). Alias names fold case as git's do; a longer alias sharing the prefix only over-refuses. An alias from a config
 * FILE is not in the command and is not judged.
 */
function inlineAlias({ words, at }: { words: readonly ShellWord[]; at: number }): boolean {
  const { sub } = gitSubcommand({ tokens: words.slice(at).map((word) => word.text) });
  if (sub === undefined) {
    return false;
  }
  const key = `alias.${sub.toLowerCase()}`;
  return words.some((word) => word.text.toLowerCase().includes(key));
}

/**
 * The work tree the word at `index` points git at, if it does: `--work-tree=<dir>`, `--work-tree <dir>`, a
 * `GIT_WORK_TREE=<dir>` assignment, or the config `core.worktree=<dir>` given by `-c`, spaced or attached, its key in
 * any case as git reads it (`git -c core.worktree=<home> restore -- talk/call-index.txt`).
 */
function workTreeAt({ words, index }: { words: readonly ShellWord[]; index: number }): readonly ShellWord[] {
  const word = words[index]!;
  const next = words[index + 1];
  if (word.text === "--work-tree") {
    return next === undefined ? [] : [next];
  }
  const configured = /^(?:-c)?core\.worktree=/iu.exec(word.text);
  const config = configured !== null && (word.text.startsWith("-c") || words[index - 1]?.text === "-c");
  const prefix = config ? configured : /^(?:GIT_WORK_TREE|--work-tree)=/u.exec(word.text);
  if (prefix === null || word.text.length === prefix[0].length) {
    return [];
  }
  return [slicedWord({ end: word.text.length, start: prefix[0].length, word })];
}

/** The directory git's own `-C` options move it into, each relative to the last, or `undefined` when none is given. */
function gitChdir({ words }: { words: readonly ShellWord[] }): ShellWord | undefined {
  const { globals } = gitSubcommand({ tokens: words.map((word) => word.text) });
  let dir: ShellWord | undefined;
  for (let index = 1; index <= globals.length; index += 1) {
    const word = words[index]!;
    const next = word.text === "-C" ? words[index + 1] : attachedChdir({ word });
    if (next !== undefined) {
      dir = dir === undefined ? next : under({ dir, word: next });
    }
    if (word.text === "-C") {
      index += 1;
    }
  }
  return dir;
}

/** The directory of an attached `-C<dir>`, or `undefined` for any other word. */
function attachedChdir({ word }: { word: ShellWord }): ShellWord | undefined {
  if (!word.text.startsWith("-C") || word.text.length === 2) {
    return undefined;
  }
  return slicedWord({ end: word.text.length, start: 2, word });
}
