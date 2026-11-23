/**
 * Narrow readers for the supervisor tick's recorded readings of `session watch`, `listen status` and
 * `machine capacity` — the seats the `now` page joins to the board, and the two health readings the `now` page
 * keeps as one line.
 *
 * Same contract as `read.ts`, restated here because it is the whole point: every reader answers
 * `undefined` for a shape it does not recognise, never a plausible substitute, and a row that will not
 * parse refuses the WHOLE reading. No vitest lane reaches `site/components/`, so a verb changing its shape
 * can only break a tile — and a tile that says its shape changed is the one honest outcome.
 *
 * Every field here is the verb's own word. `signal` is `session watch`'s judgement, `grade` is
 * `listen status`'s, `verdict` is `machine capacity`'s sentence. Nothing in this file decides a seat is
 * stalled; it carries the word the verb printed.
 */

import { type Bag, bags, bool, instant, isBag, num, str, strings, sub } from "../../lib/bag";
import { type Reading, type RecordedReading, readingOf, readingOrNotRecordedOf } from "./reading";
import { type Capacity, readCapacity } from "./readNowCapacity";
import { count, optionalBool, optionalInstant, optionalStr } from "./readNowFields";

export { type Capacity, readCapacity } from "./readNowCapacity";
export type {
  CapacityCulprit,
  CapacityDispatch,
  CapacityInvestigation,
  CpuConsumer,
  CpuConsumers,
  MemoryConsumer,
} from "./readNowConsumers";

/** One open cmux seat, as the last drain of the activity store judged it. */
export interface Seat {
  /** Absent on an unmapped seat: the drain saw events under a workspace id cmux has not named yet. */
  readonly workspaceRef: string | undefined;
  readonly title: string | undefined;
  /** The cmux workspace id the events arrived under — the one field every row carries. */
  readonly workspaceId: string;
  readonly cwd: string;
  /** The verb's own signal: `working`, `needs-input`, `idle` or `silent`. */
  readonly signal: string;
  readonly quietMinutes: number;
  readonly toolCalls: number;
  /** Whether the drain could map the seat to a cmux workspace at all. */
  readonly mapped: boolean;
  /** Why it needs input, when it does — `notification`, `permission`; absent on a working seat. */
  readonly attentionKind: string | undefined;
  readonly lastEventName: string;
  /**
   * The agent CLI the seat's hooks named (`claude`), absent when none did — a seat from a capture before the field, a
   * walled seat the drain never saw — so a host's working sessions are counted by it and an unnamed one never guessed.
   */
  readonly host: string | undefined;
  /**
   * The agent CLI's own session id, which a transcript opens by — absent on a reading recorded before the verb carried
   * it, or when no hook payload named one. The four fields below read the same way: a missing key is not read.
   */
  readonly sessionId: string | undefined;
  /** When anything last happened in the seat. */
  readonly lastActivityAtIso: string | undefined;
  /** When the seat last booted. */
  readonly openedAtIso: string | undefined;
  /** Whether the seat is the pinned supervisor — the verb's own `isPinnedSupervisorWorkspace`, never a title match here. */
  readonly manager: boolean | undefined;
  /**
   * The title the session gave itself — Claude Code's newest `ai-title`, off its own transcript — absent on a reading
   * recorded before the verb carried it, or when the session has not titled itself.
   */
  readonly sessionTitle: string | undefined;
}

/** Every open seat at one instant, and what the drain could not see. */
export interface Seats {
  readonly observedAtIso: string;
  readonly rows: readonly Seat[];
  /** What the drain withheld or could not read, in its own sentences. Empty is a measured empty. */
  readonly diagnostics: readonly string[];
  /** Rows the verb suppressed as too old to be a seat, and the oldest of them — its denominator. */
  readonly suppressed: number;
  readonly suppressedOldestQuietMinutes: number | undefined;
}

/**
 * One seat off the report, or `undefined` when a field the page's claim rests on is missing.
 *
 * `workspaceRef` and `title` are the two fields the verb leaves off an UNMAPPED row — MEASURED on
 * a reading where one working seat carried only its workspace id, and the
 * tile read NOT MEASURED over fifteen real seats because this reader had demanded both. A missing name is
 * the verb's own fact about that seat; it is not a shape this page cannot read. A key that IS present and carries
 * anything but a string is, though: the row refuses rather than reading the field as absent.
 *
 * @returns the seat, or `undefined`
 */
function seatOf({ bag }: { bag: Bag }): Seat | undefined {
  const workspaceRef = optionalStr({ bag, key: "workspaceRef" });
  const title = optionalStr({ bag, key: "title" });
  const attentionKind = optionalStr({ bag, key: "attentionKind" });
  const host = optionalStr({ bag, key: "host" });
  const sessionId = optionalStr({ bag, key: "sessionId" });
  const sessionTitle = optionalStr({ bag, key: "sessionTitle" });
  const lastActivityAtIso = optionalInstant({ bag, key: "lastActivityAtIso" });
  const openedAtIso = optionalInstant({ bag, key: "openedAtIso" });
  const manager = optionalBool({ bag, key: "manager" });
  const workspaceId = str({ bag, key: "workspaceId" });
  const cwd = str({ bag, key: "cwd" });
  const signal = str({ bag, key: "signal" });
  const quietMinutes = count({ bag, key: "quietMinutes" });
  const toolCalls = count({ bag, key: "toolCalls" });
  const mapped = bool({ bag, key: "mapped" });
  const lastEventName = str({ bag, key: "lastEventName" });
  if (
    workspaceRef === false ||
    title === false ||
    attentionKind === false ||
    host === false ||
    sessionId === false ||
    sessionTitle === false ||
    lastActivityAtIso === false ||
    openedAtIso === false ||
    manager === "moved" ||
    workspaceId === undefined ||
    cwd === undefined ||
    signal === undefined ||
    quietMinutes === undefined ||
    toolCalls === undefined ||
    mapped === undefined ||
    lastEventName === undefined
  ) {
    return undefined;
  }
  return {
    attentionKind,
    cwd,
    host,
    lastActivityAtIso,
    lastEventName,
    manager,
    mapped,
    openedAtIso,
    quietMinutes,
    // An empty id names no session, whichever fold or older reading published it, so the card draws NOT MEASURED.
    sessionId: sessionId === "" ? undefined : sessionId,
    sessionTitle: sessionTitle === "" ? undefined : sessionTitle,
    signal,
    title,
    toolCalls,
    workspaceId,
    workspaceRef,
  };
}

/**
 * Project `session watch --json-report` into the seats tile's shape.
 *
 * @returns every seat, or `undefined` when the payload is not a report or one row will not read
 */
export function readSeats(payload: unknown): Seats | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const observedAtIso = instant({ bag: payload, key: "observedAtIso" });
  const rows = bags({ bag: payload, key: "rows" });
  const diagnostics = strings({ bag: payload, key: "diagnostics" });
  const suppressed = count({ bag: payload, key: "suppressed" });
  // The verb prints the key in every document, `null` when nothing was suppressed (`sessionWatchReportDocument`): a
  // missing key, or one carrying anything but a count or null, is a shape that moved.
  const oldestRaw = payload["suppressedOldestQuietMinutes"];
  const suppressedOldestQuietMinutes = count({ bag: payload, key: "suppressedOldestQuietMinutes" });
  const oldestMalformed = oldestRaw !== null && suppressedOldestQuietMinutes === undefined;
  if (
    observedAtIso === undefined ||
    rows === undefined ||
    diagnostics === undefined ||
    suppressed === undefined ||
    oldestMalformed
  ) {
    return undefined;
  }
  const seats: Seat[] = [];
  for (const row of rows) {
    const seat = seatOf({ bag: row });
    if (seat === undefined) {
      return undefined;
    }
    seats.push(seat);
  }
  return {
    diagnostics,
    observedAtIso,
    rows: seats,
    suppressed,
    suppressedOldestQuietMinutes,
  };
}

/** The last time a listener died, in the verb's own record. */
export interface ListenerDeath {
  readonly armId: string;
  readonly atIso: string;
  readonly reason: string;
  /** The tail of the dead arm's own log, absent when it could not be read — `report.ts` leaves the key out. */
  readonly lastLog: string | undefined;
}

/** Whether a Slack tag arriving now would be answered, in `listen status`'s own words. */
export interface Listener {
  /** The verb's grade: `unarmed`, `alive`, `stale`… — the one word the tile leads with. */
  readonly grade: string;
  readonly livenessState: string;
  /**
   * Absent when no listener has written a heartbeat — an unarmed listener, a no-op by design — which `listen status`
   * says by leaving the key out (`src/live/listen/supervise/report.ts`), never a reading to refuse.
   */
  readonly socketState: string | undefined;
  /** The verb's own sentence for the grade. */
  readonly why: string;
  readonly problems: readonly string[];
  readonly escalated: boolean;
  readonly deathsInWindow: number;
  /** Absent when nothing has ever beaten or arrived — a measured absence, not zero. */
  readonly heartbeatAgoMs: number | undefined;
  readonly lastEventAgoMs: number | undefined;
  readonly lastDeath: ListenerDeath | undefined;
}

/**
 * The last death off the status, when it names one.
 *
 * The caller has already established the field is present, so `undefined` here means the shape moved
 * and the whole reading refuses.
 *
 * @returns the death, or `undefined` when one of its three fields is missing
 */
function deathOf({ bag }: { bag: Bag }): ListenerDeath | undefined {
  const armId = str({ bag, key: "armId" });
  const atIso = str({ bag, key: "atIso" });
  const reason = str({ bag, key: "reason" });
  // Absent is a log `report.ts` could not read; present and not a string is a moved shape, refused.
  const lastLog = optionalStr({ bag, key: "lastLog" });
  if (armId === undefined || atIso === undefined || reason === undefined || lastLog === false) {
    return undefined;
  }
  return { armId, atIso, lastLog, reason };
}

/**
 * The words the tile draws as its two leading stats, each the producer's whole closed set (`ListenerGrade` in
 * `src/live/listen/supervise/report.ts`, `ListenerSocketState` in `heartbeat.ts`): any other value is a moved shape,
 * so a raw string never leads the tile above its plain sentence.
 */
const LISTENER_GRADES: ReadonlySet<string> = new Set(["healthy", "degraded", "down", "unarmed"]);
const SOCKET_STATES: ReadonlySet<string> = new Set(["connecting", "connected", "disconnected"]);

/**
 * Project `listen status --json` into the listener tile's shape.
 *
 * @returns the status, or `undefined` when the payload is not one
 */
export function readListener(payload: unknown): Listener | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const grade = str({ bag: payload, key: "grade" });
  const liveness = sub({ bag: payload, key: "liveness" });
  // Absent is an unarmed listener; present and not a string (`false`) is a malformed reading, refused below.
  const socketState = optionalStr({ bag: payload, key: "socketState" });
  const why = str({ bag: payload, key: "why" });
  const problems = strings({ bag: payload, key: "problems" });
  const escalated = bool({ bag: payload, key: "escalated" });
  const deathsInWindow = num({ bag: payload, key: "deathsInWindow" });
  if (
    grade === undefined ||
    liveness === undefined ||
    socketState === false ||
    why === undefined ||
    problems === undefined ||
    escalated === undefined ||
    deathsInWindow === undefined
  ) {
    return undefined;
  }
  if (!LISTENER_GRADES.has(grade) || (socketState !== undefined && !SOCKET_STATES.has(socketState))) {
    return undefined;
  }
  const livenessState = str({ bag: liveness, key: "state" });
  if (livenessState === undefined) {
    return undefined;
  }
  const deathBag = sub({ bag: payload, key: "lastDeath" });
  let lastDeath: ListenerDeath | undefined;
  if (deathBag !== undefined) {
    lastDeath = deathOf({ bag: deathBag });
    if (lastDeath === undefined) {
      return undefined;
    }
  }
  return {
    deathsInWindow,
    escalated,
    grade,
    heartbeatAgoMs: num({ bag: payload, key: "heartbeatAgoMs" }),
    lastDeath,
    lastEventAgoMs: num({ bag: payload, key: "lastEventAgoMs" }),
    livenessState,
    problems,
    socketState,
    why,
  };
}

/**
 * The last recorded reading of `session watch`, or the answer that the supervisor has recorded none yet.
 *
 * @returns the reading, or `undefined`
 */
export function readSeatsReading(payload: unknown): RecordedReading<Seats> | undefined {
  return readingOrNotRecordedOf({ payload, read: readSeats });
}

/**
 * The last recorded reading of `listen status`.
 *
 * @returns the reading, or `undefined`
 */
export function readListenerReading(payload: unknown): Reading<Listener> | undefined {
  return readingOf({ payload, read: readListener });
}

/**
 * The last recorded reading of `machine capacity`.
 *
 * @returns the reading, or `undefined`
 */
export function readCapacityReading(payload: unknown): Reading<Capacity> | undefined {
  return readingOf({ payload, read: readCapacity });
}
