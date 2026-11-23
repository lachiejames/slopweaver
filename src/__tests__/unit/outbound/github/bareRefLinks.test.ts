/** Bare references across every authored cell of a C3 form: linked where resolvable, reported by field where not. */
import { describe, expect, it } from "vitest";

import {
  attestedNumbersOfPrForm,
  bareRefIssuesOfPrForm,
  linkifyContent,
  linkifyPrForm,
} from "../../../../outbound/github/bareRefLinks.js";
import type { Content, PrForm } from "../../../../outbound/github/types.js";
import type { BareRefContext } from "../../../../outbound/linkify/bareRefs.js";
import { FEATURE_BODY, FIX_BODY, formOf, shot, t } from "./fixtures.js";

const CONTEXT: BareRefContext = { repos: [{ owner: "acme", repo: "widget" }] };

/** The fix form, pointed at acme/widget, with its explainer and checks replaced. */
function formWith({ explainer, checks = [] }: { explainer: Content; checks?: readonly Content[] }): PrForm {
  const base = formOf({ body: FIX_BODY });
  return { ...base, checks, explainer, target: { ...base.target, owner: "acme", repo: "widget" } };
}

/** `#n` as the link run linkifying it into acme/widget produces. */
function widgetLink({ n }: { n: number }): Content[number] {
  return { kind: "link", text: `#${String(n)}`, url: `https://github.com/acme/widget/issues/${String(n)}` };
}

describe("linkifyContent", () => {
  it("is byte-identical when no run carries a bare reference", () => {
    const content: Content = [{ kind: "text", text: "nothing here" }];
    expect(linkifyContent({ content, context: CONTEXT })).toEqual(content);
  });

  it("splices a resolvable bare reference into a link run", () => {
    const content: Content = [{ kind: "text", text: "fixes #42 today" }];
    expect(linkifyContent({ content, context: CONTEXT })).toEqual([
      { kind: "text", text: "fixes " },
      widgetLink({ n: 42 }),
      { kind: "text", text: " today" },
    ]);
  });

  it("never touches a code run", () => {
    const content: Content = [{ kind: "code", text: "#42" }];
    expect(linkifyContent({ content, context: CONTEXT })).toEqual(content);
  });

  it("converts inside a strong run and keeps the kind", () => {
    const content: Content = [{ kind: "strong", text: "see #42" }];
    expect(linkifyContent({ content, context: CONTEXT })).toEqual([
      { kind: "strong", text: "see " },
      widgetLink({ n: 42 }),
    ]);
  });
});

describe("linkifyPrForm / bareRefIssuesOfPrForm", () => {
  it("linkifies the explainer and a check independently", () => {
    const form = formWith({ checks: [t({ text: "fixed by #11" })], explainer: t({ text: "caused by #10" }) });
    const linkified = linkifyPrForm({ context: CONTEXT, form });
    expect([linkified.explainer, linkified.checks[0]]).toEqual([
      [{ kind: "text", text: "caused by " }, widgetLink({ n: 10 })],
      [{ kind: "text", text: "fixed by " }, widgetLink({ n: 11 })],
    ]);
    expect(bareRefIssuesOfPrForm({ context: CONTEXT, form: linkified })).toStrictEqual([]);
  });

  it("reaches every authored cell — both proof slots, Not checked and the fold — not only the explainer", () => {
    const image = shot({ alt: "a shot", id: "a" });
    const form: PrForm = {
      ...formWith({ explainer: t({ text: "none" }) }),
      notChecked: [{ check: t({ text: "closes #5" }), why: t({ text: "until #6" }) }],
      problemProof: { kind: "reason", reason: t({ text: "see #4" }) },
      rerun: [
        { content: t({ text: "#7" }), kind: "note" },
        { items: [t({ text: "#8" })], kind: "tests" },
      ],
      solutionProof: { image, kind: "screenshot", proves: t({ text: "see #3" }), runBy: "agent" },
    };
    const linkified = linkifyPrForm({ context: CONTEXT, form });
    expect([linkified.problemProof, linkified.solutionProof, linkified.notChecked, linkified.rerun]).toEqual([
      { kind: "reason", reason: [{ kind: "text", text: "see " }, widgetLink({ n: 4 })] },
      { image, kind: "screenshot", proves: [{ kind: "text", text: "see " }, widgetLink({ n: 3 })], runBy: "agent" },
      [
        {
          check: [{ kind: "text", text: "closes " }, widgetLink({ n: 5 })],
          why: [{ kind: "text", text: "until " }, widgetLink({ n: 6 })],
        },
      ],
      [
        { content: [widgetLink({ n: 7 })], kind: "note" },
        { items: [[widgetLink({ n: 8 })]], kind: "tests" },
      ],
    ]);
  });

  it("leaves a badge hover's plain sentence alone, since a hover cannot carry a link", () => {
    const form: PrForm = {
      ...formWith({ explainer: t({ text: "none" }) }),
      risk: { items: [{ ...FIX_BODY.risk.items[0]!, worst: "#2 regresses" }] },
    };
    expect(linkifyPrForm({ context: CONTEXT, form }).risk).toStrictEqual(form.risk);
  });

  it("reports surviving residue by field, a hover's included, when the context cannot resolve it", () => {
    const form: PrForm = {
      ...formWith({ explainer: t({ text: "closed: 100, 200" }) }),
      risk: { items: [{ ...FIX_BODY.risk.items[0]!, worst: "closed: 300 regresses" }] },
    };
    const ambiguous: BareRefContext = { repos: [] };
    const linkified = linkifyPrForm({ context: ambiguous, form });
    const issues = bareRefIssuesOfPrForm({ context: ambiguous, form: linkified });
    expect(issues.map((issue) => issue.path)).toStrictEqual([
      ["risk", "items", 0, "worst"],
      ["explainer"],
      ["explainer"],
    ]);
  });

  it("addresses residue in a screenshot's proves line to its slot", () => {
    const form: PrForm = {
      ...formWith({ explainer: t({ text: "ok" }) }),
      solutionProof: {
        image: shot({ alt: "a shot", id: "a" }),
        kind: "screenshot",
        proves: t({ text: "closed: 100" }),
        runBy: "agent",
      },
    };
    const issues = bareRefIssuesOfPrForm({ context: { repos: [] }, form });
    expect(issues.map((issue) => issue.path)).toStrictEqual([["solutionProof", "proves"]]);
  });

  it("addresses residue in the fold to the note or test line it sits in", () => {
    const form: PrForm = {
      ...formWith({ explainer: t({ text: "ok" }) }),
      rerun: [
        { content: t({ text: "closed: 100" }), kind: "note" },
        { items: [t({ text: "ok" }), t({ text: "closed: 200" })], kind: "tests" },
      ],
    };
    const issues = bareRefIssuesOfPrForm({ context: { repos: [] }, form });
    expect(issues.map((issue) => issue.path)).toStrictEqual([
      ["rerun", 0, "content"],
      ["rerun", 1, "items", 1],
    ]);
  });

  it("leaves a form carrying no bare reference exactly as it was", () => {
    const form = formOf({ body: FEATURE_BODY });
    expect(linkifyPrForm({ context: CONTEXT, form })).toStrictEqual(form);
  });
});

describe("attestedNumbersOfPrForm", () => {
  it("reads every numbered github URL the form already carries, structurally, in reading order", () => {
    const form: PrForm = {
      ...formWith({
        checks: [[{ kind: "link", text: "the run", url: "https://github.com/acme/gadget/pull/16355" }]],
        explainer: [{ kind: "link", text: "#270", url: "https://github.com/acme/widget/pull/270" }],
      }),
      problemProof: {
        kind: "reason",
        reason: [{ kind: "link", text: "the ask", url: "https://github.com/acme/widget/issues/3" }],
      },
      rerun: [
        { content: [{ kind: "link", text: "x", url: "https://github.com/acme/gadget/issues/16415" }], kind: "note" },
      ],
      solutionProof: {
        image: { alt: "a shot", kind: "image", url: "https://github.com/acme/widget/pull/9" },
        kind: "screenshot",
        proves: t({ text: "it shows" }),
        runBy: "agent",
      },
    };
    expect(attestedNumbersOfPrForm({ form })).toEqual([
      { number: 270, owner: "acme", repo: "widget" },
      { number: 3, owner: "acme", repo: "widget" },
      { number: 16355, owner: "acme", repo: "gadget" },
      { number: 16415, owner: "acme", repo: "gadget" },
      { number: 9, owner: "acme", repo: "widget" },
    ]);
  });

  it("attests nothing from a form whose only github URL names a commit", () => {
    const form: PrForm = {
      ...formWith({
        explainer: [{ kind: "link", text: "the commit", url: "https://github.com/acme/widget/commit/15d422aa" }],
      }),
      problemProof: { kind: "reason", reason: t({ text: "none" }) },
      solutionProof: { kind: "reason", reason: t({ text: "none" }) },
      visualProof: "nothing-on-screen",
    };
    expect(attestedNumbersOfPrForm({ form })).toEqual([]);
  });
});

describe("linkifyPrForm — the cross-repo regression", () => {
  const WITH_OWN_NUMBER: BareRefContext = {
    attested: [{ number: 270, owner: "acme", repo: "widget" }],
    repos: [{ owner: "acme", repo: "widget" }],
  };

  it("no longer links another repo's five-digit numbers into this one", () => {
    const form = formWith({ explainer: t({ text: "the ruling covered #16339, #16355 and #16415" }) });
    const linkified = linkifyPrForm({ context: WITH_OWN_NUMBER, form });
    expect(linkified.explainer).toEqual(form.explainer);
    const issues = bareRefIssuesOfPrForm({ context: WITH_OWN_NUMBER, form: linkified });
    expect(issues.map((issue) => issue.path)).toStrictEqual([["explainer"], ["explainer"], ["explainer"]]);
    expect(issues[0]!.message).toContain("largest number known to exist in acme/widget here is 270");
  });

  it("still links this repo's own three-digit numbers in the same cell", () => {
    const form = formWith({ explainer: t({ text: "rebased onto #269" }) });
    const linkified = linkifyPrForm({ context: WITH_OWN_NUMBER, form });
    expect(linkified.explainer).toEqual([{ kind: "text", text: "rebased onto " }, widgetLink({ n: 269 })]);
    expect(bareRefIssuesOfPrForm({ context: WITH_OWN_NUMBER, form: linkified })).toStrictEqual([]);
  });

  it("accepts the cross-repo citation once it is written as owner/repo#n", () => {
    const form = formWith({ explainer: t({ text: "the ruling covered acme/gadget#16339" }) });
    const linkified = linkifyPrForm({ context: WITH_OWN_NUMBER, form });
    expect(linkified.explainer).toEqual([
      { kind: "text", text: "the ruling covered " },
      { kind: "link", text: "acme/gadget#16339", url: "https://github.com/acme/gadget/issues/16339" },
    ]);
    expect(bareRefIssuesOfPrForm({ context: WITH_OWN_NUMBER, form: linkified })).toStrictEqual([]);
  });

  it("refuses inside the re-run fold, not only the top-level cells", () => {
    const form: PrForm = {
      ...formWith({ explainer: t({ text: "none" }) }),
      rerun: [{ content: t({ text: "and #16415 changed" }), kind: "note" }],
    };
    const linkified = linkifyPrForm({ context: WITH_OWN_NUMBER, form });
    const issues = bareRefIssuesOfPrForm({ context: WITH_OWN_NUMBER, form: linkified });
    expect(issues.map((issue) => issue.path)).toStrictEqual([["rerun", 0, "content"]]);
  });
});
