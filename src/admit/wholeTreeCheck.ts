/**
 * The seat end of the whole-tree rule: a session on this machine never builds the TypeScript type checker over
 * the whole tree, nor runs a whole test lane. That is CI's lane, and `slopweaver github checks --number <n> --wait` is where its verdict arrives.
 *
 * ## Why a gate, when the doctrine already said it
 *
 * `AGENTS.md` § Toolchain reads "never run a lane in a seat", and the pre-push hook does not run one. Nothing
 * stopped a SEAT typing one. MEASURED from the session transcripts under `~/.claude/projects`: within 45
 * minutes one seat ran `timeout 900 yarn lint` twice and four others ran `yarn typecheck` or
 * `yarn tsc --noEmit -p .` eleven times between them, while `tsgolint` sat at 263% and `node` at 276% in
 * Activity Monitor. The owner's rule: full-repo, full-rule lint passes are CI's, selected lint rules and a
 * lint-staged-shaped lint stay allowed locally. Reproduce the count over those transcripts' `Bash`
 * `tool_use` inputs in that window.
 *
 * ## The criterion
 *
 * One sentence: **a run that re-proves the whole tree** — builds the type checker over it, runs a whole test
 * lane, or re-checks the whole tree's format or dependency graph. Six shapes carry it:
 *
 * - the whole lint lap — `yarn lint`, `yarn validate`, or `dev lint` by any spelling, with neither
 *   `--lane local` nor `--only`;
 * - `dev lint --only` naming a `WHOLE_PROGRAM_GATES` member (`./devLintInvocation.ts`), the two gates that ARE that
 *   build, or a `WHOLE_TREE_GATES` member, `prettier` and `knip`;
 * - `prettier` checking anything but files (`./formatToolInvocation.ts`), and `knip` by any spelling — the
 *   finding that three seats' laps took load to 61.7 ran both beside oxlint;
 * - `oxlint --type-aware` (which is what spawns `tsgolint`) or `tsgolint` itself, unless every path operand
 *   is one source file or a computed list — the lint-staged shape. A directory or a glob is not;
 * - `tsc` over a project, which is every `tsc` not handed ONLY source files, `yarn typecheck` and `yarn build` (CI's
 *   `compile` leg);
 * - a whole test lane in a Slopweaver checkout — `vitest` or a `test:*` script with no filter, or a lane's
 *   root for one (`./vitestInvocation.ts`), CI's `unit` shards, `subprocess` and `integration` jobs.
 *
 * Everything else a session reaches for stays local: `dev lint --only <gate>` for one of the cheap gates,
 * `--lane local` (the pre-push lane, whose subject CI cannot see), `oxlint` without `--type-aware` over
 * anything, `prettier` on the files touched or in `--write` mode at any width (`yarn format` is the formatter,
 * and CI cannot rewrite a working tree), and `vitest` on the files touched, a directory under a lane, or what
 * `xargs` hands it.
 *
 * **It fires in every checkout, the main one included**, not only in a seat's worktree: the cost is this
 * machine's cores whichever directory spends them, and a main checkout holds `main`, which CI has already run
 * every lane over. The hook only ever sees an agent's `Bash` call, so the owner's own terminal is untouched.
 *
 * ## How far it reads, and what it cannot
 *
 * Every segment, and recursively every command substitution, `bash -c`/`sh -c`/`env -S`/`runuser -c` payload and `eval` — up to
 * {@link MAX_DEPTH} levels, deeper nesting refused unread — with `cd` and `yarn --cwd` followed so a
 * directory is judged where it runs. A segment's own inline `SLOPWEAVER_ALLOW_WHOLE_TREE_CHECK=1` covers that
 * segment and what it spawns, never a sibling. It is a TRIPWIRE, not a fence (AGENTS.md rule 3): a script file
 * that runs the lap, a heredoc piped into a shell (a literal here-string handed to one IS read), an exec wrapper outside `./commandPositions.ts`'s declared
 * table (the programs that can run another are open-ended), or an operand computed at run time
 * (`$(git ls-files)`) is not read, nor is a command that shell STATE runs later — an alias, `PROMPT_COMMAND`,
 * `BASH_ENV`, `bind -x` — though a literal `trap` handler is.
 * Neither is a word spelled through brace expansion (`{yarn,} typecheck`) — the shared lexer decodes `$'…'` and
 * `$"…"` quoting as bash does, so `$'yarn' typecheck` IS read — nor a `case` statement inside `$(…)`, whose first pattern's `)` closes
 * the substitution to this lexer: a seat that runs the lap by habit types it plainly, and a spelling
 * built to get past the guard is what the hatch's journal and review are for. Nor is
 * the filesystem: paths are judged by their text, so a symlink placed to lead out of another project into a
 * Slopweaver checkout is the same kind of gap as a script file.
 *
 * ## What stays OUT, and why that is a decision rather than an omission
 *
 * The other cheap `dev lint` gates stay selectable one by one, which is what the owner asked to keep. A gate
 * joins `./devLintInvocation.ts`'s sets when its own measured cost is the lap's, as prettier and knip did
 * after the test lane: this gate widens rather than a second one being built. `biome-imports`
 * and a bare `biome check` stay out on that test: MEASURED, the import organiser's whole-tree check
 * took 3.63 s wall and 8.9 s user over 17,178 files, against the 70.5 s Prettier lap beside it
 * (`/usr/bin/time -l node_modules/.bin/biome check --max-diagnostics=20 .`). `slopweaver dev build` compiles
 * the binary a seat runs and is not a check at all.
 */
import { checkToolLane, tscLane } from "./checkToolInvocation.js";
import { commandStarts, wrapperPayload } from "./commandPositions.js";
import { shellInput } from "./pythonInvocation.js";
import { resolveProgram } from "./pythonWrappers.js";
import { ownsScriptNames } from "./runDirectory.js";
import { RUNNERS, type RunnerScript, runnerCall, runnerScripts } from "./runnerInvocation.js";
import { nodeOptionsNameModule, nodeRunScript } from "./scriptHostInvocation.js";
import { bodySubstitutions, hereStrings, type ShellWord, shellWords } from "./shellLexing.js";
import {
  type CommandSegment,
  commandSegments,
  hasCommandSegmentOverride,
  hasInlineEnvironmentOverride,
  type ShellSeparator,
} from "./shellSegments.js";
import {
  backgroundLists,
  DIRECTORY_BUILTINS,
  directoryAfter,
  withoutSubshellClose,
  wrappedDirectory,
} from "./shellWalk.js";
import { tscScope } from "./tscInvocation.js";
import { testScriptLane } from "./vitestInvocation.js";
import {
  fedByXargs,
  judgeDevLint,
  judgeScriptHost,
  judgeSlopweaver,
  lane,
  NOT_WHOLE_TREE,
  TSC_SCRIPT,
  type WholeTreeCheck,
} from "./wholeTreeJudges.js";

/** The ambient hatch this gate is opened with — declared as `whole-tree-check` in `../hatch/registry.ts`. */
export const WHOLE_TREE_CHECK_HATCH = "SLOPWEAVER_ALLOW_WHOLE_TREE_CHECK";

/**
 * How many nested command sources (substitutions, shell payloads, `eval`) one call is followed through. Past
 * it the call is REFUSED, never allowed: five `$(…)` deep once hid a `yarn typecheck`.
 */
const MAX_DEPTH = 4;

/** A `package.json` script whose whole body is a lap this gate refuses. */
const WHOLE_TREE_SCRIPTS: Readonly<Record<string, string>> = {
  // `tsc -p tsconfig.build.json` over src/, CI's `compile` leg: docs/toolchain.md § `yarn build`.
  build: "yarn build (tsc over the src/ build project, CI's compile leg)",
  typecheck: "yarn typecheck (tsc over the whole project)",
  validate: "yarn validate (the whole lint lap, then tsc over the whole project)",
};

/** Shells whose `-c` payload is a command line of its own. */
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

/** Every program `judgeProgram` has a judgement for, which the backstop looks for at a command position. */
const WATCHED_PROGRAMS: ReadonlySet<string> = new Set([
  ...RUNNERS,
  ...SHELLS,
  "eval",
  "slopweaver",
  "tsc",
  "oxlint",
  "tsgolint",
  "vitest",
  "prettier",
  "knip",
  "node",
  "tsx",
]);

/** Where the walk is: how deep, whether an inline hatch already covers it, and the directory it runs in. */
interface Walk {
  readonly depth: number;
  readonly covered: boolean;
  readonly cwd: string | undefined;
  /** The program was reached through `xargs`, which hands it operands computed at run time that no word shows. */
  readonly fed?: boolean;
}

/**
 * Classify one shell command line: does any uncovered part of it build the type checker over the whole tree?
 *
 * @param command the raw `Bash` command
 * @param cwd the session's working directory from the hook payload, when it carried one
 * @returns the first uncovered whole-tree run, or `not-whole-tree`
 */
export function classifyWholeTreeCheck({ command, cwd }: { command: string; cwd?: string }): WholeTreeCheck {
  return walkLine({ line: command, walk: { covered: false, cwd, depth: 0 } });
}

/**
 * Walk one command line's segments in order, following `cd` and every nested command source.
 *
 * @param line the command line
 * @param walk where the walk is
 * @returns the first uncovered whole-tree run, or `not-whole-tree`
 */
function walkLine({ line: raw, walk }: { line: string; walk: Walk }): WholeTreeCheck {
  if (walk.depth > MAX_DEPTH) {
    return { kind: "whole-tree", what: `a command nested more than ${MAX_DEPTH} levels deep, unread` };
  }
  // The shell removes a backslash-newline before it reads a word, so `yarn \\<newline> typecheck` is one command
  //. Removed everywhere, single quotes included: at worst data reads as a command.
  const line = raw.replaceAll("\\\n", "");
  let cwd = walk.cwd;
  let previous: ShellSeparator | undefined;
  for (const [segmentIndex, segment] of commandSegments({ command: line }).entries()) {
    const covered =
      walk.covered || hasCommandSegmentOverride({ command: line, name: WHOLE_TREE_CHECK_HATCH, segmentIndex });
    const step = walkSegment({ covered, previous, segment, walk: { ...walk, cwd } });
    if (step.kind === "whole-tree") {
      return step;
    }
    ({ cwd } = step);
    previous = segment.separatorAfter;
  }
  return NOT_WHOLE_TREE;
}

/** One step of the walk: a whole-tree run found, or the directory the walk is left in. */
type Step =
  Extract<WholeTreeCheck, { kind: "whole-tree" }> | { readonly kind: "walked"; readonly cwd: string | undefined };

/**
 * Walk one segment: its command substitutions, then each command list a bare `&` separates.
 *
 * @param segment the segment and the separator after it
 * @param previous the separator before it, since a piped `cd` runs in a subshell of its own
 * @param covered whether an inline hatch covers this segment's first command list
 * @param walk where the walk is, the hatch the segment's substitutions inherit included
 * @returns the first uncovered whole-tree run, or the directory the segment leaves
 */
function walkSegment({
  covered,
  previous,
  segment,
  walk,
}: {
  covered: boolean;
  previous: ShellSeparator | undefined;
  segment: CommandSegment;
  walk: Walk;
}): Step {
  const { words, substitutions } = shellWords({ text: segment.command });
  // An unquoted heredoc body expands its `$(…)` whatever reads it.
  const expanded = segment.heredocs.filter((heredoc) => !heredoc.quoted);
  const bodies = expanded.flatMap((heredoc) => bodySubstitutions({ body: heredoc.body }));
  // A literal here-string is the source a shell reading stdin runs: `bash <<< 'yarn typecheck'`. Read only when a shell sits where a command starts, so `grep bash <<<` stays data.
  const shellNamed = backgroundLists({ text: segment.command }).some((list) => shellAtAStart({ words: list }));
  const sources = shellNamed ? hereStrings({ words }) : [];
  for (const inner of [...substitutions, ...bodies, ...sources]) {
    const nested = walkLine({ line: inner, walk: { ...walk, depth: walk.depth + 1 } });
    if (nested.kind === "whole-tree") {
      return nested;
    }
  }
  let cwd = walk.cwd;
  const lists = backgroundLists({ text: segment.command });
  for (const [at, list] of lists.entries()) {
    // Only a move the next command depends on is certain: one backgrounded, piped, `||`- or `;`-joined
    // may not have happened in this shell, nor may one a `||` before it skips, and an
    // unknown directory is read as a Slopweaver one.
    const certain = at === lists.length - 1 && segment.separatorAfter === "&&" && previous !== "|" && previous !== "||";
    // A hatch before a bare `&` covers only the command it prefixes.
    const text = list.map((word) => word.text).join(" ");
    const own = at === 0 ? covered : hasInlineEnvironmentOverride({ command: text, name: WHOLE_TREE_CHECK_HATCH });
    const step = walkList({ certain, list, walk: { covered: walk.covered || own, cwd, depth: walk.depth } });
    if (step.kind === "whole-tree") {
      return step;
    }
    ({ cwd } = step);
  }
  // A subshell closed here: whatever it moved into is gone, and where it started is not tracked. A substitution
  // and a `f()` function head close no subshell; a `case` pattern still reads as one, a false refusal of
  // another project's own script only.
  const closed = words.some(
    (word) => !word.quoted && !word.dynamic && !word.text.includes("()") && word.text.includes(")"),
  );
  return { cwd: closed ? undefined : cwd, kind: "walked" };
}

/**
 * Walk one command list: the backstop from every command position, then the program it leads with.
 *
 * @param list the list's words, redirections removed
 * @param certain whether a directory move here is one the next segment certainly runs after
 * @param walk where the walk is
 * @returns the first uncovered whole-tree run, or the directory the list leaves
 */
function walkList({ certain, list, walk }: { certain: boolean; list: readonly ShellWord[]; walk: Walk }): Step {
  // `NODE_OPTIONS=--require=<tsc.js>` preloads the compiler into whatever Node runs.
  const preload = nodeOptionsNameModule({ pattern: TSC_SCRIPT, words: list })
    ? lane({ what: tscLane({ args: [] }) })
    : NOT_WHOLE_TREE;
  const backstop = preload.kind === "whole-tree" ? preload : judgeAnyPosition({ walk, words: list });
  if (backstop.kind === "whole-tree" && !walk.covered) {
    return backstop;
  }
  const words = withoutSubshellClose({ words: list });
  const resolved = resolveProgram({ words });
  if (resolved.kind !== "program") {
    return { cwd: walk.cwd, kind: "walked" };
  }
  if (DIRECTORY_BUILTINS.has(resolved.words[0]!.text)) {
    return { cwd: certain ? directoryAfter({ from: walk.cwd, words: resolved.words }) : undefined, kind: "walked" };
  }
  const cwd = wrappedDirectory({ from: walk.cwd, program: resolved.words, words });
  const fed = fedByXargs({ from: words, program: resolved.words });
  const judged = judgeProgram({ walk: { ...walk, cwd, fed }, words: resolved.words });
  if (judged.kind === "whole-tree" && !walk.covered) {
    return judged;
  }
  return { cwd: walk.cwd, kind: "walked" };
}

/**
 * The backstop under the grammar: judge the words from every place a command can START
 * (`./commandPositions.ts`), not only the one a list leads with — `case x in x) yarn typecheck;; esac`,
 * `if …; then`, `time`, `xargs`, `find -exec`. A watched name in ARGUMENT position is not judged: `pgrep
 * -f tsgolint` is how a seat finds the load, and a real one ran exactly that while this was being built.
 *
 * @param words one command list's words, a subshell's parentheses still on them
 * @param walk where the walk is
 * @returns the first whole-tree run found from a command position, or `not-whole-tree`
 */
function judgeAnyPosition({ words, walk }: { words: readonly ShellWord[]; walk: Walk }): WholeTreeCheck {
  // A program a wrapper start already reached is judged there, in the directory the wrapper moved it to:
  // `env -C /tmp/app yarn build` never re-judges `yarn build` from its own start.
  const reached = new Set<number>();
  for (const at of commandStarts({ words })) {
    const payload = wrapperPayload({ words: words.slice(at) });
    const split =
      payload === undefined ? NOT_WHOLE_TREE : walkLine({ line: payload, walk: { ...walk, depth: walk.depth + 1 } });
    if (split.kind === "whole-tree") {
      return split;
    }
    // Resolved from each start, so a wrapper or assignment there (`x) env yarn typecheck`) is peeled by the
    // same grammar the leading-program walk uses.
    const from = withoutSubshellClose({ words: words.slice(at) });
    const resolved = resolveProgram({ words: from });
    if (resolved.kind !== "program" || reached.has(at)) {
      continue;
    }
    reached.add(at + from.length - resolved.words.length);
    if (!WATCHED_PROGRAMS.has(baseName({ word: resolved.words[0]!.text }))) {
      continue;
    }
    const cwd = wrappedDirectory({ from: walk.cwd, program: resolved.words, words: from });
    const fed = fedByXargs({ from, program: resolved.words });
    const judged = judgeProgram({ walk: { ...walk, cwd, fed }, words: resolved.words });
    if (judged.kind === "whole-tree") {
      return judged;
    }
  }
  return NOT_WHOLE_TREE;
}

/** Whether a shell is the program at any place a command starts, wrappers peeled. */
function shellAtAStart({ words }: { words: readonly ShellWord[] }): boolean {
  return commandStarts({ words }).some((at) => {
    const resolved = resolveProgram({ words: withoutSubshellClose({ words: words.slice(at) }) });
    return resolved.kind === "program" && SHELLS.has(baseName({ word: resolved.words[0]!.text }));
  });
}

/** The program's own name, without the directory it was invoked from. */
function baseName({ word }: { word: string }): string {
  return word.slice(word.lastIndexOf("/") + 1);
}

/**
 * Judge one resolved program and its arguments.
 *
 * @param words the program word first, then its arguments
 * @param walk where the walk is
 * @returns the whole-tree run these words are, or `not-whole-tree`
 */
function judgeProgram({ words, walk }: { words: readonly ShellWord[]; walk: Walk }): WholeTreeCheck {
  const head = words[0];
  if (head === undefined || head.dynamic) {
    return NOT_WHOLE_TREE;
  }
  const program = baseName({ word: head.text });
  const args = words.slice(1);
  const texts = args.map((word) => word.text);
  if (SHELLS.has(program)) {
    const input = shellInput({ args });
    return input.kind === "payload"
      ? walkLine({ line: input.line, walk: { ...walk, depth: walk.depth + 1 } })
      : NOT_WHOLE_TREE;
  }
  if (program === "eval") {
    // `eval -- yarn typecheck`: `--` ends eval's options and is never the command.
    const line = texts[0] === "--" ? texts.slice(1) : texts;
    return walkLine({ line: line.join(" "), walk: { ...walk, depth: walk.depth + 1 } });
  }
  if (RUNNERS.has(program)) {
    return judgeRunner({ args, program, walk });
  }
  if (program === "slopweaver") {
    return judgeSlopweaver({ args: texts });
  }
  if (program === "node" || program === "tsx") {
    return judgeNodeHost({ args, program, walk });
  }
  return lane({ what: checkToolLane({ args, cwd: walk.cwd, fed: walk.fed === true, program }) });
}

/**
 * `node --run <script>` is a package runner and judged as one; any other `node`/`tsx` run is a script host.
 *
 * @param args the words after the program
 * @param program `node` or `tsx`
 * @param walk where the walk is
 * @returns the whole-tree run it is, or `not-whole-tree`
 */
function judgeNodeHost({
  args,
  program,
  walk,
}: {
  args: readonly ShellWord[];
  program: string;
  walk: Walk;
}): WholeTreeCheck {
  const script = program === "node" ? nodeRunScript({ args }) : undefined;
  if (script !== undefined) {
    return judgeRunnerScript({ run: { cwd: walk.cwd, scriptArgs: script.slice(1), words: script }, walk });
  }
  return judgeScriptHost({ args, cwd: walk.cwd, fed: walk.fed === true, host: program });
}

/**
 * A package-manager front end: the script or program it resolves to (`./runnerInvocation.ts`), judged in the
 * directory it runs in.
 *
 * @param args the words after the front end
 * @param program which front end, since npm hands a script its words differently
 * @param walk where the walk is
 * @returns the whole-tree run they are, or `not-whole-tree`
 */
function judgeRunner({
  args,
  program,
  walk,
}: {
  args: readonly ShellWord[];
  program: string;
  walk: Walk;
}): WholeTreeCheck {
  // A `-c` may be the program's own flag rather than the front end's call — `npx prettier -c src` is
  // Prettier's check — so the call and every script reading are each judged, and either refuses. A reading
  // that takes the call's own payload for the program is skipped: that payload is a command line, walked
  // above, and `npx -c 'ls node_modules/.bin/tsc'` names tsc only as `ls`'s argument.
  const call = runnerCall({ args, program });
  const called =
    call === undefined ? NOT_WHOLE_TREE : walkLine({ line: call, walk: { ...walk, depth: walk.depth + 1 } });
  if (called.kind === "whole-tree") {
    return called;
  }
  // By position, never by spelling: in `npx prettier -c prettier .` the program shares the payload's text.
  const flagAt = args.findIndex((word) => word.text === "-c" || word.text === "--call");
  const payload = call !== undefined && flagAt !== -1 ? args[flagAt + 1] : undefined;
  const readings = runnerScripts({ args, cwd: walk.cwd, program }).filter((run) => run.words[0] !== payload);
  for (const run of readings) {
    const judged = judgeRunnerScript({ run, walk });
    if (judged.kind === "whole-tree") {
      return judged;
    }
  }
  return NOT_WHOLE_TREE;
}

/**
 * One reading of what a front end runs: a whole-tree `package.json` script, `yarn lint`'s tail, or a program.
 *
 * @param run the script or program, where it runs, and what it is handed
 * @param walk where the walk is
 * @returns the whole-tree run it is, or `not-whole-tree`
 */
function judgeRunnerScript({ run, walk }: { run: RunnerScript; walk: Walk }): WholeTreeCheck {
  const script = run.words[0]!.text;
  const ours = ownsScriptNames({ cwd: run.cwd });
  const whole = ours ? WHOLE_TREE_SCRIPTS[script] : undefined;
  // `yarn typecheck --help` appends to the script's own `tsc`, which then prints and checks nothing.
  const prints =
    (script === "typecheck" || script === "build") &&
    tscScope({ args: run.scriptArgs.map((word) => word.text) }) === "prints";
  if (whole !== undefined && !prints) {
    return { kind: "whole-tree", what: whole };
  }
  if (whole !== undefined) {
    return NOT_WHOLE_TREE;
  }
  if (ours && script === "lint") {
    return judgeDevLint({ args: run.scriptArgs.map((word) => word.text), label: "yarn lint" });
  }
  if (ours && script.startsWith("test:")) {
    const args = run.scriptArgs.map((word) => word.text);
    return lane({ what: testScriptLane({ args, cwd: run.cwd, fed: walk.fed === true, script }) });
  }
  // Read as typed, and by the words npm hands the script past `--`: `npm run slopweaver -- dev lint`.
  const typed = judgeProgram({ walk: { ...walk, cwd: run.cwd }, words: run.words });
  const handed = judgeProgram({ walk: { ...walk, cwd: run.cwd }, words: [run.words[0]!, ...run.scriptArgs] });
  return typed.kind === "whole-tree" ? typed : handed;
}
