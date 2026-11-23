/**
 * The PURE `outlook-calendar` argument parsers (`cli/commands/outlookCalendar/core.ts`): the default window starts
 * at the clock the shell passes, `--from` takes a bare day or an instant, and every bound is refused before a
 * credential is read.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import {
  DEFAULT_EVENT_LIMIT,
  DEFAULT_WINDOW_DAYS,
  parseOutlookCalendarCalendarsArgs,
  parseOutlookCalendarListArgs,
  parseOutlookCalendarReadArgs,
} from "../../../../../cli/commands/outlookCalendar/core.js";

/** The clock every case passes. */
const NOW = "2001-01-08T09:15:00.000Z";

describe("parseOutlookCalendarListArgs", () => {
  it("reads the default calendar for a week from now, fifty events, as text", () => {
    expect(unwrap(parseOutlookCalendarListArgs({ nowIso: NOW, rest: [] }))).toEqual({
      calendarId: undefined,
      endIso: "2001-01-15T09:15:00.000Z",
      home: undefined,
      json: false,
      limit: DEFAULT_EVENT_LIMIT,
      startIso: NOW,
    });
    expect(DEFAULT_WINDOW_DAYS).toBe(7);
  });

  it("reads a bare --from day as that day's UTC midnight, and every other flag", () => {
    const parsed = parseOutlookCalendarListArgs({
      nowIso: NOW,
      rest: ["--from", "2001-02-01", "--days", "3", "--limit", "10", "--calendar", "cal-1", "--json", "--home", "/h"],
    });
    expect(unwrap(parsed)).toEqual({
      calendarId: "cal-1",
      endIso: "2001-02-04T00:00:00.000Z",
      home: "/h",
      json: true,
      limit: 10,
      startIso: "2001-02-01T00:00:00.000Z",
    });
  });

  it("reads an ISO --from instant as itself", () => {
    const parsed = parseOutlookCalendarListArgs({ nowIso: NOW, rest: ["--from", "2001-02-01T10:00:00+10:00"] });
    expect(unwrap(parsed).startIso).toBe("2001-02-01T00:00:00.000Z");
  });

  it("refuses a --days or --limit outside its bounds, naming the flag", () => {
    expect(unwrapErr(parseOutlookCalendarListArgs({ nowIso: NOW, rest: ["--days", "0"] })).message).toBe(
      "--days must be a whole number from 1 to 90 (got 0)",
    );
    expect(unwrapErr(parseOutlookCalendarListArgs({ nowIso: NOW, rest: ["--days", "91"] })).message).toBe(
      "--days must be a whole number from 1 to 90 (got 91)",
    );
    expect(unwrapErr(parseOutlookCalendarListArgs({ nowIso: NOW, rest: ["--limit", "1.5"] })).message).toBe(
      "--limit must be a whole number from 1 to 1000 (got 1.5)",
    );
  });

  it("refuses a --from that is neither a day nor an instant", () => {
    expect(unwrapErr(parseOutlookCalendarListArgs({ nowIso: NOW, rest: ["--from", "tuesday"] })).message).toBe(
      "--from must be a YYYY-MM-DD day or an ISO instant (got tuesday)",
    );
  });

  it("refuses a flag the verb does not take", () => {
    expect(unwrapErr(parseOutlookCalendarListArgs({ nowIso: NOW, rest: ["--query", "x"] })).code).toBe("FLAGS_INVALID");
  });
});

describe("parseOutlookCalendarReadArgs", () => {
  it("takes one event id, then flags", () => {
    expect(unwrap(parseOutlookCalendarReadArgs({ rest: ["event-1", "--json"] }))).toEqual({
      eventId: "event-1",
      home: undefined,
      json: true,
    });
  });

  it("refuses a read with no id", () => {
    expect(unwrapErr(parseOutlookCalendarReadArgs({ rest: [] })).code).toBe("ARGUMENT_MISSING");
  });
});

describe("parseOutlookCalendarCalendarsArgs", () => {
  it("takes only --json and --home", () => {
    expect(unwrap(parseOutlookCalendarCalendarsArgs({ rest: ["--json"] }))).toEqual({ home: undefined, json: true });
  });
});
