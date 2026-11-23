/**
 * The PURE half of a calendar write: a typed intent in, the exact mutation Google will receive out — plus
 * the two facts the door decides on, whether the change reaches anyone but the owner and the digest an
 * approval must match.
 *
 * ## A calendar event is not a Gmail draft
 *
 * `gmail send` reads the draft back from Gmail and digests THAT, because the draft holds everything the
 * server will deliver. A meeting not yet booked has no such object, and creating a placeholder on the diary
 * to imitate one would already change the diary (it blocks the hour, fires reminders, shows to anyone who
 * reads the calendar). So the thing held for approval is a LOCAL INTENT — the validated form plus, for an
 * existing event, the event exactly as Google holds it now with its ETag — and the digest covers all of it:
 * account, calendar, event id, the operation, the exact body that will reach the SDK, the attendee set
 * before and after, and whether attendees are told. For a new booking the preview says plainly that it
 * shows proposed content; for a change it shows Google's read-back values.
 *
 * ## Outward is decided from BEFORE and AFTER, and fails closed
 *
 * Anyone but the owner on the event after the change, anyone REMOVED by it, a room, an organiser who is not
 * the owner, or an attendee list Google truncated (`attendeesOmitted`) — any of those makes the write
 * outward. Only a change that provably reaches nobody goes straight through. A `respond` is always outward:
 * the organiser sees the RSVP.
 *
 * Pure: no I/O, no clock, no network.
 */
import { createHash } from "node:crypto";

import type { calendar_v3 } from "@googleapis/calendar";

import { err, ok, type Result } from "../../lib/result.js";
import type { CalendarWriteForm } from "../../outbound/calendar/form.js";
import { canonicalJson } from "./canonicalJson.js";
import { type CalendarError, CalendarErrors } from "./errors.js";
import { keptOrNewGuest, spanToEventTimes } from "./eventBody.js";
import { addressOf, guestsOn, isOwnerEntry, organiserOn, othersOn, unnamedOn } from "./eventPeople.js";
import type { CalendarMutation, OutwardVerdict } from "./planShapes.js";
import { snapshotRefusal } from "./snapshotRails.js";
import type { SendUpdates } from "./writeApi.js";

/** How many hex characters of the SHA-256 an approval carries — the same width `gmail send` uses. */
const DIGEST_WIDTH = 16;

/** A pending write, exactly as the intent store holds it. */
export interface CalendarIntent {
  readonly version: 1;
  readonly intentId: string;
  readonly createdAtIso: string;
  readonly account: string;
  readonly calendarId: string;
  readonly form: CalendarWriteForm;
  /** The event addressed — an existing one, or for a booking the id this door chose so a retry is a 409. */
  readonly eventId: string;
  /** The event as Google held it when the intent was prepared; absent for a booking. */
  readonly before: { readonly etag: string; readonly event: calendar_v3.Schema$Event } | undefined;
  readonly state: "pending" | "applied" | "uncertain";
  /**
   * The digest of the plan the preview printed, stored at prepare. A commit on the owner's `--anchor` sends only when the
   * plan rebuilt NOW still digests to this, so the owner's yes binds the change the owner was shown. Absent on an intent written
   * before it was stored, which an anchored commit refuses.
   */
  readonly previewDigest?: string;
  /**
   * Where and when the owner said yes, on an intent committed on the owner's `--anchor` — never the words. The applied intent is
   * the receipt of what was sent, so it carries the authority it was sent on, and an over-read is findable.
   */
  readonly approvedBy?: { readonly anchor: string; readonly atIso: string };
}

/** A write ready for the door: what Google will receive, and what the approval is bound to. */
export interface CalendarWritePlan {
  readonly intent: CalendarIntent;
  readonly mutation: CalendarMutation;
  readonly sendUpdates: SendUpdates;
  readonly conferenceDataVersion: 0 | 1;
  readonly outward: OutwardVerdict;
  /** Everyone but the owner on the event before and after, lowercased and sorted. */
  readonly attendeesBefore: readonly string[];
  readonly attendeesAfter: readonly string[];
  readonly digest: string;
  readonly residue: readonly string[];
}

/**
 * The digest an approval must match, over exactly the fields that decide what reaches Google and whom.
 *
 * @internal — exported so the digest's own sensitivity is asserted directly rather than through a plan.
 *
 * @param plan the plan without its digest
 * @returns the first sixteen hex characters of the SHA-256 over the canonical JSON
 */
export function writeDigest({ plan }: { plan: Omit<CalendarWritePlan, "digest" | "residue" | "outward"> }): string {
  const canonical = canonicalJson({
    value: {
      account: plan.intent.account,
      attendeesAfter: plan.attendeesAfter,
      attendeesBefore: plan.attendeesBefore,
      calendarId: plan.intent.calendarId,
      conferenceDataVersion: plan.conferenceDataVersion,
      eventId: plan.intent.eventId,
      kind: plan.intent.form.kind,
      mutation: plan.mutation,
      sendUpdates: plan.sendUpdates,
    },
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, DIGEST_WIDTH);
}

/** The attendee objects for a set of addresses, keeping the existing entry (and its RSVP) where one stands. */
function attendeeObjects({
  addresses,
  existing,
  account,
}: {
  addresses: readonly string[];
  existing: readonly calendar_v3.Schema$EventAttendee[];
  account: string;
}): calendar_v3.Schema$EventAttendee[] {
  const byEmail = new Map(existing.map((attendee) => [addressOf({ attendee }), attendee] as const));
  // The owner's own entry is found by the SAME predicate the classification uses, never by address alone:
  // under an alias the address lookup missed it, so the rewritten set dropped the owner from their own meeting and
  // discarded the RSVP on that entry.
  const self = existing.find((attendee) => isOwnerEntry({ account, entry: attendee }));
  const others = addresses.map((email) => keptOrNewGuest({ byEmail, email }));
  return self === undefined ? others : [self, ...others];
}

/** The reasons the event as Google holds it makes a write outward, whatever the form asks for. */
function reasonsFromSnapshot({ intent }: { intent: CalendarIntent }): readonly string[] {
  const before = intent.before?.event;
  const account = intent.account;
  const unnamed = unnamedOn({ account, event: before });
  // `organizer` is read-only and nullable, and a cancelled event may carry nothing but its id: then there is none.
  const organiser = before?.organizer;
  const organiserAddress = organiser == null ? undefined : addressOf({ attendee: organiser });
  const foreignOrganiser =
    organiser != null && organiserAddress !== undefined && !isOwnerEntry({ account, entry: organiser });
  const hasRoom = guestsOn({ event: before }).some((attendee) => attendee.resource === true);
  return [
    ...(before?.attendeesOmitted === true
      ? ["Google omitted attendees from the read, so who this reaches cannot be established"]
      : []),
    ...(unnamed > 0
      ? [
          `${unnamed} ${unnamed === 1 ? "person on the event has" : "people on the event have"} no address this door can read, so who this reaches cannot be established`,
        ]
      : []),
    ...(foreignOrganiser ? [`the organiser is ${organiserAddress}, not you`] : []),
    ...(hasRoom ? ["a room or resource is on the event"] : []),
  ];
}

/** The reasons the CHANGE itself reaches somebody — who leaves the event, and who is on it afterwards. */
function reasonsFromChange({
  intent,
  attendeesBefore,
  attendeesAfter,
}: {
  intent: CalendarIntent;
  attendeesBefore: readonly string[];
  attendeesAfter: readonly string[];
}): readonly string[] {
  const removed = attendeesBefore.filter((email) => !attendeesAfter.includes(email));
  const cancelling = intent.form.kind === "cancel";
  return [
    ...(removed.length > 0 ? [`removes ${removed.join(", ")}`] : []),
    ...(cancelling && attendeesBefore.length > 0
      ? [`tells ${attendeesBefore.join(", ")} the meeting is cancelled`]
      : []),
    ...(!cancelling && attendeesAfter.length > 0 ? [`reaches ${attendeesAfter.join(", ")}`] : []),
  ];
}

/**
 * Decide whether a write reaches anyone but the owner, naming every reason.
 *
 * Split three ways — the form's own kind, what the SNAPSHOT says, and what the CHANGE does — because every
 * reason is independent and all of them are reported, so the only thing the whole has to do is concatenate.
 *
 * @param intent the pending write
 * @param attendeesBefore everyone but the owner on the event before
 * @param attendeesAfter everyone but the owner on the event after
 * @returns the verdict, outward whenever any reason holds
 */
export function classifyOutward({
  intent,
  attendeesBefore,
  attendeesAfter,
}: {
  intent: CalendarIntent;
  attendeesBefore: readonly string[];
  attendeesAfter: readonly string[];
}): OutwardVerdict {
  const reasons = [
    ...(intent.form.kind === "respond" ? ["your RSVP is seen by the organiser"] : []),
    ...reasonsFromSnapshot({ intent }),
    ...reasonsFromChange({ attendeesAfter, attendeesBefore, intent }),
  ];
  return { outward: reasons.length > 0, reasons };
}

/** The body an `edit` sends: only the named fields, attendees as a whole set when given. */
function editBody({
  intent,
  attendeesAfter,
}: {
  intent: CalendarIntent & { form: { kind: "edit" } };
  attendeesAfter: readonly string[];
}): calendar_v3.Schema$Event {
  const { form } = intent;
  return {
    ...(form.title !== undefined ? { summary: form.title } : {}),
    ...(form.description !== undefined ? { description: form.description } : {}),
    ...(form.location !== undefined ? { location: form.location } : {}),
    ...(form.attendees !== undefined
      ? {
          attendees: attendeeObjects({
            account: intent.account,
            addresses: attendeesAfter,
            existing: guestsOn({ event: intent.before?.event }),
          }),
        }
      : {}),
  };
}

/** The body a `respond` sends: the whole attendee list with the owner's own entry answered. */
function respondBody({ intent }: { intent: CalendarIntent & { form: { kind: "respond" } } }): calendar_v3.Schema$Event {
  const account = intent.account;
  const existing = guestsOn({ event: intent.before?.event });
  // Found by the shared predicate, so an alias entry is ANSWERED rather than joined by a second, duplicate
  // entry under the bound address — which is what an address-only lookup did, leaving Google two of the owner.
  const mine = ownEntry({ account, existing });
  const answered = {
    ...mine,
    responseStatus: intent.form.response,
    ...(intent.form.comment !== undefined ? { comment: intent.form.comment } : {}),
  };
  return { attendees: [answered, ...existing.filter((attendee) => !isOwnerEntry({ account, entry: attendee }))] };
}

/**
 * The owner's own entry, the one a `respond` answers. When the snapshot carries no entry that is the owner — they were
 * invited through a group, or the event reached them some other way — there is nothing of theirs to keep, so
 * the owner answers as a fresh entry under the bound address, marked as the calendar's own.
 */
function ownEntry({
  account,
  existing,
}: {
  account: string;
  existing: readonly calendar_v3.Schema$EventAttendee[];
}): calendar_v3.Schema$EventAttendee {
  const found = existing.find((attendee) => isOwnerEntry({ account, entry: attendee }));
  if (found === undefined) {
    return { email: account, self: true };
  }
  return found;
}

/** The body a `book` sends, with the door-chosen id and the Meet request when asked. */
function bookBody({
  intent,
  zone,
  attendeesAfter,
}: {
  intent: CalendarIntent & { form: { kind: "book" } };
  zone: string;
  attendeesAfter: readonly string[];
}): calendar_v3.Schema$Event {
  const { form } = intent;
  return {
    id: intent.eventId,
    summary: form.title,
    ...(form.description !== undefined ? { description: form.description } : {}),
    ...(form.location !== undefined ? { location: form.location } : {}),
    ...spanToEventTimes({ span: form.span, zone }),
    ...(attendeesAfter.length > 0 ? { attendees: attendeesAfter.map((email) => ({ email })) } : {}),
    ...(form.meet
      ? {
          conferenceData: {
            createRequest: { conferenceSolutionKey: { type: "hangoutsMeet" }, requestId: intent.intentId },
          },
        }
      : {}),
  };
}

/**
 * Build the plan for an intent: the exact mutation, the outward verdict and the digest.
 *
 * @param intent the pending write, with its `before` snapshot for anything but a booking
 * @param zone the account's zone, for a span that names none
 * @returns the plan, or the typed reason none can be made
 */
export function buildCalendarWritePlan({
  intent,
  zone,
}: {
  intent: CalendarIntent;
  zone: string;
}): Result<CalendarWritePlan, CalendarError> {
  const before = intent.before;
  if (intent.form.kind !== "book" && before === undefined) {
    const problem = `${intent.form.kind} needs the event as Google holds it, and none was read`;
    return err(CalendarErrors.invalidWrite({ problems: [problem] }));
  }
  const refusal = snapshotRefusal({ event: before?.event });
  if (refusal !== undefined) {
    return err(refusal);
  }
  const attendeesBefore = othersOn({ account: intent.account, event: before?.event });
  const attendeesAfter = attendeesAfterFor({ attendeesBefore, intent });
  const outward = classifyOutward({ attendeesAfter, attendeesBefore, intent });
  const mutation = mutationFor({ attendeesAfter, intent, zone });
  const conferenceDataVersion: 0 | 1 = intent.form.kind === "book" && intent.form.meet ? 1 : 0;
  const sendUpdates: SendUpdates = outward.outward ? "all" : "none";
  const partial = { attendeesAfter, attendeesBefore, conferenceDataVersion, intent, mutation, sendUpdates };
  return ok({
    ...partial,
    digest: writeDigest({ plan: partial }),
    outward,
    residue: planResidue({ intent, outward }),
  });
}

/** Everyone but the owner on the event once the intent is applied. */
function attendeesAfterFor({
  intent,
  attendeesBefore,
}: {
  intent: CalendarIntent;
  attendeesBefore: readonly string[];
}): readonly string[] {
  const { form } = intent;
  const me = intent.account.toLowerCase();
  if (form.kind === "book") {
    // A booking has no snapshot, so the bound address is the only thing an alias could be checked against.
    return form.attendees.filter((email) => email !== me).toSorted();
  }
  if (form.kind === "edit" && form.attendees !== undefined) {
    return form.attendees.filter((email) => !namesTheOwner({ address: email, intent })).toSorted();
  }
  if (form.kind === "cancel") {
    return [];
  }
  return attendeesBefore;
}

/**
 * Whether an address a FORM supplied is the owner, resolved against the Google snapshot rather than spelling.
 *
 * An edit sends the whole attendee set, and a caller writing that set out by hand naturally copies what
 * `calendar read` printed — which, under an alias, is the alias rather than the bound address. Matching on
 * the bound address alone then kept the alias in `attendeesAfter`, so the alias counted as an external guest
 * (a false outward hold) AND `attendeeObjects` prepended the same self entry a second time, sending Google
 * two of the owner. The snapshot is the only authority here: a `self` flag a form supplies is never read, and no
 * alias is ever inferred from how an address is spelled.
 *
 * @param address one lowercased address from the form's attendee list
 * @param intent the pending write, carrying the snapshot for every kind but a booking
 * @returns true iff that address is the bound account, or an entry Google marked as the owner
 */
function namesTheOwner({ address, intent }: { address: string; intent: CalendarIntent }): boolean {
  if (address === intent.account.toLowerCase()) {
    return true;
  }
  const entries = [...guestsOn({ event: intent.before?.event }), ...organiserOn({ event: intent.before?.event })];
  return entries.some(
    (entry) => addressOf({ attendee: entry }) === address && isOwnerEntry({ account: intent.account, entry }),
  );
}

/** The one SDK call for an intent. `before` is present for every kind but `book` by the caller's check. */
function mutationFor({
  intent,
  attendeesAfter,
  zone,
}: {
  intent: CalendarIntent;
  attendeesAfter: readonly string[];
  zone: string;
}): CalendarMutation {
  // Every kind but `book` carries a `before`, checked by `buildCalendarWritePlan` before this is reached;
  // a booking's insert never reads the ETag at all.
  const etag = intent.before?.etag;
  switch (intent.form.kind) {
    case "book":
      return { body: bookBody({ attendeesAfter, intent: { ...intent, form: intent.form }, zone }), kind: "insert" };
    case "edit":
      return {
        body: editBody({ attendeesAfter, intent: { ...intent, form: intent.form } }),
        etag: etag!,
        kind: "patch",
      };
    case "reschedule":
      return { body: spanToEventTimes({ span: intent.form.span, zone }), etag: etag!, kind: "patch" };
    case "respond":
      return { body: respondBody({ intent: { ...intent, form: intent.form } }), etag: etag!, kind: "patch" };
    case "cancel":
      return { etag: etag!, kind: "delete" };
    default: {
      const never: never = intent.form;
      return never;
    }
  }
}

/** The lines a preview owes: what the digest covers, what a hold means, what is proposed vs read back. */
function planResidue({ intent, outward }: { intent: CalendarIntent; outward: OutwardVerdict }): readonly string[] {
  return [
    intent.form.kind === "book"
      ? "this is PROPOSED content — nothing exists on the diary until it is applied"
      : "the current values are what Google holds now, read back with its ETag; the change is applied only if the event has not moved since",
    outward.outward
      ? `this reaches someone other than you (${outward.reasons.join("; ")}), so it HOLDS for the owner's yes — commit --anchor <where the owner said it>`
      : "this invites, drops and tells NO guest, so Google mails nobody about it and it is applied without approval, journalled at the door. Anyone your calendar is already shared with still sees it, and a subscriber who turned on new-event mail is still told by Google — that setting is theirs, not this write's",
    "the digest covers the account, calendar, event id, the operation, the exact body sent, and the attendees before and after; any change to those invalidates it",
    "an accepted write is what Google reported back, not a delivered invitation; Google mails attendees on its own schedule",
  ];
}
