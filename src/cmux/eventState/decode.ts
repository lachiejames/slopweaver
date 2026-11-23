/**
 * The strict decoders for a cmux event-stream reader's state, pure: a stored fold, and the two home files a
 * fold and cursor are imported from once.
 *
 * Strict is the point. The decoder these replace dropped an entry it could not read and answered `{}` for a
 * file it could not parse, on the theory that the live stream would rebuild what was lost. It cannot: an
 * attention raised before the cursor is never replayed, so a dropped entry is a session waiting on a human that
 * the supervisor stops seeing. Every problem found here is reported, all at once, and nothing is dropped.
 */
import { decodeCursorRecord } from "#lib/cursorRecord.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { normaliseCmuxSessionId } from "../events.js";
import type { SessionActivity } from "../sessionActivity.js";

/** The fold, keyed by workspace id — the shape `foldSessionActivity` builds and `session watch` reports from. */
export type SessionActivities = Readonly<Record<string, SessionActivity>>;

/** The required fields of one activity, and the type each must have. */
const REQUIRED: readonly (readonly [keyof SessionActivity, "string" | "count"])[] = [
  ["workspaceId", "string"],
  ["lastSeq", "count"],
  ["lastEventAtIso", "string"],
  ["lastEventName", "string"],
  ["toolCalls", "count"],
];

/** The optional string fields of one activity: absent, or a string, and never anything else. */
const OPTIONAL_STRINGS = [
  "agentSessionId",
  "agentSource",
  "attentionSinceIso",
  "cwd",
  "lastTurnEndedAtIso",
  "lastTurnStartedAtIso",
  "sessionStartedAtIso",
] as const satisfies readonly (keyof SessionActivity)[];

/**
 * Whether a value is a non-negative safe integer — a sequence number or a count.
 *
 * @param value the value to test
 * @returns true when it is one
 */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Every problem with one activity entry, or none.
 *
 * @param key the workspace id the entry is filed under
 * @param value the entry as stored
 * @returns the problems, each naming the entry
 */
function activityProblems({ key, value }: { key: string; value: Record<string, unknown> }): readonly string[] {
  return [
    ...requiredFieldProblems({ key, value }),
    ...optionalFieldProblems({ key, value }),
    ...classificationProblems({ key, value }),
  ];
}

/**
 * The problems with one entry's required fields: each a string or a count, as {@link REQUIRED} declares.
 *
 * @param key the workspace id the entry is filed under
 * @param value the entry as stored
 * @returns the problems, each naming the entry
 */
function requiredFieldProblems({ key, value }: { key: string; value: Record<string, unknown> }): readonly string[] {
  const problems: string[] = [];
  for (const [field, kind] of REQUIRED) {
    const present = value[field];
    const isString = kind === "string";
    const fits = isString ? typeof present === "string" : isCount(present);
    if (!fits) {
      const wanted = isString ? "a string" : "a non-negative integer";
      problems.push(`activity ${key}'s ${field} is not ${wanted}`);
    }
  }
  return problems;
}

/**
 * The problems with one entry's optional string fields: each absent or a string.
 *
 * @param key the workspace id the entry is filed under
 * @param value the entry as stored
 * @returns the problems, each naming the entry
 */
function optionalFieldProblems({ key, value }: { key: string; value: Record<string, unknown> }): readonly string[] {
  return OPTIONAL_STRINGS.filter((field) => value[field] !== undefined && typeof value[field] !== "string").map(
    (field) => `activity ${key}'s ${field} is neither absent nor a string`,
  );
}

/**
 * The problems with one entry's attention kind and its own workspace id.
 *
 * @param key the workspace id the entry is filed under
 * @param value the entry as stored
 * @returns the problems, each naming the entry
 */
function classificationProblems({ key, value }: { key: string; value: Record<string, unknown> }): readonly string[] {
  const problems: string[] = [];
  const attentionKind = value["attentionKind"];
  if (attentionKind !== undefined && attentionKind !== "notification" && attentionKind !== "question") {
    problems.push(`activity ${key}'s attentionKind is not notification or question`);
  }
  if (typeof value["workspaceId"] === "string" && value["workspaceId"] !== key) {
    problems.push(`activity ${key} is filed under a key that is not its own workspaceId`);
  }
  return problems;
}

/**
 * Read one optional string field the decoder has already checked.
 *
 * @param value the checked entry
 * @param field which field
 * @returns the string, or undefined when absent
 */
function optionalString({ value, field }: { value: Record<string, unknown>; field: string }): string | undefined {
  const present = value[field];
  return typeof present === "string" ? present : undefined;
}

/**
 * Build one activity from an entry {@link activityProblems} found nothing wrong with.
 *
 * @param value the checked entry
 * @returns the activity
 */
function toActivity({ value }: { value: Record<string, unknown> }): SessionActivity {
  const attentionKind = value["attentionKind"];
  // A fold written before `parseEventFrame` unwrapped cmux's `cmux-feed-v1:` ids holds the wrapped form, so a seat that
  // has not fired since would carry it until its next hook; unwrapping on read heals it on the first watch instead.
  const storedSessionId = optionalString({ field: "agentSessionId", value });
  return {
    agentSessionId: storedSessionId === undefined ? undefined : normaliseCmuxSessionId({ raw: storedSessionId }),
    agentSource: optionalString({ field: "agentSource", value }),
    attentionKind: attentionKind === "notification" || attentionKind === "question" ? attentionKind : undefined,
    attentionSinceIso: optionalString({ field: "attentionSinceIso", value }),
    cwd: optionalString({ field: "cwd", value }),
    lastEventAtIso: String(value["lastEventAtIso"]),
    lastEventName: String(value["lastEventName"]),
    lastSeq: Number(value["lastSeq"]),
    lastTurnEndedAtIso: optionalString({ field: "lastTurnEndedAtIso", value }),
    lastTurnStartedAtIso: optionalString({ field: "lastTurnStartedAtIso", value }),
    sessionStartedAtIso: optionalString({ field: "sessionStartedAtIso", value }),
    toolCalls: Number(value["toolCalls"]),
    workspaceId: String(value["workspaceId"]),
  };
}

/**
 * Decode a fold, strictly: every entry or none, and none ahead of the cursor it is folded up to.
 *
 * An activity whose `lastSeq` is past the cursor is a fold that counted events its cursor says are still to
 * come — exactly the state a crash between the two old file writes left — so it is refused rather than resumed,
 * since resuming would count those events a second time. The inverse is normal: most events touch one
 * workspace, so most workspaces' last event is behind the cursor.
 *
 * @param activities the fold as stored, keyed by workspace id
 * @param cursorSeq the sequence the fold claims to be complete up to
 * @returns the fold, or every problem with it
 */
export function decodeSessionActivities({
  activities,
  cursorSeq,
}: {
  activities: unknown;
  cursorSeq: number;
}): Result<SessionActivities> {
  if (!isRecord(activities)) {
    return err(["the fold is not an object keyed by workspace id"]);
  }
  const problems: string[] = [];
  // Entries, then `Object.fromEntries`, rather than assigning into `{}`: an assignment to a `__proto__` key
  // replaces the prototype instead of adding an entry, so that session would vanish from the fold unrefused.
  const decoded: (readonly [string, SessionActivity])[] = [];
  for (const [key, value] of Object.entries(activities)) {
    if (!isRecord(value)) {
      problems.push(`activity ${key} is not an object`);
      continue;
    }
    const found = activityProblems({ key, value });
    if (found.length > 0) {
      problems.push(...found);
      continue;
    }
    const activity = toActivity({ value });
    if (activity.lastSeq > cursorSeq) {
      problems.push(
        `activity ${key} has folded seq ${String(activity.lastSeq)}, past the cursor ${String(cursorSeq)} it is meant to be complete up to`,
      );
      continue;
    }
    decoded.push([key, activity]);
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok(Object.fromEntries(decoded));
}

/**
 * Decode the cursor file's text — `{ seq, recordedAtIso? }`.
 *
 * @param text the file's contents
 * @returns the sequence it recorded, or why it is not believable
 */
export function decodeCursorFile({ text }: { text: string }): Result<number> {
  return decodeCursorRecord({ positionKey: "seq", text })
    .map((record) => record.position)
    .mapErr((problems) => problems.map((problem) => `the cursor file: ${problem}`));
}

/**
 * Decode the activity file's envelope — `{ activities, recordedAtIso }` — down to the fold it carries.
 *
 * `recordedAtIso` may be absent, as the cursor file's may: the retired reader never required it. Present, it is
 * the writer's string stamp, so any other value means something other than that writer produced the file.
 *
 * @param decoded the file's contents, already parsed as JSON
 * @returns the raw fold, still to be decoded against its cursor, or why the envelope is not one
 */
export function activitiesOfFile({ decoded }: { decoded: unknown }): Result<unknown> {
  if (!isRecord(decoded) || !isRecord(decoded["activities"])) {
    return err(["the activity file: it is not an object carrying an activities object"]);
  }
  const stamp = decoded["recordedAtIso"];
  if (stamp !== undefined && typeof stamp !== "string") {
    return err(["the activity file: its recordedAtIso is neither absent nor a string"]);
  }
  return ok(decoded["activities"]);
}
