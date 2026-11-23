/**
 * Who is on a calendar event as Google holds it: the owner's own entry, everyone else by address, and the
 * entries nobody can name. The outward verdict in `writePlan.ts` is decided from these, so each one reads a
 * Google snapshot and never a form. Pure — no I/O.
 */
import type { calendar_v3 } from "@googleapis/calendar";

/**
 * One attendee's address, lowercased. Google can return an entry with no `email` at all, and an attendee
 * nobody can name is not one this door will reason about, so it reads as absent rather than as `""`.
 *
 * @returns the lowercased address, or undefined when the entry carries none
 */
export function addressOf({ attendee }: { attendee: { email?: string | null } }): string | undefined {
  const email = attendee.email;
  return typeof email === "string" && email.length > 0 ? email.toLowerCase() : undefined;
}

/**
 * Whether an attendee or organiser entry IS the bound account.
 *
 * Google's own `self` flag is read FIRST, and the address comparison is the fallback rather than the rule.
 * An account reached through an alias or a delegated address carries that alias in `email` while Google
 * still marks the entry `self: true` on its own copy of the event — so an address-only test reads the
 * owner's own solo event as "organised by someone else" and holds an inward write for an approval nobody
 * owes.
 *
 * **`self` is calendar-relative, not an identity assertion**, which is exactly why it is only trusted here:
 * it means "this entry is the owner of the calendar this copy was read from", and every write this door
 * makes reads from and writes to the bound account's own `primary` (enforced by
 * `assertWriteTargetIsOwnPrimary` at prepare, commit and apply). Under that precondition the flag
 * answers the question being asked; without it, it would only say whose copy was read. Never trust a `self`
 * a CLI form supplied — every entry read here comes from a Google snapshot.
 *
 * @returns true iff Google marks the entry as the owner's or its address is the bound account's
 */
export function isOwnerEntry({
  entry,
  account,
}: {
  entry: { email?: string | null; self?: boolean | null };
  account: string;
}): boolean {
  return entry.self === true || addressOf({ attendee: entry }) === account.toLowerCase();
}

/**
 * The guest entries on an event as Google holds it. Google omits `attendees` from an event nobody was invited
 * to (the recorded window listing carries the key only on events with guests), and a booking has no event
 * yet: either way nobody is on it.
 *
 * @param event the event as Google holds it, absent for a booking
 * @returns the attendee entries, empty when there are none
 */
export function guestsOn({
  event,
}: {
  event: calendar_v3.Schema$Event | undefined;
}): readonly calendar_v3.Schema$EventAttendee[] {
  const attendees = event?.attendees;
  if (attendees == null) {
    return [];
  }
  return attendees;
}

/**
 * The organiser entry on an event as Google holds it, as a list of at most one so it joins the guest entries.
 * `organizer` is read-only and missing from a cancelled event that carries little more than its id, and a
 * booking has no event yet: either way there is no organiser entry to read.
 *
 * @param event the event as Google holds it, absent for a booking
 * @returns the organiser entry, or none
 */
export function organiserOn({
  event,
}: {
  event: calendar_v3.Schema$Event | undefined;
}): readonly NonNullable<calendar_v3.Schema$Event["organizer"]>[] {
  if (event === undefined) {
    return [];
  }
  const { organizer } = event;
  if (organizer == null) {
    return [];
  }
  return [organizer];
}

/**
 * Everyone but the owner on an event, lowercased and sorted.
 *
 * @returns the addresses, without the owner's own entry and without any entry that carries no address
 */
export function othersOn({
  event,
  account,
}: {
  event: calendar_v3.Schema$Event | undefined;
  account: string;
}): readonly string[] {
  return guestsOn({ event })
    .filter((attendee) => !isOwnerEntry({ account, entry: attendee }))
    .map((attendee) => addressOf({ attendee }))
    .filter((email): email is string => email !== undefined)
    .toSorted();
}

/**
 * How many entries on the event this door could not NAME — an attendee or organiser Google returned with no
 * address at all, and which `self` does not claim for the owner.
 *
 * Counted rather than dropped, because dropping is fail-OPEN: an unnamed attendee vanished from
 * {@link othersOn}, took no part in the outward verdict, and a write that reaches a person nobody can name
 * was applied as though it reached nobody. Sitting beside `attendeesOmitted`, which is the same class in
 * Google's own words, it holds instead.
 *
 * @returns the count of unnamed non-owner attendees, plus one for an unnamed non-owner organiser
 */
export function unnamedOn({
  event,
  account,
}: {
  event: calendar_v3.Schema$Event | undefined;
  account: string;
}): number {
  // `organizer` is read-only and nullable, and a cancelled event may carry nothing but its id: none, none unnamed.
  const organiser = event?.organizer;
  const attendees = guestsOn({ event }).filter(
    (attendee) => !isOwnerEntry({ account, entry: attendee }) && addressOf({ attendee }) === undefined,
  );
  const organiserUnnamed =
    organiser != null &&
    !isOwnerEntry({ account, entry: organiser }) &&
    addressOf({ attendee: organiser }) === undefined;
  return attendees.length + (organiserUnnamed ? 1 : 0);
}
