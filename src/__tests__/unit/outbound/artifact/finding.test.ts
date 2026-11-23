/**
 * Every Datadog host in this file reads a synthetic site rather than the install's own.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  FINDING_ESCALATE_MAX,
  FINDING_LINE_FIELD_MAX,
  FINDING_OPTIONS_MAX,
  FINDING_SIZING_LABELS,
  type FindingForm,
  findingFormSchema,
  findingToUpdate,
} from "../../../../outbound/artifact/finding.js";
import { updateArtifactSchema } from "../../../../outbound/artifact/schema.js";

const GRAPH = "https://ap1.datadoghq.com/apm/traces?query=env%3Aproduction";

const MEASURED: FindingForm = {
  blastRadius: { basis: "unique usr.id on the customer-ui parent spans", users: 2, window: "14 days" },
  citationUrl: GRAPH,
  env: "production",
  impact: { grade: "high", what: "Customers see no slots and cannot check out at that site." },
  introduced: "first failing call 24 Sep",
  kind: "finding",
  options: ["Ask the site to reissue its third-party provider key.", "Hide the site until it answers."],
  priorThread: { none: "no #defects thread on the site since 20 Sep" },
  title: "One site's checkout calls all fail",
  tracking: { none: "searched Linear for the site name, nothing open" },
};

const UNMEASURED: FindingForm = {
  ...MEASURED,
  blastRadius: { proxy: "120 failed calls", unmeasuredBecause: "these spans carry no user id" },
};

/** A payments finding that derives P1 (high impact on 10 to 99 users) and carries a daily cost. */
const COSTED_P1: FindingForm = {
  ...MEASURED,
  blastRadius: { basis: "unique usr.id on the checkout parent spans", users: 42, window: "7 days" },
  cost: { basis: "failed charges times the average invoice over 7 days", dollarsPerDay: 12_500 },
  escalate: ["jonah", "smith"],
  impact: { grade: "high", what: "Customers cannot pay for their assessment." },
  title: "Card payments fail at checkout",
};

/** Every violation message one raw form earns, in Zod's order. */
function refusalsOf({ raw }: { raw: unknown }): readonly string[] {
  const parsed = findingFormSchema.safeParse(raw);
  expect(parsed.success).toBe(false);
  return parsed.error!.issues.map((issue) => issue.message);
}

describe("findingFormSchema", () => {
  it("accepts a measured high-impact finding on few users", () => {
    expect(findingFormSchema.safeParse(MEASURED).success).toBe(true);
  });

  it("accepts an unmeasured one, ranked as few", () => {
    expect(findingFormSchema.safeParse(UNMEASURED).success).toBe(true);
  });

  it("refuses a finding the team already tracks, naming the ticket", () => {
    const raw = { ...MEASURED, tracking: { ticket: { id: "AAAA-3262", url: "https://linear.app/x/AAAA-3262" } } };
    expect(refusalsOf({ raw }).some((message) => message.includes("already tracks this in AAAA-3262"))).toBe(true);
  });

  it("refuses a finding that derives below P2, naming the cell", () => {
    const raw = { ...MEASURED, impact: { grade: "low", what: "An error popup shows once." } };
    expect(refusalsOf({ raw })).toEqual([
      "impact: low impact on a few blast radius in production derives P4, and only P0, P1 or P2 is worth a post. " +
        "Leave it out and name it among what was checked.",
    ]);
  });

  it("refuses high impact on one user, the cell not worth raising", () => {
    const raw = { ...MEASURED, blastRadius: { ...MEASURED.blastRadius, users: 1 } };
    expect(refusalsOf({ raw })[0]).toContain("derives P3");
  });

  it("admits a staging finding only at the ceiling", () => {
    expect(findingFormSchema.safeParse({ ...MEASURED, env: "staging" }).success).toBe(true);
    expect(
      findingToUpdate({ form: { ...MEASURED, env: "staging", blastRadius: { ...MEASURED.blastRadius, users: 400 } } })
        .priority,
    ).toBe("P2");
  });

  it.each([
    "blastRadius",
    "citationUrl",
    "env",
    "impact",
    "introduced",
    "kind",
    "options",
    "priorThread",
    "title",
    "tracking",
  ])("refuses a form missing %s", (key) => {
    const raw: Record<string, unknown> = { ...MEASURED };
    delete raw[key];
    expect(findingFormSchema.safeParse(raw).success).toBe(false);
  });

  it.each(["basis", "users", "window"])("refuses a measured blast radius missing %s", (key) => {
    const blastRadius: Record<string, unknown> = { ...MEASURED.blastRadius };
    delete blastRadius[key];
    expect(findingFormSchema.safeParse({ ...MEASURED, blastRadius }).success).toBe(false);
  });

  it.each([0, -3, 2.5, 1_000_000_001])("refuses %d unique users", (users) => {
    const raw = { ...MEASURED, blastRadius: { ...MEASURED.blastRadius, users } };
    expect(findingFormSchema.safeParse(raw).success).toBe(false);
  });

  it("refuses no options and more than the cap", () => {
    expect(findingFormSchema.safeParse({ ...MEASURED, options: [] }).success).toBe(false);
    const tooMany = Array.from({ length: FINDING_OPTIONS_MAX + 1 }, (_, i) => `Option ${String(i)}.`);
    expect(findingFormSchema.safeParse({ ...MEASURED, options: tooMany }).success).toBe(false);
  });

  it.each([
    "https://example.com/logs",
    "https://ap1.datadoghq.com/monitors/manage",
    "not a url",
    "https://linear.app/acme/issue/GROW-1888",
    "https://github.com/acme/acme-admin/issues/12",
  ])("refuses a citationUrl that is not a system-of-record view: %s", (citationUrl) => {
    expect(findingFormSchema.safeParse({ ...MEASURED, citationUrl }).success).toBe(false);
  });

  it("accepts a citation on a listed console beyond Datadog", () => {
    const citationUrl = "https://go.xero.com/Bank/BankTransactions.aspx";
    expect(findingFormSchema.safeParse({ ...MEASURED, citationUrl }).success).toBe(true);
  });

  it("names the evidence bar when the citation is a tracker", () => {
    const refusals = refusalsOf({ raw: { ...MEASURED, citationUrl: "https://linear.app/acme/issue/GROW-1888" } });
    expect(refusals).toEqual([expect.stringContaining("a tracker link alone is not evidence")]);
  });

  it("refuses an authored priority, and an unknown key at every level", () => {
    expect(findingFormSchema.safeParse({ ...MEASURED, priority: "P0" }).success).toBe(false);
    expect(findingFormSchema.safeParse({ ...MEASURED, impact: { ...MEASURED.impact, why: "x" } }).success).toBe(false);
    const blastRadius = { ...MEASURED.blastRadius, sessions: 40 };
    expect(findingFormSchema.safeParse({ ...MEASURED, blastRadius }).success).toBe(false);
    expect(findingFormSchema.safeParse({ ...MEASURED, tracking: { none: "x", also: "y" } }).success).toBe(false);
    expect(findingFormSchema.safeParse({ ...MEASURED, priorThread: { none: "x", thread: "y" } }).success).toBe(false);
  });

  it("refuses a title carrying the headline separator, through the real headline rule", () => {
    const parsed = findingFormSchema.safeParse({ ...MEASURED, title: "Booking · fails" });
    expect(parsed.success).toBe(false);
    expect(z.prettifyError(parsed.error!)).toContain("title:");
  });

  it("accepts every above-fold field at its cap and still derives a sendable card", () => {
    const long = "x".repeat(FINDING_LINE_FIELD_MAX);
    const form: FindingForm = { ...MEASURED, introduced: long, priorThread: { none: long }, tracking: { none: long } };
    expect(findingFormSchema.safeParse(form).success).toBe(true);
    expect(updateArtifactSchema.safeParse(findingToUpdate({ form }).artifact).success).toBe(true);
  });

  it("accepts a P1 with a dollar figure that tags its people", () => {
    expect(findingFormSchema.safeParse(COSTED_P1).success).toBe(true);
  });

  it("accepts a dollar figure on a P2, which tags nobody", () => {
    const form: FindingForm = { ...MEASURED, cost: COSTED_P1.cost! };
    expect(findingFormSchema.safeParse(form).success).toBe(true);
  });

  it("refuses a P1 with a dollar figure that tags nobody", () => {
    const raw: Record<string, unknown> = { ...COSTED_P1 };
    delete raw["escalate"];
    expect(refusalsOf({ raw })).toEqual([
      "escalate: a P1 carrying a dollar figure tags the people the hunt names for one. Add " + "`escalate`.",
    ]);
  });

  it("refuses a tag with no dollar figure", () => {
    const raw: Record<string, unknown> = { ...COSTED_P1 };
    delete raw["cost"];
    expect(refusalsOf({ raw })).toEqual([
      "escalate: only a finding carrying a `cost` tags anyone, because a dollar figure is what earns the tag. " +
        "Add the daily cost with its basis, or drop `escalate`.",
    ]);
  });

  it("refuses a tag on a P2, even with a dollar figure", () => {
    const raw = { ...COSTED_P1, blastRadius: { ...COSTED_P1.blastRadius, users: 3 } };
    expect(refusalsOf({ raw })).toEqual([
      "escalate: this finding derives P2, and only a P0 or P1 with a dollar figure tags anyone. " + "Drop `escalate`.",
    ]);
  });

  it.each([0, -5, 2.5, 1_000_000_001])("refuses a cost of %d dollars a day", (dollarsPerDay) => {
    const raw = { ...COSTED_P1, cost: { ...COSTED_P1.cost!, dollarsPerDay } };
    expect(findingFormSchema.safeParse(raw).success).toBe(false);
  });

  it("refuses a cost with no basis, an unknown cost key, no people and more than the cap", () => {
    expect(findingFormSchema.safeParse({ ...COSTED_P1, cost: { dollarsPerDay: 10 } }).success).toBe(false);
    const extra = { ...COSTED_P1.cost!, currency: "AUD" };
    expect(findingFormSchema.safeParse({ ...COSTED_P1, cost: extra }).success).toBe(false);
    expect(findingFormSchema.safeParse({ ...COSTED_P1, escalate: [] }).success).toBe(false);
    expect(refusalsOf({ raw: { ...COSTED_P1, escalate: ["jonah", "jonah"] } })).toEqual([
      "escalate names a person twice",
    ]);
    const crowd = Array.from({ length: FINDING_ESCALATE_MAX + 1 }, (_, i) => `person${String(i)}`);
    expect(findingFormSchema.safeParse({ ...COSTED_P1, escalate: crowd }).success).toBe(false);
  });

  it("accepts a costed, escalated card with every above-fold field at its cap", () => {
    const long = "x".repeat(FINDING_LINE_FIELD_MAX);
    const crowd = Array.from({ length: FINDING_ESCALATE_MAX }, (_, i) => `person${String(i)}`);
    const form: FindingForm = {
      ...COSTED_P1,
      cost: { ...COSTED_P1.cost!, dollarsPerDay: 999_999_999 },
      escalate: crowd,
      introduced: long,
      priorThread: { none: long },
      tracking: { none: long },
    };
    expect(findingFormSchema.safeParse(form).success).toBe(true);
    expect(updateArtifactSchema.safeParse(findingToUpdate({ form }).artifact).success).toBe(true);
  });
});

describe("findingToUpdate", () => {
  it("derives the whole measured card", () => {
    const derived = findingToUpdate({ form: MEASURED });
    expect(derived.priority).toBe("P2");
    expect(derived.userBand).toBe("few");
    expect(derived.artifact).toEqual({
      citations: [{ id: "finding", label: "[1]", url: GRAPH }],
      detail: [
        {
          runs: [{ text: "Counted as unique usr.id on the customer-ui parent spans.", type: "text" }],
          type: "paragraph",
        },
        {
          runs: [
            { bold: true, text: "Introduced ", type: "text" },
            { text: "first failing call 24 Sep", type: "text" },
          ],
          type: "paragraph",
        },
        { runs: [{ bold: true, text: "Options", type: "text" }], type: "paragraph" },
        {
          items: [
            [{ text: "Ask the site to reissue its third-party provider key.", type: "text" }],
            [{ text: "Hide the site until it answers.", type: "text" }],
          ],
          type: "bullets",
        },
      ],
      index: [
        [
          { bold: true, text: "Blast radius ", type: "text" },
          { text: "2 unique users in 14 days ", type: "text" },
          { citationId: "finding", type: "citation" },
        ],
        [
          { bold: true, text: "Impact ", type: "text" },
          { text: "high. Customers see no slots and cannot check out at that site.", type: "text" },
        ],
        [
          { bold: true, text: "Priority ", type: "text" },
          { text: "P2, high impact on 2 to 9 users", type: "text" },
        ],
        [
          { bold: true, text: "Not tracked yet ", type: "text" },
          { text: "searched Linear for the site name, nothing open", type: "text" },
        ],
        [
          { bold: true, text: "Not raised before ", type: "text" },
          { text: "no #defects thread on the site since 20 Sep", type: "text" },
        ],
      ],
      indexStyle: "plain",
      kind: "update",
      media: [],
      primaryLink: { label: "the Datadog view", url: GRAPH },
      tldr: "P2 · production · One site's checkout calls all fail",
    });
  });

  it("names a non-Datadog source on the card's link", () => {
    const citationUrl = "https://app.vanta.com/tests";
    const { artifact } = findingToUpdate({ form: { ...MEASURED, citationUrl } });
    expect(artifact.primaryLink).toEqual({ label: "the Vanta view", url: citationUrl });
  });

  it("derives the unmeasured blast radius line and its reason", () => {
    const { artifact, userBand } = findingToUpdate({ form: UNMEASURED });
    expect(userBand).toBe("unknown");
    expect(artifact.index[0]).toEqual([
      { bold: true, text: "Blast radius ", type: "text" },
      { text: "not counted. Nearest number is 120 failed calls ", type: "text" },
      { citationId: "finding", type: "citation" },
    ]);
    expect(artifact.detail[0]).toEqual({
      runs: [{ text: "No unique-user count, because these spans carry no user id.", type: "text" }],
      type: "paragraph",
    });
  });

  it("says one user in the singular", () => {
    const form = { ...MEASURED, blastRadius: { ...MEASURED.blastRadius, users: 1 } };
    expect(findingToUpdate({ form }).artifact.index[0]![1]).toEqual({
      text: "1 unique user in 14 days ",
      type: "text",
    });
  });

  it("opens every card with the blast radius, impact and priority lines, in that order", () => {
    const forms: readonly FindingForm[] = [MEASURED, UNMEASURED, { ...MEASURED, env: "staging" }];
    const labels = forms.map((form) =>
      findingToUpdate({ form })
        .artifact.index.slice(0, FINDING_SIZING_LABELS.length)
        .map((line) => line[0]),
    );
    const expected = FINDING_SIZING_LABELS.map((label) => ({ bold: true, text: `${label} `, type: "text" }));
    expect(labels).toEqual([expected, expected, expected]);
  });

  it("puts the daily cost on the impact line, its basis below the fold, and the tags on the priority line", () => {
    const { artifact, priority } = findingToUpdate({ form: COSTED_P1 });
    expect(priority).toBe("P1");
    expect(artifact.index[1]).toEqual([
      { bold: true, text: "Impact ", type: "text" },
      { text: "high, costing about $12,500 a day. Customers cannot pay for their assessment.", type: "text" },
    ]);
    expect(artifact.index[2]).toEqual([
      { bold: true, text: "Priority ", type: "text" },
      { text: "P1, high impact on 10 to 99 users, for ", type: "text" },
      { person: "jonah", type: "mention" },
      { text: " and ", type: "text" },
      { person: "smith", type: "mention" },
    ]);
    expect(artifact.detail[1]).toEqual({
      runs: [{ text: "Cost counted as failed charges times the average invoice over 7 days.", type: "text" }],
      type: "paragraph",
    });
    expect(artifact.tldr).toBe("P1 · production · Card payments fail at checkout");
  });

  it("joins three tagged people with a comma, then and", () => {
    const form: FindingForm = { ...COSTED_P1, escalate: ["jonah", "smith", "ada"] };
    expect(findingToUpdate({ form }).artifact.index[2]!.slice(2)).toEqual([
      { person: "jonah", type: "mention" },
      { text: ", ", type: "text" },
      { person: "smith", type: "mention" },
      { text: " and ", type: "text" },
      { person: "ada", type: "mention" },
    ]);
  });

  it("gives the priority's reason for an unmeasured and a staging-capped finding", () => {
    const staging: FindingForm = { ...MEASURED, env: "staging", blastRadius: { ...MEASURED.blastRadius, users: 400 } };
    expect(findingToUpdate({ form: UNMEASURED }).artifact.index[2]![1]).toEqual({
      text: "P2, high impact on an uncounted blast radius, ranked as 2 to 9 users",
      type: "text",
    });
    expect(findingToUpdate({ form: staging }).artifact.index[2]![1]).toEqual({
      text: "P2, high impact on 100 or more users, capped from P0 in staging",
      type: "text",
    });
  });
});
