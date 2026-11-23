/*
 * `cmux revive` exits 1 when a dependency fails: the process table cannot be read, or the fleet store cannot be
 * reached — a typed refusal that never falls back to a file.
 */
import { describe, expect, it } from "vitest";

import { err } from "#lib/result.js";

import { revivePass } from "../../../../../../cli/commands/cmux/revive.js";
import type { ReviveDeps } from "../../../../../../cli/commands/cmux/reviveProbe.js";
import { memoryFleetPort, unavailableFleetPort } from "../../../../../fleetStoreFixture.js";
import { APP, deps, freshHome, REFUSED, request, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("cmux revive", () => {
  it("exits 1 when the process table cannot be read", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    const failing: ReviveDeps = {
      ...deps({ fleet, knock: REFUSED, minute: 0, rows: [] }),
      listProcesses: () => err("ps: timed out"),
    };
    expect(await revivePass({ deps: failing, request: request({ home }) })).toBe(1);
  });

  it("exits 1 when the store cannot be reached, a typed refusal that never falls back to a file", async () => {
    const home = freshHome();
    const restarts: number[] = [];
    const unreachable = deps({ fleet: unavailableFleetPort(), knock: REFUSED, minute: 0, restarts, rows: [APP] });
    expect(await revivePass({ deps: unreachable, request: request({ home }) })).toBe(1);
    expect(restarts).toEqual([]);
  });
});
