import { describe, expect, it } from "vitest";

import { CROWDSTRIKE_KINDS } from "../../../../atlas/crowdstrike/model.js";
import { CROWDSTRIKE_STORE_SPEC } from "../../../../atlas/crowdstrike/store.js";
import { CROWDSTRIKE_KIND_VOLUMES } from "../../../../atlas/crowdstrike/volume.js";
import { countKindRows, judgeKindVolume, UNDECLARED_ROW_CEILING } from "../../../../atlas/kit/volume.js";

/** Rows the kit only counts, so their content is irrelevant. */
const rows = ({ count }: { count: number }): readonly unknown[] => Array.from({ length: count }, () => ({}));

describe("the CrowdStrike volume verdicts", () => {
  it("declares open Spotlight findings as a bounded observation, and nothing else", () => {
    expect(CROWDSTRIKE_KIND_VOLUMES.verdicts.length).toBeGreaterThan(0);
    expect(CROWDSTRIKE_KIND_VOLUMES.verdicts).toEqual([
      {
        because:
          "open Spotlight findings — one row per host per CVE, carrying the base score, severity, exploit status and CISA KEV flag. Nobody authored one, so they are observations rather than configuration; what keeps them finite is that only OPEN findings are read, so a patched host's row leaves the set instead of accumulating beside its successor",
        boundedBy:
          "the reader's own `status:'open'` filter (`syncReaders.ts`), plus the fleet's installed software — this is current posture, not an append-only stream, and closed findings are deliberately never read",
        disposition: "bounded-observation",
        establishedBy: "slopweaver atlas crowdstrike read --kind vulnerability --json | jq '.page.matched'",
        kind: "vulnerability",
        magnitude:
          "the generation's open-findings tally read to the end of paging and matching the total the provider reported, and the kind file's row and byte size beside it (the file carries the envelope too); re-established by the command above, never kept here as an installation's figures",
      },
    ]);
  });

  it("names only kinds this atlas actually holds", () => {
    expect(CROWDSTRIKE_KIND_VOLUMES.verdicts.length).toBeGreaterThan(0);
    expect(CROWDSTRIKE_KIND_VOLUMES.verdicts.filter((verdict) => !CROWDSTRIKE_KINDS.includes(verdict.kind))).toEqual(
      [],
    );
  });

  it("is the declaration the store spec publishes against", () => {
    expect(CROWDSTRIKE_STORE_SPEC.kindVolumes).toBe(CROWDSTRIKE_KIND_VOLUMES);
  });

  it("lets an open-findings family above the row ceiling publish as declared", () => {
    const counts = countKindRows({
      entities: rows({ count: UNDECLARED_ROW_CEILING + 1 }),
      kind: "vulnerability" as const,
    });
    expect(counts.rows).toBeGreaterThan(UNDECLARED_ROW_CEILING);
    expect(judgeKindVolume({ counts, verdicts: CROWDSTRIKE_KIND_VOLUMES.verdicts }).state).toBe("declared");
  });

  it("still refuses an undeclared CrowdStrike kind that crosses the row ceiling", () => {
    expect(CROWDSTRIKE_KINDS).toContain("detection");
    const counts = countKindRows({ entities: rows({ count: UNDECLARED_ROW_CEILING + 1 }), kind: "detection" as const });
    expect(judgeKindVolume({ counts, verdicts: CROWDSTRIKE_KIND_VOLUMES.verdicts }).state).toBe("undeclared-volume");
  });
});
