/** Which of a worker's candidate tabs is the recovery pass's own, a pure function driven directly. */
import { rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ownSeatTab } from "../../../../../../cli/commands/fleet/resumeCold.js";
import { makeHome, workspace } from "../fleetKit.js";

let home = "";

beforeEach(() => {
  home = makeHome();
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("ownSeatTab", () => {
  it("finds the pass's own tab among a worker's candidate tabs, and nothing when it runs elsewhere or outside cmux", () => {
    const own = workspace({ id: "own" });
    const tabs = [workspace({ id: "a" }), own];
    expect([
      ownSeatTab({ ownWorkspaceId: "own", tabs }),
      ownSeatTab({ ownWorkspaceId: "elsewhere", tabs }),
      ownSeatTab({ ownWorkspaceId: undefined, tabs }),
    ]).toEqual([own, undefined, undefined]);
  });
});
