/**
 * Which Google scope each Calendar verb needs — the Calendar door's own vocabulary, read by the shared
 * helpers in `src/live/google/scopes.ts`.
 *
 * ## Why `events` is a capability of its own and not a convenience
 *
 * `calendar.events.readonly` reads the events on a calendar you already know the id of, and **cannot
 * enumerate which calendars exist**. `calendar.readonly` can. That is the sharpest line the Calendar API
 * draws, and it is worth making a person choose on the consent screen: an install that only ever answers
 * "what is on my own diary" never has to grant an application sight of every calendar the account
 * subscribes to. So `calendar connect --grant events` is a genuinely useful narrow grant rather than a
 * token gesture, and it is why `list` and `read` demand only `events` while `calendars` demands the wider
 * one.
 *
 * `calendar.readonly` subsumes `calendar.events.readonly` — Google's rule, not this repo's — so an install
 * that approved the wider grant is never told to re-consent for the narrower one.
 *
 * `calendar.settings.readonly` is what carries the account's own TIME ZONE, and it matters more than it
 * looks: an all-day event has no zone of its own, so without the account's the only honest thing a reader
 * can say about "Tuesday" is which date Google called it.
 *
 * `freebusy` is the one capability with three satisfying scopes and no grant of its own: `calendar free`
 * needs `freebusy.query`, which Google admits under `calendar.freebusy`, `calendar.events.freebusy` or the
 * `calendar.readonly` this door already asks for. So `--grant read` unlocks it with nothing extra, and
 * `--grant events` refuses it by name — `calendar.events.readonly` reads a calendar's events and cannot ask
 * whether an hour is free, which is Google's line rather than this repo's.
 *
 * ## The ONE write scope, and why it is `calendar.events.owned`
 *
 * The owner's calendar is the primary one: no secondary calendar is created and no one else's calendar is
 * edited. `ownedEvents` is
 * `calendar.events.owned` — create, change and cancel events on calendars the account OWNS — and nothing
 * wider: not `calendar.events` (every calendar the owner can write to, shared team ones included), not `calendar`
 * (everything), and not `calendar.app.created`, which is declined by name. "Primary only" is narrower than
 * the scope (it covers an owned secondary too) and is enforced by the write verbs, not by the credential.
 * The per-method admission table is in the installed SDK's own typings: `node_modules/@googleapis/calendar/
 * build/v3.d.ts` lists it on every `events.*` mutation.
 *
 * Pure: no I/O, no clock.
 */
import type { GoogleScopeTable } from "../google/scopes.js";

/** The Calendar capability a verb needs. One capability maps to exactly one scope URI. */
export type CalendarCapability = "events" | "calendars" | "settings" | "identity" | "freebusy" | "ownedEvents";

/** The scope URI granted for each capability. */
export const CALENDAR_SCOPES: Readonly<Record<CalendarCapability, string>> = {
  calendars: "https://www.googleapis.com/auth/calendar.readonly",
  events: "https://www.googleapis.com/auth/calendar.events.readonly",
  freebusy: "https://www.googleapis.com/auth/calendar.freebusy",
  identity: "https://www.googleapis.com/auth/userinfo.email",
  ownedEvents: "https://www.googleapis.com/auth/calendar.events.owned",
  settings: "https://www.googleapis.com/auth/calendar.settings.readonly",
} as const;

/** The Calendar door's scope vocabulary, in the shape every shared grant helper reads. */
export const CALENDAR_SCOPE_TABLE: GoogleScopeTable<CalendarCapability> = {
  identity: "identity",
  /**
   * `calendar.readonly` reads events and answers free/busy too; nothing implies the calendar list, the
   * settings, or identity. `calendar.events.freebusy` is Google's other availability-only scope, accepted
   * here so a grant approved elsewhere under it is never told to re-consent.
   */
  impliedBy: {
    calendars: [],
    events: [CALENDAR_SCOPES.calendars],
    freebusy: [CALENDAR_SCOPES.calendars, "https://www.googleapis.com/auth/calendar.events.freebusy"],
    identity: [],
    // Nothing this door ever asks for implies a write; a grant that reads is never told it can book.
    ownedEvents: [],
    settings: [],
  },
  scopes: CALENDAR_SCOPES,
};

/** The capability each Calendar verb needs — the single place a verb's minimum grant is declared. */
export const VERB_CAPABILITIES: Readonly<Record<string, readonly CalendarCapability[]>> = {
  // Every write reads the event back (`events`) and changes it (`ownedEvents`); the credential is what stops
  // a read-only install before any form is read.
  book: ["events", "ownedEvents"],
  // The one verb that enumerates calendars, and the only reason this door ever asks for `calendar.readonly`.
  calendars: ["calendars"],
  cancel: ["events", "ownedEvents"],
  commit: ["events", "ownedEvents"],
  edit: ["events", "ownedEvents"],
  // Availability across calendars. Satisfied by the read grant's `calendar.readonly`; never by `events`.
  free: ["freebusy"],
  list: ["events"],
  read: ["events"],
  reschedule: ["events", "ownedEvents"],
  respond: ["events", "ownedEvents"],
} as const;
