/**
 * PURE argument handling for the `calendar` write verbs — `book`, `edit`, `reschedule`, `cancel`,
 * `respond` and `commit`. Every tail is parsed here and nowhere else, so a malformed invocation is refused
 * before a credential is read, a form is read from stdin, or an intent is written.
 *
 * `formSource` is the raw `--form` value, NOT the form: `-` means "read stdin", which is I/O and therefore
 * the shell's job. There is deliberately no `--dry-run` on any write: a write that reaches anyone but the
 * owner already prints its preview and holds, and one that reaches nobody is journalled at the door either
 * way — a second way to say "show me" would only invite the belief that the first one sends.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { parseFlagTail } from "../../optionParsers.js";
import { type CalendarArgsError, CalendarArgsErrors } from "./errors.js";

/** The `--form` value that means "read stdin". */
export const STDIN_SENTINEL = "-";

/** The write verbs that take a form and address an existing event, or none. */
export type CalendarWriteVerb = "book" | "edit" | "reschedule" | "cancel" | "respond";

/**
 * A parsed prepare-verb invocation.
 *
 * @internal — the declared shape of `parseCalendarWriteArgs`'s success value; no caller names it.
 */
export interface CalendarWriteArgs {
  readonly verb: CalendarWriteVerb;
  readonly home: string | undefined;
  /** The existing event, absent for `book`. */
  readonly eventId: string | undefined;
  /** The raw `--form` value, absent for `cancel`. */
  readonly formSource: string | undefined;
  readonly json: boolean;
}

/**
 * A parsed `calendar commit` invocation.
 *
 * @internal — the declared shape of `parseCalendarCommitArgs`'s success value; no caller names it.
 */
export interface CalendarCommitArgs {
  readonly home: string | undefined;
  readonly intentId: string;
  readonly approval: CalendarCommitApproval | undefined;
  readonly json: boolean;
}

/**
 * What a commit carries as the owner's approval: the digest itself, or an anchor at the owner's own words saying yes. Never both —
 * the two are different claims about who approved, and a commit makes exactly one.
 *
 * @internal — the declared shape of `CalendarCommitArgs.approval`; no caller names it.
 */
export type CalendarCommitApproval =
  { readonly kind: "digest"; readonly digest: string } | { readonly kind: "anchor"; readonly anchor: string };

/**
 * Usage per write verb, printed after every refusal.
 *
 * @internal — the parser's own refusal text; the manifest carries its own copy so it imports nothing here.
 */
export const WRITE_USAGE: Readonly<Record<CalendarWriteVerb | "commit", string>> = {
  book:
    "usage: slopweaver calendar book --form <json|-> [--json] [--home <dir>]\n" +
    "  Proposes an event on your primary calendar; with anyone else on it, holds for `calendar commit`\n" +
    '  --form   {"title","start":"YYYY-MM-DDTHH:MM","end","zone"?,"attendees"?,"description"?,"location"?,"meet"?,"allDay"?} — `-` reads stdin',
  cancel:
    "usage: slopweaver calendar cancel <event-id> [--json] [--home <dir>]\n" +
    "  Proposes cancelling one event on your primary calendar; with attendees, holds for `calendar commit`",
  commit:
    "usage: slopweaver calendar commit <intent-id> --anchor <where the owner said yes> | --approve <digest> [--json] [--home <dir>]\n" +
    "  Re-reads the event, rebuilds the preview and its digest, and sends only on an exact match: --anchor reads the owner's\n" +
    "  whole words there and matches the digest the preview printed; --approve matches the digest given",
  edit:
    "usage: slopweaver calendar edit <event-id> --form <json|-> [--json] [--home <dir>]\n" +
    "  Changes the named fields of one event on your primary calendar; with anyone else on it, holds\n" +
    '  --form   {"title"?,"description"?,"location"?,"attendees"?} — attendees is the WHOLE set after; `-` reads stdin',
  reschedule:
    "usage: slopweaver calendar reschedule <event-id> --form <json|-> [--json] [--home <dir>]\n" +
    "  Moves one event's time on your primary calendar; with anyone else on it, holds\n" +
    '  --form   {"start":"YYYY-MM-DDTHH:MM","end","zone"?,"allDay"?} — `-` reads stdin',
  respond:
    "usage: slopweaver calendar respond <event-id> --form <json|-> [--json] [--home <dir>]\n" +
    "  Sets your own RSVP on an invitation; the organiser sees it, so this always holds\n" +
    '  --form   {"response":"accepted"|"declined"|"tentative","comment"?} — `-` reads stdin',
};

/**
 * Every flag each write verb ACCEPTS, by verb.
 *
 * @internal — the help-truth sweep's input; nothing at runtime reads it.
 */
export const CALENDAR_WRITE_FLAG_NAMES: Readonly<Record<CalendarWriteVerb | "commit", readonly string[]>> = {
  book: ["--form", "--home", "--json"],
  cancel: ["--home", "--json"],
  commit: ["--anchor", "--approve", "--home", "--json"],
  edit: ["--form", "--home", "--json"],
  reschedule: ["--form", "--home", "--json"],
  respond: ["--form", "--home", "--json"],
};

/**
 * Parse one prepare verb's tail: an event id first for every verb but `book`, then flags.
 *
 * @param verb which write verb the tail belongs to
 * @param rest the argv tail after the verb
 * @returns the validated request, or every reason it was refused
 */
export function parseCalendarWriteArgs({
  verb,
  rest,
}: {
  verb: CalendarWriteVerb;
  rest: readonly string[];
}): Result<CalendarWriteArgs, CalendarArgsError> {
  const usage = WRITE_USAGE[verb];
  let eventId: string | undefined;
  let tail = rest;
  if (verb !== "book") {
    eventId = rest[0];
    if (eventId === undefined || eventId.startsWith("-")) {
      return err(
        CalendarArgsErrors.withUsage({ error: CalendarArgsErrors.argumentMissing({ name: "<event-id>" }), usage }),
      );
    }
    tail = rest.slice(1);
  }
  const takesForm = verb !== "cancel";
  const parsed = parseFlagTail({
    rest: tail,
    spec: { boolean: ["json"], value: takesForm ? ["form", "home"] : ["home"] },
  });
  if (parsed.isErr()) {
    return err(
      CalendarArgsErrors.withUsage({ error: CalendarArgsErrors.flagsInvalid({ reasons: parsed.error }), usage }),
    );
  }
  const formSource = parsed.value.values["form"];
  if (takesForm && formSource === undefined) {
    return err(CalendarArgsErrors.withUsage({ error: CalendarArgsErrors.formMissing(), usage }));
  }
  return ok({
    eventId,
    formSource,
    home: parsed.value.values["home"],
    json: parsed.value.flags.has("json"),
    verb,
  });
}

/**
 * Parse the `calendar commit` tail: one leading intent id, then flags.
 *
 * @param rest the argv tail after `calendar commit`
 * @returns the validated request, or every reason it was refused
 */
export function parseCalendarCommitArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<CalendarCommitArgs, CalendarArgsError> {
  const intentId = rest[0];
  if (intentId === undefined || intentId.startsWith("-")) {
    const error = CalendarArgsErrors.argumentMissing({ name: "<intent-id>" });
    return err(CalendarArgsErrors.withUsage({ error, usage: WRITE_USAGE.commit }));
  }
  const parsed = parseFlagTail({
    rest: rest.slice(1),
    spec: { boolean: ["json"], value: ["anchor", "approve", "home"] },
  });
  if (parsed.isErr()) {
    const error = CalendarArgsErrors.flagsInvalid({ reasons: parsed.error });
    return err(CalendarArgsErrors.withUsage({ error, usage: WRITE_USAGE.commit }));
  }
  const digest = parsed.value.values["approve"];
  const anchor = parsed.value.values["anchor"];
  if (digest !== undefined && anchor !== undefined) {
    return err(CalendarArgsErrors.withUsage({ error: CalendarArgsErrors.approvalTwice(), usage: WRITE_USAGE.commit }));
  }
  let approval: CalendarCommitApproval | undefined;
  if (digest !== undefined) {
    approval = { digest, kind: "digest" };
  } else if (anchor !== undefined) {
    approval = { anchor, kind: "anchor" };
  }
  return ok({
    approval,
    home: parsed.value.values["home"],
    intentId,
    json: parsed.value.flags.has("json"),
  });
}
