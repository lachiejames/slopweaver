/*
 * Which of the voice's sentences say it put a draft on the owner's running list. The first three positives are the only
 * first-person sentences of that shape the voice has said, word for word from a real call; the negatives
 * are the other three that mention the list, the console's own line, the correction, and the near misses a wrong
 * correction would come from.
 */
import { describe, expect, it } from "vitest";

import { RUNNING_LIST_LANDED_LINE } from "../../lib/talkPlanHeldRelease";
import { claimCorrectionSpeech } from "../../lib/talkPlanWords";
import { runningListClaimsOf } from "../../lib/talkRunningListClaims";

/**
 * The words of the sentences read as a claim.
 *
 * @returns each claim's words
 */
function claimed({ text }: { text: string }): readonly string[] {
  return runningListClaimsOf({ text }).map((claim) => claim.words);
}

describe("runningListClaimsOf", () => {
  it.each([
    "I've put a draft on your running list that covers secret exposure.",
    "I've put a revision on your running list that quotes lines and responds to them one at a time.",
    "I've put a new draft on your running list with each line quoted and answered individually.",
    "I put that on your running list.",
    "I have added it to your running list.",
    "I had put a draft on your running list.",
    "I've just added a draft to your running list.",
    "I've already put it onto your running list.",
    "Okay, I've put a draft on your running list.",
    "Sure, so I've added that to your running list.",
    "I've appended a draft to your running list.",
    "I've saved that on your running list.",
    "I've written it on your running list.",
    "I wrote that on your running list.",
    "I've left a draft on your running list.",
  ])("reads %s", (text) => {
    expect(claimed({ text })).toEqual([text]);
  });

  it.each([
    // The rest of what the voice has said about the list.
    "Sure, I'll add that to your running list.",
    "I'll read it and then draft a reply that follows your voice rules and put it on your running list.",
    "It's on your running list.",
    // What the console says, and what the correction says.
    RUNNING_LIST_LANDED_LINE,
    claimCorrectionSpeech({ claims: [{ kind: "running-list" }] }),
    // A question, a negation, a future, a modal.
    "Did I put that on your running list?",
    "I put that on your running list, right?",
    "I didn't put anything on your running list.",
    "I haven't put that on your running list.",
    "I've put nothing on your running list.",
    "I put off adding that to your running list.",
    "I've left it aside rather than add it to your running list.",
    "I wrote that you need to add it to your running list.",
    "I wrote a note about what's on your running list.",
    "I've put nothing but the final draft on your running list.",
    "I put that on your running list—actually, no, I didn't.",
    "I put that on your running list, or I meant to, but it isn’t there.",
    "I put that on your running list—actually, scratch that.",
    "I put that on your running list (scratch that).",
    "I put that on your running list, well, I tried to.",
    "I put it on your running list every time you ask.",
    "I've put a draft on your running list that cannot be there.",
    "I've put 0 drafts on your running list.",
    "I've put zero drafts on your running list.",
    'I\'ve put a draft on your running list — "actually, scratch that."',
    "I will put it on your running list.",
    "I could put it on your running list.",
    // Someone else's act, or one the sentence only conditions on.
    "You put that on your running list.",
    "The fleet put that on your running list.",
    "When I put it on your running list it will show up.",
    "If I put it on your running list you can copy it.",
    "You said I put it on your running list.",
    // Quoted, another list, a thing that is not a placing.
    'Ana said "I\'ve put a draft on your running list" earlier.',
    '"I\'ve put a draft on your running list," they said.',
    "«I've put a draft on your running list», they said.",
    "Okay, »I've put a draft on your running list.«",
    "Okay, «I've put a draft on your running list.»",
    // Opening on something that is not a word.
    "123, I put that on your running list.",
    '"You said" I put that on your running list.',
    "(I put that on your running list)",
    "I've put a draft on your todo list.",
    "I've read what is on your running list.",
    // Nothing to read.
    "",
    "Okay.",
  ])("does not read %s", (text) => {
    expect(claimed({ text })).toEqual([]);
  });

  it("reads a sentence after one that ended on a quotation, and one with a number in its object", () => {
    expect(claimed({ text: 'Ana said "done". I put that on your running list.' })).toEqual([
      "I put that on your running list.",
    ]);
    expect(claimed({ text: "I've put 2 drafts on your running list." })).toEqual([
      "I've put 2 drafts on your running list.",
    ]);
  });

  it("reads each sentence of a segment on its own, at its first person", () => {
    const text = " It's on your running list. Okay, I've put a draft on your running list. What do you think?";
    expect(runningListClaimsOf({ text })).toEqual([
      {
        kind: "running-list",
        start: text.indexOf("I've"),
        words: "Okay, I've put a draft on your running list.",
      },
    ]);
  });
});
