/**
 * The CHECKS-READ REGISTER — which pull requests this install raised, and which of those it has since gone
 * back and read the checks of.
 *
 * ## The incident
 *
 * A pull request sat as a draft with two red checks because the session that pushed it moved
 * straight to building proof artifacts and never read the pull request's checks once. Nothing watched it,
 * and the owner noticed the reds first: a pull request is not raised with red checks and
 * then left red. The post-mortem is why a local lint pass is not the answer either — unit tests and oxlint
 * ran, typecheck never did, and the tests passed against a field name TypeScript would have refused
 * (TS2561, `longMessage` for `long_message`), because the predicate under test only reads `code`.
 *
 * So the rule this register makes mechanical is: **a pull request is not RAISED until its checks have been
 * read once by the session that pushed it.** `../../cli/commands/handover/checksReadGate.ts` is what
 * refuses; this file is only the record the refusal reads.
 *
 * ## Why a register rather than a watcher
 *
 * AGENTS.md rule 2 bans a resident watcher outright, so nothing here may poll, detach or survive the turn.
 * The register inverts that: the push leaves an OBLIGATION behind, the read discharges it, and a run that
 * ends with one outstanding is refused. Every one of those three acts is a session doing something visible.
 *
 * ## Two decisions that are the contract, not details
 *
 * **A read is matched to a raise by `(repo, number)` and INSTANT, never by head SHA.** Both rows carry the
 * head they saw, and that evidence is printed — but a session that raises, amends, force-pushes and then
 * reads would never match a SHA-keyed raise again, and the gate would refuse it forever with no honest way
 * through but the hatch. The stated residue: a read of a head an amend has since replaced still discharges
 * the raise, because the scope line here is "read once", not "watched to green".
 *
 * **Only `github checks` writes a read row.** `github enqueue` and `github merge --admin` pull a rollup
 * internally (`./adminMerge.ts`), and a rollup read buried inside a merge attempt is not a session reading
 * its checks — counting it would re-open the exact hole the rule closes. AGENTS.md's toolchain section
 * already tells a session to watch CI with `github checks --wait`, so the verb canon names is the verb that
 * discharges.
 *
 * ## Shape
 *
 * One append-only `ledgers/pr-checks-read.jsonl` under the state home, one {@link ChecksReadRow} per
 * line, raises and reads interleaved in the order they happened — the same file, lock and permissions idiom
 * as the other `ledgers/` registers, and streamed with `readJsonlLines` for the reason
 * `.claude/rules/typescript-patterns.md` gives: every fleet session appends and nothing ever removes a line,
 * so its size is a property of the data from the first commit.
 */
import { mkdirSync, statSync } from "node:fs";

import { acquireOperationLock } from "../../admit/operationLock.js";
import { readJsonlLines } from "../../corpus/corpusStore.js";
import { slopweaverHome } from "../../homeDir.js";
import { appendLines } from "../../lib/appendSeparator.js";
import { errorMessage } from "../../lib/errorMessage.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonStringify } from "../../lib/safeJson.js";
import { stateHomePaths } from "../../stateHome.js";

/** Owner-only permissions — a row names the operator's own branches. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** The lock key every writer of this register takes. One register, one key. */
const LOCK_KEY = "pr-checks-read-ledger";

/**
 * One pull request this install opened, owing a read of its checks.
 *
 * `branch` is here and absent from the read row on purpose: it is what scopes the gate to ONE run, so that
 * a session settling its own work is never refused over a pull request another fleet session raised. A read
 * needs no branch — it is matched to its raise by repository and number.
 */
export interface ChecksRaisedRecord {
  readonly kind: "raised";
  /** `owner/name`, exactly as the pushing verb resolved it. */
  readonly repo: string;
  readonly number: number;
  /** The pull request's head branch, which is how the gate tells this run's raises from another's. */
  readonly branch: string;
  /** The head commit that was pushed. Evidence a reader can chase, never the join key — see the overview. */
  readonly headSha: string;
  readonly atIso: string;
}

/** One read of a pull request's checks, which discharges every raise of it recorded before this instant. */
export interface ChecksSeenRecord {
  readonly kind: "read";
  readonly repo: string;
  readonly number: number;
  /** The head the rollup answered for, which may already be an amend past the raise's. */
  readonly headSha: string;
  readonly atIso: string;
  /** GitHub's own rollup state (`SUCCESS`, `FAILURE`, `PENDING`, …), carried verbatim. */
  readonly rollup: string;
}

/** The `--until` modes a watch can run in, plus `wait` for the plain status-line loop. */
export type ChecksWatchMode = "wait" | "ci" | "review" | "any" | "merge";

/**
 * A visible session began WATCHING one pull request — `github checks --wait` or `--until` — and is still
 * polling it until a later `watch-done` from the same session says it stopped.
 *
 * Written on the first successful read of a watch run, never on a one-shot read, so the row carries the
 * head it saw. `session` is the Claude Code session id the verb ran under, or `unattended` when there was
 * none — never a guess. `timeoutSeconds` is the verb's own ceiling: a watcher older than that with no
 * `watch-done` is a session that died, and a reader reports it STALE rather than watching.
 */
export interface ChecksWatchingRecord {
  readonly kind: "watching";
  readonly repo: string;
  readonly number: number;
  readonly headSha: string;
  readonly atIso: string;
  readonly session: string;
  readonly mode: ChecksWatchMode;
  readonly timeoutSeconds: number;
}

/** The same session stopped watching: the loop returned, whatever it returned. `outcome` is its own word. */
export interface ChecksWatchDoneRecord {
  readonly kind: "watch-done";
  readonly repo: string;
  readonly number: number;
  readonly headSha: string;
  readonly atIso: string;
  readonly session: string;
  readonly outcome: string;
}

/**
 * One row of the register — a raise that owes a read, the read that discharges one, or a watch beginning
 * and ending. The gate reads only the first two; the watched column reads the last two beside the reads.
 */
export type ChecksReadRow = ChecksRaisedRecord | ChecksSeenRecord | ChecksWatchingRecord | ChecksWatchDoneRecord;

/** The watch modes, as a list the parser checks a stored row against. */
const WATCH_MODES: readonly ChecksWatchMode[] = ["wait", "ci", "review", "any", "merge"];

/** The register's own typed failures — branched on, so a caller can tell contention from corruption. */
export interface ChecksReadUnreadableError {
  readonly code: "REGISTER_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A stored line is not a well-formed row. Carries the line number so it can be fixed rather than guessed. */
export interface ChecksReadCorruptRowError {
  readonly code: "CORRUPT_ROW";
  readonly message: string;
  readonly lineNumber: number;
}

/** Another session holds the register's write lock. Contention, not corruption — the caller may retry. */
export interface ChecksReadBusyError {
  readonly code: "REGISTER_BUSY";
  readonly message: string;
}

/** Every way reading or appending to this register can fail. */
export type ChecksReadError = ChecksReadUnreadableError | ChecksReadCorruptRowError | ChecksReadBusyError;

/** The factory the real code and its tests both build failures through. */
export const ChecksReadErrors = {
  busy: ({ why }: { why: string }): ChecksReadBusyError => ({
    code: "REGISTER_BUSY",
    message: `the checks-read register is locked by another session: ${why}`,
  }),
  corruptRow: ({ lineNumber, why }: { lineNumber: number; why: string }): ChecksReadCorruptRowError => ({
    code: "CORRUPT_ROW",
    lineNumber,
    message: `checks-read register line ${String(lineNumber)} is not a row this build can read: ${why}`,
  }),
  unreadable: ({ cause, path }: { cause: string; path: string }): ChecksReadUnreadableError => ({
    code: "REGISTER_UNREADABLE",
    message: `the checks-read register at ${path} could not be read: ${cause}`,
    path,
  }),
} as const;

/**
 * The register's absolute path.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the path to `ledgers/pr-checks-read.jsonl`
 */
export function checksReadLedgerPath({ home }: { home?: string } = {}): string {
  return stateHomePaths(home === undefined ? {} : { home }).prChecksReadJsonl;
}

/**
 * Whether the register is there, genuinely absent, or present-but-unreachable.
 *
 * `existsSync` cannot tell the last two apart, and the difference decides whether this gate fails open. A
 * directory the caller cannot traverse would otherwise read exactly like a fresh install that has raised
 * nothing — so only ENOENT means absent, and every other errno is a register we cannot see.
 */
function registerPresence({ path }: { path: string }): "present" | "absent" | "unreachable" {
  try {
    statSync(path);
    return "present";
  } catch (error: unknown) {
    return isRecord(error) && error["code"] === "ENOENT" ? "absent" : "unreachable";
  }
}

/**
 * The fields both row kinds share, decoded once.
 *
 * Returns the failure rather than throwing so the caller can name the line number — a corrupt register is
 * fixed by inspecting the line, never by guessing which of the two shapes was intended.
 */
function commonFields({
  parsed,
  lineNumber,
}: {
  parsed: Readonly<Record<string, unknown>>;
  lineNumber: number;
}): Result<{ repo: string; number: number; headSha: string; atIso: string }, ChecksReadError> {
  const repo = parsed["repo"];
  const number = parsed["number"];
  const headSha = parsed["headSha"];
  const atIso = parsed["atIso"];
  if (typeof repo !== "string" || typeof headSha !== "string") {
    return err(ChecksReadErrors.corruptRow({ lineNumber, why: "`repo` or `headSha` is not a string" }));
  }
  if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) {
    return err(ChecksReadErrors.corruptRow({ lineNumber, why: "`number` is not a positive whole number" }));
  }
  if (typeof atIso !== "string" || Number.isNaN(Date.parse(atIso))) {
    return err(ChecksReadErrors.corruptRow({ lineNumber, why: "`atIso` is not an instant Date.parse can read" }));
  }
  return ok({ atIso, headSha, number, repo });
}

/** Whether a stored `mode` is one the verb has — the type guard the parser narrows through, never a cast. */
function isWatchMode(value: unknown): value is ChecksWatchMode {
  return typeof value === "string" && WATCH_MODES.some((mode) => mode === value);
}

/** Decode the two watch kinds' own fields, over the common ones already read. */
function parseWatchRow({
  common,
  kind,
  lineNumber,
  parsed,
}: {
  common: { atIso: string; headSha: string; number: number; repo: string };
  kind: "watching" | "watch-done";
  lineNumber: number;
  parsed: Record<string, unknown>;
}): Result<ChecksWatchingRecord | ChecksWatchDoneRecord, ChecksReadError> {
  const session = parsed["session"];
  if (typeof session !== "string" || session.trim().length === 0) {
    return err(
      ChecksReadErrors.corruptRow({ lineNumber, why: "a watch row carries no `session`, so nobody is watching" }),
    );
  }
  if (kind === "watch-done") {
    const outcome = parsed["outcome"];
    if (typeof outcome !== "string") {
      return err(ChecksReadErrors.corruptRow({ lineNumber, why: "a watch-done carries no `outcome`" }));
    }
    return ok({ ...common, kind, outcome, session });
  }
  const mode = parsed["mode"];
  const timeoutSeconds = parsed["timeoutSeconds"];
  if (!isWatchMode(mode)) {
    return err(ChecksReadErrors.corruptRow({ lineNumber, why: "a watching row's `mode` is not a watch mode" }));
  }
  if (typeof timeoutSeconds !== "number" || !(timeoutSeconds > 0)) {
    return err(ChecksReadErrors.corruptRow({ lineNumber, why: "a watching row's `timeoutSeconds` is not positive" }));
  }
  return ok({ ...common, kind, mode, session, timeoutSeconds });
}

/** Decode one stored line, refusing anything a reader would otherwise have to guess at. */
function parseChecksReadLine({
  line,
  lineNumber,
}: {
  line: string;
  lineNumber: number;
}): Result<ChecksReadRow, ChecksReadError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (cause) {
    return err(ChecksReadErrors.corruptRow({ lineNumber, why: errorMessage({ error: cause }) }));
  }
  if (!isRecord(parsed)) {
    return err(ChecksReadErrors.corruptRow({ lineNumber, why: "the line is not a JSON object" }));
  }
  const kind = parsed["kind"];
  const known = kind === "raised" || kind === "read" || kind === "watching" || kind === "watch-done";
  if (!known) {
    return err(
      ChecksReadErrors.corruptRow({ lineNumber, why: "`kind` is none of `raised`, `read`, `watching`, `watch-done`" }),
    );
  }
  const common = commonFields({ lineNumber, parsed });
  if (common.isErr()) {
    return err(common.error);
  }
  if (kind === "raised") {
    const branch = parsed["branch"];
    if (typeof branch !== "string" || branch.trim().length === 0) {
      return err(ChecksReadErrors.corruptRow({ lineNumber, why: "a raise carries no `branch`, so nothing owes it" }));
    }
    return ok({ ...common.value, branch, kind });
  }
  if (kind === "watching" || kind === "watch-done") {
    return parseWatchRow({ common: common.value, kind, lineNumber, parsed });
  }
  const rollup = parsed["rollup"];
  if (typeof rollup !== "string") {
    return err(ChecksReadErrors.corruptRow({ lineNumber, why: "a read carries no `rollup`, so it reports nothing" }));
  }
  return ok({ ...common.value, kind, rollup });
}

/**
 * Every row the register holds, in the order they were written.
 *
 * An install that has never raised a pull request is EMPTY rather than a failure; a register that exists and
 * cannot be read is a failure and says so, because an unreadable register must never be indistinguishable
 * from one with nothing outstanding.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns every row, or the first failure
 */
export function readChecksReadLedger({ home }: { home?: string } = {}): Result<
  readonly ChecksReadRow[],
  ChecksReadError
> {
  const path = checksReadLedgerPath(home === undefined ? {} : { home });
  const presence = registerPresence({ path });
  if (presence === "unreachable") {
    return err(ChecksReadErrors.unreadable({ cause: "it could not be reached — check its permissions", path }));
  }
  if (presence === "absent") {
    return ok([]);
  }
  const records: ChecksReadRow[] = [];
  let failure: ChecksReadError | undefined;
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (failure !== undefined || line.trim().length === 0) {
          return;
        }
        const parsed = parseChecksReadLine({ line, lineNumber: index + 1 });
        if (parsed.isErr()) {
          failure = parsed.error;
          return;
        }
        records.push(parsed.value);
      },
      path,
    });
  } catch (cause) {
    return err(ChecksReadErrors.unreadable({ cause: errorMessage({ error: cause }), path }));
  }
  if (failure !== undefined) {
    return err(failure);
  }
  return ok(records);
}

/**
 * Append one row, creating the register if it is not there yet.
 *
 * @param row the raise or read to record
 * @param nowIso the instant the lock is taken at, so the lock's own staleness check has a clock
 * @param home the state home (defaults to the resolved home)
 * @returns the path written, or the failure
 */
export function appendChecksReadRecord({
  row,
  nowIso,
  home = slopweaverHome(),
}: {
  row: ChecksReadRow;
  nowIso: string;
  home?: string;
}): Result<string, ChecksReadError> {
  const paths = stateHomePaths({ home });
  const path = paths.prChecksReadJsonl;
  try {
    mkdirSync(paths.ledgers, { mode: DIR_MODE, recursive: true });
  } catch (cause) {
    return err(ChecksReadErrors.unreadable({ cause: errorMessage({ error: cause }), path }));
  }
  const lock = acquireOperationLock({ home, key: LOCK_KEY, nowIso });
  if (lock.isErr()) {
    return err(ChecksReadErrors.busy({ why: lock.error }));
  }
  try {
    const encoded = safeJsonStringify({ label: "a checks-read register row", value: row });
    appendLines({ mode: FILE_MODE, path, text: `${encoded}\n` });
    return ok(path);
  } catch (cause) {
    return err(ChecksReadErrors.unreadable({ cause: errorMessage({ error: cause }), path }));
  } finally {
    lock.value.release();
  }
}

/**
 * The raises on one branch that no later read has discharged — the whole question the gate asks.
 *
 * Pure, and matched on `(repo, number)` plus the instant rather than on head SHA: see this file's overview
 * for the amend trap that decided it. A raise is discharged by the FIRST read of the same pull request
 * recorded at or after it, so a read that predates a re-raise cannot answer for it.
 *
 * @param rows every row the register holds, in written order
 * @param branch the head branch to ask about — a run's own, so one session's raise never blocks another's
 * @returns one entry per outstanding raise, latest raise last, empty when the branch owes nothing
 */
export function unreadRaises({
  rows,
  branch,
}: {
  rows: readonly ChecksReadRow[];
  branch: string;
}): readonly ChecksRaisedRecord[] {
  const raises = rows.filter((row): row is ChecksRaisedRecord => row.kind === "raised" && row.branch === branch);
  const reads = rows.filter((row): row is ChecksSeenRecord => row.kind === "read");
  return raises.filter(
    (raise) =>
      !reads.some(
        (read) =>
          read.repo === raise.repo && read.number === raise.number && Date.parse(read.atIso) >= Date.parse(raise.atIso),
      ),
  );
}

/**
 * The one line a session is told to run to discharge a raise.
 *
 * Built here rather than typed at each site so the refusal, the push's own next step and the canon that
 * describes them can never drift into naming three different commands.
 *
 * @param row the outstanding raise
 * @returns the exact command, repository included
 */
export function checksReadCommand({ row }: { row: ChecksRaisedRecord }): string {
  return `slopweaver github checks --repo ${row.repo} --number ${String(row.number)} --wait`;
}
