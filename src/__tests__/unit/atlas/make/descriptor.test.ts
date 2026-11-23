/**
 * Unit: the Make descriptor's denominator is the installed SDK's own census, and every read the fill counts
 * is a tool that census marks read-only.
 */
import { MakeTools } from "@makehq/sdk/tools";
import { describe, expect, it } from "vitest";

import { MAKE_ATLAS_DESCRIPTOR, MAKE_READ_ONLY_TOOL_CENSUS } from "../../../../atlas/make/descriptor.js";
import { MAKE_FILL_OPERATIONS } from "../../../../atlas/make/fill/plan.js";

const READ_ONLY_NAMES = MakeTools.filter((tool) => tool.annotations?.readOnlyHint === true).map((tool) => tool.name);

describe("MAKE_ATLAS_DESCRIPTOR", () => {
  it("counts exactly the tools the pinned SDK annotates read-only", () => {
    expect(READ_ONLY_NAMES.length).toBe(MAKE_READ_ONLY_TOOL_CENSUS);
    expect(MAKE_ATLAS_DESCRIPTOR.surfaces[0]!.denominator).toStrictEqual({
      exists: 92,
      known: true,
      reached: 8,
      source:
        "@makehq/sdk@1.6.20's own tool census (`@makehq/sdk/tools` MakeTools): 203 tools, 92 annotated readOnlyHint",
    });
    expect(MakeTools.length).toBe(203);
  });

  it("counts only reads the census marks read-only", () => {
    const counted = Object.values(MAKE_FILL_OPERATIONS);
    expect(counted.length).toBeGreaterThan(0);
    expect(counted.filter((name) => !READ_ONLY_NAMES.includes(name))).toStrictEqual([]);
  });

  it("refuses every write, and says what it keeps names of rather than values", () => {
    expect(MAKE_ATLAS_DESCRIPTOR.writePolicy).toBe("refuse-every-write");
    expect(MAKE_ATLAS_DESCRIPTOR.excludes.map((exclusion) => exclusion.ground)).toStrictEqual([
      "never-acted",
      "names-not-values",
      "secret-material",
      "secret-material",
      "secret-material",
      "not-fetched",
    ]);
  });
});
