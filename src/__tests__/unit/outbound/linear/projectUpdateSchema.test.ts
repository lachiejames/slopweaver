/**
 * `linearProjectUpdateFormSchema`: the form a `linear project-update create` write validates against. Structure
 * is refused — a missing or unknown health, an empty project, an offset-less timestamp, a summary that is not
 * one line within the word cap, an unsafe evidence link, an undeclared key at any level — and words never are.
 */
import { describe, expect, it } from "vitest";

import { linearProjectUpdateFormSchema } from "../../../../outbound/linear/projectUpdateSchema.js";
import { SECTION_MAX_WORDS } from "../../../../outbound/linear/sectionWords.js";

/** The minimum valid update: a one-line summary, a project and a health. */
const MINIMAL = {
  artifact: { summary: "Migration is on track for Friday." },
  fields: { health: "onTrack", projectId: "proj-alpha" },
};

/**
 * Every issue a refused form raised, as `path: message`, read off the error arm without a branch.
 *
 * @returns the issues
 */
function issuesOf({ form }: { form: unknown }): readonly string[] {
  const parsed = linearProjectUpdateFormSchema.safeParse(form);
  expect(parsed.success).toBe(false);
  return parsed.error!.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

/**
 * The form with its summary replaced.
 *
 * @returns the form
 */
function withSummary({ summary }: { summary: string }): unknown {
  return { ...MINIMAL, artifact: { summary } };
}

/**
 * The form with its fields replaced.
 *
 * @returns the form
 */
function withFields({ fields }: { fields: Record<string, unknown> }): unknown {
  return { ...MINIMAL, fields };
}

describe("linearProjectUpdateFormSchema — accepted forms", () => {
  it("accepts the minimal form under each of the three health values, parsing it unchanged", () => {
    const forms = ["atRisk", "offTrack", "onTrack"].map((health) => ({
      ...MINIMAL,
      fields: { ...MINIMAL.fields, health },
    }));

    expect(forms.map((form) => linearProjectUpdateFormSchema.parse(form))).toEqual(forms);
  });

  it("accepts detail, evidence and an offset overdueSince alongside the required fields", () => {
    const form = {
      artifact: {
        detail: [{ kind: "para", text: "The cutover slipped a day while the backfill finished." }],
        evidence: [{ label: "the backfill run", url: "https://example.test/run/7" }],
        summary: "Migration is at risk by one day.",
      },
      fields: { health: "atRisk", overdueSince: "2026-10-12T09:00:00+10:00", projectId: "proj-alpha" },
    };

    expect(linearProjectUpdateFormSchema.parse(form)).toEqual(form);
  });

  it("draws the summary cap at fifty words: fifty parse, fifty-one are refused", () => {
    const atCap = Array.from({ length: 50 }, () => "word").join(" ");
    const overCap = `${atCap} word`;

    expect(SECTION_MAX_WORDS).toBe(50);
    expect(linearProjectUpdateFormSchema.parse(withSummary({ summary: atCap })).artifact.summary).toBe(atCap);
    expect(linearProjectUpdateFormSchema.safeParse(withSummary({ summary: overCap })).success).toBe(false);
  });
});

describe("linearProjectUpdateFormSchema — refused fields", () => {
  it("refuses a form with no health at the health path", () => {
    expect(issuesOf({ form: withFields({ fields: { projectId: "proj-alpha" } }) }).map((i) => i.split(":")[0])).toEqual(
      ["fields.health"],
    );
  });

  it("refuses a health outside the closed three", () => {
    const issues = issuesOf({ form: withFields({ fields: { health: "fine", projectId: "proj-alpha" } }) });

    expect(issues.length).toBe(1);
    expect(issues[0]!.startsWith("fields.health: ")).toBe(true);
  });

  it("refuses an empty project id", () => {
    const issues = issuesOf({ form: withFields({ fields: { health: "onTrack", projectId: "" } }) });

    expect(issues.length).toBe(1);
    expect(issues[0]!.startsWith("fields.projectId: ")).toBe(true);
  });

  it("refuses an overdueSince that is not a timestamp", () => {
    const issues = issuesOf({
      form: withFields({ fields: { health: "offTrack", overdueSince: "last tuesday", projectId: "proj-alpha" } }),
    });

    expect(issues.length).toBe(1);
    expect(issues[0]!.startsWith("fields.overdueSince: ")).toBe(true);
  });

  it("accepts a Z-suffixed overdueSince and refuses one with no offset at all", () => {
    const zulu = withFields({ fields: { health: "offTrack", overdueSince: "2026-10-12T09:00:00Z", projectId: "p" } });
    const bare = withFields({ fields: { health: "offTrack", overdueSince: "2026-10-12T09:00:00", projectId: "p" } });

    expect(linearProjectUpdateFormSchema.safeParse(zulu).success).toBe(true);
    expect(issuesOf({ form: bare }).map((i) => i.split(":")[0])).toEqual(["fields.overdueSince"]);
  });
});

describe("linearProjectUpdateFormSchema — refused summaries", () => {
  it("refuses an empty summary", () => {
    const issues = issuesOf({ form: withSummary({ summary: "" }) });

    expect(issues.length).toBe(1);
    expect(issues[0]!.startsWith("artifact.summary: ")).toBe(true);
  });

  it("refuses a newline in the summary with the ONE-line message", () => {
    expect(issuesOf({ form: withSummary({ summary: "one\ntwo" }) })).toEqual([
      "artifact.summary: a project update summary is ONE line — put the rest in detail, which folds",
    ]);
  });

  it("refuses a summary that opens with Linear's +++ delimiter", () => {
    expect(issuesOf({ form: withSummary({ summary: "+++ gotcha" }) })).toEqual([
      'artifact.summary: a line beginning with "+++" is Linear\'s collapsible delimiter and would close the detail block early',
    ]);
  });

  it("refuses a +++ a vertical tab, form feed or NEL puts on its own line in the summary, as a split line too", () => {
    const refusals = [
      "artifact.summary: a project update summary is ONE line — put the rest in detail, which folds",
      'artifact.summary: a line beginning with "+++" is Linear\'s collapsible delimiter and would close the detail block early',
    ];

    expect(
      [0x0b, 0x0c, 0x85].map((code) =>
        issuesOf({ form: withSummary({ summary: `gotcha${String.fromCodePoint(code)}+++` }) }),
      ),
    ).toEqual([refusals, refusals, refusals]);
  });

  it("refuses a summary any line ending splits, a vertical tab or NEL included", () => {
    expect(
      [0x0b, 0x85, 0x2028].map((code) =>
        issuesOf({ form: withSummary({ summary: `one${String.fromCodePoint(code)}two` }) }).map((issue) =>
          issue.includes("ONE line"),
        ),
      ),
    ).toEqual([[true], [true], [true]]);
  });

  it("refuses a summary one word over the cap, naming the cap", () => {
    const summary = Array.from({ length: SECTION_MAX_WORDS + 1 }, () => "word").join(" ");

    expect(issuesOf({ form: withSummary({ summary }) })).toEqual([
      `artifact.summary: a project update summary is the whole report above the fold, so it is capped at ${String(SECTION_MAX_WORDS)} words — move the rest into detail, which renders collapsed`,
    ]);
  });
});

describe("linearProjectUpdateFormSchema — refused evidence and structure", () => {
  it("refuses a newline in an evidence label", () => {
    const form = {
      ...MINIMAL,
      artifact: { evidence: [{ label: "one\ntwo", url: "https://example.test/a" }], summary: "Lead." },
    };

    expect(issuesOf({ form })).toEqual([
      "artifact.evidence.0.label: an evidence label renders as ONE list item; the newline would break it",
    ]);
  });

  it("refuses an evidence URL carrying an angle bracket", () => {
    const form = {
      ...MINIMAL,
      artifact: { evidence: [{ label: "run", url: "https://example.test/a>b" }], summary: "Lead." },
    };

    expect(issuesOf({ form })).toEqual([
      "artifact.evidence.0.url: an evidence URL may not contain whitespace or angle brackets",
    ]);
  });

  it("refuses an undeclared top-level key at the root", () => {
    const issues = issuesOf({ form: { ...MINIMAL, extra: true } });

    expect(issues.length).toBe(1);
    expect(issues[0]!.startsWith(": ")).toBe(true);
    expect(issues[0]!).toContain("extra");
  });

  it("refuses an undeclared key inside artifact", () => {
    const issues = issuesOf({ form: { ...MINIMAL, artifact: { ...MINIMAL.artifact, impact: "high" } } });

    expect(issues.length).toBe(1);
    expect(issues[0]!.startsWith("artifact: ")).toBe(true);
    expect(issues[0]!).toContain("impact");
  });

  it("refuses an undeclared key inside fields", () => {
    const issues = issuesOf({ form: withFields({ fields: { ...MINIMAL.fields, teamId: "t" } }) });

    expect(issues.length).toBe(1);
    expect(issues[0]!.startsWith("fields: ")).toBe(true);
    expect(issues[0]!).toContain("teamId");
  });
});

/**
 * The form with this detail under the minimal summary.
 *
 * @returns the form
 */
function withDetail({ detail }: { detail: readonly unknown[] }): unknown {
  return { ...MINIMAL, artifact: { ...MINIMAL.artifact, detail } };
}

describe("linearProjectUpdateFormSchema — the folded detail owes the structural checks", () => {
  it("refuses a bare +++ line in a detail paragraph, which would close the update's own fold early", () => {
    const issues = issuesOf({ form: withDetail({ detail: [{ kind: "para", text: "before\n+++\nafter" }] }) });

    expect(issues.map((issue) => issue.split(": ")[0])).toEqual(["artifact.detail.0.text"]);
    expect(issues[0]!).toContain('a line beginning with "+++" is Linear\'s collapsible delimiter');
  });

  it("refuses a +++ line in a nested block and a fence opener in a detail paragraph", () => {
    const detail = [
      { items: [{ nested: [{ kind: "para", text: "+++ Smuggled" }], text: "item" }], kind: "bullets" },
      { kind: "para", text: "```\nunclosed" },
    ];

    expect(issuesOf({ form: withDetail({ detail }) }).map((issue) => issue.split(": ")[0])).toEqual([
      "artifact.detail.0.items.0.nested.0.text",
      "artifact.detail.1.text",
    ]);
  });

  it("refuses an unterminated HTML comment in a detail paragraph, which would swallow the fold's closer", () => {
    const issues = issuesOf({ form: withDetail({ detail: [{ kind: "para", text: "<!--" }] }) });

    expect(issues.map((issue) => issue.split(": ")[0])).toEqual(["artifact.detail.0.text"]);
    expect(issues[0]!).toContain("raw HTML");
  });

  it("refuses raw HTML in the summary, but not in an evidence label, which renders escaped", () => {
    const form = {
      ...MINIMAL,
      artifact: {
        evidence: [{ label: "the Array<string> run", url: "https://example.test/run/7" }],
        summary: "On track <em>for now</em>",
      },
    };

    expect(issuesOf({ form }).map((issue) => issue.split(": ")[0])).toEqual(["artifact.summary"]);
  });

  it("refuses a summary opening a code fence, which would swallow the detail fold below it", () => {
    const issues = ["```", "~~~ ts"].map((summary) => issuesOf({ form: withSummary({ summary }) }));

    expect(issues.map((found) => found.map((issue) => issue.slice(0, 48)))).toEqual([
      ["artifact.summary: a summary opening a code fence"],
      ["artifact.summary: a summary opening a code fence"],
    ]);
  });

  it("accepts a +++ diff header inside a code block, and markup quoted in a code span", () => {
    const form = withDetail({
      detail: [
        { kind: "code", lang: "diff", text: "+++ b/src/a.ts\n<!-- kept -->" },
        { kind: "para", text: "The type is `Array<string>` and a < b." },
      ],
    });

    expect(linearProjectUpdateFormSchema.parse(form)).toEqual(form);
  });
});
