import { describe, expect, it } from "vitest";

import {
  freshnessSectionSchema,
  nothingStaleSectionSchema,
  projectedSectionFields,
  sectionSchema,
} from "../../../../outbound/briefing/sectionSchema.js";

const section = ({ id }: { id: string }) => ({
  id,
  notes: [{ headline: [{ kind: "text", text: "A line." }] }],
  summary: "A summary",
});

const issuesOf = ({ result }: { result: { success: boolean; error?: { issues: { message: string }[] } } }) =>
  result.error!.issues.map((issue) => issue.message);

describe("the fixed-id section schemas", () => {
  it("lets the Nothing stale section carry its own fixed id", () => {
    expect(nothingStaleSectionSchema.safeParse(section({ id: "nothing-stale" })).success).toBe(true);
  });

  it("refuses the Nothing stale section another projection's fixed id", () => {
    expect(issuesOf({ result: nothingStaleSectionSchema.safeParse(section({ id: "freshness" })) })).toEqual([
      expect.stringContaining("a section id may not be one the renderer already emits"),
    ]);
  });

  it("refuses a composer's section, and the freshness section, the id nothing-stale", () => {
    expect(issuesOf({ result: sectionSchema.safeParse(section({ id: "nothing-stale" })) })).toEqual([
      expect.stringContaining("a section id may not be one the renderer already emits"),
    ]);
    expect(issuesOf({ result: freshnessSectionSchema.safeParse(section({ id: "nothing-stale" })) })).toEqual([
      expect.stringContaining("a section id may not be one the renderer already emits"),
    ]);
  });

  it("spreads exactly the two projected sections into the form", () => {
    expect(Object.keys(projectedSectionFields)).toEqual(["freshness", "nothingStale"]);
  });
});
