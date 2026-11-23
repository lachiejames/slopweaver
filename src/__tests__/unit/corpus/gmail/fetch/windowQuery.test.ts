/**
 * `windowQuery`: the crawl window rendered as Gmail's own date operators, never inverted.
 */
import { describe, expect, it } from "vitest";

import { windowQuery } from "../../../../../corpus/gmail/fetch.js";

describe("windowQuery", () => {
  it("bounds the crawl with Gmail's own date operators", () => {
    expect(windowQuery({ window: { since: "2026-08-01T00:00:00Z", until: "2026-08-28" } })).toBe(
      "after:2026-08-01 before:2026-08-28",
    );
  });

  it("does not emit an INVERTED window, which would ask Gmail for nothing and be told nothing", () => {
    // A message with a future internalDate pushes the pooled cursor past `until`, and the run's own window
    // line then reads `since..until` with since after until.
    expect(windowQuery({ window: { since: "2026-08-28", until: "2026-08-27" } })).toBe(
      "after:2026-08-27 before:2026-08-27",
    );
  });
});
