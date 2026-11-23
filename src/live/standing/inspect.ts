/**
 * Measuring a standing session's two trees — the effectful half of `./freshness.ts`.
 *
 * Every git call goes through `gitEnv()` for the reason `../../lib/gitRepo.ts` documents at length: an
 * ambient `GIT_DIR` overrides `-C`, and a check that silently reads the wrong repository reports current
 * about a tree it never opened. A git call that FAILS never becomes a zero here — it becomes
 * `behind: undefined`, which `gradeStandingTree` grades `unmeasured` and a reader is told to treat as
 * possibly stale.
 *
 * ## It fetches, and that is the point
 *
 * A drift measured against a remote-tracking ref nobody has updated is a measurement of how stale the REF is,
 * not of how stale the session is — and it fails in exactly the direction that hurts, reporting `current` for
 * a session two days behind. So every measurement refreshes `origin` first, once per repository (worktrees of
 * one repo share an object store, so four trees cost one fetch), bounded, and a fetch that fails is recorded
 * as a problem rather than swallowed.
 */
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { resolve } from "node:path";

import { gitEnv } from "../../lib/gitRepo.js";
import { err, ok, type Result } from "../../lib/result.js";
import {
  gradeStandingTree,
  type StandingSessionFreshness,
  type StandingTreeFreshness,
  type StandingTreeReading,
  type StandingTreeRole,
  standingSessionFreshness,
} from "./freshness.js";
import {
  cliCheckoutOfArgv,
  findAncestor,
  type ProcessRow,
  parseProcessRows,
  parseProcessRowsWhole,
  pluginDirOfArgv,
  type TtyProcessRow,
} from "./processes.js";
import { type ProcessTableError, ProcessTableErrors, type ProcessTableUnreadableError } from "./processTableErrors.js";

/**
 * The ref a standing session is expected to be current with.
 *
 * @internal
 */
export const STANDING_UPSTREAM = "origin/main";

/** How long one git read may block. A hung read must not hang a gauge that a loop tick calls. */
const GIT_TIMEOUT_MS = 30_000;

/** How long the one refresh may block. Shorter than the read bound: a fetch that slow is a fetch to skip. */
const FETCH_TIMEOUT_MS = 20_000;

/** More stdout than any `ps` listing or `diff --name-only` produces, so a read never dies of ENOBUFS. */
const MAX_BUFFER = 32 * 1024 * 1024;

/**
 * `ps` by absolute path, never through `PATH`: the cold arm's two table reads come through here, and a wrapper first
 * on the path could spell a stopped shell as sleeping.
 */
const PS = "/bin/ps";

/**
 * One read of the process table that keeps a FAILED read distinct from an empty one.
 *
 * {@link StandingInspectDeps.processes} collapses a failed `ps` to `[]`, which is right for a tree
 * measurement (a missing anchor costs one tree, and says so) and wrong for the keep-alive: an empty table
 * reads as "no watch is running", which is a verdict, while an unreadable one establishes nothing. So the
 * keep-alive's gauge and its start-up admission read this instead, and nothing else changes.
 */
export type ProcessSnapshot =
  | { readonly kind: "rows"; readonly rows: readonly ProcessRow[] }
  | { readonly kind: "unreadable"; readonly problem: string };

/**
 * Read the whole process table once, preserving a failure as `unreadable`.
 *
 * @returns the decoded rows, or why the table could not be read
 */
export function readProcessSnapshot(): ProcessSnapshot {
  const text = readProcessText({ columns: "pid=,ppid=,args=" });
  return text.isOk()
    ? { kind: "rows", rows: parseProcessRows({ text: text.value }) }
    : { kind: "unreadable", problem: text.error.message };
}

/**
 * Read the whole process table once, each row with its controlling terminal and state, keeping EVERY line: a row the
 * listing wraps is joined back rather than dropped ({@link parseProcessRowsWhole}). The read a "nothing else runs
 * here" verdict stands on — the cold-seat arm of `cmux reseat` and `fleet resume` — because a dropped row is a process
 * that verdict never saw, the tty is how it finds a process on the tab cmux never reported, and the state is how it
 * tells a stopped shell from one at its prompt.
 *
 * @returns every row, or why the table could not be read or a line could not be placed
 */
export function readProcessTableWhole(): Result<readonly TtyProcessRow[], ProcessTableError> {
  return readProcessText({ columns: "pid=,ppid=,tty=,stat=,args=" }).andThen((text) => parseProcessRowsWhole({ text }));
}

/**
 * One `ps -ax -o <columns>` listing, raw.
 *
 * @param columns the `-o` format, `args=` last so a command line is the rest of its row
 * @returns the listing, or why it could not be read
 */
function readProcessText({ columns }: { readonly columns: string }): Result<string, ProcessTableUnreadableError> {
  try {
    return ok(
      execFileSync(PS, ["-ax", "-o", columns], {
        encoding: "utf8",
        maxBuffer: MAX_BUFFER,
        timeout: GIT_TIMEOUT_MS,
      }),
    );
  } catch (cause: unknown) {
    return err(ProcessTableErrors.unreadable({ cause }));
  }
}

/**
 * The identity of the directory a path names ON DISK — its device and inode — or its lexical normalisation
 * when the filesystem cannot answer (a path that does not exist from here, say).
 *
 * Not a resolved path: `realpathSync.native` keeps a macOS firmlink spelling, so `/Users/…` and
 * `/System/Volumes/Data/Users/…` resolved to two paths for one directory,
 * `stat` reporting the same device and inode for both. The device-and-inode pair is the one answer every
 * symlink, firmlink and alias agrees on.
 *
 * @param path the path to identify
 * @returns a key equal for every spelling of one directory
 */
export function checkoutIdentityOnDisk({ path }: { readonly path: string }): string {
  try {
    const found = statSync(path);
    return `inode:${String(found.dev)}:${String(found.ino)}`;
  } catch {
    return resolve(path);
  }
}

/**
 * Whether two paths are the same checkout ON DISK — the comparator the keep-alive's gauge and admission use.
 *
 * Neither a pid alone nor a spelling is enough. Matching the owner by
 * pid alone credited a reused pid running a queued `--wait` watch from ANOTHER checkout, a false live; comparing
 * spellings let a filesystem alias (macOS `/var` is `/private/var`) hide the real owner, a false NOT-running.
 * The on-disk identity — device and inode — is the one comparison both counterexamples agree on.
 *
 * @param left one path
 * @param right the other
 * @returns true when both resolve to the same physical checkout
 */
export function sameCheckoutOnDisk({ left, right }: { readonly left: string; readonly right: string }): boolean {
  return checkoutIdentityOnDisk({ path: left }) === checkoutIdentityOnDisk({ path: right });
}

/** The read seams a measurement needs, injected so a test never shells out. */
export interface StandingInspectDeps {
  /** Run one git command, returning its trimmed stdout, or `undefined` when the call failed. */
  readonly git: (args: { readonly args: readonly string[]; readonly cwd: string }) => string | undefined;
  /** The whole process table, decoded — read ONCE per report, per `./processes.ts`'s header. */
  readonly processes: () => readonly ProcessRow[];
}

/**
 * The real seams: actual `git` and `ps` subprocesses.
 *
 * Synchronous by construction, not by habit — the `no-headless` gate bans the async `node:child_process` API
 * repo-wide (AGENTS.md rule 2, no allowlist), so a wall-clock bound is the only kind available.
 *
 * @returns the production {@link StandingInspectDeps}
 */
export function productionStandingInspectDeps(): StandingInspectDeps {
  return {
    git: ({ args, cwd }) => {
      try {
        return execFileSync("git", [...args], {
          cwd,
          encoding: "utf8",
          env: gitEnv(),
          maxBuffer: MAX_BUFFER,
          timeout: args[0] === "fetch" ? FETCH_TIMEOUT_MS : GIT_TIMEOUT_MS,
        }).trim();
      } catch {
        return undefined;
      }
    },
    processes: () => {
      const snapshot = readProcessSnapshot();
      return snapshot.kind === "rows" ? snapshot.rows : [];
    },
  };
}

/**
 * Refresh `origin` in one tree, at most once per repository across a whole report.
 *
 * Deduplicated on the repository's common git directory rather than on the worktree path, because worktrees
 * of one repository share an object store — fetching in one refreshes `origin/main` for all of them.
 *
 * @param deps the read seams
 * @param path the worktree to fetch from
 * @param fetched the set of already-fetched common directories, mutated by this call
 * @returns the problem sentence when the fetch failed, or `undefined`
 */
function refreshOrigin({
  deps,
  path,
  fetched,
}: {
  readonly deps: StandingInspectDeps;
  readonly path: string;
  readonly fetched: Set<string>;
}): string | undefined {
  // `--git-common-dir` answers RELATIVELY from a main checkout (a bare `.git`) and absolutely from a worktree
  // — measured on this repository, both spellings from the same command. Two unrelated main checkouts would
  // therefore share the key `.git`, and the second one would silently skip its fetch and measure against
  // stale refs. Resolving a relative answer against its own worktree makes the key what it claims to be.
  const common = deps.git({ args: ["rev-parse", "--git-common-dir"], cwd: path });
  const key = common === undefined ? path : resolve(path, common);
  if (fetched.has(key)) {
    return undefined;
  }
  fetched.add(key);
  return deps.git({ args: ["fetch", "--quiet", "origin"], cwd: path }) === undefined
    ? `could not fetch origin in ${path} — its drift is measured against the refs already on disk`
    : undefined;
}

/**
 * Read one tree: its HEAD, how far `origin/main` is ahead of it, and which paths those commits changed.
 *
 * @param deps the read seams
 * @param path the worktree to measure
 * @param upstream the ref to measure against (defaults to {@link STANDING_UPSTREAM})
 * @param fetched the per-report fetch dedupe set
 * @param problems accumulates every read that failed, so an unmeasurable tree is reported and not swallowed
 * @returns the reading, with `behind: undefined` for anything git would not answer
 */
export function readStandingTree({
  deps,
  path,
  upstream = STANDING_UPSTREAM,
  fetched,
  problems,
}: {
  readonly deps: StandingInspectDeps;
  readonly path: string;
  readonly upstream?: string;
  readonly fetched: Set<string>;
  readonly problems: string[];
}): StandingTreeReading {
  const fetchProblem = refreshOrigin({ deps, fetched, path });
  if (fetchProblem !== undefined) {
    problems.push(fetchProblem);
  }
  const head = deps.git({ args: ["rev-parse", "--short", "HEAD"], cwd: path });
  if (head === undefined) {
    problems.push(`could not read HEAD in ${path} — it may not be a git checkout at all`);
    return { behind: undefined, changedPaths: [], head: undefined, path };
  }
  const counted = deps.git({ args: ["rev-list", "--count", `HEAD..${upstream}`], cwd: path });
  const behind = counted === undefined ? undefined : Number(counted);
  if (behind === undefined || !Number.isInteger(behind)) {
    problems.push(`could not count how far ${path} is behind ${upstream}`);
    return { behind: undefined, changedPaths: [], head, path };
  }
  const changed = behind === 0 ? "" : deps.git({ args: ["diff", "--name-only", `HEAD...${upstream}`], cwd: path });
  if (changed === undefined) {
    problems.push(`could not list what ${upstream} changed relative to ${path}`);
    return { behind: undefined, changedPaths: [], head, path };
  }
  return {
    behind,
    changedPaths: changed.split("\n").filter((line) => line.length > 0),
    head,
    path,
  };
}

/**
 * One tree a standing session runs on, before it has been measured.
 *
 * @internal
 */
export interface StandingTreeTarget {
  readonly role: StandingTreeRole;
  readonly path: string;
}

/**
 * The `bin` tree: the checkout the anchored process's own argv runs, or — when there is no such process, or
 * its argv names no CLI entrypoint — the recorded checkout the caller passed for exactly that case.
 */
function binCheckout({
  self,
  fallbackBin,
}: {
  readonly self: ProcessRow | undefined;
  readonly fallbackBin: string | undefined;
}): string | undefined {
  const fromArgv = self === undefined ? undefined : cliCheckoutOfArgv({ argv: self.argv });
  if (fromArgv == null) {
    return fallbackBin;
  }
  return fromArgv;
}

/**
 * The `plugin-dir` tree: the one the caller already resolved, when it passed one, else the `--plugin-dir` the
 * nearest `claude` ancestor was launched with — absent when there is no such ancestor or it names none.
 */
function resolvedPluginDir({
  pluginDir,
  claude,
}: {
  readonly pluginDir: string | undefined;
  readonly claude: ProcessRow | undefined;
}): string | undefined {
  if (pluginDir == null) {
    return claude === undefined ? undefined : pluginDirOfArgv({ argv: claude.argv });
  }
  return pluginDir;
}

/**
 * Which trees a standing session is running on, resolved from ONE process snapshot.
 *
 * The anchor is a live pid, never a recorded path: `bin` is the checkout whose `src/cli/index.ts` that
 * process is running, and `plugin-dir` is the `--plugin-dir` of the nearest `claude` ancestor. A role that
 * cannot be resolved is simply absent from the result — reporting a guessed path would be worse than
 * reporting one tree.
 *
 * @param processes the snapshot to fold
 * @param pid the live process to anchor on
 * @param fallbackBin a recorded checkout to report as `bin` when the pid's own argv names none
 * @returns the targets, in report order — `bin` first, because it is the half a worker inherits
 */
export function standingTreeTargets({
  processes,
  pid,
  fallbackBin,
  pluginDir,
}: {
  readonly processes: readonly ProcessRow[];
  readonly pid: number | undefined;
  readonly fallbackBin: string | undefined;
  readonly pluginDir?: string | undefined;
}): readonly StandingTreeTarget[] {
  const self = pid === undefined ? undefined : processes.find((row) => row.pid === pid);
  const bin = binCheckout({ fallbackBin, self });
  const claude =
    pid === undefined ? undefined : findAncestor({ matches: (argv) => argv.includes("--plugin-dir"), pid, processes });
  const resolved = resolvedPluginDir({ claude, pluginDir });
  return [
    ...(bin === undefined ? [] : [{ path: bin, role: "bin" } as const]),
    ...(resolved === undefined ? [] : [{ path: resolved, role: "plugin-dir" } as const]),
  ];
}

/**
 * One standing session's measured freshness, plus every read that could not be taken.
 *
 * @internal
 */
export interface StandingFreshnessReport {
  readonly freshness: StandingSessionFreshness;
  readonly problems: readonly string[];
}

/**
 * Measure and grade every tree a standing session runs on.
 *
 * @param deps the read seams
 * @param session which standing session this is, for the report's own label
 * @param targets the trees to measure (see {@link standingTreeTargets})
 * @param upstream the ref to measure against (defaults to {@link STANDING_UPSTREAM})
 * @param sensitivePaths the prefixes whose change makes THIS session stale rather than merely behind
 * @returns the graded freshness and the problems
 */
export function measureStandingFreshness({
  deps,
  session,
  targets,
  sensitivePaths,
  upstream = STANDING_UPSTREAM,
}: {
  readonly deps: StandingInspectDeps;
  readonly session: string;
  readonly targets: readonly StandingTreeTarget[];
  readonly sensitivePaths?: readonly string[];
  readonly upstream?: string;
}): StandingFreshnessReport {
  const problems: string[] = [];
  const fetched = new Set<string>();
  const trees: StandingTreeFreshness[] = targets.map((target) =>
    gradeStandingTree({
      reading: readStandingTree({ deps, fetched, path: target.path, problems, upstream }),
      role: target.role,
      ...(sensitivePaths === undefined ? {} : { sensitivePaths }),
    }),
  );
  return { freshness: standingSessionFreshness({ session, trees }), problems };
}

/**
 * The supervisor's own trees — read from its contract, never from a process's own checkout.
 *
 * `./supervisor.ts`'s header carries the whole reasoning: the supervisor's cwd is an ordinary handover
 * worktree while the CLI it is required to invoke lives in the main checkout, so anchoring `bin` on the
 * workspace would report a fresh worktree as current while the binary every command ran was days behind.
 * Either role may be absent and the other still measured.
 *
 * @param binPath the declared main checkout carrying the CLI, or `undefined` when it did not resolve
 * @param pluginDir the live supervisor session's `--plugin-dir`, or `undefined` when none is open
 * @returns the trees to measure, `bin` first
 */
export function supervisorTreeTargets({
  binPath,
  pluginDir,
}: {
  readonly binPath: string | undefined;
  readonly pluginDir: string | undefined;
}): readonly StandingTreeTarget[] {
  return [
    ...(binPath === undefined ? [] : [{ path: binPath, role: "bin" } as const]),
    ...(pluginDir === undefined ? [] : [{ path: pluginDir, role: "plugin-dir" } as const]),
  ];
}
