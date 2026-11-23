import { describe, expect, it } from "vitest";

import { orderedProposals, planLinearBriefingBundle } from "../../../../outbound/linear/briefingPlan.js";
import { BRIEFING } from "./briefingFixture.js";

const OUT = "/home/briefings/2026-10-26";

describe("orderedProposals", () => {
  it("puts every high-confidence item first, keeping each group's composed order", () => {
    const ids = orderedProposals({ proposals: BRIEFING.proposals }).map((proposal) => proposal.id);

    expect(ids).toEqual(["eng-9-backlog", "eng-3-superseded", "eng-7-comment", "alpha-update"]);
  });
});

describe("planLinearBriefingBundle", () => {
  const bundle = planLinearBriefingBundle({ form: BRIEFING, outDir: OUT });

  it("names one form file per write, numbered in the order they apply", () => {
    expect(bundle.files.map((file) => file.name)).toEqual([
      "forms/01-eng-9-backlog-move.json",
      "forms/02-eng-3-superseded-comment.json",
      "forms/02-eng-3-superseded-relation.json",
      "forms/02-eng-3-superseded-move.json",
      "forms/03-eng-7-comment-comment.json",
      "forms/04-alpha-update-project-update.json",
    ]);
  });

  it("writes each step's form as exactly the embedded provider form", () => {
    const relation = bundle.files.find((file) => file.name.endsWith("relation.json"))!;

    expect(JSON.parse(relation.contents)).toEqual({
      fields: {
        issueId: "3e000000-0000-4000-8000-000000000003",
        relatedIssueId: "12e00000-0000-4000-8000-000000000012",
        type: "duplicate",
      },
    });
  });

  it("derives each command from the write's kind, the form read from the bundle on stdin", () => {
    const backlog = bundle.items[0]!;

    expect(backlog.steps.map((step) => step.apply)).toEqual([
      "slopweaver linear issue update --fields-only --issue-id '9e000000-0000-4000-8000-000000000009' --form - < " +
        "'/home/briefings/2026-10-26/forms/01-eng-9-backlog-move.json'",
    ]);
    expect(backlog.steps[0]!.dryRun).toBe(
      "slopweaver linear issue update --fields-only --issue-id '9e000000-0000-4000-8000-000000000009' --form - " +
        "--dry-run < " +
        "'/home/briefings/2026-10-26/forms/01-eng-9-backlog-move.json'",
    );
  });

  it("orders a supersession comment, then edge, then close", () => {
    expect(bundle.items[1]!.steps.map((step) => step.label)).toEqual(["comment", "relation", "move"]);
  });

  it("single-quotes a path holding a quote so it stays one word", () => {
    const quoted = planLinearBriefingBundle({ form: BRIEFING, outDir: "/home/o'brien" });

    expect(quoted.items[2]!.steps[0]!.apply).toBe(
      "slopweaver linear comment create --form - < '/home/o'\\''brien/forms/03-eng-7-comment-comment.json'",
    );
  });

  it("maps the high-confidence option to exactly the high items", () => {
    expect(bundle.onOwnerWord).toContain("- **apply the high-confidence ones** — `eng-9-backlog`, `eng-3-superseded`;");
  });

  it("names the floor only a fully landed apply-all moves", () => {
    expect(bundle.onOwnerWord).toContain("this briefing's `asOfIso`: `2026-10-26T06:30:00Z`.");
  });

  it("says none when no item is high confidence", () => {
    const lowOnly = planLinearBriefingBundle({
      form: { ...BRIEFING, proposals: BRIEFING.proposals.filter((proposal) => proposal.confidence === "low") },
      outDir: OUT,
    });

    expect(lowOnly.onOwnerWord).toContain("- **apply the high-confidence ones** — none; nothing else.");
  });
});
