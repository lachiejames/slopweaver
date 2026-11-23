/*
 * `renderAtlasCoverage`: the unfilled surface and the declared exclusions named, the generation and each kind's last
 * success printed, and `never` said where nothing was published or synced.
 */
import { describe, expect, it } from "vitest";

import { renderAtlasCoverage } from "../../../../../../cli/commands/atlas/coverageCore.js";
import { snapshot } from "./harness.js";

describe("renderAtlasCoverage", () => {
  it("names an unfilled surface and says the atlas is incomplete because of it", () => {
    const lines = renderAtlasCoverage({ kinds: snapshot().kinds, snapshot: snapshot() });
    expect(lines.some((line) => line.includes("nobody has driven a browser here"))).toBe(true);
    expect(lines.some((line) => line.includes("this atlas is incomplete and SAYS so"))).toBe(true);
  });

  it("prints the declared exclusions, because what an atlas does not hold is the fact a reader needs", () => {
    const lines = renderAtlasCoverage({ kinds: snapshot().kinds, snapshot: snapshot() });
    expect(lines.some((line) => line.includes("any mutation"))).toBe(true);
  });

  it("prints when the generation was published, each kind's last success and its tally by state", () => {
    const lines = renderAtlasCoverage({ kinds: snapshot().kinds, snapshot: snapshot() });
    expect(lines[1]).toBe("generation 2026-08-20T07:07:53.351Z  ·  schema v1");
    expect(lines).toContain(
      `  ${"zone".padEnd(26)} ${"1".padStart(6)} entities  last success 2026-08-20T07:07:53.351Z`,
    );
    expect(lines).toContain("    synced=1");
  });

  it("says never for a generation nothing published and a kind no sync completed, and prints no empty tally", () => {
    const fixture = snapshot();
    const kind = { ...fixture.kinds[0]!, coverage: [], lastSuccessAt: null };
    const lines = renderAtlasCoverage({
      kinds: [kind],
      snapshot: { ...fixture, generation: { ...fixture.generation, updatedAt: null }, kinds: [kind] },
    });
    expect(lines[1]).toBe("generation never published  ·  schema v1");
    expect(lines).toContain(`  ${"zone".padEnd(26)} ${"1".padStart(6)} entities  last success never`);
    expect(lines.filter((line) => line.startsWith("    synced="))).toEqual([]);
  });
});
