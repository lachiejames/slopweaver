/**
 * The strict calendar boundaries (`live/outlookCalendar/wire.ts`): what each endpoint may answer, the
 * single-event read's extra navigation keys measured on a real personal account, and a key Microsoft adds being
 * refused BY NAME rather than read as absent.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { CALENDAR_PAGE, EVENT, EVENT_PAGE } from "../../../../live/outlookCalendar/wire.js";

/** A single-event answer as a personal account sent it under `$expand=calendar`, ids made synthetic. */
const SINGLE_EVENT = {
  "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users('FIXTURE')/events/$entity",
  "@odata.etag": 'W/"FIXTURE"',
  calendar: {
    "@odata.etag": 'W/"FIXTURE"',
    allowedOnlineMeetingProviders: [],
    canEdit: true,
    canShare: true,
    canViewPrivateItems: true,
    changeKey: "FIXTURE",
    color: "auto",
    defaultOnlineMeetingProvider: "none",
    groupClassId: "FIXTURE",
    hexColor: "",
    id: "calendar-1",
    isDefaultCalendar: true,
    isRemovable: false,
    isShared: false,
    isSharedWithMe: false,
    isTallyingResponses: true,
    name: "Calendar",
    owner: { address: "owner@example.test", name: "Owner" },
  },
  "calendar@odata.associationLink": "https://graph.microsoft.com/v1.0/users('FIXTURE')/calendars('regular-1')/$ref",
  "calendar@odata.navigationLink": "https://graph.microsoft.com/v1.0/users('FIXTURE')/calendars('regular-1')",
  id: "event-1",
  subject: "Planning",
};

describe("EVENT", () => {
  it("reads a single-event answer with its expanded calendar and navigation annotations", () => {
    const parsed = EVENT.parse({ value: SINGLE_EVENT });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).calendar!.id).toBe("calendar-1");
  });

  it("refuses a key Microsoft adds by name, top level and inside the expanded calendar", () => {
    const parsed = EVENT.parse({
      value: { ...SINGLE_EVENT, calendar: { ...SINGLE_EVENT.calendar, newThing: 1 }, sparkle: true },
    });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).code).toBe("BOUNDARY_SHAPE_CHANGED");
    expect(unwrapErr(parsed).message).toContain('new field "sparkle"');
    expect(unwrapErr(parsed).message).toContain('new field "calendar.newThing"');
  });

  it("refuses an event with no id, the one field a later read depends on", () => {
    const { id: _dropped, ...noId } = SINGLE_EVENT;
    expect(unwrapErr(EVENT.parse({ value: noId })).code).toBe("BOUNDARY_SHAPE_CHANGED");
  });
});

describe("EVENT_PAGE", () => {
  it("reads a page and its next link", () => {
    const page = unwrap(
      EVENT_PAGE.parse({
        value: {
          "@odata.context": "ctx",
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendarView?$skip=100",
          value: [{ id: "event-1" }, { id: "event-2", isAllDay: true }],
        },
      }),
    );
    expect(page.value.map((event) => event.id)).toEqual(["event-1", "event-2"]);
    expect(page["@odata.nextLink"]).toBe("https://graph.microsoft.com/v1.0/me/calendarView?$skip=100");
  });

  it("does not let a page item carry the single-event navigation keys", () => {
    const parsed = EVENT_PAGE.parse({
      value: { value: [{ "calendar@odata.navigationLink": "x", id: "event-1" }] },
    });
    expect(unwrapErr(parsed).message).toContain('new field "value[0].calendar@odata.navigationLink"');
  });
});

describe("CALENDAR_PAGE", () => {
  it("reads a calendar listing", () => {
    const page = unwrap(
      CALENDAR_PAGE.parse({ value: { value: [{ id: "calendar-1", isDefaultCalendar: true, name: "Calendar" }] } }),
    );
    expect(page.value).toEqual([{ id: "calendar-1", isDefaultCalendar: true, name: "Calendar" }]);
  });
});
