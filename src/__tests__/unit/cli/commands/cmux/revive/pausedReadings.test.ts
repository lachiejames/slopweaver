/*
 * `cmux revive` drops a reading its pass was paused across — before a hang, under a clock set back, behind another
 * pass's journalled hang, or across its own knock — journalling and judging nothing on it.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { revivePass } from "../../../../../../cli/commands/cmux/revive.js";
import type { ReviveDeps } from "../../../../../../cli/commands/cmux/reviveProbe.js";
import { memoryFleetPort } from "../../../../../fleetStoreFixture.js";
import {
  ANSWERED,
  APP,
  deps,
  freshHome,
  kinds,
  REFUSED,
  request,
  seedRefused,
  stampInside,
  useFreshHomes,
} from "./harness.js";

useFreshHomes();

describe("cmux revive", () => {
  it("drops a reading a paused revive took before the hang, journalling and judging nothing", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    await seedRefused({ fleet, home, minutes: [0] });
    const clock = [`2026-10-10T10:00:30.000Z`, `2026-10-10T10:00:30.000Z`, `2026-10-10T10:45:00.000Z`];
    const paused: ReviveDeps = {
      ...deps({ fleet, knock: ANSWERED, minute: 0, rows: [APP] }),
      nowIso: () => clock.shift()!,
    };
    stampInside({ home, minute: 0, outcome: "answered" });
    const exit = await revivePass({ deps: paused, request: request({ home }) });
    expect([exit, await kinds({ fleet, home })]).toEqual([4, ["reading"]]);
  });

  it("drops a paused revive's reading a clock set back has left in the future", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    await seedRefused({ fleet, home, minutes: [0] });
    const clock = [`2026-10-10T10:30:00.000Z`, `2026-10-10T10:30:00.000Z`, `2026-10-07T10:00:00.000Z`];
    const paused: ReviveDeps = {
      ...deps({ fleet, knock: ANSWERED, minute: 0, rows: [APP] }),
      nowIso: () => clock.shift()!,
    };
    stampInside({ home, minute: 0, outcome: "answered" });
    const exit = await revivePass({ deps: paused, request: request({ home }) });
    expect([exit, await kinds({ fleet, home })]).toEqual([4, ["reading"]]);
  });

  it("drops a reading taken before another pass journalled a hang, though a clock set back stamps it later", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    stampInside({ home, minute: 0, outcome: "answered" });
    const base = deps({ fleet, knock: ANSWERED, minute: 0, rows: [APP] });
    const stalled = {
      appPid: APP.pid,
      appStart: APP.start,
      atIso: "2026-10-10T10:58:10.000Z",
      detail: "stalled",
      kind: "reading",
      schemaVersion: 1,
      state: "stalled",
    } as const;
    const clock = ["2026-10-10T10:59:00.000Z", "2026-10-10T10:59:00.000Z", "2026-10-10T10:58:20.000Z"];
    const paused: ReviveDeps = {
      ...base,
      knock: async () => {
        unwrap(await fleet.appendCmuxReviveEvent({ event: stalled, home }));
        return ANSWERED;
      },
      nowIso: () => clock.shift()!,
    };
    const exit = await revivePass({ deps: paused, request: request({ home }) });
    expect([exit, unwrap(await fleet.readCmuxReviveJournal({ home })).events]).toEqual([4, [stalled]]);
  });

  it("drops a reading whose revive was paused across its knock, never dating the hang on resumption", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    const base = deps({ fleet, knock: REFUSED, minute: 0, rows: [APP] });
    let now = "2026-10-10T08:15:00.000Z";
    const paused: ReviveDeps = {
      ...base,
      knock: () => {
        now = "2026-10-10T08:18:00.000Z";
        return Promise.resolve(REFUSED);
      },
      nowIso: () => now,
    };
    const exit = await revivePass({ deps: paused, request: request({ home }) });
    expect([exit, await kinds({ fleet, home })]).toEqual([4, []]);
  });
});
