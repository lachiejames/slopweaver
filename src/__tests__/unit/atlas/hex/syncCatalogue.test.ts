/*
 * The Hex compile pass, read directly: one pinned document fetched through the fixture transport, compiled,
 * and its movement recorded rather than refused.
 */
import { describe, expect, it } from "vitest";

import { compileHexCatalogue, withholdingGap } from "../../../../atlas/hex/syncCatalogue.js";

import { fixtureTransport, HEX_FIXTURE_PIN } from "./fixture.js";

const AT = "2026-09-07T02:00:00.000Z";

describe("compileHexCatalogue", () => {
  it("compiles the fixture document and records that its bytes are not the reviewed ones", async () => {
    const catalogue = await compileHexCatalogue({ pins: [HEX_FIXTURE_PIN], transport: fixtureTransport });

    expect(catalogue.operationCount).toBe(5);
    expect(catalogue.surfaces.map((surface) => surface.specId)).toEqual(["hex-public-api"]);
    expect(catalogue.drifts.map((drift) => drift.specId)).toEqual(["hex-public-api"]);
    expect(catalogue.failures.length).toBe(0);
  });
});

describe("withholdingGap", () => {
  it("raises the standing result-data gap on the method kind, counting the withheld operations", () => {
    const gap = withholdingGap({ at: AT, withheld: 3 });

    expect(gap.condition).toBe("result-data-withheld");
    expect(gap.kind).toBe("method");
    expect(gap.scope).toBe("result-bearing-operations");
    expect(gap.reason).toContain("3 operation(s) are mapped in full");
  });
});
