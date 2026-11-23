import { describe, expect, it } from "vitest";

import { countKindRows, judgeKindVolume, UNDECLARED_ROW_CEILING } from "../../../../atlas/kit/volume.js";
import { VANTA_STORE_SPEC } from "../../../../atlas/vanta/store.js";
import { VANTA_KIND_VOLUMES } from "../../../../atlas/vanta/volume.js";

/** Rows the kit only counts, so their content is irrelevant. */
const rows = ({ count }: { count: number }): readonly unknown[] => Array.from({ length: count }, () => ({}));

describe("the Vanta volume verdicts", () => {
  it("holds integration resources whole as bulk entities, and declares nothing else", () => {
    expect(VANTA_KIND_VOLUMES.verdicts.map((verdict) => [verdict.kind, verdict.disposition])).toEqual([
      ["integration-resource", "bulk-entity"],
    ]);
  });

  it("is the declaration the store spec publishes against", () => {
    expect(VANTA_STORE_SPEC.kindVolumes).toBe(VANTA_KIND_VOLUMES);
  });

  it("lets declared resource rows above the row ceiling publish", () => {
    const counts = countKindRows({
      entities: rows({ count: UNDECLARED_ROW_CEILING + 1 }),
      kind: "integration-resource" as const,
    });
    expect(judgeKindVolume({ counts, verdicts: VANTA_KIND_VOLUMES.verdicts }).state).toBe("declared");
  });

  it("still refuses an undeclared Vanta kind that crosses the row ceiling", () => {
    const counts = countKindRows({ entities: rows({ count: UNDECLARED_ROW_CEILING + 1 }), kind: "person" as const });
    expect(judgeKindVolume({ counts, verdicts: VANTA_KIND_VOLUMES.verdicts }).state).toBe("undeclared-volume");
  });
});
