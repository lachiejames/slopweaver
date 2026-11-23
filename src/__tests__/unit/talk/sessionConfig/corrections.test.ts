/**
 * How the two prompts take a correction, a cut-in, a disagreement and an unclear annoyance: one plain line, the
 * console's progress line named only when listed, pushback once on evidence, and one short question never relayed.
 */
import { describe, expect, it } from "vitest";

import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../../talk/sessionConfig.js";

describe("the two prompts", () => {
  // The voice stacking apologies each time a slip happens reads as an apprentice's "sorry boss"; one plain line instead.
  it("takes a correction in one plain line with no apology, no recount of the slip and no promised review", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain("When the owner corrects you or points out a slip, never apologise");
    expect(TALK_VOICE_INSTRUCTIONS).toContain("no little speech about what you got wrong");
    expect(TALK_VOICE_INSTRUCTIONS).toContain("never that it was flagged, captured or sent to a review");
    expect(TALK_VOICE_INSTRUCTIONS).toContain("Say the corrected thing in\none plain line and carry on");
    expect(TALK_VOICE_INSTRUCTIONS).toContain("Never apologise for a wait either.");
    // A correction said with an unclear annoyance yields to that one question, as the backend's rule does.
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "unless the owner also said an answer annoyed them, cause unclear: then its one question (below) is your\nwhole turn.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "the answer opens on the corrected understanding or the\n  next action",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("never a sentence recounting\n  what you got wrong or why");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("nothing reads the call for that");
  });

  // The owner asks whether a cut-in is a bug in the codex API or in the setup, something the thinking model can
  // determine for itself.
  it("names the console's progress line as the likely cause when one reads as cutting in, only then, and says it is counted", () => {
    // The console no longer speaks a progress line, so the voice is never told it does; the thinking
    // model still reads older calls' cut-ins off `talk cut-ins`.
    expect(TALK_VOICE_INSTRUCTIONS).not.toContain("The console says its own progress lines");
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "When the owner says you cut off and started a different answer, finish the answer it cut, and do not guess a cause\nunless the thinking model hands you one.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("run talk cut-ins --since 1h");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("is most likely the console's own progress line spoken into");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "When none is listed, say the count saw none and do not guess a cause.",
    );
    expect(TALK_VOICE_INSTRUCTIONS).not.toContain("Sorry, this one's slow");
  });

  // Pushback is wanted when the owner is wrong; agreement by reflex is not.
  it("pushes back once, on evidence and with its reason, and never agrees by reflex or disagrees for show", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain("Never open on stock agreement ('Agreed', 'You're right'");
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "say so\nat once in one sentence with the reason, even if the owner sounds annoyed",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain("say what it covered and what is different.");
    expect(TALK_VOICE_INSTRUCTIONS).toContain("Once, never an argument, and never disagreement for its own sake");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "Push back on evidence: when the owner's words conflict with what a tool",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("say so in the FIRST sentence\n  with the evidence");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "Then the owner\n  decides, never re-argued. Never disagree to seem independent",
    );
  });

  // The best time to take a steer is right as the annoying thing happens, so the question comes at once.
  it("asks one short question at once when the owner is annoyed and the cause is unclear, and never relays it", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "ask one short question at once: the wording, the\nlength, or that you cut in?",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("one short question at once about which part");
    // "and nothing else" met a fleet-state question asked in the same turn, which goes first.
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "and nothing else, bar a measurement asked for in the same turn,\n  which goes before it, its offer waiting (the order below).",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "It is not a steer, so no relay; in a walk it is the\n  current question",
    );
  });
});
