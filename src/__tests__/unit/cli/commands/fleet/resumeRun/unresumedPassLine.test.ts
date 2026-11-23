/** The pass's output line naming the seats it did not resume, a pure function driven directly. */
import { rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unresumedPassLine } from "../../../../../../cli/commands/fleet/resumeCold.js";
import { makeHome } from "../fleetKit.js";

let home = "";

beforeEach(() => {
  home = makeHome();
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("unresumedPassLine", () => {
  it("prints the named seats on the pass's output when the chair is asked, so a failed send still names them", () => {
    expect(unresumedPassLine({ chairStanding: true, line: "workspace:7 (no saved session)" })).toBe(
      "supervisor\tasked to find out about these — workspace:7 (no saved session)",
    );
  });

  it("prints the named seats with no chair standing to ask", () => {
    expect(unresumedPassLine({ chairStanding: false, line: "workspace:7 (no saved session)" })).toBe(
      "supervisor\tnone stands to find out about these — workspace:7 (no saved session)",
    );
  });
});
