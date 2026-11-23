/**
 * The effectful edge of `./seatAttest.ts`: find ONE session in Claude Code's own registry by its id, then read what
 * its process booted on through the same `ps`/`lsof`/`stat` reads `claude gauge` makes of the chair
 * (`./seatBootRead.ts`), bound to the registry's recorded process start.
 *
 * Local and read-only. It runs on every prompt a hooked session submits, so it reaches no provider and no
 * Datadog: the reads it makes are one registry listing and three or four process listings of one pid.
 */
import { join } from "node:path";

import { scanSessions } from "../sessions/liveSessionStore.js";
import type { ClaudeAccount } from "./contracts.js";
import type { SeatReading } from "./seatAttest.js";
import { type ProcessRead, readChairPlansForSessions } from "./seatBootRead.js";

/**
 * Read the boot credential of the one live session carrying this id.
 *
 * @param sessionId the session to read, as the hook payload names it
 * @param claudeHome the resolved `~/.claude`, where Claude Code registers its live sessions
 * @param accounts the configured plans, paused ones included — a session booted on a paused plan is still on it
 * @param read the read-only `ps`/`lsof` listing, injected only by tests
 * @returns its boot credential, or why it could not be read
 */
export function readOwnSeat({
  sessionId,
  claudeHome,
  accounts,
  read,
}: {
  sessionId: string;
  claudeHome: string;
  accounts: readonly ClaudeAccount[];
  read?: ProcessRead;
}): SeatReading {
  const scan = scanSessions({ sessionsDir: join(claudeHome, "sessions") });
  if (scan.unreadable !== undefined) {
    return { kind: "unread", why: scan.unreadable };
  }
  const own = scan.records.filter((record) => record.sessionId === sessionId);
  const [record] = own;
  if (record === undefined) {
    return { kind: "unread", why: `no live session in ${join(claudeHome, "sessions")} carries id ${sessionId}` };
  }
  if (own.length > 1) {
    return {
      kind: "unread",
      why: `${String(own.length)} live processes carry session id ${sessionId}, so no one of them is this session`,
    };
  }
  const session = {
    pid: record.pid,
    sessionId,
    ...(record.procStart === undefined ? {} : { procStart: record.procStart }),
  };
  const chair = readChairPlansForSessions({ accounts, sessions: [session], ...(read === undefined ? {} : { read }) });
  const [judged] = chair.sessions;
  if (judged === undefined) {
    return { kind: "unread", why: `the boot-credential read returned nothing for pid ${String(record.pid)}` };
  }
  return {
    kind: "read",
    plan: judged.plan,
    ...(record.procStart === undefined ? {} : { process: { pid: record.pid, procStart: record.procStart } }),
  };
}
