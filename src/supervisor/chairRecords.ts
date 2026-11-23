/**
 * The registry half of the chair read: which Claude sessions sit on a set of the pinned workspace's pids, bound to
 * the process running there now, and each one's verdict off the tail of its transcript.
 *
 * No cmux call is made here — `./chairRead.ts` finds the pinned workspace and its pids and hands them in. Every
 * judgement is in `./chairModel.ts` and `./chairGate.ts`.
 */
import { join } from "node:path";
import { readTail, scanSessions, transcriptPathFor } from "../sessions/liveSessionStore.js";
import type { SessionRecord } from "../sessions/liveSessions.js";
import { DEPTH_TAIL_BYTES } from "../sessions/tokenDepth.js";
import type { ChairSessionReading, ChairUnresolvedCause } from "./chairGate.js";
import { judgeChairTranscript } from "./chairModel.js";

/** The registry records whose own process runs on one of the chair's pids, or why the registry could not say. */
type ChairRecords =
  | { readonly kind: "resolved"; readonly records: readonly SessionRecord[] }
  | { readonly kind: "unresolved"; readonly why: string };

/**
 * The registry records on the chair's pids whose own process is the one running there now — the one filter both chair
 * readers share, so the gate and the gauge never disagree about which sessions sit in the chair.
 *
 * A record counts only when the process on its pid started when the record says its own did (`../fleet/liveSeat.ts`):
 * Claude Code leaves a dead session's file behind, and the tab's `login` or shell can inherit its pid. On the pid
 * alone, that stale file stood in for the chair — its old transcript could pass the gate with no live chair, and its
 * credential read left the gauge's star off. The stamp is Claude
 * Code's own, to the whole second, so the residue is a pid handed out again inside the very second its dead record
 * started: the binding cannot be finer than the registry it reads. A record with no start
 * stamp cannot be told from a stranger, so it is KEPT for each reader to name unread, never dropped. An unreadable
 * registry, or a refused file among the chair's pids, is a session nobody can name, so the read fails closed rather
 * than let the sessions that did read speak for it.
 *
 * @param pids every pid cmux reports for the pinned workspace
 * @param claudeHome the resolved `~/.claude`
 * @param starts each running pid's start stamp, from `../fleet/processStarts.ts`
 * @returns the records, or why the registry could not say
 */
function chairRecordsOf({
  pids,
  claudeHome,
  starts,
}: {
  pids: readonly number[];
  claudeHome: string;
  starts: ReadonlyMap<number, string>;
}): ChairRecords {
  const wanted = new Set(pids);
  const scan = scanSessions({ sessionsDir: join(claudeHome, "sessions") });
  if (scan.unreadable !== undefined) {
    return { kind: "unresolved", why: `the Claude session registry could not be read (${scan.unreadable})` };
  }
  // A registry file is named for its pid, so a refused one among the chair's pids is a session whose id is unknown.
  const chairRefusals = scan.refused.filter((refusal) =>
    pids.some((pid) => refusal.startsWith(`${String(pid)}.json:`)),
  );
  if (chairRefusals.length > 0) {
    return { kind: "unresolved", why: `a chair session's registry file would not read (${chairRefusals.join("; ")})` };
  }
  return {
    kind: "resolved",
    records: scan.records
      .filter((record) => wanted.has(record.pid))
      .filter((record) => record.procStart === undefined || starts.get(record.pid) === record.procStart.trim()),
  };
}

/** Every chair session judged, or why the registry could not say which sessions sit in the chair. */
export type ChairSessionReadings =
  | { readonly kind: "resolved"; readonly sessions: readonly ChairSessionReading[] }
  | { readonly kind: "unresolved"; readonly why: string };

/**
 * Judge every Claude session whose own process runs on one of a workspace's pids — the records
 * {@link chairRecordsOf} keeps, an unstamped one judged unread.
 *
 * @param pids every pid cmux reports for the pinned workspace
 * @param claudeHome the resolved `~/.claude`
 * @param starts each running pid's start stamp, from `../fleet/processStarts.ts`
 * @returns one reading per registered Claude session whose own process runs on one of those pids, or why the
 *   registry could not say
 */
export function readChairSessions({
  pids,
  claudeHome,
  starts,
}: {
  pids: readonly number[];
  claudeHome: string;
  starts: ReadonlyMap<number, string>;
}): ChairSessionReadings {
  const kept = chairRecordsOf({ claudeHome, pids, starts });
  if (kept.kind === "unresolved") {
    return kept;
  }
  return { kind: "resolved", sessions: kept.records.map((record) => judgeChairRecord({ claudeHome, record })) };
}

/** A process table's start stamp per running pid, or why it would not read — `readProcessStarts`'s shape. */
export type ReadProcessStarts = () => { readonly starts: ReadonlyMap<number, string> } | { readonly why: string };

/** Every chair session judged and bound to its running process, or which of the two reads that needs failed. */
export type BoundChairSessions =
  | { readonly kind: "resolved"; readonly sessions: readonly ChairSessionReading[] }
  | {
      readonly kind: "unresolved";
      readonly cause: Extract<ChairUnresolvedCause, "process-table-unread" | "registry-unread">;
      readonly why: string;
    };

/**
 * Read the process table, then judge the chair sessions among a workspace's pids against it — the one path every
 * chair reader takes, so none of them can judge a registry file by its pid alone.
 *
 * @param pids every pid the pinned workspace reports
 * @param claudeHome the resolved `~/.claude`
 * @param readStarts the process table's read; `readProcessStarts` in production, a plain fake in a test
 * @returns the judged sessions, or the cause and reason the table or the registry would not read
 */
export function readBoundChairSessions({
  pids,
  claudeHome,
  readStarts,
}: {
  pids: readonly number[];
  claudeHome: string;
  readStarts: ReadProcessStarts;
}): BoundChairSessions {
  const table = readStarts();
  if ("why" in table) {
    return {
      cause: "process-table-unread",
      kind: "unresolved",
      why: `the process table that binds a session to its pid could not be read (${table.why})`,
    };
  }
  const judged = readChairSessions({ claudeHome, pids, starts: table.starts });
  if (judged.kind === "unresolved") {
    return { cause: "registry-unread", kind: "unresolved", why: judged.why };
  }
  return judged;
}

/**
 * One kept chair record's verdict, off the tail of its transcript.
 *
 * @param record the registry record
 * @param claudeHome the resolved `~/.claude`
 * @returns its reading, unread when it carries no start stamp or its transcript is missing or will not read
 */
function judgeChairRecord({ record, claudeHome }: { record: SessionRecord; claudeHome: string }): ChairSessionReading {
  const { pid, sessionId } = record;
  if (record.procStart === undefined) {
    return {
      pid,
      sessionId,
      verdict: {
        kind: "unreadable",
        why: "its registry file names no start stamp, so it cannot be bound to the process on its pid",
      },
    };
  }
  const path = transcriptPathFor({ projectsDir: join(claudeHome, "projects"), sessionId });
  if (path === undefined) {
    return { pid, sessionId, verdict: { kind: "unreadable", why: "no transcript was found for this session" } };
  }
  try {
    return {
      pid,
      sessionId,
      verdict: judgeChairTranscript({ text: readTail({ maxBytes: DEPTH_TAIL_BYTES, path }) }),
    };
  } catch (error: unknown) {
    return {
      pid,
      sessionId,
      verdict: { kind: "unreadable", why: `its transcript could not be read (${String(error)})` },
    };
  }
}

/** The pinned chair's live Claude sessions by id, pid and process start, or why they could not be listed. */
export type ChairSessionIds =
  | {
      readonly kind: "resolved";
      readonly sessions: readonly { readonly sessionId: string; readonly pid: number; readonly procStart?: string }[];
    }
  | { readonly kind: "unresolved"; readonly why: string };

/**
 * The registered Claude sessions among a workspace's pids, by id and pid — no transcript read.
 *
 * The records are {@link chairRecordsOf}'s, the same ones the gate judges: a dead session's file on a pid a listed
 * shell now runs is gone, an unstamped one is kept for the credential read to name unread, and an unreadable registry
 * or a refused file among the chair's pids is said, never read as an empty chair. A live Claude process that never
 * wrote its `<pid>.json` is invisible here, exactly as it is to the gate: the registry is what names a pid a Claude
 * session at all, and telling one apart from the shells and tools in the same tree by its command line would be a
 * second, weaker definition of the same thing.
 *
 * @param pids every pid cmux reports for the pinned workspace
 * @param claudeHome the resolved `~/.claude`
 * @param starts each running pid's start stamp, from `../fleet/processStarts.ts`
 * @returns the sessions, or why the registry could not be read
 */
export function chairSessionIdsOf({
  pids,
  claudeHome,
  starts,
}: {
  pids: readonly number[];
  claudeHome: string;
  starts: ReadonlyMap<number, string>;
}): ChairSessionIds {
  const kept = chairRecordsOf({ claudeHome, pids, starts });
  if (kept.kind === "unresolved") {
    return kept;
  }
  return {
    kind: "resolved",
    sessions: kept.records.map(({ pid, procStart, sessionId }) => ({
      pid,
      sessionId,
      ...(procStart === undefined ? {} : { procStart }),
    })),
  };
}

/**
 * Read the process table, then list the chair sessions among a workspace's pids against it — the id-only twin of
 * {@link readBoundChairSessions}, which every plan read takes so none of them binds a registry file by its pid alone.
 *
 * @param pids every pid the pinned workspace reports
 * @param claudeHome the resolved `~/.claude`
 * @param readStarts the process table's read; `readProcessStarts` in production, a plain fake in a test
 * @returns the sessions, or why the table or the registry would not read
 */
export function readBoundChairSessionIds({
  pids,
  claudeHome,
  readStarts,
}: {
  pids: readonly number[];
  claudeHome: string;
  readStarts: ReadProcessStarts;
}): ChairSessionIds {
  const table = readStarts();
  if ("why" in table) {
    return {
      kind: "unresolved",
      why: `the process table that binds a session to its pid could not be read (${table.why})`,
    };
  }
  return chairSessionIdsOf({ claudeHome, pids, starts: table.starts });
}
