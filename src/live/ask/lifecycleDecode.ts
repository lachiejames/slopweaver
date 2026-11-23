/**
 * Decoding one ask-lifecycle log line into its typed event — the read half of `./lifecycle.ts`'s JSONL codec.
 *
 * Every kind has its own `*FromValue` parser and every one answers `undefined` for a shape that does not
 * match, because the log's rule is that an unreadable line is reported by number and never folded in with a
 * guess in it. `./lifecycle.ts` owns the line framing (schema version, blank lines, JSON errors) and the fold;
 * this module owns only what a decoded record means.
 */
import { optStr as str } from "../../corpus/slack/shape.js";
import { isRecord } from "../../lib/parsers.js";
import { recordedRespondDecisionSchema } from "../turn/judgement.js";
import { isStartedChecklist } from "./checklist.js";
import type { AskIdentity } from "./identity.js";
import {
  type AnswerLostEvent,
  type AskLifecycleEvent,
  type BlockedOnHumanEvent,
  type CapturedEvent,
  type ChecklistPostedEvent,
  type DispatchedEvent,
  type DispatchFailedEvent,
  type DispatchUnwitnessedEvent,
  type DispatchWitnessedEvent,
  type FailedEvent,
  type FirstAnsweredEvent,
  FOLLOW_THROUGH_OWES,
  type FollowThroughOwes,
  type HandoverCleanupIntendedEvent,
  isBlockedNeed,
  type LeftForAHumanEvent,
  type RedispatchedEvent,
  type SatisfiedElsewhereEvent,
  type TriageCleanupIntendedEvent,
  type TriagedNoResponseEvent,
  type UnblockedEvent,
  type WithheldEvent,
} from "./lifecycleEvents.js";
import { isSignInOrigin } from "./signInOrigin.js";

/** Every field an {@link AskIdentity} declares, checked on a decoded value. */
function hasAskIdentityFields(
  value: Record<string, unknown>,
): value is Record<string, unknown> & { channel: string; messageTs: string; threadTs: string; tsIso: string } {
  return (
    typeof value["channel"] === "string" &&
    value["channel"].length > 0 &&
    typeof value["messageTs"] === "string" &&
    value["messageTs"].length > 0 &&
    typeof value["threadTs"] === "string" &&
    value["threadTs"].length > 0 &&
    typeof value["tsIso"] === "string" &&
    value["tsIso"].length > 0
  );
}

/** The identity + timestamp every event kind shares, before its own kind-specific fields are added. */
type EventBase = AskIdentity & { readonly tsIso: string };

/** Parse a `captured` event's own fields onto the shared base. */
function capturedFromValue({
  base,
  value,
}: {
  base: EventBase;
  value: Record<string, unknown>;
}): CapturedEvent | undefined {
  const userId = str({ value: value["userId"] });
  const surface = value["surface"];
  if (userId === undefined || (surface !== "channel" && surface !== "dm")) {
    return undefined;
  }
  // Absent on every row written before the field existed, which is a legitimate old-log state rather than a
  // malformed event — so it never joins the refusal above.
  const text = str({ value: value["text"] });
  return { ...base, kind: "captured", surface, userId, ...(text === undefined ? {} : { text }) };
}

/** The seven kinds that share one shape: the base plus a `reason`. */
type ReasonedKind = (
  | TriagedNoResponseEvent
  | LeftForAHumanEvent
  | FailedEvent
  | AnswerLostEvent
  | DispatchFailedEvent
  | DispatchUnwitnessedEvent
  | DispatchWitnessedEvent
)["kind"];

/** Parse one of the {@link ReasonedKind} events onto the shared base. */
function reasonedEvent({
  base,
  kind,
  value,
}: {
  base: EventBase;
  kind: ReasonedKind;
  value: Record<string, unknown>;
}): Extract<AskLifecycleEvent, { kind: ReasonedKind }> | undefined {
  const reason = str({ value: value["reason"] });
  return reason === undefined ? undefined : { ...base, kind, reason };
}

/**
 * Parse a `satisfied-elsewhere` event's own fields onto the shared base.
 *
 * Its own arm rather than {@link reasonedEvent}'s because it carries the POINTER as well as the reason, and
 * a row missing `answeredByTs` is unreadable rather than a satisfied ask with nothing to point at — the
 * same posture every other arm holds, so a malformed row is skipped and reported by line number instead of
 * folding an ask to a terminal it cannot justify.
 *
 * @param base the identity and instant every event shares
 * @param value the decoded line
 * @returns the typed event, or `undefined` when either of its own two fields is missing
 */
function satisfiedElsewhereFromValue({
  base,
  value,
}: {
  base: EventBase;
  value: Record<string, unknown>;
}): SatisfiedElsewhereEvent | undefined {
  const answeredByTs = str({ value: value["answeredByTs"] });
  const reason = str({ value: value["reason"] });
  return answeredByTs === undefined || reason === undefined
    ? undefined
    : { ...base, answeredByTs, kind: "satisfied-elsewhere", reason };
}

/** Parse a `checklist-posted` event's own fields onto the shared base. */
function checklistPostedFromValue({
  base,
  value,
}: {
  base: EventBase;
  value: Record<string, unknown>;
}): ChecklistPostedEvent | undefined {
  const turnId = str({ value: value["turnId"] });
  const workingTs = str({ value: value["workingTs"] });
  return turnId === undefined || workingTs === undefined
    ? undefined
    : { ...base, kind: "checklist-posted", turnId, workingTs };
}

/**
 * Parse either cleanup-intended event's own fields onto the shared base — the two share one shape and differ
 * only in which terminal must follow.
 */
function cleanupIntendedFromValue({
  base,
  kind,
  value,
}: {
  base: EventBase;
  kind: "triage-cleanup-intended" | "handover-cleanup-intended";
  value: Record<string, unknown>;
}): TriageCleanupIntendedEvent | HandoverCleanupIntendedEvent | undefined {
  const reason = str({ value: value["reason"] });
  if (reason === undefined) {
    return undefined;
  }
  const checklistDelete = value["checklistDelete"];
  return {
    ...base,
    ...(isStartedChecklist(checklistDelete) ? { checklistDelete } : {}),
    kind,
    reason,
  };
}

/** Parse a `dispatched` event's own fields onto the shared base. */
function dispatchedFromValue({
  base,
  value,
}: {
  base: EventBase;
  value: Record<string, unknown>;
}): DispatchedEvent | undefined {
  const tier = value["tier"];
  const leaseExpiresAt = str({ value: value["leaseExpiresAt"] });
  const decision = recordedRespondDecisionSchema.safeParse(value["decision"]);
  if (
    (tier !== "inline" && tier !== "read-only-subagent" && tier !== "fresh-visible-session") ||
    leaseExpiresAt === undefined ||
    !decision.success
  ) {
    return undefined;
  }
  return { ...base, decision: decision.data, kind: "dispatched", leaseExpiresAt, tier };
}

/** Parse a `withheld` event's own fields onto the shared base. */
function withheldFromValue({
  base,
  value,
}: {
  base: EventBase;
  value: Record<string, unknown>;
}): WithheldEvent | undefined {
  const queueId = str({ value: value["queueId"] });
  const code = str({ value: value["code"] });
  const reason = str({ value: value["reason"] });
  return queueId === undefined || code === undefined || reason === undefined
    ? undefined
    : { ...base, code, kind: "withheld", queueId, reason };
}

/**
 * Parse a `blocked-on-human` event's own fields onto the shared base.
 *
 * `need` is validated against the closed set rather than accepted as any string, for the same reason
 * `redispatchedFromValue` validates `strandedAs`: a line naming a need nothing branches on describes a block
 * no reader can act on, and the log's own rule is that an unreadable line is reported rather than folded in.
 *
 * @param base the identity and instant every kind shares
 * @param value the decoded line
 * @returns the typed event, or `undefined` when the shape does not match
 */
function blockedOnHumanFromValue({
  base,
  value,
}: {
  base: EventBase;
  value: Record<string, unknown>;
}): BlockedOnHumanEvent | undefined {
  const what = str({ value: value["what"] });
  const stepText = str({ value: value["stepText"] });
  const need = value["need"];
  if (what === undefined || stepText === undefined || !isBlockedNeed(need)) {
    return undefined;
  }
  const tagTs = str({ value: value["tagTs"] });
  // A sign-in origin is absent, or exactly a bare HTTPS origin on a sign-in block — anything else is a line that
  // names a card no reader could open, reported unreadable rather than folded in with the page dropped.
  const signInOrigin = value["signInOrigin"];
  if (
    signInOrigin !== undefined &&
    (need !== "sign-in" || typeof signInOrigin !== "string" || !isSignInOrigin({ value: signInOrigin }))
  ) {
    return undefined;
  }
  return {
    ...base,
    kind: "blocked-on-human",
    need,
    stepText,
    what,
    ...(signInOrigin === undefined ? {} : { signInOrigin }),
    ...(tagTs === undefined ? {} : { tagTs }),
  };
}

/**
 * Parse an `unblocked` event's own fields onto the shared base.
 *
 * `lifted` is validated whole rather than defaulted: a line that cannot say which block it lifted describes
 * a resume no reader can act on, and this log's own rule is that an unreadable line is reported rather than
 * folded in with a guess in it.
 *
 * @param base the identity and instant every kind shares
 * @param value the decoded line
 * @returns the typed event, or `undefined` when the shape does not match
 */
function unblockedFromValue({
  base,
  value,
}: {
  base: EventBase;
  value: Record<string, unknown>;
}): UnblockedEvent | undefined {
  const note = str({ value: value["note"] });
  const lifted = value["lifted"];
  if (note === undefined || !isRecord(lifted)) {
    return undefined;
  }
  const what = str({ value: lifted["what"] });
  const need = lifted["need"];
  return what === undefined || !isBlockedNeed(need)
    ? undefined
    : { ...base, kind: "unblocked", lifted: { need, what }, note };
}

/**
 * Parse a `redispatched` event's own fields onto the shared base.
 *
 * `strandedAs` is validated against the three stranded kinds rather than accepted as any string: a line
 * naming a state that is not one of them describes a re-dispatch that could not have been decided, and the
 * log's own rule is that an unreadable line is reported rather than folded in.
 *
 * @param base the identity and instant every kind shares
 * @param value the decoded line
 * @returns the typed event, or `undefined` when the shape does not match
 */
function redispatchedFromValue({
  base,
  value,
}: {
  base: EventBase;
  value: Record<string, unknown>;
}): RedispatchedEvent | undefined {
  const reason = str({ value: value["reason"] });
  const strandedAs = value["strandedAs"];
  const stranded = strandedAs === "failed" || strandedAs === "dispatch-failed" || strandedAs === "lease-expired";
  return reason === undefined || !stranded ? undefined : { ...base, kind: "redispatched", reason, strandedAs };
}

/** Whether a decoded value names one of the closed {@link FOLLOW_THROUGH_OWES} kinds. */
function isFollowThroughOwes(value: unknown): value is FollowThroughOwes {
  return FOLLOW_THROUGH_OWES.some((owes) => owes === value);
}

/**
 * Parse a `first-answered` event's own fields onto the shared base.
 *
 * Every field is required and `owes` is validated against the closed set: a row that cannot say what it
 * still owes, or which lease it re-armed, describes a non-ending no reader can supervise, so it is reported
 * unreadable rather than folded in with a guess.
 *
 * @param base the identity and instant every kind shares
 * @param value the decoded line
 * @returns the typed event, or `undefined` when the shape does not match
 */
function firstAnsweredFromValue({
  base,
  value,
}: {
  base: EventBase;
  value: Record<string, unknown>;
}): FirstAnsweredEvent | undefined {
  const answerTs = str({ value: value["answerTs"] });
  const answerDigest = str({ value: value["answerDigest"] });
  const what = str({ value: value["what"] });
  const leaseExpiresAt = str({ value: value["leaseExpiresAt"] });
  const owes = value["owes"];
  if (
    answerTs === undefined ||
    answerDigest === undefined ||
    what === undefined ||
    leaseExpiresAt === undefined ||
    !isFollowThroughOwes(owes)
  ) {
    return undefined;
  }
  return { ...base, answerDigest, answerTs, kind: "first-answered", leaseExpiresAt, owes, what };
}

/**
 * Parse one decoded line into its typed event, by `kind`.
 *
 * @param value the decoded JSON record, schema version already checked
 * @returns the typed event, or `undefined` when the shape does not match
 */
export function decodeAskLifecycleEvent({ value }: { value: Record<string, unknown> }): AskLifecycleEvent | undefined {
  if (!hasAskIdentityFields(value)) {
    return undefined;
  }
  const base: EventBase = {
    channel: value["channel"],
    messageTs: value["messageTs"],
    threadTs: value["threadTs"],
    tsIso: value["tsIso"],
  };
  const kind = value["kind"];
  switch (kind) {
    case "captured":
      return capturedFromValue({ base, value });
    case "checklist-posted":
      return checklistPostedFromValue({ base, value });
    case "triage-cleanup-intended":
    case "handover-cleanup-intended":
      return cleanupIntendedFromValue({ base, kind, value });
    case "satisfied-elsewhere":
      return satisfiedElsewhereFromValue({ base, value });
    case "triaged-no-response":
    case "left-for-a-human":
    case "failed":
    case "answer-lost":
    case "dispatch-failed":
    case "dispatch-unwitnessed":
    case "dispatch-witnessed":
      return reasonedEvent({ base, kind, value });
    case "dispatched":
      return dispatchedFromValue({ base, value });
    case "answered": {
      const answerTs = str({ value: value["answerTs"] });
      return answerTs === undefined ? undefined : { ...base, answerTs, kind };
    }
    case "first-answered":
      return firstAnsweredFromValue({ base, value });
    case "withheld":
      return withheldFromValue({ base, value });
    case "lease-expired":
      return { ...base, kind };
    case "redispatched":
      return redispatchedFromValue({ base, value });
    case "blocked-on-human":
      return blockedOnHumanFromValue({ base, value });
    case "unblocked":
      return unblockedFromValue({ base, value });
    default:
      return undefined;
  }
}
