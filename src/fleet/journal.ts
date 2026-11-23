/**
 * The recovery journal: one append-only journal in the store (`fleet_journal_event` under journal `resume`), that
 * the visible recovery pass (`fleet resume`, inside cmux) writes and `fleet health` (outside cmux) reads.
 *
 * It is the ONLY channel between the two, and that is forced rather than chosen: cmux refuses every process it did
 * not start (measured: a detached shell's `cmux ping` answers "Access denied - only processes started
 * inside cmux can connect"), so the desktop app can never read a screen or a workspace list itself. What the pass
 * saw inside cmux reaches the page through this journal. `session close-done`, also inside cmux, is its one other
 * writer: a `seat-gone` line when a refused seat's workspace is no longer listed (`./goneSeats.ts`).
 *
 * ## The supervisor's green comes from here, and only from its own line
 *
 * `chair-reoriented` is appended by `slopweaver supervisor reoriented`, run BY the chair once it has read the
 * picture back in (`skills/supervisor/reference/reboot.md` § Reoriented). The recovery pass never writes it on the
 * chair's behalf, so a process that merely exists cannot turn the chair green.
 *
 * Pure: stored values in, events and a fold out. The rows are reached only through `./port.ts`.
 */
import { z } from "zod";

import { jsonlValues } from "./jsonlValues.js";
import { FLEET_REFUSAL_CODES, type FleetRefusal, type FleetRefusalCode } from "./refusals.js";

const refusalSchema = z.object({
  alias: z.string().exactOptional(),
  code: z.string(),
  message: z.string(),
  originalCode: z.string().exactOptional(),
  storeRefusal: z
    .enum(["spent-plan", "unreadable-plan", "configuration", "usage-limit", "not-measured", "paused", "token"])
    .exactOptional(),
  workspaceRef: z.string().exactOptional(),
});

const base = { atIso: z.string(), attemptId: z.string(), schemaVersion: z.literal(1) };

const eventSchema = z.discriminatedUnion("kind", [
  z.object({
    ...base,
    episodeId: z.string(),
    kind: z.literal("attempt-started"),
    pid: z.number().int(),
    // The pass's process start, as `ps` prints it, so a later process that inherits the pid never reads as the pass.
    pidStart: z.string().optional(),
  }),
  z.object({
    ...base,
    detail: z.string(),
    kind: z.literal("console"),
    port: z.number().int().optional(),
    state: z.enum(["serving", "started", "failed"]),
  }),
  z.object({
    ...base,
    kind: z.literal("seat"),
    phase: z.enum(["recovering", "reseated", "refused", "held"]),
    refusal: refusalSchema.optional(),
    role: z.enum(["supervisor", "worker"]),
    sessionId: z.string().optional(),
    workspaceRef: z.string(),
  }),
  z.object({
    ...base,
    chairSessionId: z.string(),
    chairWorkspaceId: z.string(),
    kind: z.literal("chair-awaiting-reorientation"),
  }),
  z.object({ ...base, chairSessionId: z.string(), kind: z.literal("chair-reoriented") }),
  z.object({
    ...base,
    kind: z.literal("attempt-finished"),
    outcome: z.enum(["healthy", "hand-step", "deferred", "failed"]),
    refusal: refusalSchema.optional(),
  }),
  // `session close-done` listed cmux after the attempt finished and this seat's workspace was not in it: the seat
  // the attempt refused or held no longer exists, so its refusal describes nothing (`./goneSeats.ts`).
  z.object({ ...base, kind: z.literal("seat-gone"), workspaceRef: z.string() }),
]);

/** The events, and every line that would not decode — counted, never silently dropped. */
export interface FleetJournalRead {
  readonly events: readonly FleetJournalEvent[];
  readonly unreadable: number;
  /** For each line that would not decode, how many events decoded before it — where in the stream it fell. */
  readonly unreadableAt: readonly number[];
}

/**
 * Whether every line from the newest `attempt-started` on decoded. A line that would not decode there may be one of
 * that attempt's seats, or a newer attempt's start, so a fold of what did decode is not the attempt — and nothing
 * may be concluded from its absence. A line before it cannot touch it: a bounded tail's cut first line is one.
 *
 * @param journal the read
 * @returns true when nothing after the newest start failed to decode — with no start decoded, only when nothing
 *   failed at all, since the line that failed may be that start
 */
export function newestAttemptReadWhole({ journal }: { journal: FleetJournalRead }): boolean {
  const start = journal.events.findLastIndex((event) => event.kind === "attempt-started");
  return journal.unreadableAt.every((at) => at <= start);
}

type RawEvent = z.infer<typeof eventSchema>;

/** One journal line, decoded, its refusal's code narrowed to one this build can name. */
export type FleetJournalEvent = DecodedEvent;

/** A decoded event with its refusal's code narrowed. */
type DecodedEvent =
  | Exclude<RawEvent, { kind: "seat" | "attempt-finished" }>
  | (Omit<Extract<RawEvent, { kind: "seat" }>, "refusal"> & { readonly refusal?: FleetRefusal })
  | (Omit<Extract<RawEvent, { kind: "attempt-finished" }>, "refusal"> & { readonly refusal?: FleetRefusal });

/** Narrow a raw refusal's code, keeping a code this build cannot name as `UNKNOWN` with the original beside it. */
function normaliseRefusal({ raw }: { raw: z.infer<typeof refusalSchema> }): FleetRefusal {
  const known = FLEET_REFUSAL_CODES.find((code) => code === raw.code);
  const { code: _code, ...rest } = raw;
  if (known === undefined) {
    return { ...rest, code: "UNKNOWN", originalCode: raw.code };
  }
  return { ...rest, code: known satisfies FleetRefusalCode };
}

/**
 * Decode one parsed value — a stored row's `event` or one legacy line's JSON — into an event.
 *
 * @param value the value; `null` (an imported line that would not decode) is never an event
 * @returns the event, or `undefined` when it is not one
 */
export function decodeFleetJournalEvent({ value }: { value: unknown }): FleetJournalEvent | undefined {
  const parsed = eventSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  const event = parsed.data;
  if (event.kind === "seat") {
    const { refusal, ...rest } = event;
    return refusal === undefined ? rest : { ...rest, refusal: normaliseRefusal({ raw: refusal }) };
  }
  if (event.kind === "attempt-finished") {
    const { refusal, ...rest } = event;
    return refusal === undefined ? rest : { ...rest, refusal: normaliseRefusal({ raw: refusal }) };
  }
  return event;
}

/**
 * Decode a journal's entries in order — the stored rows' `event` values, oldest first.
 *
 * @param values one value per entry; a `null` placeholder or anything that will not decode is counted where it fell
 * @returns the events in order, and where each entry that would not decode fell
 */
export function fleetJournalOfValues({ values }: { values: readonly unknown[] }): FleetJournalRead {
  const events: DecodedEvent[] = [];
  const unreadableAt: number[] = [];
  for (const value of values) {
    const event = decodeFleetJournalEvent({ value });
    if (event === undefined) {
      unreadableAt.push(events.length);
      continue;
    }
    events.push(event);
  }
  return { events, unreadable: unreadableAt.length, unreadableAt };
}

/**
 * Decode a journal's JSONL text, line by line — the one-time import of a legacy file, and the unit tests.
 *
 * @param text the file's contents
 * @returns the events in order, and where each line that would not decode fell
 */
export function parseFleetJournal({ text }: { text: string }): FleetJournalRead {
  return fleetJournalOfValues({ values: jsonlValues({ text }).map((line) => line.value) });
}

/** One seat's newest recorded phase in an attempt. */
export interface FleetSeatPhase {
  readonly workspaceRef: string;
  readonly sessionId: string | undefined;
  readonly role: "supervisor" | "worker";
  readonly phase: "recovering" | "reseated" | "refused" | "held";
  readonly refusal: FleetRefusal | undefined;
}

/** The newest attempt, folded. */
export interface FleetAttemptFold {
  readonly attemptId: string;
  readonly episodeId: string;
  readonly startedAtIso: string;
  readonly pid: number;
  /** The pass's process start, when `ps` printed one for it. */
  readonly pidStart: string | undefined;
  /** Absent while the attempt is running, or when the process running it died before it finished. */
  readonly finished:
    | { readonly outcome: "healthy" | "hand-step" | "deferred" | "failed"; readonly refusal: FleetRefusal | undefined }
    | undefined;
  readonly console: { readonly state: "serving" | "started" | "failed"; readonly detail: string } | undefined;
  /** The chair's reorientation: awaited, given, or never asked for in this attempt. */
  readonly chair:
    | { readonly kind: "not-asked" }
    | { readonly kind: "awaiting"; readonly chairSessionId: string; readonly chairWorkspaceId: string }
    | { readonly kind: "reoriented"; readonly chairSessionId: string; readonly atIso: string };
  /** Each seat's newest phase, keyed by workspace ref — less any a later `seat-gone` line says no longer exists. */
  readonly seats: ReadonlyMap<string, FleetSeatPhase>;
}

/** The attempt id a `chair-reoriented` line carries when the chair reoriented with no recovery attempt open. */
export const STANDALONE_REORIENTATION = "standalone";

/**
 * When each chair session last said it was caught up, across every attempt and none.
 *
 * @param events the decoded journal, oldest first
 * @returns each chair session id's newest reorientation instant
 */
export function reorientationsBySession({
  events,
}: {
  events: readonly FleetJournalEvent[];
}): ReadonlyMap<string, string> {
  const newest = new Map<string, string>();
  for (const event of events) {
    if (event.kind === "chair-reoriented") {
      newest.set(event.chairSessionId, event.atIso);
    }
  }
  return newest;
}

/**
 * The newest `attempt-started` line in the journal.
 *
 * @param events the decoded journal, oldest first
 * @returns that line, or `undefined` when no attempt has ever started
 */
function newestStart({
  events,
}: {
  events: readonly FleetJournalEvent[];
}): Extract<DecodedEvent, { kind: "attempt-started" }> | undefined {
  return events.findLast(
    (event): event is Extract<DecodedEvent, { kind: "attempt-started" }> => event.kind === "attempt-started",
  );
}

/**
 * Fold the newest attempt out of the journal's events.
 *
 * A `chair-reoriented` line counts only when it names the session the same attempt was awaiting: one written for an
 * older attempt, or by any other session, is not this chair saying it is caught up.
 *
 * @param events the decoded journal, oldest first
 * @returns the newest attempt, or `undefined` when no attempt has ever started
 */
export function foldNewestAttempt({ events }: { events: readonly FleetJournalEvent[] }): FleetAttemptFold | undefined {
  const started = newestStart({ events });
  if (started === undefined) {
    return undefined;
  }
  let finished: FleetAttemptFold["finished"];
  let consoleState: FleetAttemptFold["console"];
  let chair: FleetAttemptFold["chair"] = { kind: "not-asked" };
  const seats = new Map<string, FleetSeatPhase>();
  for (const event of events) {
    if (event.attemptId !== started.attemptId) {
      continue;
    }
    switch (event.kind) {
      case "attempt-finished":
        finished = { outcome: event.outcome, refusal: event.refusal };
        break;
      case "console":
        consoleState = { detail: event.detail, state: event.state };
        break;
      case "chair-awaiting-reorientation":
        chair = { chairSessionId: event.chairSessionId, chairWorkspaceId: event.chairWorkspaceId, kind: "awaiting" };
        break;
      case "chair-reoriented":
        if (chair.kind === "awaiting" && chair.chairSessionId === event.chairSessionId) {
          chair = { atIso: event.atIso, chairSessionId: event.chairSessionId, kind: "reoriented" };
        }
        break;
      case "seat":
        seats.set(event.workspaceRef, {
          phase: event.phase,
          refusal: event.refusal,
          role: event.role,
          sessionId: event.sessionId,
          workspaceRef: event.workspaceRef,
        });
        break;
      case "seat-gone":
        seats.delete(event.workspaceRef);
        break;
      case "attempt-started":
        break;
      default: {
        const unreachable: never = event;
        return unreachable;
      }
    }
  }
  return {
    attemptId: started.attemptId,
    chair,
    console: consoleState,
    episodeId: started.episodeId,
    finished,
    pid: started.pid,
    pidStart: started.pidStart,
    seats,
    startedAtIso: started.atIso,
  };
}
