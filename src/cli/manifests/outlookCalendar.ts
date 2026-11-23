/**
 * Lazy manifest for the `outlook-calendar` noun — the Microsoft calendar door, over the same personal-account
 * grant as `outlook`.
 *
 * All three verbs are reads (`external-read`): nothing here changes the diary, so none is `doorRouted`. Every
 * parser refuses a malformed tail before a credential is read (`../commands/outlookCalendar/core.ts`), so every
 * verb is `parseRejectIsIoFree`; `read` with no id refuses on the parser alone, so it is also `dryParseSafe`.
 */
import {
  OUTLOOK_CALENDAR_CALENDARS_USAGE,
  OUTLOOK_CALENDAR_LIST_USAGE,
  OUTLOOK_CALENDAR_READ_USAGE,
} from "../commands/outlookCalendar/outlookCalendarUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** Every `outlook-calendar` verb. */
export const outlookCalendarManifest: Readonly<Record<string, VerbManifestEntry>> = {
  calendars: lazy({
    load: () => import("../commands/outlookCalendar/readRun.js").then((m) => m.outlookCalendarCalendarsCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: false,
      effect: "external-read",
      example: "slopweaver outlook-calendar calendars",
      parseRejectIsIoFree: true,
      summary: "List the Outlook account's calendars, default first, with the id `list --calendar` takes",
      usage: OUTLOOK_CALENDAR_CALENDARS_USAGE,
    },
  }),
  list: lazy({
    load: () => import("../commands/outlookCalendar/readRun.js").then((m) => m.outlookCalendarListCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: false,
      effect: "external-read",
      example: "slopweaver outlook-calendar list --from 2001-01-08 --days 7",
      parseRejectIsIoFree: true,
      summary: "What is on in one window of one Outlook calendar, recurring events expanded, with its residue",
      usage: OUTLOOK_CALENDAR_LIST_USAGE,
    },
  }),
  read: lazy({
    load: () => import("../commands/outlookCalendar/readRun.js").then((m) => m.outlookCalendarReadCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver outlook-calendar read AAMkAGI2-example-event-id",
      parseRejectIsIoFree: true,
      summary: "Read one Outlook event in full: body, attendees with their replies, and its rule when it repeats",
      usage: OUTLOOK_CALENDAR_READ_USAGE,
    },
  }),
};
