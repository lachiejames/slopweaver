/**
 * The golden-proposal renderer.
 *
 * These assert the SHAPE the schema promises: exactly five H2 sections in the golden order, the strawman and
 * the table-of-contents block above them, and everything heavy folded into a toggle. The strongest test is
 * the round trip at the bottom: what the renderer writes must pass the gate that judges it, or the two have
 * disagreed about the house shape and one of them is wrong.
 */
import { describe, expect, it } from "vitest";
import { PROPOSAL_FORM_EXAMPLE } from "../../../../cli/commands/proposal/formExample.js";
import { mediaPlaceholders } from "../../../../outbound/notion/mediaPlaceholder.js";
import { lintProposal } from "../../../../outbound/proposal/lint/lintProposal.js";
import { proposalEmoji, proposalTitle, renderProposal, STRAWMAN, TOC } from "../../../../outbound/proposal/render.js";
import type { ProposalForm } from "../../../../outbound/proposal/types.js";

const RENDERED = renderProposal({ form: PROPOSAL_FORM_EXAMPLE });

/** Every H2 heading, in document order. */
function sections({ markdown }: { markdown: string }): readonly string[] {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3));
}

describe("renderProposal", () => {
  it("renders a `file:` hero as a placeholder the Notion upload pass actually recognises", () => {
    // The property worth testing is not that the renderer emits SOME image line, it is that the line it
    // emits is the one `mediaPlaceholder.ts` will find. The two modules agree by convention rather than by
    // a shared type, so a change to either pattern has to fail here rather than at publish time.
    const hero = { ...PROPOSAL_FORM_EXAMPLE.data.hero!, caption: "the hero", url: "file:./shots/hero.png" };
    const markdown = renderProposal({
      form: { ...PROPOSAL_FORM_EXAMPLE, data: { ...PROPOSAL_FORM_EXAMPLE.data, hero } },
    });
    const found = mediaPlaceholders({ markdown });
    expect(found.length).toBe(1);
    expect(found[0]!.source).toBe("./shots/hero.png");
    expect(found[0]!.caption).toBe("the hero");
  });

  it("satisfies the hero-shot gate with a `file:` hero, so a local screenshot can publish", () => {
    // The gate this closes: `heroImageInTopThird` is a BLOCKER for any document carrying figures, and
    // before `file:` was accepted here a proposal whose only hero was a local screenshot could not pass it
    // at all without hosting the image somewhere else first.
    const hero = { ...PROPOSAL_FORM_EXAMPLE.data.hero!, url: "file:./shots/hero.png" };
    const markdown = renderProposal({
      form: { ...PROPOSAL_FORM_EXAMPLE, data: { ...PROPOSAL_FORM_EXAMPLE.data, hero } },
    });
    expect(lintProposal({ markdown, voiceRules: [] }).findings.map((finding) => finding.rule)).toEqual([]);
  });

  it("emits exactly the five golden sections, in order", () => {
    expect(sections({ markdown: RENDERED })).toEqual([
      "TL;DR",
      "What the data shows",
      "The fix",
      "Scope and trade-offs",
      "Open questions",
    ]);
  });

  it("opens with the strawman blockquote and then the real table-of-contents block", () => {
    const lines = RENDERED.split("\n");
    expect(lines[0]).toBe(STRAWMAN);
    expect(lines[2]).toBe(TOC);
  });

  it("keeps the title out of the body, because a Notion title is a page property", () => {
    expect(RENDERED.includes(`# ${PROPOSAL_FORM_EXAMPLE.title}`)).toBe(false);
    expect(proposalTitle({ form: PROPOSAL_FORM_EXAMPLE })).toBe(
      "Make a nightly failure reproducible before we chase it",
    );
    expect(proposalEmoji({ form: PROPOSAL_FORM_EXAMPLE })).toBe("🧭");
  });

  it("puts the hero shot above its italic caption and the frozen-source link", () => {
    const at = RENDERED.indexOf("![the retry column");
    expect(
      RENDERED.slice(at).startsWith(
        "![the retry column, with the four repeat failures boxed in red](https://example.test/shots/hero.png)",
      ),
    ).toBe(true);
    expect(RENDERED).toContain("*Above: the retry column, with the four repeat failures boxed in red*");
    expect(RENDERED).toContain("[the frozen run](https://example.test/runs/1)");
  });

  it("renders the evidence table with a header row and one row per data point", () => {
    expect(RENDERED).toContain("| Data point | What it shows | Source |");
    expect(RENDERED).toContain("| Repeat failures in the nightly suite |");
    expect(RENDERED).toContain("| Time lost to a re-run |");
  });

  it("folds the options into a toggle rather than giving them their own section", () => {
    expect(RENDERED).toContain("<summary>Options considered</summary>");
    expect(sections({ markdown: RENDERED })).not.toContain("Options considered");
  });

  it("marks the recommendation in place, in the option cell", () => {
    expect(RENDERED).toContain("| Record and replay the seed (recommended) |");
    expect(RENDERED).toContain("| Retry three times and move on |");
  });

  it("fences the diagram with its own language", () => {
    expect(RENDERED).toContain("```mermaid");
  });

  it("names the weakest part of the argument in the scope section", () => {
    expect(RENDERED).toContain(
      "Weakest part of the argument, named before you find it: the sample is one week of runs",
    );
  });

  it("addresses the open questions to the named stakeholder", () => {
    expect(RENDERED).toContain("For whoever owns the nightly suite:");
    expect(RENDERED).toContain("- **owner**: are you the one who signs this off, or does it go wider?");
  });

  it("folds the appendix into a toggle", () => {
    expect(RENDERED).toContain("<summary>Appendix, verifiable detail for agents</summary>");
  });

  it("ends with exactly one trailing newline", () => {
    expect(RENDERED.endsWith("</details>\n")).toBe(true);
  });
});

describe("renderProposal with the optional parts absent", () => {
  const bare: ProposalForm = {
    ...PROPOSAL_FORM_EXAMPLE,
    appendix: undefined,
    data: { rows: PROPOSAL_FORM_EXAMPLE.data.rows },
    fix: { body: PROPOSAL_FORM_EXAMPLE.fix.body, optionsConsidered: [] },
  };
  const rendered = renderProposal({ form: bare });

  it("still emits the five sections, in order", () => {
    expect(sections({ markdown: rendered })).toEqual([
      "TL;DR",
      "What the data shows",
      "The fix",
      "Scope and trade-offs",
      "Open questions",
    ]);
  });

  it("emits no toggle at all when there is nothing to fold", () => {
    expect(rendered).not.toContain("<details>");
  });

  it("emits no image and no fence", () => {
    expect(rendered).not.toContain("![");
    expect(rendered).not.toContain("```");
  });
});

describe("the renderer and the gate agree about the house shape", () => {
  it("renders a document that its own lint gate passes with nothing at all to say", () => {
    const result = lintProposal({ markdown: RENDERED, voiceRules: [] });
    expect(result.blocked).toBe(false);
    expect(result.findings).toEqual([]);
  });
});
