/*
 * The Fleet page's plan usage wording helpers: a token count at three significant figures, and a reset measured from
 * the reading's own instant.
 */
import { describe, expect, it } from "vitest";

import { resetWords, tokenWords } from "../../lib/planMetersWords";

/** The reading's own instant, every reset measured from it. */
const NOW = "2026-10-06T02:00:00.000Z";

describe("tokenWords", () => {
  it("keeps three significant figures past a thousand and the bare count below it", () => {
    expect([812, 12_430, 3_145_200, 311_000_000, 51_091_613_266].map((count) => tokenWords({ count }))).toEqual([
      "812",
      "12.4k",
      "3.15M",
      "311M",
      "51.1B",
    ]);
  });
});

describe("resetWords", () => {
  const nowMs = Date.parse(NOW);

  it("measures a reset from the reading's instant in days, hours or minutes, never under a minute", () => {
    expect(
      [
        "2026-10-08T05:30:00.000Z",
        "2026-10-06T03:00:00.000Z",
        "2026-10-06T02:12:00.000Z",
        "2026-10-06T02:00:20.000Z",
      ].map((resetAtIso) => resetWords({ nowMs, resetAtIso })),
    ).toEqual(["resets in 2d 3h", "resets in 1h 0m", "resets in 12m", "resets in 1m"]);
  });

  it("says a window had reset by the reading when its instant is not after it", () => {
    expect([NOW, "2026-10-05T23:00:00.000Z"].map((resetAtIso) => resetWords({ nowMs, resetAtIso }))).toEqual([
      "had reset by this reading",
      "had reset by this reading",
    ]);
  });

  it("says so when no reset was named, or the instant will not parse", () => {
    expect([
      resetWords({ nowMs, resetAtIso: undefined }),
      resetWords({ nowMs, resetAtIso: "next tuesday" }),
      resetWords({ nowMs: Number.NaN, resetAtIso: NOW }),
    ]).toEqual(["no reset named", "reset time unreadable", "reset time unreadable"]);
  });
});
