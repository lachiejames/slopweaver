/**
 * `handover park` refuses a row whose seat the owner's standing-session ruling keeps open, and says so through the hatch row —
 * the pure half, every journal built inline.
 */
import { describe, expect, it } from "vitest";

import { parkFailureLines } from "../../../cli/commands/handover/parkFailure.js";
import { standingSessionRefusal } from "../../../cli/commands/handover/parkRunJournal.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { hatchFor } from "../../../hatch/lookup.js";

const NOW = "2026-11-04T03:00:00.000Z";
const AT = "2026-11-04T00:34:48.998Z";

/** The owner's standing-session ruling, bounded or not. */
function standing({ untilIso }: { untilIso?: string } = {}): RunEvent {
  return {
    anchor: "talk:p9",
    atIso: AT,
    decidedIso: AT,
    kind: "ruling",
    ruling: "keep that session open for me",
    standingSession: untilIso === undefined ? {} : { untilIso },
  };
}

describe("standingSessionRefusal", () => {
  it("refuses a park while the ruling holds, and lets it through with the hatch open, past the bound, or unruled", () => {
    expect([
      standingSessionRefusal({ events: [standing()], hatchOpen: false, nowIso: NOW }),
      standingSessionRefusal({ events: [standing()], hatchOpen: true, nowIso: NOW }),
      standingSessionRefusal({ events: [standing({ untilIso: NOW })], hatchOpen: false, nowIso: NOW }),
      standingSessionRefusal({ events: [], hatchOpen: false, nowIso: NOW }),
    ]).toEqual([
      {
        kind: "standing-session",
        why: "the owner's standing-session ruling keeps this seat open until the owner ends it (anchor talk:p9)",
      },
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("parkFailureLines — a standing session", () => {
  it("names the row and the ruling, and offers the standing-session hatch rather than the one it was handed", () => {
    const lines = parkFailureLines({
      failure: {
        kind: "standing-session",
        why: "the owner's standing-session ruling keeps this seat open until they end it",
      },
      hatch: hatchFor({ id: "park-running-seat" }),
      slug: "owner-seat",
    });
    expect([
      lines[0],
      lines.some((line) => line.includes("SLOPWEAVER_ALLOW_PARK_STANDING_SESSION=1")),
      lines.some((line) => line.includes("PARK_RUNNING_SEAT")),
    ]).toEqual([
      expect.stringContaining("owner-seat: the owner's standing-session ruling keeps this seat open until they end it"),
      true,
      false,
    ]);
  });
});
