/**
 * Unit: the strict write forms. What matters here is that an unrecognised key is REFUSED rather than
 * dropped, and that a span whose ends are wrong is refused before any credential is read.
 */
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  normaliseAttendees,
  parseCalendarBookForm,
  parseCalendarEditForm,
  parseCalendarRescheduleForm,
  parseCalendarRespondForm,
  parseCalendarWriteForm,
  validateSpan,
} from "../../../../outbound/calendar/form.js";

const BOOK_JSON = JSON.stringify({
  attendees: ["A@X.test", "a@x.test"],
  end: "2026-09-20T10:30",
  start: "2026-09-20T10:00",
  title: "Sync",
});

describe("parseCalendarBookForm", () => {
  it("takes the whole form, lowercases and deduplicates attendees, and defaults meet to true when anyone is invited", () => {
    const form = unwrap(parseCalendarBookForm({ json: BOOK_JSON }));
    expect(form.kind).toBe("book");
    expect(form.title).toBe("Sync");
    expect(form.attendees).toStrictEqual(["a@x.test"]);
    expect(form.meet).toBe(true);
    expect(form.span).toStrictEqual({
      allDay: false,
      end: "2026-09-20T10:30",
      start: "2026-09-20T10:00",
      zone: undefined,
    });
  });

  it("leaves meet off when nobody is invited", () => {
    const form = unwrap(
      parseCalendarBookForm({
        json: JSON.stringify({ end: "2026-09-20T10:30", start: "2026-09-20T10:00", title: "Focus" }),
      }),
    );
    expect(form.meet).toBe(false);
    expect(form.attendees).toStrictEqual([]);
    expect(form.span.allDay).toBe(false);
  });

  it("keeps an explicit meet and allDay over their defaults", () => {
    const form = unwrap(
      parseCalendarBookForm({
        json: JSON.stringify({
          allDay: true,
          attendees: ["a@x.test"],
          end: "2026-09-20",
          meet: false,
          start: "2026-09-20",
          title: "Offsite",
        }),
      }),
    );
    expect(form.meet).toBe(false);
    expect(form.span.allDay).toBe(true);
  });

  it("names a problem with the whole document as `(root)`", () => {
    expect(unwrapErr(parseCalendarBookForm({ json: "[]" }))[0]).toContain("(root): ");
  });

  it("REFUSES an unrecognised key rather than dropping it, naming the nearest real field", () => {
    const problems = unwrapErr(
      parseCalendarBookForm({
        json: JSON.stringify({ end: "2026-09-20T10:30", start: "2026-09-20T10:00", tittle: "Sync", title: "Sync" }),
      }),
    );
    expect(problems.join(" ")).toContain("tittle");
  });

  it("refuses a start that is not a wall-clock minute, and one an offset was written into", () => {
    expect(
      unwrapErr(
        parseCalendarBookForm({ json: JSON.stringify({ end: "2026-09-20T10:30", start: "10am", title: "x" }) }),
      )[0],
    ).toContain("start must be YYYY-MM-DDTHH:MM");
    expect(
      unwrapErr(
        parseCalendarBookForm({
          json: JSON.stringify({ end: "2026-09-20T10:30", start: "2026-09-20T10:00:00+10:00", title: "x" }),
        }),
      )[0],
    ).toContain("start must be YYYY-MM-DDTHH:MM");
  });

  it("refuses an empty title and a non-address attendee", () => {
    expect(
      unwrapErr(
        parseCalendarBookForm({
          json: JSON.stringify({ end: "2026-09-20T10:30", start: "2026-09-20T10:00", title: "  " }),
        }),
      )[0],
    ).toBe("title must not be empty");
    expect(
      unwrapErr(
        parseCalendarBookForm({
          json: JSON.stringify({
            attendees: ["tobias"],
            end: "2026-09-20T10:30",
            start: "2026-09-20T10:00",
            title: "x",
          }),
        }),
      )[0],
    ).toBe("attendee is not an email address: tobias");
  });

  it("reports the JSON syntax error in the caller's own terms", () => {
    expect(unwrapErr(parseCalendarBookForm({ json: "{" }))[0]).toContain("--form is not valid JSON");
  });
});

describe("validateSpan", () => {
  it("refuses an end at or before the start, and accepts one all-day day", () => {
    expect(
      unwrapErr(
        validateSpan({ allDay: false, end: "2026-09-20T10:00", start: "2026-09-20T10:00", zone: undefined }),
      )[0],
    ).toBe("end (2026-09-20T10:00) is not after start (2026-09-20T10:00)");
    expect(unwrap(validateSpan({ allDay: true, end: "2026-09-20", start: "2026-09-20", zone: undefined })).allDay).toBe(
      true,
    );
  });

  it("demands bare dates under allDay and refuses a wall-clock one", () => {
    expect(
      unwrapErr(validateSpan({ allDay: true, end: "2026-09-21T00:00", start: "2026-09-20", zone: undefined }))[0],
    ).toContain("end must be YYYY-MM-DD (allDay)");
  });
});

describe("normaliseAttendees", () => {
  it("keeps the first spelling of a repeated address and reports every bad one", () => {
    expect(unwrap(normaliseAttendees({ attendees: [" B@x.test ", "b@x.test", "c@x.test"] }))).toStrictEqual([
      "b@x.test",
      "c@x.test",
    ]);
    expect(unwrapErr(normaliseAttendees({ attendees: ["@x.test", "a@"] }))).toStrictEqual([
      "attendee is not an email address: @x.test",
      "attendee is not an email address: a@",
    ]);
  });
});

describe("the other three forms", () => {
  it("refuses an edit that names nothing to change", () => {
    expect(unwrapErr(parseCalendarEditForm({ json: "{}" }))[0]).toBe(
      "an edit must name at least one of title, description, location, attendees",
    );
  });

  it("takes an edit that empties the attendee list, which is a real change", () => {
    expect(unwrap(parseCalendarEditForm({ json: JSON.stringify({ attendees: [] }) })).attendees).toStrictEqual([]);
  });

  it("takes a reschedule's span and refuses an unknown response", () => {
    expect(
      unwrap(
        parseCalendarRescheduleForm({ json: JSON.stringify({ end: "2026-09-20T11:00", start: "2026-09-20T10:30" }) }),
      ).span.start,
    ).toBe("2026-09-20T10:30");
    expect(
      unwrap(
        parseCalendarRescheduleForm({ json: JSON.stringify({ end: "2026-09-21", start: "2026-09-21", allDay: true }) }),
      ).span.allDay,
    ).toBe(true);
    expect(unwrapErr(parseCalendarRespondForm({ json: JSON.stringify({ response: "maybe" }) })).join(" ")).toContain(
      "response",
    );
  });

  it("dispatches by verb, and gives cancel its form without reading any JSON", () => {
    expect(unwrap(parseCalendarWriteForm({ json: undefined, verb: "cancel" }))).toStrictEqual({ kind: "cancel" });
    expect(unwrap(parseCalendarWriteForm({ json: BOOK_JSON, verb: "book" })).kind).toBe("book");
    expect(unwrapErr(parseCalendarWriteForm({ json: undefined, verb: "book" }))[0]).toBe("book needs --form");
  });
});
