import { describe, expect, it } from "vitest";

import type { OneListArtifact } from "../../../../outbound/artifact/types.js";
import { visibleLengthOfRuns } from "../../../../outbound/artifact/visibleLength.js";
import {
  type VulnDigestMark,
  vulnDigestForm,
  vulnDigestFormWithin,
} from "../../../../outbound/slack/vulnDigestForm.js";

const COUNTS = { critical: 3, high: 89, low: 38, medium: 148 };
/** The row's own `--post-lead`, the counts it asked for. */
const BASE = { counts: COUNTS, lead: "fresh batch of vulnerability-fix PRs for your review:" };

/** One roster line asking a named person, or nobody when the row picks no reviewer strategy. */
function line({ number, subject, person }: { number: number; subject: string; person: string | undefined }) {
  return {
    number,
    person,
    subject,
    url: `https://github.com/owner/name/pull/${String(number)}`,
  };
}

describe("vulnDigestForm", () => {
  it("opens with the row's own lead, word for word", () => {
    const form = vulnDigestForm({
      input: { ...BASE, lead: "Open security fixes:", lines: [line({ number: 1, person: "U1", subject: "bump a" })] },
    });

    expect(form.lead).toEqual([{ text: "Open security fixes:", type: "text" }]);
  });

  it("opens a line on its link, naming nobody, when the row picks no reviewer strategy", () => {
    const form = vulnDigestForm({
      input: { ...BASE, lines: [line({ number: 4, person: undefined, subject: "bump a" })] },
    });

    expect(form.bullets[0]!.slice(0, 2)).toEqual([
      { label: "#4", type: "link", url: "https://github.com/owner/name/pull/4" },
      { text: " bump a", type: "text" },
    ]);
  });

  it("renders one dot point per pull request, in the roster's own order", () => {
    const form = vulnDigestForm({
      input: {
        ...BASE,
        lines: [
          line({ number: 11, person: "U1", subject: "bump a" }),
          line({ number: 22, person: "U2", subject: "bump b" }),
        ],
      },
    });

    expect(form.bullets.length).toBe(2);
    expect(form.bullets[0]![0]).toEqual({ person: "U1", type: "mention" });
    expect(form.bullets[1]![0]).toEqual({ person: "U2", type: "mention" });
  });

  it("links the #number rather than writing a bare one, which Slack would render as plain text", () => {
    const form = vulnDigestForm({
      input: { ...BASE, lines: [line({ number: 17005, person: "U1", subject: "bump a" })] },
    });

    expect(form.bullets[0]![2]).toEqual({
      label: "#17005",
      type: "link",
      url: "https://github.com/owner/name/pull/17005",
    });
  });

  it("tags no user group anywhere on the card, only the one person each line asks", () => {
    const form = vulnDigestForm({
      input: {
        ...BASE,
        lines: [
          line({ number: 1, person: "U1", subject: "bump a" }),
          line({ number: 2, person: "U2", subject: "bump b" }),
        ],
      },
    });

    const runs = [form.lead, ...form.bullets, ...form.trailing].flat();
    expect(runs.filter((run) => run.type === "group")).toEqual([]);
    expect(runs.filter((run) => run.type === "mention")).toEqual([
      { person: "U1", type: "mention" },
      { person: "U2", type: "mention" },
    ]);
  });

  it("closes with all four tiers and their total, and nothing before them", () => {
    const form = vulnDigestForm({
      input: { ...BASE, lines: [line({ number: 1, person: "U1", subject: "bump a" })] },
    });

    expect(form.trailing).toEqual([
      [{ text: "278 open dependabot alerts left: 3 critical, 89 high, 148 medium, 38 low", type: "text" }],
    ]);
  });

  it("ends a post whose row asked for no alert counts on its last line", () => {
    const form = vulnDigestForm({
      input: { ...BASE, counts: undefined, lines: [line({ number: 1, person: "U1", subject: "bump a" })] },
    });

    expect(form.trailing).toEqual([]);
  });

  it("states a tier that has reached zero rather than dropping it from the series", () => {
    const form = vulnDigestForm({
      input: {
        ...BASE,
        counts: { critical: 0, high: 0, low: 0, medium: 0 },
        lines: [line({ number: 1, person: "U1", subject: "bump a" })],
      },
    });

    expect(form.trailing[0]![0]).toEqual({
      text: "0 open dependabot alerts left: 0 critical, 0 high, 0 medium, 0 low",
      type: "text",
    });
  });

  it("carries the subject as the line's own trailing text", () => {
    const form = vulnDigestForm({
      input: {
        ...BASE,
        lines: [line({ number: 1, person: "U1", subject: "bump lodash-es to ^4.18.1" })],
      },
    });

    expect(form.bullets[0]![3]).toEqual({ text: " bump lodash-es to ^4.18.1", type: "text" });
  });
});

describe("vulnDigestForm CVSS trimming", () => {
  it("drops the trailing CVSS score, which the closing sentence aggregates and the link carries in full", () => {
    const form = vulnDigestForm({
      input: {
        ...BASE,
        lines: [line({ number: 1, person: "U1", subject: "bump axios 1.13.6 -> 1.19.0 (CVSS 8.7)" })],
      },
    });

    expect(form.bullets[0]![3]).toEqual({ text: " bump axios 1.13.6 -> 1.19.0", type: "text" });
  });

  it("drops a whole-number score too, which GitHub writes for an even CVSS", () => {
    const form = vulnDigestForm({
      input: {
        ...BASE,
        lines: [line({ number: 1, person: "U1", subject: "bump left-pad 1.0.0 -> 2.0.0 (CVSS 9)" })],
      },
    });

    expect(form.bullets[0]![3]).toEqual({ text: " bump left-pad 1.0.0 -> 2.0.0", type: "text" });
  });

  it("leaves a subject whose parenthetical is not a trailing score exactly as written", () => {
    const form = vulnDigestForm({
      input: {
        ...BASE,
        lines: [line({ number: 1, person: "U1", subject: "scope the (CVSS 8.1) resolutions the bump missed" })],
      },
    });

    expect(form.bullets[0]![3]).toEqual({ text: " scope the (CVSS 8.1) resolutions the bump missed", type: "text" });
  });

  it("leaves a subject carrying no score at all unchanged", () => {
    const form = vulnDigestForm({
      input: {
        ...BASE,
        lines: [line({ number: 1, person: "U1", subject: "re-resolve hono inside the declared range" })],
      },
    });

    expect(form.bullets[0]![3]).toEqual({ text: " re-resolve hono inside the declared range", type: "text" });
  });
});

const run = "https://github.com/owner/name/actions/runs/1";
const PASSED: VulnDigestMark = { kind: "passed", label: "e2e", url: run };
const FAILED: VulnDigestMark = { items: [{ label: "e2e failed", url: run }], kind: "unproven" };

describe("vulnDigestForm evidence marks", () => {
  it("closes a passed line with a bare `e2e` link to its run, the cheap ordinary case", () => {
    const form = vulnDigestForm({
      input: { ...BASE, lines: [{ ...line({ number: 1, person: "U1", subject: "bump a" }), mark: PASSED }] },
    });

    expect(form.bullets[0]!.slice(4)).toEqual([
      { text: " ", type: "text" },
      { label: "e2e", type: "link", url: run },
    ]);
  });

  it.each(["e2e", "CodeRabbit green"])("states a passed line with no run address as plain `%s`", (label) => {
    const mark: VulnDigestMark = { kind: "passed", label, url: undefined };
    const form = vulnDigestForm({
      input: { ...BASE, lines: [{ ...line({ number: 1, person: "U1", subject: "bump a" }), mark }] },
    });

    expect(form.bullets[0]!.slice(4)).toEqual([{ text: ` ${label}`, type: "text" }]);
  });

  it("brackets a failed run beside the line, the run still one click away", () => {
    const form = vulnDigestForm({
      input: { ...BASE, lines: [{ ...line({ number: 1, person: "U1", subject: "bump a" }), mark: FAILED }] },
    });

    expect(form.bullets[0]!.slice(4)).toEqual([
      { text: " (", type: "text" },
      { label: "e2e failed", type: "link", url: run },
      { text: ")", type: "text" },
    ]);
  });

  it.each(["e2e running", "no e2e", "e2e unproven", "no e2e label", "CodeRabbit pending"])(
    "brackets %s as plain text when no run stands behind it",
    (label) => {
      const form = vulnDigestForm({
        input: {
          ...BASE,
          lines: [
            {
              ...line({ number: 1, person: "U1", subject: "bump a" }),
              mark: { items: [{ label, url: undefined }], kind: "unproven" },
            },
          ],
        },
      });

      expect(form.bullets[0]!.slice(4)).toEqual([{ text: ` (${label})`, type: "text" }]);
    },
  );

  it("carries every unmet piece inside one pair of brackets, in order, a linked run still linked", () => {
    const form = vulnDigestForm({
      input: {
        ...BASE,
        lines: [
          {
            ...line({ number: 1, person: "U1", subject: "bump a" }),
            mark: {
              items: [
                { label: "no e2e label", url: undefined },
                { label: "e2e failed", url: run },
                { label: "CodeRabbit pending", url: undefined },
              ],
              kind: "unproven",
            },
          },
        ],
      },
    });

    expect(form.bullets[0]!.slice(4)).toEqual([
      { text: " (no e2e label; ", type: "text" },
      { label: "e2e failed", type: "link", url: run },
      { text: "; CodeRabbit pending)", type: "text" },
    ]);
  });
});

describe("vulnDigestFormWithin", () => {
  it("keeps every mark when the whole card fits its cap", () => {
    const within = vulnDigestFormWithin({
      cardVisibleMax: 1000,
      input: { ...BASE, lines: [{ ...line({ number: 1, person: "U1", subject: "bump a" }), mark: PASSED }] },
    });

    expect(within.trim).toBe(undefined);
    expect(within.form.bullets[0]!.length).toBe(6);
  });

  it("drops a passed mark and reports the width that forced it when the card would exceed its cap", () => {
    const within = vulnDigestFormWithin({
      cardVisibleMax: 141,
      input: { ...BASE, lines: [{ ...line({ number: 1, person: "U1", subject: "bump a" }), mark: PASSED }] },
    });

    expect(within.trim).toEqual({
      fullWidth: 142,
      marksCompacted: false,
      passedMarksDropped: true,
      requiredMarksWidth: 138,
      subjectMax: undefined,
    });
    expect(within.form.bullets[0]!.length).toBe(4);
  });

  it("drops only the passed marks from a mixed card, keeping the bracket on the failing line", () => {
    const input = {
      ...BASE,
      lines: [
        { ...line({ number: 1, person: "U1", subject: "bump a" }), mark: PASSED },
        { ...line({ number: 2, person: "U2", subject: "bump b" }), mark: FAILED },
      ],
    };
    const full = widthOf({ form: vulnDigestForm({ input }) });

    const within = vulnDigestFormWithin({ cardVisibleMax: full - 1, input });

    expect(within.trim).toEqual({
      fullWidth: full,
      marksCompacted: false,
      passedMarksDropped: true,
      requiredMarksWidth: full - 4,
      subjectMax: undefined,
    });
    expect(within.form.bullets[0]!.slice(4)).toEqual([]);
    expect(within.form.bullets[1]!.slice(4)).toEqual([
      { text: " (", type: "text" },
      { label: "e2e failed", type: "link", url: run },
      { text: ")", type: "text" },
    ]);
  });

  it("shortens only the long subjects, each at a word and as little as fits, keeping every bracket", () => {
    const subjects = Array.from(
      { length: 10 },
      (_, index) =>
        `re-resolve package-${String(index)} to 1.2.3 under its parent tree, past the advisory numbered ${String(index)} (CVSS 7.5)`,
    );
    const lines = [
      ...subjects.map((subject, index) => line({ number: index + 1, person: "U1", subject })),
      line({ number: 11, person: "U1", subject: "bump a" }),
    ];
    const input = {
      ...BASE,
      lines: lines.map((entry, index) => ({ ...entry, mark: index % 2 === 0 ? PASSED : FAILED })),
    };
    const required = {
      ...BASE,
      lines: lines.map((entry, index) => (index % 2 === 0 ? entry : { ...entry, mark: FAILED })),
    };

    const within = vulnDigestFormWithin({ cardVisibleMax: 1000, input });

    const subjectMax = within.trim?.subjectMax;
    expect(subjectMax).toBeTypeOf("number");
    expect(within.trim?.passedMarksDropped).toBe(true);
    expect(within.trim?.requiredMarksWidth).toBe(widthOf({ form: vulnDigestForm({ input: required }) }));
    expect(within.trim?.requiredMarksWidth).toBeGreaterThan(1000);
    expect(widthOf({ form: within.form })).toBeLessThanOrEqual(1000);
    expect(widthOf({ form: vulnDigestForm({ input: { ...required, subjectMax: subjectMax! + 1 } }) })).toBeGreaterThan(
      1000,
    );
    expect(within.form.bullets[10]!.slice(3)).toEqual([{ text: " bump a", type: "text" }]);
    within.form.bullets.slice(0, 10).forEach((bullet, index) => {
      const text = (bullet[3] as { text: string }).text.slice(1);
      expect(text.endsWith("…")).toBe(true);
      expect(text.length).toBeLessThanOrEqual(subjectMax!);
      expect(`${subjects[index]!} `.startsWith(`${text.slice(0, -1)} `)).toBe(true);
    });
    const brackets = within.form.bullets.filter((bullet) =>
      bullet.some((part) => part.type === "link" && part.label === "e2e failed"),
    );
    expect(brackets.length).toBe(5);
    expect(within.form.bullets.filter((bullet) => bullet.length > 4).length).toBe(5);
  });

  it("cuts a subject after a scoped package, never through it, and still code-styles it", () => {
    const form = vulnDigestForm({
      input: {
        ...BASE,
        lines: [
          line({
            number: 1,
            person: "U1",
            subject: "re-resolve @pulumi/pulumi to 3.264.0, clearing propagator-jaeger",
          }),
        ],
        subjectMax: 40,
      },
    });

    expect(form.bullets[0]!.slice(3)).toEqual([
      { text: " re-resolve ", type: "text" },
      { code: true, text: "@pulumi/pulumi", type: "text" },
      { text: " to 3.264.0…", type: "text" },
    ]);
  });

  it("never ends a cut on a joining word or the comma before it", () => {
    const form = vulnDigestForm({
      input: {
        ...BASE,
        lines: [
          line({
            number: 1,
            person: "U1",
            subject: "re-resolve ws to 7.5.13 and 8.21.x, past the tiny-fragment memory exhaustion",
          }),
        ],
        subjectMax: 45,
      },
    });

    expect(form.bullets[0]![3]).toEqual({ text: " re-resolve ws to 7.5.13 and 8.21.x…", type: "text" });
  });

  it("hands back the compacted card, subjects whole, when no length down to the floor fits even compacted", () => {
    const within = vulnDigestFormWithin({
      cardVisibleMax: 60,
      input: {
        ...BASE,
        lines: [
          {
            ...line({
              number: 1,
              person: "U1",
              subject: "move every uuid tree to 11.1.1, past the v3/v5/v6 buffer bounds bug",
            }),
            mark: SPELLED_OUT,
          },
        ],
      },
    });

    expect(within.trim?.subjectMax).toBe(undefined);
    expect(within.trim?.marksCompacted).toBe(true);
    expect(within.trim?.passedMarksDropped).toBe(false);
    expect(within.form.bullets[0]!.slice(3)).toEqual([
      { text: " move every uuid tree to 11.1.1, past the v3/v5/v6 buffer bounds bug", type: "text" },
      { text: " (", type: "text" },
      { label: "failing", type: "link", url: run },
      { text: ")", type: "text" },
    ]);
  });

  it("compacts every spelled-out bracket to (failing) when that alone brings the card under its cap", () => {
    const input = {
      ...BASE,
      lines: [
        { ...line({ number: 1, person: "U1", subject: "bump a" }), mark: SPELLED_OUT },
        { ...line({ number: 2, person: "U2", subject: "bump b" }), mark: SPELLED_OUT },
      ],
    };
    const compact = {
      ...BASE,
      lines: input.lines.map((entry) => ({ ...entry, mark: COMPACT })),
    };
    const compactWidth = widthOf({ form: vulnDigestForm({ input: compact }) });

    const within = vulnDigestFormWithin({ cardVisibleMax: compactWidth, input });

    expect(within.trim).toEqual({
      fullWidth: widthOf({ form: vulnDigestForm({ input }) }),
      marksCompacted: true,
      passedMarksDropped: false,
      requiredMarksWidth: widthOf({ form: vulnDigestForm({ input }) }),
      subjectMax: undefined,
    });
    expect(widthOf({ form: within.form })).toBe(compactWidth);
    expect(within.form.bullets.map((bullet) => bullet.slice(4))).toEqual([
      [
        { text: " (", type: "text" },
        { label: "failing", type: "link", url: run },
        { text: ")", type: "text" },
      ],
      [
        { text: " (", type: "text" },
        { label: "failing", type: "link", url: run },
        { text: ")", type: "text" },
      ],
    ]);
  });

  it("compacts the brackets and then shortens subjects when neither alone fits", () => {
    const subject = "re-resolve package-a to 1.2.3 under its parent tree, past the advisory numbered 9 (CVSS 7.5)";
    const input = {
      ...BASE,
      lines: [{ ...line({ number: 1, person: "U1", subject }), mark: SPELLED_OUT }],
    };
    const compactAtFloor = vulnDigestForm({
      input: { ...input, lines: [{ ...input.lines[0]!, mark: COMPACT }], subjectMax: 24 },
    });
    const cap = widthOf({ form: compactAtFloor });

    const within = vulnDigestFormWithin({ cardVisibleMax: cap, input });

    expect(within.trim?.marksCompacted).toBe(true);
    expect(within.trim?.subjectMax).toBeTypeOf("number");
    expect(widthOf({ form: within.form })).toBeLessThanOrEqual(cap);
    expect(within.form.bullets[0]!.slice(-3)).toEqual([
      { text: " (", type: "text" },
      { label: "failing", type: "link", url: run },
      { text: ")", type: "text" },
    ]);
  });
});

/** A bracket spelling out three unmet pieces, the widest shape a line carries. */
const SPELLED_OUT: VulnDigestMark = {
  items: [
    { label: "no e2e label", url: undefined },
    { label: "e2e failed", url: run },
    { label: "CodeRabbit pending", url: undefined },
  ],
  kind: "unproven",
};

/** What {@link SPELLED_OUT} collapses to, linked to the first unmet piece that carries a run. */
const COMPACT: VulnDigestMark = { items: [{ label: "failing", url: run }], kind: "unproven" };

/** A one-list card's visible width, measured the way the send's whole-card cap measures it. */
function widthOf({ form }: { form: OneListArtifact }): number {
  return [form.lead, ...form.bullets, ...form.trailing].reduce(
    (total, runs) => total + visibleLengthOfRuns({ citations: [], runs }),
    0,
  );
}
