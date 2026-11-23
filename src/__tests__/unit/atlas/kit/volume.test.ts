/**
 * The volume rule every atlas is judged by.
 *
 * The refusals are what this file is really about: a family an atlas DECLARED shape-indexed publishing rows
 * anyway, and a family over the ceiling that nobody has judged at all. Both were reachable on `main` and
 * the second is how one row per JumpCloud per-device telemetry observation reached a published generation while its
 * own coverage cell read `synced`.
 */
import { describe, expect, it } from "vitest";
import {
  type AtlasVolumeVerdict,
  countKindRows,
  judgeKindVolume,
  refuseRowVolume,
  UNDECLARED_ROW_CEILING,
} from "../../../../atlas/kit/volume.js";
import { isRecord } from "../../../../lib/parsers.js";

type Kind = "telemetry" | "policy" | "asset";

/** One published row, in the shape a platform that records provenance writes. */
interface Row {
  readonly id: string;
  readonly providerId: string;
}

/** The operation a row came from, the way `jumpcloud/volume.ts` reads it. */
const operationOf = ({ row }: { row: unknown }): string | null => {
  const providerId = isRecord(row) && typeof row["providerId"] === "string" ? row["providerId"] : "";
  const end = providerId.search(/[:#]/);
  return end <= 0 ? null : providerId.slice(0, end);
};

/** `n` rows from one operation. */
function rows({ operation, count }: { operation: string; count: number }): readonly Row[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `id-${operation}-${String(index)}`,
    providerId: `${operation}#at-${String(index)}`,
  }));
}

const TELEMETRY_VERDICT: AtlasVolumeVerdict<Kind> = {
  because: "per-device observations stamped with their own collection instant",
  disposition: "shape-index",
  kind: "telemetry",
  volume: {
    basis: "measured",
    establishedBy: "wc -l telemetry.jsonl",
    magnitude: "123,456 rows",
    unboundedBecause: "the agent re-collects on a schedule, so the count grows with the clock",
  },
};

describe("judgeKindVolume", () => {
  it("refuses a shape-indexed kind that published even one row", () => {
    const finding = judgeKindVolume({
      counts: countKindRows({ entities: rows({ count: 1, operation: "list-telemetry" }), kind: "telemetry" }),
      verdicts: [TELEMETRY_VERDICT],
    });
    expect(finding.state).toBe("shape-index-published");
    expect(finding.rows).toBe(1);
    expect(finding.detail).toContain("1 row(s) published for a family this atlas declares shape-indexed");
  });

  it("passes a shape-indexed kind that published nothing", () => {
    const finding = judgeKindVolume({
      counts: countKindRows({ entities: [], kind: "telemetry" }),
      verdicts: [TELEMETRY_VERDICT],
    });
    expect(finding.state).toBe("declared");
    expect(finding.detail).toBe("shape-indexed and publishing no rows, as declared");
  });

  it("refuses a shape-indexed OPERATION inside a kind that legitimately holds entities", () => {
    const entities = [
      ...rows({ count: 3, operation: "v2-policies-list" }),
      ...rows({ count: 7, operation: "v2-policyresults-list" }),
    ];
    const finding = judgeKindVolume({
      counts: countKindRows({ entities, kind: "policy", operationOf }),
      verdicts: [
        {
          because: "per-device policy-application reports, each carrying the instant it was reported",
          disposition: "shape-index",
          kind: "policy",
          operation: "v2-policyresults-list",
          volume: {
            basis: "measured",
            establishedBy: "grep -c v2-policyresults-list policies.jsonl",
            magnitude: "4,321 of 6,543 rows",
            unboundedBecause: "every re-application reports again",
          },
        },
      ],
    });
    expect(finding.state).toBe("shape-index-published");
    expect(finding.rows).toBe(10);
    expect(finding.detail).toContain("7 row(s) published by v2-policyresults-list");
  });

  it("leaves the entity half of that kind alone when the shape-indexed operation published nothing", () => {
    const finding = judgeKindVolume({
      counts: countKindRows({
        entities: rows({ count: 3, operation: "v2-policies-list" }),
        kind: "policy",
        operationOf,
      }),
      verdicts: [
        {
          because: "per-device policy-application reports",
          disposition: "shape-index",
          kind: "policy",
          operation: "v2-policyresults-list",
          volume: {
            basis: "measured",
            establishedBy: "grep -c v2-policyresults-list policies.jsonl",
            magnitude: "4,321 of 6,543 rows",
            unboundedBecause: "every re-application reports again",
          },
        },
      ],
    });
    expect(finding.state).toBe("declared");
    expect(finding.rows).toBe(3);
  });

  it("refuses a kind over the ceiling that carries no verdict at all", () => {
    const finding = judgeKindVolume({
      counts: countKindRows({
        entities: rows({ count: UNDECLARED_ROW_CEILING + 1, operation: "list-assets" }),
        kind: "asset",
      }),
      verdicts: [],
    });
    expect(finding.state).toBe("undeclared-volume");
    expect(finding.rows).toBe(UNDECLARED_ROW_CEILING + 1);
    expect(finding.detail).toContain("nothing says which side of docs/atlas-intent/06-holdings.md");
  });

  it("passes a kind exactly at the ceiling, so the bound is what it says", () => {
    const finding = judgeKindVolume({
      counts: countKindRows({
        entities: rows({ count: UNDECLARED_ROW_CEILING, operation: "list-assets" }),
        kind: "asset",
      }),
      verdicts: [],
    });
    expect(finding.state).toBe("clear");
    expect(finding.detail).toBe("5000 row(s)");
  });

  it("passes a kind over the ceiling that declares itself bulk-entity, and says what it was judged at", () => {
    const finding = judgeKindVolume({
      counts: countKindRows({
        entities: rows({ count: UNDECLARED_ROW_CEILING + 1, operation: "list-assets" }),
        kind: "asset",
      }),
      verdicts: [
        {
          because: "device-to-person associations an administrator configured",
          disposition: "bulk-entity",
          judgedAtRows: 12_345,
          kind: "asset",
        },
      ],
    });
    expect(finding.state).toBe("declared");
    expect(finding.detail).toContain("declared bulk-entity at 12345");
  });

  it("passes a kind over the ceiling that declares itself a bounded observation, and names the bound", () => {
    const finding = judgeKindVolume({
      counts: countKindRows({
        entities: rows({ count: UNDECLARED_ROW_CEILING + 1, operation: "list-assets" }),
        kind: "asset",
      }),
      verdicts: [
        {
          because: "per-device experience samples",
          boundedBy: "the provider's 7-day retention",
          disposition: "bounded-observation",
          establishedBy: "slopweaver atlas cloudflare read --kind dex-fleet-status --json",
          kind: "asset",
          magnitude: "9,876 rows / 4.32 MiB over the whole window",
        },
      ],
    });
    expect(finding.state).toBe("declared");
    expect(finding.detail).toContain("observations bounded by the provider's 7-day retention");
  });

  it("counts rows but attributes no operation when the platform supplies no provenance reader", () => {
    const counts = countKindRows({ entities: rows({ count: 4, operation: "list-assets" }), kind: "asset" });
    expect(counts.rows).toBe(4);
    expect(counts.byOperation.size).toBe(0);
  });
});

describe("refuseRowVolume", () => {
  it("names every breaching kind and ends in the escape hatch", () => {
    const lines = refuseRowVolume({
      findings: [
        {
          detail: "123456 row(s) published for a family this atlas declares shape-indexed",
          kind: "telemetry",
          rows: 123_456,
          state: "shape-index-published",
        },
        {
          detail: "5001 row(s) published and nothing says which side",
          kind: "asset",
          rows: 5_001,
          state: "undeclared-volume",
        },
        { detail: "3 row(s)", kind: "policy", rows: 3, state: "clear" },
      ],
      platform: "jumpcloud",
    });
    expect(lines[0]).toContain("slopweaver atlas jumpcloud sync blocked because 2 kind(s)");
    expect(lines[1]).toContain("telemetry: 123456 row(s) published");
    expect(lines[2]).toContain("asset: 5001 row(s) published");
    expect(lines.join("\n")).toContain("SLOPWEAVER_ALLOW_ATLAS_ROW_VOLUME=1");
  });

  it("says nothing at all when every kind is where its atlas put it", () => {
    expect(
      refuseRowVolume({
        findings: [{ detail: "3 row(s)", kind: "policy", rows: 3, state: "clear" }],
        platform: "jumpcloud",
      }),
    ).toEqual([]);
  });
});
