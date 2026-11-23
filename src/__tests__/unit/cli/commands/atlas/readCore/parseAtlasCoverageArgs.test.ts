/*
 * `parseAtlasCoverageArgs`: every flag the coverage verb declares is read.
 */
import { describe, expect, it } from "vitest";

import { parseAtlasCoverageArgs } from "../../../../../../cli/commands/atlas/coverageCore.js";
import { unwrap } from "../../../../../../lib/result.js";

describe("parseAtlasCoverageArgs", () => {
  it("reads every flag it declares", () => {
    const parsed = unwrap(
      parseAtlasCoverageArgs({
        rest: ["--kind", "zone", "--surface", "rest-api", "--state", "unreadable", "--open-only", "--json"],
      }),
    );
    expect(parsed.kind).toBe("zone");
    expect(parsed.surface).toBe("rest-api");
    expect(parsed.state).toBe("unreadable");
    expect(parsed.openOnly).toBe(true);
    expect(parsed.json).toBe(true);
  });
});
