/**
 * Decoding one journal line's KIND into an event — the last of `./ledger.ts`'s decoders to move out.
 *
 * The seam `./questionLineDecode.ts` and `./rulingLineDecode.ts` already drew, finished: `./ledger.ts`
 * answers what a journal IS — the event vocabulary, the phase fold, the whole-file read — and every
 * per-kind decoder lives beside the others rather than half here and half there. Nothing outside
 * `./ledgerLineDecode.ts` calls {@link eventFromKind}; it is exported for that one caller and for its tests.
 *
 * **An unknown kind falls through to `undefined` rather than throwing**, and `./ledger.ts`'s header § "A
 * word this build has never heard" carries the measurement behind why that is a newer build's ordinary
 * write rather than a corrupt file.
 *
 * Pure: no filesystem, no clock.
 */

import type { SupervisorHost } from "../supervisor/session.js";
import { questionShotEvent } from "./askShot.js";
import type { RunEvent } from "./ledger.js";
import { count, optionalCount, optionalText, stringList, text } from "./ledgerFields.js";
import { parkClearedEvent, parkedEvent, parkWakeSuspendedEvent } from "./parkLineDecode.js";
import {
  questionEvent,
  questionExamplesEvent,
  questionOfferedEvent,
  questionPostedEvent,
  questionReconfirmedEvent,
  questionShapedEvent,
} from "./questionLineDecode.js";
import { rulingEvent } from "./rulingLineDecode.js";
import { steerRiskEvent } from "./steerRiskLineDecode.js";

/**
 * Build the event for one recognised kind, or `undefined` for a kind this version does not know.
 *
 * Split across three functions purely to stay under the max-function-lines cap, and the split follows the
 * grouping the fold in {@link runStateOf} already uses: the kinds that move a run's PHASE, the kinds that
 * name a WRITER, and everything that is an observation ABOUT a run. Every one of them falls through to
 * `undefined` rather than throwing — an unknown kind is a newer version's write, reported as unreadable so
 * the reader knows something happened that this build cannot interpret.
 *
 * The three are asked in turn with an explicit `undefined` check rather than a `??` chain, because the two
 * read differently here: `??` would also swallow a decoder that DELIBERATELY answers `undefined` for a kind
 * it owns — `identityEvent` on a line with no `sessionId` — and silently offer that line to the next group.
 * Each group owns a disjoint kind set, so falling through is only ever "not mine".
 *
 * @param kind the line's `kind` word, which may be one no build of this decoder knows
 * @returns the decoded event, or `undefined` when no group claims the kind
 */
export function eventFromKind({
  kind,
  payload,
}: {
  kind: string;
  payload: Readonly<Record<string, unknown>>;
}): RunEvent | undefined {
  const atIso = text({ key: "atIso", payload });
  const lifecycle = lifecycleKind({ atIso, kind, payload });
  if (lifecycle !== undefined) {
    return lifecycle;
  }
  const identity = identityKind({ atIso, kind, payload });
  if (identity !== undefined) {
    return identity;
  }
  return observationKind({ atIso, kind, payload });
}

/** The kinds that move a run's phase, plus the two row-level facts (`closed`, `artifact`) that ride beside them. */
function lifecycleKind({
  atIso,
  kind,
  payload,
}: {
  atIso: string;
  kind: string;
  payload: Readonly<Record<string, unknown>>;
}): RunEvent | undefined {
  const question = questionLineKind({ atIso, kind, payload });
  if (question !== undefined) {
    return question;
  }
  switch (kind) {
    case "started":
      return { atIso, branch: text({ key: "branch", payload }), docHash: text({ key: "docHash", payload }), kind };
    case "amended":
      return { atIso, docHash: text({ key: "docHash", payload }), kind, why: text({ key: "why", payload }) };
    case "answered":
      return { answer: text({ key: "answer", payload }), atIso, kind };
    case "finished":
      return { atIso, kind, residue: stringList({ key: "residue", payload }) };
    case "closed":
      return {
        atIso,
        kind,
        residue: stringList({ key: "residue", payload }),
        summary: text({ key: "summary", payload }),
      };
    case "artifact":
      return artifactEvent({ atIso, payload });
    case "ruling":
      return rulingEvent({ atIso, payload });
    case "abandoned":
      return { atIso, kind, why: text({ key: "why", payload }) };
    case "orphaned": {
      // Read back as well as written: `applyRowEvent` compares its own append against what the file parses to,
      // so a field this decoder drops fails the write outright rather than vanishing quietly.
      const cycleEvents = optionalCount({ key: "cycleEvents", payload });
      return {
        atIso,
        ...(cycleEvents === undefined ? {} : { cycleEvents }),
        deadSessionId: text({ key: "deadSessionId", payload }),
        kind,
        lastEventIso: text({ key: "lastEventIso", payload }),
      };
    }
    default:
      return undefined;
  }
}

/** The question lifecycle's kinds — asked, offered, posted, corrected, withdrawn, reconfirmed, illustrated, shaped. */
function questionLineKind({
  atIso,
  kind,
  payload,
}: {
  atIso: string;
  kind: string;
  payload: Readonly<Record<string, unknown>>;
}): RunEvent | undefined {
  switch (kind) {
    case "question":
      return questionEvent({ atIso, payload });
    case "question-offered":
      return questionOfferedEvent({ atIso, payload });
    case "question-posted":
      return questionPostedEvent({ atIso, payload });
    case "question-corrected":
    case "question-withdrawn":
      return { atIso, kind, question: text({ key: "question", payload }), why: text({ key: "why", payload }) };
    case "question-reconfirmed":
      return questionReconfirmedEvent({ atIso, payload });
    case "question-examples":
      return questionExamplesEvent({ atIso, payload });
    case "question-shot":
      return questionShotEvent({ atIso, payload });
    case "question-shaped":
      return questionShapedEvent({ atIso, payload });
    default:
      return undefined;
  }
}

/** The kinds that name a WRITER, every one of which is unreadable without its `sessionId`. */
function identityKind({
  atIso,
  kind,
  payload,
}: {
  atIso: string;
  kind: string;
  payload: Readonly<Record<string, unknown>>;
}): RunEvent | undefined {
  switch (kind) {
    case "launched":
    case "resumed":
      return identityEvent({ atIso, kind, payload });
    case "claimed":
      return claimedEvent({ atIso, payload });
    case "released":
      return releasedEvent({ atIso, payload });
    case "parked":
      return parkedEvent({ atIso, payload });
    default:
      return undefined;
  }
}

/** Observations ABOUT a run — a probe tally, a dispatch, a sign-off, the drive's traffic, the gate's own look. */
function observationKind({
  atIso,
  kind,
  payload,
}: {
  atIso: string;
  kind: string;
  payload: Readonly<Record<string, unknown>>;
}): RunEvent | undefined {
  switch (kind) {
    case "probed":
      return { atIso, failed: count({ key: "failed", payload }), kind, passed: count({ key: "passed", payload }) };
    case "dispatched":
      return { atIso, by: text({ key: "by", payload }), kind, target: optionalText({ key: "target", payload }) };
    case "park-cleared":
      return parkClearedEvent({ atIso, payload });
    case "park-wake-suspended":
      return parkWakeSuspendedEvent({ atIso, payload });
    case "steer-risk":
      return steerRiskEvent({ atIso, payload });
    case "signed-off":
      return { atIso, by: text({ key: "by", payload }), kind, note: text({ key: "note", payload }) };
    case "lessons":
      return { atIso, forced: payload["forced"] === true, kind, lessons: text({ key: "lessons", payload }) };
    case "said":
      return { atIso, kind, message: text({ key: "message", payload }) };
    case "tagged":
      return taggedEvent({ atIso, payload });
    case "delivered":
      return { atIso, count: count({ key: "count", payload }), kind };
    case "drive-ended":
      return { atIso, attempts: count({ key: "attempts", payload }), kind, why: text({ key: "why", payload }) };
    case "gated":
      return {
        atIso,
        failed: count({ key: "failed", payload }),
        head: optionalText({ key: "head", payload }),
        kind,
        notEvaluated: count({ key: "notEvaluated", payload }),
        passed: count({ key: "passed", payload }),
        sessionId: optionalText({ key: "sessionId", payload }),
      };
    default:
      return undefined;
  }
}

/**
 * Decode one of the two events that name a writer.
 *
 * `sessionId` is the single load-bearing field, so a line missing it is reported UNREADABLE rather than decoded
 * into an event with an empty identity. An empty identity would compare equal to nothing and unequal to
 * everything, which is precisely the shape that makes a gate treat its own session as a stranger. Unreadable
 * disarms the gate, which is the safe direction and the standing rule here.
 */
function identityEvent({
  atIso,
  kind,
  payload,
}: {
  atIso: string;
  kind: "launched" | "resumed";
  payload: Readonly<Record<string, unknown>>;
}): RunEvent | undefined {
  const sessionId = optionalText({ key: "sessionId", payload });
  if (sessionId === undefined) {
    return undefined;
  }
  if (kind === "resumed") {
    return {
      atIso,
      attempt: optionalCount({ key: "attempt", payload }),
      kind,
      pid: optionalCount({ key: "pid", payload }),
      sessionId,
    };
  }
  const host = supervisorHost({ payload });
  const launched = {
    atIso,
    kind,
    pid: optionalCount({ key: "pid", payload }),
    sessionId,
    worktree: optionalText({ key: "worktree", payload }),
  } as const;
  return host === undefined ? launched : { ...launched, host };
}

/** A supported visible-host label, or `undefined` for an old or malformed optional field. */
function supervisorHost({ payload }: { payload: Readonly<Record<string, unknown>> }): SupervisorHost | undefined {
  const host = optionalText({ key: "host", payload });
  return host === "claude-code" || host === "codex" || host === "explicit" ? host : undefined;
}

/** Decode a deliberate ownership claim; identity and host are both load-bearing. */
function claimedEvent({
  atIso,
  payload,
}: {
  atIso: string;
  payload: Readonly<Record<string, unknown>>;
}): RunEvent | undefined {
  const sessionId = optionalText({ key: "sessionId", payload });
  const host = supervisorHost({ payload });
  if (sessionId === undefined || host === undefined) {
    return undefined;
  }
  return {
    atIso,
    host,
    kind: "claimed",
    pid: optionalCount({ key: "pid", payload }),
    sessionId,
    why: text({ key: "why", payload }),
    worktree: optionalText({ key: "worktree", payload }),
    // Only an OWN literal `true` counts — never manufacture `forced: false`/`forced: undefined`, so an old or
    // ordinary claim decodes to a value with the field genuinely absent, and an inherited property (the r2
    // review's prototype-pollution counterexample) can never invent one.
    ...(Object.hasOwn(payload, "forced") && payload["forced"] === true ? { forced: true as const } : {}),
  };
}

/**
 * Decode a published-artifact pointer; the URL is the whole event, so a line without one decodes to nothing.
 *
 * An empty URL would SUPERSEDE the real one recorded earlier — this is the one supersedable kind — so
 * decoding a blank into an event would erase a good pointer rather than merely fail to add one.
 */
function artifactEvent({
  atIso,
  payload,
}: {
  atIso: string;
  payload: Readonly<Record<string, unknown>>;
}): RunEvent | undefined {
  const url = optionalText({ key: "url", payload });
  return url === undefined ? undefined : { atIso, kind: "artifact", url };
}

/**
 * Decode a `tagged` line. Pairs that are not two strings are dropped rather than coerced: an assignment with a
 * missing half names no key or value, so there is nothing to keep. Every pair that IS two strings is kept as
 * written — the fold never re-validates history, it marks what today's registry refuses as `unrecognised`.
 */
function taggedEvent({ atIso, payload }: { atIso: string; payload: Readonly<Record<string, unknown>> }): RunEvent {
  const raw = payload["set"];
  const set = Array.isArray(raw)
    ? raw.flatMap((item: unknown) => {
        if (typeof item !== "object" || item === null) {
          return [];
        }
        const pair: Readonly<Record<string, unknown>> = { ...item };
        const key = pair["key"];
        const value = pair["value"];
        return typeof key === "string" && typeof value === "string" ? [{ key, value }] : [];
      })
    : [];
  return { atIso, drop: stringList({ key: "drop", payload }), kind: "tagged", set, why: text({ key: "why", payload }) };
}

/** Decode a deliberate release; an unnamed release cannot safely clear anybody's claim. */
function releasedEvent({
  atIso,
  payload,
}: {
  atIso: string;
  payload: Readonly<Record<string, unknown>>;
}): RunEvent | undefined {
  const sessionId = optionalText({ key: "sessionId", payload });
  return sessionId === undefined
    ? undefined
    : { atIso, kind: "released", sessionId, why: text({ key: "why", payload }) };
}
