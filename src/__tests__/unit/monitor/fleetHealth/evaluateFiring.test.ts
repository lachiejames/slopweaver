/*
 * `evaluateFleetUnhealthy` reading the window: clear when nothing trips, blind spots reported rather than
 * tripped, the ONE subject a firing reading carries, and the listener behind the disclosure when the bot is down.
 */
import { describe, expect, it } from "vitest";

import { evaluateFleetUnhealthy } from "../../../../monitor/fleetHealth.js";
import type { MonitorReading } from "../../../../monitor/types.js";

import { BOT_CLEAR, DIED_BY_LEASE, FAILED, many, NO_FATES, NOW, probed } from "../fleetHealthFixtures.js";
import { TWO_BROKEN } from "./harness.js";

const BOT_DOWN: MonitorReading = {
  monitorId: "bot-off-the-air",
  state: "firing",
  subjects: [{ id: "the Slack listener", key: "down", label: "the listener has been off the air for 3h" }],
};

describe("evaluateFleetUnhealthy", () => {
  it("reads clear when nothing trips, even with a failure or a death in the window", () => {
    const reading = evaluateFleetUnhealthy({
      inputs: {
        attempts: [...many({ count: 20, shape: {} }), probed({ outcome: FAILED }), probed(DIED_BY_LEASE)],
        blindSpot: undefined,
        bot: BOT_CLEAR,
        fates: NO_FATES,
        listenerNeverArmed: false,
        noteUp: false,
        repairing: 0,
        shown: undefined,
      },
      nowIso: NOW,
    });
    expect(reading).toEqual({ monitorId: "fleet-unhealthy", state: "clear" });
  });

  it("reports an unmeasurable listener and an unread ledger file as blind spots, never as a trip", () => {
    const deathsLine =
      "NEW   resync-corpus-slack — 5h ago, 2× in 24h: died mid-run, never settled before its lease ran out";
    const reading = evaluateFleetUnhealthy({
      inputs: {
        attempts: many({ count: 2, shape: DIED_BY_LEASE }),
        blindSpot: "1 slot-attempt file(s) did not read",
        bot: { because: "no heartbeat file", monitorId: "bot-off-the-air", state: "unmeasurable" },
        fates: NO_FATES,
        listenerNeverArmed: false,
        noteUp: false,
        repairing: 0,
        shown: undefined,
      },
      nowIso: NOW,
    });
    expect(reading).toEqual({
      blindSpot: "1 slot-attempt file(s) did not read; the listener could not be judged: no heartbeat file",
      monitorId: "fleet-unhealthy",
      state: "firing",
      subjects: [
        {
          checkIn: true,
          delivery: {
            kind: "hold",
            why: "news waits for the morning — notes go up 7:00–22:00 Australia/Melbourne",
          },
          details: [deathsLine],
          detailsInFull: [deathsLine],
          fleet: {
            delta: {
              bot: "up",
              handMoved: [],
              newlyFailing: ["resync-corpus-slack"],
              recovered: [],
              stillFailing: [],
              tripped: ["deaths"],
              untripped: [],
            },
            shown: { botDown: false, broken: ["resync-corpus-slack"], shownIso: NOW, signals: ["deaths"], yours: [] },
          },
          id: "fleet health",
          key: "deaths",
          label:
            "as of 15:37Z, 2 of 2 scheduled runs in 24h failed, 2 died mid-run; no seat has a repair yet; " +
            "Done or Later: the next note comes only when something changes",
        },
      ],
    });
  });

  /** {@link NOW} is 01:37 in Melbourne: every case at it holds for the owner's morning. */
  const NIGHT_HOLD = {
    kind: "hold",
    why: "news waits for the morning — notes go up 7:00–22:00 Australia/Melbourne",
  } as const;

  it("fires ONE subject: what changed, every failing row behind the disclosure, what is being done", () => {
    const reading = evaluateFleetUnhealthy({
      inputs: {
        attempts: TWO_BROKEN,
        blindSpot: undefined,
        bot: BOT_CLEAR,
        fates: NO_FATES,
        listenerNeverArmed: false,
        noteUp: false,
        repairing: 1,
        shown: undefined,
      },
      nowIso: NOW,
    });
    expect(reading).toEqual({
      monitorId: "fleet-unhealthy",
      state: "firing",
      subjects: [
        {
          checkIn: true,
          delivery: NIGHT_HOLD,
          details: [
            "NEW   atlas-hex — 3h ago, 2× in 24h: exit 1",
            "NEW   resync-corpus-slack — 5h ago, 2× in 24h: died mid-run, never settled before its lease ran out",
          ],
          detailsInFull: [
            "NEW   atlas-hex — 3h ago, 2× in 24h: exit 1",
            "NEW   resync-corpus-slack — 5h ago, 2× in 24h: died mid-run, never settled before its lease ran out",
          ],
          fleet: {
            delta: {
              bot: "up",
              handMoved: [],
              newlyFailing: ["atlas-hex", "resync-corpus-slack"],
              recovered: [],
              stillFailing: [],
              tripped: ["syncs", "deaths"],
              untripped: [],
            },
            shown: {
              botDown: false,
              broken: ["atlas-hex", "resync-corpus-slack"],
              shownIso: NOW,
              signals: ["syncs", "deaths"],
              yours: [],
            },
          },
          id: "fleet health",
          key: "syncs-deaths",
          label:
            "as of 15:37Z, 4 of 10 scheduled runs in 24h failed, 2 died mid-run; 1 in repair by a seat; " +
            "Done or Later: the next note comes only when something changes",
        },
      ],
    });
  });

  it("puts the listener behind the disclosure and drops the check-in when the bot is down", () => {
    const reading = evaluateFleetUnhealthy({
      inputs: {
        attempts: [],
        blindSpot: undefined,
        bot: BOT_DOWN,
        fates: NO_FATES,
        listenerNeverArmed: false,
        noteUp: false,
        repairing: 0,
        shown: undefined,
      },
      nowIso: NOW,
    });
    expect(reading).toEqual({
      monitorId: "fleet-unhealthy",
      state: "firing",
      subjects: [
        {
          delivery: NIGHT_HOLD,
          details: ["NEW   the bot off Slack — the listener has been off the air for 3h"],
          detailsInFull: ["NEW   the bot off Slack — the listener has been off the air for 3h"],
          fleet: {
            delta: {
              bot: "down",
              handMoved: [],
              newlyFailing: [],
              recovered: [],
              stillFailing: [],
              tripped: [],
              untripped: [],
            },
            shown: { botDown: true, broken: [], shownIso: NOW, signals: [], yours: [] },
          },
          id: "fleet health",
          key: "bot",
          label:
            "as of 15:37Z, 0 of 0 scheduled runs in 24h failed, 0 died mid-run; no seat has a repair yet; " +
            "Done or Later: the next note comes only when something changes",
        },
      ],
    });
  });
});
