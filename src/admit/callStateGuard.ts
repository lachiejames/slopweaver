/**
 * Refuses a `Bash` command that would delete, move or overwrite the console-voice call state of a LIVE home.
 *
 * A call file is the owner's words. `talk/calls/<id>.jsonl` is append-only, `talk/call-index.txt` and each
 * `talk/unread-cursors/<name>.json` are the witnesses that a call existed, and `talk/call-quarantine.jsonl` records
 * every loss accepted past them. `talk/threads/<id>.jsonl` (and its `.part-NNNNNN` files) is each call's Codex thread
 * journal, the only record of what an ephemeral thread was told and read (`../talk/callThreadStore.ts`). Nothing in
 * Slopweaver deletes any of them, so a command that would is the defect.
 * MEASURED: a seat ran one `rm` of seven call files under the real home by hand to clean up its
 * own e2e test calls; four were unrecoverable, and every `talk unread` was refused until `talk quarantine` existed
 * (`../talk/callQuarantineLedger.ts`). Tests are fenced off the real home already (`setup-ambient-home.ts`); this is
 * the hand-run half.
 *
 * ## The criterion, per command segment
 *
 * `./callStateOperands.ts` names the words a segment's program removes, moves or overwrites, and this adds every
 * truncating output redirection's target (`>`, `&>`, with a descriptor or not — never `>>`). Each is resolved
 * against the segment's directory and refused when it IS a protected path, lies under one, or is an ANCESTOR of one
 * (`rm -rf ~/.slopweaver/talk`). A `git clean` that is not a dry run is judged on the directory it cleans.
 *
 * An unquoted glob or brace is matched component by component against each protected path — `*`, `?`, a bracket
 * class, a comma brace, nested or not, and a sequence brace read as any text (`./globComponent.ts`, linear and never
 * backtracking) — so
 * `talk/calls/{a,b}.jsonl` and `talk/call-*.txt` are caught and `talk/relays*.jsonl` is not; a quoted glob character
 * is literal. A brace whose body holds a `/` expands to paths of different depths, so the directory above it is judged
 * instead (`rm -rf {talk/calls,other}` in a home reaches its call state). Matching ignores case, as the owner's Mac's filesystem does. The protected homes are the caller's: the runner
 * passes the environment's `$SLOPWEAVER_HOME` and the account default, so a process pointed at a throwaway home still
 * guards the live one, and a test's throwaway home is never one of them.
 *
 * ## Fails OPEN, like every workflow guard beside it
 *
 * An expansion other than a leading `~`, `$HOME`, `$SLOPWEAVER_HOME` or `$PWD` reads as `*` from the directory written
 * before it (`./callStatePattern.ts`), so a variable delete run inside a home, or above one, is refused.
 *
 * Not judged: a process substitution; a leading variable split across quoting (`$HOM"E"`); a directory
 * the static resolver cannot follow (`./mainCheckoutCommandTarget.ts`), though a `cd` into a home it can
 * (`./homeCdTarget.ts`: `cd ~/.slopweaver/talk/calls && rm x.jsonl` is judged there); extglob at or above a protected path (below one, `@(…)` reads as literals around a glob and is
 * refused, since whatever it matches lies inside call state); a path reached through a filesystem alias — a symlink or a
 * hard link (`cd <home> && truncate -s 0 <link to the index>`) — since resolution here is lexical and never
 * reads an inode; and everything
 * `./callStateOperands.ts` lists. The `Write` and `Edit` tools are not `Bash` and never reach it. A tripwire, not a
 * fence: its silence proves nothing.
 *
 * A command the shell would refuse to PARSE is judged as best the lexer reads it: a plain unclosed quote is allowed,
 * but an unclosed `$'…'` the lexer decodes to the end may be refused. Refusing a command that could never run costs
 * nothing, so this is residue rather than a defect. A variable name split across two adjacent quoted runs
 * (`"$H""OME"`) reads as the joined name and may be refused; a name split between quoted and unquoted text, or single
 * quoted, is unjudged. A heredoc body is data and never judged. Work is linear in the command's length — glob matching
 * never backtracks (`./globComponent.ts`).
 */
import { isAbsolute, resolve } from "node:path";

import { callQuarantinePath } from "../talk/callQuarantineLedger.js";
import { callIndexPath, callsDir } from "../talk/callStore.js";
import { threadsDir } from "../talk/callThreadDir.js";
import { unreadCursorsDir } from "../talk/unreadCursorStore.js";
import { commandPieces, LEADING_VARIABLE, unhatchedPieces } from "./callStateArgs.js";
import { judgedText } from "./callStateJudgedText.js";
import { destructiveOperands } from "./callStateOperands.js";
import { literal, patternTail, tildePattern } from "./callStatePattern.js";
import { beforeSlashBrace, globComponentMatches, globComponentReadable } from "./globComponent.js";
import { homeCdTarget, matchedVariable, userHome } from "./homeCdTarget.js";
import {
  hasSegmentInlineEnvironmentOverride,
  type MainCheckoutCommandTarget,
  resolveMainCheckoutCommandTargets,
} from "./mainCheckoutCommandTarget.js";
import { assignedEnvironments, inheritedAssignments } from "./shellAssignments.js";
import { type ShellWord, shellWords, splitOperators, truncatingTargets, withoutRedirections } from "./shellLexing.js";

/** The ambient hatch this gate is opened with — declared as `call-state-delete` in `../hatch/talkHatches.ts`. */
export const CALL_STATE_DELETE_HATCH = "SLOPWEAVER_ALLOW_CALL_STATE_DELETE";

/**
 * What a leading variable expands to: `$HOME` the user's home, `$SLOPWEAVER_HOME` the environment's, and `$PWD` the
 * directory the segment runs in (`cd <home>/talk/calls && rm "$PWD/x.jsonl"`), `undefined` when unknown.
 */
function variableValue({
  name,
  user,
  env,
  cwd,
}: {
  name: string;
  user: string;
  env: Readonly<Record<string, string | undefined>>;
  cwd: string | undefined;
}): string | undefined {
  if (name === "HOME") {
    return user;
  }
  return name === "PWD" ? cwd : env["SLOPWEAVER_HOME"];
}

/**
 * The call-state paths of one home: every one of them is a witness a read refuses without, or a call's only record.
 *
 * @param home a Slopweaver home
 * @returns the calls directory, the call index, the cursor directory, the quarantine ledger and the thread journals,
 *   absolute
 */
export function callStatePaths({ home }: { home: string }): readonly string[] {
  return [
    callsDir({ home }),
    callIndexPath({ home }),
    unreadCursorsDir({ home }),
    callQuarantinePath({ home }),
    threadsDir({ home }),
  ].map((path) => resolve(path));
}

/**
 * Whether a word's leading variable is written in one piece the shell expands: wholly unquoted, or wholly inside
 * quoting that holds an expansion (`"$HOME"`). A mix, or single quotes, is something else spelled the same.
 */
function spelledWhole({ word, length }: { word: ShellWord; length: number }): boolean {
  const shape = word.shape.slice(0, length);
  return shape === word.text.slice(0, length) || (word.dynamic && /^_+$/u.test(shape));
}

/** An operand opening on `$HOME` or `$SLOPWEAVER_HOME` as a path pattern, or `undefined` when it cannot be known. */
function variablePattern({
  word,
  variable,
  user,
  env,
  cwd,
}: {
  word: ShellWord;
  variable: RegExpExecArray;
  user: string;
  env: Readonly<Record<string, string | undefined>>;
  cwd: string | undefined;
}): string | undefined {
  if (!spelledWhole({ length: variable[0].length, word })) {
    // `$HOM"E"` expands `$HOM`, and `'$HOME'` nothing: the joined text is not the variable it reads as.
    return undefined;
  }
  const value = variableValue({ cwd, env, name: matchedVariable({ variable }), user });
  const rest = word.text.slice(variable[0].length);
  // A process substitution (`<(…)`) is no path; a further expansion is `*` from its directory on.
  if (value === undefined || value.trim() === "" || /[<>]\(/u.test(rest) || !/^(?:\/|$)/u.test(rest)) {
    return undefined;
  }
  return `${literal({ text: value })}${patternTail({ start: variable[0].length, word })}`;
}

/**
 * One operand as a path pattern, a leading `~`, `$HOME` or `$SLOPWEAVER_HOME` expanded. Shared with the
 * protected-path tripwire (`./protectedPathBash.ts`), which reads every word a command names this same way.
 *
 * @param word the operand
 * @param env the environment the two variables are read from
 * @param cwd the directory the segment runs in, which a leading `$PWD` names
 * @param oldPwd one directory a leading `~-` may name
 * @returns the pattern, possibly relative, or `undefined` when an expansion this cannot know is in it
 */
export function operandPattern({
  word,
  env,
  cwd,
  oldPwd,
}: {
  word: ShellWord;
  env: Readonly<Record<string, string | undefined>>;
  cwd: string | undefined;
  oldPwd: string | undefined;
}): string | undefined {
  const user = userHome({ env });
  const variable = LEADING_VARIABLE.exec(word.text);
  if (variable !== null) {
    return variablePattern({ cwd, env, user, variable, word });
  }
  // A slice of a word (an attached `>target`) keeps `dynamic` only for `$` or a backtick, so a process substitution
  // in it is looked for here too; any other expansion reads as `*` from its directory on.
  if (/[<>]\(/u.test(word.text)) {
    return undefined;
  }
  if (word.shape.startsWith("~")) {
    return tildePattern({ cwd, oldPwd, user, word });
  }
  return patternTail({ start: 0, word });
}

/**
 * Whether an absolute operand pattern names a protected path, something under one, or an ancestor of one.
 *
 * @param operand the absolute operand, glob characters a shell would read left unescaped
 * @param target one protected path
 * @returns whether removing what the operand names would reach the protected path
 */
export function reachesProtected({ operand, target }: { operand: string; target: string }): boolean {
  // The owner's Mac's filesystem ignores case, so `~/.SLOPWEAVER/talk` is the live home too; on a case-sensitive
  // one this only over-refuses.
  const ours = operand
    .toLowerCase()
    .split("/")
    .filter((part) => part !== "");
  const theirs = target
    .toLowerCase()
    .split("/")
    .filter((part) => part !== "");
  return componentsReach({ ours, theirs });
}

/**
 * Whether operand components reach target components, compared one at a time. A whole `**` component is read as
 * globstar, matching any number of them, on or off (`shopt -s globstar; rm a/**\/talk/call-index.txt`).
 */
function componentsReach({ ours, theirs }: { ours: readonly string[]; theirs: readonly string[] }): boolean {
  const [pattern, ...below] = ours;
  const [name, ...under] = theirs;
  if (pattern === undefined) {
    // The operand names the target or an ancestor of it.
    return true;
  }
  if (name === undefined) {
    // A component below the protected path that this cannot read is a pattern it cannot judge: fail open.
    return ours.every((part) => globComponentReadable({ pattern: part }));
  }
  if (pattern === "**") {
    return componentsReach({ ours: below, theirs }) || componentsReach({ ours, theirs: under });
  }
  return globComponentMatches({ name, pattern }) && componentsReach({ ours: below, theirs: under });
}

/** One refused segment: what it would have run, and the protected path it reaches. */
export interface CallStateHit {
  /** The segment's own text. */
  readonly segment: string;
  /** The operand as resolved, or the directory a `git clean` runs in. */
  readonly operand: string;
  /** The protected path it reaches. */
  readonly protectedPath: string;
  /**
   * Every OTHER operand of the same segment reaching a protected path, as resolved: a hatch exempts the whole segment,
   * so a refusal has to name all of them, never a throwaway first hit hiding a live second one.
   */
  readonly others: readonly string[];
}

/** Every absolute path pattern one segment would destroy, bar the commands a hatch armed on it covers. */
function segmentOperands({
  line,
  target,
  env,
  homes,
  hatchName,
}: {
  line: string;
  target: MainCheckoutCommandTarget;
  env: Readonly<Record<string, string | undefined>>;
  homes: readonly string[];
  hatchName: string;
}): readonly string[] {
  const { cwd, segmentIndex, shellCwd } = target;
  const oldPwds = env["OLDPWD"] === undefined ? target.visited : [...target.visited, env["OLDPWD"]];
  const hatched = hasSegmentInlineEnvironmentOverride({ command: line, name: hatchName, segmentIndex });
  const lexed = shellWords({ text: target.command });
  // A quote still open at the end is a command the shell refuses to parse, so nothing runs: unjudged.
  if (lexed.unterminated) {
    return [];
  }
  const pieces = commandPieces({ words: splitOperators({ words: lexed.words }) });
  return unhatchedPieces({ hatched, name: hatchName, pieces }).flatMap((words) =>
    pieceOperands({ cwd, env, homes, oldPwds, shellCwd, words }),
  );
}

/**
 * Every absolute path pattern one simple command of a segment would destroy. A git command that cleans or discards
 * from its directory reaches the whole repository holding it, so a live home holding any directory it judges is
 * judged too (`cd <home>/corpus && git reset --hard` resets the call files).
 */
function pieceOperands({
  words,
  cwd,
  shellCwd,
  env,
  homes,
  oldPwds,
}: {
  words: readonly ShellWord[];
  cwd: string | undefined;
  shellCwd: string | undefined;
  env: Readonly<Record<string, string | undefined>>;
  homes: readonly string[];
  oldPwds: readonly string[];
}): readonly string[] {
  const patterns = namedPatterns({ env, oldPwds, shellCwd, words });
  if (!patterns.cleansCwd) {
    return patterns.paths;
  }
  const roots = cwd === undefined ? patterns.paths : [...patterns.paths, cwd];
  const holding = homes.filter((home) => roots.some((root) => reachesProtected({ operand: home, target: root })));
  return [...roots, ...holding];
}

/**
 * The absolute path patterns one simple command names to destroy, and whether it cleans its own directory — every one
 * read from where the SHELL stands (`shellCwd`): a truncating redirection opens there before git moves, and a git's
 * pathspecs arrive already under its `-C` (`gitWorkTreeDestroyed` applies it, wrapped or not), so reading them from the
 * directory the segment resolver already moved would apply that `-C` twice.
 */
function namedPatterns({
  words,
  shellCwd,
  env,
  oldPwds,
}: {
  words: readonly ShellWord[];
  shellCwd: string | undefined;
  env: Readonly<Record<string, string | undefined>>;
  oldPwds: readonly string[];
}): { paths: readonly string[]; cleansCwd: boolean } {
  const destroyed = destructiveOperands({
    words: [...inheritedAssignments({ env }), ...withoutRedirections({ words })],
  });
  const cwd = shellCwd;
  const patterns = [...destroyed.words, ...truncatingTargets({ words })].flatMap((word) =>
    // A `~-` may name any directory the shell stood in before, so it is judged as each of them.
    (word.text.startsWith("~-") ? oldPwds : [undefined]).flatMap((oldPwd) => {
      const read = operandPattern({ cwd, env, oldPwd, word });
      const pattern = read === undefined ? undefined : beforeSlashBrace({ pattern: read });
      if (pattern === undefined || (cwd === undefined && !isAbsolute(pattern))) {
        return [];
      }
      // A relative pattern reaches here only with a directory to read it from.
      return [isAbsolute(pattern) ? resolve(pattern) : resolve(cwd!, pattern)];
    }),
  );
  return { cleansCwd: destroyed.cleansCwd, paths: patterns };
}

/**
 * The first segment of a `Bash` command that would delete, move or overwrite a live home's call state, or
 * `undefined` when none would.
 *
 * @param command the raw `Bash` command
 * @param cwd the directory the tool call runs in
 * @param homes the live homes to protect
 * @param env the environment `$HOME` and `$SLOPWEAVER_HOME` in an operand are expanded from
 * @returns the refused segment, or `undefined` to allow
 */
export function evaluateCallStateGuard({
  command,
  cwd,
  homes,
  env,
}: {
  command: string;
  cwd: string;
  homes: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
}): CallStateHit | undefined {
  return evaluateDestructiveReach({
    command,
    cwd,
    env,
    hatchName: CALL_STATE_DELETE_HATCH,
    homes,
    protectedPaths: [...new Set(homes)].flatMap((home) => callStatePaths({ home })),
  });
}

/**
 * The first segment of a `Bash` command that would delete, move or overwrite any of `protectedPaths` — the call-state
 * criterion above over a caller's own list, so the owner-protected path tripwire (`./protectedPathBash.ts`) judges a
 * `read-only` path's destruction by exactly these rules.
 *
 * @param command the raw `Bash` command
 * @param cwd the directory the tool call runs in
 * @param homes the directories a git clean-or-discard reaching inside them is judged as reaching whole
 * @param protectedPaths the absolute paths whose destruction is refused
 * @param hatchName the variable that, armed inline on a segment as `=1`, exempts it
 * @param env the environment `$HOME` and `$SLOPWEAVER_HOME` in an operand are expanded from
 * @returns the refused segment, or `undefined` to allow
 */
export function evaluateDestructiveReach({
  command,
  cwd,
  homes,
  protectedPaths,
  hatchName,
  env,
}: {
  command: string;
  cwd: string;
  homes: readonly string[];
  protectedPaths: readonly string[];
  hatchName: string;
  env: Readonly<Record<string, string | undefined>>;
}): CallStateHit | undefined {
  const text = judgedText({ command });
  // Judged under each environment the command's own assignments can leave (`./shellAssignments.ts`).
  for (const assigned of assignedEnvironments({ command: text, env })) {
    const hit = judgeUnder({ cwd, env: assigned, hatchName, homes, protectedPaths, text });
    if (hit !== undefined) {
      return hit;
    }
  }
  return undefined;
}

/** The first protected path one command reaches, its variables expanded from `env`. */
function judgeUnder({
  text,
  cwd,
  homes,
  protectedPaths,
  hatchName,
  env,
}: {
  text: string;
  cwd: string;
  homes: readonly string[];
  protectedPaths: readonly string[];
  hatchName: string;
  env: Readonly<Record<string, string | undefined>>;
}): CallStateHit | undefined {
  const targets = resolveMainCheckoutCommandTargets({
    cdPath: env["CDPATH"],
    command: text,
    cwd,
    expandCdTarget: (token) => homeCdTarget({ env, token }),
  });
  for (const target of targets) {
    const operands = segmentOperands({ env, hatchName, homes: [...new Set(homes)], line: text, target });
    const reaching = operands.flatMap((operand) => {
      const reached = protectedPaths.find((path) => reachesProtected({ operand, target: path }));
      return reached === undefined ? [] : [{ operand, reached }];
    });
    const [first, ...rest] = reaching;
    if (first !== undefined) {
      return {
        operand: first.operand,
        others: rest.map((hit) => hit.operand),
        protectedPath: first.reached,
        segment: target.command.trim(),
      };
    }
  }
  return undefined;
}
