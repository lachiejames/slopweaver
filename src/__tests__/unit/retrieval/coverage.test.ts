import { describe, expect, it } from "vitest";
import type { SkipTally } from "../../../corpus/corpusTallyCore.js";
import { buildSubsetManifest } from "../../../corpus/subset.js";
import {
  buildLeg,
  type CoverageLeg,
  classifyLeg,
  conservationBreach,
  conservationBreaches,
  failedLegs,
  isRefreshableLeg,
  legObservationAgeDays,
  legsBeyondRefusal,
  REFUSE_AFTER_DAYS,
  renderCoverageLines,
  STALE_AFTER_DAYS,
  skippedTotal,
} from "../../../retrieval/coverage.js";

const NOW = "2026-08-06T00:00:00.000Z";

const leg = (over: Partial<CoverageLeg> = {}): CoverageLeg => ({
  detail: "newest record is 0.0d old",
  indexed: 10,
  ingested: 10,
  leg: "github",
  skipped: [],
  state: "ok",
  ...over,
});

const classify = ({
  indexed = 1,
  newestIso,
  staleAfterDays = STALE_AFTER_DAYS,
  unreadable = [],
}: {
  unreadable?: readonly string[];
  indexed?: number;
  newestIso?: string;
  staleAfterDays?: number;
}): { state: string; detail: string } => classifyLeg({ indexed, newestIso, nowIso: NOW, staleAfterDays, unreadable });

describe("classifyLeg — the three states that used to be one", () => {
  it("reports FAILED when a path could not be read, even though it also has no records", () => {
    const result = classify({ indexed: 0, unreadable: ["/x/a.jsonl", "/x/b.jsonl"] });
    expect(result.state).toBe("failed");
    expect(result.detail).toBe("2 path(s) could not be read");
  });

  it("reports ABSENT when there is simply nothing on disk", () => {
    const result = classify({ indexed: 0 });
    expect(result.state).toBe("absent");
    expect(result.detail).toBe("no records on disk for this leg");
  });

  it("reports STALE when the newest record is older than the threshold", () => {
    const result = classify({ newestIso: "2026-05-06T00:00:00.000Z" });
    expect(result.state).toBe("stale");
    expect(result.detail).toBe("newest record is 92.0d old (> 7d)");
  });

  it("reports OK at exactly the threshold — the boundary is `older than`, not `at least`", () => {
    expect(classify({ newestIso: "2026-07-30T00:00:00.000Z" }).state).toBe("ok");
    expect(classify({ newestIso: "2026-07-29T23:00:00.000Z" }).state).toBe("stale");
  });

  it("reports STALE, not OK, when records carry no readable timestamp", () => {
    const result = classify({ indexed: 4 });
    expect(result.state).toBe("stale");
    expect(result.detail).toBe("4 record(s), none carrying a readable timestamp");
  });

  it("reports STALE when the newest timestamp is unparseable rather than trusting it", () => {
    const result = classify({ indexed: 2, newestIso: "not-a-date" });
    expect(result.state).toBe("stale");
    expect(result.detail).toBe("2 record(s); newest timestamp not-a-date is unparseable");
  });

  it("clamps a future-dated leg to 0.0d rather than printing a negative age", () => {
    expect(classify({ newestIso: "2026-08-07T00:00:00.000Z" }).detail).toBe("newest record is 0.0d old");
  });
});

describe("skippedTotal", () => {
  it("sums every skip class", () => {
    const skipped: readonly SkipTally[] = [
      { count: 3, reason: "invalid-json" },
      { count: 12, reason: "superseded" },
    ];
    expect(skippedTotal({ skipped })).toBe(15);
  });

  it("is 0 for a leg that skipped nothing", () => {
    expect(skippedTotal({ skipped: [] })).toBe(0);
  });
});

describe("the conservation law", () => {
  it("holds when indexed + skipped accounts for every ingested row", () => {
    const balanced = leg({ indexed: 7, ingested: 10, skipped: [{ count: 3, reason: "invalid-json" }] });
    expect(conservationBreach({ leg: balanced })).toBeUndefined();
  });

  it("names the unexplained rows when it does not", () => {
    const short = leg({ indexed: 7, ingested: 10, skipped: [{ count: 1, reason: "invalid-json" }] });
    expect(conservationBreach({ leg: short })).toBe("github: 10 ingested but 8 accounted for (2 unexplained)");
  });

  it("reports an OVER-count too — more accounted for than read is just as wrong", () => {
    const over = leg({ indexed: 12, ingested: 10, skipped: [] });
    expect(conservationBreach({ leg: over })).toBe("github: 10 ingested but 12 accounted for (-2 unexplained)");
  });

  it("collects every breaching leg across a manifest", () => {
    const manifest = {
      legs: [leg({ indexed: 10, ingested: 10 }), leg({ indexed: 1, ingested: 5, leg: "slack" })],
    };
    expect(conservationBreaches({ manifest })).toEqual(["slack: 5 ingested but 1 accounted for (4 unexplained)"]);
  });
});

describe("failedLegs", () => {
  it("selects only the failed legs, leaving absent and stale alone", () => {
    const manifest = {
      legs: [
        leg({ leg: "github", state: "ok" }),
        leg({ leg: "gold", state: "absent" }),
        leg({ leg: "linear", state: "stale" }),
        leg({ leg: "slack", state: "failed" }),
      ],
    };
    expect(failedLegs({ manifest }).map((l) => l.leg)).toEqual(["slack"]);
  });

  it("is empty for a healthy manifest", () => {
    expect(failedLegs({ manifest: { legs: [leg()] } })).toEqual([]);
  });
});

describe("buildLeg", () => {
  it("carries the newest timestamp through and classifies from it", () => {
    const built = buildLeg({
      indexed: 5,
      ingested: 6,
      leg: "self",
      newestIso: "2026-08-05T00:00:00.000Z",
      nowIso: NOW,
      skipped: [{ count: 1, reason: "invalid-json" }],
      staleAfterDays: STALE_AFTER_DAYS,
      unreadable: [],
    });
    expect(built).toEqual({
      detail: "newest record is 1.0d old",
      indexed: 5,
      ingested: 6,
      leg: "self",
      newestIso: "2026-08-05T00:00:00.000Z",
      skipped: [{ count: 1, reason: "invalid-json" }],
      state: "ok",
    });
  });

  it("omits newestIso entirely for a leg that contributed nothing", () => {
    const built = buildLeg({
      indexed: 0,
      ingested: 0,
      leg: "gold",
      newestIso: undefined,
      nowIso: NOW,
      skipped: [],
      staleAfterDays: STALE_AFTER_DAYS,
      unreadable: [],
    });
    expect(built.state).toBe("absent");
    expect(Object.hasOwn(built, "newestIso")).toBe(false);
  });
});

describe("renderCoverageLines", () => {
  it("renders one line per leg plus the conservation verdict", () => {
    const manifest = {
      legs: [
        leg({
          detail: "newest record is 0.5d old",
          indexed: 9,
          ingested: 10,
          skipped: [{ count: 1, reason: "superseded" }],
        }),
        leg({ detail: "no records on disk for this leg", indexed: 0, ingested: 0, leg: "gold", state: "absent" }),
      ],
    };
    expect(renderCoverageLines({ manifest })).toEqual([
      "coverage:",
      "  github [ok] ingested=10 indexed=9 skipped=superseded ×1 — newest record is 0.5d old",
      "  gold [absent] ingested=0 indexed=0 skipped=- — no records on disk for this leg",
      "  conservation: ingested = indexed + skipped holds for every leg",
    ]);
  });

  it("shouts a conservation breach instead of the holds line", () => {
    const manifest = { legs: [leg({ indexed: 1, ingested: 5 })] };
    expect(renderCoverageLines({ manifest })[2]).toBe(
      "  CONSERVATION BREACH — github: 5 ingested but 1 accounted for (4 unexplained)",
    );
  });

  it("puts the subset banner ABOVE the legs, so a reader who stops at line one still learns the window", () => {
    const manifest = {
      legs: [leg()],
      subset: buildSubsetManifest({
        builtAtIso: "2026-08-24T16:00:00.000Z",
        days: 7,
        sinceIso: "2026-08-17T16:00:00.000Z",
        sourceHome: "/corpus/full",
        sources: [{ kept: 10, scanned: 100, source: "github", undated: 0 }],
        untilIso: "2026-08-24T16:00:00.000Z",
      }),
    };
    const lines = renderCoverageLines({ manifest });
    expect(lines[0]).toBe(
      "SUBSET — this world model holds only the last 7 day(s) " +
        "(2026-08-17T16:00:00.000Z → 2026-08-24T16:00:00.000Z), 10 record(s) sliced from /corpus/full. " +
        "Everything else is ABSENT from this home, not absent from the world.",
    );
    expect(lines[1]).toBe("coverage:");
  });

  it("says nothing extra for an ordinary full-corpus home", () => {
    expect(renderCoverageLines({ manifest: { legs: [leg()] } })[0]).toBe("coverage:");
  });
});

describe("legObservationAgeDays", () => {
  it("measures a leg's stored CURSOR against now, in days", () => {
    expect(legObservationAgeDays({ leg: leg({ cursorIso: "2026-08-01T00:00:00.000Z" }), nowIso: NOW })).toBe(5);
  });

  it("ignores the newest record entirely — a fresh record with an old cursor is an old observation", () => {
    const held = leg({ cursorIso: "2026-07-01T00:00:00.000Z", newestIso: "2026-08-06T00:00:00.000Z" });
    expect(legObservationAgeDays({ leg: held, nowIso: NOW })).toBe(36);
  });

  it("is undefined for a leg with no stored cursor", () => {
    expect(legObservationAgeDays({ leg: leg({ newestIso: "2026-08-01T00:00:00.000Z" }), nowIso: NOW })).toBeUndefined();
  });

  it("is undefined for a leg whose cursor will not parse", () => {
    expect(legObservationAgeDays({ leg: leg({ cursorIso: "not-a-date" }), nowIso: NOW })).toBeUndefined();
  });
});

describe("legsBeyondRefusal", () => {
  it("selects only the legs whose cursor is older than the threshold, with their measured ages", () => {
    const manifest = {
      legs: [
        leg({ cursorIso: "2026-08-05T00:00:00.000Z", leg: "slack" }),
        leg({ cursorIso: "2026-07-01T00:00:00.000Z", leg: "notion", state: "stale" as const }),
      ],
    };
    const beyond = legsBeyondRefusal({ manifest, nowIso: NOW, refuseAfterDays: 14 });
    expect(beyond.length).toBe(1);
    expect(beyond[0]!.leg.leg).toBe("notion");
    expect(beyond[0]!.ageDays).toBe(36);
  });

  it("REFUSES a held cursor even when the newest record is current — a capped run wrote rows it did not finish", () => {
    const manifest = {
      legs: [leg({ cursorIso: "2026-07-01T00:00:00.000Z", leg: "github", newestIso: "2026-08-06T00:00:00.000Z" })],
    };
    const beyond = legsBeyondRefusal({ manifest, nowIso: NOW, refuseAfterDays: 14 });
    expect(beyond.length).toBe(1);
    expect(beyond[0]!.leg.leg).toBe("github");
  });

  it("ALLOWS a quiet-but-checked source — a successful empty fetch advances the cursor and writes no record", () => {
    const manifest = {
      legs: [
        leg({
          cursorIso: "2026-08-06T00:00:00.000Z",
          leg: "notion",
          newestIso: "2026-06-01T00:00:00.000Z",
          state: "stale" as const,
        }),
      ],
    };
    expect(legsBeyondRefusal({ manifest, nowIso: NOW, refuseAfterDays: 14 })).toEqual([]);
  });

  it("never selects an ABSENT leg, however tight the threshold — it has nothing to be behind", () => {
    const manifest = { legs: [leg({ indexed: 0, ingested: 0, leg: "notion", state: "absent" as const })] };
    expect(legsBeyondRefusal({ manifest, nowIso: NOW, refuseAfterDays: 0 })).toEqual([]);
  });

  it("never selects a leg with no stored cursor — nothing ever recorded an observation to test", () => {
    const manifest = { legs: [leg({ leg: "notion", newestIso: "2026-01-01T00:00:00.000Z", state: "stale" as const })] };
    expect(legsBeyondRefusal({ manifest, nowIso: NOW, refuseAfterDays: 0 })).toEqual([]);
  });

  it("never selects a leg whose cursor is unparseable — a corrupt file is not evidence about the calendar", () => {
    const manifest = { legs: [leg({ cursorIso: "whenever", leg: "notion", state: "stale" as const })] };
    expect(legsBeyondRefusal({ manifest, nowIso: NOW, refuseAfterDays: 0 })).toEqual([]);
  });

  it("refuses at exactly twice the reporting threshold by default", () => {
    expect(REFUSE_AFTER_DAYS).toBe(STALE_AFTER_DAYS * 2);
  });

  it("never selects `self`, even if a cursor were somehow stored for it — refresh does not keep it current", () => {
    const manifest = { legs: [leg({ cursorIso: "2026-07-11T00:00:00.000Z", leg: "self", state: "stale" as const })] };
    expect(legsBeyondRefusal({ manifest, nowIso: NOW, refuseAfterDays: 14 })).toEqual([]);
  });

  it("never selects `gold`, which is synthesised per question rather than ingested", () => {
    const manifest = { legs: [leg({ cursorIso: "2026-01-01T00:00:00.000Z", leg: "gold", state: "stale" as const })] };
    expect(legsBeyondRefusal({ manifest, nowIso: NOW, refuseAfterDays: 14 })).toEqual([]);
  });
});

describe("isRefreshableLeg", () => {
  it("accepts every cursor-bearing corpus source", () => {
    expect(
      ["github", "slack", "linear", "notion", "gmail"].map((name) => isRefreshableLeg({ leg: leg({ leg: name }) })),
    ).toEqual([true, true, true, true, true]);
  });

  it("rejects the cursorless source, the gold layer and a flat --corpus root", () => {
    expect(["self", "gold", "(root)"].map((name) => isRefreshableLeg({ leg: leg({ leg: name }) }))).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("renderCoverageLines with a stored cursor", () => {
  it("appends the leg's resume cursor, so an answer states the watermark it was composed over", () => {
    const manifest = { legs: [leg({ cursorIso: "2026-08-05T12:00:00.000Z" })] };
    expect(renderCoverageLines({ manifest })[1]).toBe(
      "  github [ok] ingested=10 indexed=10 skipped=- — newest record is 0.0d old · cursor 2026-08-05T12:00:00.000Z",
    );
  });

  it("reads exactly as before for a leg that has no cursor", () => {
    expect(renderCoverageLines({ manifest: { legs: [leg()] } })[1]).toBe(
      "  github [ok] ingested=10 indexed=10 skipped=- — newest record is 0.0d old",
    );
  });
});
