/**
 * The greeting lines the voice carries, asserted as data: what reaches `realtime.prompt` is this file's subject, and
 * whether the realtime model follows it is the real call's (`desktop e2e --call --only call-live`).
 */
import { describe, expect, it } from "vitest";

import { COLLEAGUE_GREETING_VOICE_LINES } from "../../../talk/colleagueGreetingLines.js";
import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../talk/sessionConfig.js";

const GREETING = COLLEAGUE_GREETING_VOICE_LINES.join("\n");

describe("COLLEAGUE_GREETING_VOICE_LINES", () => {
  // The voice once opened a call with "Hi there. I'm ChatGPT. You can talk things through with me, …".
  it("forbids an unasked introduction, a product name and a list of what the voice can do", () => {
    expect(COLLEAGUE_GREETING_VOICE_LINES.length).toBeGreaterThan(0);
    expect(GREETING).toContain(
      "Unless the owner asks what you are or what you can do, never introduce yourself, never call yourself ChatGPT,\n" +
        "OpenAI, Codex, an assistant or any other product, and never list what you can do",
    );
  });

  // "Are you ChatGPT?" is the owner's ask, so the ban is on volunteering, never on answering.
  it("answers straight when the owner asks what the voice is", () => {
    expect(GREETING).toContain("; asked, answer them straight.");
  });

  it("answers a greeting-only opening in a few words, with no question", () => {
    expect(GREETING).toContain(
      "When the owner opens the call with only a greeting ('hello', 'hey', 'morning'), greet them back in a few words, as\n" +
        "someone picking up with a colleague, and add no question.",
    );
  });

  // An exception scoped to one quiet left the next quiet, after a check-in's "yep, here", to the turn-taking line
  // that gives the voice the turn. The whole opening is the owner's until they say why they called, so no quiet in
  // it, however many checks, falls to that line.
  it("keeps every quiet of the opening the owner's until they say why they called, however often the line is checked", () => {
    expect(GREETING).toContain(
      "Until the owner says why they called, the call is theirs to\nopen: every quiet before then is theirs and never yours to fill",
    );
    expect(GREETING).toContain(
      "gets a word or two that you hear them ('yep, here') and nothing more, however often they check.",
    );
    expect(GREETING).toContain(
      "The turn-taking lines below that give you the turn after a quiet,\n" +
        "or carry a check-in on from the last words, start once the owner has said why they called.",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain("When your last turn left nothing to answer, the next turn is yours");
  });

  // A meeting starting mid-opening is a line the console has the voice speak.
  it("leaves a console-spoken line free to land in the opening's quiet", () => {
    expect(GREETING).toContain(
      "never yours to fill with words of your own (a line the console has\nyou speak is still said as given)",
    );
  });

  // "You there? What's two plus two?" is a check AND an ask; only a bare check is cut short.
  it("answers the ask in a check that carries one, rather than cutting it to a word", () => {
    expect(GREETING).toContain("A check\nthat also asks something gets that answered.");
  });

  it("rides the voice's prompt right after its persona, and never the thinking model's", () => {
    const persona = "Bar a quote, match the owner's energy; if they swear, be casual back.";
    expect(TALK_VOICE_INSTRUCTIONS).toContain(`${persona}\n${GREETING}\n\n`);
    expect(TALK_BACKEND_INSTRUCTIONS.includes(GREETING)).toBe(false);
  });
});
