import { describe, expect, it } from "vitest";

import type { DigestForm } from "../../../../../outbound/artifact/digestFields.js";
import { updateArtifactSchema } from "../../../../../outbound/artifact/schema.js";
import { derive, knockForm } from "./harness.js";

describe("digestToUpdate — citations are placed, not merely declared", () => {
  it("emits a citation run for each item that supplied a query URL", () => {
    const card = derive({ form: knockForm() });
    const chipCounts = card.index.map((line) => line.filter((run) => run.type === "citation").length);

    // The red and one orange item carry a citationUrl; the other two do not.
    expect(chipCounts).toEqual([1, 1, 0, 0]);
  });

  it("labels them [1] and [2] in severity order, with unique positional ids", () => {
    const card = derive({ form: knockForm() });

    expect(card.citations.map((c) => c.label)).toEqual(["[1]", "[2]"]);
    expect(card.citations.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("points each chip at a citation that exists — the renderer THROWS otherwise", () => {
    const card = derive({ form: knockForm() });
    const known = new Set(card.citations.map((c) => c.id));
    const referenced = card.index.flatMap((line) =>
      line.filter((run) => run.type === "citation").map((run) => (run.type === "citation" ? run.citationId : "")),
    );

    expect(referenced.every((id) => known.has(id))).toBe(true);
  });

  it("keeps ids unique when two items share a ticket key", () => {
    const shared = { id: "KK-1770", url: "https://example.invalid/KK-1770" };
    const form: DigestForm = {
      ...knockForm(),
      items: [
        { citationUrl: "https://example.invalid/a", count: 1, severity: "red", ticket: shared, title: "symptom one" },
        { citationUrl: "https://example.invalid/b", count: 2, severity: "red", ticket: shared, title: "symptom two" },
      ],
    };
    const card = derive({ form });

    expect(card.citations.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(updateArtifactSchema.safeParse(card).success).toBe(true);
  });
});
