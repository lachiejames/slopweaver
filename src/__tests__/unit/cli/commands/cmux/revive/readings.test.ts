/*
 * `cmux revive`'s readings: no app is read as absent and journalled, and a runaway knock detail is journalled at
 * most 512 characters long.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { reviveExit, revivePass } from "../../../../../../cli/commands/cmux/revive.js";
import type { SocketKnock } from "../../../../../../cmux/reviveEffects.js";
import { memoryFleetPort } from "../../../../../fleetStoreFixture.js";
import { APP, deps, freshHome, kinds, REFUSED, request, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("cmux revive", () => {
  it("reads no app as absent, journals it, and exits 3", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    const report = await revivePass({
      deps: deps({ fleet, knock: REFUSED, minute: 0, rows: [] }),
      request: request({ home }),
    });
    expect(report).toEqual({ action: "none", appPid: null, detail: "no cmux app process", state: "absent" });
    expect(reviveExit({ report: report as Exclude<typeof report, number> })).toBe(3);
    expect(await kinds({ fleet, home })).toEqual(["reading"]);
  });

  it("journals at most 512 characters of a runaway knock detail, so one reading never floods the tail", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    const runaway: SocketKnock = { ...REFUSED, detail: "x".repeat(300_000) };
    await revivePass({ deps: deps({ fleet, knock: runaway, minute: 0, rows: [APP] }), request: request({ home }) });
    const journalled = unwrap(await fleet.readCmuxReviveJournal({ home }))
      .events.filter((event) => event.kind === "reading")
      .map((event) => event.detail.length);
    expect(journalled).toEqual([512]);
  });
});
