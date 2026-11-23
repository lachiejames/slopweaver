/**
 * `talk wake-chair` carries the console origin the transcript route hands it, so the verb can refuse a console that
 * is not the owner's before it types into their chair.
 */
import { describe, expect, it } from "vitest";

import { parseWakeChairArgs } from "../../../../../cli/commands/talk/wakeChairArgs.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseWakeChairArgs", () => {
  it("reads the console origin the transcript route passes", () => {
    const parsed = parseWakeChairArgs({
      rest: ["--json", "--console-root", "/w/seat", "--console-port", "3001", "--console-default-port", "3000"],
    });
    expect(unwrap(parsed).consoleOrigin).toEqual({ checkoutRoot: "/w/seat", defaultPort: 3000, port: 3001 });
  });

  it("reads no console origin on a hand run", () => {
    expect(unwrap(parseWakeChairArgs({ rest: ["--json"] })).consoleOrigin).toBe(undefined);
  });

  it("refuses half the console-origin group rather than waking as a hand run", () => {
    const parsed = parseWakeChairArgs({ rest: ["--console-root", "/w/seat", "--console-port", "3001"] });
    expect(unwrapErr(parsed).code).toBe("WAKE_CHAIR_FLAGS_INVALID");
    expect(unwrapErr(parsed).message).toBe(
      "--console-default-port is missing: the console-origin flags are passed together or not at all",
    );
  });
});
