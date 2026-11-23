/*
 * `cmux revive` after a declined dialog: the readings before it never count towards a restart, since its cause is
 * gone, and the first reading after it is journalled even when it repeats the one before.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { revivePass } from "../../../../../../cli/commands/cmux/revive.js";
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

const DECLINED = {
  button: "Cancel",
  kind: "dialog-dismissed",
  schemaVersion: 1,
  title: "Run Project Action?",
} as const;

useFreshHomes();

describe("cmux revive", () => {
  it("never restarts on readings from before a declined dialog — its cause is gone, so the run starts again", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    await seedRefused({ fleet, home, minutes: [0, 5, 10] });
    unwrap(await fleet.appendCmuxReviveEvent({ event: { ...DECLINED, atIso: "2026-10-10T10:10:30.000Z" }, home }));
    const restarts: number[] = [];
    const report = await revivePass({
      deps: deps({ fleet, knock: REFUSED, minute: 11, restarts, rows: [APP] }),
      request: request({ home }),
    });
    expect(restarts).toEqual([]);
    expect(report).toEqual({
      action: "wait",
      appPid: 5088,
      detail: "ECONNREFUSED on cmux.sock",
      sinceIso: "2026-10-10T10:11:00.000Z",
      state: "refused",
    });
  });

  it("journals the first reading after a declined dialog even when it repeats the one before", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    stampInside({ home, minute: 0, outcome: "answered" });
    await revivePass({
      deps: deps({ fleet, knock: ANSWERED, minute: 0, rows: [APP] }),
      request: request({ home }),
    });
    unwrap(await fleet.appendCmuxReviveEvent({ event: { ...DECLINED, atIso: "2026-10-10T10:01:00.000Z" }, home }));
    stampInside({ home, minute: 1, outcome: "answered" });
    await revivePass({
      deps: deps({ fleet, knock: ANSWERED, minute: 2, rows: [APP] }),
      request: request({ home }),
    });
    expect(await kinds({ fleet, home })).toEqual(["reading", "dialog-dismissed", "reading"]);
  });
});
