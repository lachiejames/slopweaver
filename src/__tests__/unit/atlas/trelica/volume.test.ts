import { describe, expect, it } from "vitest";

import { countKindRows, judgeKindVolume, UNDECLARED_ROW_CEILING } from "../../../../atlas/kit/volume.js";
import { TRELICA_STORE_SPEC } from "../../../../atlas/trelica/store.js";
import { TRELICA_KIND_VOLUMES } from "../../../../atlas/trelica/volume.js";

/** Rows the kit only counts, so their content is irrelevant. */
const rows = ({ count }: { count: number }): readonly unknown[] => Array.from({ length: count }, () => ({}));

describe("the Trelica volume verdicts", () => {
  it("holds devices whole as bulk entities, and declares nothing else", () => {
    expect(TRELICA_KIND_VOLUMES.verdicts.map((verdict) => [verdict.kind, verdict.disposition])).toEqual([
      ["device", "bulk-entity"],
    ]);
  });

  it("is the declaration the store spec publishes against", () => {
    expect(TRELICA_STORE_SPEC.kindVolumes).toBe(TRELICA_KIND_VOLUMES);
  });

  it("lets device rows above the undeclared ceiling publish", () => {
    const counts = countKindRows({ entities: rows({ count: UNDECLARED_ROW_CEILING + 1 }), kind: "device" as const });
    expect(judgeKindVolume({ counts, verdicts: TRELICA_KIND_VOLUMES.verdicts }).state).toBe("declared");
  });

  it("still refuses an undeclared Trelica kind that crosses the row ceiling", () => {
    const counts = countKindRows({ entities: rows({ count: UNDECLARED_ROW_CEILING + 1 }), kind: "person" as const });
    expect(judgeKindVolume({ counts, verdicts: TRELICA_KIND_VOLUMES.verdicts }).state).toBe("undeclared-volume");
  });
});
