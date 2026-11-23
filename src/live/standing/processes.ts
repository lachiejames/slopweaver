/**
 * Reading a standing session's two trees out of ONE process-table snapshot — pure.
 *
 * ## Why a snapshot rather than four reads
 *
 * Answering "which trees is this standing session on" needs a process's own argv, and its parent's, and a
 * sibling found by session id. Done as separate `ps` calls that is three or four subprocesses racing a fleet
 * that opens and closes sessions constantly, and each answer is about a slightly different instant. One
 * snapshot, folded by the pure functions here, is both cheaper and internally consistent — every fact in a
 * report is true of the same moment.
 *
 * ## Why the argv at all
 *
 * Because it is the only place the two facts actually live. A standing session's **bin** is the checkout whose
 * CLI entrypoint its own listener child is running, and its **plugin-dir** is the `--plugin-dir` its
 * `claude` process was launched with — neither is recorded in the scheduler registration, the session ledger
 * or cmux's workspace row, and measurement found them pointing at DIFFERENT worktrees on the same
 * live session (`./freshness.ts`'s header). An argv cannot go stale the way a recorded field can: it is what
 * the running process was actually started with.
 */
import type { CmuxProcess } from "../../cmux/client.js";
import { err, ok, type Result } from "../../lib/result.js";
import { ProcessTableErrors, type ProcessTableUnplaceableLineError } from "./processTableErrors.js";

/** One row of the process table — what `ps -ax -o pid=,ppid=,args=` prints, decoded. */
export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  /** The full command line, as printed. Never parsed into arguments — only matched against. */
  readonly argv: string;
}

/**
 * Decode a `ps -ax -o pid=,ppid=,args=` listing.
 *
 * A line that does not start with two integers is DROPPED rather than failing the whole read: `ps` wraps
 * nothing itself, but a process whose argv contains a newline (Claude Code's own `--settings` JSON is the
 * live example, and it is one of the processes this must find) would otherwise take the listing down with it.
 *
 * @param text the raw listing
 * @returns one row per decodable line, in the order `ps` printed them
 */
export function parseProcessRows({ text }: { readonly text: string }): readonly ProcessRow[] {
  return text
    .split("\n")
    .map((line) => decodeRow({ line }))
    .filter((row): row is ProcessRow => row !== undefined && row.argv.length > 0);
}

/** What `ps -o tty=` prints for a process with no controlling terminal: the cmux app itself, every daemon. */
export const NO_TTY = "??";

/** The shape a tab's tty name takes in `ps -o tty=`: `ttys` then digits, MEASURED as `ttys00N` per tab. */
const TTY_NAME = /^ttys\d+$/u;

/**
 * Whether a `tty=` token names a real pseudo-terminal the way macOS does: a token that is neither {@link NO_TTY} nor
 * a `ttys<N>` is a line the decoder split wrongly, never a tab (a `bogus` token accepted as a tab's tty would place every row on it).
 *
 * @param tty the token
 * @returns `true` for `ttys` followed by digits
 */
export function isTtyName({ tty }: { readonly tty: string }): boolean {
  return TTY_NAME.test(tty);
}

/** What `ps -o stat=` prints first for a process stopped by a signal (`SIGSTOP`, `SIGTSTP`): not at any prompt. */
export const STOPPED_STATE = "T";
/** What `ps -o stat=` prints first for a process that has exited and awaits its parent's `wait`: not at any prompt. */
export const ZOMBIE_STATE = "Z";
/**
 * What `ps -o stat=` prints first for a process on the CPU or runnable: a shell at its prompt sleeps in its line
 * editor, so a childless shell sampled here is running something that forked nothing. MEASURED: ten bare
 * shells on their ttys sampled `S`, `SN` or `S+`, and a spinning process sampled `R`.
 */
export const RUNNING_STATE = "R";

/**
 * One row of the process table WITH its controlling terminal and state — what `ps -ax -o pid=,ppid=,tty=,stat=,args=`
 * prints. The tty is the one fact `ps` holds about which TAB a process belongs to: MEASURED on cmux
 * 0.65.2, every process a tab runs — its `login`, its shell, the `claude` under it — shares one `ttys00N`, each tab its
 * own, and the app that owns them all is {@link NO_TTY}. The state is the one fact it holds about whether a childless
 * shell can be at its prompt at all: one `stat` token, `Ss`, `S+`, `SN`, `Z+`, `R` measured, {@link STOPPED_STATE}
 * first for a process a signal stopped, {@link ZOMBIE_STATE} first for one that has exited (a `SIGSTOP`ped shell, then a zombie one, would otherwise read as a prompt), and
 * {@link RUNNING_STATE} first for one on the CPU (a shell spinning in a builtin loop would otherwise read as a
 * prompt).
 */
export interface TtyProcessRow extends ProcessRow {
  readonly tty: string;
  /** The `stat` token as printed, its first letter the process state. */
  readonly state: string;
}

/**
 * Decode a `ps -ax -o pid=,ppid=,tty=,stat=,args=` listing keeping EVERY line. A line that does not start with two
 * integers, a tty and a state is the tail of the previous row's argv — the newline inside it — and is appended back to that row, so no
 * process disappears from the table; one before any row is refused. A read whose verdict is "nothing else runs here"
 * (the cold-seat graft, `../../sessions/coldGraft.ts`) needs this rather than {@link parseProcessRows}: a dropped row
 * is a process the verdict never saw, and a shell whose foreground child's argv began with a newline read as a bare
 * prompt. A row whose argv is empty is kept too, so a continuation has a row to join.
 * MEASURED on macOS: `ps -o args=` prints a newline inside an argument as the octal escape `\012`,
 * never raw (`node -e … "\n20 999 ?? S fake"` listed as `node -e … \01220 999 ?? S fake` on one line), so on this
 * platform no argument produces a continuation line, and none can fabricate a row. The join is kept as the fail-closed reading of a line the platform is not known to
 * emit.
 *
 * @param text the raw listing
 * @returns one row per process, or why a line could not be placed
 */
export function parseProcessRowsWhole({
  text,
}: {
  readonly text: string;
}): Result<readonly TtyProcessRow[], ProcessTableUnplaceableLineError> {
  const rows: TtyProcessRow[] = [];
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    const decoded = decodeTtyRow({ line });
    if (decoded !== undefined) {
      rows.push(decoded);
      continue;
    }
    if (line.length === 0 && index === lines.length - 1) {
      continue;
    }
    const previous = rows.pop();
    if (previous === undefined) {
      return err(ProcessTableErrors.lineUnplaceable({ line, lineNumber: index + 1 }));
    }
    rows.push({ ...previous, argv: `${previous.argv}\n${line}` });
  }
  return ok(rows);
}

/**
 * The first `count` whitespace-delimited fields of a line, and what follows them. Split rather than matched,
 * deliberately: the natural regex for a row (`^\s*(\d+)\s+(\d+)\s+(.+)$`) is polynomial-backtracking on a long
 * non-matching line, and the `redos-check` gate rejects it. A bounded run of `search`es cannot backtrack at all.
 *
 * @param line the line
 * @param count how many leading fields to take
 * @returns the fields, empty where the line ran out, and the rest with its leading whitespace trimmed
 */
function leadingFields({ line, count }: { readonly line: string; readonly count: number }): {
  readonly fields: readonly string[];
  readonly rest: string;
} {
  const fields: string[] = [];
  let rest = line.trimStart();
  for (let taken = 0; taken < count; taken += 1) {
    const gap = rest.search(/\s/u);
    fields.push(gap < 0 ? rest : rest.slice(0, gap));
    rest = gap < 0 ? "" : rest.slice(gap + 1).trimStart();
  }
  return { fields, rest };
}

/**
 * One `pid ppid args` listing line as a row, or `undefined` when it does not start with two integers.
 *
 * @param line the line
 * @returns the row, its argv possibly empty
 */
function decodeRow({ line }: { readonly line: string }): ProcessRow | undefined {
  const { fields, rest } = leadingFields({ count: 2, line });
  const [pid = "", ppid = ""] = fields;
  if (!isDigits({ value: pid }) || !isDigits({ value: ppid })) {
    return undefined;
  }
  return { argv: rest, pid: Number(pid), ppid: Number(ppid) };
}

/**
 * One `pid ppid tty stat args` listing line as a row, or `undefined` when it does not start with two integers, a tty
 * and a state.
 *
 * @param line the line
 * @returns the row, its argv possibly empty
 */
function decodeTtyRow({ line }: { readonly line: string }): TtyProcessRow | undefined {
  const { fields, rest } = leadingFields({ count: 4, line });
  const [pid = "", ppid = "", tty = "", state = ""] = fields;
  if (!isDigits({ value: pid }) || !isDigits({ value: ppid }) || tty.length === 0 || state.length === 0) {
    return undefined;
  }
  return { argv: rest, pid: Number(pid), ppid: Number(ppid), state, tty };
}

/** Whether a field is a non-empty run of digits and nothing else. Linear, so no backtracking to worry about. */
function isDigits({ value }: { readonly value: string }): boolean {
  return /^\d+$/u.test(value);
}

/** How far up a parent chain a walk climbs before giving up — a cycle in the table must not hang a gauge. */
const MAX_ANCESTOR_HOPS = 24;

/**
 * The first ancestor of `pid` (itself included) whose argv matches, walking parents upward.
 *
 * @param processes the snapshot to walk
 * @param pid the process to start from
 * @param matches the predicate one argv must satisfy
 * @returns the matching row, or `undefined` when the chain reaches init without one
 */
export function findAncestor({
  processes,
  pid,
  matches,
}: {
  readonly processes: readonly ProcessRow[];
  readonly pid: number;
  readonly matches: (argv: string) => boolean;
}): ProcessRow | undefined {
  const byPid = new Map(processes.map((row) => [row.pid, row]));
  let current = byPid.get(pid);
  for (let hop = 0; hop < MAX_ANCESTOR_HOPS && current !== undefined; hop++) {
    if (matches(current.argv)) {
      return current;
    }
    const parent = byPid.get(current.ppid);
    // A parent that is its own child, or pid 0, ends the walk — an inherited orphan reparented to init has no
    // further ancestors worth reading, and a cycle must not spin.
    current = parent?.pid === current.pid ? undefined : parent;
  }
  return undefined;
}

/**
 * The `claude` process running a given Claude Code session id.
 *
 * The scheduler's registration records `claudeSessionId` and nothing else about its process, and `claude`
 * carries `--session-id <uuid>` in its own argv — so this is an exact join rather than a name guess.
 *
 * @param processes the snapshot to search
 * @param sessionId the Claude Code session id to find
 * @returns the row, or `undefined` when no live process claims that session
 */
export function findBySessionId({
  processes,
  sessionId,
}: {
  readonly processes: readonly ProcessRow[];
  readonly sessionId: string;
}): ProcessRow | undefined {
  return processes.find((row) => row.argv.includes(`--session-id ${sessionId}`));
}

/**
 * A CLI entrypoint in an argv, capturing the checkout it runs out of — either of the two `bin/slopweaver` execs.
 *
 * A checkout carrying a built tree runs `node …/<tree>/bin/../dist-cli/cli/index.js`; one without runs
 * tsx against `…/<tree>/bin/../src/cli/index.ts`. Matching only the source entry left every listener launched
 * through the built bin attributed to no checkout at all — `session respawn loop --confirm` exited 3 and
 * `listen status` read loop freshness UNKNOWN (`ps -o args= -p <listener pid>` shows the built spelling).
 * The `bin/../` is optional because a direct invocation runs the same tree, and because node normalises its
 * own `process.argv[1]` to `…/<tree>/dist-cli/cli/index.js` where `ps` still prints the `bin/..` spelling:
 * both have to read back as the one checkout.
 */
const CLI_ENTRYPOINT = String.raw`(\S+?)\/(?:bin\/\.\.\/)?(?:src\/cli\/index\.ts|dist-cli\/cli\/index\.js)`;

/**
 * The checkout directory whose CLI entrypoint an argv is running, source or built ({@link CLI_ENTRYPOINT}).
 *
 * The result is the directory as SPELLED, never resolved — `./inspect.ts` hands it to git, which resolves it
 * to a repository root itself and reports a failure rather than a guess.
 *
 * @param argv the process's full command line
 * @returns the checkout directory, or `undefined` when the argv is not running this CLI at all
 */
export function cliCheckoutOfArgv({ argv }: { readonly argv: string }): string | undefined {
  const match = new RegExp(CLI_ENTRYPOINT, "u").exec(argv);
  return match?.[1];
}

/**
 * The checkout THIS process runs its CLI out of, spelled exactly as `ps` will print it.
 *
 * The keep-alive record has to name its checkout in the SAME spelling the gauge reads back out of the
 * process table, or the gauge cannot recognise the record's own process. `process.cwd()` is not that: it is
 * wherever the caller happened to be standing: `cd /tmp &&
 * /repo/bin/slopweaver claude watch --wait` stamped `/tmp` while `ps` showed `/repo`, so the released owner
 * read "NOT running" and admission let a second watch in. Reading the entrypoint out of this process's own
 * argv yields the very token `ps` prints.
 *
 * **A checkout whose path contains whitespace is unsupported, and that is residue rather than a gap.** `ps`
 * joins argv with spaces, so such a path's boundaries are unrepresentable: this and the classifier both see
 * only its last space-free segment (`/tmp/a repo` reads as `repo`, as `pluginDirOfArgv` already documents).
 * No checkout this repository runs from has one. So is a checkout AT the
 * filesystem root (`/src/cli/index.ts`, `/dist-cli/cli/index.js`), which `cliCheckoutOfArgv` has never recognised
 * either.
 *
 * @param argv this process's argv, `process.argv`, whose second entry is the entrypoint script
 * @param fallback what to report when the argv names no CLI entrypoint — never expected for a CLI run
 * @returns the checkout directory, as spelled in the entrypoint path
 */
export function launchedCheckout({
  argv,
  fallback,
}: {
  readonly argv: readonly string[];
  readonly fallback: string;
}): string {
  const checkout = cliCheckoutOfArgv({ argv: argv.slice(1).join(" ") });
  if (checkout == null) {
    return fallback;
  }
  return checkout;
}

/**
 * The `--plugin-dir` a live `claude` process was launched with, read out of its own argv.
 *
 * The argv is the only honest source for this. `cmux spawn` sets `--plugin-dir` from the repo root of the
 * CLI that ran it (`sessionHarness/recordedSpawn.ts`'s `productionSpawnDeps`), so a session spawned by a stale checkout — or
 * started by hand — follows prose from a tree nothing else records, and cmux's own workspace row carries no
 * argv at all. `latestSubmittedMessage` was considered and rejected: it holds only the LAST line cmux
 * delivered, so it is the pickup command, not the boot line, within seconds of a spawn.
 *
 * The value is taken as one whitespace-delimited token, which is what `cmux/spawn.ts` writes; a path
 * containing a space is reported as its first segment rather than guessed at, and grades `unmeasured` when
 * git cannot read it.
 *
 * @param argv the process's full command line, as `ps -o args=` prints it
 * @returns the plugin directory, or `undefined` when the argv names none
 */
export function pluginDirOfArgv({ argv }: { readonly argv: string }): string | undefined {
  const match = /--plugin-dir[= ]+(\S+)/u.exec(argv);
  return match?.[1];
}

/**
 * Every pid in a cmux process tree, flattened.
 *
 * The second anchor a standing session needs, and the reason it exists: an armed listener is DETACHED from
 * the session that armed it (`listen arm --background`), so its parent chain reaches init without ever
 * passing through a `claude` process — measured on the live loop, pid 61202 → 61048 → 1. The
 * ancestor walk therefore finds the bin and nothing else, and the plugin-dir has to be reached through the
 * session's own cmux workspace instead.
 *
 * @param roots the workspace's root processes, as `CmuxClient.processTree` returns them
 * @returns every pid in those trees, roots included, in depth-first order
 */
export function flattenProcessTreePids({ roots }: { readonly roots: readonly CmuxProcess[] }): readonly number[] {
  const pids: number[] = [];
  const walk = ({ nodes }: { nodes: readonly CmuxProcess[] }): void => {
    for (const node of nodes) {
      pids.push(node.pid);
      walk({ nodes: node.children });
    }
  };
  walk({ nodes: roots });
  return pids;
}

/**
 * The plugin directory of the first process in a candidate set whose argv names one.
 *
 * @param processes the snapshot to read argvs from
 * @param pids the candidate pids, in the order they should be tried
 * @returns the plugin directory, or `undefined` when none of them names one
 */
export function pluginDirAmong({
  processes,
  pids,
}: {
  readonly processes: readonly ProcessRow[];
  readonly pids: readonly number[];
}): string | undefined {
  const byPid = new Map(processes.map((row) => [row.pid, row]));
  for (const pid of pids) {
    const argv = byPid.get(pid)?.argv;
    const dir = argv === undefined ? undefined : pluginDirOfArgv({ argv });
    if (dir !== undefined) {
      return dir;
    }
  }
  return undefined;
}

/**
 * The `claude watch` flags that make an invocation something other than a standing session.
 *
 * `--help` is intercepted before the handler loads at all (`cli/main.ts`), wherever it appears. `--dry-run`
 * and `--once` are NOT scanned for here: they are judged by the same last-wins parse as every other flag, in
 * {@link acceptedTail}, because a `--once` the parser consumed as an overwritten `--interval` value is not a
 * one-shot, and reading it as one would read a watch NOT running while it refreshed stores.
 */
const NON_STANDING_WATCH_FLAGS: readonly string[] = ["--help", "-h"];

/**
 * The tsx CLI binary as it appears in an argv before the entrypoint — `bin/slopweaver` execs
 * `node_modules/.bin/tsx`, and a resolved symlink shows `tsx/dist/cli.mjs`. Measured:
 * `ps -ax -o pid=,ppid=,args= | grep 'src/cli/index.ts claude watch'` shows the launcher row carrying it.
 */
const TSX_LAUNCHER = /(?:^|\s)\S*(?:\/\.bin\/tsx|\/tsx\/dist\/cli\.[cm]?js)(?:\s|$)/u;

/**
 * Whether a parsed set of switches is a STANDING loop: neither a one-shot nor a dry run, each read as the
 * parser keeps it — the last occurrence, and only when it is a bare switch.
 *
 * @param switches each switch's last occurrence, true when it was bare
 * @returns true when neither `--once` nor `--dry-run` is in force
 */
function isStandingSwitchSet({ switches }: { readonly switches: ReadonlyMap<string, boolean> }): boolean {
  return switches.get("--once") !== true && switches.get("--dry-run") !== true;
}

/**
 * The narrowest `claude watch --interval`, in minutes. Declared here rather than in the verb, because the
 * classifier below has to refuse exactly what the verb's parser refuses — an argv the parser rejects is a
 * process that exits before it can loop — and `live/` never imports out of `cli/`.
 */
export const MIN_WATCH_INTERVAL_MINUTES = 1;

/** The widest `claude watch --interval`, in minutes. See {@link MIN_WATCH_INTERVAL_MINUTES}. */
export const MAX_WATCH_INTERVAL_MINUTES = 60;

/**
 * The FIRST entrypoint occurrence in an argv, and the two tokens after it — the noun and verb that process
 * was launched with. Everything after them is arguments.
 */
const LAUNCHED_VERB = new RegExp(String.raw`${CLI_ENTRYPOINT}\s+(\S+)\s+(\S+)`, "u");

/** One `claude watch` process, decoded from its own argv — the unit the keep-alive gauge reconciles against. */
export interface ClaudeWatchProcess {
  readonly pid: number;
  readonly ppid: number;
  /** The checkout whose CLI entrypoint it runs, as SPELLED in its argv — never resolved. */
  readonly cwd: string;
  /** Whether it was launched with `--wait`: queued behind an incumbent, unless the record shows it took over. */
  readonly waiting: boolean;
}

/**
 * Every flag `claude watch` accepts, mirrored from its strict parser (`cli/commands/claude/watchArgs.ts`),
 * which `live/` may not import. A unit test holds the two lists equal, so they cannot drift apart silently.
 *
 * @internal
 */
export const STANDING_WATCH_FLAGS: readonly string[] = ["--interval", "--once", "--dry-run", "--json", "--wait"];

/**
 * Whether every token after `claude watch` is one the verb's strict parser accepts.
 *
 * Anything it refuses — an unknown flag, a positional, a switch given a value, a missing or out-of-range
 * `--interval` — is an invocation that exits at parse time rather than looping, so it keeps no store alive
 * and must never read as a live watch, even for the second it takes to load: `claude watch --waiting` must not read `live` while it loads. A second `--interval` is refused, as the shared
 * parser refuses any repeated value flag. A watch launched under the older, ignoring parser — pid 53862,
 * `--interval 5` — is still accepted (`ps -ax -o pid=,ppid=,args= | grep 'claude watch'`).
 *
 * @param tokens the argv tokens after `claude watch`
 * @returns whether the accepted watch is queued with `--wait`, or `undefined` when the parser would refuse
 *   the tail
 */
function acceptedTail({
  tokens,
}: {
  readonly tokens: readonly string[];
}): { readonly standing: boolean; readonly waiting: boolean } | undefined {
  const args = optionsBeforeTerminator({ tokens });
  if (args === undefined) {
    return undefined;
  }
  const read = readOptions({ args });
  // The one value flag, `--interval`, is refused outright when given twice, as the shared parser refuses it.
  if (read === undefined || read.intervals.length > 1) {
    return undefined;
  }
  const { intervals, switches } = read;
  const interval = intervals.length === 0 ? String(MIN_WATCH_INTERVAL_MINUTES) : intervals[0];
  const switchesAreBare = [...switches.values()].every((bare) => bare);
  const accepted = switchesAreBare && interval !== undefined && acceptedWatchInterval({ raw: interval }) !== undefined;
  // `waiting` comes from the same parse, never from a substring: in `--interval --wait` the `--wait` is the
  // interval's VALUE, not a switch.
  return accepted
    ? { standing: isStandingSwitchSet({ switches }), waiting: switches.get("--wait") === true }
    : undefined;
}

/**
 * Every `--interval` value and the last reading of each switch, walked the way `parseArgs` consumes them.
 *
 * LAST occurrence wins per SWITCH, as `parseArgs` keeps it: `--json=true --json` is accepted (the bare switch
 * came last) and `--json --json=true` refused — refusing the first would hide a running watch. A bare
 * `--interval` consumes the next token as its value, whatever it is, so that token is never read as a switch.
 *
 * @param args the option tokens before any terminator
 * @returns each interval value in order (`undefined` for a bare one with nothing after it) and whether each
 *   switch was last given bare, or `undefined` when a token is no flag the verb accepts
 */
function readOptions({
  args,
}: {
  readonly args: readonly string[];
}):
  { readonly intervals: readonly (string | undefined)[]; readonly switches: ReadonlyMap<string, boolean> } | undefined {
  const intervals: (string | undefined)[] = [];
  const switches = new Map<string, boolean>();
  for (let at = 0; at < args.length; at += 1) {
    const [name = "", ...value] = args[at]!.split("=");
    if (name === "--interval") {
      if (value.length > 0) {
        intervals.push(value.join("="));
      } else {
        at += 1;
        intervals.push(args[at]);
      }
    } else if (STANDING_WATCH_FLAGS.includes(name)) {
      switches.set(name, value.length === 0);
    } else {
      return undefined;
    }
  }
  return { intervals, switches };
}

/**
 * The option tokens before a `--` terminator, as `parseArgs` reads them.
 *
 * `--` ends the options: accepted with nothing after it, while anything after it is a positional the parser
 * refuses; a `claude watch --` loop runs, so it must not read NOT running.
 *
 * @param tokens the argv tokens after `claude watch`
 * @returns the tokens before a trailing `--` (all of them when there is none), or `undefined` when a
 *   positional follows the terminator
 */
function optionsBeforeTerminator({ tokens }: { readonly tokens: readonly string[] }): readonly string[] | undefined {
  for (let at = 0; at < tokens.length; at += 1) {
    // A bare `--interval` consumes the NEXT token as its value, even a `--`, so that `--` is a value rather than
    // the terminator.
    if (tokens[at] === "--interval") {
      at += 1;
    } else if (tokens[at] === "--") {
      return at === tokens.length - 1 ? tokens.slice(0, at) : undefined;
    }
  }
  return tokens;
}

/**
 * The ONE rule for a `claude watch --interval` value, shared by the verb's parser and this classifier.
 *
 * Decimal digits only, within {@link MIN_WATCH_INTERVAL_MINUTES}..{@link MAX_WATCH_INTERVAL_MINUTES}. It
 * is shared rather than restated because the two disagreeing is a false NOT-running: the parser's
 * `Number("1e0")` once accepted a watch the classifier's digit rule refused, so a
 * running watch read NOT running and a second start was admitted beside it.
 *
 * @param raw the value as typed
 * @returns the interval in minutes, or `undefined` when the verb refuses it
 */
export function acceptedWatchInterval({ raw }: { readonly raw: string }): number | undefined {
  if (!isDigits({ value: raw })) {
    return undefined;
  }
  const minutes = Number(raw);
  return minutes >= MIN_WATCH_INTERVAL_MINUTES && minutes <= MAX_WATCH_INTERVAL_MINUTES ? minutes : undefined;
}

/**
 * Decode one process-table row as a standing `claude watch`, or as nothing.
 *
 * The rules are {@link isClaudeWatchProcess}'s, applied to one row with no record to compare against: the
 * FIRST entrypoint occurrence must launch `claude watch`, no non-standing flag may appear, and every token
 * after the verb must be one its strict parser accepts. The checkout is read out of that first occurrence.
 *
 * @param row one process-table row
 * @returns the decoded watcher, or `undefined` when the row is not a standing `claude watch`
 */
export function decodeClaudeWatch({ row }: { readonly row: ProcessRow }): ClaudeWatchProcess | undefined {
  // ONE match, and it is the FIRST entrypoint occurrence, which is the one that launched this process.
  // Several verbs here take free text, so `slopweaver store cite "why does …/src/cli/index.ts claude watch
  // stall"` carries a second entrypoint path inside its own question. Reading only the first occurrence
  // makes the check about how the process was STARTED rather than about what it mentions.
  const launched = LAUNCHED_VERB.exec(row.argv);
  const cwd = launched?.[1];
  if (launched === null || cwd === undefined || launched[2] !== "claude" || launched[3] !== "watch") {
    return undefined;
  }
  if (NON_STANDING_WATCH_FLAGS.some((flag) => new RegExp(`(?:^|\\s)${flag}(?:$|[\\s=])`, "u").test(row.argv))) {
    return undefined;
  }
  // The tsx CLI is a LAUNCHER: it spawns the node child that runs the loop and refreshes stores, and runs
  // nothing itself. Counting it would read a lone launcher — before its child appears, or after it exits —
  // as a live watch over a machine refreshing nothing. `node --import tsx <entry>`
  // runs the loop in-process and is not a launcher: only the tsx CLI binary itself is matched.
  if (TSX_LAUNCHER.test(row.argv.slice(0, launched.index))) {
    return undefined;
  }
  // `ps` joins argv with ONE space and pads the row with trailing spaces (measured: `ps -ax -o
  // pid=,ppid=,args= | grep 'claude watch' | od -c` shows them). So the tail is trimmed at the END only and
  // split on single spaces: a doubled space is an empty or space-led argument the parser refuses, which
  // collapsing whitespace would have rebuilt into a valid one (`--interval ' 5'`). An argument
  // that itself CONTAINS a space is still unrepresentable — `ps` loses its boundaries — which is residue.
  const tail = row.argv.slice(launched.index + launched[0].length).trimEnd();
  const tokens = tail.length === 0 ? [] : tail.slice(1).split(" ");
  const accepted = acceptedTail({ tokens });
  if (accepted === undefined || !accepted.standing) {
    return undefined;
  }
  return { cwd, pid: row.pid, ppid: row.ppid, waiting: accepted.waiting };
}

/**
 * Every standing `claude watch` in one snapshot — ONE entry per running loop, not per process.
 *
 * ## Why a watcher's launcher is dropped
 *
 * `bin/slopweaver` execs `node_modules/.bin/tsx`, and tsx runs the entrypoint in a CHILD node process, so
 * one watch is two rows carrying the same entrypoint and verb. MEASURED on the owner's machine
 * (`ps -ax -o pid=,ppid=,args= | grep 'src/cli/index.ts claude watch'`): pid 53785 `node …/.bin/tsx
 * …/src/cli/index.ts claude watch --interval 5` was the parent of 53862, `node --require …/preflight.cjs
 * --import …/loader.mjs …/src/cli/index.ts claude watch --interval 5`. Counting both would make every
 * healthy watch its own duplicate. The CHILD is kept because it is the process that runs the loop and
 * stamps its own `process.pid` into the record; a decoded row that is the parent of another decoded row
 * from the same checkout is its launcher.
 *
 * @param processes one snapshot of the process table
 * @returns the decoded watchers, in snapshot order
 */
export function standingWatchProcesses({
  processes,
}: {
  readonly processes: readonly ProcessRow[];
}): readonly ClaudeWatchProcess[] {
  const decoded = processes.flatMap((row) => {
    const watcher = decodeClaudeWatch({ row });
    return watcher === undefined ? [] : [watcher];
  });
  return decoded.filter((watcher) => !decoded.some((child) => child.ppid === watcher.pid && child.cwd === watcher.cwd));
}

/**
 * Whether one live process IS the keep-alive loop the record describes.
 *
 * ## Why a pid alone is not an answer
 *
 * `pidAlive` is `process.kill(pid, 0)`, whose own author documents it as true for a process "ours or not".
 * Pids are reused. A watcher that stamped its record at 12:00:00 and was killed a second later still has a
 * fresh record at 12:00:30, and if the OS has handed that number to an unrelated `sleep` the pid answers
 * yes — a perfect `watching` verdict over a machine where nothing is refreshing a credential. That is the
 * false-alive shape `../listen/supervise/liveness.ts` exists to make impossible, so identity is checked
 * rather than assumed.
 *
 * Three things must hold, and each rules out a different impostor: the argv has to run `claude watch`
 * through this CLI, which rules out any unrelated process inheriting the number; it has to run out of the
 * checkout the record names, which rules out a DIFFERENT watcher started from another tree being credited
 * to this record; and it must carry neither `--dry-run` nor `--once`, which rules out the two hand-run
 * shapes of this very verb that keep no store alive.
 *
 * ## The residue, stated rather than left to be discovered
 *
 * This is argv matching. It is not proof of authorship and it does not become proof by adding more
 * substrings, so it is written down as a HEURISTIC and its known gaps are named rather than implied.
 *
 * What it does close is the common population of a reused pid: an unrelated daemon, a different verb of
 * this CLI, this same verb from another tree, a query whose own free text mentions the verb, the three
 * hand-run shapes that keep nothing alive (`--dry-run`, `--once`, `--help`), and any tail the verb's
 * strict parser refuses — an unknown flag or a bad `--interval` — which exits before it can loop.
 *
 * What it does NOT close, found by an adversarial pass and listed because a silent gap is the thing this
 * whole module distrusts: an argv deliberately constructed to carry this CLI's path and verb; a watch
 * launched before the strict parser existed with a flag it ignored, which now reads
 * as nothing — none was running when this landed; and any future flag that makes the verb non-standing
 * without being added above. Each needs the record to name a boot identity the process
 * also carries, deferred with the fenced ownership protocol rather than half-built here. Until that lands,
 * this is strictly better than a bare pid and no stronger than what is claimed.
 *
 * @param cwd the checkout the record claims the loop runs from
 * @param pid the recorded pid
 * @param processes one snapshot of the process table
 * @returns whether that pid is this loop, running from that tree
 */
export function isClaudeWatchProcess({
  cwd,
  pid,
  processes,
}: {
  readonly cwd: string;
  readonly pid: number;
  readonly processes: readonly ProcessRow[];
}): boolean {
  const row = processes.find((candidate) => candidate.pid === pid);
  return row !== undefined && decodeClaudeWatch({ row })?.cwd === cwd;
}
