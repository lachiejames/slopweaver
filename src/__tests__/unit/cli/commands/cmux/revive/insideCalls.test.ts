/*
 * `cmux revive` reads cmux's access refusal against the seats' own calls inside cmux: answering once one was answered,
 * unprobed when none has called this app or the last timeout is older than the reading gap, and the recurring hang —
 * the knock refused with access denied while every seat's call times out — restarted, its stamps written by the
 * real store.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { reviveExit, revivePass } from "../../../../../../cli/commands/cmux/revive.js";
import type { PsRow } from "../../../../../../cmux/appProcess.js";
import { type InsideCallOutcome, recordInsideCall } from "../../../../../../cmux/insideCalls.js";
import { memoryFleetPort } from "../../../../../fleetStoreFixture.js";
import { ANSWERED, APP, deps, freshHome, kinds, request, seedRefused, stampInside, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("cmux revive", () => {
  it("reads cmux's access refusal as answering once a seat's last call was answered, and exits 0", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    stampInside({ home, minute: 0, outcome: "answered" });
    const report = await revivePass({
      deps: deps({ fleet, knock: ANSWERED, minute: 1, rows: [APP] }),
      request: request({ home }),
    });
    expect(report).toEqual({
      action: "none",
      appPid: 5088,
      detail: "ERROR: Access denied; the last call inside cmux was answered at 2026-10-10T10:00:00.000Z",
      state: "answering",
    });
    expect(reviveExit({ report: report as Exclude<typeof report, number> })).toBe(0);
  });

  it("reads the access refusal as unprobed when no seat has called this app, and never restarts on it", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    // A timeout stamped before this app started is the previous app's.
    unwrap(recordInsideCall({ atIso: "2026-10-10T07:59:00.000Z", home, outcome: "unanswered" }));
    const restarts: number[] = [];
    let report: Awaited<ReturnType<typeof revivePass>> = 0;
    for (const minute of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      report = await revivePass({
        deps: deps({ fleet, knock: ANSWERED, minute, restarts, rows: [APP] }),
        request: request({ home }),
      });
    }
    expect(report).toEqual({
      action: "none",
      appPid: 5088,
      detail: "ERROR: Access denied; no call inside cmux since it started",
      state: "unprobed",
    });
    expect(restarts).toEqual([]);
    expect(await kinds({ fleet, home })).toEqual(["reading"]);
  });

  it("credits no app with a timeout from the second it started in, which ps cannot split", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    const started: PsRow = { ...APP, start: "Sat Oct 10 10:00:00 2026" };
    unwrap(recordInsideCall({ atIso: "2026-10-10T10:00:00.500Z", home, outcome: "unanswered" }));
    const report = await revivePass({
      deps: deps({ fleet, knock: ANSWERED, minute: 1, rows: [started] }),
      request: request({ home }),
    });
    expect(report).toEqual({
      action: "none",
      appPid: 5088,
      detail: "ERROR: Access denied; no call inside cmux since it started",
      state: "unprobed",
    });
  });

  it("restarts the hang: the knock refused with access denied while the seats' calls time out", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    const restarts: number[] = [];
    let report: Awaited<ReturnType<typeof revivePass>> = 0;
    for (const minute of [0, 4, 8, 11]) {
      stampInside({ home, minute, outcome: "unanswered" });
      report = await revivePass({
        deps: deps({ fleet, knock: ANSWERED, minute, restarts, rows: [APP] }),
        request: request({ home }),
      });
    }
    expect(restarts).toEqual([5088]);
    expect(report).toEqual({
      action: "restart",
      appPid: 5088,
      detail: "ERROR: Access denied; the last call inside cmux was unanswered at 2026-10-10T10:11:00.000Z",
      restart: { detail: "quit on TERM; reopened as pid 24622", newAppPid: 24622, outcome: "answering" },
      sinceIso: "2026-10-10T10:00:00.000Z",
      state: "stalled",
    });
  });

  it("breaks a stalled run when a seat's call is answered again", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    const restarts: number[] = [];
    for (const minute of [0, 4]) {
      stampInside({ home, minute, outcome: "unanswered" });
      await revivePass({
        deps: deps({ fleet, knock: ANSWERED, minute, restarts, rows: [APP] }),
        request: request({ home }),
      });
    }
    stampInside({ home, minute: 6, outcome: "answered" });
    await revivePass({
      deps: deps({ fleet, knock: ANSWERED, minute: 7, restarts, rows: [APP] }),
      request: request({ home }),
    });
    stampInside({ home, minute: 9, outcome: "unanswered" });
    const report = await revivePass({
      deps: deps({ fleet, knock: ANSWERED, minute: 11, restarts, rows: [APP] }),
      request: request({ home }),
    });
    expect(restarts).toEqual([]);
    expect(report).toEqual({
      action: "none",
      appPid: 5088,
      detail:
        "ERROR: Access denied; the last call inside cmux was unanswered at 2026-10-10T10:09:00.000Z, the last answered at 2026-10-10T10:06:00.000Z",
      state: "answering",
    });
  });

  it("never restarts a cmux whose answers keep landing between two probes under a newer timeout", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    const restarts: number[] = [];
    const between: Readonly<Record<number, readonly [number, InsideCallOutcome][]>> = {
      0: [[0, "unanswered"]],
      4: [
        [1, "answered"],
        [3, "unanswered"],
      ],
      8: [
        [5, "answered"],
        [7, "unanswered"],
      ],
      11: [
        [9, "answered"],
        [10, "unanswered"],
      ],
    };
    for (const minute of [0, 4, 8, 11]) {
      for (const [at, outcome] of between[minute]!) {
        stampInside({ home, minute: at, outcome });
      }
      await revivePass({
        deps: deps({ fleet, knock: ANSWERED, minute, restarts, rows: [APP] }),
        request: request({ home }),
      });
    }
    const states = unwrap(await fleet.readCmuxReviveJournal({ home })).events.map(
      (event) => event.kind === "reading" && event.state,
    );
    expect(restarts).toEqual([]);
    expect(states).toEqual(["stalled", "answering"]);
  });

  it("reads a seat's timeout older than the reading gap as unprobed, not as the hang", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    stampInside({ home, minute: 0, outcome: "unanswered" });
    const report = await revivePass({
      deps: deps({ fleet, knock: ANSWERED, minute: 6, rows: [APP] }),
      request: request({ home }),
    });
    expect(report).toEqual({
      action: "none",
      appPid: 5088,
      detail: "ERROR: Access denied; the last call inside cmux was unanswered at 2026-10-10T10:00:00.000Z",
      state: "unprobed",
    });
  });

  it("holds one app refusing and then stalling as one hang, since it answered nothing the whole span", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    const restarts: number[] = [];
    await seedRefused({ fleet, home, minutes: [0, 4, 8] });
    stampInside({ home, minute: 11, outcome: "unanswered" });
    const report = await revivePass({
      deps: deps({ fleet, knock: ANSWERED, minute: 11, restarts, rows: [APP] }),
      request: request({ home }),
    });
    expect(restarts).toEqual([5088]);
    expect(report).toEqual({
      action: "restart",
      appPid: 5088,
      detail: "ERROR: Access denied; the last call inside cmux was unanswered at 2026-10-10T10:11:00.000Z",
      restart: { detail: "quit on TERM; reopened as pid 24622", newAppPid: 24622, outcome: "answering" },
      sinceIso: "2026-10-10T10:00:00.000Z",
      state: "stalled",
    });
  });
});
