/**
 * The reader end of the brief-path rule: a seat never scans the disk for a path a brief named.
 *
 * ## What this refuses, and why it is the second half rather than the only half
 *
 * `../handover/briefPaths.ts` stops a chair writing an unrootable path into a brief. This stops the seat
 * paying for one that got through — and one always will, because a brief is only one of the ways a path
 * reaches a session. The measured cost of the case that produced this gate: a seat ran a breadth-first scan
 * from `/` for a nested `supervisor-scratch/` file, three cores for eleven minutes, for a file that was one
 * `ls $SLOPWEAVER_HOME/supervisor-scratch` away.
 *
 * ## The criterion
 *
 * A `find` or `bfs` whose first path operand, after `~` and `$HOME` expansion, IS `/`, IS the home
 * directory, or IS the directory homes live in (`/Users`, `/home`). Equality, never containment: a
 * DESCENDANT of the home directory is ordinary bounded work, and `find "$HOME/dev/personal/slopweaver"`
 * refused would be this gate overreaching rather than protecting anything.
 *
 * **`-maxdepth` of 2 or less allows it through.** A bounded walk cannot produce the harm the gate exists to
 * stop, and refusing `find / -maxdepth 1` would be a false positive with no safety to show for it.
 * Deliberately no attempt is made to read `-prune`, `-xdev` or `-newer`: each is a real bound, and each is
 * a shell-semantics problem rather than a word-level one. The hatch is the honest answer there, and it
 * names that case.
 *
 * ## The second row: an unbounded SEARCH
 *
 * One seat's sub-agents ran shell greps over `$SLOPWEAVER_HOME/corpus/bronze/<source>/compact.jsonl` —
 * single files of 1 to 17.5 GB — in the background with ten-minute timeouts, and six of them held the owner's machine
 * at 0% idle for an hour (`../live/machine/runawaySearch.ts` is the backstop that ends one). So a `grep`-family
 * search or `rg` is refused when:
 *
 * - **any path operand sits inside `<state home>/corpus`** — containment, not equality, because the cost is
 *   the corpus's FILES. The corpus is read through `slopweaver store cite|read`, which the refusal names; or
 * - **it recurses and a path operand IS `/`, the home directory, `/Users`, `/home` or the state home** — the
 *   same equality rule as the scanners, so `grep -r x ~/dev/personal/slopweaver` stays ordinary work.
 *   Only the `grep` family: a root-level `rg` respects ignore files and is out for the reason below.
 *
 * Which words are paths is `./searchWords.ts`'s, by each program's own option grammar. A search reading
 * stdin names no path and is never refused, so `tail -F log | grep --line-buffered x` passes.
 *
 * ## Both hatches open per SEGMENT, inline
 *
 * A gate runs in the hook's process, so a `NAME=1 cmd` prefix is not in its environment. Each segment is
 * judged with its own inline override read off the command (`hasCommandSegmentOverride`), as the raw-bash and
 * whole-tree gates do; before that, the refusal's own `SLOPWEAVER_ALLOW_DISK_WIDE_SCAN=1 find /` opened nothing.
 *
 * ## What stays OUT, and why that is a decision rather than an omission
 *
 * `rg` and `fd` respect ignore files, are parallel, and are typically two orders of magnitude faster — a
 * root-level `rg` is unwise but it is not the eleven-minute shape, so the refusal's answer to "where is this file"
 * is `rg --files <folder> -g '*<name>*'` over ONE folder the file is likely in. Never `mdfind`: Spotlight is off on
 * the owner's machine (`docs/spotlight-and-worktrees.md`), where it answers nothing rather than refusing, and an empty
 * answer reads exactly like a file that is not there. `ls -R /` and `du -sh /` are the same class in principle and are out only because each
 * carries its own flag grammar. A search run from INSIDE the corpus by a relative path (`cd corpus && grep -r
 * x .`), under any command wrapper (`xargs`, `nice`, `timeout`, `command`, `env`, `exec`), or through a tilde
 * form other than `~` and `~/` (`~user/…`, `~+`, `~-`) is not seen — a `timeout` is a bound
 * anyway — and the runaway reaper is what catches one that gets through.
 */
import { isAbsolute, resolve } from "node:path";

import { searchWords } from "./searchWords.js";
import { type ShellWord, shellWords, splitOperators, withoutRedirections } from "./shellLexing.js";
import { commandSegments, hasCommandSegmentOverride } from "./shellSegments.js";

/** The ambient hatch this gate is opened with — declared as `disk-wide-scan` in `../hatch/registry.ts`. */
const DISK_WIDE_SCAN_HATCH = "SLOPWEAVER_ALLOW_DISK_WIDE_SCAN";

/** The hatch for the search row — declared as `unbounded-search` in `../hatch/registry.ts`. */
const UNBOUNDED_SEARCH_HATCH = "SLOPWEAVER_ALLOW_UNBOUNDED_SEARCH";

/** A word that is a shell variable assignment prefixing the command, e.g. `SLOPWEAVER_ALLOW_POLL=1`. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;

/** The two programs that walk a directory tree breadth- or depth-first, reading every inode as they go. */
const SCANNERS = new Set(["find", "bfs"]);

/**
 * `find`'s own leading options, which sit BEFORE the path operands. A closed set rather than "any word
 * starting with `-`": the expression primaries (`-name`, `-type`, `-newer`) also start with a dash, and
 * skipping those as options would read `find -name x`'s pattern as a path to scan.
 */
const LEADING_OPTIONS = new Set(["-H", "-L", "-P", "-E", "-X", "-s", "-x", "-d", "-f"]);

/**
 * A `-maxdepth` at or below this many levels bounds the walk enough that this gate has nothing to protect.
 *
 * @internal — the boundary {@link classifyDiskScan} applies; named so its own test can assert both sides.
 */
export const BOUNDED_MAXDEPTH = 2;

/** The directories a machine's home directories live directly inside. */
const HOME_PARENTS = new Set(["/Users", "/home"]);

/**
 * What this gate made of one call.
 *
 * @internal — the classifier's own return shape; `./diskScanGuardRunner.ts` is the public surface.
 */
export type DiskScan =
  | { readonly kind: "not-scan" }
  | { readonly kind: "scan"; readonly binary: string; readonly root: string }
  | { readonly kind: "search"; readonly binary: string; readonly target: string; readonly scope: "corpus" | "home" };

/**
 * Expand the home-directory spellings a shell would, and drop a trailing slash so `~/` and `~` agree.
 *
 * @param operand the path operand as written
 * @param homeDir the session's home directory
 * @returns the operand with `~` and `$HOME` resolved, without a trailing slash (except for `/` itself)
 */
export function expandHomeOperand({ operand, homeDir }: { operand: string; homeDir: string }): string {
  let expanded = operand;
  if (expanded === "~") {
    expanded = homeDir;
  } else if (expanded.startsWith("~/")) {
    expanded = homeDir + expanded.slice(1);
  } else if (expanded === "$HOME" || expanded === "${HOME}") {
    expanded = homeDir;
  } else if (expanded.startsWith("$HOME/")) {
    expanded = homeDir + expanded.slice("$HOME".length);
  } else if (expanded.startsWith("${HOME}/")) {
    expanded = homeDir + expanded.slice("${HOME}".length);
  }
  if (expanded.length > 1 && expanded.endsWith("/")) {
    return expanded.slice(0, -1);
  }
  return expanded;
}

/**
 * Whether an already-expanded operand names a root whose walk is the whole machine or the whole home.
 *
 * @param root the expanded operand
 * @param homeDir the session's home directory
 * @returns true when walking it is the shape this gate refuses
 */
function isWholeWorldRoot({ root, homeDir }: { root: string; homeDir: string }): boolean {
  if (root === "/") {
    return true;
  }
  if (root === homeDir) {
    return true;
  }
  return HOME_PARENTS.has(root);
}

/**
 * The path operands of one already-split scanner command: the words after the program and its leading
 * options, up to the first word of the expression.
 *
 * @param words the command's words, with redirections already removed, program included
 * @returns the operands in order, empty when the command relies on the implicit `.`
 */
function pathOperands({ words }: { words: readonly string[] }): readonly string[] {
  const operands: string[] = [];
  let index = 1;
  while (index < words.length && LEADING_OPTIONS.has(words[index]!)) {
    index += 1;
  }
  while (index < words.length) {
    const word = words[index]!;
    if (word.startsWith("-") || word === "(" || word === "!" || word === ",") {
      return operands;
    }
    operands.push(word);
    index += 1;
  }
  return operands;
}

/**
 * The `-maxdepth` a command declares, when it declares one this gate can read.
 *
 * @param words the command's words
 * @returns the declared depth, or undefined when there is none or it is not a plain integer
 */
function declaredMaxDepth({ words }: { words: readonly string[] }): number | undefined {
  const at = words.indexOf("-maxdepth");
  if (at === -1 || at + 1 >= words.length) {
    return undefined;
  }
  const value = words[at + 1]!;
  if (!/^\d+$/u.test(value)) {
    return undefined;
  }
  return Number.parseInt(value, 10);
}

/**
 * Classify one shell command line: does any segment of it walk the whole disk or the whole home?
 *
 * Built on `./shellSegments.ts` and `./shellLexing.ts` rather than a regex, so `cd /tmp && find / -name x`
 * is seen, `echo find /` is not, and a quoted `"$HOME"` arrives with its expansion text intact.
 *
 * A row's hatch opens only that row, and only where it is set: in the hook's own environment (`env`), or
 * inline on the segment that carries the refusable command — never a later segment's.
 *
 * @param command the raw `Bash` command
 * @param homeDir the session's home directory
 * @param stateHome the resolved `$SLOPWEAVER_HOME`, whose `corpus` the search row protects
 * @param cwd the payload's working directory, which a relative operand resolves against; `undefined` leaves
 *   a relative operand unresolved, so it can never match the corpus or a root
 * @param env the hook process's environment, for each row's ambient hatch
 * @returns the first refusable scan or search whose own hatch is closed, or `not-scan`
 */
export function classifyDiskScan({
  command,
  homeDir,
  stateHome,
  cwd,
  env,
}: {
  command: string;
  homeDir: string;
  stateHome: string;
  cwd: string | undefined;
  env: Readonly<Record<string, string | undefined>>;
}): DiskScan {
  const segments = commandSegments({ command });
  for (const [segmentIndex, segment] of segments.entries()) {
    // A redirection glued to an operand, `grep -r x />out`, is cut off it first.
    const split = splitOperators({ words: shellWords({ text: segment.command }).words });
    const lexed = withoutRedirections({ words: split }).map((word) => literalWord({ word }));
    const firstCommandWord = lexed.findIndex((word) => !ASSIGNMENT.test(word));
    const words = firstCommandWord === -1 ? [] : lexed.slice(firstCommandWord);
    const pipedInto = segments[segmentIndex - 1]?.separatorAfter === "|";
    const judged = judgeSegment({ context: { cwd, homeDir, pipedInto, stateHome }, words });
    if (judged.kind === "not-scan") {
      continue;
    }
    const hatch = judged.kind === "scan" ? DISK_WIDE_SCAN_HATCH : UNBOUNDED_SEARCH_HATCH;
    const open = env[hatch] === "1" || hasCommandSegmentOverride({ command, name: hatch, segmentIndex });
    if (!open) {
      return judged;
    }
  }
  return { kind: "not-scan" };
}

/**
 * What a `$` the shell will NOT expand becomes, so no variable substitution can match it: a fullwidth dollar,
 * which no corpus or home path carries, so a word holding one is read as the literal path it names.
 */
const LITERAL_DOLLAR = "＄";

/**
 * A word's text, with each `~` and `$` the shell does NOT expand kept literal. Only an unquoted leading `~`
 * expands, so `grep -r x '~/.slopweaver/corpus'` searches a directory named `~` under the cwd; and
 * a word whose every `$` is single-quoted or escaped is not `dynamic` to the lexer, so
 * `grep x '$SLOPWEAVER_HOME/corpus'` reads a directory of that name. A word mixing a quoted `$` with
 * an expanding one is read as all expanding.
 */
function literalWord({ word }: { word: ShellWord }): string {
  const text = word.dynamic ? word.text : word.text.replaceAll("$", LITERAL_DOLLAR);
  if (text.startsWith("~") && !word.unquotedPrefix.startsWith("~")) {
    return `./${text}`;
  }
  return text;
}

/** What a segment is judged against besides its own words. */
interface SegmentContext {
  readonly homeDir: string;
  readonly stateHome: string;
  readonly cwd: string | undefined;
  /** The segment reads a `|` from the one before it, so a search with no path operand reads that, not a tree. */
  readonly pipedInto: boolean;
}

/** `$HOME`, `$SLOPWEAVER_HOME` and their braced spellings, never a longer name such as `$HOMEBREW_PREFIX`. */
const KNOWN_VARIABLE = /\$(?:\{(?:HOME|SLOPWEAVER_HOME)\}|(?:HOME|SLOPWEAVER_HOME)(?![A-Za-z0-9_]))/gu;

/**
 * Resolve the two variables this gate knows wherever they sit in the word — `/$SLOPWEAVER_HOME/corpus` is the
 * corpus — then a leading `~`, then a relative path against the payload's cwd. An absolute result
 * is NORMALISED, so `$SLOPWEAVER_HOME//corpus` and `/./` segments are the path the OS opens.
 * Lexical only: a symlink into the corpus, or a variable this does not know, stays unseen.
 *
 * @param operand the path operand as written, a quoted `$` already made literal by {@link literalWord}
 * @param context the homes and cwd it resolves against
 * @returns the operand resolved as far as words allow, without a trailing slash
 */
function expandOperand({ operand, context }: { operand: string; context: SegmentContext }): string {
  const { homeDir, stateHome, cwd } = context;
  const substituted = operand.replace(KNOWN_VARIABLE, (match) =>
    match.includes("SLOPWEAVER_HOME") ? stateHome : homeDir,
  );
  const expanded = expandHomeOperand({ homeDir, operand: substituted });
  if (isAbsolute(expanded)) {
    return resolve(expanded);
  }
  if (cwd === undefined || expanded.startsWith("$")) {
    return expanded;
  }
  return resolve(cwd, expanded);
}

/**
 * Judge one search: inside the corpus at any depth, or recursing from a whole-world root or the state home.
 * A recursive search naming no path walks its cwd — unless it reads a pipe, where it searches that instead.
 *
 * @param words the segment's words, program first
 * @param context the homes, cwd and pipe position it is judged against
 * @returns the refusable search, or `not-scan` — including when the program is no search at all
 */
function judgeSearch({ words, context }: { words: readonly string[]; context: SegmentContext }): DiskScan {
  const search = searchWords({ words });
  if (search === undefined) {
    return { kind: "not-scan" };
  }
  const { homeDir, stateHome } = context;
  const corpus = resolve(expandHomeOperand({ homeDir, operand: `${stateHome}/corpus` }));
  const home = resolve(expandHomeOperand({ homeDir, operand: stateHome }));
  let operands = search.paths;
  if (operands.length === 0 && search.recursive && !context.pipedInto) {
    operands = ["."];
  }
  const targets = operands.map((operand) => expandOperand({ context, operand }));
  const inCorpus = targets.find((target) => target === corpus || target.startsWith(`${corpus}/`));
  if (inCorpus !== undefined) {
    return { binary: search.binary, kind: "search", scope: "corpus", target: inCorpus };
  }
  if (!search.recursive || search.binary === "rg") {
    return { kind: "not-scan" };
  }
  const wide = targets.find((target) => target === home || isWholeWorldRoot({ homeDir, root: target }));
  if (wide === undefined) {
    return { kind: "not-scan" };
  }
  return { binary: search.binary, kind: "search", scope: "home", target: wide };
}

/**
 * Judge ONE command segment's words.
 *
 * Its own function rather than the loop body, so the loop reads as "any segment" and this reads as the
 * criterion — which is also what keeps either of them under the cognitive-complexity ceiling.
 *
 * @param words the segment's words, redirections and leading assignments removed, program first
 * @param context the homes, cwd and pipe position it is judged against
 * @returns the refusable scan or search this segment is, or `not-scan`
 */
function judgeSegment({ words, context }: { words: readonly string[]; context: SegmentContext }): DiskScan {
  const program = words[0];
  if (program === undefined) {
    return { kind: "not-scan" };
  }
  const binary = program.slice(program.lastIndexOf("/") + 1);
  if (!SCANNERS.has(binary)) {
    return judgeSearch({ context, words });
  }
  const { homeDir } = context;
  const depth = declaredMaxDepth({ words });
  if (depth !== undefined && depth <= BOUNDED_MAXDEPTH) {
    return { kind: "not-scan" };
  }
  const offending = pathOperands({ words })
    .map((operand) => expandHomeOperand({ homeDir, operand }))
    .find((root) => isWholeWorldRoot({ homeDir, root }));
  if (offending === undefined) {
    return { kind: "not-scan" };
  }
  return { binary, kind: "scan", root: offending };
}
