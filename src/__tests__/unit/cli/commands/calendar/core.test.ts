/**
 * Unit: `calendar` argument parsing — the layer that must refuse before any credential or socket is touched.
 *
 * The window arithmetic gets most of the attention because it carries the one silently-wrong outcome in
 * this door: `--to` is INCLUSIVE to a reader and EXCLUSIVE to Google, and getting it wrong drops the last
 * day of every window without failing anything.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WINDOW_DAYS,
  MAX_WINDOW_DAYS,
  parseCalendarCalendarsArgs,
  parseCalendarConnectArgs,
  parseCalendarFreeArgs,
  parseCalendarListArgs,
  parseCalendarReadArgs,
  resolveWindow,
} from "../../../../../cli/commands/calendar/core.js";
import { CalendarArgsErrors, calendarErrorLines } from "../../../../../cli/commands/calendar/errors.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { MAX_LIST_LIMIT } from "../../../../../live/calendar/read.js";
import { CALENDAR_SCOPE_TABLE, CALENDAR_SCOPES } from "../../../../../live/calendar/scopes.js";
import { scopesToRequest } from "../../../../../live/google/scopes.js";

/** A fixed clock, mid-afternoon UTC, so "today" cannot be read as "this instant". */
const NOW = new Date("2026-09-05T14:30:00.000Z");

describe("parseCalendarConnectArgs", () => {
  it("defaults to the read grant — events, the calendar list and the time zone", () => {
    const args = unwrap(parseCalendarConnectArgs({ rest: [] }));
    expect(scopesToRequest({ capabilities: args.capabilities, table: CALENDAR_SCOPE_TABLE })).toStrictEqual([
      CALENDAR_SCOPES.identity,
      CALENDAR_SCOPES.events,
      CALENDAR_SCOPES.calendars,
      CALENDAR_SCOPES.settings,
    ]);
  });

  it("narrows to events only under --grant events", () => {
    const args = unwrap(parseCalendarConnectArgs({ rest: ["--grant", "events"] }));
    expect(scopesToRequest({ capabilities: args.capabilities, table: CALENDAR_SCOPE_TABLE })).toStrictEqual([
      CALENDAR_SCOPES.identity,
      CALENDAR_SCOPES.events,
    ]);
  });

  it("adds exactly one write scope under --grant meetings — calendar.events.owned, nothing wider", () => {
    const args = unwrap(parseCalendarConnectArgs({ rest: ["--grant", "meetings"] }));
    expect(scopesToRequest({ capabilities: args.capabilities, table: CALENDAR_SCOPE_TABLE })).toStrictEqual([
      CALENDAR_SCOPES.identity,
      CALENDAR_SCOPES.events,
      CALENDAR_SCOPES.calendars,
      CALENDAR_SCOPES.settings,
      CALENDAR_SCOPES.ownedEvents,
    ]);
  });

  it("refuses an unknown --grant and names the ones it takes", () => {
    const problems = unwrapErr(parseCalendarConnectArgs({ rest: ["--grant", "write"] }));
    expect(problems.message).toContain("unknown --grant: write");
    expect(problems.message).toContain("read | events | meetings");
  });

  it("carries --status through, which is what keeps a status check off the consent path", () => {
    expect(unwrap(parseCalendarConnectArgs({ rest: ["--status"] })).statusOnly).toBe(true);
  });
});

describe("parseCalendarCalendarsArgs", () => {
  it("takes --json and --home and nothing else", () => {
    const args = unwrap(parseCalendarCalendarsArgs({ rest: ["--json", "--home", "/tmp/h"] }));
    expect(args.json).toBe(true);
    expect(args.home).toBe("/tmp/h");
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    const error = unwrapErr(parseCalendarCalendarsArgs({ rest: ["--limit", "5"] }));
    expect(error.code).toBe("FLAGS_INVALID");
    expect(calendarErrorLines({ error })[0]).toBe("unknown flag: --limit");
  });
});

describe("resolveWindow", () => {
  it("defaults to today's UTC midnight plus the default span", () => {
    const window = unwrap(resolveWindow({ days: undefined, from: undefined, now: NOW, to: undefined }));
    expect(window.timeMinIso).toBe("2026-09-05T00:00:00.000Z");
    expect(window.timeMaxIso).toBe("2026-09-12T00:00:00.000Z");
    expect(DEFAULT_WINDOW_DAYS).toBe(7);
  });

  it("treats --to as INCLUSIVE by asking Google for the day after it", () => {
    const window = unwrap(resolveWindow({ days: undefined, from: "2026-09-01", now: NOW, to: "2026-09-01" }));
    expect(window.timeMinIso).toBe("2026-09-01T00:00:00.000Z");
    expect(window.timeMaxIso).toBe("2026-09-02T00:00:00.000Z");
  });

  it("lets --to override --days rather than combining them", () => {
    const window = unwrap(resolveWindow({ days: "30", from: "2026-09-01", now: NOW, to: "2026-09-03" }));
    expect(window.timeMaxIso).toBe("2026-09-04T00:00:00.000Z");
  });

  it("refuses a --to before --from instead of returning an empty window", () => {
    const problems = unwrapErr(resolveWindow({ days: undefined, from: "2026-09-10", now: NOW, to: "2026-09-01" }));
    expect(problems.message).toContain("is before --from");
  });

  it("refuses a --from that is not a date", () => {
    expect(unwrapErr(resolveWindow({ days: undefined, from: "yesterday", now: NOW, to: undefined })).message).toContain(
      "--from must be a YYYY-MM-DD date",
    );
  });

  it("refuses a --days beyond the stated bound", () => {
    const problems = unwrapErr(
      resolveWindow({ days: String(MAX_WINDOW_DAYS + 1), from: undefined, now: NOW, to: undefined }),
    );
    expect(problems.message).toContain(`between 1 and ${String(MAX_WINDOW_DAYS)}`);
  });

  it("refuses a zero-day window rather than reading it as the default", () => {
    const error = unwrapErr(resolveWindow({ days: "0", from: undefined, now: NOW, to: undefined }));
    expect(error).toEqual(CalendarArgsErrors.daysOutOfRange({ got: "0", max: MAX_WINDOW_DAYS }));
    expect(error.message).toBe(`--days must be an integer between 1 and ${String(MAX_WINDOW_DAYS)}`);
  });
});

describe("parseCalendarListArgs", () => {
  it("defaults to the primary calendar when none is named", () => {
    expect(unwrap(parseCalendarListArgs({ now: NOW, rest: [] })).calendarIds).toStrictEqual(["primary"]);
  });

  it("keeps EVERY --calendar, in the order they were written", () => {
    const args = unwrap(parseCalendarListArgs({ now: NOW, rest: ["--calendar", "a@x.test", "--calendar=b@x.test"] }));
    expect(args.calendarIds).toStrictEqual(["a@x.test", "b@x.test"]);
  });

  it("refuses a --limit above the maximum", () => {
    expect(unwrapErr(parseCalendarListArgs({ now: NOW, rest: ["--limit", "501"] })).message).toContain(
      "between 1 and 500",
    );
  });

  it("refuses a non-integer --limit", () => {
    const error = unwrapErr(parseCalendarListArgs({ now: NOW, rest: ["--limit", "ten"] }));
    expect(error.code).toBe("INVALID_FLAG_VALUE");
    expect(calendarErrorLines({ error })).toEqual([
      `--limit must be an integer between 1 and ${String(MAX_LIST_LIMIT)}`,
      "usage: slopweaver calendar list [--calendar <id>]... [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>] " +
        "[--days <1..1100>] [--limit <1..500>] [--json] [--home <dir>]\n" +
        "  Lists the events in one window, recurring events expanded into instances, ordered by start\n" +
        "  --calendar a calendar id (repeatable); defaults to `primary`, the account's own\n" +
        "  --from     the window's first day, inclusive (default today)\n" +
        "  --to       the window's last day, inclusive; overrides --days\n" +
        "  --days     how many days forward from --from (default 7)\n" +
        "  --limit    how many events to gather in total (default 50, maximum 500)",
    ]);
  });

  it("carries the window flags through to the resolved instants", () => {
    const args = unwrap(parseCalendarListArgs({ now: NOW, rest: ["--from", "2026-10-01", "--days", "2"] }));
    expect(args.timeMinIso).toBe("2026-10-01T00:00:00.000Z");
    expect(args.timeMaxIso).toBe("2026-10-03T00:00:00.000Z");
  });
});

describe("parseCalendarReadArgs", () => {
  it("takes the event id positionally and defaults the calendar to primary", () => {
    const args = unwrap(parseCalendarReadArgs({ rest: ["evt-1"] }));
    expect(args.eventId).toBe("evt-1");
    expect(args.calendarId).toBe("primary");
  });

  it("refuses a missing id, having read nothing", () => {
    expect(unwrapErr(parseCalendarReadArgs({ rest: [] })).message).toBe("missing <event-id>");
  });

  it("refuses a flag where the id should be, rather than reading the flag as an id", () => {
    expect(unwrapErr(parseCalendarReadArgs({ rest: ["--json"] })).message).toBe("missing <event-id>");
  });

  it("takes an explicit --calendar", () => {
    expect(unwrap(parseCalendarReadArgs({ rest: ["evt-1", "--calendar", "team@x.test"] })).calendarId).toBe(
      "team@x.test",
    );
  });
});

describe("parseCalendarFreeArgs", () => {
  it("always consults primary first, then every --with in order, deduplicated", () => {
    const args = unwrap(
      parseCalendarFreeArgs({
        now: NOW,
        rest: ["--minutes", "30", "--with", "b@x.test", "--with", "a@x.test", "--with", "b@x.test"],
      }),
    );
    expect(args.calendarIds).toStrictEqual(["primary", "b@x.test", "a@x.test"]);
    expect(args.minutes).toBe(30);
    expect(args.between).toBeUndefined();
    expect(args.zone).toBeUndefined();
  });

  it("refuses a missing --minutes, having read nothing", () => {
    const problems = unwrapErr(parseCalendarFreeArgs({ now: NOW, rest: [] }));
    expect(problems.message).toContain("--minutes is required");
  });

  it("refuses a --minutes above the bound and a non-integer one", () => {
    expect(unwrapErr(parseCalendarFreeArgs({ now: NOW, rest: ["--minutes", "481"] })).message).toContain(
      "between 1 and 480",
    );
    expect(unwrapErr(parseCalendarFreeArgs({ now: NOW, rest: ["--minutes", "1.5"] })).message).toContain(
      "between 1 and 480",
    );
  });

  it("reads --between as daily hours and refuses a backwards or malformed one", () => {
    expect(
      unwrap(parseCalendarFreeArgs({ now: NOW, rest: ["--minutes", "30", "--between", "09:00-17:30"] })).between,
    ).toStrictEqual({
      endMinute: 1050,
      startMinute: 540,
    });
    expect(
      unwrapErr(parseCalendarFreeArgs({ now: NOW, rest: ["--minutes", "30", "--between", "17:00-09:00"] })).message,
    ).toContain("--between must be HH:MM-HH:MM");
    expect(
      unwrapErr(parseCalendarFreeArgs({ now: NOW, rest: ["--minutes", "30", "--between", "9-5"] })).message,
    ).toContain("--between must be HH:MM-HH:MM");
  });

  it("refuses a --with that is not an address", () => {
    expect(
      unwrapErr(parseCalendarFreeArgs({ now: NOW, rest: ["--minutes", "30", "--with", "tobias"] })).message,
    ).toContain("--with must be an email address: tobias");
  });

  it("carries the window flags and --zone through", () => {
    const args = unwrap(
      parseCalendarFreeArgs({
        now: NOW,
        rest: ["--minutes", "45", "--from", "2026-09-14", "--days", "2", "--zone", "Australia/Melbourne"],
      }),
    );
    expect(args.timeMinIso).toBe("2026-09-14T00:00:00.000Z");
    expect(args.timeMaxIso).toBe("2026-09-16T00:00:00.000Z");
    expect(args.zone).toBe("Australia/Melbourne");
  });
});

describe("calendarErrorLines", () => {
  it("prints each collected reason on its own line, then the verb's usage — what the verb always printed", () => {
    const error = unwrapErr(parseCalendarFreeArgs({ now: NOW, rest: ["--with", "tobias"] }));
    expect(error.code).toBe("ARGUMENTS_REFUSED");
    const lines = calendarErrorLines({ error });
    expect(lines.slice(0, 2)).toStrictEqual([
      "--minutes is required and must be an integer between 1 and 480",
      "--with must be an email address: tobias",
    ]);
    expect(lines.length).toBe(3);
    expect(lines[2]).toContain("usage: slopweaver calendar free");
  });

  it("prints a single refusal as one line, then the usage", () => {
    const lines = calendarErrorLines({ error: unwrapErr(parseCalendarReadArgs({ rest: [] })) });
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe("missing <event-id>");
    expect(lines[1]).toContain("usage: slopweaver calendar read");
  });
});
