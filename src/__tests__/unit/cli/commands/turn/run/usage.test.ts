/*
 * The `turn answer` usage text: it says there is no model in the verb, declares every flag the parser accepts, and
 * names the violet accent wrapper.
 */
import { describe, expect, it } from "vitest";

import { TURN_USAGE } from "../../../../../../cli/commands/turn/run.js";

describe("turn answer usage", () => {
  it("states that there is no model in the verb, which is the whole change", () => {
    expect(TURN_USAGE).toContain("no model in this verb");
  });

  it("declares every flag the parser accepts", () => {
    for (const flag of ["--brief", "--answer", "--decision", "--dispatch", "--session-url", "--model", "--home"]) {
      expect(TURN_USAGE).toContain(flag);
    }
  });

  it("names the violet accent wrapper every bot message carries", () => {
    expect(TURN_USAGE).toContain("violet accent");
  });
});
