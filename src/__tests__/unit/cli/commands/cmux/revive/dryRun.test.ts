/*
 * `cmux revive --dry-run`: a hang past the bound is still judged a restart, but nothing is restarted and nothing is
 * journalled.
 */
import { describe, expect, it } from "vitest";

import { revivePass } from "../../../../../../cli/commands/cmux/revive.js";
import { memoryFleetPort } from "../../../../../fleetStoreFixture.js";
import { APP, deps, freshHome, kinds, REFUSED, request, seedRefused, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("cmux revive", () => {
  it("restarts nothing and journals nothing on a dry run", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    await seedRefused({ fleet, home, minutes: [0, 5, 10] });
    const restarts: number[] = [];
    const report = await revivePass({
      deps: deps({ fleet, knock: REFUSED, minute: 11, restarts, rows: [APP] }),
      request: request({ dryRun: true, home }),
    });
    expect(restarts).toEqual([]);
    expect(report).toEqual({
      action: "restart",
      appPid: 5088,
      detail: "ECONNREFUSED on cmux.sock",
      sinceIso: "2026-10-10T10:00:00.000Z",
      state: "refused",
    });
    expect(await kinds({ fleet, home })).toEqual(["reading", "reading", "reading"]);
  });
});
