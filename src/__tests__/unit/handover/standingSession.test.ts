/**
 * Which ruling makes a row's seat a standing session, and whether it holds at an instant — pure, every journal
 * built inline.
 */
import { describe, expect, it } from "vitest";

import { runDisposition } from "../../../handover/boardTypes.js";
import type { RulingEvent, RunEvent } from "../../../handover/ledger.js";
import {
  standingSessionHolds,
  standingSessionInForce,
  standingSessionLine,
  standingSessionRuling,
} from "../../../handover/standingSession.js";
import type { StandingSession } from "../../../handover/standingSessionTypes.js";

const NOW = "2026-11-04T03:00:00.000Z";

/** A live ruling decided at `decidedIso`, standing when `standingSession` is given. */
function ruling({
  decidedIso,
  standingSession,
  words = "keep that session open for me",
}: {
  decidedIso: string;
  standingSession?: StandingSession;
  words?: string;
}): RulingEvent {
  return {
    anchor: `talk:${decidedIso}`,
    atIso: decidedIso,
    decidedIso,
    kind: "ruling",
    ruling: words,
    ...(standingSession === undefined ? {} : { standingSession }),
  };
}

const STARTED: RunEvent = { atIso: "2026-11-04T00:50:00.000Z", branch: "a-row", docHash: "h", kind: "started" };

describe("standingSessionRuling", () => {
  it("answers nothing for a journal with no standing-session ruling", () => {
    const events = [STARTED, ruling({ decidedIso: "2026-11-04T01:00:00.000Z" })];
    expect(standingSessionRuling({ events })).toBe(undefined);
  });

  it("is NOT ended by a later ordinary ruling — talking to the seat is what produces more rulings on its row", () => {
    const standing = ruling({ decidedIso: "2026-11-04T01:00:00.000Z", standingSession: {} });
    const later = ruling({ decidedIso: "2026-11-04T02:00:00.000Z", words: "enable slack in that seat" });
    expect(standingSessionRuling({ events: [STARTED, standing, later] })).toEqual(standing);
  });

  it("is replaced by a later standing-session ruling, by decision instant rather than append order", () => {
    const first = ruling({ decidedIso: "2026-11-04T01:00:00.000Z", standingSession: {} });
    const ended = ruling({ decidedIso: "2026-11-04T02:00:00.000Z", standingSession: { untilIso: NOW } });
    expect(standingSessionRuling({ events: [ended, first] })).toEqual(ended);
  });

  it("never reads a reconstruction, even one built in memory past the schema and decoder that refuse it", () => {
    const backfilled: RulingEvent = {
      ...ruling({ decidedIso: "2026-11-04T01:00:00.000Z", standingSession: {} }),
      backfilledFrom: "2026-11-04T01:00:00.000Z",
    };
    expect(standingSessionRuling({ events: [backfilled] })).toBe(undefined);
  });
});

describe("standingSessionHolds", () => {
  it("holds with no bound, holds strictly before its bound, and ends AT it", () => {
    const at = ({ untilIso }: { untilIso?: string }): boolean =>
      standingSessionHolds({
        nowIso: NOW,
        ruling: {
          ...ruling({ decidedIso: "2026-11-04T01:00:00.000Z" }),
          standingSession: untilIso === undefined ? {} : { untilIso },
        },
      });
    const bounds = [
      {},
      { untilIso: "2026-11-04T03:00:00.001Z" },
      { untilIso: NOW },
      { untilIso: "2026-11-04T02:59:59.999Z" },
    ];
    expect(bounds.map((bound) => at(bound))).toEqual([true, true, false, false]);
  });

  it("keeps the seat when the bound cannot be ordered — closing a seat the owner asked to keep is the costly mistake", () => {
    const standing = { ...ruling({ decidedIso: NOW }), standingSession: { untilIso: "not an instant" } };
    expect(standingSessionHolds({ nowIso: NOW, ruling: standing })).toBe(true);
  });
});

describe("standingSessionInForce", () => {
  it("answers the ruling while it holds, and nothing once a later ruling ended it", () => {
    const standing = ruling({ decidedIso: "2026-11-04T01:00:00.000Z", standingSession: {} });
    const ended = ruling({ decidedIso: "2026-11-04T02:00:00.000Z", standingSession: { untilIso: NOW } });
    expect([
      standingSessionInForce({ events: [STARTED, standing], nowIso: NOW }),
      standingSessionInForce({ events: [STARTED, standing, ended], nowIso: NOW }),
    ]).toEqual([standing, undefined]);
  });
});

describe("standingSessionLine", () => {
  it("names the bound and the anchor a reader checks", () => {
    const base = ruling({ decidedIso: "2026-11-04T01:00:00.000Z" });
    expect([
      standingSessionLine({ ruling: { ...base, standingSession: { untilIso: "2026-11-17T13:00:00.000Z" } } }),
      standingSessionLine({ ruling: { ...base, standingSession: {} } }),
    ]).toEqual([
      "the owner's standing-session ruling keeps this seat open until 2026-11-17T13:00:00.000Z (anchor talk:2026-11-04T01:00:00.000Z)",
      "the owner's standing-session ruling keeps this seat open until the owner ends it (anchor talk:2026-11-04T01:00:00.000Z)",
    ]);
  });
});

describe("runDisposition", () => {
  it("carries the standing-session ruling on an active run, beside its park", () => {
    const standing = ruling({ decidedIso: "2026-11-04T01:00:00.000Z", standingSession: {} });
    expect(runDisposition({ events: [STARTED, standing], unreadableLines: [] })).toEqual({
      kind: "active",
      standingSession: standing,
    });
  });

  it("carries nothing on a run the owner never made a standing session", () => {
    expect(runDisposition({ events: [STARTED], unreadableLines: [] })).toEqual({ kind: "active" });
  });
});
