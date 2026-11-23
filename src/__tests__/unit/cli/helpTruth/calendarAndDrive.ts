/**
 * The help-truth tables' rows for `calendar` and `drive` — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import {
  CALENDAR_FLAG_NAMES,
  parseCalendarCalendarsArgs,
  parseCalendarConnectArgs,
  parseCalendarFreeArgs,
  parseCalendarListArgs,
  parseCalendarReadArgs,
} from "../../../../cli/commands/calendar/core.js";
import { calendarErrorLines } from "../../../../cli/commands/calendar/errors.js";
import { parseCalendarPrepDueArgs } from "../../../../cli/commands/calendar/prepDueArgs.js";
import {
  CALENDAR_WRITE_FLAG_NAMES,
  parseCalendarCommitArgs,
  parseCalendarWriteArgs,
} from "../../../../cli/commands/calendar/writeCore.js";
import {
  DRIVE_FLAG_NAMES,
  parseDriveConnectArgs,
  parseDriveDrivesArgs,
  parseDriveListArgs,
  parseDriveReadArgs,
} from "../../../../cli/commands/drive/core.js";
import { driveErrorLines } from "../../../../cli/commands/drive/errors.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags } from "./sharedProbes.js";

/** The instant `calendar list`'s probes resolve their default window against. Fixed, so probes are stable. */
const CALENDAR_PROBE_NOW = new Date("2026-09-05T00:00:00.000Z");

/** An event id and an empty form: what a `calendar edit|reschedule|respond` probe carries ahead of its fragment. */
const CALENDAR_EVENT_FORM_PROBE: readonly string[] = ["6h1s9r0k4p2m8n3q", "--form", "{}"];

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "calendar book": CALENDAR_WRITE_FLAG_NAMES["book"],
  "calendar calendars": CALENDAR_FLAG_NAMES["calendars"]!,
  "calendar cancel": CALENDAR_WRITE_FLAG_NAMES["cancel"],
  "calendar commit": CALENDAR_WRITE_FLAG_NAMES["commit"],
  "calendar connect": CALENDAR_FLAG_NAMES["connect"]!,
  "calendar edit": CALENDAR_WRITE_FLAG_NAMES["edit"],
  "calendar free": CALENDAR_FLAG_NAMES["free"]!,
  "calendar list": CALENDAR_FLAG_NAMES["list"]!,
  "calendar prep-due": CALENDAR_FLAG_NAMES["prep-due"]!,
  "calendar read": CALENDAR_FLAG_NAMES["read"]!,
  "calendar reschedule": CALENDAR_WRITE_FLAG_NAMES["reschedule"],
  "calendar respond": CALENDAR_WRITE_FLAG_NAMES["respond"],
  "drive connect": DRIVE_FLAG_NAMES["connect"]!,
  "drive drives": DRIVE_FLAG_NAMES["drives"]!,
  "drive list": DRIVE_FLAG_NAMES["list"]!,
  "drive read": DRIVE_FLAG_NAMES["read"]!,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "calendar book": {
    "--form": ["--form", "{}"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "calendar calendars": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "calendar cancel": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "calendar commit": {
    "--anchor": ["--anchor", "talk:t1"],
    "--approve": ["--approve", "0123456789abcdef"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "calendar connect": {
    "--grant": ["--grant", "events"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--revoke": ["--revoke"],
    "--status": ["--status"],
  },
  "calendar free": {
    "--between": ["--between", "09:00-17:00"],
    "--days": ["--days", "5"],
    "--from": ["--from", "2026-09-14"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--minutes": ["--minutes", "30"],
    "--to": ["--to", "2026-09-18"],
    "--with": ["--with", "colleague@example.com"],
    "--zone": ["--zone", "Australia/Melbourne"],
  },
  "calendar list": {
    "--calendar": ["--calendar", "primary"],
    "--days": ["--days", "14"],
    "--from": ["--from", "2026-09-01"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
    "--to": ["--to", "2026-09-30"],
  },
  "calendar prep-due": {
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--hours": ["--hours", "6"],
    "--json": ["--json"],
  },
  "calendar read": {
    "--calendar": ["--calendar", "primary"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "calendar edit": {
    "--form": ["--form", "{}"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "calendar reschedule": {
    "--form": ["--form", "{}"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "calendar respond": {
    "--form": ["--form", "{}"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "drive connect": {
    "--grant": ["--grant", "read"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--revoke": ["--revoke"],
    "--status": ["--status"],
  },
  "drive drives": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "drive list": {
    "--drive": ["--drive", "0ADriveIdHere"],
    "--folder": ["--folder", "1FolderIdHere"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
    "--query": ["--query", "name contains 'budget'"],
    "--trashed": ["--trashed"],
  },
  "drive read": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--metadata-only": ["--metadata-only"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  // The three read verbs take an injected clock, because `calendar list`'s default window is a statement
  // about now. A fixed instant keeps the probe's window bounds stable rather than moving with the suite.
  "calendar calendars": ({ fragment }) =>
    parseCalendarCalendarsArgs({ rest: [...fragment] }).mapErr((error) => calendarErrorLines({ error })),
  "calendar connect": ({ fragment }) =>
    parseCalendarConnectArgs({ rest: [...fragment] }).mapErr((error) => calendarErrorLines({ error })),
  // `--minutes` is required, so the probe supplies it the way `calendar read` supplies its id.
  "calendar free": ({ fragment }) =>
    parseCalendarFreeArgs({
      now: CALENDAR_PROBE_NOW,
      rest: dedupeFlags({ base: ["--minutes", "30"], fragment }),
    }).mapErr((error) => calendarErrorLines({ error })),
  "calendar list": ({ fragment }) =>
    parseCalendarListArgs({ now: CALENDAR_PROBE_NOW, rest: [...fragment] }).mapErr((error) =>
      calendarErrorLines({ error }),
    ),
  "calendar prep-due": ({ fragment }) =>
    parseCalendarPrepDueArgs({ now: CALENDAR_PROBE_NOW, rest: [...fragment] }).mapErr((error) =>
      calendarErrorLines({ error }),
    ),
  "calendar read": ({ fragment }) =>
    parseCalendarReadArgs({ rest: ["6h1s9r0k4p2m8n3q", ...fragment] }).mapErr((error) => calendarErrorLines({ error })),
  // Every write verb but `book` takes a leading event id, and `commit` a leading intent id, so each probe
  // supplies one the way `calendar read` does. `--form` is required wherever a form exists, so the probes
  // that need one carry it ahead of the fragment under test.
  "calendar book": ({ fragment }) =>
    parseCalendarWriteArgs({ rest: dedupeFlags({ base: ["--form", "{}"], fragment }), verb: "book" }).mapErr((error) =>
      calendarErrorLines({ error }),
    ),
  "calendar cancel": ({ fragment }) =>
    parseCalendarWriteArgs({ rest: ["6h1s9r0k4p2m8n3q", ...fragment], verb: "cancel" }).mapErr((error) =>
      calendarErrorLines({ error }),
    ),
  "calendar commit": ({ fragment }) =>
    parseCalendarCommitArgs({ rest: ["3f2b1c9d-0a4e-4f6b-9c1d-7e8a5b2c4d6f", ...fragment] }).mapErr((error) =>
      calendarErrorLines({ error }),
    ),
  "calendar edit": ({ fragment }) =>
    parseCalendarWriteArgs({ rest: dedupeFlags({ base: CALENDAR_EVENT_FORM_PROBE, fragment }), verb: "edit" }).mapErr(
      (error) => calendarErrorLines({ error }),
    ),
  "calendar reschedule": ({ fragment }) =>
    parseCalendarWriteArgs({
      rest: dedupeFlags({ base: CALENDAR_EVENT_FORM_PROBE, fragment }),
      verb: "reschedule",
    }).mapErr((error) => calendarErrorLines({ error })),
  "calendar respond": ({ fragment }) =>
    parseCalendarWriteArgs({
      rest: dedupeFlags({ base: CALENDAR_EVENT_FORM_PROBE, fragment }),
      verb: "respond",
    }).mapErr((error) => calendarErrorLines({ error })),
  "drive connect": ({ fragment }) =>
    parseDriveConnectArgs({ rest: [...fragment] }).mapErr((error) => driveErrorLines({ error })),
  "drive drives": ({ fragment }) =>
    parseDriveDrivesArgs({ rest: [...fragment] }).mapErr((error) => driveErrorLines({ error })),
  "drive list": ({ fragment }) =>
    parseDriveListArgs({ rest: [...fragment] }).mapErr((error) => driveErrorLines({ error })),
  // `read` needs an address to be valid at all, so the probe supplies one and each fragment is appended
  // AFTER it — probing `--json` alone would otherwise fail on "missing <file-id-or-url>" rather than on
  // the flag under test.
  "drive read": ({ fragment }) =>
    parseDriveReadArgs({ rest: ["1AbCdEfGhIjK", ...fragment] }).mapErr((error) => driveErrorLines({ error })),
};

/** The rows for `calendar` and `drive`. */
export const calendarAndDriveSlice: HelpTruthSlice = { guarded, probes, parsers };
