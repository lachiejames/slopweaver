import { describe, expect, it } from "vitest";

import type { CalendarFreeResult } from "../../../../live/calendar/free.js";
import type { ParsedCalendarEvent } from "../../../../live/calendar/parse.js";
import type {
  CalendarEventResult,
  CalendarListingResult,
  CalendarVocabularyResult,
} from "../../../../live/calendar/read.js";
import {
  renderCalendarEventText,
  renderCalendarFreeText,
  renderCalendarListingText,
  renderCalendarVocabularyText,
} from "../../../../live/calendar/render.js";
import type { ProviderReadDocument } from "../../../../live/providerRead.js";

/** A calendar document with an explicit read instant and the given residue. */
const doc = ({ residue }: { residue: readonly string[] }): ProviderReadDocument => ({
  coverage: { detail: "one page of calendars", kind: "bounded", residue },
  data: null,
  readAtIso: "2026-09-14T00:00:00.000Z",
  source: "calendar",
  target: { address: "calendar:primary", identity: "owner@example.com", kind: "calendar" },
});

/** A sparse event: every optional field absent, so each displayed fallback is reached. */
const sparseEvent: ParsedCalendarEvent = {
  attendees: [],
  calendarId: "primary",
  conferenceUrl: undefined,
  createdIso: undefined,
  creatorEmail: undefined,
  description: undefined,
  end: undefined,
  htmlLink: undefined,
  iCalUID: undefined,
  id: "evt-sparse",
  location: undefined,
  organizerEmail: undefined,
  recurrence: [],
  recurringEventId: undefined,
  start: undefined,
  status: undefined,
  summary: undefined,
  transparency: undefined,
  updatedIso: undefined,
  visibility: undefined,
};

/** A full event: every optional field present, and attendees exercising each flag and name fallback. */
const fullEvent: ParsedCalendarEvent = {
  ...sparseEvent,
  attendees: [
    {
      displayName: "Ada",
      email: "ada@example.com",
      optional: false,
      resource: false,
      responseStatus: "accepted",
      self: false,
    },
    {
      displayName: "Bob",
      email: undefined,
      optional: true,
      resource: false,
      responseStatus: undefined,
      self: false,
    },
    {
      displayName: undefined,
      email: undefined,
      optional: false,
      resource: true,
      responseStatus: "needsAction",
      self: false,
    },
  ],
  conferenceUrl: "https://meet.example.com/abc",
  createdIso: "2026-09-01T00:00:00.000Z",
  creatorEmail: "creator@example.com",
  description: "Agenda: the plan",
  end: { dateTime: "2026-09-14T10:00:00+10:00", kind: "timed", timeZone: undefined },
  htmlLink: "https://calendar.example.com/evt-full",
  iCalUID: "uid-full@example.com",
  id: "evt-full",
  location: "Room 4",
  organizerEmail: "org@example.com",
  recurrence: ["RRULE:FREQ=WEEKLY", "EXDATE:20260921"],
  recurringEventId: "evt-series",
  start: { dateTime: "2026-09-14T09:00:00+10:00", kind: "timed", timeZone: "Australia/Sydney" },
  status: "confirmed",
  summary: "Planning",
  transparency: "transparent",
  updatedIso: "2026-09-02T00:00:00.000Z",
  visibility: "private",
};

describe("renderCalendarVocabularyText", () => {
  it("renders each calendar with its primary mark, name, access, zone and tick, and a missing account zone", () => {
    const result: CalendarVocabularyResult = {
      document: doc({ residue: ["descriptions omitted"] }),
      vocabulary: {
        account: "owner@example.com",
        accountTimeZone: undefined,
        calendars: [
          {
            accessRole: "owner",
            description: undefined,
            id: "primary-id",
            primary: true,
            selected: true,
            summary: "Me",
            timeZone: "Australia/Sydney",
          },
          {
            accessRole: undefined,
            description: undefined,
            id: "shared-id",
            primary: false,
            selected: false,
            summary: undefined,
            timeZone: undefined,
          },
        ],
      },
    };
    expect(renderCalendarVocabularyText({ result })).toBe(
      [
        "calendar calendars: owner@example.com",
        "read at: 2026-09-14T00:00:00.000Z",
        "coverage: bounded — one page of calendars",
        "residue:",
        "  - descriptions omitted",
        "",
        "account time zone: (not established)",
        "",
        "* Me",
        "    id: primary-id",
        "    access: owner · zone: Australia/Sydney · ticked",
        "  (no name)",
        "    id: shared-id",
        "    access: (unknown) · zone: (none) · unticked",
      ].join("\n"),
    );
  });

  it("renders an established account zone and an empty residue as none", () => {
    const result: CalendarVocabularyResult = {
      document: doc({ residue: [] }),
      vocabulary: { account: "owner@example.com", accountTimeZone: "UTC", calendars: [] },
    };
    expect(renderCalendarVocabularyText({ result })).toBe(
      [
        "calendar calendars: owner@example.com",
        "read at: 2026-09-14T00:00:00.000Z",
        "coverage: bounded — one page of calendars",
        "residue:",
        "  none",
        "",
        "account time zone: UTC",
        "",
      ].join("\n"),
    );
  });
});

describe("renderCalendarListingText", () => {
  it("states an empty window rather than rendering nothing", () => {
    const result: CalendarListingResult = {
      document: doc({ residue: [] }),
      listing: {
        account: "owner@example.com",
        calendarIds: ["primary"],
        complete: true,
        events: [],
        timeMaxIso: "2026-09-15T00:00:00.000Z",
        timeMinIso: "2026-09-14T00:00:00.000Z",
      },
    };
    expect(renderCalendarListingText({ result })).toBe(
      [
        "calendar events: owner@example.com",
        "read at: 2026-09-14T00:00:00.000Z",
        "coverage: bounded — one page of calendars",
        "residue:",
        "  none",
        "",
        "(no events in this window on the calendars read)",
      ].join("\n"),
    );
  });

  it("renders a timed, an all-day and an untitled event with their attendee counts", () => {
    const result: CalendarListingResult = {
      document: doc({ residue: [] }),
      listing: {
        account: "owner@example.com",
        calendarIds: ["primary"],
        complete: true,
        events: [
          fullEvent,
          {
            ...sparseEvent,
            end: { date: "2026-09-16", kind: "all-day" },
            id: "evt-day",
            start: { date: "2026-09-15", kind: "all-day" },
            summary: "Offsite",
          },
          sparseEvent,
        ],
        timeMaxIso: "2026-09-17T00:00:00.000Z",
        timeMinIso: "2026-09-14T00:00:00.000Z",
      },
    };
    expect(renderCalendarListingText({ result })).toBe(
      [
        "calendar events: owner@example.com",
        "read at: 2026-09-14T00:00:00.000Z",
        "coverage: bounded — one page of calendars",
        "residue:",
        "  none",
        "",
        "2026-09-14T09:00:00+10:00 [Australia/Sydney] → 2026-09-14T10:00:00+10:00",
        "    Planning",
        "    3 attendee(s) · primary · evt-full",
        "2026-09-15 (all day) → 2026-09-16 (all day)",
        "    Offsite",
        "    0 attendee(s) · primary · evt-day",
        "(no time) → (no time)",
        "    (no title — free/busy or private)",
        "    0 attendee(s) · primary · evt-sparse",
      ].join("\n"),
    );
  });
});

describe("renderCalendarEventText", () => {
  it("renders every optional field the event view displays and no bookkeeping field, and each attendee's name, reply and flags", () => {
    const result: CalendarEventResult = {
      document: doc({ residue: [] }),
      payload: { account: "owner@example.com", event: fullEvent },
    };
    expect(renderCalendarEventText({ result })).toBe(
      [
        "calendar event: owner@example.com",
        "read at: 2026-09-14T00:00:00.000Z",
        "coverage: bounded — one page of calendars",
        "residue:",
        "  none",
        "",
        "title: Planning",
        "when: 2026-09-14T09:00:00+10:00 [Australia/Sydney] → 2026-09-14T10:00:00+10:00",
        "status: confirmed · shows as: transparent · visibility: private",
        "organiser: org@example.com",
        "location: Room 4",
        "join: https://meet.example.com/abc",
        "recurrence:",
        "  RRULE:FREQ=WEEKLY",
        "  EXDATE:20260921",
        "link: https://calendar.example.com/evt-full",
        "",
        "attendees (3):",
        "  - ada@example.com · accepted",
        "  - Bob · no reply · optional",
        "  - (unnamed) · needsAction · resource",
        "",
        "description:",
        "Agenda: the plan",
      ].join("\n"),
    );
  });

  it("renders every displayed fallback for a sparse event and omits the absent optional lines", () => {
    const result: CalendarEventResult = {
      document: doc({ residue: [] }),
      payload: { account: "owner@example.com", event: sparseEvent },
    };
    expect(renderCalendarEventText({ result })).toBe(
      [
        "calendar event: owner@example.com",
        "read at: 2026-09-14T00:00:00.000Z",
        "coverage: bounded — one page of calendars",
        "residue:",
        "  none",
        "",
        "title: (no title — free/busy or private)",
        "when: (no time) → (no time)",
        "status: (unknown) · shows as: opaque · visibility: default",
        "organiser: (unknown)",
        "",
        "attendees (0):",
        "",
        "(no description)",
      ].join("\n"),
    );
  });
});

/** Nine in the morning UTC on a Monday. */
const MON_0900_UTC = Date.UTC(2026, 8, 14, 9, 0);
/** Half past ten UTC on that Monday. */
const MON_1030_UTC = Date.UTC(2026, 8, 14, 10, 30);
/** Ten at night UTC on that Monday. */
const MON_2200_UTC = Date.UTC(2026, 8, 14, 22, 0);
/** Midnight UTC at the start of the next day, the next local midnight in UTC. */
const TUE_0000_UTC = Date.UTC(2026, 8, 15, 0, 0);

/** A free result over the given calendars and slots, in UTC with a 30-minute meeting. */
const freeResult = ({
  calendars,
  slots,
}: {
  calendars: CalendarFreeResult["free"]["calendars"];
  slots: CalendarFreeResult["free"]["slots"];
}): CalendarFreeResult => ({
  document: doc({ residue: [] }),
  free: {
    account: "owner@example.com",
    between: undefined,
    calendars,
    minutes: 30,
    slots,
    timeMaxIso: "2026-09-15T00:00:00.000Z",
    timeMinIso: "2026-09-14T00:00:00.000Z",
    zone: "UTC",
  },
});

/** The header and calendar block every free case shares, for one readable calendar. */
const FREE_HEAD = [
  "calendar free: owner@example.com",
  "read at: 2026-09-14T00:00:00.000Z",
  "coverage: bounded — one page of calendars",
  "residue:",
  "  none",
  "",
  "zone: UTC · meeting length: 30 min",
  "",
  "calendars:",
  "  primary: 1 busy interval(s)",
  "",
];

describe("renderCalendarFreeText", () => {
  it("abbreviates a same-day end to HH:MM and shows the whole end when a slot crosses midnight", () => {
    const result = freeResult({
      calendars: [{ busy: [{ endMs: MON_1030_UTC, startMs: MON_0900_UTC }], calendarId: "primary", error: undefined }],
      slots: [
        { endMs: MON_1030_UTC, startMs: MON_0900_UTC },
        { endMs: TUE_0000_UTC, startMs: MON_2200_UTC },
      ],
    });
    expect(renderCalendarFreeText({ result })).toBe(
      [
        ...FREE_HEAD,
        "open:",
        "  2026-09-14 Mon 09:00 → 10:30 (90 min)",
        "  2026-09-14 Mon 22:00 → 2026-09-15 Tue 00:00 (120 min)",
      ].join("\n"),
    );
  });

  it("states that no open stretch of the meeting length exists when the slot list is empty", () => {
    const result = freeResult({
      calendars: [{ busy: [{ endMs: MON_1030_UTC, startMs: MON_0900_UTC }], calendarId: "primary", error: undefined }],
      slots: [],
    });
    expect(renderCalendarFreeText({ result })).toBe(
      [...FREE_HEAD, "(no open stretch of 30 min or more in this window)"].join("\n"),
    );
  });

  it("renders a refused calendar on its own line and states no slots when slots are undefined", () => {
    const result = freeResult({
      calendars: [
        { busy: [{ endMs: MON_1030_UTC, startMs: MON_0900_UTC }], calendarId: "primary", error: undefined },
        { busy: [], calendarId: "bob@example.com", error: "notFound" },
      ],
      slots: undefined,
    });
    expect(renderCalendarFreeText({ result })).toBe(
      [
        ...FREE_HEAD.slice(0, -1),
        "  bob@example.com: REFUSED (notFound) — availability unknown",
        "",
        "(no common slots can be stated: a calendar above refused)",
      ].join("\n"),
    );
  });
});
