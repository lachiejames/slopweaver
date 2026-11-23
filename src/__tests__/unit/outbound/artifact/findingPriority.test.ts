import { describe, expect, it } from "vitest";

import {
  FINDING_IMPACT_GRADES,
  FINDING_PRIORITY_MATRIX,
  FINDING_USER_BANDS,
  findingPriorityOf,
  findingPriorityReason,
  findingUserBandOf,
  isSurfaceableFindingPriority,
  STAGING_PRIORITY_CEILING,
} from "../../../../outbound/artifact/findingPriority.js";
import { PRIORITIES } from "../../../../outbound/artifact/priority.js";

describe("findingUserBandOf", () => {
  it.each([
    [1, "one"],
    [2, "few"],
    [9, "few"],
    [10, "some"],
    [99, "some"],
    [100, "many"],
    [5000, "many"],
  ] as const)("bands %i unique users as %s", (users, band) => {
    expect(findingUserBandOf({ users })).toBe(band);
  });

  it("bands an unmeasured count as unknown", () => {
    expect(findingUserBandOf({ users: undefined })).toBe("unknown");
  });
});

describe("FINDING_PRIORITY_MATRIX", () => {
  it("holds every cell of the ruling's table", () => {
    expect(FINDING_PRIORITY_MATRIX).toEqual({
      high: { few: "P2", many: "P0", one: "P3", some: "P1", unknown: "P2" },
      low: { few: "P4", many: "P2", one: "P4", some: "P3", unknown: "P4" },
      medium: { few: "P3", many: "P1", one: "P3", some: "P2", unknown: "P3" },
    });
  });

  it("reads unknown as the few cell in every row", () => {
    expect(FINDING_IMPACT_GRADES.length).toBeGreaterThan(0);
    expect(FINDING_IMPACT_GRADES.map((grade) => FINDING_PRIORITY_MATRIX[grade].unknown)).toEqual(
      FINDING_IMPACT_GRADES.map((grade) => FINDING_PRIORITY_MATRIX[grade].few),
    );
  });

  it("puts P0 in exactly one cell, high on many", () => {
    const p0 = FINDING_IMPACT_GRADES.flatMap((grade) =>
      FINDING_USER_BANDS.filter((band) => FINDING_PRIORITY_MATRIX[grade][band] === "P0").map(
        (band) => `${grade}/${band}`,
      ),
    );
    expect(p0).toEqual(["high/many"]);
  });
});

describe("findingPriorityOf", () => {
  it("reads the production cell unchanged", () => {
    expect(findingPriorityOf({ env: "production", grade: "high", users: 240 })).toBe("P0");
    expect(findingPriorityOf({ env: "production", grade: "high", users: 2 })).toBe("P2");
    expect(findingPriorityOf({ env: "production", grade: "medium", users: undefined })).toBe("P3");
  });

  it("holds a staging finding to the ceiling however bad its cell", () => {
    expect(STAGING_PRIORITY_CEILING).toBe("P2");
    expect(findingPriorityOf({ env: "staging", grade: "high", users: 240 })).toBe("P2");
    expect(findingPriorityOf({ env: "staging", grade: "medium", users: 40 })).toBe("P2");
  });

  it("leaves a staging cell below the ceiling where it is", () => {
    expect(findingPriorityOf({ env: "staging", grade: "low", users: 3 })).toBe("P4");
    expect(findingPriorityOf({ env: "staging", grade: "high", users: 1 })).toBe("P3");
  });
});

describe("isSurfaceableFindingPriority", () => {
  it("clears P0, P1 and P2 and nothing else", () => {
    expect(PRIORITIES.filter((priority) => isSurfaceableFindingPriority({ priority }))).toEqual(["P0", "P1", "P2"]);
  });
});

describe("findingPriorityReason", () => {
  it.each([
    [1, "medium impact on 1 user"],
    [5, "medium impact on 2 to 9 users"],
    [40, "medium impact on 10 to 99 users"],
    [250, "medium impact on 100 or more users"],
    [undefined, "medium impact on an uncounted blast radius, ranked as 2 to 9 users"],
  ])("names the band %s users was ranked on in production", (users, reason) => {
    expect(findingPriorityReason({ env: "production", grade: "medium", users })).toBe(reason);
  });

  it("names the staging ceiling only when it lowered the cell", () => {
    expect(findingPriorityReason({ env: "staging", grade: "high", users: 40 })).toBe(
      "high impact on 10 to 99 users, capped from P1 in staging",
    );
    expect(findingPriorityReason({ env: "staging", grade: "high", users: 5 })).toBe("high impact on 2 to 9 users");
  });
});
