/**
 * Unit: the three `calendar` read shells. The readers are injected, so what is under test is dispatch, the
 * human-vs-`--json` choice, and the exit code — no Google account and no network.
 */
import { describe, expect, it } from "vitest";
import {
  type CalendarReadDeps,
  runCalendarCalendars,
  runCalendarList,
  runCalendarRead,
} from "../../../../../cli/commands/calendar/readRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { CalendarErrors } from "../../../../../live/calendar/errors.js";
import type {
  CalendarEventResult,
  CalendarListingResult,
  CalendarVocabularyResult,
} from "../../../../../live/calendar/read.js";

const NOW = new Date("2026-09-05T14:30:00.000Z");

const VOCABULARY: CalendarVocabularyResult = {
  document: {
    coverage: { detail: "1 calendar(s) this grant can see", kind: "bounded", residue: [] },
    data: {},
    readAtIso: "2026-09-05T14:30:00.000Z",
    source: "calendar",
    target: { address: "me@x.test", identity: "me@x.test", kind: "calendar list" },
  },
  vocabulary: {
    account: "me@x.test",
    accountTimeZone: "Australia/Sydney",
    calendars: [
      {
        accessRole: "owner",
        description: undefined,
        id: "primary",
        primary: true,
        selected: true,
        summary: "Me",
        timeZone: "Australia/Sydney",
      },
    ],
  },
};

const LISTING: CalendarListingResult = {
  document: {
    coverage: { detail: "0 event(s)", kind: "bounded", residue: [] },
    data: {},
    readAtIso: "2026-09-05T14:30:00.000Z",
    source: "calendar",
    target: { address: "w", identity: "me@x.test", kind: "event window" },
  },
  listing: {
    account: "me@x.test",
    calendarIds: ["primary"],
    complete: true,
    events: [],
    timeMaxIso: "2026-09-12T00:00:00.000Z",
    timeMinIso: "2026-09-05T00:00:00.000Z",
  },
};

const EVENT: CalendarEventResult = {
  document: {
    coverage: { detail: "one event, read in full", kind: "bounded", residue: [] },
    data: {},
    readAtIso: "2026-09-05T14:30:00.000Z",
    source: "calendar",
    target: { address: "primary/e", identity: "me@x.test", kind: "event" },
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
      id: "e",
      location: undefined,
      organizerEmail: undefined,
      recurrence: [],
      recurringEventId: undefined,
      start: undefined,
      status: "confirmed",
      summary: "Weekly sync",
      transparency: undefined,
      updatedIso: undefined,
      visibility: undefined,
    },
  },
};

/** Captured shell output, plus the arguments each reader was handed. */
interface Captured {
  readonly deps: CalendarReadDeps;
  readonly out: string[];
  readonly diagnostics: string[];
  readonly calls: string[];
}

function fakeDeps({ failure = false }: { failure?: boolean } = {}): Captured {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const calls: string[] = [];
  return {
    calls,
    deps: {
      calendars: async ({ home }) => {
        calls.push(`calendars:${String(home)}`);
        return failure ? err(CalendarErrors.notConnected()) : ok(VOCABULARY);
      },
      list: async ({ calendarIds, timeMinIso, timeMaxIso, limit }) => {
        calls.push(`list:${calendarIds.join("+")}:${timeMinIso}..${timeMaxIso}:${String(limit)}`);
        return failure ? err(CalendarErrors.scopeMissing({ missing: ["scope-x"] })) : ok(LISTING);
      },
      now: () => NOW,
      read: async ({ calendarId, eventId }) => {
        calls.push(`read:${calendarId}/${eventId}`);
        return failure ? err(CalendarErrors.notConnected()) : ok(EVENT);
      },
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: (line) => out.push(line),
    },
    diagnostics,
    out,
  };
}

describe("runCalendarCalendars", () => {
  it("renders the calendar list for a human", async () => {
    const captured = fakeDeps();
    expect(await runCalendarCalendars({ deps: captured.deps, rest: [] })).toBe(EXIT_OK);
    expect(captured.out[0]).toContain("id: primary");
    expect(captured.out[0]).toContain("account time zone: Australia/Sydney");
  });

  it("emits the shared read document under --json", async () => {
    const captured = fakeDeps();
    await runCalendarCalendars({ deps: captured.deps, rest: ["--json"] });
    expect(JSON.parse(captured.out[0]!).coverage.kind).toBe("bounded");
  });

  it("refuses a bad flag on the pure parser, having called no reader", async () => {
    const captured = fakeDeps();
    expect(await runCalendarCalendars({ deps: captured.deps, rest: ["--nope"] })).toBe(EXIT_USAGE);
    expect(captured.calls).toStrictEqual([]);
  });

  it("reports a reader failure as an error exit and prints its message", async () => {
    const captured = fakeDeps({ failure: true });
    expect(await runCalendarCalendars({ deps: captured.deps, rest: [] })).toBe(EXIT_ERROR);
    expect(captured.diagnostics[0]).toContain("calendar connect");
  });
});

describe("runCalendarList", () => {
  it("resolves the default window against the injected clock and passes it to the reader", async () => {
    const captured = fakeDeps();
    expect(await runCalendarList({ deps: captured.deps, rest: [] })).toBe(EXIT_OK);
    expect(captured.calls).toStrictEqual(["list:primary:2026-09-05T00:00:00.000Z..2026-09-12T00:00:00.000Z:50"]);
  });

  it("passes every named calendar through in order", async () => {
    const captured = fakeDeps();
    await runCalendarList({ deps: captured.deps, rest: ["--calendar", "a", "--calendar", "b", "--days", "1"] });
    expect(captured.calls[0]).toContain("list:a+b:");
  });

  it("says so when the window holds nothing, rather than printing an empty block", async () => {
    const captured = fakeDeps();
    await runCalendarList({ deps: captured.deps, rest: [] });
    expect(captured.out[0]).toContain("(no events in this window on the calendars read)");
  });

  it("refuses an out-of-range --limit before calling the reader", async () => {
    const captured = fakeDeps();
    expect(await runCalendarList({ deps: captured.deps, rest: ["--limit", "9000"] })).toBe(EXIT_USAGE);
    expect(captured.calls).toStrictEqual([]);
  });

  it("surfaces a SCOPE_MISSING refusal with the scope named", async () => {
    const captured = fakeDeps({ failure: true });
    expect(await runCalendarList({ deps: captured.deps, rest: [] })).toBe(EXIT_ERROR);
    expect(captured.diagnostics[0]).toContain("scope-x");
  });
});

describe("runCalendarRead", () => {
  it("addresses the event by calendar and id", async () => {
    const captured = fakeDeps();
    expect(await runCalendarRead({ deps: captured.deps, rest: ["e", "--calendar", "team@x.test"] })).toBe(EXIT_OK);
    expect(captured.calls).toStrictEqual(["read:team@x.test/e"]);
  });

  it("renders the event for a human, attendees included", async () => {
    const captured = fakeDeps();
    await runCalendarRead({ deps: captured.deps, rest: ["e"] });
    expect(captured.out[0]).toContain("title: Weekly sync");
    expect(captured.out[0]).toContain("attendees (0):");
  });

  it("refuses a missing id having read nothing", async () => {
    const captured = fakeDeps();
    expect(await runCalendarRead({ deps: captured.deps, rest: [] })).toBe(EXIT_USAGE);
    expect(captured.calls).toStrictEqual([]);
  });
});
