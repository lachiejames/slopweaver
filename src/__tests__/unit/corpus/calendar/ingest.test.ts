/**
 * Unit: the calendar ingest job's ORDERING and its cursor discipline, over a real temp home and a plain
 * fake seam. The contract under test is one sentence: commit, then anchor, and neither when the pass was
 * not entitled to move a cursor.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { calendar_v3 } from "@googleapis/calendar";
import { afterEach, describe, expect, it } from "vitest";
import { calendarIngestJob, ingestNotes, pooledCursor, readCap } from "../../../../corpus/calendar/ingest.js";
import { readCalendarSyncAnchors } from "../../../../corpus/calendar/syncAnchor.js";
import type { CorpusRecord, ExportWindow } from "../../../../corpus/types.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { CalendarApi, CalendarSummary } from "../../../../live/calendar/api.js";
import { CalendarErrors } from "../../../../live/calendar/errors.js";

const WINDOW: ExportWindow = { since: "2026-06-07T00:00:00.000Z", until: "2026-09-05T00:00:00.000Z" };
const NOW = "2026-09-05T12:00:00.000Z";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-calendar-ingest-"));
  fixtureDirs.push(dir);
  return dir;
}

function calendar({ id }: { id: string }): CalendarSummary {
  return {
    accessRole: "owner",
    description: undefined,
    id,
    primary: true,
    selected: true,
    summary: id,
    timeZone: "Australia/Sydney",
  };
}

function fakeApi({
  ids = ["me@example.test"],
  events = 2,
  failFor = new Set<string>(),
  startIso,
}: {
  ids?: readonly string[];
  events?: number;
  failFor?: ReadonlySet<string>;
  /** When set, every event starts here instead of in the window — a diary holds meetings yet to happen. */
  startIso?: string;
} = {}): CalendarApi {
  /** When the caller named no start, each event sits a day apart inside the window. */
  function startOf({ index }: { index: number }): string {
    if (startIso === undefined) {
      return `2026-09-0${String(index + 1)}T00:00:00Z`;
    }
    return startIso;
  }
  return {
    getEvent: async () => ok({}),
    getTimeZone: async () => ok("Australia/Sydney"),
    listCalendars: async () => ok({ calendars: ids.map((id) => calendar({ id })), nextPageToken: undefined }),
    listEvents: async ({ calendarId }) => {
      if (failFor.has(calendarId)) {
        return err(CalendarErrors.apiFailed({ message: "no longer accessible" }));
      }
      const items: calendar_v3.Schema$Event[] = Array.from({ length: events }, (_, index) => ({
        id: `${calendarId}-${String(index)}`,
        start: { dateTime: startOf({ index }) },
        summary: `Event ${String(index)}`,
      }));
      return ok({ events: items, nextPageToken: undefined, nextSyncToken: `next-${calendarId}`, timeZone: undefined });
    },
  };
}

async function run({
  dir,
  api,
  sample,
}: {
  dir: string;
  api: CalendarApi;
  sample?: number;
}): ReturnType<ReturnType<typeof calendarIngestJob>["run"]> {
  return calendarIngestJob({
    api,
    home: dir,
    nowIso: () => NOW,
    window: WINDOW,
    ...(sample !== undefined ? { sample } : {}),
  }).run();
}

describe("calendarIngestJob", () => {
  it("declares itself as the calendar source, so the shared machinery watermarks the right one", () => {
    expect(calendarIngestJob({ home: "/tmp/x", nowIso: () => NOW, window: WINDOW }).source).toBe("calendar");
  });

  it("commits its own records and reports both per-container counts", async () => {
    const dir = home();
    const outcome = unwrap(await run({ api: fakeApi(), dir }));
    expect(outcome.projectedPerContainer).toBe(2);
    expect(outcome.committedPerContainer).toBe(2);
    // The bulk write is handed nothing, because this lane already committed everything it read.
    expect(outcome.records).toStrictEqual([]);
  });

  it("advances the pooled cursor itself, since the bulk write sees no records to derive one from", async () => {
    const dir = home();
    expect(unwrap(await run({ api: fakeApi(), dir })).committedCursor).toBe("2026-09-02T00:00:00.000Z");
  });

  it("NEVER banks a cursor ahead of the clock, however far into the future the diary reaches", async () => {
    const dir = home();
    const outcome = unwrap(await run({ api: fakeApi({ startIso: "2027-09-05T23:30:00Z" }), dir }));
    expect(outcome.committedCursor).toBe(NOW);
  });

  it("ANCHORS each calendar after the write, so a token only ever covers records on disk", async () => {
    const dir = home();
    await run({ api: fakeApi({ ids: ["a@example.test", "b@example.test"] }), dir });
    const anchors = readCalendarSyncAnchors({ home: dir });
    expect(anchors["a@example.test"]!.syncToken).toBe("next-a@example.test");
    expect(anchors["b@example.test"]!.syncToken).toBe("next-b@example.test");
    expect(anchors["a@example.test"]!.recordedAtIso).toBe(NOW);
  });

  it("anchors NOTHING when one calendar could not be read, not even the ones that succeeded", async () => {
    const dir = home();
    const outcome = unwrap(
      await run({
        api: fakeApi({ failFor: new Set(["gone@example.test"]), ids: ["ok@example.test", "gone@example.test"] }),
        dir,
      }),
    );
    expect(readCalendarSyncAnchors({ home: dir })).toStrictEqual({});
    expect(outcome.gaps!.length).toBe(1);
    expect(outcome.warnings.join(" ")).toContain("sync tokens were NOT advanced");
  });

  it("anchors NOTHING when --sample stopped a calendar short", async () => {
    const dir = home();
    const outcome = unwrap(await run({ api: fakeApi({ events: 3 }), dir, sample: 3 }));
    expect(readCalendarSyncAnchors({ home: dir })).toStrictEqual({});
    expect(outcome.warnings.join(" ")).toContain("--sample/--fetch-cap stopped a calendar short");
  });

  it("still WRITES what a capped pass read, because holding the cursor is not the same as discarding data", async () => {
    const dir = home();
    expect(unwrap(await run({ api: fakeApi({ events: 3 }), dir, sample: 3 })).committedPerContainer).toBe(3);
  });

  it("surfaces a whole-crawl failure rather than reporting an empty diary", async () => {
    const api: CalendarApi = {
      ...fakeApi(),
      listCalendars: async () => err(CalendarErrors.notConnected()),
    };
    const outcome = await run({ api, dir: home() });
    expect(unwrapErr(outcome)).toEqual([
      "no Google Calendar grant stored for this home — run `slopweaver calendar connect`",
    ]);
  });
});

describe("readCap", () => {
  it("takes the TIGHTER of the two caps, so passing both never widens either", () => {
    expect(readCap({ fetchCap: 10, sample: 3 })).toStrictEqual({ maxEvents: 3 });
    expect(readCap({ fetchCap: 3, sample: 10 })).toStrictEqual({ maxEvents: 3 });
  });

  it("is undefined for an unbounded run", () => {
    expect(readCap({ fetchCap: undefined, sample: undefined })).toBe(undefined);
  });

  it("honours one cap given alone", () => {
    expect(readCap({ fetchCap: undefined, sample: 5 })).toStrictEqual({ maxEvents: 5 });
  });
});

describe("pooledCursor", () => {
  /** One committed calendar record, whose `tsIso` is the event's START. */
  function record({ tsIso }: { tsIso: string }): CorpusRecord {
    return {
      container: "me@example.test",
      kind: "event",
      refs: [],
      source: "calendar",
      sourceId: `e-${tsIso}`,
      text: "standup",
      tsIso,
      url: "https://example.invalid/e",
    };
  }

  it("banks the newest record when the diary holds nothing after the clock", () => {
    expect(
      pooledCursor({
        nowIso: NOW,
        records: [record({ tsIso: "2026-09-01T00:00:00Z" }), record({ tsIso: "2026-09-02T00:00:00Z" })],
      }),
    ).toBe("2026-09-02T00:00:00Z");
  });

  it("banks the CLOCK when a meeting sits in the future, which is as far as reading a diary proves", () => {
    expect(pooledCursor({ nowIso: NOW, records: [record({ tsIso: "2027-09-05T23:30:00Z" })] })).toBe(NOW);
  });

  it("banks nothing at all when the pass committed nothing", () => {
    expect(pooledCursor({ nowIso: NOW, records: [] })).toBe(undefined);
  });
});

describe("ingestNotes", () => {
  it("says recurring series were not expanded, because a record count cannot say it", () => {
    expect(ingestNotes({ anchored: undefined, projected: 12 })[0]).toBe(
      "12 event record(s) projected — recurring series stored as their master, never expanded",
    );
  });

  it("prints the anchor line only when tokens were actually written", () => {
    expect(ingestNotes({ anchored: undefined, projected: 1 }).length).toBe(1);
    expect(ingestNotes({ anchored: "sync token advanced for 2 calendar(s)", projected: 1 }).length).toBe(2);
  });
});
