import { describe, expect, it } from "vitest";

import { DRAFT_SHAPE_LINES, voiceRuleBriefLines } from "../../../../outbound/voice/composerBrief.js";
import type { ExactVoiceRule } from "../../../../outbound/voice/exactRules.js";

/** The one-line block printed when this installation configured no response shape. */
const NO_SHAPE =
  "RESPONSE SHAPE — none configured for this installation (`slackMe.voice.shapeMemoryFile` is unset), so the" +
  " rules below are the whole of what is configured. They are a vocabulary, not a shape.";

/** The first line of the spacing block, labelled so a reader knows it is enforced. */
const SPACING_FIRST =
  "PARAGRAPH SPACING (ENFORCED) — a SINGLE `--as me` message (a `one-card` post, a `one-list` roster, or any";

/** The parked-draft block plus the blank line after it: every index past the shape moves by this much. */
const DRAFT_BLOCK = DRAFT_SHAPE_LINES.length + 1;

describe("voiceRuleBriefLines", () => {
  it("states plainly that nothing is configured when neither a shape nor a rule is given", () => {
    const lines = voiceRuleBriefLines({ paragraphSpacing: false, rules: [], shape: null });

    expect(lines).toEqual([
      NO_SHAPE,
      "",
      ...DRAFT_SHAPE_LINES,
      "",
      "VOICE RULES — no vocabulary rules configured for this installation. Nothing here refuses on words.",
    ]);
  });

  it("briefs the parked-draft shape as ENFORCED, its numbers read off the gate", () => {
    expect(DRAFT_SHAPE_LINES).toHaveLength(6);
    expect(DRAFT_SHAPE_LINES[0]).toBe(
      "PARKED DRAFT SHAPE (ENFORCED at `slack draft record --as me`, never at release) — every word earns its place:",
    );
    expect(DRAFT_SHAPE_LINES[1]).toBe(
      "at most 3 paragraphs and 100 words (a link's label counts), 1 figure in the prose with every other number drawn on the attached image, 1 clear question to the person tagged,",
    );
    // A draft that was right is spoiled by extra sentences after its ask.
    expect(DRAFT_SHAPE_LINES[3]).toBe(
      'A paragraph that asks the reader something ends on that ask: nothing restating it after, bar "no rush".',
    );
  });

  it("renders a literal rule's value verbatim, labelled case-sensitive", () => {
    const rules: readonly ExactVoiceRule[] = [{ kind: "literal", value: "—" }];

    const lines = voiceRuleBriefLines({ paragraphSpacing: false, rules, shape: null });

    expect(lines).toContain('  - literal (case-sensitive): "—"');
  });

  it("renders a word rule's value verbatim, labelled case-insensitive", () => {
    const rules: readonly ExactVoiceRule[] = [{ kind: "word", value: "delve" }];

    const lines = voiceRuleBriefLines({ paragraphSpacing: false, rules, shape: null });

    expect(lines).toContain('  - word (case-insensitive): "delve"');
  });

  it("renders a phrase rule's value verbatim, labelled case-insensitive", () => {
    const rules: readonly ExactVoiceRule[] = [{ kind: "phrase", value: "happy to" }];

    const lines = voiceRuleBriefLines({ paragraphSpacing: false, rules, shape: null });

    expect(lines).toContain('  - phrase (case-insensitive): "happy to"');
  });

  it("renders one line per rule, in the given order, with the header and override reminder around them", () => {
    const rules: readonly ExactVoiceRule[] = [
      { kind: "literal", value: "—" },
      { kind: "word", value: "delve" },
    ];

    const lines = voiceRuleBriefLines({ paragraphSpacing: false, rules, shape: null });

    expect(lines[2 + DRAFT_BLOCK]).toBe(
      "VOICE RULES (ENFORCED) — compose to these; the `--as me` send REFUSES authored prose matching any of",
    );
    expect(lines[6 + DRAFT_BLOCK]).toBe('  - literal (case-sensitive): "—"');
    expect(lines[7 + DRAFT_BLOCK]).toBe('  - word (case-insensitive): "delve"');
    expect(lines.at(-1)).toBe("otherwise, and this refuses rather than rewrites.");
    expect(lines.length).toBe(10 + DRAFT_BLOCK);
  });

  it("prints the operator's shape prose verbatim, one line per line, above the enforced rules", () => {
    const rules: readonly ExactVoiceRule[] = [{ kind: "word", value: "delve" }];

    const lines = voiceRuleBriefLines({
      paragraphSpacing: false,
      rules,
      shape: "One short line.\n\nThen the outcome.",
    });

    expect(lines[0]).toBe(
      "RESPONSE SHAPE (ADVISORY, the operator's own guidance) — how a reply should READ. The Slack send refuses",
    );
    expect(lines[1]).toBe(
      "none of it. Separately, `gmail draft --reply-to` refuses a reply OPENING on a quote of the whole parent it",
    );
    expect(lines[4]).toBe("One short line.");
    expect(lines[5]).toBe("");
    expect(lines[6]).toBe("Then the outcome.");
    expect(lines[8]).toBe(DRAFT_SHAPE_LINES[0]);
    expect(lines[8 + DRAFT_BLOCK]).toBe(
      "VOICE RULES (ENFORCED) — compose to these; the `--as me` send REFUSES authored prose matching any of",
    );
  });

  it("briefs the shape even on an installation with no vocabulary rules at all", () => {
    const lines = voiceRuleBriefLines({ paragraphSpacing: false, rules: [], shape: "One short line." });

    expect(lines[4]).toBe("One short line.");
    expect(lines.at(-1)).toBe(
      "VOICE RULES — no vocabulary rules configured for this installation. Nothing here refuses on words.",
    );
  });

  it("appends the paragraph-spacing rule only when the operator has configured it", () => {
    const rules: readonly ExactVoiceRule[] = [{ kind: "word", value: "delve" }];

    const off = voiceRuleBriefLines({ paragraphSpacing: false, rules, shape: null });
    const on = voiceRuleBriefLines({ paragraphSpacing: true, rules, shape: null });

    expect(off.length).toBe(9 + DRAFT_BLOCK);
    expect(on.length).toBe(16 + DRAFT_BLOCK);
    expect(on[9 + DRAFT_BLOCK]).toBe(SPACING_FIRST);
    expect(on.at(-1)).toBe(
      "the override: `lead`, `bullets`, `trailing` — see skills/slack/reference/the-list-form.md.",
    );
  });

  it("still briefs the spacing rule on an installation with no vocabulary rules at all", () => {
    const lines = voiceRuleBriefLines({ paragraphSpacing: true, rules: [], shape: null });

    expect(lines.length).toBe(10 + DRAFT_BLOCK);
    expect(lines[0]).toBe(NO_SHAPE);
    expect(lines[2 + DRAFT_BLOCK]).toBe(
      "VOICE RULES — no vocabulary rules configured for this installation. Nothing here refuses on words.",
    );
    expect(lines[3 + DRAFT_BLOCK]).toBe(SPACING_FIRST);
  });
});
