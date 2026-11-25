/*
 * Which of the owner's words keep the floor with the owner. Two waits and four steers are the plain cases; the rest
 * are the edges of each pattern.
 */
import { describe, expect, it } from "vitest";

import { asksInWordsToWait, asksToWait } from "../../lib/waitAsk";

describe("asksToWait", () => {
  it.each([
    "I could do the ABC-1 step myself, actually. One sec",
    "Moving on to the Acme rollout. Umm",
    "okay give me a minute",
    "hang on",
    "hold on, hold on.",
    "let me think about that",
    "just a moment",
    "bear with me",
    "wait",
    "the second one, and",
    "I was going to say, uh",
    "Hmm...",
  ])("keeps the floor with the owner after %j", (text) => {
    expect(asksToWait({ text })).toBe(true);
  });

  it.each([
    "Great, that works. You can go ahead and send that one, tagging the Acme launch channel.",
    "You can send something like that from my account",
    "Send it in drip feed style",
    "have a look at this thread now",
    "I think so",
    "however you like",
    "open the second card",
    "that was a minute ago",
    "",
  ])("hands the floor back after %j", (text) => {
    expect(asksToWait({ text })).toBe(false);
  });

  it("reads only the end, so a wait the owner talked past is not one", () => {
    const text = "one sec, okay, I've got it now. Send it in drip feed style and tag Ari when you post it";
    expect(asksToWait({ text })).toBe(false);
  });
});

// A tail before a resume that re-pitched the card the owner was reading.
const OWNER_READING_TAIL =
  "Um, I mostly use the Acme report so I never really opened this one before but " +
  "Anyway, that can wait for a later call, so let me just keep reading";

describe("asksToWait — the owner is still reading the card in front of them", () => {
  it.each([
    OWNER_READING_TAIL,
    "let me just keep reading",
    "Let me read this.",
    "let me finish reading the briefing",
    "I'm still reading",
    "I’m just still reading it",
    "I am reading the card",
    "Easy, easy, I'm still on the briefing",
    "I'm still on this one",
    "I'll keep reading",
    // Every continue-verb "let me" takes, "I'll" takes too.
    "I'll carry on reading.",
    "I'm going to continue reading the briefing",
    "let me go on reading",
    "Okay, I'm gonna just keep reading the briefing.",
    "I'm not done; I'm still reading",
    // A negation in an earlier sentence settles nothing.
    "I'm not still reading. Actually, I'm still reading.",
    // A title that follows a name can end the sentence, so the reporting verb before it settles nothing.
    "She said she emailed John Smith Jr. I am still reading.",
    "Fair, I'd say that's right. I'm still reading.",
    // A polite "please" opens the owner's own clause like any other filler.
    "Please let me keep reading.",
    // A long sentence of the owner's own: an "I'd say" far back quotes nothing, and a clock time's colon is not a quote.
    "I'd say the first plan fits what we need better overall so let me just keep reading",
    // The owner's own "I'd say" inside the tail quotes nothing.
    "I'd say that's right, I'm still reading.",
    "I would say so, let me keep reading",
    "I'd say I'm still reading",
    // A quote's closing mark after its period closes the earlier sentence, never quotes the owner's own last one.
    'Ana said "Earlier." I\'m still reading.',
    "Ana said “Earlier.” I'm still reading.",
    "Ana said 'Earlier.' I'm still reading.",
    'Ana said: "(Read this!)" I’m still reading.',
    // An apostrophe after a letter of any script is the owner's own, never a quote opening.
    "Zoë's card, I'm still reading",
    "I’m still reading",
    "It's 3:30 and I have a meeting soon, so let me just keep reading",
    "Note for later: ask about the seat. Version 2.0 is fine, but let me keep reading",
    // A lead-in no list of clause openers names still leaves the words the owner's own.
    "At the moment I'm still reading the card.",
    // Any determiner with any of the card's nouns.
    "I'm still reading this briefing.",
    "I'm still on that page",
    "let me finish reading this section",
    "Honestly I'm still on the briefing",
    "okay please just let me read this",
    // The owner's own "I said" repeats the hold, never reports someone else's words.
    "Chill, I said I'm still reading",
    "Like I said, I'm still reading",
    "I just said I'm still on the briefing",
    // One word between "I" and the owner's own "said" or "say" leaves them the owner's.
    "I clearly said I’m still reading.",
    "I'd probably say I'm still reading",
    "I already clearly said I'm still reading.",
    // The 60-character cut once fell between "I" and "said".
    "I said this takes longer than I expected and I'm still reading",
    // The declared residue: a bare comma cannot tell an instruction from the owner's own aside, so it holds.
    "send it later, I'm still reading",
  ])("keeps the floor with the owner after %j, live and muted", (text) => {
    expect([asksToWait({ text }), asksInWordsToWait({ text })]).toEqual([true, true]);
  });

  it.each([
    "keep reading the next one",
    "read me the next card",
    "I'm reading it now, send it",
    "I'm not still reading",
    "Don't let me keep reading.",
    "do not let me keep reading this",
    "let me keep reading this, then send it",
    // A word in another script after the reading words is still a word.
    "I'm still reading עכשיו",
    "let me keep reading déjà",
    "you keep reading",
    // Said while the voice reads a card aloud, a bare "keep reading" tells it to go on.
    "Assistant, keep reading.",
    "Okay. Keep reading.",
    "just keep reading",
    // Reported speech is words for the voice to say, never the owner's hold.
    "Assistant, say: I'm still reading.",
    "tell Ana I'm still on the briefing",
    // Words that embed the owner's reading words in an instruction to the voice make them not the owner's own.
    "Assistant, let Ana know I'm still reading.",
    "can you check if I'm still reading",
    // A question is never the owner's hold, however far back it embeds their words.
    "Can you check whether at the moment I'm still reading?",
    "Do you know if I'm still on the briefing?",
    "I was reading the briefing earlier and it says to send it",
    // A colon or quote marks what follows as quoted, whatever the verb before it.
    "Assistant, message Ana: I'm still reading.",
    "post in the thread: uh I'm still on the briefing",
    'reply "I\'m still reading"',
    // The colon sits further back than the tail reaches, and still marks the sentence quoted.
    "Tell the reviewer: I checked the first section and the appendix and the final note well I'm still reading",
    "Post in channel 2: well I'm still reading.",
    "Post in the thread: Version 2.0 and I'm still reading",
    "Tell Dr. Smith I'm still reading.",
    "Tell Capt. Smith I'm still reading.",
    // The one told, or the one addressed, is a name in any script.
    "please tell 李 i'm still reading",
    "Tell Zoë I'm still on the briefing",
    "李, tell Dr. Alexandra Catherine Montgomery-Worthington I'm still reading.",
    // A straight quote after an even count of them opens the last sentence's quote, so it still marks it quoted.
    'Okay. "I\'m still reading."',
    // A question mark is still the end with closing marks after it.
    "(I’m still reading?)",
    // A trailing closing mark is still the last sentence's quote mark.
    "I’m still reading”",
    // Any opening quote mark, in any convention, marks what follows as quoted.
    "«I'm still reading",
    "reply „I'm still reading“",
    // An abbreviation's periods before a letter or comma end no sentence.
    "Send this: at 9 a.m., I am still reading",
    "She said at 9 a.m., I am still reading.",
    // A decimal's period is no sentence end, so the reporting verb before it still reaches the hold.
    "Okay, she said version 2.0 well I'm still reading",
    // A decomposed "Zöe" (o + U+0308) is one word, never two.
    "Zöe, tell the whole international launch channel and every design reviewer that after reading all of the appendix I'm still reading",
    // A sentence opening on a reporting verb is an instruction however far back the verb sits.
    "Tell Dr. Alexandra Catherine Montgomery-Worthington I'm still reading.",
    "message Ana, I'm still reading",
    "Jean-Luc, message the whole launch channel with these exact words well I'm still reading",
    "Assistant, message the whole launch channel and the design review thread that I'm still reading",
    "Ana said—'well I'm still reading'",
    "she said I'm still reading",
    "Acme said I'm still reading",
    "Message Dr. Smith: well I'm still reading",
    "Reply ‘well I am still reading’",
    "reply 'well I am still reading'",
    "Send this to the thread: I went through all of the first half and most of the appendix, I'm still reading",
  ])("hands the floor back after %j", (text) => {
    expect([asksToWait({ text }), asksInWordsToWait({ text })]).toEqual([false, false]);
  });
});

describe("asksInWordsToWait", () => {
  // Muted on a trailing "and", the floor is the owner's only if they asked for it in words.
  it("reads a trailing filler as no ask, and an explicit wait as one", () => {
    expect([
      asksInWordsToWait({ text: "Can you check the staging pool and" }),
      asksInWordsToWait({ text: "Moving on to the Acme rollout. Umm" }),
      asksInWordsToWait({ text: "I could do the ABC-1 step myself, actually. One sec" }),
      asksInWordsToWait({ text: "Hold on" }),
    ]).toEqual([false, false, true, true]);
  });

  // "Don't wait" and "Don't sit there and wait", then muted, must not hold the owner's turn forever.
  it("reads a bare trailing wait as no ask, since it tells the voice not to as often, and live as one", () => {
    expect([
      asksInWordsToWait({ text: "Don't wait" }),
      asksInWordsToWait({ text: "Don't sit there and wait" }),
      asksInWordsToWait({ text: "Please don't just wait." }),
      asksInWordsToWait({ text: "Okay, wait" }),
      asksToWait({ text: "Okay, wait" }),
    ]).toEqual([false, false, false, false, true]);
  });

  it("reads only the end, as asksToWait does", () => {
    expect(asksInWordsToWait({ text: "one sec, okay, I've got it now. Send it in drip feed style and tag Ari" })).toBe(
      false,
    );
  });

  // Each of these, then muted, must not hold the owner's turn forever.
  it("reads a wait phrase with a negation earlier in its sentence as no ask, muted or live", () => {
    expect([
      asksInWordsToWait({ text: "Don't hold on. Send it now." }),
      asksInWordsToWait({ text: "Don’t just hang on, go" }),
      asksInWordsToWait({ text: "No need to give me a sec" }),
      asksInWordsToWait({ text: "Do not under any circumstances hold on." }),
      asksInWordsToWait({ text: "Do not, please, hold on." }),
      asksToWait({ text: "Do not hold on" }),
    ]).toEqual([false, false, false, false, false, false]);
  });

  it("reads a wait phrase in a sentence after the negation as an ask", () => {
    expect([
      asksInWordsToWait({ text: "Don't send it. Hold on" }),
      asksInWordsToWait({ text: "Not yet! One sec" }),
      asksInWordsToWait({ text: "I'm not sure, hold on" }),
    ]).toEqual([true, true, false]);
  });
});
