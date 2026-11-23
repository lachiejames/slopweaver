/**
 * The open-card hold, asserted as prompt text: a card open on the owner's screen is theirs, read aloud, silently or
 * saying so, and no line of either prompt or of `relay_steer` moves them past it until their own words since it opened
 * do. The hold's core lines are asserted beside the other walk rules in sessionConfig.test.ts; these are what each
 * review of the fix closed on top of them.
 */
import { describe, expect, it } from "vitest";

import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../talk/sessionConfig.js";
import { TALK_TOOLS } from "../../../talk/talkToolSchemas.js";
import { ownerNeutral } from "./ownerNeutral.js";

describe("the open-card hold", () => {
  it("holds a card the owner reads silently or says they are reading, and a reaction never moves past it, both prompts", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "The owner reads a card: any card or page open on screen is theirs, read aloud, silently or saying so\n" +
        "('I'm still reading'); they set the pace and it is not a walk. Answer what they said, in a few words on THEIR reaction and",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "A reaction is not their word on the card: never introduce it again, offer to send it back, park it or move past",
    );
  });

  it("never opens or raises a card while another still holds the owner", () => {
    // Naming or raising a card never moves the owner off one they still have open.
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "asked about, or one you raise or walk to while no card holds\nthe owner",
    );
    expect(TALK_VOICE_INSTRUCTIONS).not.toMatch(
      ownerNeutral({ phrase: "they name one, you raise one, a walk reaches the next" }),
    );
  });

  it("counts only the owner's words since the card opened, so the 'next' that opened it never moves past it", () => {
    // Codex review: the voice's half carries "since it opened" too.
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "until, since it opened, they rule it, ask what is next, or say they're done with it.",
    );
    // Being done releases the card only when the owner SAYS so, never when it looks that way.
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "until, since it opened, they rule it, ask what is next, or\n  say they are done with it.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("A card you just opened ends on its own question.");
  });

  it("never releases a card on the owner asking what the voice thinks", () => {
    // Asking what the voice thinks is never a release, so a later reaction cannot move the owner on.
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "\nAsked what you think, give your view and stop: the card stays theirs.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "  Asked what you think, give your view and stop: the card stays theirs.",
    );
    expect([TALK_VOICE_INSTRUCTIONS, TALK_BACKEND_INSTRUCTIONS].join("\n")).not.toContain(
      "asks what is next or what you think",
    );
  });

  it("holds every open card, and no walk rule anywhere passes one", () => {
    // Every open card holds, not only one just opened or one the owner says they read.
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "any card open on the screen is theirs, read aloud, silently or saying so",
    );
    expect([TALK_VOICE_INSTRUCTIONS, TALK_BACKEND_INSTRUCTIONS].join("\n")).not.toMatch(
      ownerNeutral({ phrase: "was just opened or they read it" }),
    );
    // Claude fallback review: "above" left a walk rule placed elsewhere (a correction's "in a walk, the next item").
    expect(TALK_BACKEND_INSTRUCTIONS).not.toContain("the walk rules above do not apply to it.");
    // Claude fallback review: relay_steer's own no-act "next thing" names the open card it never passes.
    expect(TALK_TOOLS.find((tool) => tool.name === "relay_steer")!.description).toContain(
      "word or two and then the next thing (never past an open card, below), never a lookup to confirm it.",
    );
  });
});
