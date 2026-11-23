/*
 * `cmux revive` refuses before acting: inside cmux, by its environment or by descending from the app, and on a
 * bound under a minute, before it touches anything.
 */
import { readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { revivePass, runCmuxRevive } from "../../../../../../cli/commands/cmux/revive.js";
import type { PsRow } from "../../../../../../cmux/appProcess.js";
import { memoryFleetPort } from "../../../../../fleetStoreFixture.js";
import { APP, deps, freshHome, kinds, REFUSED, request, SELF, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("cmux revive", () => {
  it("refuses inside cmux, by its environment or by descending from the app", async () => {
    const home = freshHome();
    const fleet = memoryFleetPort();
    const byEnv = await revivePass({
      deps: deps({ fleet, insideCmuxEnv: true, knock: REFUSED, minute: 0, rows: [APP] }),
      request: request({ home }),
    });
    const shell: PsRow = { command: "zsh", pid: 600, ppid: APP.pid, start: APP.start };
    const self: PsRow = { command: "node", pid: SELF, ppid: shell.pid, start: APP.start };
    const byTree = await revivePass({
      deps: deps({ fleet, knock: REFUSED, minute: 0, rows: [APP, shell, self] }),
      request: request({ home }),
    });
    expect([byEnv, byTree]).toEqual([1, 1]);
    expect(await kinds({ fleet, home })).toEqual([]);
  });

  it("refuses a bound under a minute before touching anything", async () => {
    const home = freshHome();
    const code = await runCmuxRevive(["node", "slopweaver", "cmux", "revive", "--bound-seconds", "5", "--home", home]);
    expect([code, readdirSync(home)]).toEqual([2, []]);
  });
});
