/**
 * Looking at the owner's screen: one frame per ask, read first and said, a corrected figure re-read, a region lifted only
 * when the owner asks to be shown, and a relay that carries only the frame a look took.
 */
import { describe, expect, it } from "vitest";

import { SCREEN_LOOK_BACKEND_LINES, SCREEN_LOOK_VOICE_LINES } from "../../../../talk/screenLookLines.js";
import {
  SCREEN_FOCUS_BACKEND_LINES,
  SCREEN_FOCUS_VOICE_LINES,
  SCREEN_TOOLS,
} from "../../../../talk/screenToolSchemas.js";
import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../../talk/sessionConfig.js";
import { TALK_TOOLS } from "../../../../talk/talkToolSchemas.js";

describe("TALK_TOOLS", () => {
  // The owner says when to look, and a relay with no frame taken this turn says no picture rather than attaching a
  // stale one.
  it("looks only when asked, one frame a look, and keeps looking only until the owner says stop", () => {
    const look = TALK_TOOLS.find((tool) => tool.name === "read_screen")!.description;
    expect(look).toContain("Call it only on the owner's ask: each call takes ONE frame, and the screen edge pulses");
    expect(look).toContain("An open share or a granted permission is never leave to look again");
    expect(look).toContain("take one frame each time they show you the next thing, and stop when they say so");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("One read_screen takes ONE frame, only on the owner's ask");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("nothing samples on a timer or on an app switch");
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "You look at the screen only when the owner asks: one look is one picture",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain("Switching apps never sends you another");
  });

  // Looking should be faster and more frequent, and the voice must say what it sees. Measured on one call: a look ask
  // at the tail of a long stretch reached read_screen 32s later, one turn ran read_card and board_row and never
  // looked, and an answer asked "What's glitching?" instead of saying what the frame showed.
  it("answers a look ask first wherever it sits, reads the screen before anything else and says what it sees", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "A look ask can come anywhere in what the owner says, the tail of a long stretch",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "hand the look over at once and answer it FIRST, never only the first half",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "is read, say what you see; never ask what to look at or what is wrong. When the look is at a card, what",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain("you see opens the answer and the linked page's detail follows it.");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "owner reading the screen out to you ('it says…', 'I'm looking at…'), makes read_screen your FIRST tool call,",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "alone, before open_card, read_card, board_row or anything else. Your first sentence names one concrete\n" +
        "  thing in the",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "wrong when the owner asked you to look: say what you see and what stands out. Never answer a look ask without a frame:",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("if read_screen is refused, say the reason the refusal names.");
    // The frame the console steers in for the ask (`PlanCall.attachLook`) answers it; read_screen is for a newer look.
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "moment their words needed it'), that picture IS the frame for this ask: answer from it, read_screen only for a newer look.",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain(SCREEN_LOOK_VOICE_LINES.join("\n"));
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(SCREEN_LOOK_BACKEND_LINES.join("\n"));
  });

  // Agreeing is not knowing; a new screenshot is. The owner corrected a price the voice had read right and heard wrong
  // ("not eight hundred and seventy"), and the voice said "You're right, 770 dollars" 1 ms later with no frame taken.
  it("re-reads the screen when the owner corrects a figure, never agrees first, and says money in words", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "not eight seventy') — that is a look ask too: hand a look over at once and say nothing else first. Never agree\n" +
        "from memory: no 'you're right', no 'confirmed', no repeating the corrected figure before the new frame is read.\n" +
        "Then say what the new frame shows, and if it disagrees with the correction, say so plainly.",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "dollars'), never a symbol or short form such as A$: 'A$770' was heard as eight hundred and seventy.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "  from a frame taken on the correction — the console's, or read_screen when none came — never from the earlier\n" +
        "  one or from the owner's words. Your first sentence is what that frame shows; never 'you're right' or\n" +
        "  'confirmed' before it, and when it disagrees with the correction, say so plainly.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "  seventy Australian dollars'), never a symbol or short form such as A$.",
    );
  });

  // A highlight on the owner's own initiative gets annoying fast, so a region is lifted only when asked.
  it("lifts a region of the screen only when asked to show it, after a look on that ask, boxed in its pixels", () => {
    const focus = TALK_TOOLS.find((tool) => tool.name === "focus_screen")!;
    expect(focus.description).toContain("only after read_screen on that same ask, once per ask, never on your own");
    expect(focus.parameters["required"]).toEqual(["x", "y", "width", "height"]);
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "  Only when the owner asks to be shown, once per ask, never on your own initiative; if it is refused, say where in words.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("'show me' a page (not where something is on screen): browser_open");
    expect(TALK_VOICE_INSTRUCTIONS).toContain("Never offer to highlight anything, and never on your own.");
  });

  it("tells both the tool and the backend that a Slack link landing in the owner's Slack app is opened, never failed", () => {
    const open = TALK_TOOLS.find((tool) => tool.name === "browser_open")!;
    expect(open.description).toContain(
      "openedIn slack-desktop-app means it is in front of the owner, so never tell the owner it failed to open.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "  openedIn slack-desktop-app means it is on screen, so never say it failed to open.",
    );
  });

  it("carries the screen tools directly after read_screen, and every line on pointing to both models whole", () => {
    const names = TALK_TOOLS.map((tool) => tool.name);
    const after = names.indexOf("read_screen") + 1;
    expect(names.slice(after, after + SCREEN_TOOLS.length)).toEqual(["focus_screen"]);
    expect(SCREEN_TOOLS.map((tool) => tool.kind)).toEqual(["show"]);
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(SCREEN_FOCUS_BACKEND_LINES.join("\n"));
    expect(TALK_VOICE_INSTRUCTIONS).toContain(SCREEN_FOCUS_VOICE_LINES.join("\n"));
  });

  it("says a relay carries only the frame a look took, else no picture, and never takes its own", () => {
    const relay = TALK_TOOLS.find((tool) => tool.name === "relay_steer")!.description;
    expect(relay).toContain("The relay never takes a picture of its own");
    expect(relay).toContain("it says no picture");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("with none taken, the relay says no picture");
    expect([relay, TALK_BACKEND_INSTRUCTIONS].filter((text) => text.includes("fresh picture"))).toEqual([]);
    expect([relay, TALK_BACKEND_INSTRUCTIONS].filter((text) => text.includes("takes its own picture"))).toEqual([]);
  });
});
