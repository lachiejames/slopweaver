/*
 * `paragraphSpacingRefusalForPlan`: a single message whose paragraphs run together refused, a quote kept directly
 * above its answer, and the rule silent when unconfigured, on a one-card form, and on a multi-message drip.
 */
import { describe, expect, it } from "vitest";

import { buildSlackDripPlan, paragraphSpacingRefusalForPlan } from "../../../../../../cli/commands/slack/dripCore.js";
import type { OneCardArtifact } from "../../../../../../outbound/artifact/types.js";
import { dripArtifact, NO_MENTIONS, options } from "./harness.js";

/** A one-card artifact of `n` one-run lines. */
function cardArtifact({ texts }: { texts: readonly string[] }): OneCardArtifact {
  return { kind: "one-card", lines: texts.map((text) => ({ runs: [{ text, type: "text" as const }] })) };
}

describe("paragraphSpacingRefusalForPlan", () => {
  /** A plan carrying ONE `--body` message of exactly this text. */
  function bodyPlan({ text }: { text: string }): ReturnType<typeof buildSlackDripPlan> {
    return buildSlackDripPlan({
      artifact: { kind: "plain", text },
      intervalMs: 0,
      mentions: NO_MENTIONS,
      options: options({ texts: [text] }),
    });
  }

  it("refuses a single message whose paragraphs run together", () => {
    const refusals = paragraphSpacingRefusalForPlan({ enabled: true, plan: bodyPlan({ text: "one idea\nnext idea" }) });

    expect(refusals.length).toBe(1);
    expect(refusals[0]).toContain("its paragraphs run together");
  });

  it("passes the same words once a blank line separates them", () => {
    expect(
      paragraphSpacingRefusalForPlan({ enabled: true, plan: bodyPlan({ text: "one idea\n\nnext idea" }) }),
    ).toEqual([]);
  });

  it("passes a quote with its answer directly under it, the owner's own shape", () => {
    expect(
      paragraphSpacingRefusalForPlan({
        enabled: true,
        plan: bodyPlan({ text: "> the point they made\nmy answer to it\n\n> their second point\nand the answer" }),
      }),
    ).toEqual([]);
  });

  it("refuses a blank line between a quote and its answer", () => {
    const refusals = paragraphSpacingRefusalForPlan({
      enabled: true,
      plan: bodyPlan({ text: "> the point they made\n\nmy answer to it" }),
    });

    expect(refusals.length).toBe(1);
    expect(refusals[0]).toContain("a quote has a blank line between it and its answer");
  });

  it("passes a dense message when the operator has not configured the rule", () => {
    expect(paragraphSpacingRefusalForPlan({ enabled: false, plan: bodyPlan({ text: "one idea\nnext idea" }) })).toEqual(
      [],
    );
  });

  it("passes a one-card form, whose renderer puts the blank line in for the author", () => {
    const plan = buildSlackDripPlan({
      artifact: cardArtifact({ texts: ["one idea", "next idea", "E.g. this one"] }),
      intervalMs: 0,
      mentions: NO_MENTIONS,
      options: options({ texts: ["one idea"] }),
    });

    expect(paragraphSpacingRefusalForPlan({ enabled: true, plan })).toEqual([]);
  });

  it("leaves a MULTI-message drip alone — the gap between messages is its spacing", () => {
    const plan = buildSlackDripPlan({
      artifact: dripArtifact({ texts: ["one idea", "next idea"] }),
      intervalMs: 0,
      mentions: NO_MENTIONS,
      options: options({ texts: ["one idea", "next idea"] }),
    });

    expect(plan.messages.length).toBe(2);
    expect(paragraphSpacingRefusalForPlan({ enabled: true, plan })).toEqual([]);
  });
});
