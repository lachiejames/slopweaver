/**
 * The golden-proposal gate, detector by detector.
 *
 * Each case seeds ONE violation into a document that otherwise passes, so a finding proves the detector
 * rather than proving the fixture is bad. The fixture is the shipped example rendered by the real renderer,
 * for the same reason: a hand-written fixture drifts away from what the tool actually produces.
 */
import { describe, expect, it } from "vitest";
import { PROPOSAL_FORM_EXAMPLE } from "../../../../../cli/commands/proposal/formExample.js";
import { lintProposal, proposalFindingLines } from "../../../../../outbound/proposal/lint/lintProposal.js";
import { renderProposal } from "../../../../../outbound/proposal/render.js";
import type { ExactVoiceRule } from "../../../../../outbound/voice/exactRules.js";

const GOLDEN = renderProposal({ form: PROPOSAL_FORM_EXAMPLE });

/** The rule ids a document produces, so a case names the detector rather than quoting its prose. */
function rules({
  markdown,
  voiceRules = [],
}: {
  markdown: string;
  voiceRules?: readonly ExactVoiceRule[];
}): readonly string[] {
  return lintProposal({ markdown, voiceRules }).findings.map((finding) => finding.rule);
}

describe("lintProposal — a clean document", () => {
  it("finds nothing at all in the rendered golden shape", () => {
    expect(rules({ markdown: GOLDEN })).toEqual([]);
  });

  it("does not block", () => {
    expect(lintProposal({ markdown: GOLDEN, voiceRules: [] }).blocked).toBe(false);
  });
});

describe("lintProposal — citations", () => {
  // Seeded before "Open questions" rather than before "The fix": the evidence table's own links sit inside
  // the 200-character window above "The fix", and they legitimately cite anything placed there. The window is
  // the rule, so a fixture that ignores it would be testing the fixture.
  it("blocks a figure with no source within a sentence of it", () => {
    const seeded = GOLDEN.replace("## Open questions", "Retries now cost 4200 ms each.\n\n## Open questions");
    expect(rules({ markdown: seeded })).toContain("uncited-figure");
  });

  it("accepts a figure cited by an external link", () => {
    const seeded = GOLDEN.replace(
      "## Open questions",
      "Retries now cost [4200 ms](https://example.test/runs/3) each.\n\n## Open questions",
    );
    expect(rules({ markdown: seeded })).not.toContain("uncited-figure");
  });

  it("accepts a figure cited by an in-document anchor that RESOLVES", () => {
    const seeded = GOLDEN.replace(
      "## Open questions",
      'Retries cost [4200 ms](#timing) each.\n\n<span id="timing"></span>\n\n## Open questions',
    );
    expect(rules({ markdown: seeded })).not.toContain("uncited-figure");
  });

  it("still blocks a figure whose anchor DANGLES, which reads as a citation and resolves to nothing", () => {
    const seeded = GOLDEN.replace("## Open questions", "Retries cost [4200 ms](#nowhere) each.\n\n## Open questions");
    expect(rules({ markdown: seeded })).toContain("uncited-figure");
  });

  it("ignores a figure inside a code fence, which is data rather than a claim", () => {
    const seeded = GOLDEN.replace("## Open questions", "```\ntimeout = 4200 ms\n```\n\n## Open questions");
    expect(rules({ markdown: seeded })).not.toContain("uncited-figure");
  });

  it("blocks a raw URL in prose", () => {
    const seeded = GOLDEN.replace("## The fix", "See https://example.test/raw for the workings.\n\n## The fix");
    expect(rules({ markdown: seeded })).toContain("bare-url");
  });

  it("blocks a [v1]-style reference marker", () => {
    const seeded = GOLDEN.replace("## The fix", "The runner is slow [v1].\n\n## The fix");
    expect(rules({ markdown: seeded })).toContain("reference-marker");
  });
});

describe("lintProposal — structure", () => {
  it("blocks a missing golden section", () => {
    expect(rules({ markdown: GOLDEN.replace("## Scope and trade-offs", "## Something else") })).toContain(
      "section-missing",
    );
  });

  it("blocks sections in the wrong order", () => {
    const swapped = GOLDEN.replace("## TL;DR", "## PLACEHOLDER")
      .replace("## The fix", "## TL;DR")
      .replace("## PLACEHOLDER", "## The fix");
    expect(rules({ markdown: swapped })).toContain("section-order");
  });

  it("blocks a hero shot that is not in the top third", () => {
    const image =
      "![the retry column, with the four repeat failures boxed in red](https://example.test/shots/hero.png)";
    const moved = `${GOLDEN.replace(`${image}\n\n`, "")}\n${image}\n`;
    expect(rules({ markdown: moved })).toContain("no-hero-image");
  });

  it("counts a `file:` upload placeholder as the hero shot — it IS going to be an image", () => {
    const image =
      "![the retry column, with the four repeat failures boxed in red](https://example.test/shots/hero.png)";
    const placeheld = GOLDEN.replace(image, "![the retry column, boxed in red](file:./shots/hero.png)");
    expect(rules({ markdown: placeheld })).not.toContain("no-hero-image");
    expect(rules({ markdown: placeheld })).not.toContain("images-clustered-at-end");
  });

  it("blocks every image being clustered into a trailing appendix", () => {
    const image = "![shot](https://example.test/shots/hero.png)";
    const clustered = `${GOLDEN.replaceAll(/^!\[.*\]\(.*\)$/gm, "")}\n${image}\n${image}\n`;
    expect(rules({ markdown: clustered })).toContain("images-clustered-at-end");
  });

  it("warns when the strawman blockquote is gone", () => {
    expect(rules({ markdown: GOLDEN.split("\n").slice(1).join("\n") })).toContain("no-strawman");
  });

  it("warns when the table-of-contents block is gone", () => {
    expect(rules({ markdown: GOLDEN.replace('<table_of_contents color="gray"/>', "") })).toContain(
      "no-table-of-contents",
    );
  });

  it("warns when nothing invites the reader to push back", () => {
    const dictated = GOLDEN.replaceAll("shot at", "considered").replaceAll(
      "so tell me where I have it wrong",
      "so this is the plan",
    );
    expect(rules({ markdown: dictated })).toContain("dictate-not-invite");
  });
});

describe("lintProposal — voice shapes the public repo owns", () => {
  it("warns on negative parallelism", () => {
    const seeded = GOLDEN.replace("## The fix", "This is not a tooling problem, it's a process one.\n\n## The fix");
    expect(rules({ markdown: seeded })).toContain("ai-scaffold-tell");
  });

  it("warns on a performative opener", () => {
    expect(rules({ markdown: `Great question, here is the answer.\n\n${GOLDEN}` })).toContain("ai-scaffold-tell");
  });

  it("warns on a bucket abstraction", () => {
    const seeded = GOLDEN.replace("## The fix", "There are three angles here.\n\n## The fix");
    expect(rules({ markdown: seeded })).toContain("ai-scaffold-tell");
  });

  it("warns on an exclamation mark, but not on a markdown image", () => {
    expect(rules({ markdown: GOLDEN })).not.toContain("exclamation-in-broadcast");
    expect(rules({ markdown: `${GOLDEN}\nThis is great!\n` })).toContain("exclamation-in-broadcast");
  });

  it("warns on a headcount framing", () => {
    const seeded = GOLDEN.replace("## The fix", "This makes the team 10x faster.\n\n## The fix");
    expect(rules({ markdown: seeded })).toContain("headcount-framing");
  });

  it("warns on a projected figure asserted as measured", () => {
    const seeded = GOLDEN.replace(
      "## The fix",
      "This would have cut [40%](https://example.test/runs/9) of the retries.\n\n## The fix",
    );
    expect(rules({ markdown: seeded })).toContain("unhedged-projection");
  });

  it("accepts the same projection once it is hedged", () => {
    const seeded = GOLDEN.replace(
      "## The fix",
      "This would probably have cut [40%](https://example.test/runs/9) of the retries.\n\n## The fix",
    );
    expect(rules({ markdown: seeded })).not.toContain("unhedged-projection");
  });
});

describe("lintProposal — the operator's private exact rules", () => {
  const rule: ExactVoiceRule = { kind: "literal", value: "—" };

  it("gates nothing on vocabulary when no rules are configured", () => {
    expect(rules({ markdown: `${GOLDEN}\nan em — dash\n` })).not.toContain("voice-rule");
  });

  it("blocks a configured literal, which is how the em dash is caught", () => {
    expect(rules({ markdown: `${GOLDEN}\nan em — dash\n`, voiceRules: [rule] })).toContain("voice-rule");
  });

  it("names the rule list's own home in the message, so the operator can change it", () => {
    const finding = lintProposal({ markdown: `${GOLDEN}\nan em — dash\n`, voiceRules: [rule] }).findings.find(
      (found) => found.rule === "voice-rule",
    )!;
    expect(finding.message).toContain("profile.json");
    expect(finding.severity).toBe("blocker");
  });

  it("does not match inside a fenced code block, which is quoted data", () => {
    expect(rules({ markdown: `${GOLDEN}\n\`\`\`\nan em — dash\n\`\`\`\n`, voiceRules: [rule] })).not.toContain(
      "voice-rule",
    );
  });
});

describe("proposalFindingLines", () => {
  it("prints blockers before warnings", () => {
    const lines = proposalFindingLines({
      findings: [
        { message: "a warning", rule: "w", severity: "warning" },
        { message: "a blocker", rule: "b", severity: "blocker" },
      ],
    });
    expect(lines).toEqual(["1 blocking finding(s):", "  [b] a blocker", "1 warning(s):", "  [w] a warning"]);
  });

  it("says nothing at all when there is nothing to say", () => {
    expect(proposalFindingLines({ findings: [] })).toEqual([]);
  });

  it("names the line when a detector knew one", () => {
    expect(proposalFindingLines({ findings: [{ line: 7, message: "m", rule: "r", severity: "blocker" }] })[1]).toBe(
      "  [r] line 7: m",
    );
  });
});
