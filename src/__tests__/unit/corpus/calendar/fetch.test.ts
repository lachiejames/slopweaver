/**
 * Unit: the calendar crawl's lane choice and its coverage reporting, over a plain fake seam. What is
 * asserted is the part a run summary cannot re-derive: which calendars took the delta lane, and whether a
 * failure on one calendar cost the whole pass or only its own coverage.
 */
import type { calendar_v3 } from "@googleapis/calendar";
import { describe, expect, it } from "vitest";
import {
  crawlCalendars,
  crawlNotes,
  parameterFingerprint,
  rfc3339Bound,
  windowBounds,
} from "../../../../corpus/calendar/fetch.js";
import type { CalendarSyncAnchors } from "../../../../corpus/calendar/syncAnchor.js";
import type { ExportWindow } from "../../../../corpus/types.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { CalendarApi, CalendarSummary } from "../../../../live/calendar/api.js";
import { CalendarErrors } from "../../../../live/calendar/errors.js";

/** Day-shaped, exactly as the refresh planner hands it over — the shape Google refuses on `timeMin`. */
const WINDOW: ExportWindow = { since: "2026-06-07", until: "2026-09-05" };
const FINGERPRINT = parameterFingerprint({ showDeleted: true, singleEvents: false });

function calendar({ id, primary = false }: { id: string; primary?: boolean }): CalendarSummary {
  return {
    accessRole: "owner",
    description: undefined,
    id,
    primary,
    selected: true,
    summary: id,
    timeZone: "Australia/Sydney",
  };
}

/** Records which calendars were asked for with a sync token, so the lane choice is observable. */
function fakeApi({
  calendars,
  failFor = new Set<string>(),
  expireTokenFor = new Set<string>(),
  events = 1,
  sentTokens = new Map<string, string | undefined>(),
  sentBounds = new Map<string, { timeMinIso: string | undefined; timeMaxIso: string | undefined }>(),
}: {
  calendars: readonly CalendarSummary[];
  failFor?: ReadonlySet<string>;
  /** Calendars whose stored token Google has invalidated — a 410 on a token call, success by window. */
  expireTokenFor?: ReadonlySet<string>;
  events?: number;
  sentTokens?: Map<string, string | undefined>;
  sentBounds?: Map<string, { timeMinIso: string | undefined; timeMaxIso: string | undefined }>;
}): CalendarApi {
  return {
    getEvent: async () => ok({}),
    getTimeZone: async () => ok("Australia/Sydney"),
    listCalendars: async () => ok({ calendars, nextPageToken: undefined }),
    listEvents: async ({ calendarId, syncToken, timeMinIso, timeMaxIso }) => {
      sentTokens.set(calendarId, syncToken);
      sentBounds.set(calendarId, { timeMaxIso, timeMinIso });
      if (syncToken !== undefined && expireTokenFor.has(calendarId)) {
        return err(CalendarErrors.syncTokenExpired({ calendarId }));
      }
      if (failFor.has(calendarId)) {
        return err(CalendarErrors.apiFailed({ message: "no longer accessible" }));
      }
      const items: calendar_v3.Schema$Event[] = Array.from({ length: events }, (_, index) => ({
        id: `${calendarId}-${String(index)}`,
        start: { dateTime: "2026-09-01T00:00:00Z" },
      }));
      return ok({ events: items, nextPageToken: undefined, nextSyncToken: `next-${calendarId}`, timeZone: undefined });
    },
  };
}

const ANCHORS: CalendarSyncAnchors = {
  "me@example.test": { parameterFingerprint: FINGERPRINT, recordedAtIso: "x", syncToken: "tok-me" },
  "stale@example.test": { parameterFingerprint: "different", recordedAtIso: "x", syncToken: "tok-stale" },
};

describe("rfc3339Bound", () => {
  it("reads a day bound as UTC midnight and leaves an instant's value alone", () => {
    expect(rfc3339Bound({ bound: "2026-06-07" })).toBe("2026-06-07T00:00:00.000Z");
    expect(rfc3339Bound({ bound: "2026-09-16T10:42:13Z" })).toBe("2026-09-16T10:42:13.000Z");
  });

  it("passes an unparseable bound through so the provider names it", () => {
    expect(rfc3339Bound({ bound: "not-a-date" })).toBe("not-a-date");
  });
});

describe("windowBounds", () => {
  it("sends an ordinary window as two ascending instants and calls nothing inverted", () => {
    expect(windowBounds({ window: WINDOW })).toStrictEqual({
      inverted: false,
      timeMaxIso: "2026-09-05T00:00:00.000Z",
      timeMinIso: "2026-06-07T00:00:00.000Z",
    });
  });

  it("SWAPS a window whose since is after its until — Google answers a reversed pair with silence", () => {
    expect(windowBounds({ window: { since: "2027-09-05T23:30:00.000Z", until: "2026-09-17" } })).toStrictEqual({
      inverted: true,
      timeMaxIso: "2027-09-05T23:30:00.000Z",
      timeMinIso: "2026-09-17T00:00:00.000Z",
    });
  });

  it("leaves an empty window alone rather than calling equal bounds inverted", () => {
    expect(windowBounds({ window: { since: "2026-09-17", until: "2026-09-17" } })).toStrictEqual({
      inverted: false,
      timeMaxIso: "2026-09-17T00:00:00.000Z",
      timeMinIso: "2026-09-17T00:00:00.000Z",
    });
  });
});

describe("crawlCalendars", () => {
  it("resumes an anchored calendar by token and crawls an unanchored one by window", async () => {
    const sentTokens = new Map<string, string | undefined>();
    const crawled = unwrap(
      await crawlCalendars({
        anchors: ANCHORS,
        api: fakeApi({
          calendars: [calendar({ id: "me@example.test", primary: true }), calendar({ id: "new@example.test" })],
          sentTokens,
        }),
        cap: undefined,
        cursorOverridden: false,
        window: WINDOW,
      }),
    );
    expect(sentTokens.get("me@example.test")).toBe("tok-me");
    expect(sentTokens.get("new@example.test")).toBe(undefined);
    expect(crawled.pages.map((page) => page.lane)).toStrictEqual(["delta", "window"]);
  });

  it("sends the window lane RFC 3339 instants and the delta lane no bounds at all", async () => {
    const sentBounds = new Map<string, { timeMinIso: string | undefined; timeMaxIso: string | undefined }>();
    unwrap(
      await crawlCalendars({
        anchors: ANCHORS,
        api: fakeApi({
          calendars: [calendar({ id: "me@example.test", primary: true }), calendar({ id: "new@example.test" })],
          sentBounds,
        }),
        cap: undefined,
        cursorOverridden: false,
        window: WINDOW,
      }),
    );
    expect(sentBounds.get("new@example.test")).toStrictEqual({
      timeMaxIso: "2026-09-05T00:00:00.000Z",
      timeMinIso: "2026-06-07T00:00:00.000Z",
    });
    expect(sentBounds.get("me@example.test")).toStrictEqual({ timeMaxIso: undefined, timeMinIso: undefined });
  });

  it("DISCARDS a token whose fingerprint no longer matches, taking the window lane instead", async () => {
    const sentTokens = new Map<string, string | undefined>();
    const crawled = unwrap(
      await crawlCalendars({
        anchors: ANCHORS,
        api: fakeApi({ calendars: [calendar({ id: "stale@example.test" })], sentTokens }),
        cap: undefined,
        cursorOverridden: false,
        window: WINDOW,
      }),
    );
    expect(sentTokens.get("stale@example.test")).toBe(undefined);
    expect(crawled.pages[0]!.lane).toBe("window");
  });

  it("ignores every stored token when the caller named an explicit window", async () => {
    const sentTokens = new Map<string, string | undefined>();
    await crawlCalendars({
      anchors: ANCHORS,
      api: fakeApi({ calendars: [calendar({ id: "me@example.test" })], sentTokens }),
      cap: undefined,
      cursorOverridden: true,
      window: WINDOW,
    });
    expect(sentTokens.get("me@example.test")).toBe(undefined);
  });

  it("reports ONE failing calendar as a warning and a gap, and still reads the others", async () => {
    const crawled = unwrap(
      await crawlCalendars({
        anchors: {},
        api: fakeApi({
          calendars: [calendar({ id: "me@example.test" }), calendar({ id: "gone@example.test" })],
          failFor: new Set(["gone@example.test"]),
        }),
        cap: undefined,
        cursorOverridden: false,
        window: WINDOW,
      }),
    );
    expect(crawled.pages.map((page) => page.calendar.id)).toStrictEqual(["me@example.test"]);
    expect(crawled.warnings[0]).toContain("gone@example.test");
    expect(crawled.gaps).toStrictEqual(["calendar gone@example.test could not be read this pass"]);
  });

  it("sends ASCENDING bounds even when the planned window runs backwards, and says it reordered them", async () => {
    const sentBounds = new Map<string, { timeMinIso: string | undefined; timeMaxIso: string | undefined }>();
    const crawled = unwrap(
      await crawlCalendars({
        anchors: {},
        api: fakeApi({ calendars: [calendar({ id: "new@example.test" })], sentBounds }),
        cap: undefined,
        cursorOverridden: false,
        window: { since: "2027-09-05T23:30:00.000Z", until: "2026-09-17" },
      }),
    );
    expect(sentBounds.get("new@example.test")).toStrictEqual({
      timeMaxIso: "2027-09-05T23:30:00.000Z",
      timeMinIso: "2026-09-17T00:00:00.000Z",
    });
    expect(crawled.warnings[0]).toContain("the planned window ran backwards");
    expect(crawled.gaps).toStrictEqual([]);
  });

  it("says NOTHING about a backwards window when every calendar resumed by token and sent no bounds", async () => {
    const crawled = unwrap(
      await crawlCalendars({
        anchors: ANCHORS,
        api: fakeApi({ calendars: [calendar({ id: "me@example.test", primary: true })] }),
        cap: undefined,
        cursorOverridden: false,
        window: { since: "2027-09-05T23:30:00.000Z", until: "2026-09-17" },
      }),
    );
    expect(crawled.pages[0]!.lane).toBe("delta");
    expect(crawled.warnings).toStrictEqual([]);
  });

  it("RE-CRAWLS a calendar whose stored token Google has invalidated, instead of gapping it forever", async () => {
    const sentTokens = new Map<string, string | undefined>();
    const crawled = unwrap(
      await crawlCalendars({
        anchors: ANCHORS,
        api: fakeApi({
          calendars: [calendar({ id: "me@example.test", primary: true })],
          expireTokenFor: new Set(["me@example.test"]),
          sentTokens,
        }),
        cap: undefined,
        cursorOverridden: false,
        window: WINDOW,
      }),
    );
    expect(sentTokens.get("me@example.test")).toBe(undefined);
    expect(crawled.pages[0]!.lane).toBe("window");
    expect(crawled.pages[0]!.nextSyncToken).toBe("next-me@example.test");
    expect(crawled.gaps).toStrictEqual([]);
    expect(crawled.warnings[0]).toContain("re-crawled its window and re-anchored it");
  });

  it("gaps a calendar whose window crawl fails TOO, so the expiry retry cannot hide a real outage", async () => {
    const crawled = unwrap(
      await crawlCalendars({
        anchors: ANCHORS,
        api: fakeApi({
          calendars: [calendar({ id: "me@example.test", primary: true })],
          expireTokenFor: new Set(["me@example.test"]),
          failFor: new Set(["me@example.test"]),
        }),
        cap: undefined,
        cursorOverridden: false,
        window: WINDOW,
      }),
    );
    expect(crawled.pages).toStrictEqual([]);
    expect(crawled.gaps).toStrictEqual(["calendar me@example.test could not be read this pass"]);
    expect(crawled.warnings[0]).toContain("no longer accessible");
  });

  it("reports a run stopped by --sample as CAPPED, which is what withholds every token", async () => {
    const crawled = unwrap(
      await crawlCalendars({
        anchors: {},
        api: fakeApi({ calendars: [calendar({ id: "me@example.test" })], events: 3 }),
        cap: { maxEvents: 3 },
        cursorOverridden: false,
        window: WINDOW,
      }),
    );
    expect(crawled.capped).toBe(true);
  });

  it("surfaces a failure to list calendars at all, rather than reporting an empty diary", async () => {
    const result = await crawlCalendars({
      anchors: {},
      api: { ...fakeApi({ calendars: [] }), listCalendars: async () => err(CalendarErrors.notConnected()) },
      cap: undefined,
      cursorOverridden: false,
      window: WINDOW,
    });
    expect(unwrapErr(result).code).toBe("NOT_CONNECTED");
  });
});

describe("parameterFingerprint", () => {
  it("differs when a parameter that binds a token differs", () => {
    expect(parameterFingerprint({ showDeleted: true, singleEvents: false })).not.toBe(
      parameterFingerprint({ showDeleted: true, singleEvents: true }),
    );
  });

  it("is stable for the same parameters, so a token survives an ordinary run", () => {
    expect(parameterFingerprint({ showDeleted: true, singleEvents: false })).toBe(FINGERPRINT);
  });
});

describe("crawlNotes", () => {
  it("names which lane each calendar took, because the record counts cannot say", () => {
    const notes = crawlNotes({
      cursorOverridden: false,
      listed: 3,
      pages: [
        { calendar: calendar({ id: "a" }), events: [], lane: "delta", nextSyncToken: "t" },
        { calendar: calendar({ id: "b" }), events: [], lane: "window", nextSyncToken: "t" },
      ],
    });
    expect(notes[0]).toBe("2 of 3 calendar(s) read · 1 by delta, 1 by window");
  });

  it("says so when an explicit window overrode every token", () => {
    const notes = crawlNotes({ cursorOverridden: true, listed: 1, pages: [] });
    expect(notes[1]).toContain("every stored sync token was ignored");
  });
});
