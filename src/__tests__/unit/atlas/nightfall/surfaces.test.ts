/**
 * The committed surface registry, checked against the properties the generator asserts at write time.
 *
 * These duplicate `tools/generateNightfallSurfaces.ts --verify` on purpose. The tool runs when somebody
 * remembers to run it; the unit lane runs on every push, and the failure this guards against is a
 * hand-edited row, which is exactly the edit nobody re-runs a generator after.
 */
import { describe, expect, it } from "vitest";

import { nightfallDispositionFor } from "../../../../atlas/nightfall/dispositions.js";
import {
  NIGHTFALL_DISPOSITION_CENSUS,
  NIGHTFALL_OPERATION_CENSUS,
  NIGHTFALL_SPEC_PINS,
} from "../../../../atlas/nightfall/generated/specLock.js";
import { NIGHTFALL_RECORD_SHAPES, NIGHTFALL_SURFACES } from "../../../../atlas/nightfall/generated/surfaces.js";
import {
  nightfallKindFor,
  nightfallOperationName,
  nightfallProviderId,
} from "../../../../atlas/nightfall/surfaceNaming.js";

describe("the committed Nightfall surface registry", () => {
  it("holds exactly the census specLock pins", () => {
    expect(NIGHTFALL_SURFACES.length).toBe(NIGHTFALL_OPERATION_CENSUS);
    expect(NIGHTFALL_SURFACES.length).toBe(56);
  });

  it("holds the pinned operation count for every document", () => {
    const counted = NIGHTFALL_SPEC_PINS.map((pin) => ({
      document: pin.document,
      operations: NIGHTFALL_SURFACES.filter((row) => row.specDocument === pin.document).length,
    }));
    expect(counted).toStrictEqual([
      { document: "activitydlp", operations: 9 },
      { document: "activitylogexfil", operations: 6 },
      { document: "ai-governance", operations: 14 },
      { document: "apps", operations: 16 },
      { document: "oldapis", operations: 5 },
      { document: "postureupdate", operations: 6 },
    ]);
  });

  it("takes exactly the pinned disposition census", () => {
    const counted = {
      entity: NIGHTFALL_SURFACES.filter((row) => row.disposition === "entity").length,
      excluded: NIGHTFALL_SURFACES.filter((row) => row.disposition === "excluded").length,
      "probe-only": NIGHTFALL_SURFACES.filter((row) => row.disposition === "probe-only").length,
      "shape-index": NIGHTFALL_SURFACES.filter((row) => row.disposition === "shape-index").length,
    };
    expect(counted).toStrictEqual({ ...NIGHTFALL_DISPOSITION_CENSUS });
    expect(counted).toStrictEqual({ entity: 21, excluded: 18, "probe-only": 0, "shape-index": 17 });
  });

  it("gives every row a name no other row has", () => {
    expect(new Set(NIGHTFALL_SURFACES.map((row) => row.name)).size).toBe(NIGHTFALL_SURFACES.length);
  });

  it("needs the SERVER to keep exfiltration and posture apart", () => {
    // The measurement `surfaceRow.ts` records: identical path templates under two different base URLs.
    const shared = NIGHTFALL_SURFACES.filter(
      (row) => row.path === "/events" || row.path === "/events/search" || row.path === "/asset/activity",
    );
    expect(shared.length).toBe(6);
    expect(new Set(shared.map((row) => `${row.method} ${row.path}`)).size).toBe(3);
    expect(new Set(shared.map((row) => nightfallProviderId(row))).size).toBe(6);
  });

  it("derives every stored kind, name and disposition from the rules, not from the file", () => {
    for (const row of NIGHTFALL_SURFACES) {
      expect(nightfallKindFor({ api: row.api, path: row.path })).toBe(row.kind);
      expect(nightfallOperationName({ api: row.api, method: row.method, path: row.path })).toBe(row.name);
      expect(nightfallDispositionFor({ kind: row.kind, method: row.method, name: row.name }).disposition).toBe(
        row.disposition,
      );
    }
  });

  it("names an exclusion reason on every excluded row and on no other", () => {
    for (const row of NIGHTFALL_SURFACES) {
      expect(row.exclusionReason === null).toBe(row.disposition !== "excluded");
    }
  });

  it("holds one record shape per kind the registry names", () => {
    const registryKinds = [...new Set(NIGHTFALL_SURFACES.map((row) => row.kind))].toSorted();
    expect(NIGHTFALL_RECORD_SHAPES.map((shape) => shape.kind)).toStrictEqual(registryKinds);
    expect(NIGHTFALL_RECORD_SHAPES.length).toBe(18);
  });

  it("reads a violation's declared fields from the vendor's own Violation component", () => {
    const violation = NIGHTFALL_RECORD_SHAPES.find((shape) => shape.kind === "violation")!;
    expect(violation.schemaName).toBe("Violation");
    expect(violation.sourceOperation).toBe("dlp-get-violations");
    expect(violation.fields).toContain("detectionRuleUUIDs");
    expect(violation.fields).toContain("policyUUIDs");
    expect(violation.fields).toContain("riskScore");
  });

  it("takes a finding's shape from the findings read rather than from the annotate write", () => {
    // The sub-resource rule in `surfaceNaming.ts`: without it this shape describes an Annotation.
    const finding = NIGHTFALL_RECORD_SHAPES.find((shape) => shape.kind === "finding")!;
    expect(finding.schemaName).toBe("Finding");
    expect(finding.fields).toContain("redactedSensitiveText");
  });

  it("publishes no operation that lists policies, detection rules or detectors", () => {
    // The gap `nightfallUnresolvableReferenceGap` reports. Asserted here so the finding cannot go stale
    // silently: the day the vendor publishes one, this fails and the gap gets closed rather than kept.
    const resolvers = NIGHTFALL_SURFACES.filter((row) => /polic|detect|rule/i.test(row.path));
    expect(resolvers).toStrictEqual([]);
  });
});
