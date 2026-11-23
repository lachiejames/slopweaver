/**
 * The revive journal: one append-only journal in the store, that `cmux revive` (run from OUTSIDE cmux, by the
 * desktop app) writes and `fleet health` reads.
 *
 * A `reading` is appended when the app's answer changes, and on EVERY probe while it is not answering — so a hang
 * is a run of consecutive readings whose gaps show whether anyone was watching the whole time (a machine asleep
 * is not ten minutes of silence). A restart is two events, its start and its finish, so a restart that died
 * half-way reads as one that never finished rather than as nothing. A hang that began within the hour after a restart
 * came up answering is journalled once as `recurring` (twice, at worst, when two revives race) (`./recurrence.ts`); a restart held for a loop is journalled as
 * `restart-held`, re-stated as readings pile up behind it so the bounded tail never loses it; and a modal dialog a seat
 * declined is journalled as `dialog-dismissed` with its title and the button pressed.
 *
 * Pure: stored values in, events out. The rows are `fleet_journal_event` under journal `cmux-revive`, reached only
 * through `../fleet/port.ts`; the legacy file is read once, as an import.
 */
import { z } from "zod";

import { jsonlValues } from "../fleet/jsonlValues.js";

/** What one probe of the control socket heard from outside cmux, read with what the seats' calls last heard. */
const CMUX_PROBE_STATES = ["answering", "stalled", "unprobed", "refused", "silent", "absent"] as const;

/**
 * One probe's state: a reply with the seats' last call answered, a reply while the seats' calls time out, a reply
 * with nothing recent from the seats to judge it by, a refused connect, no reply, or no app.
 */
export type CmuxProbeState = (typeof CMUX_PROBE_STATES)[number];

const base = { atIso: z.string(), schemaVersion: z.literal(1) };

const eventSchema = z.discriminatedUnion("kind", [
  z.object({
    ...base,
    appPid: z.number().int().nullable(),
    // The app's process start as `ps` prints it, so a relaunched app on a recycled pid starts a new series.
    appStart: z.string().nullable(),
    detail: z.string(),
    kind: z.literal("reading"),
    state: z.enum(CMUX_PROBE_STATES),
  }),
  z.object({
    ...base,
    appPid: z.number().int(),
    hungSinceIso: z.string(),
    kind: z.literal("restart-started"),
  }),
  z.object({
    ...base,
    detail: z.string(),
    kind: z.literal("restart-finished"),
    newAppPid: z.number().int().nullable(),
    outcome: z.enum(["answering", "not-answering", "failed"]),
  }),
  z.object({
    ...base,
    // The restart this hang came back after: its `restart-finished` instant.
    afterRestartIso: z.string(),
    hungSinceIso: z.string(),
    kind: z.literal("recurring"),
  }),
  z.object({
    ...base,
    // The held hang's first reading, carried forward unchanged on every refresh of the marker.
    hungSinceIso: z.string(),
    kind: z.literal("restart-held"),
  }),
  z.object({
    ...base,
    // The dialog's own title and the button pressed, so a journal reader sees exactly what was declined.
    button: z.string(),
    kind: z.literal("dialog-dismissed"),
    title: z.string(),
  }),
]);

/** One decoded journal line. */
export type CmuxReviveEvent = z.infer<typeof eventSchema>;

/** One probe's reading, as journalled. */
export type CmuxReading = Extract<CmuxReviveEvent, { kind: "reading" }>;

/** The events, and every line that would not decode — counted, never silently dropped. */
export interface CmuxReviveRead {
  readonly events: readonly CmuxReviveEvent[];
  readonly unreadable: number;
}

/**
 * Decode one parsed value — a stored row's `event` or one legacy line's JSON — into an event.
 *
 * @param value the value; `null` (an imported line that would not decode) is never an event
 * @returns the event, or `undefined` when it is not one
 */
export function decodeCmuxReviveEvent({ value }: { value: unknown }): CmuxReviveEvent | undefined {
  const parsed = eventSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
}

/**
 * Decode a journal's entries in order — the stored rows' `event` values, oldest first.
 *
 * @param values one value per entry; a `null` placeholder or anything that will not decode is counted
 * @returns the events in order, and how many entries would not decode
 */
export function cmuxReviveJournalOfValues({ values }: { values: readonly unknown[] }): CmuxReviveRead {
  const events: CmuxReviveEvent[] = [];
  let unreadable = 0;
  for (const value of values) {
    const event = decodeCmuxReviveEvent({ value });
    if (event === undefined) {
      unreadable += 1;
      continue;
    }
    events.push(event);
  }
  return { events, unreadable };
}

/**
 * Decode a journal's JSONL text, line by line — the one-time import of a legacy file, and the unit tests.
 *
 * @param text the file's contents
 * @returns the events in order, and how many lines would not decode
 */
export function parseCmuxReviveJournal({ text }: { text: string }): CmuxReviveRead {
  return cmuxReviveJournalOfValues({ values: jsonlValues({ text }).map((line) => line.value) });
}
