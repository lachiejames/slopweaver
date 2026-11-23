/*
 * `evaluateFleetUnhealthy` in the owner's morning: when the note is re-cut over news, held after the owner's Done when
 * the same rows fail, re-cut when its card closed and a newer one waits, and shown on deaths that have run clean.
 */
import { describe, expect, it } from "vitest";

import { evaluateFleetUnhealthy, fleetHealthWhat } from "../../../../monitor/fleetHealth.js";
import type { MonitorReading, MonitorSubject } from "../../../../monitor/types.js";

import { BOT_CLEAR, DIED_BY_LEASE, many, NO_FATES, probed, subjectOf } from "../fleetHealthFixtures.js";
import { TWO_BROKEN } from "./harness.js";

/**
 * The one subject's delivery off a reading that must be firing.
 *
 * @param reading the reading
 * @returns its subject's delivery
 */
function deliveryOf({ reading }: { reading: MonitorReading }): MonitorSubject["delivery"] {
  return subjectOf({ reading }).delivery;
}

describe("evaluateFleetUnhealthy", () => {
  /** The instant is 09:37 in Melbourne, and every attempt above is still inside the day. */
  const MORNING = "2026-09-29T23:37:00.000Z";

  it("re-cuts the note in the owner's morning when there is news, even over an open card", () => {
    const reading = evaluateFleetUnhealthy({
      inputs: {
        attempts: TWO_BROKEN,
        blindSpot: undefined,
        bot: BOT_CLEAR,
        fates: NO_FATES,
        listenerNeverArmed: false,
        noteUp: false,
        repairing: 0,
        shown: undefined,
      },
      nowIso: MORNING,
    });
    expect(deliveryOf({ reading })).toEqual({ kind: "recut" });
  });

  it("holds the note, after the owner's Done, when the same rows are failing as on the last one", () => {
    const reading = evaluateFleetUnhealthy({
      inputs: {
        attempts: TWO_BROKEN,
        blindSpot: undefined,
        bot: BOT_CLEAR,
        fates: NO_FATES,
        listenerNeverArmed: false,
        noteUp: false,
        repairing: 0,
        shown: {
          botDown: false,
          broken: ["atlas-hex", "resync-corpus-slack"],
          shownIso: "2026-09-29T22:00:00.000Z",
          signals: ["syncs", "deaths"],
          yours: [],
        },
      },
      nowIso: MORNING,
    });
    expect(deliveryOf({ reading })).toEqual({
      kind: "hold",
      why: "nothing changed since the note at 22:00Z — the same rows are failing",
    });
  });

  it("re-cuts the note still up when the card its button opens closed and a newer one waits, remembering the new one", () => {
    const reading = evaluateFleetUnhealthy({
      inputs: {
        attempts: TWO_BROKEN,
        blindSpot: undefined,
        bot: BOT_CLEAR,
        fates: new Map([
          [
            "atlas-hex",
            {
              kind: "needs-you" as const,
              step: {
                act: "sign in to app.hex.tech",
                card: "mon-signin-app-hex-tech.2",
                more: 0,
                place: { kind: "work-chrome" as const },
              },
            },
          ],
        ]),
        listenerNeverArmed: false,
        noteUp: true,
        repairing: 0,
        shown: {
          botDown: false,
          broken: ["atlas-hex", "resync-corpus-slack"],
          shownIso: "2026-09-29T22:00:00.000Z",
          signals: ["syncs", "deaths"],
          yours: ["atlas-hex mon-signin-app-hex-tech"],
        },
      },
      nowIso: MORNING,
    });
    const subject = subjectOf({ reading });
    expect([subject.delivery, subject.fleet!.delta.handMoved, subject.fleet!.shown.yours]).toEqual([
      { kind: "recut" },
      ["atlas-hex"],
      ["atlas-hex mon-signin-app-hex-tech.2"],
    ]);
  });

  it("shows deaths whose rows have all run clean since — the trip is the news, the deaths are the lines", () => {
    // MEASURED on the owner's home: 9 died mid-run in the day, every one on a recipe whose newest run
    // succeeded, so no row was failing and a delta of rows alone would have held the first note forever.
    const reading = evaluateFleetUnhealthy({
      inputs: {
        attempts: [
          ...many({ count: 2, shape: { ...DIED_BY_LEASE, recipeId: "resync-corpus-slack" } }),
          probed({ recipeId: "resync-corpus-slack", startedAtIso: "2026-09-29T14:00:00.000Z" }),
          ...many({ count: 20, shape: { recipeId: "atlas-linear" } }),
        ],
        blindSpot: undefined,
        bot: BOT_CLEAR,
        fates: NO_FATES,
        listenerNeverArmed: false,
        noteUp: false,
        repairing: 0,
        shown: undefined,
      },
      nowIso: MORNING,
    });
    const subject = subjectOf({ reading });
    expect(subject.delivery).toEqual({ kind: "recut" });
    expect(subject.details).toEqual([
      "PAST  resync-corpus-slack — 13h ago, 2× in 24h: died mid-run, never settled before its lease ran out; ran clean since",
    ]);
    expect(fleetHealthWhat({ delta: subject.fleet!.delta, signals: ["deaths"] })).toBe(
      "Check fleet health — syncs are dying mid-run",
    );
  });
});
