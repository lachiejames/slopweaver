/**
 * `main()`'s own fallback branches — a completely unknown noun, and a known noun paired with an unknown or
 * missing verb. Both are the CALLER's mistake caught before any verb's act phase, so both must exit
 * {@link EXIT_USAGE}: a bare `1` here reads identically to a genuine runtime fault to anything gating on the
 * exit code, which is exactly the shape that makes a doneWhen probe for a not-yet-built verb a false green.
 */
import { describe, expect, it } from "vitest";

import { EXIT_USAGE } from "../../../cli/exitCodes.js";
import { main } from "../../../cli/main.js";

describe("main", () => {
  it("refuses a completely unknown noun with EXIT_USAGE", async () => {
    const code = await main(["node", "cli", "definitely-not-a-noun"]);
    expect(code).toBe(EXIT_USAGE);
  });

  it("refuses a known noun with an unrecognised verb with EXIT_USAGE", async () => {
    const code = await main(["node", "cli", "handover", "definitely-not-a-verb"]);
    expect(code).toBe(EXIT_USAGE);
  });

  it("refuses a known noun with no verb at all with EXIT_USAGE", async () => {
    const code = await main(["node", "cli", "cmux"]);
    expect(code).toBe(EXIT_USAGE);
  });
});
