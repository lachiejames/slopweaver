import { describe, expect, it } from "vitest";

import { countKindRows, judgeKindVolume, UNDECLARED_ROW_CEILING } from "../../../../atlas/kit/volume.js";
import { ONEPASSWORD_KINDS } from "../../../../atlas/onepassword/model.js";
import { ONEPASSWORD_KIND_VOLUMES } from "../../../../atlas/onepassword/volume.js";

/** Rows the kit only counts, so their content is irrelevant. */
const rows = ({ count }: { count: number }): readonly unknown[] => Array.from({ length: count }, () => ({}));

describe("the 1Password volume verdicts", () => {
  it("declares the audit feed as an observation its read window bounds, and nothing else", () => {
    expect(ONEPASSWORD_KIND_VOLUMES.verdicts.length).toBeGreaterThan(0);
    expect(ONEPASSWORD_KIND_VOLUMES.verdicts).toEqual([
      {
        because:
          "audit events — one row per sign-in, item use, vault grant or administrative action, each identified by the instant it happened and emitted by 1Password rather than created by anybody. Observations, not configuration; what keeps them holdable is the window the read declares rather than anything about the record",
        boundedBy:
          "the run's own `--since` window (`ONEPASSWORD_DEFAULT_SINCE_DAYS` = 30) and `eventsClient.ts`'s 200-page × 1,000-row walk bound, which publishes an `events-pagination-incomplete` gap rather than presenting a truncation as the whole feed",
        disposition: "bounded-observation",
        establishedBy: "wc -l ~/.slopweaver/atlas/onepassword/events.jsonl, against the run's own `--since` window",
        kind: "event",
        magnitude: "the live event-row tally over the run's declared `--since` window",
      },
    ]);
  });

  it("names only kinds this atlas actually holds", () => {
    expect(ONEPASSWORD_KIND_VOLUMES.verdicts.length).toBeGreaterThan(0);
    expect(ONEPASSWORD_KIND_VOLUMES.verdicts.filter((verdict) => !ONEPASSWORD_KINDS.includes(verdict.kind))).toEqual(
      [],
    );
  });

  it("lets event rows above the row ceiling publish as declared", () => {
    const counts = countKindRows({ entities: rows({ count: UNDECLARED_ROW_CEILING + 1 }), kind: "event" as const });
    expect(counts.rows).toBeGreaterThan(UNDECLARED_ROW_CEILING);
    expect(judgeKindVolume({ counts, verdicts: ONEPASSWORD_KIND_VOLUMES.verdicts }).state).toBe("declared");
  });

  it("still refuses an undeclared 1Password kind that crosses the row ceiling", () => {
    expect(ONEPASSWORD_KINDS).toContain("vault-grant");
    const counts = countKindRows({
      entities: rows({ count: UNDECLARED_ROW_CEILING + 1 }),
      kind: "vault-grant" as const,
    });
    expect(judgeKindVolume({ counts, verdicts: ONEPASSWORD_KIND_VOLUMES.verdicts }).state).toBe("undeclared-volume");
  });
});
