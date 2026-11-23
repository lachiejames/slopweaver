/**
 * The append-only record behind the drawdown watch: every sample it has taken, and every investigation it
 * has opened because of one.
 *
 * ## Why the samples live in a journal at all
 *
 * The detector needs a BASELINE, and a baseline is history. A gauge probe answers "what is the utilization
 * right now" and nothing on this machine remembered the answer, so there was no way to ask whether the
 * current pace is unusual. This file is that memory, and it is a journal rather than a rolling summary for
 * the ordinary reason: a summary can only answer the question it was designed for, and the thresholds here
 * are explicitly expected to be recalibrated once a week of real rates exists.
 *
 * ## Why an ATTEMPT is written before the spawn
 *
 * A spawn can fail, and it can fail after doing half its work. So the attempt is journalled first and it is
 * what suppression reads: a second automatic investigation of the same plan, window and reset is refused
 * whether or not the first one succeeded. Writing the outcome first would let a process that died between
 * deciding and recording open a fresh workspace on every tick, which is the failure mode that turns a
 * helpful watch into a workspace flood.
 *
 * Pure: lines in, events out. The file lives in `./drawdownJournalStore.ts`.
 */
import { absentAs } from "#lib/absent.js";
import { parseStrictIsoInstantMs } from "#lib/date.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { type ClaudeError, ClaudeErrors } from "./claudeErrors.js";
import type { DrawdownIncident, DrawdownSample, DrawdownTrigger, DrawdownWindow } from "./drawdownAnomaly.js";

/**
 * The decision to open an investigation, written BEFORE the spawn is attempted.
 *
 * @internal — a member of {@link DrawdownJournalEvent}; callers branch on `kind` rather than importing it.
 */
export interface DrawdownInvestigationAttempt {
  readonly kind: "investigation-attempted";
  readonly schemaVersion: 1;
  readonly incidentId: string;
  readonly attemptedAtIso: string;
  readonly triggers: readonly DrawdownTrigger[];
}

/**
 * A visible investigation that came up.
 *
 * @internal — a member of {@link DrawdownJournalEvent}.
 */
export interface DrawdownInvestigationOpened {
  readonly kind: "investigation-opened";
  readonly schemaVersion: 1;
  readonly incidentId: string;
  readonly recordedAtIso: string;
  readonly workspaceRef: string;
}

/**
 * A spawn that did not come up. Recorded and surfaced, never retried automatically.
 *
 * @internal — a member of {@link DrawdownJournalEvent}.
 */
export interface DrawdownInvestigationFailed {
  readonly kind: "investigation-failed";
  readonly schemaVersion: 1;
  readonly incidentId: string;
  readonly recordedAtIso: string;
  readonly reason: string;
}

/** Everything one line of the journal can be. */
export type DrawdownJournalEvent =
  DrawdownSample | DrawdownInvestigationAttempt | DrawdownInvestigationOpened | DrawdownInvestigationFailed;

/** What a whole journal read resolved to. */
export interface DrawdownJournalRead {
  readonly events: readonly DrawdownJournalEvent[];
  /** Lines that could not be parsed. Counted rather than dropped — a lost sample is a wrong baseline. */
  readonly unreadable: number;
}

/** The window names a sample line may carry. A `Set`, because the only question asked of it is membership. */
const WINDOW_NAMES: ReadonlySet<string> = new Set<DrawdownWindow>(["five-hour", "seven-day", "fable-seven-day"]);

/**
 * Whether a string is one of the windows this journal knows.
 *
 * A type PREDICATE rather than an assertion, so the narrowing is something the compiler checks instead of
 * something a cast asserts — `oxlint --type-aware` refuses the cast, and it is right to.
 *
 * Positional by the compiler's own decision: TS1230 forbids destructuring in a type predicate, which is one
 * of the named exceptions in `.claude/rules/typescript-patterns.md`.
 *
 * @param value the raw `window` field off a journal line
 * @returns whether it names a known window
 */
function isDrawdownWindow(value: string): value is DrawdownWindow {
  return WINDOW_NAMES.has(value);
}

/** A string field, or `undefined` when absent or the wrong type. */
function stringAt({ record, name }: { record: Record<string, unknown>; name: string }): string | undefined {
  const value = record[name];
  return typeof value === "string" ? value : undefined;
}

/** Parse a sample line. */
function parseSample({ record }: { record: Record<string, unknown> }): Result<DrawdownJournalEvent, ClaudeError> {
  const planAlias = stringAt({ name: "planAlias", record });
  const observedAtIso = stringAt({ name: "observedAtIso", record });
  const resetAtIso = stringAt({ name: "resetAtIso", record });
  const window = stringAt({ name: "window", record });
  const utilization = record["utilization"];
  if (planAlias === undefined || observedAtIso === undefined || resetAtIso === undefined) {
    return err(ClaudeErrors.drawdownSampleFieldsMissing());
  }
  // A reset or reading `Date.parse` would only guess at ("0", a zoneless time) is refused here, once, so no
  // forecast places a plan from an instant the watch never wrote.
  if (parseStrictIsoInstantMs({ text: observedAtIso }) === undefined) {
    return err(ClaudeErrors.drawdownSampleInstantInvalid({ field: "observedAtIso" }));
  }
  if (parseStrictIsoInstantMs({ text: resetAtIso }) === undefined) {
    return err(ClaudeErrors.drawdownSampleInstantInvalid({ field: "resetAtIso" }));
  }
  if (window === undefined || !isDrawdownWindow(window)) {
    return err(ClaudeErrors.drawdownSampleWindowUnknown({ window }));
  }
  if (typeof utilization !== "number" || !Number.isFinite(utilization)) {
    return err(ClaudeErrors.drawdownSampleUtilizationInvalid());
  }
  return ok({
    kind: "sample",
    observedAtIso,
    planAlias,
    resetAtIso,
    schemaVersion: 1,
    utilization,
    window,
  });
}

/** Parse an investigation line of any of the three kinds. */
function parseInvestigation({
  record,
  kind,
}: {
  record: Record<string, unknown>;
  kind: "investigation-attempted" | "investigation-opened" | "investigation-failed";
}): Result<DrawdownJournalEvent, ClaudeError> {
  const incidentId = stringAt({ name: "incidentId", record });
  if (incidentId === undefined) {
    return err(ClaudeErrors.drawdownFieldMissing({ field: "incidentId", lineKind: kind }));
  }
  if (kind === "investigation-attempted") {
    const attemptedAtIso = stringAt({ name: "attemptedAtIso", record });
    if (attemptedAtIso === undefined) {
      return err(ClaudeErrors.drawdownFieldMissing({ field: "attemptedAtIso", lineKind: kind }));
    }
    const triggers = record["triggers"];
    return ok({
      attemptedAtIso,
      incidentId,
      kind,
      schemaVersion: 1,
      triggers: Array.isArray(triggers) ? (triggers as readonly DrawdownTrigger[]) : [],
    });
  }
  const recordedAtIso = stringAt({ name: "recordedAtIso", record });
  if (recordedAtIso === undefined) {
    return err(ClaudeErrors.drawdownFieldMissing({ field: "recordedAtIso", lineKind: kind }));
  }
  if (kind === "investigation-opened") {
    const workspaceRef = stringAt({ name: "workspaceRef", record });
    if (workspaceRef === undefined) {
      return err(ClaudeErrors.drawdownFieldMissing({ field: "workspaceRef", lineKind: kind }));
    }
    return ok({ incidentId, kind, recordedAtIso, schemaVersion: 1, workspaceRef });
  }
  return ok({
    incidentId,
    kind,
    reason: absentAs({ value: stringAt({ name: "reason", record }), whenAbsent: "no reason recorded" }),
    recordedAtIso,
    schemaVersion: 1,
  });
}

/**
 * Read one journal line.
 *
 * @param line one line, without its newline
 * @returns the event it holds, or why it could not be read
 */
export function parseDrawdownJournalLine({ line }: { line: string }): Result<DrawdownJournalEvent, ClaudeError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return err(ClaudeErrors.drawdownLineNotJson());
  }
  if (!isRecord(parsed)) {
    return err(ClaudeErrors.drawdownLineNotObject());
  }
  const kind = stringAt({ name: "kind", record: parsed });
  if (kind === "sample") {
    return parseSample({ record: parsed });
  }
  if (kind === "investigation-attempted" || kind === "investigation-opened" || kind === "investigation-failed") {
    return parseInvestigation({ kind, record: parsed });
  }
  return err(ClaudeErrors.drawdownKindUnknown({ kind }));
}

/**
 * Every sample in a journal read, which is what the detector's baseline stands on.
 *
 * @param events the events read back
 * @returns just the samples
 */
export function samplesOf({ events }: { events: readonly DrawdownJournalEvent[] }): readonly DrawdownSample[] {
  return events.filter((event): event is DrawdownSample => event.kind === "sample");
}

/** Whether an automatic investigation may be opened for this incident. */
export type DrawdownAdmission = { readonly kind: "attempt" } | { readonly kind: "suppress"; readonly reason: string };

/**
 * Whether this incident has already been attempted.
 *
 * Keyed on the incident id, which names the plan, window and reset — so a genuinely NEW episode after a
 * reset is admitted while the same one on the next tick is not.
 *
 * @param incident the episode the detector just reported
 * @param history every event already journalled
 * @returns whether to attempt, or why not
 */
export function admitDrawdownInvestigation({
  incident,
  history,
}: {
  incident: DrawdownIncident;
  history: readonly DrawdownJournalEvent[];
}): DrawdownAdmission {
  const already = history.find(
    (event) => event.kind === "investigation-attempted" && event.incidentId === incident.incidentId,
  );
  if (already === undefined) {
    return { kind: "attempt" };
  }
  return {
    kind: "suppress",
    reason: `this episode was already investigated (${incident.incidentId}) — a second automatic spawn is refused`,
  };
}
