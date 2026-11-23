import { describe, expect, it } from "vitest";

import { CLOUDFLARE_KINDS } from "../../../../atlas/cloudflare/model.js";
import { CLOUDFLARE_STORE_SPEC } from "../../../../atlas/cloudflare/store.js";
import { CLOUDFLARE_KIND_VOLUMES } from "../../../../atlas/cloudflare/volume.js";
import { countKindRows, judgeKindVolume, UNDECLARED_ROW_CEILING } from "../../../../atlas/kit/volume.js";

/** Rows the kit only counts, so their content is irrelevant. */
const rows = ({ count }: { count: number }): readonly unknown[] => Array.from({ length: count }, () => ({}));

describe("the Cloudflare volume verdicts", () => {
  it("declares exactly the families judged over the row ceiling, and nothing else", () => {
    expect(CLOUDFLARE_KIND_VOLUMES.verdicts.length).toBeGreaterThan(0);
    expect(CLOUDFLARE_KIND_VOLUMES.verdicts.map((verdict) => [verdict.kind, verdict.disposition])).toEqual([
      ["dex-fleet-status", "bounded-observation"],
      ["device-registration", "bulk-entity"],
      ["access-authentication-log", "bounded-observation"],
      ["audit-log", "bounded-observation"],
    ]);
  });

  it("is the declaration the store spec publishes against", () => {
    expect(CLOUDFLARE_STORE_SPEC.kindVolumes).toBe(CLOUDFLARE_KIND_VOLUMES);
  });

  it("lets an authentication-log generation past the row ceiling publish as declared", () => {
    const counts = countKindRows({
      entities: rows({ count: UNDECLARED_ROW_CEILING + 1 }),
      kind: "access-authentication-log" as const,
    });
    const finding = judgeKindVolume({ counts, verdicts: CLOUDFLARE_KIND_VOLUMES.verdicts });
    expect(counts.rows).toBeGreaterThan(UNDECLARED_ROW_CEILING);
    expect(finding.state).toBe("declared");
  });

  // MEASURED: `automation resync --atlas cloudflare` once refused audit-log past the row ceiling, stale
  // accretion carrying a 30-day read over it with no verdict.
  it("lets an audit-log generation past the row ceiling publish as declared", () => {
    const counts = countKindRows({ entities: rows({ count: UNDECLARED_ROW_CEILING + 1 }), kind: "audit-log" as const });
    expect(judgeKindVolume({ counts, verdicts: CLOUDFLARE_KIND_VOLUMES.verdicts }).state).toBe("declared");
  });

  it("still refuses an undeclared Cloudflare kind that crosses the row ceiling", () => {
    expect(CLOUDFLARE_KINDS).toContain("access-user");
    const counts = countKindRows({
      entities: rows({ count: UNDECLARED_ROW_CEILING + 1 }),
      kind: "access-user" as const,
    });
    expect(judgeKindVolume({ counts, verdicts: CLOUDFLARE_KIND_VOLUMES.verdicts }).state).toBe("undeclared-volume");
  });
});
