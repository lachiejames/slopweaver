/**
 * One incident read: the incident channel's every announcement, the threads of those still worth showing, and the
 * snapshot the `org-health` monitor reads back.
 *
 * ## The whole channel, every time
 *
 * incident.io edits an announcement in place, and Slack orders history by a message's ORIGINAL `ts`, so an incident
 * declared a month ago and reopened today sits a month deep. A lookback window would clear it (`../corpus/slack/
 * threadOracle.ts` states the same consequence for a watermark). So the read walks every root, at 999 a page, and
 * opens a thread only for what {@link rootsToOpen} keeps — refusing BEFORE the first thread when that is more than a
 * tick affords.
 *
 * ## Crash-safe by ordering, one at a time by a lock, last-writer-safe by a generation, inside the tick by a deadline
 *
 * {@link runIncidentRead} takes the lane's lock (`./readLock.ts`), commits the "under way" marker in the store
 * (`./port.ts`'s `beginRead`), which answers the read's generation, then publishes exactly one outcome against that
 * generation: `measured` on a complete read, `unmeasurable` naming why on any other. A read the supervisor kills
 * leaves the marker. A measured outcome publishes its phase sightings (`./sightings.ts`) and its snapshot in ONE
 * transaction, so a failed read never moves the instant an inferred phase is dated by.
 *
 * A read refused the lock still commits a marker, so a holder suspended before its own marker cannot leave the last
 * success current for this tick — and that marker moves the generation, so the suspended holder's outcome lands as
 * `REVISION_CONFLICT` rather than last. A marker only ever reads unmeasurable: landing late costs one tick's blindness
 * and never a false clear. Every Slack call, each history and reply page included, races the read's own wall-clock
 * deadline ({@link READ_DEADLINE_MS}, `./deadline.ts`), short of the supervisor's, so a slow or hung channel ends as an
 * `unmeasurable` it wrote rather than a kill.
 *
 * Effectful through three seams: the Slack read api, the state port and the lock are passed in, so a test hands plain
 * fakes and the in-memory port (`src/__tests__/orgHealthStoreFixture.ts`).
 */
import { err, ok, type Result } from "#lib/result.js";
import { slackTsFromEpochMs, slackTsToIso } from "#lib/slackTs.js";

import type { SlackApi } from "../corpus/slack/fetch.js";
import {
  type CompleteThreadFetch,
  fetchCompleteSlackHistory,
  fetchCompleteSlackThread,
} from "../live/slack/pagination.js";

import { deadlineBound } from "./deadline.js";
import { type OrgHealthError, OrgHealthErrors } from "./errors.js";
import { classifyIncidentIoRoot, type IncidentIoRoot, incidentBotsOf } from "./incidentIo.js";
import { parseIncidentIoThread } from "./incidentIoThread.js";
import {
  HISTORY_PAGE_BUDGET,
  keptIncidents,
  READ_DEADLINE_MS,
  rootsToOpen,
  THREAD_BUDGET,
  THREAD_PAGE_BUDGET,
} from "./policy.js";
import type { IncidentReadGeneration, OrgHealthPort } from "./port.js";
import type { TakeReadLock } from "./readLock.js";
import { applySightings, type IncidentSightings } from "./sightings.js";
import type { MeasuredIncidentSnapshot, ThreadIncident, UnmeasurableIncidentSnapshot } from "./types.js";

/** The Slack calls a read makes. */
export type IncidentReadApi = Pick<SlackApi, "history" | "replies">;

/** What a complete read found, and what it cost. */
export interface IncidentRead {
  readonly snapshot: MeasuredIncidentSnapshot;
  /** Each incident as this read saw it, for the next read to date an inferred phase and a loud moment by. */
  readonly sightings: IncidentSightings;
  /** History pages the walk took. */
  readonly historyPages: number;
  /** Threads it opened. */
  readonly threadsOpened: number;
}

/**
 * Read the incident channel whole and build the snapshot. Writes nothing.
 *
 * @param api the Slack read seam
 * @param channelId the channel incident.io announces into
 * @param nowMs the instant the read is judged at
 * @param previous what the last complete read remembered of each incident, `undefined` with no memory to read
 *   (`./sightings.ts` § A read with no memory at all)
 * @param clock a monotonic clock, in ms, that every Slack call is raced against {@link READ_DEADLINE_MS} by — never
 *   the wall clock, which NTP or a person can step backward mid-read
 * @param wait the timer the race runs on (`./deadline.ts`)
 * @returns the snapshot, the sightings and its cost, or why the channel could not be read whole
 */
export async function readOrgIncidents({
  api: unbound,
  channelId,
  nowMs,
  previous,
  clock,
  wait,
}: {
  api: IncidentReadApi;
  channelId: string;
  nowMs: number;
  previous: IncidentSightings | undefined;
  clock: () => number;
  wait: (ms: number) => Promise<void>;
}): Promise<Result<IncidentRead, OrgHealthError>> {
  const readIso = new Date(nowMs).toISOString();
  const { api, spentAtMs } = deadlineBound({ api: unbound, clock, wait });
  const failed = ({ detail }: { detail: string }): OrgHealthError => slackFailure({ channelId, detail, spentAtMs });
  const history = await fetchCompleteSlackHistory({
    api,
    channel: channelId,
    includeAllMetadata: true,
    latest: slackTsFromEpochMs({ ms: nowMs }),
    maxPages: HISTORY_PAGE_BUDGET,
    oldest: "0",
  });
  if (history.isErr()) {
    return err(failed({ detail: history.error.message }));
  }
  const announced = announcementsOf({ messages: history.value.rawMessages });
  if (announced.isErr()) {
    return err(announced.error);
  }
  const roots = announced.value;
  const toOpen = rootsToOpen({ nowMs, roots });
  if (toOpen.length > THREAD_BUDGET) {
    return err(OrgHealthErrors.budgetExceeded({ budget: THREAD_BUDGET, count: toOpen.length }));
  }
  const incidents = await threadsOf({ api, channelId, failed, roots: toOpen });
  if (incidents.isErr()) {
    return err(incidents.error);
  }
  const firstSeenIso = firstSeenIsos({ readIso, roots: toOpen });
  const dated = applySightings({ firstSeenIso, incidents: incidents.value, previous, readIso });
  return ok({
    historyPages: history.value.pageCount,
    sightings: dated.sightings,
    snapshot: {
      announcementCount: roots.length,
      channelId,
      incidents: keptIncidents({ incidents: dated.incidents, nowMs }),
      readIso,
      schemaVersion: 1,
      state: "measured",
    },
    threadsOpened: toOpen.length,
  });
}

/** A failed Slack call as the read reports it: the deadline, when the call found it spent, else the call's own failure. */
function slackFailure({
  channelId,
  detail,
  spentAtMs,
}: {
  channelId: string;
  detail: string;
  spentAtMs: () => number | undefined;
}): OrgHealthError {
  const elapsedMs = spentAtMs();
  if (elapsedMs === undefined) {
    return OrgHealthErrors.slackReadFailed({ channelId, detail });
  }
  return OrgHealthErrors.deadlinePassed({ deadlineMs: READ_DEADLINE_MS, elapsedMs });
}

/** Each root's thread, read and parsed as its incident, or the first reason one could not be. */
async function threadsOf({
  api,
  channelId,
  roots,
  failed,
}: {
  api: IncidentReadApi;
  channelId: string;
  roots: readonly IncidentIoRoot[];
  failed: (args: { detail: string }) => OrgHealthError;
}): Promise<Result<ThreadIncident[], OrgHealthError>> {
  const incidents: ThreadIncident[] = [];
  for (const root of roots) {
    const thread = await fetchCompleteSlackThread({
      api,
      channel: channelId,
      maxPages: THREAD_PAGE_BUDGET,
      threadTs: root.ts,
    });
    if (thread.isErr()) {
      return err(failed({ detail: thread.error.message }));
    }
    const incident = parseIncidentIoThread({ pages: pagesOf({ thread: thread.value }), root });
    if (incident.isErr()) {
      return err(incident.error);
    }
    incidents.push(incident.value);
  }
  return ok(incidents);
}

/** A walked thread split back into the pages Slack returned, each beginning at its recorded start. */
function pagesOf({ thread }: { thread: CompleteThreadFetch }): (readonly unknown[])[] {
  const ends = [...thread.pageStarts.slice(1), thread.rawMessages.length];
  return thread.pageStarts.map((start, index) => thread.rawMessages.slice(start, ends[index]));
}

/** Every incident.io announcement in the channel's history, or why one could not be parsed. */
function announcementsOf({ messages }: { messages: readonly unknown[] }): Result<IncidentIoRoot[], OrgHealthError> {
  const roots: IncidentIoRoot[] = [];
  const incidentBots = incidentBotsOf({ messages });
  for (const raw of messages) {
    const classified = classifyIncidentIoRoot({ incidentBots, raw });
    if (classified.isErr()) {
      return err(classified.error);
    }
    if (classified.value.kind === "incident") {
      roots.push(classified.value.root);
    }
  }
  return ok(roots);
}

/**
 * Per ref, when a phase first seen at this read is dated: the root's last edit, else the read's own start. Neither is
 * the move itself, which no update recorded. Both are upper bounds on it — incident.io edits the root on every status
 * change, so the move is no later than the last edit — and the edit is the tighter one; a cosmetic edit after the move
 * loosens it toward the read's start, and never past it. `sighted` names that the instant is a bound, not a record.
 */
function firstSeenIsos({
  roots,
  readIso,
}: {
  roots: readonly IncidentIoRoot[];
  readIso: string;
}): Readonly<Record<string, string>> {
  return Object.fromEntries(
    roots.map((root) => {
      if (root.editedTs === undefined) {
        return [root.ref, readIso];
      }
      const edited = slackTsToIso({ ts: root.editedTs });
      if (edited === undefined) {
        return [root.ref, readIso];
      }
      return [root.ref, edited];
    }),
  );
}

/** An `unmeasurable` snapshot attempted at the read's start. */
function unmeasurable({ because, startedIso }: { because: string; startedIso: string }): UnmeasurableIncidentSnapshot {
  return { attemptedIso: startedIso, because, schemaVersion: 1, state: "unmeasurable" };
}

/** What a read refused the lock records as its marker's reason. */
function lockRefusedBecause({ error }: { error: OrgHealthError }): string {
  if (error.code === "READ_UNDER_WAY") {
    return `a read is under way: ${error.message}`;
  }
  return `the read lock could not be taken: ${error.message}`;
}

/**
 * Run one read end to end: take the lock, commit the marker, read, and publish exactly one outcome.
 *
 * @param home the Slopweaver home whose store and runtime directory the read uses
 * @param source the channel and the api to read it with, or why there is none — an install with no channel or no
 *   token still writes `unmeasurable`, so the monitor says what is missing rather than reading quiet
 * @param port the store the marker, the sightings and the outcome go through
 * @param takeLock the lock seam — production's `takeReadLock`
 * @param nowMs the instant the read starts
 * @param clock the wall clock, in epoch ms, the read takes its lock by
 * @param elapsed a monotonic clock, in ms, the read keeps its deadline by
 * @param wait the timer the deadline races each Slack call on
 * @returns the complete read, why the snapshot now reads `unmeasurable`, `READ_UNDER_WAY` or `READ_LOCK_UNAVAILABLE`
 *   when this read only marked the snapshot unmeasurable, or a store refusal naming that nothing is known written
 */
export async function runIncidentRead({
  home,
  source,
  port,
  takeLock,
  nowMs,
  clock,
  elapsed,
  wait,
}: {
  home: string;
  source: Result<{ readonly api: IncidentReadApi; readonly channelId: string }, OrgHealthError>;
  port: OrgHealthPort;
  takeLock: TakeReadLock;
  nowMs: number;
  clock: () => number;
  elapsed: () => number;
  wait: (ms: number) => Promise<void>;
}): Promise<Result<IncidentRead, OrgHealthError>> {
  const startedIso = new Date(nowMs).toISOString();
  const lock = takeLock({ home, nowIso: new Date(clock()).toISOString() });
  if (lock.isErr()) {
    const marker = unmeasurable({ because: lockRefusedBecause({ error: lock.error }), startedIso });
    const marked = await port.beginRead({ home, marker });
    if (marked.isErr()) {
      return err(marked.error);
    }
    return err(lock.error);
  }
  try {
    return await readLocked({ clock: elapsed, home, nowMs, port, source, startedIso, wait });
  } finally {
    lock.value.release();
  }
}

/** {@link runIncidentRead} once it holds the lock: begin a generation, read, and publish exactly one outcome. */
async function readLocked({
  home,
  source,
  port,
  nowMs,
  clock,
  startedIso,
  wait,
}: {
  home: string;
  source: Result<{ readonly api: IncidentReadApi; readonly channelId: string }, OrgHealthError>;
  port: OrgHealthPort;
  nowMs: number;
  clock: () => number;
  startedIso: string;
  wait: (ms: number) => Promise<void>;
}): Promise<Result<IncidentRead, OrgHealthError>> {
  const because = `an incident read started at ${startedIso} and has not finished — it is still running, or it was killed`;
  const generation = await port.beginRead({ home, marker: unmeasurable({ because, startedIso }) });
  if (generation.isErr()) {
    return err(generation.error);
  }
  const read = await readWith({ clock, home, nowMs, port, source, wait });
  if (read.isErr()) {
    return failedOutcome({ error: read.error, generation: generation.value, home, port, startedIso });
  }
  const published = await port.finishRead({
    generation: generation.value,
    home,
    outcome: { sightings: read.value.sightings, snapshot: read.value.snapshot, state: "measured" },
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok(read.value);
}

/** Publish a failed read's `unmeasurable` against its generation, answering the publication's refusal if it had one. */
async function failedOutcome({
  error,
  generation,
  home,
  port,
  startedIso,
}: {
  error: OrgHealthError;
  generation: IncidentReadGeneration;
  home: string;
  port: OrgHealthPort;
  startedIso: string;
}): Promise<Result<never, OrgHealthError>> {
  const published = await port.finishRead({
    generation,
    home,
    outcome: { snapshot: unmeasurable({ because: error.message, startedIso }), state: "unmeasurable" },
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return err(error);
}

/** The read itself, once there is a source and the last sightings could be read. */
async function readWith({
  home,
  source,
  port,
  nowMs,
  clock,
  wait,
}: {
  home: string;
  source: Result<{ readonly api: IncidentReadApi; readonly channelId: string }, OrgHealthError>;
  port: OrgHealthPort;
  nowMs: number;
  clock: () => number;
  wait: (ms: number) => Promise<void>;
}): Promise<Result<IncidentRead, OrgHealthError>> {
  if (source.isErr()) {
    return err(source.error);
  }
  const previous = await port.readSightings({ home });
  if (previous.isErr()) {
    return err(previous.error);
  }
  return readOrgIncidents({ ...source.value, clock, nowMs, previous: previous.value, wait });
}
