/**
 * The effectful shell for `./staleSeat.ts`'s pure core: resolve the trunk, measure this seat against it,
 * discover the verb's module trees from its own command files, print, and remember. Every step is
 * best-effort and FAILS OPEN — an advisory must never change a verb's exit code, and a seat that cannot be
 * measured is left exactly as it was before this module existed.
 *
 * ## Why every git call here is affordable on the hot path
 *
 * MEASURED on this repository, against a baseline `slopweaver catalog` of 4.6–5.6 s:
 *
 * ```text
 *   git rev-list --count HEAD..origin/main                      0.18 s
 *   git diff --name-only <300 behind> -- <verb's trees>         0.07 s   (3304 paths unscoped, 7 scoped)
 *   git diff --name-only <300 behind>   (unscoped, for scale)   0.27-0.51 s
 * ```
 *
 * The pathspec is what makes this cheap, and it is why there is no cache: scoping the diff to the verb's own
 * trees costs a flat 70 ms even 300 commits back, so a cache would add a staleness surface of its own to
 * save less time than it spends being right. Reproduce:
 *
 * ```bash
 * /usr/bin/time -p git diff --name-only main~300...origin/main -- src/autonomy src/cli/commands/autonomy
 * ```
 *
 * The second call is SKIPPED entirely when the first says zero, which is the common case, so a current seat
 * pays one `rev-list` and nothing else.
 *
 * ## The once-per-session record is the store's
 *
 * Which sessions were already shown the notice is the `stale-seat-notices` row (`./staleSeatNotices.ts`), bounded
 * at `./skillReminder.ts`'s session cap and asked only on the once-per-session cadence, so a current seat never
 * opens the store. It is a record of its own, apart from the skill reminders': the two have unrelated lifecycles
 * and must not evict each other. A store that cannot answer costs one extra notice, printed with the reason.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { errorMessage } from "../lib/errorMessage.js";
import { gitEnv } from "../lib/gitRepo.js";
import { err, ok, type Result } from "../lib/result.js";
import {
  ADVISORY_QUIET_ENV,
  staleSeatAssessment,
  staleSeatCadence,
  staleSeatLines,
  verbModuleTrees,
} from "./staleSeat.js";
import {
  type StaleSeatNoticesError,
  StaleSeatNoticesErrors,
  type StaleSeatNoticesPort,
  withNoticedSession,
} from "./staleSeatNotices.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/** Long enough for a scoped `diff --name-only`, and a bound rather than an unbounded pipe. */
const GIT_OUTPUT_MAX_BYTES = 4_000_000;

/** Run one git command in a checkout, answering `undefined` on any failure rather than throwing. */
function git({ cwd, args }: { cwd: string; args: readonly string[] }): string | undefined {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      env: gitEnv(),
      maxBuffer: GIT_OUTPUT_MAX_BYTES,
      stdio: ["ignore", "pipe", "ignore"],
      killSignal: "SIGKILL",
      timeout: GIT_READ_TIMEOUT_MS,
    });
  } catch {
    return undefined;
  }
}

/**
 * The trunk ref this seat should be measured against.
 *
 * `origin/HEAD` is asked first because it is what the remote itself says its default branch is. A checkout
 * that never ran `git remote set-head` does not have it, so `origin/main` is then CHECKED FOR EXISTENCE —
 * never assumed. Neither present means the guard stays silent: naming a ref that is not there would make
 * every later measurement a fiction.
 *
 * @param root the checkout to resolve in
 * @returns the ref name, or `undefined` when no trunk could be identified
 */
export function resolveTrunkRef({ root }: { root: string }): string | undefined {
  const symbolic = git({ args: ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], cwd: root });
  const symbolicRef = symbolic === undefined ? "" : symbolic.trim();
  if (symbolicRef.startsWith("refs/remotes/")) {
    return symbolicRef.slice("refs/remotes/".length);
  }
  const fallback = git({ args: ["rev-parse", "--verify", "--quiet", "origin/main"], cwd: root });
  const fallbackSha = fallback === undefined ? "" : fallback.trim();
  if (fallbackSha.length > 0) {
    return "origin/main";
  }
  return undefined;
}

/**
 * Every relative import specifier written in one command directory's own files.
 *
 * Reads the directory's immediate `.ts` files only — a nested subdirectory belongs to a verb group large
 * enough to have its own structure, and walking it would cost more than the measurement is worth.
 *
 * @param commandDir the absolute path of the noun's command directory
 * @returns the specifiers, duplicates included; empty when the directory cannot be read
 */
function readImportSpecifiers({ commandDir }: { commandDir: string }): readonly string[] {
  let entries: readonly string[];
  try {
    entries = readdirSync(commandDir).filter((name) => name.endsWith(".ts"));
  } catch {
    return [];
  }
  const specifiers: string[] = [];
  for (const entry of entries) {
    let text: string;
    try {
      text = readFileSync(join(commandDir, entry), "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(/from\s+"(\.[^"]*)"/gu)) {
      const specifier = match[1];
      if (specifier !== undefined) {
        specifiers.push(specifier);
      }
    }
  }
  return specifiers;
}

/** When this checkout last fetched, from the git directory's own `FETCH_HEAD` stamp. */
function fetchedAtOf({ root }: { root: string }): number | undefined {
  const commonDir = git({ args: ["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd: root });
  if (commonDir === undefined || commonDir.trim().length === 0) {
    return undefined;
  }
  try {
    return statSync(join(commonDir.trim(), "FETCH_HEAD")).mtimeMs;
  } catch {
    return undefined;
  }
}

/** Parse a `rev-list --count` answer, refusing anything that is not exactly one non-negative integer. */
function parseCount({ text }: { text: string | undefined }): number | undefined {
  if (text === undefined) {
    return undefined;
  }
  const trimmed = text.trim();
  if (!/^\d+$/u.test(trimmed)) {
    return undefined;
  }
  return Number(trimmed);
}

/**
 * Whether this session was already shown the notice, recording it when not: ONE read and at most ONE
 * compare-and-set, never retried. A refusal — the store down, a conflicting writer, a damaged row — is handed back
 * for the caller to print beside the notice, so it costs one extra notice and is never a failed verb.
 */
async function claimSessionNotice({
  home,
  notices,
  sessionId,
}: {
  home: string;
  notices: StaleSeatNoticesPort;
  sessionId: string;
}): Promise<Result<"already-shown" | "first-showing", StaleSeatNoticesError>> {
  // The boundary is HERE, for whatever port a caller hands in: this runs ahead of every verb, so a port that
  // rejects instead of answering a `Result` must still cost one notice, never the verb.
  try {
    const read = await notices.read({ home });
    if (read.isErr()) {
      return err(read.error);
    }
    if (read.value.noticedSessions.includes(sessionId)) {
      return ok("already-shown");
    }
    const written = await notices.replace({
      document: withNoticedSession({ noticedSessions: read.value.noticedSessions, sessionId }),
      expectedRevision: read.value.revision,
      home,
    });
    if (written.isErr()) {
      return err(written.error);
    }
    return ok("first-showing");
  } catch (cause) {
    return err(
      StaleSeatNoticesErrors.storeUnavailable({ doing: "be reached", reason: errorMessage({ error: cause }) }),
    );
  }
}

/** The absolute path of one noun's command directory inside the RUNNING checkout. */
function commandDirFor({ noun }: { noun: string }): string {
  const root = git({ args: ["rev-parse", "--show-toplevel"], cwd: dirname(fileURLToPath(import.meta.url)) });
  const checkout = root === undefined ? "" : root.trim();
  return join(checkout, "src", "cli", "commands", noun);
}

/** What one seat measured against its trunk, for a caller that has its own pathspecs to ask about. */
export interface SeatDrift {
  /** The trunk ref the seat was compared against. */
  readonly upstreamRef: string;
  /** Commits that ref carries that this seat does not. */
  readonly behind: number;
  /** The paths those commits changed, WITHIN the pathspecs the caller asked about. */
  readonly changedPaths: readonly string[];
}

/**
 * Measure the RUNNING checkout against its trunk, scoped to the pathspecs a caller cares about.
 *
 * Shared by this module's advisory and by `./commands/handover/staleEvidenceGate.ts`'s refusal rather than
 * written twice: a second copy of this git plumbing is the dedup-that-regenerates-a-class failure
 * `.claude/rules/error-handling.md` records, and the two callers differ only in which
 * pathspecs they ask about and what they do with the answer.
 *
 * The scoping is what makes it affordable — see this module's header for the measurement.
 *
 * @param pathspecs the repo-relative paths to scope the diff to; an empty list means the whole tree
 * @returns the drift, or `undefined` when anything at all could not be measured
 */
export function measureSeatDrift({ pathspecs }: { pathspecs: readonly string[] }): SeatDrift | undefined {
  const root = git({ args: ["rev-parse", "--show-toplevel"], cwd: dirname(fileURLToPath(import.meta.url)) });
  if (root === undefined || root.trim().length === 0) {
    return undefined;
  }
  const checkout = root.trim();
  const upstreamRef = resolveTrunkRef({ root: checkout });
  if (upstreamRef === undefined) {
    return undefined;
  }
  const behind = parseCount({ text: git({ args: ["rev-list", "--count", `HEAD..${upstreamRef}`], cwd: checkout }) });
  if (behind === undefined) {
    return undefined;
  }
  if (behind === 0) {
    return { behind, changedPaths: [], upstreamRef };
  }
  const diff = git({ args: ["diff", "--name-only", `HEAD...${upstreamRef}`, "--", ...pathspecs], cwd: checkout });
  if (diff === undefined) {
    return undefined;
  }
  return {
    behind,
    changedPaths: diff
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
    upstreamRef,
  };
}

/**
 * When the RUNNING checkout last fetched, so a report never claims to be fresher than its own evidence.
 *
 * @returns the `FETCH_HEAD` stamp in milliseconds, or `undefined` when it could not be read
 */
function runningCheckoutFetchedAt(): number | undefined {
  const root = git({ args: ["rev-parse", "--show-toplevel"], cwd: dirname(fileURLToPath(import.meta.url)) });
  if (root === undefined || root.trim().length === 0) {
    return undefined;
  }
  return fetchedAtOf({ root: root.trim() });
}

/** Whether the operator suppressed advisories for this process. */
function advisoriesQuiet(): boolean {
  const quiet = process.env[ADVISORY_QUIET_ENV];
  return quiet !== undefined && quiet.length > 0;
}

/**
 * Whether a once-per-session notice is shown this invocation, claiming it for the session when it is.
 *
 * A claim the store could not record still shows the notice — a repeat is better than a silent miss — and carries
 * the line saying it may repeat.
 *
 * @param sessionId the current session; without one the notice cannot be deduped, so it is not shown
 * @returns whether to show it, and the may-repeat line when the claim was not recorded
 */
async function sessionNoticeDecision({
  home,
  notices,
  sessionId,
}: {
  home: string;
  notices: StaleSeatNoticesPort;
  sessionId: string | undefined;
}): Promise<{ readonly show: boolean; readonly unrecorded: string | undefined }> {
  if (sessionId === undefined) {
    return { show: false, unrecorded: undefined };
  }
  const claimed = await claimSessionNotice({ home, notices, sessionId });
  if (claimed.isErr()) {
    const unrecorded = `  (not recorded as shown, so it may repeat this session: ${claimed.error.message})`;
    return { show: true, unrecorded };
  }
  return { show: claimed.value !== "already-shown", unrecorded: undefined };
}

/**
 * Warn, before a verb runs, when the commits this seat lacks changed the code that verb reads.
 *
 * Silent when the seat is current, when no trunk resolves, when anything cannot be measured, or when
 * advisories are suppressed. Never throws and never affects an exit code.
 *
 * @param noun the CLI noun being dispatched
 * @param verb the CLI verb being dispatched
 * @param home the state home whose store records which sessions were shown the notice
 * @param notices the door those sessions are read and recorded through, asked only on the once-per-session path
 * @param sessionId the current session id, or undefined outside a live session — the notice is deduped
 *   per session, so without one only the every-invocation overlap case is printed
 * @param nowMs the current wall-clock, injected so the caller's tests need no real clock
 * @param measureDrift the git measurement, injected so a test can STATE a drift rather than needing a
 *   checkout that happens to sit behind its own trunk with the right files changed
 * @param writeLine where to print each line (defaults to stderr) — injected so this is unit-testable
 * @returns nothing
 */
export async function maybeWarnStaleSeat({
  noun,
  verb,
  home,
  notices,
  sessionId,
  nowMs = Date.now(),
  measureDrift = measureSeatDrift,
  writeLine = (line) => {
    process.stderr.write(`${line}\n`);
  },
}: {
  noun: string;
  verb: string;
  home: string;
  notices: StaleSeatNoticesPort;
  sessionId: string | undefined;
  nowMs?: number;
  measureDrift?: (args: { pathspecs: readonly string[] }) => SeatDrift | undefined;
  writeLine?: (line: string) => void;
}): Promise<void> {
  if (advisoriesQuiet()) {
    return;
  }
  const trees = verbModuleTrees({
    noun,
    specifiers: readImportSpecifiers({ commandDir: commandDirFor({ noun }) }),
  });
  const drift = measureDrift({ pathspecs: trees });
  if (drift === undefined) {
    return;
  }
  const assessment = staleSeatAssessment({ behind: drift.behind, changedPaths: drift.changedPaths, trees });
  const cadence = staleSeatCadence({ assessment });
  if (cadence === "silent") {
    return;
  }
  let unrecorded: string | undefined;
  if (cadence === "once-per-session") {
    const decision = await sessionNoticeDecision({ home, notices, sessionId });
    if (!decision.show) {
      return;
    }
    unrecorded = decision.unrecorded;
  }
  for (const line of staleSeatLines({
    assessment,
    fetchedAtMs: runningCheckoutFetchedAt(),
    noun,
    nowMs,
    upstreamRef: drift.upstreamRef,
    verb,
  })) {
    writeLine(line);
  }
  if (unrecorded !== undefined) {
    writeLine(unrecorded);
  }
}
