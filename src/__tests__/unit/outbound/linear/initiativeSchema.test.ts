/**
 * The three `linear initiative` forms. Structure is refused — a multi-line name or summary, a status or health
 * outside its closed set, a target date not in Linear's `TimelessDate` wire shape, an empty endpoint, an empty
 * optional array, Linear's `+++` delimiter, an undeclared key at any level — and words never are.
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  linearInitiativeFormSchema,
  linearInitiativeLinkFormSchema,
  linearInitiativeUpdateFormSchema,
} from "../../../../outbound/linear/initiativeSchema.js";
import { SECTION_MAX_WORDS } from "../../../../outbound/linear/sectionWords.js";

/**
 * Every issue a refused parse raised, as `path: message`, read off the error arm without a branch.
 *
 * @returns the issues
 */
function issuesOf({ schema, form }: { schema: z.ZodType; form: unknown }): readonly string[] {
  const parsed = schema.safeParse(form);
  expect(parsed.success).toBe(false);
  return parsed.error!.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

/**
 * Just the paths of a refused parse's issues.
 *
 * @returns one path per issue, dot-joined
 */
function pathsOf({ issues }: { issues: readonly string[] }): readonly string[] {
  return issues.map((issue) => issue.split(": ")[0]!);
}

const INITIATIVE = { fields: { name: "Store on Postgres" } };

/**
 * An initiative form with these fields.
 *
 * @returns the form
 */
function initiative({ fields }: { fields: Record<string, unknown> }): unknown {
  return { fields: { ...INITIATIVE.fields, ...fields } };
}

const UPDATE = {
  artifact: { summary: "Cutover is on track for Friday." },
  fields: { health: "onTrack", initiativeId: "init-1" },
};

/**
 * An update form with this summary.
 *
 * @returns the form
 */
function withSummary({ summary }: { summary: string }): unknown {
  return { ...UPDATE, artifact: { summary } };
}

describe("linearInitiativeFormSchema", () => {
  it("parses a form carrying every optional field unchanged", () => {
    const form = {
      fields: {
        description: "Move the store off SQLite.",
        leadTeamId: "team-eng",
        name: "Store on Postgres",
        ownerId: "user-1",
        status: "Active",
        targetDate: "2026-10-13",
      },
    };

    expect(linearInitiativeFormSchema.parse(form)).toEqual(form);
  });

  it("accepts each of the five statuses and refuses one outside them", () => {
    const forms = ["Active", "Canceled", "Completed", "Planned", "Proposed"].map((status) =>
      initiative({ fields: { status } }),
    );

    expect(forms.map((form) => linearInitiativeFormSchema.parse(form))).toEqual(forms);
    expect(
      pathsOf({
        issues: issuesOf({ form: initiative({ fields: { status: "Paused" } }), schema: linearInitiativeFormSchema }),
      }),
    ).toEqual(["fields.status"]);
    expect(
      pathsOf({
        issues: issuesOf({ form: initiative({ fields: { status: "active" } }), schema: linearInitiativeFormSchema }),
      }),
    ).toEqual(["fields.status"]);
  });

  it("accepts a one-line name and refuses a newline or carriage return in it", () => {
    const message = "fields.name: an initiative name is a single line; a newline would be dropped silently";

    expect(linearInitiativeFormSchema.parse(initiative({ fields: { name: "One line" } }))).toEqual({
      fields: { name: "One line" },
    });
    expect(
      issuesOf({ form: initiative({ fields: { name: "one\ntwo" } }), schema: linearInitiativeFormSchema }),
    ).toEqual([message]);
    expect(
      issuesOf({ form: initiative({ fields: { name: "one\rtwo" } }), schema: linearInitiativeFormSchema }),
    ).toEqual([message]);
  });

  it("refuses an empty name and a form with no name at all", () => {
    expect(
      pathsOf({ issues: issuesOf({ form: initiative({ fields: { name: "" } }), schema: linearInitiativeFormSchema }) }),
    ).toEqual(["fields.name"]);
    expect(pathsOf({ issues: issuesOf({ form: { fields: {} }, schema: linearInitiativeFormSchema }) })).toEqual([
      "fields.name",
    ]);
  });

  it("accepts a one-line description and refuses a newline in it", () => {
    expect(linearInitiativeFormSchema.parse(initiative({ fields: { description: "Move the store." } }))).toEqual({
      fields: { description: "Move the store.", name: "Store on Postgres" },
    });
    expect(
      issuesOf({ form: initiative({ fields: { description: "one\ntwo" } }), schema: linearInitiativeFormSchema }),
    ).toEqual([
      "fields.description: an initiative description renders as ONE line; the newline would be dropped silently",
    ]);
  });

  it("accepts a YYYY-MM-DD target date and refuses every other width or separator", () => {
    const message = "fields.targetDate: a target date is YYYY-MM-DD (Linear's TimelessDate wire format)";

    expect(linearInitiativeFormSchema.parse(initiative({ fields: { targetDate: "2026-10-13" } }))).toEqual({
      fields: { name: "Store on Postgres", targetDate: "2026-10-13" },
    });
    expect(
      ["2026-1-13", "2026/10/13", "26-10-13", "2026-10-13T00:00:00Z", " 2026-10-13"].map((targetDate) =>
        issuesOf({ form: initiative({ fields: { targetDate } }), schema: linearInitiativeFormSchema }),
      ),
    ).toEqual([[message], [message], [message], [message], [message]]);
  });

  it("checks the target date's wire shape only, so an out-of-range month still parses", () => {
    expect(linearInitiativeFormSchema.parse(initiative({ fields: { targetDate: "2026-13-45" } }))).toEqual({
      fields: { name: "Store on Postgres", targetDate: "2026-13-45" },
    });
  });

  it("refuses an empty owner id and an empty lead team id", () => {
    expect(
      pathsOf({
        issues: issuesOf({
          form: initiative({ fields: { leadTeamId: "", ownerId: "" } }),
          schema: linearInitiativeFormSchema,
        }),
      }),
    ).toEqual(["fields.leadTeamId", "fields.ownerId"]);
  });

  it("refuses an undeclared key inside fields and at the root, naming the key", () => {
    const inFields = issuesOf({ form: initiative({ fields: { teamId: "t" } }), schema: linearInitiativeFormSchema });
    const atRoot = issuesOf({ form: { ...INITIATIVE, body: "x" }, schema: linearInitiativeFormSchema });

    expect(pathsOf({ issues: inFields })).toEqual(["fields"]);
    expect(inFields[0]!).toContain('unknown field "teamId" — REFUSED, not ignored.');
    expect(pathsOf({ issues: atRoot })).toEqual([""]);
    expect(atRoot[0]!).toContain('unknown field "body" — REFUSED, not ignored.');
  });
});

describe("linearInitiativeLinkFormSchema", () => {
  it("parses the two endpoints unchanged", () => {
    const form = { fields: { initiativeId: "init-1", projectId: "proj-1" } };

    expect(linearInitiativeLinkFormSchema.parse(form)).toEqual(form);
  });

  it("refuses a third key beside the two endpoints, naming it", () => {
    const issues = issuesOf({
      form: { fields: { initiativeId: "init-1", projectId: "proj-1", teamId: "t" } },
      schema: linearInitiativeLinkFormSchema,
    });

    expect(pathsOf({ issues })).toEqual(["fields"]);
    expect(issues[0]!).toContain('unknown field "teamId" — REFUSED, not ignored.');
  });

  it("refuses an empty endpoint and a missing one", () => {
    expect(
      pathsOf({
        issues: issuesOf({
          form: { fields: { initiativeId: "", projectId: "proj-1" } },
          schema: linearInitiativeLinkFormSchema,
        }),
      }),
    ).toEqual(["fields.initiativeId"]);
    expect(
      pathsOf({
        issues: issuesOf({ form: { fields: { initiativeId: "init-1" } }, schema: linearInitiativeLinkFormSchema }),
      }),
    ).toEqual(["fields.projectId"]);
  });
});

describe("linearInitiativeUpdateFormSchema — accepted forms", () => {
  it("accepts the minimal form under each of the three health values, parsing it unchanged", () => {
    const forms = ["atRisk", "offTrack", "onTrack"].map((health) => ({
      ...UPDATE,
      fields: { ...UPDATE.fields, health },
    }));

    expect(forms.map((form) => linearInitiativeUpdateFormSchema.parse(form))).toEqual(forms);
  });

  it("parses a form carrying detail and evidence unchanged", () => {
    const form = {
      artifact: {
        detail: [{ kind: "para", text: "The backfill finished a day late." }],
        evidence: [{ label: "the backfill run", url: "https://example.test/run/7" }],
        summary: "Cutover is at risk by one day.",
      },
      fields: { health: "atRisk", initiativeId: "init-1" },
    };

    expect(linearInitiativeUpdateFormSchema.parse(form)).toEqual(form);
  });

  it("draws the summary cap at fifty words: fifty parse, fifty-one are refused naming the cap", () => {
    const atCap = Array.from({ length: 50 }, () => "word").join(" ");

    expect(SECTION_MAX_WORDS).toBe(50);
    expect(linearInitiativeUpdateFormSchema.parse(withSummary({ summary: atCap }))).toEqual(
      withSummary({ summary: atCap }),
    );
    expect(
      issuesOf({ form: withSummary({ summary: `${atCap} word` }), schema: linearInitiativeUpdateFormSchema }),
    ).toEqual([
      "artifact.summary: an initiative update summary is the whole report above the fold, so it is capped at 50 words — move the rest into detail, which renders collapsed",
    ]);
  });
});

describe("linearInitiativeUpdateFormSchema — refused forms", () => {
  it("refuses a missing health and a health outside the closed three", () => {
    expect(
      pathsOf({
        issues: issuesOf({
          form: { ...UPDATE, fields: { initiativeId: "init-1" } },
          schema: linearInitiativeUpdateFormSchema,
        }),
      }),
    ).toEqual(["fields.health"]);
    expect(
      pathsOf({
        issues: issuesOf({
          form: { ...UPDATE, fields: { health: "fine", initiativeId: "init-1" } },
          schema: linearInitiativeUpdateFormSchema,
        }),
      }),
    ).toEqual(["fields.health"]);
  });

  it("refuses an empty initiative id", () => {
    expect(
      pathsOf({
        issues: issuesOf({
          form: { ...UPDATE, fields: { health: "onTrack", initiativeId: "" } },
          schema: linearInitiativeUpdateFormSchema,
        }),
      }),
    ).toEqual(["fields.initiativeId"]);
  });

  it("refuses an empty summary and a multi-line one", () => {
    expect(
      pathsOf({ issues: issuesOf({ form: withSummary({ summary: "" }), schema: linearInitiativeUpdateFormSchema }) }),
    ).toEqual(["artifact.summary"]);
    expect(issuesOf({ form: withSummary({ summary: "one\ntwo" }), schema: linearInitiativeUpdateFormSchema })).toEqual([
      "artifact.summary: an initiative update summary is ONE line — put the rest in detail, which folds",
    ]);
  });

  it("refuses a summary opening with Linear's +++ delimiter, and accepts +++ that does not open a delimiter line", () => {
    const message =
      'artifact.summary: a line beginning with "+++" is Linear\'s collapsible delimiter and would close the detail block early';

    expect(
      issuesOf({ form: withSummary({ summary: "+++ gotcha" }), schema: linearInitiativeUpdateFormSchema }),
    ).toEqual([message]);
    expect(issuesOf({ form: withSummary({ summary: "  +++" }), schema: linearInitiativeUpdateFormSchema })).toEqual([
      message,
    ]);
    expect(linearInitiativeUpdateFormSchema.parse(withSummary({ summary: "a +++ b" }))).toEqual(
      withSummary({ summary: "a +++ b" }),
    );
    expect(
      [0x0b, 0x0c, 0x85].map((code) =>
        issuesOf({
          form: withSummary({ summary: `gotcha${String.fromCodePoint(code)}+++` }),
          schema: linearInitiativeUpdateFormSchema,
        }),
      ),
    ).toEqual(
      [0x0b, 0x0c, 0x85].map(() => [
        "artifact.summary: an initiative update summary is ONE line — put the rest in detail, which folds",
        message,
      ]),
    );
  });

  it("refuses an empty detail array and an empty evidence array", () => {
    expect(
      pathsOf({
        issues: issuesOf({
          form: { ...UPDATE, artifact: { ...UPDATE.artifact, detail: [], evidence: [] } },
          schema: linearInitiativeUpdateFormSchema,
        }),
      }),
    ).toEqual(["artifact.detail", "artifact.evidence"]);
  });

  it("refuses a newline in an evidence label", () => {
    const form = {
      ...UPDATE,
      artifact: { ...UPDATE.artifact, evidence: [{ label: "one\ntwo", url: "https://example.test/a" }] },
    };

    expect(issuesOf({ form, schema: linearInitiativeUpdateFormSchema })).toEqual([
      "artifact.evidence.0.label: an evidence label renders as ONE list item; the newline would break it",
    ]);
  });

  it("refuses an undeclared key nested inside an evidence item, naming it", () => {
    const form = {
      ...UPDATE,
      artifact: {
        ...UPDATE.artifact,
        evidence: [{ label: "run", title: "the run", url: "https://example.test/a" }],
      },
    };
    const issues = issuesOf({ form, schema: linearInitiativeUpdateFormSchema });

    expect(pathsOf({ issues })).toEqual(["artifact.evidence.0"]);
    expect(issues[0]!).toContain('unknown field "title" — REFUSED, not ignored.');
  });
});

describe("linearInitiativeUpdateFormSchema — the folded detail owes the structural checks", () => {
  it("refuses a bare +++ line in a detail paragraph, which would close the update's own fold early", () => {
    const form = { ...UPDATE, artifact: { ...UPDATE.artifact, detail: [{ kind: "para", text: "before\n+++" }] } };
    const issues = issuesOf({ form, schema: linearInitiativeUpdateFormSchema });

    expect(pathsOf({ issues })).toEqual(["artifact.detail.0.text"]);
    expect(issues[0]!).toContain('a line beginning with "+++" is Linear\'s collapsible delimiter');
  });

  it("refuses a summary opening a code fence, which would swallow the detail fold below it", () => {
    const issues = issuesOf({ form: withSummary({ summary: "```" }), schema: linearInitiativeUpdateFormSchema });

    expect(pathsOf({ issues })).toEqual(["artifact.summary"]);
    expect(issues[0]!).toContain("a summary opening a code fence");
  });

  it("refuses an unterminated HTML comment in detail and raw HTML in the summary, never an evidence label's `<`", () => {
    const form = {
      ...UPDATE,
      artifact: {
        detail: [{ kind: "para", text: "<!--" }],
        evidence: [{ label: "the Array<string> run", url: "https://example.test/run/7" }],
        summary: "On track <i>so far</i>.",
      },
    };

    expect(pathsOf({ issues: issuesOf({ form, schema: linearInitiativeUpdateFormSchema }) })).toEqual([
      "artifact.summary",
      "artifact.detail.0.text",
    ]);
  });
});
