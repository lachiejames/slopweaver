import { describe, expect, it } from "vitest";

import { ESBUILD_GO_MEMORY_LIMIT_MIB, goMemoryLimit } from "#lib/esbuildBounds.js";

describe("esbuildBounds", () => {
  it("spells a limit in the MiB suffix the Go runtime parses", () => {
    expect(goMemoryLimit({ mib: 4096 })).toBe("4096MiB");
  });

  it("holds the soft limit under the smaller measured dev build peak, 4,947,853,312 bytes", () => {
    expect(ESBUILD_GO_MEMORY_LIMIT_MIB).toBe(4096);
    expect(ESBUILD_GO_MEMORY_LIMIT_MIB * 1024 * 1024).toBeLessThan(4_947_853_312);
  });
});
