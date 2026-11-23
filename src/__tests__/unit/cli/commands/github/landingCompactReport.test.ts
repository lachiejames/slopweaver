import { describe, expect, it } from "vitest";

import { collapsedResidueLine, landingCompactLines } from "../../../../../cli/commands/github/landingCompactReport.js";
import { landingRowFake } from "../../../../landingRowFake.js";

describe("landingCompactLines", () => {
  it("groups the owner's decisions first, then presses, then non-act rows, keeping fleet order within a group", () => {
    const rows = [
      landingRowFake({ action: "queued", dispatch: { kind: "waiting", why: "queued" }, number: 1 }),
      landingRowFake({ number: 2 }),
      landingRowFake({
        action: "answer-threads",
        dispatch: { kind: "act", verdict: "needs-owner-judgment", why: "design call" },
        number: 3,
      }),
      landingRowFake({ number: 4 }),
    ];

    const lines = landingCompactLines({ rows });

    expect(lines.filter((line) => !line.startsWith("  "))).toEqual([
      "needs-owner-judgment — 1",
      "merge-now — 2",
      "waiting — 1",
    ]);
    expect(lines.filter((line) => line.startsWith("  ")).map((line) => line.split(" ")[2])).toEqual([
      "acme/widgets#3",
      "acme/widgets#2",
      "acme/widgets#4",
      "acme/widgets#1",
    ]);
  });

  it("prints nothing for no rows", () => {
    expect(landingCompactLines({ rows: [] })).toEqual([]);
  });
});

describe("collapsedResidueLine", () => {
  it("folds every residue line into one naming the flags that print them", () => {
    expect(collapsedResidueLine({ residue: ["a", "b"] })).toBe(
      "2 residue line(s) folded — rerun with --full, or --pr <n> with one --repo, to read them",
    );
  });

  it("prints no fold line when there is nothing to fold", () => {
    expect(collapsedResidueLine({ residue: [] })).toBeUndefined();
  });
});
