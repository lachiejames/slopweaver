/**
 * Unit: the `outlook-calendar` crawl (`corpus/outlookCalendar/fetch.ts`) over a plain fake seam — full history
 * for a calendar with no anchor, a modified-time filter for one with an anchor, every page followed, a cap that
 * says it bit, and one calendar failing as a gap rather than a failed run.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import {
  crawlNotes,
  crawlOutlookCalendars,
  MODIFIED_OVERLAP_MS,
  modifiedSinceFor,
} from "../../../../corpus/outlookCalendar/fetch.js";
import type { OutlookCalendarSyncAnchors } from "../../../../corpus/outlookCalendar/syncAnchor.js";
import { fakeNextLink, fakeOutlookCalendarApi, timedEvent } from "./fakeOutlookCalendarApi.js";

const ANCHORED: OutlookCalendarSyncAnchors = {
  main: { modifiedThroughIso: "2001-01-10T12:00:00.000Z", recordedAtIso: "2001-01-10T12:05:00.000Z", version: 1 },
};

describe("modifiedSinceFor", () => {
  it("starts the overlap before the stored anchor", () => {
    expect(modifiedSinceFor({ anchors: ANCHORED, calendarId: "main", cursorOverridden: false })).toBe(
      "2001-01-10T11:55:00.000Z",
    );
    expect(MODIFIED_OVERLAP_MS).toBe(300_000);
  });

  it("reads a calendar with no anchor whole", () => {
    expect(modifiedSinceFor({ anchors: ANCHORED, calendarId: "other", cursorOverridden: false })).toBeUndefined();
  });

  it("reads every calendar whole when an explicit window overrides the cursor", () => {
    expect(modifiedSinceFor({ anchors: ANCHORED, calendarId: "main", cursorOverridden: true })).toBeUndefined();
  });

  it("reads a calendar whole when its stored anchor will not parse, rather than guessing an instant", () => {
    const anchors: OutlookCalendarSyncAnchors = {
      main: { modifiedThroughIso: "not a time", recordedAtIso: "2001-01-10T12:05:00.000Z", version: 1 },
    };
    expect(modifiedSinceFor({ anchors, calendarId: "main", cursorOverridden: false })).toBeUndefined();
  });
});

/** A clock that answers the next of a list of instants on each read, so the order of reads is observable. */
function ticking({ instants }: { instants: readonly string[] }): () => string {
  let read = 0;
  return () => {
    const instant = instants[read];
    read += 1;
    if (instant === undefined) {
      throw new Error("the crawl read the clock more often than once per calendar");
    }
    return instant;
  };
}

/** A clock that never moves, for the cases about something other than the fence. */
const clock = (): string => "2001-01-20T00:00:00.000Z";

describe("crawlOutlookCalendars", () => {
  it("fences each calendar's anchor at the clock read before its first page, never a stamp the pages carried", async () => {
    const { api } = fakeOutlookCalendarApi({
      calendars: [{ id: "main" }, { id: "shared" }],
      pages: {
        // A stamp far past the clock: an anchor taken from it would skip every edit made while paging.
        main: [[timedEvent({ id: "1", modifiedIso: "2001-03-01T00:00:00Z" })]],
        shared: [[timedEvent({ id: "2" })]],
      },
    });
    const crawled = unwrap(
      await crawlOutlookCalendars({
        anchors: {},
        api,
        cap: undefined,
        cursorOverridden: false,
        nowIso: ticking({ instants: ["2001-01-20T00:00:00.000Z", "2001-01-20T00:00:05.000Z"] }),
      }),
    );
    expect(crawled.pages.map((page) => [page.calendar.id, page.readStartedIso])).toEqual([
      ["main", "2001-01-20T00:00:00.000Z"],
      ["shared", "2001-01-20T00:00:05.000Z"],
    ]);
  });

  it("reads an unanchored calendar whole, following every page", async () => {
    const { api, eventRequests } = fakeOutlookCalendarApi({
      calendars: [{ id: "main", isDefaultCalendar: true, name: "Calendar" }],
      pages: { main: [[timedEvent({ id: "1" })], [timedEvent({ id: "2", modifiedIso: "2001-01-12T00:00:00Z" })]] },
    });
    const crawled = unwrap(
      await crawlOutlookCalendars({ anchors: {}, api, cap: undefined, cursorOverridden: false, nowIso: clock }),
    );
    expect(crawled.pages.map((page) => [page.calendar.id, page.mode, page.events.map((event) => event.id)])).toEqual([
      ["main", "full", ["1", "2"]],
    ]);
    expect(crawled.pages[0]!.readStartedIso).toBe("2001-01-20T00:00:00.000Z");
    expect(crawled.capped).toBe(false);
    expect(crawled.gaps).toEqual([]);
    expect(eventRequests).toEqual([
      { first: { calendarId: "main", modifiedSinceIso: undefined, top: 100 } },
      { link: fakeNextLink({ calendarId: "main", page: 1 }) },
    ]);
  });

  it("reads an anchored calendar by what changed since the anchor, less the overlap", async () => {
    const { api, eventRequests } = fakeOutlookCalendarApi({
      calendars: [{ id: "main", isDefaultCalendar: true }],
      pages: { main: [[timedEvent({ id: "1", modifiedIso: "2001-01-11T00:00:00Z" })]] },
    });
    const crawled = unwrap(
      await crawlOutlookCalendars({ anchors: ANCHORED, api, cap: undefined, cursorOverridden: false, nowIso: clock }),
    );
    expect(crawled.pages[0]!.mode).toBe("modified-since");
    expect(eventRequests).toEqual([
      { first: { calendarId: "main", modifiedSinceIso: "2001-01-10T11:55:00.000Z", top: 100 } },
    ]);
    expect(crawled.notes).toEqual([
      "1 calendar(s): 0 read whole, 1 read by what changed since the last pass",
      "an event deleted at Microsoft is not in a changed-since listing, so its record stays until a full pass (`refresh --source outlook-calendar --all`)",
    ]);
  });

  it("stops at the cap and says it bit when more was there to read", async () => {
    const { api, eventRequests } = fakeOutlookCalendarApi({
      calendars: [{ id: "main" }],
      pages: { main: [[timedEvent({ id: "1" }), timedEvent({ id: "2" })], [timedEvent({ id: "3" })]] },
    });
    const crawled = unwrap(
      await crawlOutlookCalendars({ anchors: {}, api, cap: { maxEvents: 1 }, cursorOverridden: false, nowIso: clock }),
    );
    expect(crawled.pages[0]!.events.map((event) => event.id)).toEqual(["1"]);
    expect(crawled.capped).toBe(true);
    expect(eventRequests.length).toBe(1);
  });

  it("does not call a cap bitten when the calendar held exactly that many", async () => {
    const { api } = fakeOutlookCalendarApi({
      calendars: [{ id: "main" }],
      pages: { main: [[timedEvent({ id: "1" }), timedEvent({ id: "2" })]] },
    });
    const crawled = unwrap(
      await crawlOutlookCalendars({ anchors: {}, api, cap: { maxEvents: 2 }, cursorOverridden: false, nowIso: clock }),
    );
    expect(crawled.capped).toBe(false);
  });

  it("records one calendar failing as a gap and still reads the others", async () => {
    const { api } = fakeOutlookCalendarApi({
      calendars: [{ id: "main" }, { id: "shared" }],
      failFor: new Set(["shared"]),
      pages: { main: [[timedEvent({ id: "1" })]] },
    });
    const crawled = unwrap(
      await crawlOutlookCalendars({ anchors: {}, api, cap: undefined, cursorOverridden: false, nowIso: clock }),
    );
    expect(crawled.pages.map((page) => page.calendar.id)).toEqual(["main"]);
    expect(crawled.gaps).toEqual(["calendar shared could not be read: no longer accessible"]);
  });

  it("fails the run when not even the calendar list can be read", async () => {
    const { api } = fakeOutlookCalendarApi({ calendars: [], listFails: true, pages: {} });
    const failed = await crawlOutlookCalendars({
      anchors: {},
      api,
      cap: undefined,
      cursorOverridden: false,
      nowIso: clock,
    });
    expect(unwrapErr(failed).message).toContain("calendar list refused");
  });
});

describe("crawlNotes", () => {
  it("says how many calendars were read whole, and nothing about deletions when none was read incrementally", () => {
    expect(crawlNotes({ calendars: 2, incremental: 0 })).toEqual([
      "2 calendar(s): 2 read whole, 0 read by what changed since the last pass",
    ]);
  });
});
