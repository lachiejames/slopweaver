/**
 * Unit: the `outlook-calendar` shells (`cli/commands/outlookCalendar/readRun.ts`) driven whole — parser, session,
 * domain read, renderer — over a plain fake session. A refused argv never reaches the session, a session that
 * cannot bind prints its reason and exits 1, and a read prints text or `--json`.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "#lib/result.js";
import {
  type OutlookCalendarShellDeps,
  runOutlookCalendarCalendars,
  runOutlookCalendarList,
  runOutlookCalendarReadEvent,
} from "../../../../../cli/commands/outlookCalendar/readRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { OutlookErrors } from "../../../../../live/outlook/errors.js";
import type { OutlookCalendarApi } from "../../../../../live/outlookCalendar/api.js";

/** A diary with one calendar and one timed event on it. */
const API: OutlookCalendarApi = {
  getEvent: async () =>
    ok({
      calendar: { id: "cal-main" },
      end: { dateTime: "2001-01-08T08:00:00", timeZone: "UTC" },
      id: "event-1",
      start: { dateTime: "2001-01-08T07:00:00", timeZone: "UTC" },
      subject: "Planning",
    }),
  listCalendarView: async () =>
    ok({
      items: [
        {
          end: { dateTime: "2001-01-08T08:00:00", timeZone: "UTC" },
          id: "event-1",
          start: { dateTime: "2001-01-08T07:00:00", timeZone: "UTC" },
          subject: "Planning",
        },
      ],
      nextLink: undefined,
    }),
  listCalendars: async () =>
    ok({ items: [{ canEdit: true, id: "cal-main", isDefaultCalendar: true, name: "Calendar" }], nextLink: undefined }),
  listEvents: async () => ok({ items: [], nextLink: undefined }),
};

/** Shell effects over {@link API} (or a refusing session), recording what was printed and which homes bound. */
function shell({ bind = true }: { bind?: boolean } = {}): {
  deps: OutlookCalendarShellDeps;
  out: string[];
  warn: string[];
  homes: string[];
} {
  const out: string[] = [];
  const warn: string[] = [];
  const homes: string[] = [];
  return {
    deps: {
      home: () => "/ambient-home",
      nowIso: () => "2001-01-08T00:00:00.000Z",
      out: (line) => {
        out.push(line);
      },
      session: async ({ home }) => {
        homes.push(home);
        return bind ? ok(API) : err(OutlookErrors.notConnected({ product: "calendar" }));
      },
      warn: (line) => {
        warn.push(line);
      },
    },
    homes,
    out,
    warn,
  };
}

describe("outlook-calendar calendars", () => {
  it("lists the calendars against the ambient home", async () => {
    const run = shell();
    expect(await runOutlookCalendarCalendars({ deps: run.deps, rest: [] })).toBe(EXIT_OK);
    expect(run.homes).toEqual(["/ambient-home"]);
    expect(run.out).toEqual(["Calendar (default)\n  id: cal-main"]);
  });
});

describe("outlook-calendar list", () => {
  it("prints the window, its events and its residue", async () => {
    const run = shell();
    expect(await runOutlookCalendarList({ deps: run.deps, rest: ["--days", "1"] })).toBe(EXIT_OK);
    expect(run.out[0]!.split("\n").slice(0, 3)).toEqual([
      "1 event(s) on default, 2001-01-08T00:00:00.000Z to 2001-01-09T00:00:00.000Z",
      "- 2001-01-08T07:00:00Z  Planning",
      "    id: event-1",
    ]);
  });

  it("refuses a bad flag before the session binds", async () => {
    const run = shell();
    expect(await runOutlookCalendarList({ deps: run.deps, rest: ["--days", "0"] })).toBe(EXIT_USAGE);
    expect(run.homes).toEqual([]);
    expect(run.warn[0]).toBe("--days must be a whole number from 1 to 90 (got 0)");
  });

  it("prints the session's refusal and exits 1 when the grant cannot bind", async () => {
    const run = shell({ bind: false });
    expect(await runOutlookCalendarList({ deps: run.deps, rest: ["--home", "/named"] })).toBe(EXIT_ERROR);
    expect(run.homes).toEqual(["/named"]);
    expect(run.warn).toEqual([
      "no Outlook Calendar grant stored for this home — run `slopweaver outlook-calendar connect`",
    ]);
    expect(run.out).toEqual([]);
  });
});

describe("outlook-calendar read", () => {
  it("prints the event as JSON, labelled with its calendar", async () => {
    const run = shell();
    expect(await runOutlookCalendarReadEvent({ deps: run.deps, rest: ["event-1", "--json"] })).toBe(EXIT_OK);
    const printed = JSON.parse(run.out[0]!) as { calendarId: string; summary: string };
    expect([printed.calendarId, printed.summary]).toEqual(["cal-main", "Planning"]);
  });
});
