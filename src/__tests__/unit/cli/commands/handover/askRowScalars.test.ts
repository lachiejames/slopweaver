/**
 * A row's front-matter carries exactly the keys the writer meant to write, whatever the values contain.
 *
 * The class these hold down is front-matter INJECTION, found by the r1 review of the `--dispatch` change
 * with two counterexamples that both ran against the shipped CLI: a `--branch` holding
 * `feature/one\nproblem: …\nlean: …\noptions:\n  - option: …` authored a complete, well-formed ask shape as
 * REAL KEYS, and so did a session id carrying the same text, reached through `observedBy`'s environment
 * fallback rather than through any flag.
 *
 * The second one is why these assertions are at the WRITER rather than at the flag parser: no argv check can
 * see a value the verb resolves for itself. The witness is falsifiable in both directions — the injected
 * text is fed in whole, and the round trip asserts both that the shape fields are absent and that the value
 * itself survived as one scalar.
 */
import { describe, expect, it } from "vitest";

import { askRowText } from "../../../../../cli/commands/handover/askRowText.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";

/** The r1 counterexample's payload — a whole ask shape, well-formed, as front-matter would spell it. */
const INJECTED_SHAPE =
  '\nproblem: "which base should we use"\nlean: "main"\noptions:\n  - option: "a"\n    tradeoff: "b"';

const row = ({
  branch,
  observedBy,
}: {
  branch: string | undefined;
  observedBy: string | undefined;
}): ReturnType<typeof askRowText> =>
  askRowText({
    anchor: undefined,
    ask: "check the widget",
    askedIso: "2026-09-19T12:00:00.000Z",
    checkedIso: "2026-08-30T23:10:00Z",
    branch,
    dispatch: false,
    finding: observedBy === undefined ? undefined : { evidence: ["acme/widgets#1"], observedBy },
    priority: undefined,
    repo: undefined,
    shape: undefined,
    slug: "injected-row",
  });

const parsed = ({ text }: { text: string }): ReturnType<typeof parseHandoverDoc> =>
  parseHandoverDoc({ path: "/state/handovers/injected-row.md", text });

describe("a front-matter scalar cannot author a second key", () => {
  it("quotes an injecting --branch, so the shape fields it spells are not read as a decision of the owner's", () => {
    const doc = parsed({ text: row({ branch: `feature/one${INJECTED_SHAPE}`, observedBy: undefined }) });
    expect(doc.problem).toBeUndefined();
    expect(doc.lean).toBeUndefined();
    expect(doc.options).toEqual([]);
  });

  // The value is asserted present as well as harmless: `not.toContain` over an input that never carried the
  // text would pass against a writer that had silently dropped the whole field.
  it("keeps that branch as ONE scalar, so the assertion above is about quoting and not about a dropped field", () => {
    const text = row({ branch: `feature/one${INJECTED_SHAPE}`, observedBy: undefined });
    expect(text).toContain('branch: "feature/one\\nproblem: \\"which base should we use\\"');
    expect(text.split("\n").filter((line) => line.startsWith("branch:"))).toHaveLength(1);
  });

  // The counterexample no flag check can reach: `--observed-by` is optional and falls back to the session id
  // in the environment, so this value never passes through `multilineRawFields`.
  it("quotes an injecting observedBy, which reaches the writer from the environment and not from a flag", () => {
    const doc = parsed({ text: row({ branch: undefined, observedBy: `session-test${INJECTED_SHAPE}` }) });
    expect(doc.origin).toBe("finding");
    expect(doc.problem).toBeUndefined();
    expect(doc.lean).toBeUndefined();
    expect(doc.options).toEqual([]);
  });

  it("keeps that observedBy as ONE scalar too", () => {
    const text = row({ branch: undefined, observedBy: `session-test${INJECTED_SHAPE}` });
    expect(text).toContain('observedBy: "session-test\\nproblem:');
    expect(text.split("\n").filter((line) => line.startsWith("observedBy:"))).toHaveLength(1);
  });

  it("quotes an injecting evidence item, whose own separator is a comma and not a newline", () => {
    const text = askRowText({
      anchor: undefined,
      ask: "check the widget",
      askedIso: "2026-09-19T12:00:00.000Z",
      checkedIso: "2026-08-30T23:10:00Z",
      branch: undefined,
      dispatch: false,
      finding: { evidence: [`acme/widgets#1${INJECTED_SHAPE}`], observedBy: "session-test" },
      priority: undefined,
      repo: undefined,
      shape: undefined,
      slug: "injected-row",
    });
    expect(text.split("\n").filter((line) => line.startsWith("evidence:"))).toHaveLength(1);
    expect(parsed({ text }).problem).toBeUndefined();
  });

  // The other half of the claim in `encodeFlatScalar`'s own comment: no row on the real board is rewritten by
  // this, because no ordinary value trips the test. A regression here would change 2,700 files' bytes.
  it("leaves every ordinary value exactly as it was written, unquoted", () => {
    const text = askRowText({
      anchor: "https://acme.slack.com/archives/C1/p1788220579306599",
      ask: "check the widget",
      askedIso: "2026-09-19T12:00:00.000Z",
      checkedIso: "2026-08-30T23:10:00Z",
      branch: "feature/one",
      dispatch: false,
      finding: { evidence: ["acme/widgets#1", "acme/widgets#2"], observedBy: "a0000036-0000-4000-8000-000000000039" },
      priority: "p2",
      repo: "/checkouts/widgets",
      shape: undefined,
      slug: "injected-row",
    });
    expect(text).toContain("slug: injected-row\n");
    expect(text).toContain("askedIso: 2026-09-19T12:00:00.000Z\n");
    expect(text).toContain("anchor: https://acme.slack.com/archives/C1/p1788220579306599\n");
    expect(text).toContain("priority: p2\n");
    expect(text).toContain("repo: /checkouts/widgets\n");
    expect(text).toContain("branch: feature/one\n");
    expect(text).toContain("observedBy: a0000036-0000-4000-8000-000000000039\n");
    expect(text).toContain("evidence: [acme/widgets#1, acme/widgets#2]\n");
  });
});
