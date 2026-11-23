/**
 * The completion log's CODEC — one `turn-completed` event encoded as a JSONL line, and the log's text decoded
 * back into events.
 *
 * Split from `./envelope.ts`, which owns the TYPES and the fold that builds a {@link TurnCompletion}; this
 * module owns only the wire shape those types take on disk. It imports the types and the envelope never
 * imports it, so the ladder runs one way. The decoder re-checks every field of every arm, including the
 * `first-answered` arm's `followThrough` payload, because a line that merely parses as JSON is not yet a
 * completion.
 */
import { isRecord } from "../../lib/parsers.js";
import { FOLLOW_THROUGH_OWES } from "../ask/lifecycleEvents.js";
import type { TurnCompletion, TurnCompletionEvent, TurnPrimaryOutcome, TurnSecondaryFailure } from "./envelope.js";

/**
 * Encode one completion event as a JSONL line.
 *
 * @param event the event to encode
 * @returns the JSON line (no trailing newline)
 */
export function turnCompletionEventLine({ event }: { event: TurnCompletionEvent }): string {
  return JSON.stringify({ schemaVersion: 1, ...event });
}

/** Whether a decoded value carries every field a {@link TurnPrimaryOutcome} declares, for its own kind. */
function isPrimaryOutcome(value: unknown): value is TurnPrimaryOutcome {
  if (!isRecord(value)) {
    return false;
  }
  if (value["kind"] === "answered") {
    return typeof value["answerTs"] === "string";
  }
  if (value["kind"] === "first-answered") {
    const followThrough = value["followThrough"];
    return (
      typeof value["answerTs"] === "string" &&
      typeof value["answerDigest"] === "string" &&
      isRecord(followThrough) &&
      FOLLOW_THROUGH_OWES.some((owes) => owes === followThrough["owes"]) &&
      typeof followThrough["what"] === "string"
    );
  }
  if (value["kind"] === "withheld") {
    const held = value["held"];
    return (
      typeof value["noticeTs"] === "string" &&
      isRecord(held) &&
      typeof held["id"] === "string" &&
      typeof held["code"] === "string" &&
      typeof held["reason"] === "string"
    );
  }
  if (value["kind"] === "failed" || value["kind"] === "answer-lost") {
    const noticeTs = value["noticeTs"];
    return (noticeTs === undefined || typeof noticeTs === "string") && typeof value["reason"] === "string";
  }
  return false;
}

/** Whether a decoded value is a well-formed list of {@link TurnSecondaryFailure}. */
function isSecondaryFailures(value: unknown): value is readonly TurnSecondaryFailure[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry["kind"] === "string" &&
        ["title", "status", "checklist", "reap", "supersession"].includes(entry["kind"]) &&
        typeof entry["reason"] === "string",
    )
  );
}

/** Whether a decoded value is a well-formed {@link TurnCompletion}. */
function isTurnCompletion(value: unknown): value is TurnCompletion {
  if (!isRecord(value)) {
    return false;
  }
  const provenance = value["provenance"];
  return (
    isRecord(value["askIdentity"]) &&
    typeof value["turnId"] === "string" &&
    isRecord(provenance) &&
    typeof provenance["modelId"] === "string" &&
    typeof value["workingTs"] === "string" &&
    isPrimaryOutcome(value["primary"]) &&
    isSecondaryFailures(value["secondaryFailures"])
  );
}

/**
 * Parse the completion log's text into events, in file order — tolerant of a malformed line, same posture
 * as the queue and door ledgers: a corrupt line must not make the whole log unreadable.
 *
 * @param text the raw log contents
 * @returns the parsed events and the 1-indexed line numbers that could not be read
 */
export function parseTurnCompletionLog({ text }: { text: string }): {
  readonly events: readonly TurnCompletionEvent[];
  readonly unreadable: readonly number[];
} {
  const events: TurnCompletionEvent[] = [];
  const unreadable: number[] = [];
  text.split("\n").forEach((line, index) => {
    if (line.trim().length === 0) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      unreadable.push(index + 1);
      return;
    }
    const tsIso = isRecord(parsed) ? parsed["tsIso"] : undefined;
    const completion = isRecord(parsed) ? parsed["completion"] : undefined;
    if (
      !isRecord(parsed) ||
      parsed["schemaVersion"] !== 1 ||
      parsed["kind"] !== "turn-completed" ||
      typeof tsIso !== "string" ||
      !isTurnCompletion(completion)
    ) {
      unreadable.push(index + 1);
      return;
    }
    events.push({ completion, kind: "turn-completed", tsIso });
  });
  return { events, unreadable };
}
