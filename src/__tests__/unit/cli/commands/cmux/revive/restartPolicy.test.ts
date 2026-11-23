/*
 * `cmux revive`'s restart policy over refused readings: a hang inside the bound is waited out, one held past it is
 * restarted and the restart journalled, a second inside the cooldown is held, and a hang recurring after a restart
 * is named once, restarted once more and held the third time.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { reviveExit, revivePass } from "../../../../../../cli/commands/cmux/revive.js";
import type { PsRow } from "../../../../../../cmux/appProcess.js";
import { acquireCmuxReviveLock } from "../../../../../../fleet/locks.js";
import { memoryFleetPort } from "../../../../../fleetStoreFixture.js";
import { APP, deps, freshHome, kinds, REFUSED, request, seedRefused, useFreshHomes } from "./harness.js";

const REOPENED: PsRow = { ...APP, pid: 24622, start: "Sat Oct 10 10:11:30 2026" };

useFreshHomes();

describe("cmux revive", () => {
  it("waits out a hang still inside the bound", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    await seedRefused({ fleet, home, minutes: [0, 5] });
    const report = await revivePass({
      deps: deps({ fleet, knock: REFUSED, minute: 6, rows: [APP] }),
      request: request({ home }),
    });
    expect(report).toEqual({
      action: "wait",
      appPid: 5088,
      detail: "ECONNREFUSED on cmux.sock",
      sinceIso: "2026-10-10T10:00:00.000Z",
      state: "refused",
    });
    expect(reviveExit({ report: report as Exclude<typeof report, number> })).toBe(4);
  });

  it("restarts a hang held past the bound, journalling the restart's start and finish", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    await seedRefused({ fleet, home, minutes: [0, 5, 10] });
    const restarts: number[] = [];
    const report = await revivePass({
      deps: deps({ fleet, knock: REFUSED, minute: 11, restarts, rows: [APP] }),
      request: request({ home }),
    });
    expect(restarts).toEqual([5088]);
    expect(report).toEqual({
      action: "restart",
      appPid: 5088,
      detail: "ECONNREFUSED on cmux.sock",
      restart: { detail: "quit on TERM; reopened as pid 24622", newAppPid: 24622, outcome: "answering" },
      sinceIso: "2026-10-10T10:00:00.000Z",
      state: "refused",
    });
    expect(reviveExit({ report: report as Exclude<typeof report, number> })).toBe(0);
    expect(await kinds({ fleet, home })).toEqual([
      "reading",
      "reading",
      "reading",
      "reading",
      "restart-started",
      "restart-finished",
    ]);
  });

  it("holds a second restart inside the cooldown", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    await seedRefused({ fleet, home, minutes: [0, 5, 10] });
    await revivePass({
      deps: deps({ fleet, knock: REFUSED, minute: 11, rows: [APP] }),
      request: request({ home }),
    });
    await seedRefused({ app: REOPENED, fleet, home, minutes: [12, 17] });
    const restarts: number[] = [];
    const report = await revivePass({
      deps: deps({ fleet, knock: REFUSED, minute: 22, restarts, rows: [REOPENED] }),
      request: request({ home }),
    });
    expect(restarts).toEqual([]);
    expect(report).toEqual({
      action: "held",
      appPid: 24622,
      detail: "ECONNREFUSED on cmux.sock",
      heldAs: "cooldown",
      sinceIso: "2026-10-10T10:12:00.000Z",
      state: "refused",
      untilIso: "2026-10-10T10:41:00.000Z",
    });
  });

  it("names a hang recurring after a restart once, restarts it once more, and holds the third", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    const restarts: number[] = [];
    await seedRefused({ fleet, home, minutes: [0, 5, 10] });
    await revivePass({
      deps: deps({ fleet, knock: REFUSED, minute: 11, restarts, rows: [APP] }),
      request: request({ home }),
    });
    await seedRefused({ app: REOPENED, fleet, home, minutes: [30, 35] });
    await revivePass({
      deps: deps({ fleet, knock: REFUSED, minute: 40, restarts, rows: [REOPENED] }),
      request: request({ dryRun: true, home }),
    });
    const afterDryRun = (await kinds({ fleet, home })).filter((kind) => kind === "recurring");
    await revivePass({
      deps: deps({ fleet, knock: REFUSED, minute: 40, restarts, rows: [REOPENED] }),
      request: request({ home }),
    });
    await revivePass({
      deps: deps({ fleet, knock: REFUSED, minute: 42, restarts, rows: [REOPENED] }),
      request: request({ home }),
    });
    const third: PsRow = { ...APP, pid: 32990, start: "Sat Oct 10 10:42:30 2026" };
    await seedRefused({ app: third, fleet, home, minutes: [45, 50, 55] });
    // Another revive holds the never-stale lock throughout: the hold's marker must still land.
    const other = unwrap(acquireCmuxReviveLock({ home, nowIso: "2026-10-10T10:55:30.000Z" }));
    const held = await revivePass({
      deps: deps({ fleet, knock: REFUSED, minute: 56, restarts, rows: [third] }),
      request: request({ home }),
    });
    other.release();
    const events = unwrap(await fleet.readCmuxReviveJournal({ home })).events;
    const recurring = events.filter((event) => event.kind === "recurring");
    expect(events.filter((event) => event.kind === "restart-held")).toEqual([
      {
        atIso: "2026-10-10T10:56:00.000Z",
        hungSinceIso: "2026-10-10T10:45:00.000Z",
        kind: "restart-held",
        schemaVersion: 1,
      },
    ]);
    expect(afterDryRun).toEqual([]);
    expect(restarts).toEqual([5088, 24622]);
    expect(recurring.map((event) => [event.hungSinceIso, event.afterRestartIso])).toEqual([
      ["2026-10-10T10:30:00.000Z", "2026-10-10T10:11:00.000Z"],
      ["2026-10-10T10:45:00.000Z", "2026-10-10T10:42:00.000Z"],
    ]);
    expect(held).toEqual({
      action: "held",
      appPid: 32990,
      detail: "ECONNREFUSED on cmux.sock",
      heldAs: "recurring",
      sinceIso: "2026-10-10T10:45:00.000Z",
      state: "refused",
    });
  });
});
