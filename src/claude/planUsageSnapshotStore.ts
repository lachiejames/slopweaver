/**
 * Reading and recording the per-plan usage snapshot — the effectful half of `./planUsageSnapshot.ts`.
 *
 * One owner-only file per plan, `$home/live/claude-usage/<alias>.json`, replaced whole through `writeFileAtomic`.
 * Two writers can race (`claude gauge` beside a `claude watch` tick), and an atomic rename alone does not stop the
 * older of them landing last: it can read, pause, and replace a newer reading after that one landed. So the read,
 * the comparison and the write sit under one per-plan operation lock, and a reading no newer than the recorded one is
 * kept out — `kept-newer`, with the file's bytes and mtime untouched, which the bash fast path's `-nt` test relies on.
 *
 * A recorded file that does not decode REFUSES a write rather than being overwritten blind: the store cannot tell a
 * corrupt newer reading from a stale one, and the gate already reads a corrupt file as NOT MEASURED.
 */
import { readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";

import { parseIsoMs } from "#lib/date.js";
import { errorMessage } from "#lib/errorMessage.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { acquireOperationLock } from "../admit/operationLock.js";
import { DEFAULT_STALE_AFTER_MS } from "../admit/operationLockHeld.js";
import { stateHomePaths } from "../stateHome.js";
import type { ClaudeAccountGauge } from "./contracts.js";
import {
  type ClaudePlanUsageSnapshot,
  type ClaudePlanUsageSnapshotError,
  ClaudePlanUsageSnapshotErrors,
  parseClaudePlanUsageSnapshot,
  planUsageSnapshot,
  snapshotAlias,
} from "./planUsageSnapshot.js";
import { newestSeatPassMs } from "./seatPassMarker.js";

/** Owner-only, like every live record: a snapshot names a plan and how much of it is spent. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
/** How far ahead a snapshot is staged: any span works, since the restamp replaces it; a day outlasts any stall. */
const STAGED_AHEAD_MS = 24 * 60 * 60 * 1000;
/**
 * How long after taking its lease a writer may still write: a minute inside the lease's takeover threshold, so a
 * writer stalled anywhere before its last check refuses rather than racing a takeover that threshold now allows
 * What is left is a stall of over a minute between that check and the rename.
 */
const WRITE_DEADLINE_MS = DEFAULT_STALE_AFTER_MS - 60 * 1000;

/** What one record call did. */
export type PlanUsageSnapshotRecordOutcome = "recorded" | "kept-newer";

/**
 * Where one plan's snapshot lives.
 *
 * @param alias the plan, refused unless it is the register's own alias class
 * @param home the state home
 * @returns the file path, or why the alias cannot key one
 */
export function claudePlanUsageSnapshotPath({
  alias,
  home,
}: {
  alias: string;
  home: string;
}): Result<string, ClaudePlanUsageSnapshotError> {
  return snapshotAlias({ alias }).map((safe) =>
    join(stateHomePaths({ home }).live.claudeUsageSnapshotsDir, `${safe}.json`),
  );
}

/**
 * Read one plan's last recorded reading. An absent file is `undefined` — a plan nothing has gauged yet — and every
 * other failure is typed, never read as absent.
 *
 * @param alias the plan
 * @param home the state home
 * @returns the snapshot, `undefined` when none is recorded, or why it could not be read
 */
export function readClaudePlanUsageSnapshot({
  alias,
  home,
}: {
  alias: string;
  home: string;
}): Result<ClaudePlanUsageSnapshot | undefined, ClaudePlanUsageSnapshotError> {
  const path = claudePlanUsageSnapshotPath({ alias, home });
  if (path.isErr()) {
    return err(path.error);
  }
  let text: string;
  try {
    text = readFileSync(path.value, "utf8");
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return ok(undefined);
    }
    return err(ClaudePlanUsageSnapshotErrors.unreadable({ path: path.value, why: errorMessage({ error }) }));
  }
  let document: unknown;
  try {
    document = safeJsonParse({ label: path.value, text });
  } catch (error: unknown) {
    return err(ClaudePlanUsageSnapshotErrors.unreadable({ path: path.value, why: errorMessage({ error }) }));
  }
  return parseClaudePlanUsageSnapshot({ document, expectedAlias: alias, path: path.value });
}

/**
 * Whether a candidate reading is strictly newer than the recorded one. Both instants were validated on the way in.
 *
 * @param candidate the reading being recorded
 * @param recorded the reading already on disk
 * @returns true when the candidate was observed later
 */
function isNewer({
  candidate,
  recorded,
}: {
  candidate: ClaudePlanUsageSnapshot;
  recorded: ClaudePlanUsageSnapshot;
}): boolean {
  return parseIsoMs({ tsIso: candidate.observedAtIso })! > parseIsoMs({ tsIso: recorded.observedAtIso })!;
}

/**
 * The earliest instant a snapshot may be dated so that it is newer than every standing pass to bash's whole-second
 * `-nt`: the second after the newest pass's own second.
 *
 * @param newestPassMs the newest pass's mtime in epoch milliseconds, undefined when none stands
 * @returns that instant in epoch milliseconds, or 0 when no pass stands to outrank
 */
function passFloorMs({ newestPassMs }: { newestPassMs: number | undefined }): number {
  if (newestPassMs === undefined) {
    return 0;
  }
  return Math.floor(newestPassMs / 1000) * 1000 + 1000;
}

/**
 * Record one successful reading as its plan's snapshot, unless a newer one is already recorded.
 *
 * @param gauge the reading `claude gauge` or a `claude watch` tick already took — no provider call is made here
 * @param home the state home
 * @param now the clock the lease is dated by, read at the instant it is taken — never an instant captured before the
 *   sweep that produced the reading, which could date a fresh lease already stale — and
 *   read again just before the write, to refuse one whose lease has aged past the write deadline
 * @param acquire how the plan's lease is taken: the real operation lock, always, bar a test that takes a real one
 *   and has it taken over before the write, which no real process can be paused into
 * @returns whether it was recorded or a newer reading kept, or why neither happened
 */
export function recordClaudePlanUsageSnapshot({
  gauge,
  home,
  now,
  acquire = acquireOperationLock,
}: {
  gauge: ClaudeAccountGauge;
  home: string;
  now: () => string;
  acquire?: typeof acquireOperationLock;
}): Result<PlanUsageSnapshotRecordOutcome, ClaudePlanUsageSnapshotError> {
  const path = claudePlanUsageSnapshotPath({ alias: gauge.alias, home });
  if (path.isErr()) {
    return err(path.error);
  }
  let lock: ReturnType<typeof acquireOperationLock>;
  const leasedAtIso = now();
  try {
    lock = acquire({ home, key: `claude-usage-snapshot:${gauge.alias}`, nowIso: leasedAtIso });
  } catch (error: unknown) {
    return err(ClaudePlanUsageSnapshotErrors.lockUnavailable({ alias: gauge.alias, why: errorMessage({ error }) }));
  }
  if (lock.isErr()) {
    return err(ClaudePlanUsageSnapshotErrors.lockUnavailable({ alias: gauge.alias, why: lock.error }));
  }
  const held = lock.value;
  const leaseLost = (): string | undefined => {
    if (!held.stillHeld()) {
      return "another writer took the lease over while this one compared";
    }
    const leasedAtMs = parseIsoMs({ tsIso: leasedAtIso });
    const nowMs = parseIsoMs({ tsIso: now() });
    if (leasedAtMs === undefined || nowMs === undefined) {
      return "this writer's clock did not read as an instant, so its lease's age is unknown";
    }
    if (nowMs - leasedAtMs >= WRITE_DEADLINE_MS) {
      return "this writer's lease aged past its write deadline, so another writer may take it over mid-write";
    }
    return undefined;
  };
  try {
    return replaceUnlessNewer({ candidate: planUsageSnapshot({ gauge }), home, leaseLost });
  } finally {
    lock.value.release();
  }
}

/**
 * The read, compare and write, run while the plan's lock is held.
 *
 * The lock is a LEASE: a holder older than its stale threshold is taken over without fencing (`../admit/operationLock.ts`).
 * So the write re-asks whether this writer still holds it AND whether its lease is still inside the write deadline,
 * and a writer suspended anywhere before that check — whose comparison a newer reading may since have overtaken, or
 * whose lease another writer may take over the next instant — writes nothing. The residue is a stall of over a minute
 * exactly between that check and the rename.
 *
 * It takes no path: the file is derived from the candidate's own alias, and the candidate is decoded exactly as a
 * reader would decode it, so no caller can aim a write at another plan's file or outside the directory, or record
 * a document every later read would refuse. It is not exported: its only caller
 * holds the plan's lease, so no direct call can race another outside it.
 *
 * @param candidate the snapshot to record, decoded here before anything is read or written
 * @param home the state home
 * @param leaseLost why this writer may no longer write, asked immediately before the write; undefined while it may
 * @returns whether it was recorded or a newer one kept, or why neither happened
 */
function replaceUnlessNewer({
  candidate: offered,
  home,
  leaseLost,
}: {
  candidate: ClaudePlanUsageSnapshot;
  home: string;
  leaseLost: () => string | undefined;
}): Result<PlanUsageSnapshotRecordOutcome, ClaudePlanUsageSnapshotError> {
  const located = claudePlanUsageSnapshotPath({ alias: offered.alias, home });
  if (located.isErr()) {
    return err(located.error);
  }
  const path = located.value;
  const decoded = parseClaudePlanUsageSnapshot({ document: offered, expectedAlias: offered.alias, path });
  if (decoded.isErr()) {
    return err(
      ClaudePlanUsageSnapshotErrors.writeFailed({
        path,
        why: `the reading is not a snapshot a reader would accept (${decoded.error.message})`,
      }),
    );
  }
  const candidate = decoded.value;
  const recorded = readClaudePlanUsageSnapshot({ alias: candidate.alias, home });
  if (recorded.isErr()) {
    return err(recorded.error);
  }
  if (recorded.value !== undefined && !isNewer({ candidate, recorded: recorded.value })) {
    return ok("kept-newer");
  }
  const lost = leaseLost();
  if (lost !== undefined) {
    return err(ClaudePlanUsageSnapshotErrors.lockUnavailable({ alias: candidate.alias, why: lost }));
  }
  return publishSnapshot({ candidate, home, path });
}

/**
 * Write the snapshot future-dated, then restamp it to its publication instant, never below a standing pass.
 *
 * A rename keeps the staged file's mtime, so the file is STAGED future-dated: from the instant it is visible until the
 * restamp, the bash fast path's `marker -nt snapshot` cannot hold, whatever marker was written while it was staged.
 * The restamp then dates it to its publication, so a seat pass judged on the OLD reading —
 * dated to its check's start, before publication — still loses to it, and one judged after it may pass again. A
 * restamp that fails leaves it future-dated: every limited pass misses.
 *
 * @param candidate the decoded snapshot this writer may still write
 * @param home the state home, whose seat-pass directory dates the restamp
 * @param path the plan's own snapshot file
 * @returns recorded, or why the write or its restamp failed
 */
function publishSnapshot({
  candidate,
  home,
  path,
}: {
  candidate: ClaudePlanUsageSnapshot;
  home: string;
  path: string;
}): Result<PlanUsageSnapshotRecordOutcome, ClaudePlanUsageSnapshotError> {
  try {
    writeFileAtomic({
      contents: `${safeJsonStringify({ label: path, value: candidate })}\n`,
      dirMode: DIR_MODE,
      // Exact, so a umask that strips owner-read cannot publish a snapshot its own reader refuses.
      exactMode: true,
      fileMode: FILE_MODE,
      path,
      stagedMtime: new Date(Date.now() + STAGED_AHEAD_MS),
    });
    // Never dated below a pass already standing: a wall clock stepped back after a pass was written would otherwise
    // date this newer reading under it, and once the clock caught up the pass would stand over it. A second past the newest, since bash's `-nt` compares whole seconds. Markers that cannot be listed
    // date it a day past its publication rather than leaving the staged date, which a writer suspended a day before
    // its rename would publish already past; every limited pass misses it.
    const newestPass = newestSeatPassMs({ dir: stateHomePaths({ home }).live.seatPassDir });
    const published = newestPass.isOk()
      ? new Date(Math.max(Date.now(), passFloorMs({ newestPassMs: newestPass.value })))
      : new Date(Date.now() + STAGED_AHEAD_MS);
    utimesSync(path, published, published);
  } catch (error: unknown) {
    return err(ClaudePlanUsageSnapshotErrors.writeFailed({ path, why: errorMessage({ error }) }));
  }
  return ok("recorded");
}

/**
 * Record every successful reading a sweep or tick already took, and return what failed for the caller to say. A
 * plan whose probe failed has no reading here and writes nothing, so its last recorded reading stands and ages out.
 *
 * @param gauges the readings, one per plan that answered
 * @param home the state home
 * @param now the clock each plan's lease is dated by, read as that lease is taken
 * @returns every failure, empty when each reading was recorded or a newer one kept
 */
export function recordPlanUsageSnapshots({
  gauges,
  home,
  now,
}: {
  gauges: readonly ClaudeAccountGauge[];
  home: string;
  now: () => string;
}): readonly ClaudePlanUsageSnapshotError[] {
  return gauges.flatMap((gauge) => {
    const recorded = recordClaudePlanUsageSnapshot({ gauge, home, now });
    return recorded.isErr() ? [recorded.error] : [];
  });
}
