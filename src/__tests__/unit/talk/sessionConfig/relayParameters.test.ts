/**
 * What `relay_steer` lets the model supply: the owner's words, the card they rule on and the team fix they ask for, and the
 * judgement on every relay of whether the owner's words answer the card the owner had open.
 */
import { describe, expect, it } from "vitest";

import { TALK_TOOLS } from "../../../../talk/talkToolSchemas.js";

describe("TALK_TOOLS", () => {
  it("lets the model supply only the words of a relay, which check-in, candidate or triage card they rule on and which team fix they ask for — never a turn, the owner's transcript or the record", () => {
    const relay = TALK_TOOLS.find((tool) => tool.name === "relay_steer")!;
    expect(Object.keys(Object(relay.parameters["properties"]))).toEqual([
      "say",
      "outward",
      "answers_open_card",
      "also_answers",
      "sends",
      "check_in",
      "covers",
      "candidate",
      "reaction",
      "triage",
      "label",
      "feedback",
      "triage_card",
      "fix_repo",
      "fix_thread",
    ]);
    expect(relay.parameters["required"]).toEqual(["say", "outward", "answers_open_card"]);
  });

  // "Uh, good morning" was taken as the open card's answer.
  it("has the voice judge, on every relay, whether the owner's words answer the card the owner had open", () => {
    const relay = TALK_TOOLS.find((tool) => tool.name === "relay_steer")!;
    expect(relay.description).toContain("Pass answers_open_card on every relay");
    expect(JSON.stringify(relay.parameters["properties"])).toContain("a greeting or filler ('good morning'");
  });

  // A check-in or triage verdict answers THAT card, and its relay is about it, so the open card is not answered.
  it("has the voice judge the open card unanswered when the owner's words rule a check-in or triage card", () => {
    const relay = TALK_TOOLS.find((tool) => tool.name === "relay_steer")!;
    expect(JSON.stringify(relay.parameters["properties"])).toContain(
      "With check_in or triage, the owner's words answer THAT card and not the one open, so false.",
    );
  });

  // The nudge covers the owner's own ask for a fix on a team repository, never Slopweaver's.
  it("has the voice name a team fix the owner's own words ask for, and pass it again with the owner's answer", () => {
    const relay = TALK_TOOLS.find((tool) => tool.name === "relay_steer")!;
    expect(relay.description).toContain(
      "When the owner's own words ask for a fix or pull request raised on a team repository, pass fix_repo naming it, and " +
        "fix_thread when you have the Slack thread about the problem; pass them again with the owner's answer when the relay " +
        "hands you a question to put. Never for Slopweaver's own repository.",
    );
  });
});
