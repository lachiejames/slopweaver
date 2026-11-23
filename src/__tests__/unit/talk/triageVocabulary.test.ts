import { describe, expect, it } from "vitest";

import { triageRulingOf } from "../../../cli/commands/talk/relayTriageArgs.js";
import { TRIAGE_BACKEND_LINES } from "../../../talk/triageLines.js";
import { TRIAGE_TOOLS } from "../../../talk/triageToolSchemas.js";
import {
  isTriageLabel,
  isTriageVerdict,
  TRIAGE_FEEDBACK,
  TRIAGE_LABELS,
  TRIAGE_VERDICTS,
  triageRulingLine,
  withTriageRuling,
} from "../../../talk/triageVocabulary.js";

describe("the triage words", () => {
  it("holds the owner's six verdicts and four labels, and knows each from anything else", () => {
    expect(TRIAGE_VERDICTS).toEqual([
      "send-it",
      "needs-more-info",
      "park-working-session",
      "park-slow-triage",
      "rewrite",
      "drop",
    ]);
    expect(TRIAGE_LABELS).toEqual(["waiting-on-them", "waiting-on-me", "come-back-to-it", "action-now"]);
    expect(isTriageVerdict("park-slow-triage")).toBe(true);
    expect(isTriageVerdict("action-now")).toBe(false);
    expect(isTriageLabel("come-back-to-it")).toBe(true);
    expect(isTriageLabel("send-it")).toBe(false);
  });

  it("spells a ruling for the chair, naming the park's place and the label in the owner's words", () => {
    expect(triageRulingLine({ ruling: { label: "waiting-on-me", verdict: "park-working-session" } })).toBe(
      "The owner's triage verdict on this card: park it for a working session with the owner — no act now; the " +
        "owner's Queue already draws the card parked below the rest, so settle this row and never talk restore it. " +
        "Label: waiting on me.",
    );
    // A card the owner does not want at all is dropped, never sent.
    expect(triageRulingLine({ ruling: { label: undefined, verdict: "drop" } })).toBe(
      "The owner's triage verdict on this card: drop it — the owner does not want this; nothing goes out on it: " +
        "drop or close what the card proposes.",
    );
    expect(triageRulingLine({ ruling: { label: undefined, verdict: "send-it" } })).toBe(
      "The owner's triage verdict on this card: send it — it is ready to go out as the card stands.",
    );
  });

  it("adds the ruling after the ask, and leaves an ask with no ruling byte for byte", () => {
    expect(withTriageRuling({ ask: "Steer.", triageRuling: undefined })).toBe("Steer.");
    expect(withTriageRuling({ ask: "Steer.", triageRuling: { label: "action-now", verdict: "needs-more-info" } })).toBe(
      "Steer. — The owner's triage verdict on this card: needs more info — find what is missing and put it on the " +
        "card. Label: action now.",
    );
  });

  it("marks a held relay's ruling NOT APPLIED, so the row never states it as taking effect", () => {
    const ruling = { label: undefined, verdict: "send-it" } as const;
    expect(withTriageRuling({ ask: "Steer.", held: true, triageRuling: ruling })).toBe(
      `Steer. — NOT APPLIED, the words may stop short of a no: ${triageRulingLine({ ruling })}`,
    );
  });
});

describe("TRIAGE_TOOLS", () => {
  it("is triage_next, taking only the owner's minutes, triage_end with no argument, then triage_clock, its state and minutes", () => {
    expect(TRIAGE_TOOLS.map((tool) => [tool.name, tool.kind])).toEqual([
      ["triage_next", "read"],
      ["triage_end", "read"],
      ["triage_clock", "preference"],
    ]);
    // The voice never picks a number: the length is the owner's, said in their own words, or absent.
    const minutes = {
      description:
        "how many minutes the owner named for this card's clock, in their own words ('ten on this one', 'give me " +
        "five'). Leave it out unless they said a number: never pick one for them. A whole number from 1 to 120.",
      maximum: 120,
      minimum: 1,
      type: "integer",
    };
    expect(TRIAGE_TOOLS.map((tool) => tool.parameters["properties"])).toEqual([
      { minutes },
      {},
      {
        minutes,
        state: {
          description: "paused or running, as the owner's words ask.",
          enum: ["paused", "running"],
          type: "string",
        },
      },
    ]);
  });

  // A voice that ended the pass to stop the clock, then skipped through ruled cards, is the failure this pins.
  it("tells the model never to skip ahead with triage_next, nor to end the pass to stop the clock", () => {
    const [next, end] = TRIAGE_TOOLS.map((tool) => tool.description);
    expect(next).toContain(
      "It can open the card on the owner's screen, Slack thread included, so call it once per card the owner moves " +
        "on from — never several in a row to skip ahead or find your place: the pass already skips every card the " +
        "owner has seen, bar one the owner sent back that is back rewritten.",
    );
    expect(end).toContain(
      "The owner's place is kept for half an hour: a triage_next inside it picks up at the next card the owner has " +
        "not seen, or one the owner sent back now back rewritten; " +
        "past it, a fresh pass walks the Queue as it then stands, leaving out every card the owner ruled whose words " +
        "have not changed. Never call it to stop or pause the clock — " +
        "when the owner wants longer on a card, just stay on it; the clock speaks once a card.",
    );
    expect(TRIAGE_BACKEND_LINES.slice(-7)).toEqual([
      "- 'Give me a minute', 'extend the timer', 'let me re-read it', with no length named: stay on the card and",
      "  say nothing more of the clock — it speaks once a card. Never triage_end to stop it. For half an hour",
      "  after triage_end the pass keeps its place, in this call or the next: one triage_next brings the next unseen card, or",
      "  one sent back now back rewritten, never another already ruled, so never call triage_next several times in a",
      "  row — each one can open that card and its Slack thread on screen.",
      "- Opening any other card mid-pass stops the clock; triage_next returns to the pass.",
      "- With onOwnerScreen false because of switchOff, say its words once in the pass and read the card aloud.",
    ]);
  });

  // A request for the next cue card once began a pass and a clock the owner never asked for.
  it("starts a pass only on an ask to triage, and sends 'the next card' outside one to action_items and open_card", () => {
    const [next] = TRIAGE_TOOLS.map((tool) => tool.description);
    expect(next).toContain(
      "call it ONLY when the owner says it is triaging time or asks to triage, and again for each next card of that " +
        "pass. 'The next card' outside a pass is not triage: that is action_items and open_card, with no clock, and " +
        "a pass the owner did not ask for is refused.",
    );
    expect(next).not.toMatch(/go through (?:his|their|the owner['’]s) queue quickly/iu);
    expect(TRIAGE_BACKEND_LINES.slice(0, 3)).toEqual([
      "- Triage pass ('it's triaging time', 'let's triage'): a walk (above) over the owner's Queue that triage_next",
      "  carries, ONLY when they name triage. 'The next card', 'next queue card' outside a pass is not triage:",
      "  action_items and open_card, no clock; triage_next refuses a pass the owner did not ask for.",
    ]);
  });

  // A recap of the pass at the owner's stop was a count nobody asked for.
  it("ends the pass in a few words and keeps what it came to for when the owner asks", () => {
    const [, end] = TRIAGE_TOOLS.map((tool) => tool.description);
    expect(end).toContain("Say in a few words that it ended, and what it came to only when the owner asks.");
    expect(end).not.toContain("Say that in two short sentences.");
  });
});

describe("triageRulingOf", () => {
  it("takes a verdict with or without a label, and nothing when neither flag was given", () => {
    const problems: string[] = [];
    const base = { about: "act:ev-9", feedback: undefined, otherRuling: false, problems };
    expect(triageRulingOf({ ...base, label: "come-back-to-it", triage: "park-slow-triage" })).toEqual({
      label: "come-back-to-it",
      verdict: "park-slow-triage",
    });
    expect(triageRulingOf({ ...base, label: undefined, triage: "rewrite" })).toEqual({
      label: undefined,
      verdict: "rewrite",
    });
    expect(triageRulingOf({ ...base, label: undefined, triage: undefined })).toBe(undefined);
    expect(problems).toEqual([]);
  });

  it("refuses an empty verdict, beside another ruling, onto the running list", () => {
    const problems: string[] = ["an earlier problem"];
    expect(
      triageRulingOf({
        about: "act:ev-9",
        feedback: undefined,
        label: undefined,
        otherRuling: true,
        problems,
        triage: "",
      }),
    ).toBe(undefined);
    expect(problems).toEqual([
      "an earlier problem",
      "--triage must be one of send-it, needs-more-info, park-working-session, park-slow-triage, rewrite, drop, got nothing",
      "talk relay carries one ruling per turn: --triage, --candidate or --covers, never two",
    ]);
  });

  it("carries the owner's named feedback beside a verdict that sends the card back", () => {
    const problems: string[] = [];
    const base = { about: "post:sd-FIXTURE", label: undefined, otherRuling: false, problems };
    expect(triageRulingOf({ ...base, feedback: "no-receipts", triage: "needs-more-info" })).toEqual({
      feedback: "no-receipts",
      label: undefined,
      verdict: "needs-more-info",
    });
    expect(triageRulingOf({ ...base, feedback: "not-at-a-glance", triage: "rewrite" })).toEqual({
      feedback: "not-at-a-glance",
      label: undefined,
      verdict: "rewrite",
    });
    expect(problems).toEqual([]);
  });

  it("refuses feedback beside a verdict that sends the card, a class outside the set, and feedback with no verdict", () => {
    const problems: string[] = [];
    const base = { about: "post:sd-FIXTURE", label: undefined, otherRuling: false, problems };
    expect(triageRulingOf({ ...base, feedback: "no-receipts", triage: "send-it" })).toBe(undefined);
    expect(triageRulingOf({ ...base, feedback: "too-long", triage: "rewrite" })).toBe(undefined);
    expect(triageRulingOf({ ...base, feedback: "no-receipts", triage: undefined })).toBe(undefined);
    expect(problems).toEqual([
      "--feedback names what to fix on a card the owner sent back, so it rides only beside --triage needs-more-info or rewrite",
      "--feedback must be one of no-receipts, not-at-a-glance, got too-long",
      "--feedback rides only beside --triage: what was wrong with the card the owner sent back",
    ]);
  });

  it("spells the feedback on the row, so the chair reads what to fix", () => {
    expect(
      triageRulingLine({ ruling: { feedback: "no-receipts", label: undefined, verdict: "needs-more-info" } }),
    ).toBe(
      "The owner's triage verdict on this card: needs more info — find what is missing and put it on the card. " +
        "What was wrong: it made a claim with no receipt — no link to where the owner can see it, no screenshot of it.",
    );
    expect(TRIAGE_FEEDBACK).toEqual(["no-receipts", "not-at-a-glance"]);
  });
});
