/**
 * The two calendar writes this door REFUSES outright, decided from the event as Google holds it: one that
 * declines other people's invitations on the owner's behalf, and one addressed to a recurring series. Both are
 * refusals rather than holds for the same reason — a hold previews what a write sends and whom it reaches, and
 * for these two nothing here can. `writePlan.ts` asks before it builds anything.
 *
 * Pure: no I/O, no clock.
 */
import type { calendar_v3 } from "@googleapis/calendar";

import { type CalendarError, CalendarErrors } from "./errors.js";

/** The declining mode an out-of-office event carries, when it declines anything on the owner's behalf. */
function outOfOfficeDecliningMode({
  properties,
}: {
  properties: calendar_v3.Schema$EventOutOfOfficeProperties | undefined;
}): string | undefined {
  // Google sends this block only on an `outOfOffice` event, so an event of any other type has none to read.
  if (properties == null) {
    return undefined;
  }
  // The mode is optional on the block: an out-of-office entry with no policy set declines nothing.
  if (properties.autoDeclineMode == null) {
    return undefined;
  }
  // `declineNone` is Google's own spelling of "declines nothing", and an empty mode names no policy either.
  if (properties.autoDeclineMode === "declineNone" || properties.autoDeclineMode === "") {
    return undefined;
  }
  return properties.autoDeclineMode;
}

/** The declining mode a focus-time event carries, when it declines anything on the owner's behalf. */
function focusTimeDecliningMode({
  properties,
}: {
  properties: calendar_v3.Schema$EventFocusTimeProperties | undefined;
}): string | undefined {
  // Google sends this block only on a `focusTime` event, so an event of any other type has none to read.
  if (properties == null) {
    return undefined;
  }
  // The mode is optional on the block: a focus-time entry with no policy set declines nothing.
  if (properties.autoDeclineMode == null) {
    return undefined;
  }
  // `declineNone` is Google's own spelling of "declines nothing", and an empty mode names no policy either.
  if (properties.autoDeclineMode === "declineNone" || properties.autoDeclineMode === "") {
    return undefined;
  }
  return properties.autoDeclineMode;
}

/**
 * The automatic-decline policy on an out-of-office or focus-time event, when it is not `declineNone`.
 *
 * This is the one way a calendar write reaches other people that the attendee list cannot show. Google's
 * own `Events` resource documents that an event carrying `declineAllConflictingInvitations` (or the
 * new-conflicts-only variant) DECLINES overlapping invitations on the owner's behalf and sends the
 * organiser a message Google composes. So moving such a block onto somebody else's meeting mails a refusal
 * this door never wrote and cannot preview.
 *
 * An event carries at most one of the two blocks — its `eventType` names one or the other — so each is read
 * on its own, and EITHER one declining is enough: a snapshot carrying both, which Google does not send, is
 * read fail-closed rather than letting one block's silence hide the other's mode.
 *
 * @param event the event as Google holds it, absent for a booking
 * @returns the mode, or undefined when the event declines nothing on the owner's behalf
 */
function autoDeclineModeOf({ event }: { event: calendar_v3.Schema$Event | undefined }): string | undefined {
  // A booking has no snapshot, so nothing on the diary can decline anything yet.
  if (event === undefined) {
    return undefined;
  }
  const outOfOffice = outOfOfficeDecliningMode({ properties: event.outOfOfficeProperties });
  if (outOfOffice !== undefined) {
    return outOfOffice;
  }
  return focusTimeDecliningMode({ properties: event.focusTimeProperties });
}

/**
 * Whether this event is the MASTER of a recurring series rather than one occurrence.
 *
 * A master carries the `recurrence` rule; an occurrence read by its own id carries `recurringEventId` and
 * no rule of its own, which is Google's discriminator rather than this repo's. The distinction is a rail:
 * a write addressed to a master applies to the whole series — a cancel removes it from every invitee's
 * calendar — and the exceptions inside that series can carry guests the MASTER's own attendee list does not
 * name, so one snapshot cannot establish who the write reaches.
 *
 * @param event the event as Google holds it, absent for a booking
 * @returns true iff the event carries a recurrence rule of its own
 */
function isRecurringMaster({ event }: { event: calendar_v3.Schema$Event | undefined }): boolean {
  // A booking has no snapshot, and a meeting not yet on the diary heads no series.
  if (event === undefined) {
    return false;
  }
  // Google leaves `recurrence` off a single event and off an occurrence alike: neither carries a rule.
  if (event.recurrence == null) {
    return false;
  }
  return event.recurrence.length > 0;
}

/**
 * Why the event as Google holds it is not one this door will write, whatever the form asks for.
 *
 * @param event the event as Google holds it, absent for a booking
 * @returns the typed refusal, or undefined when the snapshot rules nothing out
 */
export function snapshotRefusal({ event }: { event: calendar_v3.Schema$Event | undefined }): CalendarError | undefined {
  const autoDeclining = autoDeclineModeOf({ event });
  if (autoDeclining !== undefined) {
    return CalendarErrors.invalidWrite({
      problems: [
        `this event automatically declines other people's invitations (autoDeclineMode ${autoDeclining}), so ` +
          "moving or changing it sends refusals Google composes and this door never sees — it is not one this " +
          "door will write. Change it in Google Calendar itself",
      ],
    });
  }
  if (isRecurringMaster({ event })) {
    return CalendarErrors.invalidWrite({
      problems: [
        "this id names a recurring SERIES, not one meeting, and a write here applies to every occurrence — " +
          "including exceptions whose own guests this read cannot see, so who it reaches cannot be " +
          "established. Address the occurrence instead: `calendar list` prints each instance's own id",
      ],
    });
  }
  return undefined;
}
