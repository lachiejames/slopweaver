/**
 * Unit: the `outlook-calendar` ingest job's ORDERING and its anchor discipline, over a real temp home and a
 * plain fake seam. The contract is one sentence: commit, then anchor, and no anchor at all when a calendar
 * could not be read or a cap stopped one short.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import type { OutlookCalendarCrawlResult } from "../../../../corpus/outlookCalendar/fetch.js";
import {
  advancedAnchors,
  outlookCalendarIngestJob,
  outlookCalendarReadCap,
} from "../../../../corpus/outlookCalendar/ingest.js";
import {
  readOutlookCalendarSyncAnchors,
  writeOutlookCalendarSyncAnchors,
} from "../../../../corpus/outlookCalendar/syncAnchor.js";
import type { ExportWindow } from "../../../../corpus/types.js";
import type { OutlookCalendarApi } from "../../../../live/outlookCalendar/api.js";
import { calendarSummary, fakeOutlookCalendarApi, timedEvent } from "./fakeOutlookCalendarApi.js";

const WINDOW: ExportWindow = { since: "2001-01-01T00:00:00.000Z", until: "2001-01-31T00:00:00.000Z" };
const NOW = "2001-01-31T12:00:00.000Z";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-outlook-ingest-"));
  fixtureDirs.push(dir);
  return dir;
}

/** Two calendars, two events each, the newer of each modified at a known instant. */
function twoCalendars({ failFor = new Set<string>() }: { failFor?: ReadonlySet<string> } = {}): OutlookCalendarApi {
  return fakeOutlookCalendarApi({
    calendars: [{ id: "main", isDefaultCalendar: true }, { id: "shared" }],
    failFor,
    pages: {
      main: [
        [
          timedEvent({ id: "m1", modifiedIso: "2001-01-10T00:00:00Z", startIso: "2001-01-08T07:00:00" }),
          timedEvent({ id: "m2", modifiedIso: "2001-01-12T00:00:00Z", startIso: "2001-01-09T07:00:00" }),
        ],
      ],
      shared: [
        [
          timedEvent({ id: "s1", modifiedIso: "2001-01-11T00:00:00Z", startIso: "2001-01-10T07:00:00" }),
          timedEvent({ id: "s2", modifiedIso: "2001-01-03T00:00:00Z", startIso: "2001-01-11T07:00:00" }),
        ],
      ],
    },
  }).api;
}

async function run({
  dir,
  api,
  sample,
}: {
  dir: string;
  api: OutlookCalendarApi;
  sample?: number;
}): ReturnType<ReturnType<typeof outlookCalendarIngestJob>["run"]> {
  return outlookCalendarIngestJob({
    api,
    cursorOverridden: false,
    fetchCap: undefined,
    home: dir,
    nowIso: () => NOW,
    sample,
    window: WINDOW,
  }).run();
}

describe("outlookCalendarReadCap", () => {
  it("takes the tighter of the two caps, and none when neither was given", () => {
    expect(outlookCalendarReadCap({ fetchCap: 5, sample: 3 })).toEqual({ maxEvents: 3 });
    expect(outlookCalendarReadCap({ fetchCap: 2, sample: undefined })).toEqual({ maxEvents: 2 });
    expect(outlookCalendarReadCap({ fetchCap: undefined, sample: undefined })).toBeUndefined();
  });
});

describe("outlookCalendarIngestJob", () => {
  it("declares itself as the outlook-calendar source", () => {
    const job = outlookCalendarIngestJob({
      api: twoCalendars(),
      cursorOverridden: false,
      fetchCap: undefined,
      home: "/h",
      nowIso: () => NOW,
      sample: undefined,
      window: WINDOW,
    });
    expect(job.source).toBe("outlook-calendar");
    expect(job.label).toBe("outlook-calendar (diary)");
  });

  it("commits every event itself, hands the bulk write nothing, and banks the pooled cursor", async () => {
    const dir = home();
    const outcome = unwrap(await run({ api: twoCalendars(), dir }));
    expect(outcome.projectedPerContainer).toBe(4);
    expect(outcome.committedPerContainer).toBe(4);
    expect(outcome.records).toStrictEqual([]);
    expect(outcome.committedCursor).toBe("2001-01-11T07:00:00.000Z");
    expect(outcome.gaps).toEqual([]);
  });

  it("anchors each calendar at the instant its read began, after the commit — never a stamp an event carried", async () => {
    const dir = home();
    const outcome = unwrap(await run({ api: twoCalendars(), dir }));
    expect(outcome.notes).toContain("modified-time anchor advanced for 2 calendar(s)");
    const anchors = readOutlookCalendarSyncAnchors({ home: dir });
    expect(anchors).toEqual({
      main: { modifiedThroughIso: NOW, recordedAtIso: NOW, version: 1 },
      shared: { modifiedThroughIso: NOW, recordedAtIso: NOW, version: 1 },
    });
  });

  it("moves no anchor when one calendar could not be read, and says so", async () => {
    const dir = home();
    const outcome = unwrap(await run({ api: twoCalendars({ failFor: new Set(["shared"]) }), dir }));
    expect(outcome.committedPerContainer).toBe(2);
    expect(outcome.gaps!.map((gap) => gap.message)).toEqual([
      "calendar shared could not be read: no longer accessible",
    ]);
    expect(outcome.warnings).toContain(
      "modified-time anchors were NOT advanced: this pass could not read every calendar, so the next one asks the same question again rather than resuming past what it missed",
    );
    expect(readOutlookCalendarSyncAnchors({ home: dir })).toEqual({});
  });

  it("moves no anchor when a cap stopped a calendar short", async () => {
    const dir = home();
    const outcome = unwrap(await run({ api: twoCalendars(), dir, sample: 1 }));
    expect(outcome.committedPerContainer).toBe(2);
    expect(outcome.warnings).toContain(
      "modified-time anchors were NOT advanced: --sample/--fetch-cap stopped a calendar short, and an anchor from a truncated read would skip every edit the cap left unread",
    );
    expect(readOutlookCalendarSyncAnchors({ home: dir })).toEqual({});
  });

  it("follows this machine's clock back, so a pass whose clock stepped back never banks more than it read", async () => {
    const dir = home();
    const later = { modifiedThroughIso: "2001-02-10T00:00:00.000Z", recordedAtIso: "2001-02-10T01:00:00.000Z" };
    unwrap(writeOutlookCalendarSyncAnchors({ anchors: { main: { ...later, version: 1 } }, home: dir }));
    unwrap(await run({ api: twoCalendars(), dir }));
    expect(readOutlookCalendarSyncAnchors({ home: dir })["main"]).toEqual({
      modifiedThroughIso: NOW,
      recordedAtIso: NOW,
      version: 1,
    });
  });
});

describe("advancedAnchors", () => {
  const crawled: OutlookCalendarCrawlResult = {
    capped: false,
    gaps: [],
    notes: [],
    pages: [
      {
        calendar: calendarSummary({ id: "main" }),
        events: [],
        mode: "full",
        readStartedIso: "2001-01-11T00:00:00.000Z",
      },
      {
        calendar: calendarSummary({ id: "shared" }),
        events: [],
        mode: "full",
        readStartedIso: "2001-01-11T00:00:05.000Z",
      },
    ],
    warnings: [],
  };

  it("sets every calendar read to the instant its read began, earlier or later, and keeps one it did not read", () => {
    const stored = {
      gone: { modifiedThroughIso: "2001-01-01T00:00:00.000Z", recordedAtIso: "2001-01-01T00:00:00.000Z", version: 1 },
      main: { modifiedThroughIso: "2001-01-15T00:00:00.000Z", recordedAtIso: "2001-01-15T00:00:00.000Z", version: 1 },
    } as const;
    const { anchors, moved } = advancedAnchors({ crawled, recordedAtIso: NOW, stored });
    expect(moved).toBe(2);
    expect(anchors).toEqual({
      gone: stored.gone,
      main: { modifiedThroughIso: "2001-01-11T00:00:00.000Z", recordedAtIso: NOW, version: 1 },
      shared: { modifiedThroughIso: "2001-01-11T00:00:05.000Z", recordedAtIso: NOW, version: 1 },
    });
  });
});
