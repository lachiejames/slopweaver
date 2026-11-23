/*
 * The page's own schema is asserted rather than assumed: it accepts covered, closed and regressed findings and a
 * collector's ellipsis, and a headline it would refuse is refused here first, naming the finding and the reason.
 */
import { describe, expect, it } from "vitest";

import { unwrapErr } from "#lib/result.js";

import { sectionSchema } from "../../../../outbound/briefing/sectionSchema.js";
import { renderSelfImprovementSection } from "../../../../reflect/briefingSection.js";
import { finding, headlineText, ranked, render } from "./harness.js";

describe("renderSelfImprovementSection — the page's own schema", () => {
  it("accepts a covered, a closed and a regressed finding together", () => {
    const section = render({
      findings: [
        ranked({ finding: finding({ coveredBy: ["probe-filter-defect"] }), id: "covered" }),
        ranked({ closedAtIso: "2026-09-19T02:00:00.000Z", closedBy: "slopweaver#1180", id: "closed" }),
        ranked({ closedAtIso: "2026-09-19T01:00:00.000Z", closedBy: "slopweaver#1180", id: "regressed" }),
      ],
    });
    expect(sectionSchema.safeParse(section).success).toBe(true);
  });

  it("accepts a collector's summary and evidence that end in the ellipsis its width bound left", () => {
    const candidate = ranked({
      finding: finding({
        evidence: ["pr-format: no PR body provided (pass --pr-body-fi…"],
        summary: "dev-gate failed: pr-format: no PR bo…",
      }),
    });
    const section = render({ findings: [candidate] });
    expect(headlineText({ note: section.notes[0]! })).toContain("no PR bo… — still happening");
    expect(section.notes[0]!.detail!.blocks[1]).toEqual({
      items: [[{ kind: "text", text: "pr-format: no PR body provided (pass --pr-body-fi…" }]],
      kind: "list",
      ordered: false,
    });
  });

  it("refuses, naming the finding and the schema's own reason, a headline the page would refuse", () => {
    const candidate = ranked({
      finding: finding({ summary: "steps 1) read 2) write 3) check were skipped" }),
      id: "packed-one",
    });
    const refused = unwrapErr(renderSelfImprovementSection({ findings: [candidate], notShown: 0 }));
    expect(refused.code).toBe("NOTES_REFUSED");
    expect(refused.message).toContain("packed-one: headline.0.text: packs more than 2 numbers into running prose");
  });

  it("is deterministic: the same findings render the same section", () => {
    const findings = [ranked({ finding: finding({ coveredBy: ["b", "a"] }) })];
    expect(render({ findings })).toEqual(render({ findings }));
  });
});
