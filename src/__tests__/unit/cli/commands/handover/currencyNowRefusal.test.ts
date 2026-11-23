import { describe, expect, it } from "vitest";

import { currencyNowRefusal } from "../../../../../cli/commands/handover/currencyArgs.js";

const WALL_MS = Date.parse("2026-11-05T08:00:00.000Z");

describe("currencyNowRefusal", () => {
  it("refuses a --now later than the wall clock, so a reading cannot claim an interval it never read", () => {
    expect(currencyNowRefusal({ now: "2026-11-06T00:00:00.000Z", wallMs: WALL_MS })).toBe(
      "--now 2026-11-06T00:00:00.000Z is later than the wall clock: a reading may not claim sources were read at an instant that has not happened yet",
    );
  });

  it("lets a --now earlier than the wall clock stand, a replay fixture's stopped clock", () => {
    expect(currencyNowRefusal({ now: "2026-11-03T09:00:00.000Z", wallMs: WALL_MS })).toBe(undefined);
  });

  it("lets a --now exactly at the wall clock stand", () => {
    expect(currencyNowRefusal({ now: "2026-11-05T08:00:00.000Z", wallMs: WALL_MS })).toBe(undefined);
  });

  it("refuses a --now that is not an instant", () => {
    expect(currencyNowRefusal({ now: "tomorrow", wallMs: WALL_MS })).toBe("--now tomorrow is not an ISO-8601 instant");
  });
});
