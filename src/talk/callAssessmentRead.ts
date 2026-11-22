/**
 * The daily call reader's worklist: every call on disk, sorted into what still needs the session's judgement and
 * what does not. The disk half of `./callAssessment.ts`; the verbs are `talk assessment-due` and
 * `talk assessment-record`.
 *
 * ## Every call, judged by its digest, never by a file's time
 *
 * A call file keeps its times on purpose when it is appended to (`./callFileAppend.ts`), so a window over write
 * times would miss words added to an older call — `./recallRead.ts` measured that turning an in-window match into an
 * exact zero. So this reads every call file whole and lets the register decide: a call is DUE when no assessment is
 * recorded for the digest of its current words. A day's calls are due on the day's firing, a missed day's are still
 * due on the next one, and words added after a verdict make that call due again.
 *
 * ## What is not offered for a verdict, and why each is said rather than dropped
 *
 * - **live** — not ended, and heard from within {@link LIVE_QUIET_MS} of now. Its words are still arriving, so a
 *   verdict now would go stale within minutes; the next firing takes it.
 * - **incomplete** — a line of it did not parse, or the file could not be read. A torn line may hold words the owner
 *   said, and a class decided without them could be too low, so the call stays `unknown` and is named.
 * - **foreign** — an owner-side stretch was written by a console that is not the owner's (`./callOrigin.ts`). Those
 *   words are not the owner's yet sit in the same record, so classifying the rest could put the call below what it
 *   holds; the whole call stays `unknown` and is named.
 * - **silent** — the owner said nothing on it: nothing of theirs to classify. Counted.
 * - **test instance** — the desktop walk's own speech, never the owner's (`./callOrigin.ts`). Counted.
 *
 * A call directory that cannot be listed, or a register that cannot be read, fails the whole read: an unreadable
 * worklist is never read as nothing due.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { DataClassAssessmentVerdict } from "../store/dataClassRules.js";
import {
  type RecordedCallAssessment,
  readRecordedAssessments,
  recordedAssessmentFor,
} from "../store/recordedDataClassAssessment.js";
import { type CallAssessmentRequest, callAssessmentRequest } from "./callAssessment.js";
import { type CallOrigin, callTouchedByTestInstance, isOwnerCallOrigin, originAfterOpen } from "./callOrigin.js";
import { type CallEntry, type CallRecord, foldCall, OWNER_SPEAKER } from "./callRecord.js";
import { callsDir, isCallId, readCallEntriesCounted } from "./callStore.js";
import { JOURNAL_SUFFIX, regularFiles } from "./recallRead.js";

/** A call file's name: the id, then `.jsonl`. */
const CALL_FILE = /^([0-9a-f-]{36})\.jsonl$/u;

/**
 * How long an unended call must have been quiet before its words are offered for a verdict: thirty minutes.
 *
 * @internal — exported so the test judges the window's edge.
 */
export const LIVE_QUIET_MS = 30 * 60 * 1000;

/** A call already assessed for its current words. */
interface AssessedCall {
  readonly callId: string;
  readonly requestSha256: string;
  readonly verdict: DataClassAssessmentVerdict;
}

/** A call not offered for a verdict, with why. */
interface HeldCall {
  readonly callId: string;
  readonly why: string;
}

/** The worklist: what is due, and every call that is not, by reason. */
export interface CallAssessmentWorklist {
  /** One request per call whose current words have no recorded assessment, oldest call first. */
  readonly due: readonly CallAssessmentRequest[];
  readonly assessed: readonly AssessedCall[];
  readonly live: readonly HeldCall[];
  readonly incomplete: readonly HeldCall[];
  /** Calls holding an owner-side stretch a console not the owner's wrote. */
  readonly foreign: readonly HeldCall[];
  /** Calls the owner said nothing on. */
  readonly silent: number;
  /** Calls the desktop test instance opened. */
  readonly testInstance: number;
}

/** The call directory or the register could not be read. */
export interface CallAssessmentReadFailedError {
  readonly code: "CALL_ASSESSMENT_READ_FAILED";
  readonly message: string;
}

/** One call is not offered for a verdict now: live, incomplete, foreign, silent or the test instance's. */
export interface CallNotOfferedError {
  readonly code: "CALL_NOT_OFFERED";
  readonly message: string;
  readonly callId: string;
}

/**
 * The factories this module's failures are built through.
 *
 * @internal — exported so a test builds the same failures the reader does.
 */
export const CallAssessmentReadErrors = {
  notOffered: ({ callId, why }: { callId: string; why: string }): CallNotOfferedError => ({
    callId,
    code: "CALL_NOT_OFFERED",
    message: `call ${callId} is not offered for a verdict: ${why}`,
  }),
  readFailed: ({ detail }: { detail: string }): CallAssessmentReadFailedError => ({
    code: "CALL_ASSESSMENT_READ_FAILED",
    message: `the call worklist could not be read, so nothing is offered as due or as done: ${detail}`,
  }),
} as const;

/** What one call file came to. */
type CallStanding =
  | { readonly kind: "request"; readonly request: CallAssessmentRequest; readonly openedIso: string }
  | { readonly kind: "live" | "incomplete" | "foreign"; readonly held: HeldCall }
  | { readonly kind: "silent" | "test-instance" };

/**
 * Whether a folded call is still being spoken on: not ended, and heard from within {@link LIVE_QUIET_MS} of now.
 *
 * @param record the folded call
 * @param nowMs the instant judged at
 * @returns true while its words may still be arriving
 */
function callStillLive({ record, nowMs }: { record: CallRecord; nowMs: number }): boolean {
  return record.ended === undefined && nowMs - Date.parse(record.lastIso) < LIVE_QUIET_MS;
}

/**
 * The first owner-side stretch written under a console that is not the owner's, in one pass over the call's lines —
 * the same reading `./callOrigin.ts`'s `segmentForeignOrigin` makes per stretch.
 *
 * @param entries the call's lines, in file order
 * @returns that stretch's id, or `undefined` when every owner line sits under the owner's console or an unstamped open
 * @internal — exported so the origin reading is tested on lines alone.
 */
export function foreignOwnerSegment({ entries }: { entries: readonly CallEntry[] }): string | undefined {
  let origin: CallOrigin | undefined;
  for (const entry of entries) {
    if (entry.kind === "open") {
      origin = originAfterOpen({ opened: entry.origin, previous: origin });
    }
    if (entry.kind === "segment" && entry.who === OWNER_SPEAKER && !isOwnerCallOrigin({ origin })) {
      return entry.id;
    }
  }
  return undefined;
}

/**
 * Read one call file whole and say what it comes to.
 *
 * @returns the call's standing
 */
function standingOf({ home, callId, nowMs }: { home: string; callId: string; nowMs: number }): CallStanding {
  const read = readCallEntriesCounted({ callId, home });
  if (read.isErr()) {
    return { held: { callId, why: read.error.message }, kind: "incomplete" };
  }
  if (callTouchedByTestInstance({ entries: read.value.entries })) {
    return { kind: "test-instance" };
  }
  const foreign = foreignOwnerSegment({ entries: read.value.entries });
  if (foreign !== undefined) {
    return {
      held: { callId, why: `stretch ${foreign} was written by a console that is not the owner's` },
      kind: "foreign",
    };
  }
  const record = foldCall({ callId, entries: read.value.entries, skipped: read.value.skipped });
  if (record === undefined) {
    return { kind: "silent" };
  }
  if (read.value.skipped > 0) {
    return {
      held: { callId, why: `${String(read.value.skipped)} line(s) did not parse, and may hold words the owner said` },
      kind: "incomplete",
    };
  }
  if (callStillLive({ nowMs, record })) {
    return { held: { callId, why: `still live: last heard ${record.lastIso}` }, kind: "live" };
  }
  const request = callAssessmentRequest({ record });
  if (request === undefined) {
    return { kind: "silent" };
  }
  return { kind: "request", openedIso: record.openedIso, request };
}

/**
 * Sort the calls' standings and the register into the worklist.
 *
 * @param standings each call file's standing
 * @param records the register's recorded assessments
 * @returns the worklist
 */
function callAssessmentWorklist({
  standings,
  records,
}: {
  standings: readonly CallStanding[];
  records: readonly RecordedCallAssessment[];
}): CallAssessmentWorklist {
  const due: { request: CallAssessmentRequest; openedIso: string }[] = [];
  const assessed: AssessedCall[] = [];
  const live: HeldCall[] = [];
  const incomplete: HeldCall[] = [];
  const foreign: HeldCall[] = [];
  let silent = 0;
  let testInstance = 0;
  for (const standing of standings) {
    if (standing.kind === "request") {
      const { callId, requestSha256 } = standing.request;
      const found = recordedAssessmentFor({ callId, records, requestSha256 });
      if (found === undefined) {
        due.push({ openedIso: standing.openedIso, request: standing.request });
      } else {
        assessed.push({ callId, requestSha256, verdict: found.verdict });
      }
    } else if (standing.kind === "live") {
      live.push(standing.held);
    } else if (standing.kind === "incomplete") {
      incomplete.push(standing.held);
    } else if (standing.kind === "foreign") {
      foreign.push(standing.held);
    } else if (standing.kind === "silent") {
      silent += 1;
    } else {
      testInstance += 1;
    }
  }
  const oldestFirst = due.toSorted((a, b) => Date.parse(a.openedIso) - Date.parse(b.openedIso));
  return { assessed, due: oldestFirst.map((one) => one.request), foreign, incomplete, live, silent, testInstance };
}

/**
 * Read every call under a home and the register beside it into the worklist.
 *
 * @param nowMs the instant a call's liveness is judged at
 * @returns the worklist, or why the calls or the register could not be read
 */
export function readCallAssessmentWorklist({
  home,
  nowMs,
}: {
  home: string;
  nowMs: number;
}): Result<CallAssessmentWorklist, CallAssessmentReadFailedError> {
  const listed = regularFiles({ dir: callsDir({ home }), keep: (name) => CALL_FILE.test(name) });
  if (listed.isErr()) {
    return err(CallAssessmentReadErrors.readFailed({ detail: listed.error.message }));
  }
  const records = readRecordedAssessments({ home });
  if (records.isErr()) {
    return err(CallAssessmentReadErrors.readFailed({ detail: records.error.message }));
  }
  const standings: CallStanding[] = listed.value.skipped.map((why): CallStanding => ({
    held: { callId: "(unlisted)", why },
    kind: "incomplete",
  }));
  for (const file of listed.value.files) {
    const callId = file.name.slice(0, -JOURNAL_SUFFIX.length);
    if (!isCallId({ callId })) {
      continue;
    }
    standings.push(standingOf({ callId, home, nowMs }));
  }
  return ok(callAssessmentWorklist({ records: records.value, standings }));
}

/**
 * The current request for one call, read whole — what `talk assessment-record` checks a verdict against.
 *
 * @param nowMs the instant liveness is judged at
 * @returns the request, or why this call cannot be assessed now
 */
export function readCallAssessmentRequest({
  home,
  callId,
  nowMs,
}: {
  home: string;
  callId: string;
  nowMs: number;
}): Result<CallAssessmentRequest, CallNotOfferedError> {
  const standing = standingOf({ callId, home, nowMs });
  if (standing.kind === "request") {
    return ok(standing.request);
  }
  let why = "the desktop test instance opened it, so its words are not the owner's";
  if (standing.kind === "live" || standing.kind === "incomplete" || standing.kind === "foreign") {
    why = standing.held.why;
  } else if (standing.kind === "silent") {
    why = "it holds nothing the owner said, so there is nothing to classify";
  }
  return err(CallAssessmentReadErrors.notOffered({ callId, why }));
}
