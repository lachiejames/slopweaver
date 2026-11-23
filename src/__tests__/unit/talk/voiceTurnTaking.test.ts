import { describe, expect, it } from "vitest";

import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../talk/sessionConfig.js";
import { BACKEND_QUESTION_BEAT_LINES, VOICE_TURN_TAKING_LINES } from "../../../talk/voiceTurnTaking.js";

describe("voiceTurnTaking", () => {
  it("is carried whole and in order by the prompt each half is for", () => {
    expect(VOICE_TURN_TAKING_LINES.length).toBe(23);
    expect(BACKEND_QUESTION_BEAT_LINES.length).toBe(3);
    expect(TALK_VOICE_INSTRUCTIONS).toContain(VOICE_TURN_TAKING_LINES.join("\n"));
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(BACKEND_QUESTION_BEAT_LINES.join("\n"));
  });

  // The owner wants a slight delay between the response part and the question part.
  it("puts the beat after the turn-length line and before nodding along, so it governs every answer that asks", () => {
    const joined = VOICE_TURN_TAKING_LINES.join("\n");
    expect(joined.indexOf("Keep turns short")).toBe(0);
    expect(joined.indexOf("those are two beats")).toBeGreaterThan(joined.indexOf("say there is and wait."));
    expect(joined.indexOf("nod along")).toBeGreaterThan(joined.indexOf("those are two beats"));
  });

  // The voice owes the next turn when the owner leaves nothing to answer.
  it("keeps the owed turn last, after the finished-or-unfinished thought lines it never weakens", () => {
    const joined = VOICE_TURN_TAKING_LINES.join("\n");
    expect(joined.indexOf("A finished thought")).toBeGreaterThan(joined.indexOf("An unfinished thought"));
    expect(joined.indexOf("left nothing to answer")).toBeGreaterThan(joined.indexOf("A finished thought"));
    expect(VOICE_TURN_TAKING_LINES.at(-1)).toBe("hands it to you.");
  });

  // These lines once said carry on, the asked-only lines said volunteer nothing.
  it("answers a bare check-in after the owed turn, without the carry-on order the asked-only lines forbid", () => {
    const joined = VOICE_TURN_TAKING_LINES.join("\n");
    expect(joined.indexOf("A bare check-in")).toBeGreaterThan(joined.indexOf("left nothing to answer"));
    expect(joined).toContain("volunteer nothing else");
    expect(joined).not.toContain("carry on from what");
    expect(joined).not.toContain("'I'm here'");
  });

  // A walk's "one sec" while the thinking model works asks nothing, and the walk lines owe the owner
  // the next item unasked, so a "hello?" there would have met the bare check-in order alone.
  it("keeps an open walk carrying on after a check-in, since a walk is a run the owner asked for", () => {
    const joined = VOICE_TURN_TAKING_LINES.join("\n");
    expect(joined).toContain(
      "An\nopen walk (below) is such an ask: there, say you are still there, then the next item once the thinking model\nhands it to you.",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "A word while it works ('one sec') is fine only once you have handed it off.",
    );
    expect(TALK_VOICE_INSTRUCTIONS.indexOf("A walk: whenever")).toBeGreaterThan(
      TALK_VOICE_INSTRUCTIONS.indexOf("open walk (below)"),
    );
  });
});
