/**
 * What the Google Calendar write guard judges in one mutation, and the verdict over it. Pure: the effectful half —
 * loading the policy from a home and refusing before anything is sent — is `./writePrivacy.ts`, called by every
 * mutation `../../live/calendar/writeApi.ts` makes.
 *
 * ## What is judged
 *
 * Every string leaf of the event body an insert or a patch sends, at any depth, with ONE key skipped: the body's
 * top-level `id`, which the door mints from the intent id as an idempotency key and which no author writes — and only
 * while it has the door-minted shape ({@link DOOR_MINTED_EVENT_ID}); any other top-level `id` is judged. An `id`
 * deeper down (an extended property, say) is authored and judged. An attendee's email is content, not destination:
 * Google shows the participant list to every other participant, so one person's address reaches all the others.
 *
 * Outside the body nothing is judged — the calendar id, the event id, the ETag, `sendUpdates` and
 * `conferenceDataVersion` are a destination, a selector, a concurrency token and two protocol switches. A delete has
 * no body, so it has no leaves; `./writePrivacy.ts` still loads the policy for it, so a broken terms file refuses a
 * cancellation as it refuses a booking.
 *
 * The walker judges VALUES, never object keys, so a custom extended-property key name is not read: the stated
 * residue, the same one every other transport carries.
 *
 * ## Where it goes
 *
 * Strict ({@link CALENDAR_DESTINATION}). An invitation, an attendee change, a cancellation or an RSVP reaches people
 * outside the installation's organisation, and a personal grant gives no fact saying every invitee is inside it, so a
 * forbidden identifier refuses here as it does on a public surface.
 */
import type { calendar_v3 } from "@googleapis/calendar";

import {
  checkPrivacy,
  type PrivacyDestination,
  type PrivacyFinding,
  type PrivacyPolicy,
  UNASSESSED_PERSONAL_MATERIAL,
} from "../privacyCheck.js";
import { payloadLeaves } from "../writePrivacyLeaves.js";

/** The three mutations the Calendar door makes, named as the provider-call labels name them. */
export type CalendarWriteOperation = "calendar.events.insert" | "calendar.events.patch" | "calendar.events.delete";

/** One string the guard judges, and the locus a refusal names it by. */
export interface CalendarWriteLeaf {
  readonly locus: string;
  readonly text: string;
}

/**
 * The one shape of a top-level event `id` the guard skips: the door's own, a UUID's 32 hex digits with the hyphens
 * dropped (`../../live/calendar/write.ts`'s `addressedEventId`). The skip keys on that SHAPE rather than trusting the
 * intent file, which `intentStore.ts` reads as any string, so an id an operator edited in is judged like any text.
 */
const DOOR_MINTED_EVENT_ID = /^[0-9a-f]{32}$/u;

/** The destination every Calendar write is judged under: strict, with no repository and no installation identifiers. */
export const CALENDAR_DESTINATION: PrivacyDestination = {
  identifierAudience: "strict",
  installationIdentifiers: undefined,
  ownRepository: undefined,
};

/**
 * Every string one mutation's event body would send, each under its locus; none for a delete.
 *
 * @param operation the mutation, which a locus names first
 * @param body the event body as sent, or undefined for a delete
 * @returns the leaves in walk order, a door-minted top-level `id` left out
 */
export function calendarWriteLeaves({
  operation,
  body,
}: {
  operation: CalendarWriteOperation;
  body: calendar_v3.Schema$Event | undefined;
}): readonly CalendarWriteLeaf[] {
  if (body === undefined) {
    return [];
  }
  const doorMinted = typeof body.id === "string" && DOOR_MINTED_EVENT_ID.test(body.id);
  return payloadLeaves({
    path: "",
    skipKey: ({ key, depth }) => doorMinted && depth === 0 && key === "id",
    value: body,
  }).map(({ path, text }) => ({ locus: `calendar ${operation} ${path}`, text }));
}

/**
 * Judge every leaf of one mutation against the outbound privacy check, strictly.
 *
 * @param leaves the mutation's leaves
 * @param policy the denylist, identifier rules and private terms the check reads
 * @returns every finding, leaf by leaf in walk order; empty when the mutation may be sent
 */
export function calendarWriteFindings({
  leaves,
  policy,
}: {
  leaves: readonly CalendarWriteLeaf[];
  policy: PrivacyPolicy;
}): readonly PrivacyFinding[] {
  return leaves.flatMap(
    (leaf) =>
      checkPrivacy({
        content: leaf,
        destination: CALENDAR_DESTINATION,
        personalMaterial: UNASSESSED_PERSONAL_MATERIAL,
        policy,
      }).findings,
  );
}
