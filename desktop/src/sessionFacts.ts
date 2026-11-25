/**
 * A hosted session's facts picture, as a pure fold: each tool activity a worker reports, in, and what the session has
 * done, out. No clock — the instant is the one the control plane stamped the report with on receipt — and no
 * Electron. The registry calls it (`sessionRegistry.ts`); the wire it is read over is `pictureWire.ts`.
 *
 * Memory is bounded by construction: at most {@link APP_PICTURE_IN_FLIGHT_CAP} calls in flight and
 * {@link APP_PICTURE_COMPLETED_CAP} ended ones, each field bounded by the worker wire's guard. A new call reported
 * while the in-flight list is full is counted as dropped rather than stored, and the counts by kind are then a floor.
 *
 * An ended call is final: a later report about it changes nothing, so a vendor re-sending a finished call can never
 * move it back in flight or count it twice — while it is still in the kept history. One that has aged out of it would
 * count again; neither vendor re-sends a finished call within a run, which the installed-app trial checks.
 */
import {
  APP_PICTURE_COMPLETED_CAP,
  APP_PICTURE_IN_FLIGHT_CAP,
  type AppSessionFacts,
  type AppSessionPicture,
  type AppToolFact,
  type AppToolKind,
} from "./pictureWire";
import { type RegistryEntry, type SessionRegistry, withEntry } from "./sessionRegistryShape";
import type { ToolActivity } from "./sessionWorker/workerWire";

/** A session that has called no tool yet. */
export const EMPTY_SESSION_FACTS: AppSessionFacts = {
  countsByKind: {
    delegate: 0,
    delete: 0,
    edit: 0,
    execute: 0,
    fetch: 0,
    move: 0,
    other: 0,
    read: 0,
    search: 0,
    switch_mode: 0,
    think: 0,
  },
  droppedActivityEvents: 0,
  inFlight: [],
  lastCompleted: [],
};

function isEnded({ fact }: { fact: AppToolFact }): boolean {
  return fact.status === "completed" || fact.status === "failed";
}

function counted({
  counts,
  kind,
  by,
}: {
  counts: Readonly<Record<AppToolKind, number>>;
  kind: AppToolKind;
  by: number;
}): Readonly<Record<AppToolKind, number>> {
  return { ...counts, [kind]: counts[kind] + by };
}

/** The facts with one call put where its status says: in flight in its place, or at the head of the ended ones. */
function placed({ facts, fact }: { facts: AppSessionFacts; fact: AppToolFact }): AppSessionFacts {
  const others = facts.inFlight.filter((held) => held.toolCallId !== fact.toolCallId);
  if (isEnded({ fact })) {
    return {
      ...facts,
      inFlight: others,
      lastCompleted: [fact, ...facts.lastCompleted].slice(0, APP_PICTURE_COMPLETED_CAP),
    };
  }
  if (others.length === facts.inFlight.length) {
    return { ...facts, inFlight: [...facts.inFlight, fact] };
  }
  return { ...facts, inFlight: facts.inFlight.map((held) => (held.toolCallId === fact.toolCallId ? fact : held)) };
}

/** A call never seen before: counted once, under the kind it arrived with, or `other` when it named none. */
function firstSight({
  facts,
  activity,
  atIso,
}: {
  facts: AppSessionFacts;
  activity: ToolActivity;
  atIso: string;
}): AppSessionFacts {
  const fact: AppToolFact = {
    lastObservedAtIso: atIso,
    startedAtIso: atIso,
    status: "pending",
    toolKind: "other",
    ...activity,
  };
  if (!isEnded({ fact }) && facts.inFlight.length >= APP_PICTURE_IN_FLIGHT_CAP) {
    return { ...facts, droppedActivityEvents: facts.droppedActivityEvents + 1 };
  }
  return placed({
    fact,
    facts: { ...facts, countsByKind: counted({ by: 1, counts: facts.countsByKind, kind: fact.toolKind }) },
  });
}

/** A call already in flight, patched: a field the report leaves out keeps its value, and a changed kind moves its count. */
function patched({
  facts,
  activity,
  atIso,
  held,
}: {
  facts: AppSessionFacts;
  activity: ToolActivity;
  atIso: string;
  held: AppToolFact;
}): AppSessionFacts {
  const fact: AppToolFact = { ...held, ...activity, lastObservedAtIso: atIso };
  let countsByKind = facts.countsByKind;
  if (fact.toolKind !== held.toolKind) {
    countsByKind = counted({
      by: 1,
      counts: counted({ by: -1, counts: countsByKind, kind: held.toolKind }),
      kind: fact.toolKind,
    });
  }
  return placed({ fact, facts: { ...facts, countsByKind } });
}

/**
 * The facts after one tool activity, received at `atIso`.
 *
 * @param facts what the session had done before it
 * @param activity what the worker saw of one tool call
 * @param atIso when the control plane received the report
 * @returns the facts with the call counted, placed and stamped; unchanged but for the instant when the call had ended
 */
export function foldToolActivity({
  facts,
  activity,
  atIso,
}: {
  facts: AppSessionFacts;
  activity: ToolActivity;
  atIso: string;
}): AppSessionFacts {
  let stamped: AppSessionFacts = { ...facts, lastActivityAtIso: atIso };
  if (facts.firstActivityAtIso === undefined) {
    stamped = { ...stamped, firstActivityAtIso: atIso };
  }
  if (stamped.lastCompleted.some((ended) => ended.toolCallId === activity.toolCallId)) {
    return stamped;
  }
  const held = stamped.inFlight.find((fact) => fact.toolCallId === activity.toolCallId);
  if (held === undefined) {
    return firstSight({ activity, atIso, facts: stamped });
  }
  return patched({ activity, atIso, facts: stamped, held });
}

/**
 * The registry with one session's facts moved by a tool activity: an observation, so nothing else on the entry moves.
 *
 * @param registry the sessions
 * @param sessionId the session the worker reported for
 * @param activity what the worker saw
 * @param atIso when the control plane received the report
 * @returns the registry with that entry's facts folded, or the same registry for an unknown session
 */
export function withToolActivity({
  registry,
  sessionId,
  activity,
  atIso,
}: {
  registry: SessionRegistry;
  sessionId: string;
  activity: ToolActivity;
  atIso: string;
}): SessionRegistry {
  return withEntry({
    change: (held) => ({ ...held, facts: foldToolActivity({ activity, atIso, facts: held.facts }) }),
    registry,
    sessionId,
  });
}

/**
 * One session's picture, as a `picture.read` answers it: the session's identity and state, and its facts. Never the
 * snapshot's own words — what was sent to it and what it said are not facts.
 *
 * @param entry the hosted session
 * @param readAtIso when the picture was read
 * @returns the picture
 */
export function sessionPictureOf({ entry, readAtIso }: { entry: RegistryEntry; readAtIso: string }): AppSessionPicture {
  const { sessionId, handle, vendor, title, state } = entry.snapshot;
  return { facts: entry.facts, readAtIso, session: { handle, sessionId, state, title, vendor } };
}
