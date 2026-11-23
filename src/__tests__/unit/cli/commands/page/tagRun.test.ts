/**
 * `page tag`: a published page is tied to the one meeting it prepares the owner for, from a live event read and a store
 * presence check injected here, and every refusal happens before anything is written. The store's `fileExists` itself
 * is proven against the real stack in `src/__tests__/integration/publishedPagesRead.test.ts`.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pageTagOptions } from "../../../../../cli/commands/page/core.js";
import { type PageTagDeps, runPageTag } from "../../../../../cli/commands/page/tagRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { CalendarErrors } from "../../../../../live/calendar/errors.js";
import type { CalendarEventResult } from "../../../../../live/calendar/read.js";
import { readMeetingTags } from "../../../../../pages/meetingTagStore.js";
import { pagePath } from "../../../../../pages/publish.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { PublishedPagesReadErrors } from "../../../../../store/publishedPages/readErrors.js";

const SLUG = "tobias-one-on-one-2-oct";
const EVENT_ID = "6h1s9r0k4p2m8n3q_20261002T050000Z";

const EVENT: CalendarEventResult = {
  document: {
    coverage: { detail: "one event, read in full", kind: "bounded", residue: [] },
    data: {},
    readAtIso: "2026-10-01T05:40:00.000Z",
    source: "calendar",
    target: { address: `primary/${EVENT_ID}`, identity: "me@x.test", kind: "event" },
  },
  payload: {
    account: "me@x.test",
    event: {
      attendees: [],
      calendarId: "primary",
      conferenceUrl: undefined,
      createdIso: undefined,
      creatorEmail: undefined,
      description: undefined,
      end: undefined,
      htmlLink: undefined,
      iCalUID: undefined,
      id: EVENT_ID,
      location: undefined,
      organizerEmail: undefined,
      recurrence: [],
      recurringEventId: "6h1s9r0k4p2m8n3q",
      start: { dateTime: "2026-10-02T15:00:00+10:00", kind: "timed", timeZone: "Australia/Sydney" },
      status: "confirmed",
      summary: "Tobias / the owner 1:1",
      transparency: undefined,
      updatedIso: undefined,
      visibility: undefined,
    },
  },
};

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "page-tag-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** What one run wrote, every event read it asked for, and every page it asked the store about. */
interface Captured {
  readonly deps: PageTagDeps;
  readonly out: string[];
  readonly diagnostics: string[];
  readonly reads: string[];
  readonly checked: string[];
}

function fakeDeps({
  result = ok(EVENT),
  published = ok(true),
}: {
  result?: Awaited<ReturnType<PageTagDeps["readEvent"]>>;
  published?: Awaited<ReturnType<PageTagDeps["pagePublished"]>>;
} = {}): Captured {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const reads: string[] = [];
  const checked: string[] = [];
  return {
    checked,
    deps: {
      now: () => "2026-10-01T05:40:00.000Z",
      pagePublished: async ({ home: asked, slug }) => {
        checked.push(`${asked}:${slug}`);
        return published;
      },
      readEvent: async ({ calendarId, eventId }) => {
        reads.push(`${calendarId}/${eventId}`);
        return result;
      },
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: (line) => out.push(line),
    },
    diagnostics,
    out,
    reads,
  };
}

describe("pageTagOptions", () => {
  it("takes the slug, the meeting and the primary calendar by default", () => {
    expect(unwrap(pageTagOptions({ rest: [SLUG, "--meeting", EVENT_ID] }))).toEqual({
      calendarId: "primary",
      eventId: EVENT_ID,
      home: undefined,
      json: false,
      now: { from: "clock" },
      slug: SLUG,
    });
  });

  it("refuses a missing slug, a missing meeting, two slugs and a --now that is not an instant", () => {
    expect(unwrapErr(pageTagOptions({ rest: ["--meeting", EVENT_ID] }))).toEqual([
      "page tag needs the slug of a published page",
    ]);
    expect(unwrapErr(pageTagOptions({ rest: [SLUG] }))).toEqual([
      "--meeting is required — the event id `slopweaver calendar list` prints for the meeting",
    ]);
    expect(unwrapErr(pageTagOptions({ rest: [SLUG, "b", "--meeting", EVENT_ID] }))).toEqual([
      "page tag takes one slug, got 2",
    ]);
    expect(unwrapErr(pageTagOptions({ rest: [SLUG, "--meeting", EVENT_ID, "--now", "soon"] }))).toEqual([
      "--now soon is not an ISO-8601 instant",
    ]);
  });
});

describe("runPageTag", () => {
  it("tags a page the store holds to the event it read, and prints the page's address and the meeting", async () => {
    const captured = fakeDeps();
    expect(await runPageTag({ deps: captured.deps, rest: [SLUG, "--meeting", EVENT_ID, "--home", home] })).toBe(
      EXIT_OK,
    );
    expect(captured.checked).toEqual([`${home}:${SLUG}`]);
    expect(captured.reads).toEqual([`primary/${EVENT_ID}`]);
    expect(captured.out).toEqual([
      pathToFileURL(pagePath({ home, slug: SLUG })).href,
      `  tagged to "Tobias / the owner 1:1" (primary/${EVENT_ID}), starting 2026-10-02T05:00:00.000Z — 15:00 on its calendar`,
      "  `meeting-prep-due` floats this page as a note in the hour before it starts",
    ]);
    expect(unwrap(readMeetingTags({ home })).tags).toEqual([
      {
        calendarId: "primary",
        eventId: EVENT_ID,
        schemaVersion: 1,
        slug: SLUG,
        startIso: "2026-10-02T05:00:00.000Z",
        startWall: "15:00",
        summary: "Tobias / the owner 1:1",
        taggedIso: "2026-10-01T05:40:00.000Z",
      },
    ]);
  });

  it("refuses a page the store does not hold before reading the calendar, writing nothing", async () => {
    const captured = fakeDeps({ published: ok(false) });
    expect(await runPageTag({ deps: captured.deps, rest: [SLUG, "--meeting", EVENT_ID, "--home", home] })).toBe(
      EXIT_ERROR,
    );
    expect(captured.reads).toEqual([]);
    expect(captured.diagnostics).toEqual([
      `no page is published as ${SLUG} in the store — publish it with \`slopweaver page publish\` first`,
    ]);
    expect(existsSync(stateHomePaths({ home }).pageMeetings)).toBe(false);
  });

  it("refuses a store it cannot read as unchecked, never as a missing page, before reading the calendar", async () => {
    const captured = fakeDeps({
      published: err(
        PublishedPagesReadErrors.unavailable({ cause: new Error("connection refused"), doing: "be opened" }),
      ),
    });
    expect(await runPageTag({ deps: captured.deps, rest: [SLUG, "--meeting", EVENT_ID, "--home", home] })).toBe(
      EXIT_ERROR,
    );
    expect(captured.reads).toEqual([]);
    expect(captured.diagnostics).toEqual([
      `could not check that ${SLUG} is published, so nothing was tagged: ` +
        "the published-page store did not be opened: connection refused",
    ]);
    expect(existsSync(stateHomePaths({ home }).pageMeetings)).toBe(false);
  });

  it("refuses a calendar read that failed and an event that cannot be tagged, writing nothing", async () => {
    const failed = fakeDeps({ result: err(CalendarErrors.notConnected()) });
    expect(await runPageTag({ deps: failed.deps, rest: [SLUG, "--meeting", EVENT_ID, "--home", home] })).toBe(
      EXIT_ERROR,
    );
    expect(failed.diagnostics[0]).toContain("the meeting could not be read from the calendar:");
    const series = fakeDeps({
      result: ok({
        ...EVENT,
        payload: { ...EVENT.payload, event: { ...EVENT.payload.event, recurrence: ["RRULE:FREQ=WEEKLY"] } },
      }),
    });
    expect(await runPageTag({ deps: series.deps, rest: [SLUG, "--meeting", EVENT_ID, "--home", home] })).toBe(
      EXIT_ERROR,
    );
    expect(series.diagnostics[0]).toContain("is a recurring series");
    expect(existsSync(stateHomePaths({ home }).pageMeetings)).toBe(false);
  });

  it("refuses a slug outside the page alphabet as a usage error", async () => {
    const captured = fakeDeps();
    expect(await runPageTag({ deps: captured.deps, rest: ["../x", "--meeting", EVENT_ID, "--home", home] })).toBe(
      EXIT_USAGE,
    );
    expect(captured.reads).toEqual([]);
    expect(captured.checked).toEqual([]);
  });
});
