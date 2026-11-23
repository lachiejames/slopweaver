/**
 * Which words of one simple command remove, move or overwrite what they name — the half of the call-state tripwire
 * (`./callStateGuard.ts`) that knows each program's argument grammar. Pure, no I/O.
 *
 * ## What is judged
 *
 * - `rm`, `unlink`, `rmdir`, `shred`, `srm`, `trash`: every operand. `truncate`: every operand but the values of
 *   `-s`/`-r`, so a reference file it only reads is not one. `dd`: each `of=` value, `conv=notrunc` or not.
 * - `mv`: every operand, since each source is taken away and the destination overwritten, plus a `-t` directory.
 * - `cp`, `install`, `ln`, `rsync`, `ditto`: the destination — for `cp`, `install` and `ln` a `-t`/`--target-directory`
 *   value when one is given, else the last operand, a lone `ln` operand linking into `.`; every operand under
 *   `install -d`; nothing for a no-clobber `cp -n`, nor for a one-operand rsync listing, nor when rsync's last
 *   operand is a remote `host:path`, since its local operands are then sources it only reads — unless `--remove-source-files` takes every local operand away.
 *   An rsync `--backup-dir`, `--partial-dir` or batch file is judged too, as a place it writes names of its own choosing.
 *   An option written AFTER the operands is read by each writer's own grammar (`./destinationOperands.ts`), so
 *   `rsync src dst --exclude x` judges `dst`, and an option it does not know is read both ways. The destination is
 *   judged as `<destination>/<each source's last component>`, what a copy into a directory writes, so copying a call
 *   file into the home itself is no hit; `writtenInto` names when the destination itself is judged instead.
 * - `tee`: every operand from the first non-option on, as BSD tee reads them (`./wordOperators.ts`'s `teeWrites`);
 *   nothing for an appending `tee -a`.
 * - `sed`, `perl`, `ruby` editing in place (`./rawBashStage.ts`'s `editsInPlace`): every operand, its script
 *   included — a script never names a protected path, so judging it costs nothing.
 * - `find` with `-delete`, or `-exec`/`-execdir`/`-ok`/`-okdir` running a remover, `mv` or `truncate`: its starting points, past its
 *   leading options (`-H`, `-L`, `-x`, …) and including each BSD `-f <path>`. And whatever each command an action
 *   runs destroys by these same rules, judged with the found `{}` left out, so `-exec rm <call file> \;` is one. An
 *   `-execdir`/`-okdir` command runs in each found file's directory, so a relative path it destroys is judged as the
 *   starting point whole, and from each level its `..`s can climb above it.
 * - `git` (`./callStateGitOperands.ts`) — `clean`, bar a dry run: each pathspec, or the directory it cleans (which the caller holds) when it names
 *   none or one git reads as a glob or magic; the work tree itself when `--work-tree` or `GIT_WORK_TREE` names one.
 *   Likewise every operand of `git rm` (bar `--cached`), `git mv`, `git restore` (bar `--staged` alone) and
 *   `git checkout`, and the whole directory under `git reset --hard` or a forced `checkout`/`switch`: the live home
 *   tracks its call files in git.
 *
 * A leading assignment, a `coproc`, and a wrapper (`./callStateArgs.ts`'s `PREFIXES`: `env`, `sudo`, `nice`,
 * `timeout` and their kin) are stepped over to reach
 * the program, an `env -S` string split into the words it runs (`./wrappedProgram.ts`). Every program name is
 * matched case folded, since the owner's Mac's filesystem runs `/bin/RM` as `rm`. For every program but a destination writer, option VALUES other than those named above are judged as
 * operands: that can only ever over-refuse a value that happens to name call state, never let a removal through.
 *
 * ## Over-refusal is the side it errs on
 *
 * An option that makes a writer harmless and is not named above — `cp -i` answered no, `rsync --ignore-existing`,
 * `--dry-run` on a program other than `git clean` — is still refused when its destination is call state, and so is an
 * operand that is a destination only if an unknown long option before the last word takes no value. A `ditto` into a
 * directory above call state is refused even when its source is a single file, since ditto copies a directory
 * source's CONTENTS there and a lexical read cannot tell a file from a directory; so is any contents copy (a source
 * ending in `/`, `.` or `..`, as in `rsync -a calls/ ~/.slopweaver/`) or globbed source (`cp -r /x/t* ~/.slopweaver/`
 * overwrites `talk` when `/x/talk` exists) into one, since the names it writes are on disk, not in the command; and so
 * is any copy into one under a placement option (`-T`, `--parents`, rsync's `-R` or
 * `--relative`), since `rsync -aR talk/calls/x.jsonl ~/.slopweaver/` really does overwrite call state and an absolute
 * source is not told apart from it. A program name the shell rewrites (`r{m,m}`, `$RM`) could be any of them, so every
 * word it holds is judged, and it cleans its directory as git would. That is deliberate: the hatch is the way past a refusal, and nothing is the way back from a lost call file.
 *
 * ## What is not, and fails open
 *
 * Any other program, an interpreter or a verb doing the removal, `xargs`, a nested `sh -c`, and a function or alias.
 */
import {
  type DestructiveOperands,
  isOption,
  NOTHING_DESTROYED as NOTHING,
  programName,
  readingsUnder,
  splitArgs,
  under,
  unreadableProgram,
} from "./callStateArgs.js";
import { gitWorkTreeDestroyed } from "./callStateGitOperands.js";
import { REMOTE_OPERAND, writerOperands, writtenInto } from "./destinationOperands.js";
import { longOption } from "./longOption.js";
import { editsInPlace } from "./rawBashStage.js";
import { type ShellWord, slicedWord } from "./shellLexing.js";
import { programAt, wrapperChdir } from "./wrappedProgram.js";

/** Programs that remove, or destroy the contents of, every operand. */
const REMOVERS: ReadonlySet<string> = new Set(["rm", "unlink", "rmdir", "shred", "srm", "trash"]);

/** Programs that overwrite one destination. */
const DESTINATION_WRITERS: ReadonlySet<string> = new Set(["cp", "install", "ln", "rsync", "ditto"]);

/** `find` actions that run a program. */
const FIND_EXECS: ReadonlySet<string> = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

/**
 * A short cluster carrying `-t`, past letters that take no value (`-S`, `-g`, `-m` and `-o` do, so `-St` is a
 * suffix of `t`): its attached value, or `""` when the next word is it (GNU `cp -at DIR`).
 */
const SHORT_TARGET = /^-[A-RT-Za-fh-lnp-su-z]*t(.*)$/u;

/** Where one word puts its target directory: attached to it, in the next word, or nowhere. */
function targetValue({ text }: { text: string }): { attached: string } | "next" | undefined {
  // By any abbreviation too, as GNU reads one (`cp --target-dir=<dir>`).
  const long = longOption({ full: "--target-directory", word: text });
  if (long !== undefined) {
    return long.attached === undefined ? "next" : { attached: long.attached };
  }
  const short = text.startsWith("--") ? null : SHORT_TARGET.exec(text);
  if (short === null) {
    return undefined;
  }
  return short[1] === "" ? "next" : { attached: short[1]! };
}

/**
 * The `-t DIR`, `-tDIR`, `-at DIR`, `--target-directory=DIR` or `--target-directory DIR` value, and the words it
 * used — read only before an unquoted `--`, after which a `-t` is a file name.
 */
function targetDirectory({
  args,
}: {
  args: readonly ShellWord[];
}): { dir: ShellWord; used: readonly number[] } | undefined {
  for (const [index, arg] of args.entries()) {
    if (arg.text === "--" && !arg.quoted) {
      return undefined;
    }
    const value = targetValue({ text: arg.text });
    const next = args[index + 1];
    if (value === "next" && next !== undefined) {
      return { dir: next, used: [index, index + 1] };
    }
    if (value !== undefined && value !== "next") {
      // Sliced, so its quoting is read from where the value starts (`cp -t"$SLOPWEAVER_HOME/talk/calls" x`).
      const start = arg.text.length - value.attached.length;
      return { dir: slicedWord({ end: arg.text.length, start, word: arg }), used: [index] };
    }
  }
  return undefined;
}

/** The destination writers whose `-t` names a target directory: rsync's `-t` keeps times, and ditto has none. */
const TARGET_DIRECTORY_WRITERS: ReadonlySet<string> = new Set(["cp", "install", "ln"]);

/** What a destination writer overwrites. */
function destinationOf({ name, args }: { name: string; args: readonly ShellWord[] }): readonly ShellWord[] {
  let target: ReturnType<typeof targetDirectory>;
  if (TARGET_DIRECTORY_WRITERS.has(name)) {
    target = targetDirectory({ args });
  }
  const rest = target === undefined ? args : args.filter((_, index) => !target.used.includes(index));
  // `written` is rsync's own `--backup-dir` and its kin: only rsync reaches a return that carries it.
  const { options, operands, destinations, written } = writerOperands({ args: rest, name });
  if (name === "install" && options.some((option) => /^-[A-Za-z]*d/u.test(option) || option === "--directory")) {
    return operands;
  }
  // A no-clobber copy leaves an existing destination untouched, and creating a new file destroys nothing;
  // an `n` after a valued `-S` or `-t` in its cluster is that value, so `-Sn` still overwrites. BSD cp obeys the LAST
  // of `-f`, `-i` and `-n`, so any `-f` or `-i` beside it is read as overwriting (`cp -n -f`).
  if (name === "cp" && noClobber({ options })) {
    return [];
  }
  if (target !== undefined) {
    return writtenInto({ destination: target.dir, name, options, sources: operands });
  }
  if (name === "rsync" && namesAny({ fulls: ["--remove-source-files", "--remove-sent-files"], options })) {
    // It removes every source it sent, so each local operand is taken away, not only the destination.
    return [...operands.filter((word) => !REMOTE_OPERAND.test(word.text)), ...written];
  }
  // `ln SOURCE` with no target links into the directory it runs in, a `-f` replacing what is there.
  if (name === "ln" && operands.length === 1) {
    return writtenInto({ destination: HERE, name, options, sources: operands });
  }
  return [
    ...destinations.flatMap((destination) =>
      writtenInto({ destination, name, options, sources: operands.slice(0, operands.indexOf(destination)) }),
    ),
    ...written,
  ];
}

/**
 * Whether any option names one of these long options, by its whole name or any prefix of it, as GNU getopt and rsync
 * accept one (`rsync --remove-source` removes its sources). A prefix two options share is ambiguous, which
 * the program refuses, so reading it as the harmful one only ever over-refuses.
 */
function namesAny({ options, fulls }: { options: readonly string[]; fulls: readonly string[] }): boolean {
  return options.some((word) => fulls.some((full) => longOption({ full, word }) !== undefined));
}

/** Whether a `cp`'s options leave an existing destination alone: a `-n`, and no `-f` or `-i` that could outrank it. */
function noClobber({ options }: { options: readonly string[] }): boolean {
  const n = options.some((option) => /^-[A-RT-Za-su-z]*n/u.test(option) || option === "--no-clobber");
  const overridden =
    options.some((option) => /^-[A-RT-Za-su-z]*[fi]/u.test(option)) ||
    namesAny({ fulls: ["--force", "--interactive", "--remove-destination"], options });
  return n && !overridden;
}

/** The directory a command runs in, as the word `.`. */
const HERE: ShellWord = { dynamic: false, quoted: false, shape: ".", text: ".", unquotedPrefix: "." };

/** What `mv` takes away or overwrites: every operand, and a `-t` directory. */
function movedBy({ args }: { args: readonly ShellWord[] }): readonly ShellWord[] {
  const target = targetDirectory({ args });
  const rest = target === undefined ? args : args.filter((_, index) => !target.used.includes(index));
  const { operands } = splitArgs({ args: rest });
  return target === undefined ? operands : [...operands, target.dir];
}

/**
 * What `dd` overwrites: each `of=` value (`dd of=<call file>`). dd reads its operands after the shell has
 * removed quotes, so a quoted `'of=…'` is the same operand (as before).
 */
function ddWrites({ args }: { args: readonly ShellWord[] }): readonly ShellWord[] {
  return args
    .filter((arg) => arg.text.startsWith("of=") && arg.text.length > 3)
    .map((arg) => slicedWord({ end: arg.text.length, start: 3, word: arg }));
}

/** What `truncate` empties: every operand but the values of its size and reference options. */
function truncatedBy({ args }: { args: readonly ShellWord[] }): readonly ShellWord[] {
  const kept = args.filter((_, index) => {
    const before = args[index - 1];
    return before === undefined || !/^(?:-[sr]|--size|--reference)$/u.test(before.text);
  });
  return splitArgs({ args: kept }).operands;
}

/**
 * What `tee` overwrites: every word from its first non-option on, a `--` included as the boundary — nothing when an
 * option before them appends (`-a`, `--append`), like `>>`.
 */
function teedBy({ args }: { args: readonly ShellWord[] }): readonly ShellWord[] {
  const first = args.findIndex((arg) => arg.text === "--" || !isOption({ word: arg }));
  const options = first === -1 ? args : args.slice(0, first);
  if (first === -1 || options.some((arg) => /^-[A-Za-z]*a/u.test(arg.text) || arg.text === "--append")) {
    return [];
  }
  return args.slice(args[first]!.text === "--" ? first + 1 : first);
}

/** The options `find` reads BEFORE its starting points (BSD `-HLPEXdsx`, GNU `-HLP` and `-O<level>`). */
const FIND_LEADING = /^-(?:[HLPEXdsx]+|O\d*)$/u;

/** The leading `find` options that take the next word: BSD `-f <path>` names a starting point, GNU `-D <opts>` not. */
const FIND_LEADING_VALUED: ReadonlySet<string> = new Set(["-f", "-D"]);

/** `find`'s starting points: every BSD `-f` path, then each word before the expression's first primary. */
function findStartingPoints({ args }: { args: readonly ShellWord[] }): readonly ShellWord[] {
  const points: ShellWord[] = [];
  let at = 0;
  while (at < args.length && (FIND_LEADING.test(args[at]!.text) || FIND_LEADING_VALUED.has(args[at]!.text))) {
    const value = args[at + 1];
    if (args[at]!.text === "-f" && value !== undefined) {
      points.push(value);
    }
    at += FIND_LEADING_VALUED.has(args[at]!.text) ? 2 : 1;
  }
  // An unquoted `--` ends find's own options, the starting points following it (`find -- x -delete`).
  const ended = args[at]?.text === "--" && args[at]?.quoted === false;
  const rest = args.slice(ended ? at + 1 : at);
  const end = rest.findIndex((arg) => arg.text.startsWith("-") || arg.text === "(" || arg.text === "!");
  return [...points, ...(end === -1 ? rest : rest.slice(0, end))];
}

/** Whether a program `find` runs on what it found takes it away or empties it (`-exec mv {} /tmp/old/`). */
function takesFoundAway({ name }: { name: string }): boolean {
  return REMOVERS.has(name) || name === "mv" || name === "truncate";
}

/**
 * Each command a `find` action runs: its words up to the `;`, or the `{} +`, that ends it, and whether it runs in
 * the found file's directory (`-execdir`, `-okdir`).
 */
function findExecCommands({
  args,
}: {
  args: readonly ShellWord[];
}): readonly { readonly words: readonly ShellWord[]; readonly inFoundDir: boolean }[] {
  return args.flatMap((arg, index) => {
    if (!FIND_EXECS.has(arg.text)) {
      return [];
    }
    const rest = args.slice(index + 1);
    const end = rest.findIndex((word, at) => word.text === ";" || (word.text === "+" && rest[at - 1]?.text === "{}"));
    return [{ inFoundDir: arg.text.endsWith("dir"), words: end === -1 ? rest : rest.slice(0, end) }];
  });
}

/**
 * What an `-execdir` or `-okdir` command destroys, from where it runs: the directory of each file found, at any depth
 * under a starting point (`find work -execdir truncate -s 0 ../<home>/talk/call-index.txt \;`). Below its
 * `..`s it lands under the starting point, which is judged whole; above them, at one depth per `..` it climbs, each
 * judged as the word it is.
 */
function foundDirDestroys({
  points,
  destroyed,
}: {
  points: readonly ShellWord[];
  destroyed: DestructiveOperands;
}): readonly ShellWord[] {
  const relative = destroyed.words.filter((word) => !/^[/~$]/u.test(word.text));
  if (relative.length === 0 && !destroyed.cleansCwd) {
    return destroyed.words;
  }
  const absolute = destroyed.words.filter((word) => !relative.includes(word));
  return [
    ...absolute,
    ...points.flatMap((dir) => [
      dir,
      ...relative.flatMap((word) => {
        const climbs = word.text.split("/").filter((part) => part === "..").length;
        // A file found `depth` levels down runs the command in `<point>/x/…/x`, any name cancelled by a `..`.
        return Array.from({ length: climbs }, (_, depth) => under({ dir, word: foundLevels({ depth, word }) }));
      }),
    ]),
  ];
}

/** A word as named from `depth` directory levels below where it is judged: `x/x/<word>`, or the word itself. */
function foundLevels({ depth, word }: { depth: number; word: ShellWord }): ShellWord {
  if (depth === 0) {
    return word;
  }
  const text = Array.from({ length: depth }, () => "x").join("/");
  return under({ dir: { dynamic: false, quoted: false, shape: text, text, unquotedPrefix: text }, word });
}

/**
 * A word with find's `{}` inside it, read as any text from the directory before the `{}` on, since a found path may
 * hold a `/` of its own (`-exec rm -rf <home>/talk/{} \;` removes `<home>/talk/./calls`).
 */
function foundSubstituted({ word }: { word: ShellWord }): ShellWord {
  const at = word.text.indexOf("{}");
  if (at === -1) {
    return word;
  }
  const kept = slicedWord({ end: word.text.lastIndexOf("/", at) + 1, start: 0, word });
  return { ...kept, shape: `${kept.shape}*`, text: `${kept.text}*` };
}

/**
 * What `find` destroys: its starting points, when an action deletes or runs a remover, `mv` or `truncate`; and what
 * each command an action runs destroys by its own grammar, the found `{}` left out (`find . -prune -exec rm
 * <call file> \;` names the call file itself).
 */
function foundBy({ args }: { args: readonly ShellWord[] }): DestructiveOperands {
  const all = findExecCommands({ args });
  const commands = all.map((command) => command.words);
  const named = all.map((command) => {
    const words = command.words.filter((word) => word.text !== "{}").map((word) => foundSubstituted({ word }));
    const destroyed = destructiveOperands({ words });
    if (!command.inFoundDir) {
      return destroyed;
    }
    const given = findStartingPoints({ args });
    return { cleansCwd: false, words: foundDirDestroys({ destroyed, points: given.length === 0 ? [HERE] : given }) };
  });
  // The program each runs, past the same wrappers the top level steps over (`-exec env rm {} +`).
  const runsRemover = commands.some((command) => {
    const { at, words } = programAt({ words: command });
    if (at === undefined) {
      return false;
    }
    return unreadableProgram({ word: words[at]! }) || takesFoundAway({ name: programName({ text: words[at]!.text }) });
  });
  const deletes = runsRemover || args.some((arg) => arg.text === "-delete");
  const given = deletes ? findStartingPoints({ args }) : [];
  // GNU find starts at `.` when it names no starting point (`cd <calls> && find -delete`).
  const points = deletes && given.length === 0 ? [HERE] : given;
  return { cleansCwd: named.some((one) => one.cleansCwd), words: [...points, ...named.flatMap((one) => one.words)] };
}

/**
 * The words one simple command would remove, move or overwrite, by its program's grammar — re-rooted under a
 * wrapper's own `cd` when one is given (`env -C calls rm x.jsonl` removes `calls/x.jsonl`).
 *
 * @param words the command's words with every redirection already removed
 * @returns the words to judge, and whether it cleans its own directory
 */
export function destructiveOperands({ words: written }: { words: readonly ShellWord[] }): DestructiveOperands {
  const { at, words } = programAt({ words: written });
  if (at === undefined) {
    return NOTHING;
  }
  const destroyed = programDestroys({ at, words });
  const dir = wrapperChdir({ leading: words.slice(0, at) });
  if (dir === undefined) {
    return destroyed;
  }
  const moved = destroyed.words.flatMap((word) => readingsUnder({ dir, word }));
  return { cleansCwd: destroyed.cleansCwd, words: destroyed.cleansCwd ? [dir, ...moved] : moved };
}

/** What the program at `at` destroys, by its own grammar, judged from the directory the segment runs in. */
function programDestroys({ words, at }: { words: readonly ShellWord[]; at: number }): DestructiveOperands {
  if (unreadableProgram({ word: words[at]! })) {
    // It may run any program the guard names, `git` included, so every word it holds is judged as one it destroys.
    return { cleansCwd: true, words: words.slice(at) };
  }
  const name = programName({ text: words[at]!.text });
  const args = words.slice(at + 1);
  if (REMOVERS.has(name)) {
    return { cleansCwd: false, words: splitArgs({ args }).operands };
  }
  if (name === "truncate") {
    return { cleansCwd: false, words: truncatedBy({ args }) };
  }
  if (name === "mv") {
    return { cleansCwd: false, words: movedBy({ args }) };
  }
  if (name === "dd") {
    return { cleansCwd: false, words: ddWrites({ args }) };
  }
  if (DESTINATION_WRITERS.has(name)) {
    return { cleansCwd: false, words: destinationOf({ args, name }) };
  }
  if (name === "tee") {
    return { cleansCwd: false, words: teedBy({ args }) };
  }
  if (name === "find") {
    return foundBy({ args });
  }
  if (name === "git") {
    return gitWorkTreeDestroyed({ at, words });
  }
  const { options, operands } = splitArgs({ args });
  return editsInPlace({ name, options }) ? { cleansCwd: false, words: operands } : NOTHING;
}
