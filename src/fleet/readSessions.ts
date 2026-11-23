/**
 * The live sessions `fleet health` judges: each registry record joined to the credential its process booted on, the
 * board row its ledger entry names, and its cmux workspace — split out of {@link ./read} so that file keeps to the
 * machine and the journals. Offline like the rest: a process listing, the ledger and the board, never cmux or a
 * provider.
 */
import { collapseWhitespace } from "#lib/oneLineSummary.js";

import type { ClaudeAccount } from "../claude/contracts.js";
import { readChairPlansForSessions } from "../claude/seatBootRead.js";
import { effectivePriority } from "../handover/rowKind.js";
import { lookupDocBySlug } from "../handover/store.js";
import type { SessionRecord } from "../sessions/liveSessions.js";
import { lstartToIso } from "../sessions/parkSeat.js";
import { foldSessions, parseSessionLog, type SessionItem } from "../sessions/session.js";
import { readSessionLogText } from "../sessions/sessionStore.js";
import { stateHomePaths } from "../stateHome.js";
import type { FleetBoot, FleetLiveSession, FleetSeatRow } from "./evidence.js";

/** Each live session's boot credential, read off its own process. */
function bootsOf({
  accounts,
  records,
}: {
  accounts: readonly ClaudeAccount[] | undefined;
  records: readonly SessionRecord[];
}): ReadonlyMap<string, FleetBoot> {
  const boots = new Map<string, FleetBoot>();
  if (accounts === undefined) {
    for (const record of records) {
      boots.set(record.sessionId, { kind: "unresolved", why: "no plan register is readable" });
    }
    return boots;
  }
  const read = readChairPlansForSessions({
    accounts,
    sessions: records.map((record) => ({
      pid: record.pid,
      sessionId: record.sessionId,
      ...(record.procStart === undefined ? {} : { procStart: record.procStart }),
    })),
  });
  for (const session of read.sessions) {
    boots.set(session.sessionId, session.plan);
  }
  for (const record of records) {
    if (!boots.has(record.sessionId)) {
      boots.set(record.sessionId, { kind: "unresolved", why: "its boot credential was not read" });
    }
  }
  return boots;
}

/** The newest ledger row for each working directory, so a seat can be named by the row it was spawned for. */
function ledgerByCwd({ home }: { home: string }): ReadonlyMap<string, SessionItem> {
  const byCwd = new Map<string, SessionItem>();
  const items = foldSessions({ events: parseSessionLog({ text: readSessionLogText({ home }) }).events });
  for (const item of items) {
    if (item.cwd === undefined) {
      continue;
    }
    const held = byCwd.get(item.cwd);
    if (held === undefined || item.lastEventIso > held.lastEventIso) {
      byCwd.set(item.cwd, item);
    }
  }
  return byCwd;
}

/** The board row a ledger slug names, read as one exact doc rather than a board scan. */
function rowOf({ home, slug }: { home: string; slug: string | undefined }): FleetSeatRow | undefined {
  if (slug === undefined) {
    return undefined;
  }
  const doc = lookupDocBySlug({ handoverDir: stateHomePaths({ home }).handovers, slug });
  if (doc === undefined) {
    return undefined;
  }
  const priority = effectivePriority({ declared: doc.priority, kind: doc.kind });
  // A doc with no summary line is still a row: its slug is the name the board itself shows for it.
  if (doc.summary === undefined) {
    return { id: doc.slug, priority, title: doc.slug };
  }
  // One line: a `--keep-lines` summary holds real breaks, and a title is printed as one row.
  return { id: doc.slug, priority, title: collapseWhitespace({ text: doc.summary }) };
}

/**
 * Each live session with its boot credential, its board row and its cmux workspace.
 *
 * @param home the state home whose ledger and board name each session's row
 * @param accounts the plan register, when it could be read
 * @param liveRecords the registry records whose process is alive
 * @returns one live session per record
 */
export function liveSessionsOf({
  home,
  accounts,
  liveRecords,
}: {
  home: string;
  accounts: readonly ClaudeAccount[] | undefined;
  liveRecords: readonly SessionRecord[];
}): FleetLiveSession[] {
  const boots = bootsOf({ accounts, records: liveRecords });
  const ledger = ledgerByCwd({ home });
  return liveRecords.map((record) => {
    const item = ledger.get(record.cwd);
    // The start is the `procStart` liveness verified against `ps`, never the registry's own `startedAt`, which nothing
    // binds to the running process. A stamp that does not parse reads as 0, which the judge
    // treats as an unknown start.
    const startedIso = record.procStart === undefined ? undefined : lstartToIso({ text: record.procStart });
    return {
      // `bootsOf` answers for every record it was given, unresolved included.
      boot: boots.get(record.sessionId)!,
      cwd: record.cwd,
      row: rowOf({ home, slug: item?.slug }),
      sessionId: record.sessionId,
      startedAtMs: startedIso === undefined ? 0 : Date.parse(startedIso),
      workspaceRef: item?.workspaceRef,
    };
  });
}
