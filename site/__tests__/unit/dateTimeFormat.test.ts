/*
 * One formatter per locale and options for the page's life (`site/lib/dateTimeFormat.ts`): a construction is what ran
 * the voice overlay's renderer out of memory, so asking again must hand back the same instance, and
 * nothing it words may change.
 */
import { describe, expect, it } from "vitest";

import { dateTimeFormatOf, readerTimeZone } from "../../lib/dateTimeFormat";

const SYDNEY = "Australia/Sydney";

describe("dateTimeFormatOf", () => {
  it("hands back the same formatter for the same locale and options", () => {
    const first = dateTimeFormatOf({
      locale: "en-AU",
      options: { hour: "numeric", minute: "2-digit", timeZone: SYDNEY },
    });
    const again = dateTimeFormatOf({
      locale: "en-AU",
      options: { hour: "numeric", minute: "2-digit", timeZone: SYDNEY },
    });
    expect(again).toBe(first);
  });

  it("keys options by name, so the order they were written in shares one", () => {
    const written = dateTimeFormatOf({
      locale: "en-AU",
      options: { minute: "2-digit", hour: "numeric", timeZone: SYDNEY },
    });
    const sorted = dateTimeFormatOf({
      locale: "en-AU",
      options: { hour: "numeric", minute: "2-digit", timeZone: SYDNEY },
    });
    expect(written).toBe(sorted);
  });

  it("keys an option left undefined as absent", () => {
    const absent = dateTimeFormatOf({ locale: "en-AU", options: { day: "numeric", timeZone: SYDNEY } });
    const undefinedYear = dateTimeFormatOf({
      locale: "en-AU",
      options: { day: "numeric", timeZone: SYDNEY, year: undefined },
    });
    expect(undefinedYear).toBe(absent);
  });

  it("makes another formatter for other options", () => {
    const clock = dateTimeFormatOf({ locale: "en-AU", options: { hour: "numeric", timeZone: SYDNEY } });
    const day = dateTimeFormatOf({ locale: "en-AU", options: { day: "numeric", timeZone: SYDNEY } });
    expect(day).not.toBe(clock);
  });

  it("makes another formatter for another time zone", () => {
    const sydney = dateTimeFormatOf({ locale: "en-AU", options: { hour: "numeric", timeZone: SYDNEY } });
    const utc = dateTimeFormatOf({ locale: "en-AU", options: { hour: "numeric", timeZone: "UTC" } });
    expect(utc).not.toBe(sydney);
  });

  it("makes another formatter for another locale", () => {
    const au = dateTimeFormatOf({ locale: "en-AU", options: { month: "short", timeZone: SYDNEY } });
    const us = dateTimeFormatOf({ locale: "en-US", options: { month: "short", timeZone: SYDNEY } });
    expect(us).not.toBe(au);
  });

  it("words an instant exactly as a fresh formatter does", () => {
    const at = Date.parse("2026-10-25T12:43:23.000Z");
    const options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", timeZone: SYDNEY, year: "numeric" };
    expect(dateTimeFormatOf({ locale: "en-CA", options }).format(at)).toBe("2026-10-25");
    expect(dateTimeFormatOf({ locale: "en-CA", options }).format(at)).toBe(
      new Intl.DateTimeFormat("en-CA", options).format(at),
    );
  });
});

describe("readerTimeZone", () => {
  it("is the zone the runtime's default formatter resolves", () => {
    expect(readerTimeZone()).toBe(new Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});
