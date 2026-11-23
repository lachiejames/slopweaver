/**
 * The quoted-draft lines both Talk prompts carry, asserted as data: what reaches `realtime.prompt` and the thinking
 * model's instructions is this file's subject, and whether the realtime model follows it is the real call's
 * (`desktop e2e --call --only draft-read-back`).
 */
import { describe, expect, it } from "vitest";

import { CARD_TOOLS } from "../../../talk/cardToolSchemas.js";
import { COPY_OFFER_BACKEND_LINES, COPY_OFFER_VOICE_LINES } from "../../../talk/copyToolSchemas.js";
import { DRAFT_EDIT_BACKEND_LINES, DRAFT_EDIT_VOICE_LINES } from "../../../talk/draftToolSchemas.js";
import { HANDED_BACK_ANSWER_VOICE_LINES } from "../../../talk/handedBackAnswerLines.js";
import { OPEN_CARD_DRAFT_BACKEND_LINES, OPEN_CARD_DRAFT_VOICE_LINES } from "../../../talk/openCardDraftLines.js";
import { QUOTED_DRAFT_BACKEND_LINES, QUOTED_DRAFT_VOICE_LINES } from "../../../talk/quotedDraftLines.js";
import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../talk/sessionConfig.js";
import { SPOKEN_CLAIM_BACKEND_LINES } from "../../../talk/spokenClaimLines.js";

const QUOTED = QUOTED_DRAFT_VOICE_LINES.join("\n");
const QUOTED_BACKEND = QUOTED_DRAFT_BACKEND_LINES.join("\n");

describe("QUOTED_DRAFT_VOICE_LINES", () => {
  // A read-back after a dictation ending "concise and in my voice" must not take on the owner's register.
  it("says the voice is never the owner, 'in my voice' included: never their register, answer or reaction", () => {
    expect(QUOTED_DRAFT_VOICE_LINES).toEqual([
      "Never be the owner, even 'in my voice': a draft's words aside, never their register (um), answer or reaction.",
    ]);
  });

  // The persona's "Match the owner's energy" and the delivery line's "energy that matches theirs" met an angry
  // dictation read back "evenly as a quote", with no precedence between them. The persona's "if they swear, you can
  // be casual back" stood outside its quote exception.
  it("sets the owner's energy and casual swearing aside for a quote at the lines that match them, as a quote reads evenly", () => {
    expect([
      TALK_VOICE_INSTRUCTIONS.includes("Bar a quote, match the owner's energy; if they swear, be casual back."),
      TALK_VOICE_INSTRUCTIONS.includes("with the owner's energy bar a quote."),
      // Any owner word after it, so a rewritten "energy that matches the owner's" fails too.
      /energy that matches/iu.test(TALK_VOICE_INSTRUCTIONS),
    ]).toEqual([true, true, false]);
    expect(COPY_OFFER_VOICE_LINES.join("\n")).toContain("evenly as a quote");
  });

  // A card draft that itself says "Um, yeah, I think we should ship this" must be read
  // word for word, so the register ban names the draft's own words as outside it, before it names "um".
  it("exempts a draft's own words from the register ban, so a card draft saying 'um' is still read word for word", () => {
    expect(QUOTED.indexOf("a draft's words aside")).toBeLessThan(QUOTED.indexOf("(um)"));
    expect(QUOTED.indexOf("a draft's words aside")).toBeGreaterThan(-1);
    expect(OPEN_CARD_DRAFT_VOICE_LINES.join("\n")).toContain("say it word for word as handed, all of it");
  });

  // The release it was handed ended on the console's "It's on your running list, what do you think?". Quoting that
  // line in the voice's prompt made it how turns ended, so no question is quoted, and nothing
  // here orders saying or stopping, leaving where a running-list line goes to the copy-offer lines.
  it("quotes no question and orders no stop, so the copy-offer line keeps where a running-list line goes", () => {
    expect([QUOTED.includes("what do you think"), QUOTED.includes("then stop")]).toEqual([false, false]);
    expect(COPY_OFFER_VOICE_LINES.join("\n")).toContain("never as the way a turn ends.");
  });

  // A card draft "Um, yeah, I think we should ship this" is still read; reading is quoting, said evenly, and the
  // copy-offer lines keep WHEN.
  // The thinking model's frame hands the voice a whole draft the owner asked to hear, which the copy-offer lines'
  // "never read out whole" and "never read it" forbade unless they cover only an unasked one.
  // "make it warmer, then read the draft back" on a card met draft-edit's "Never read the new words out", so the
  // read-out line sets a card edit aside.
  it("leaves reading a draft to the draft lines, said evenly as a quote, and never-read only an unasked one", () => {
    const copyOffer = COPY_OFFER_VOICE_LINES.join("\n");
    expect(copyOffer).toContain("Read one out,\nevenly as a quote, when the owner asks to hear it, bar a card edit.");
    expect(DRAFT_EDIT_VOICE_LINES.join("\n")).toContain("Never read the new words out");
    expect([
      copyOffer.includes("is never read out whole unasked,"),
      copyOffer.includes("such a draft unasked, not saying it is on"),
      copyOffer.includes("is never read out whole,"),
    ]).toEqual([true, true, false]);
    expect(OPEN_CARD_DRAFT_VOICE_LINES.join("\n")).toContain("say it word for word as handed, all of it");
    expect(DRAFT_EDIT_VOICE_LINES.join("\n")).toContain("Never read the new words out");
  });

  // A frame the voice added broke the card-draft line's "nothing
  // before or after" and the handed-back answer's "say that answer and stop", so the frame is the thinking model's.
  it("adds no frame of its own, so it never breaks saying a handed-back answer and stopping", () => {
    expect([QUOTED.includes("The draft says"), QUOTED.includes("That's the draft")]).toEqual([false, false]);
    expect(HANDED_BACK_ANSWER_VOICE_LINES.join("\n")).toContain("say that answer and stop");
  });

  it("rides the voice's prompt between the copy-offer and draft-edit lines, and never the thinking model's", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      `${COPY_OFFER_VOICE_LINES.join("\n")}\n${QUOTED}\n${DRAFT_EDIT_VOICE_LINES[0]!}\n`,
    );
    expect(TALK_BACKEND_INSTRUCTIONS.includes(QUOTED)).toBe(false);
  });
});

describe("QUOTED_DRAFT_BACKEND_LINES", () => {
  // A card's draft keeps its block's shape and a change to one stays the draft-edit bullet's; an answer giving the
  // owner's reaction would hand the voice that reaction to say.
  // "draft this and read it back" met copy-offer's "never into your answer" and its
  // "at most one short line", so the bullet overrides both, "anyway, past one short line", for that ask.
  it("frames a draft the owner asks to hear in the answer, leaves a card's to its block, and never speaks for the owner", () => {
    expect(QUOTED_DRAFT_BACKEND_LINES).toEqual([
      "- A draft the owner asks to hear goes in your answer anyway, past one short line, whole, any id in words: 'The draft",
      // "make it warmer, then read the draft back" met "goes in your answer … whole", so a card draft the owner asks
      // changed never goes in it, read-back or not. A card opened this turn has no block, so its draft is read_card's,
      // whose description writes it verbatim, any id in words. "read me the draft and tell me if it's persuasive" met
      // the card's bare word-for-word rule, so only a card draft asked only to hear goes as its rule says; any other
      // is framed here, as every draft is.
      "  says:', its words, 'That's the draft.' (a card's asked only to hear: as its rule says; never draft-edit's). Never answer or react for the owner.",
    ]);
    // read_card's read, the one a card with no block this turn takes, allowed "Here it is:".
    expect(CARD_TOOLS.find((tool) => tool.name === "read_card")!.description).toContain(
      "say `draft` word for word but any id in words and nothing else, never a paraphrase.",
    );
    expect(COPY_OFFER_BACKEND_LINES.join("\n")).toContain("never into your answer");
    expect(COPY_OFFER_BACKEND_LINES.join("\n")).toContain("answer at most one short\n  line");
    expect(OPEN_CARD_DRAFT_BACKEND_LINES.join("\n")).toContain("SLOPWEAVER_OPEN_CARD_DRAFT block");
    expect(DRAFT_EDIT_BACKEND_LINES.join("\n")).toContain("draft_edit_start first");
  });

  // A request to draft an exact Slack message naming a commit hash and read it back
  // meets the id rule's "never put an id in it", so "whole" carries the id rule's own exception in the same breath.
  it("keeps 'whole' satisfiable beside the id rule: a draft's id goes in words", () => {
    expect(QUOTED_BACKEND.indexOf("any id in words")).toBe(QUOTED_BACKEND.indexOf("whole") + "whole, ".length);
    expect(SPOKEN_CLAIM_BACKEND_LINES.join("\n")).toContain("never put an id in it");
  });

  // A card whose draft names a commit hash meets the card block's
  // "verbatim" and the id rule together, so the card block carries the same exception for both of its kinds; the
  // voice's "word for word" then read as the card's own words, so it is what it was handed.
  it("keeps a card's verbatim draft satisfiable beside the id rule: both kinds put an id in words", () => {
    const card = OPEN_CARD_DRAFT_BACKEND_LINES.join("\n");
    expect(card).toContain("kind single: write its\n  draft verbatim but any id in words, and nothing else");
    expect(OPEN_CARD_DRAFT_VOICE_LINES.join("\n")).toContain("say it word for word as handed, all of it");
    expect(card).toContain("read A then B the same way,");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(card);
    // read_card's single-draft sentence carries the same exception.
    expect(CARD_TOOLS.find((tool) => tool.name === "read_card")!.description).toContain(
      "say `draft` word for word but any id in words",
    );
  });

  // "Make this warmer, then read me the draft" met the open-card read, which answers from
  // the old block with no tool call, so a read asking a change is left to draft-edit, whose new words are never read.
  // The precedence order's winning first clause still sent any card draft the owner asked to hear
  // to the open-card read, so it names only one they asked only to hear.
  // "read me the draft and tell me if it's persuasive" asks no change but not only to hear
  // it, and still met the open-card read's "nothing else", so the backend gate is "only", as the voice's is.
  it("leaves a card read that asks a change to the draft-edit bullet, never the old block", () => {
    expect(OPEN_CARD_DRAFT_BACKEND_LINES.join("\n")).toContain(
      "When those words ask only what that card's reply, draft or message says\n  ('read me the draft'), answer",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "card's draft the owner asked only to hear goes as the open-card draft rule says",
    );
    // The voice's own open-card and options lines carry the same gate.
    expect(OPEN_CARD_DRAFT_VOICE_LINES.join("\n")).toContain(
      "(they asked only what the reply, draft or\nmessage says)",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain("A card's draft asked only to hear this turn is read as its rule says");
    expect(DRAFT_EDIT_VOICE_LINES.join("\n")).toContain("Never read the new words out");
  });

  // It is the copy-offer bullet's one way into the answer, on the owner's ask to hear it.
  it("sits right after the copy-offer bullet whose 'read it out only when asked' it opens", () => {
    expect(COPY_OFFER_BACKEND_LINES.join("\n")).toContain("Read it out only when the owner asks to hear it.");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(`${COPY_OFFER_BACKEND_LINES.join("\n")}\n${QUOTED_BACKEND}\n`);
    expect(TALK_VOICE_INSTRUCTIONS.includes(QUOTED_BACKEND)).toBe(false);
  });
});
