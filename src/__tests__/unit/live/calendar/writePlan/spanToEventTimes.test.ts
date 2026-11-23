/*
 * `spanToEventTimes` — the span conversion: a local wall-clock time plus a zone, an exclusive all-day end, and the
 * form's own zone winning over the account's. It moved here when the write plan's one test file was split by
 * behaviour.
 */
import { describe, expect, it } from "vitest";
import { spanToEventTimes } from "../../../../../live/calendar/eventBody.js";
import { BOOK, ZONE } from "./harness.js";

describe("spanToEventTimes", () => {
  it("sends a local wall-clock dateTime plus the zone, never an offset it computed", () => {
    expect(spanToEventTimes({ span: BOOK.span, zone: ZONE })).toStrictEqual({
      end: { dateTime: "2026-09-20T10:30:00", timeZone: ZONE },
      start: { dateTime: "2026-09-20T10:00:00", timeZone: ZONE },
    });
  });

  it("makes an all-day end EXCLUSIVE, which is what Google takes and a caller never means", () => {
    expect(
      spanToEventTimes({ span: { allDay: true, end: "2026-09-21", start: "2026-09-20", zone: undefined }, zone: ZONE }),
    ).toStrictEqual({ end: { date: "2026-09-22" }, start: { date: "2026-09-20" } });
  });

  it("prefers the form's own zone over the account's", () => {
    expect(spanToEventTimes({ span: { ...BOOK.span, zone: "Europe/Berlin" }, zone: ZONE }).start).toStrictEqual({
      dateTime: "2026-09-20T10:00:00",
      timeZone: "Europe/Berlin",
    });
  });
});
