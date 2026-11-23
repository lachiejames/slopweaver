/**
 * The automation prompt FORM — the payload that declares itself so a door can refuse it.
 *
 * Pure throughout: the form is parsed and derived with the same functions `slack post` runs, and nothing
 * here reaches a wire or a clock.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  AUTOMATION_POST_TO_MAX,
  AUTOMATION_PROMPT_KIND,
  AUTOMATION_PROMPT_VISIBLE_MAX,
  AUTOMATION_RECIPE_ID_MAX,
  automationDestinationLine,
  automationPromptToNoFold,
  automationRunMarker,
  checkAutomationPrompt,
  parseAutomationPrompt,
} from "../../../../outbound/artifact/automationPrompt.js";
import { NO_FOLD_VISIBLE_MAX, noFoldVisibleLength } from "../../../../outbound/artifact/noFoldSchema.js";

/** A team channel id, which is where a finished card legitimately goes. */
const TEAM_CHANNEL = "Cteamroom";

/** The smallest valid payload; cases that vary one field spread this. */
function form(): Record<string, unknown> {
  return {
    kind: AUTOMATION_PROMPT_KIND,
    prompt: "read vanta live and rank what closes the most controls per hour.",
    recipeId: "compliance-daily-standup",
  };
}

describe("automationPromptToNoFold", () => {
  it("puts the whole prompt on the lead line, so no reader has to expand to see the question", () => {
    const artifact = automationPromptToNoFold({
      form: { postTo: undefined, prompt: "what broke?", recipeId: "overnight-staging" },
    });
    expect(artifact["kind"]).toBe("no-fold");
    expect(JSON.stringify(artifact["lead"])).toBe(JSON.stringify([{ text: "what broke?", type: "text" }]));
  });

  it("closes with the run marker alone when the answer stays where the question was asked", () => {
    const artifact = automationPromptToNoFold({
      form: { postTo: undefined, prompt: "what broke?", recipeId: "overnight-staging" },
    });
    expect(JSON.stringify(artifact["trailing"])).toBe(
      JSON.stringify([[{ italic: true, text: "automation · overnight-staging", type: "text" }]]),
    );
  });

  it("states the destination ABOVE the run marker when the row names one", () => {
    const artifact = automationPromptToNoFold({
      form: { postTo: TEAM_CHANNEL, prompt: "what broke?", recipeId: "overnight-staging" },
    });
    expect(JSON.stringify(artifact["trailing"])).toBe(
      JSON.stringify([
        [{ text: `The finished card goes in ${TEAM_CHANNEL}, not here.`, type: "text" }],
        [{ italic: true, text: "automation · overnight-staging", type: "text" }],
      ]),
    );
  });

  it("carries no mention run at all, so the prompt cannot tag the bot into a second capture", () => {
    const artifact = automationPromptToNoFold({
      form: { postTo: TEAM_CHANNEL, prompt: "what broke?", recipeId: "overnight-staging" },
    });
    expect(JSON.stringify(artifact)).not.toContain("mention");
    expect(JSON.stringify(artifact)).not.toContain("<@");
  });
});

describe("parseAutomationPrompt", () => {
  it("derives the no-fold message a valid payload sends", () => {
    const artifact = unwrap(parseAutomationPrompt({ raw: form() }));
    expect(artifact.kind).toBe("no-fold");
    expect(artifact.lead[0]).toEqual({
      text: "read vanta live and rank what closes the most controls per hour.",
      type: "text",
    });
  });

  it("refuses an unknown key rather than dropping it, naming the field list", () => {
    const issues = unwrapErr(parseAutomationPrompt({ raw: { ...form(), channel: TEAM_CHANNEL } }));
    expect(issues.join("\n")).toContain('unknown field "channel"');
  });

  it("refuses a blank prompt rather than posting an empty message", () => {
    const issues = unwrapErr(parseAutomationPrompt({ raw: { ...form(), prompt: "" } }));
    expect(issues.join("\n")).toContain("prompt");
  });

  it("refuses a prompt past its own cap, naming the field to shorten", () => {
    const issues = unwrapErr(
      parseAutomationPrompt({ raw: { ...form(), prompt: "a".repeat(AUTOMATION_PROMPT_VISIBLE_MAX + 1) } }),
    );
    expect(issues.join("\n")).toContain("prompt");
  });

  it("refuses a destination past its own cap, so the whole-message sum stays provable", () => {
    const issues = unwrapErr(
      parseAutomationPrompt({ raw: { ...form(), postTo: "C".repeat(AUTOMATION_POST_TO_MAX + 1) } }),
    );
    expect(issues.join("\n")).toContain("postTo");
  });

  it("refuses a recipe id past its own cap, for the same reason", () => {
    const issues = unwrapErr(
      parseAutomationPrompt({ raw: { ...form(), recipeId: "r".repeat(AUTOMATION_RECIPE_ID_MAX + 1) } }),
    );
    expect(issues.join("\n")).toContain("recipeId");
  });

  /**
   * The cap arithmetic, PINNED rather than trusted.
   *
   * The three caps are independent numbers, and their sum is the claim that a form which validates can
   * always be sent. This builds the widest message the form can derive: every field at its own limit, and
   * both trailing lines present. It reddens if any one of the three is raised without the others moving.
   */
  it("derives a message inside the no-fold bound with every field at its own cap", () => {
    const artifact = unwrap(
      parseAutomationPrompt({
        raw: {
          kind: AUTOMATION_PROMPT_KIND,
          postTo: "C".repeat(AUTOMATION_POST_TO_MAX),
          prompt: "a".repeat(AUTOMATION_PROMPT_VISIBLE_MAX),
          recipeId: "r".repeat(AUTOMATION_RECIPE_ID_MAX),
        },
      }),
    );
    expect(noFoldVisibleLength({ artifact })).toBe(646);
    expect(NO_FOLD_VISIBLE_MAX).toBe(650);
  });
});

describe("the lines composed here", () => {
  it("names the destination in the sentence the answering session reads", () => {
    expect(automationDestinationLine({ postTo: TEAM_CHANNEL })).toBe(
      `The finished card goes in ${TEAM_CHANNEL}, not here.`,
    );
  });

  it("says which row asked, so a reader who never registered it can still tell why it appeared", () => {
    expect(automationRunMarker({ recipeId: "compliance-daily-standup" })).toBe("automation · compliance-daily-standup");
  });
});

describe("checkAutomationPrompt", () => {
  it("names each field the form refuses by its path, the shape a recipe pre-check relays", () => {
    const raw = { ...form(), prompt: "a".repeat(AUTOMATION_PROMPT_VISIBLE_MAX + 1), stray: true };
    const issues = unwrapErr(checkAutomationPrompt({ raw }));
    expect(issues).toHaveLength(2);
    expect(issues[0]).toBe("prompt: Too big: expected string to have <=500 characters");
    expect(issues[1]).toContain('form: unknown field "stray" — REFUSED');
  });

  it("admits what parseAutomationPrompt admits, deriving the same message", () => {
    expect(unwrap(checkAutomationPrompt({ raw: form() }))).toEqual(unwrap(parseAutomationPrompt({ raw: form() })));
  });
});
