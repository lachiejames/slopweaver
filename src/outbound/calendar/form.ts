/**
 * The typed forms the Calendar write verbs take on stdin — strict, so an unrecognised key is refused with
 * the nearest real field named rather than dropped.
 *
 * ## Wall-clock in, never an offset
 *
 * `start`/`end` are `YYYY-MM-DDTHH:MM` in a zone (the form's, else the account's), because that is how a
 * person says a meeting time and because Google's own `EventDateTime` takes exactly that pair — a local
 * `dateTime` with no offset plus a `timeZone`. Nothing here does offset arithmetic; nothing here can put a
 * meeting on the wrong side of a DST edge. An all-day event is two bare dates, `end` INCLUSIVE to the
 * caller and turned into Google's exclusive bound once, in the planner.
 *
 * Pure: JSON in, a typed form or every reason it was refused out.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";
import { strictForm } from "../strictForm.js";

/** A wall-clock minute, `YYYY-MM-DDTHH:MM`. */
const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** A bare date, `YYYY-MM-DD`. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A span: two wall-clock minutes, or two dates with `allDay`. */
export interface EventSpan {
  readonly start: string;
  readonly end: string;
  readonly allDay: boolean;
  /** The IANA zone the wall-clock times are read in, or undefined to use the account's own. */
  readonly zone: string | undefined;
}

/** `calendar book --form -`. */
export interface CalendarBookForm {
  readonly kind: "book";
  readonly title: string;
  readonly description: string | undefined;
  readonly location: string | undefined;
  readonly span: EventSpan;
  /** Everyone invited, deduplicated in order; the planner drops the owner's own address. */
  readonly attendees: readonly string[];
  /** Whether to ask Google for a Meet link. Defaults to true whenever anyone is invited. */
  readonly meet: boolean;
}

/** `calendar edit <id> --form -`: only the fields present change. */
export interface CalendarEditForm {
  readonly kind: "edit";
  readonly title: string | undefined;
  readonly description: string | undefined;
  readonly location: string | undefined;
  /** The whole attendee set after the edit, or undefined to leave it alone; the planner drops the owner. */
  readonly attendees: readonly string[] | undefined;
}

/** `calendar reschedule <id> --form -`. */
export interface CalendarRescheduleForm {
  readonly kind: "reschedule";
  readonly span: EventSpan;
}

/** `calendar respond <id> --form -`: the owner's own RSVP. */
export interface CalendarRespondForm {
  readonly kind: "respond";
  readonly response: "accepted" | "declined" | "tentative";
  readonly comment: string | undefined;
}

/**
 * `calendar cancel <id>` takes no form; this is its typed stand-in so every write has one shape.
 *
 * @internal — a member of {@link CalendarWriteForm}; no caller names it directly.
 */
export interface CalendarCancelForm {
  readonly kind: "cancel";
}

/** Every write form. */
export type CalendarWriteForm =
  CalendarBookForm | CalendarEditForm | CalendarRescheduleForm | CalendarRespondForm | CalendarCancelForm;

/** An attendee list that accepts one bare string, because that is what everybody writes. */
const attendeeList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    } else if (typeof value === "string") {
      return [value];
    } else {
      return value;
    }
  });

const bookSchema = strictForm({
  allDay: z.boolean().optional(),
  attendees: attendeeList,
  description: z.string().optional(),
  end: z.string(),
  location: z.string().optional(),
  meet: z.boolean().optional(),
  start: z.string(),
  title: z.string(),
  zone: z.string().optional(),
});

const editSchema = strictForm({
  attendees: attendeeList,
  description: z.string().optional(),
  location: z.string().optional(),
  title: z.string().optional(),
});

const rescheduleSchema = strictForm({
  allDay: z.boolean().optional(),
  end: z.string(),
  start: z.string(),
  zone: z.string().optional(),
});

const respondSchema = strictForm({
  comment: z.string().optional(),
  response: z.enum(["accepted", "declined", "tentative"]),
});

/** Parse the JSON text, reporting the syntax error in the caller's terms. */
function parseJson({ json }: { json: string }): Result<unknown> {
  try {
    return ok(JSON.parse(json));
  } catch (cause) {
    return err([`--form is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`]);
  }
}

/** Flatten a Zod failure into one line per issue. */
function issues({ error }: { error: z.ZodError }): readonly string[] {
  return error.issues.map((issue) => `${issueWhere({ path: issue.path })}: ${issue.message}`);
}

/** Where an issue sits in the form. Zod gives an issue about the whole document an empty path, which reads `(root)`. */
function issueWhere({ path }: { path: readonly PropertyKey[] }): string {
  const dotted = path.join(".");
  if (dotted.length === 0) {
    return "(root)";
  }
  return dotted;
}

/**
 * Check a span's two ends against the shape `allDay` demands, and that the end is after the start.
 *
 * @param start the form's `start`
 * @param end the form's `end`
 * @param allDay whether both are bare dates
 * @param zone the form's zone, if any
 * @returns the span, or every reason it was refused
 */
export function validateSpan({
  start,
  end,
  allDay,
  zone,
}: {
  start: string;
  end: string;
  allDay: boolean;
  zone: string | undefined;
}): Result<EventSpan> {
  const shape = allDay ? DATE_ONLY : WALL_CLOCK;
  const want = allDay ? "YYYY-MM-DD (allDay)" : "YYYY-MM-DDTHH:MM";
  const problems: string[] = [];
  if (!shape.test(start)) {
    problems.push(`start must be ${want}: ${start}`);
  }
  if (!shape.test(end)) {
    problems.push(`end must be ${want}: ${end}`);
  }
  if (problems.length === 0 && (allDay ? end < start : end <= start)) {
    problems.push(allDay ? `end (${end}) is before start (${start})` : `end (${end}) is not after start (${start})`);
  }
  if (zone?.trim().length === 0) {
    problems.push("zone must be an IANA zone name when given");
  }
  return problems.length === 0 ? ok({ allDay, end, start, zone }) : err(problems);
}

/**
 * Deduplicate attendees in order, lowercased, refusing anything not address-shaped. The owner's own
 * address is dropped later by the planner, which is the layer that knows the bound account.
 *
 * @param attendees the addresses as written
 * @returns the cleaned list, or every reason it was refused
 */
export function normaliseAttendees({ attendees }: { attendees: readonly string[] }): Result<readonly string[]> {
  const problems: string[] = [];
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const raw of attendees) {
    const address = raw.trim().toLowerCase();
    if (!address.includes("@") || address.startsWith("@") || address.endsWith("@")) {
      problems.push(`attendee is not an email address: ${raw}`);
      continue;
    }
    if (seen.has(address)) {
      continue;
    }
    seen.add(address);
    clean.push(address);
  }
  return problems.length === 0 ? ok(clean) : err(problems);
}

/**
 * Whether a booking asks Google for a Meet link. A form that leaves `meet` out asks for one exactly when anyone
 * is invited: guests need somewhere to meet, and a block the owner holds alone does not.
 */
function wantsMeet({ attendees, meet }: { attendees: readonly string[]; meet: boolean | undefined }): boolean {
  if (meet === undefined) {
    return attendees.length > 0;
  }
  return meet;
}

/**
 * Parse `calendar book`'s form.
 *
 * @param json the raw form text
 * @returns the typed form, or every reason it was refused
 */
export function parseCalendarBookForm({ json }: { json: string }): Result<CalendarBookForm> {
  const document = parseJson({ json });
  if (document.isErr()) {
    return err(document.error);
  }
  const parsed = bookSchema.safeParse(document.value);
  if (!parsed.success) {
    return err(issues({ error: parsed.error }));
  }
  const problems: string[] = [];
  if (parsed.data.title.trim().length === 0) {
    problems.push("title must not be empty");
  }
  const span = validateSpan({
    // A span is timed unless the form says `allDay: true`: a caller booking an ordinary meeting leaves it out.
    allDay: parsed.data.allDay === true,
    end: parsed.data.end,
    start: parsed.data.start,
    zone: parsed.data.zone,
  });
  // A booking that names no attendees is held by the owner alone, so there is no address to normalise.
  const invited = parsed.data.attendees;
  const people: Result<readonly string[]> = invited === undefined ? ok([]) : normaliseAttendees({ attendees: invited });
  if (span.isErr()) {
    problems.push(...span.error);
  }
  if (people.isErr()) {
    problems.push(...people.error);
  }
  if (problems.length > 0 || span.isErr() || people.isErr()) {
    return err(problems);
  }
  const attendees = people.value;
  return ok({
    attendees,
    description: parsed.data.description,
    kind: "book",
    location: parsed.data.location,
    meet: wantsMeet({ attendees, meet: parsed.data.meet }),
    span: span.value,
    title: parsed.data.title.trim(),
  });
}

/**
 * Parse `calendar edit`'s form.
 *
 * @param json the raw form text
 * @returns the typed form, or every reason it was refused
 */
export function parseCalendarEditForm({ json }: { json: string }): Result<CalendarEditForm> {
  const document = parseJson({ json });
  if (document.isErr()) {
    return err(document.error);
  }
  const parsed = editSchema.safeParse(document.value);
  if (!parsed.success) {
    return err(issues({ error: parsed.error }));
  }
  const nothingChanges =
    parsed.data.title === undefined &&
    parsed.data.description === undefined &&
    parsed.data.location === undefined &&
    parsed.data.attendees === undefined;
  if (nothingChanges) {
    return err(["an edit must name at least one of title, description, location, attendees"]);
  }
  const people =
    parsed.data.attendees === undefined ? ok(undefined) : normaliseAttendees({ attendees: parsed.data.attendees });
  if (people.isErr()) {
    return err(people.error);
  }
  return ok({
    attendees: people.value,
    description: parsed.data.description,
    kind: "edit",
    location: parsed.data.location,
    title: parsed.data.title,
  });
}

/**
 * Parse `calendar reschedule`'s form.
 *
 * @param json the raw form text
 * @returns the typed form, or every reason it was refused
 */
export function parseCalendarRescheduleForm({ json }: { json: string }): Result<CalendarRescheduleForm> {
  const document = parseJson({ json });
  if (document.isErr()) {
    return err(document.error);
  }
  const parsed = rescheduleSchema.safeParse(document.value);
  if (!parsed.success) {
    return err(issues({ error: parsed.error }));
  }
  return validateSpan({
    // A span is timed unless the form says `allDay: true`: a caller moving an ordinary meeting leaves it out.
    allDay: parsed.data.allDay === true,
    end: parsed.data.end,
    start: parsed.data.start,
    zone: parsed.data.zone,
  }).map((span) => ({ kind: "reschedule" as const, span }));
}

/**
 * Parse `calendar respond`'s form.
 *
 * @param json the raw form text
 * @returns the typed form, or every reason it was refused
 */
export function parseCalendarRespondForm({ json }: { json: string }): Result<CalendarRespondForm> {
  const document = parseJson({ json });
  if (document.isErr()) {
    return err(document.error);
  }
  const parsed = respondSchema.safeParse(document.value);
  if (!parsed.success) {
    return err(issues({ error: parsed.error }));
  }
  return ok({ comment: parsed.data.comment, kind: "respond", response: parsed.data.response });
}

/**
 * Parse the form a write verb was given, by verb.
 *
 * @param verb which write verb the form belongs to
 * @param json the raw form text, or undefined for `cancel`
 * @returns the typed form, or every reason it was refused
 */
export function parseCalendarWriteForm({
  verb,
  json,
}: {
  verb: "book" | "edit" | "reschedule" | "cancel" | "respond";
  json: string | undefined;
}): Result<CalendarWriteForm> {
  if (verb === "cancel") {
    return ok({ kind: "cancel" });
  }
  if (json === undefined) {
    return err([`${verb} needs --form`]);
  }
  switch (verb) {
    case "book":
      return parseCalendarBookForm({ json });
    case "edit":
      return parseCalendarEditForm({ json });
    case "reschedule":
      return parseCalendarRescheduleForm({ json });
    case "respond":
      return parseCalendarRespondForm({ json });
    default: {
      const never: never = verb;
      return never;
    }
  }
}
