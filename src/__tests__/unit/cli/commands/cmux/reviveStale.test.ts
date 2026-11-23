/**
 * Whether a `cmux revive` reading is fresh enough to journal: the journal's newest sequence against the one read before
 * the probe, then the reading's stamp against the clock, over an in-memory fleet store.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { staleReadingExit } from "../../../../../cli/commands/cmux/reviveStale.js";
import type { CmuxReading } from "../../../../../cmux/reviveJournal.js";
import { memoryFleetPort, unavailableFleetPort } from "../../../../fleetStoreFixture.js";

const HOME = "/home/fixture-revive-stale";

const READING: CmuxReading = {
  appPid: 5088,
  appStart: "Sat Oct 10 08:00:00 2026",
  atIso: "2026-10-10T10:59:00.000Z",
  detail: "answering",
  kind: "reading",
  schemaVersion: 1,
  state: "answering",
};

describe("staleReadingExit", () => {
  it("lets a reading through when the journal has not moved and its stamp is seconds off the clock", async () => {
    const fleet = memoryFleetPort();
    const sequenceBeforeProbe = unwrap(await fleet.newestCmuxReviveSequence({ home: HOME }));
    const clock = (): string => "2026-10-10T10:59:05.000Z";
    expect([
      sequenceBeforeProbe,
      await staleReadingExit({ clock, fleet, home: HOME, reading: READING, sequenceBeforeProbe }),
    ]).toEqual([0, undefined]);
  });

  it("defers a reading once anything was journalled after the probe began, however close its stamp", async () => {
    const fleet = memoryFleetPort();
    const sequenceBeforeProbe = unwrap(await fleet.newestCmuxReviveSequence({ home: HOME }));
    unwrap(
      await fleet.appendCmuxReviveEvent({
        event: { ...READING, atIso: "2026-10-10T10:58:10.000Z", state: "stalled" },
        home: HOME,
      }),
    );
    const clock = (): string => "2026-10-10T10:58:20.000Z";
    expect(await staleReadingExit({ clock, fleet, home: HOME, reading: READING, sequenceBeforeProbe })).toBe(4);
  });

  it("defers a reading stamped more than a minute off the clock, either way", async () => {
    const fleet = memoryFleetPort();
    const sequenceBeforeProbe = unwrap(await fleet.newestCmuxReviveSequence({ home: HOME }));
    const late = (): string => "2026-10-10T11:00:01.000Z";
    const early = (): string => "2026-10-10T10:57:59.000Z";
    expect([
      await staleReadingExit({ clock: late, fleet, home: HOME, reading: READING, sequenceBeforeProbe }),
      await staleReadingExit({ clock: early, fleet, home: HOME, reading: READING, sequenceBeforeProbe }),
    ]).toEqual([4, 4]);
  });

  it("exits 1 when the store cannot answer the journal's newest sequence", async () => {
    const clock = (): string => "2026-10-10T10:59:05.000Z";
    const code = await staleReadingExit({
      clock,
      fleet: unavailableFleetPort(),
      home: HOME,
      reading: READING,
      sequenceBeforeProbe: 0,
    });
    expect(code).toBe(1);
  });
});
