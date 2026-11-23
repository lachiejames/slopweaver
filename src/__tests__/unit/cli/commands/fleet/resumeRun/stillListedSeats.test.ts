/** Which unresumed seats cmux still lists, a pure function driven directly. */
import { rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stillListedSeats } from "../../../../../../cli/commands/fleet/resumeCold.js";
import { makeHome, workspace } from "../fleetKit.js";

let home = "";

beforeEach(() => {
  home = makeHome();
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

// MEASURED: two tabs the chair closed while the pass walked were named as unreadable.
describe("stillListedSeats", () => {
  const closedTab = {
    why: "not read — cmux surface.resume.get failed (not_found)",
    workspace: workspace({ id: "200" }),
  };
  const standingTab = { why: "no saved session", workspace: workspace({ id: "7" }) };

  it("drops a seat cmux no longer lists, naming it as closed", () => {
    expect(stillListedSeats({ relisted: [workspace({ id: "7" })], unresumed: [closedTab, standingTab] })).toEqual({
      closed: ["workspace:200"],
      standing: [standingTab],
    });
  });

  it("keeps every seat when the list would not read", () => {
    expect(stillListedSeats({ relisted: undefined, unresumed: [closedTab, standingTab] })).toEqual({
      closed: [],
      standing: [closedTab, standingTab],
    });
  });
});
