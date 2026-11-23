/*
 * What the voice's grammar reads as a promise of work it has not started (`voicePromised`, `voicePromiseOf`,
 * `site/lib/voiceOwed.ts`), and which shape: a turn that is nothing but the promise, or an answer that ends on one. The
 * page's own press over such a promise is `voicePlanStall.test.ts`'s.
 */
import { describe, expect, it } from "vitest";

import { voicePromised, voicePromiseOf } from "../../lib/voiceOwed";

/**
 * A measured call: the voice answered, then closed on this line, verbatim, and nothing was checking. The answer before
 * it is shaped like that turn's.
 */
const INCIDENT_CLOSE = "Let me check how callers are actually choosing modules.";
const ANSWERED = "The picker reads the config first, then falls back to the default list.";

/**
 * A measured call: a Codex turn wrote "…I haven't established whether your earlier answer was missed or that check
 * failed." and completed; the voice said it and closed on "I'll keep digging." 15.4s later, with nothing running, until
 * the owner pointed out nothing was being done. Repro:
 * `grep -n "keep digging" $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`.
 */
const DIGGING_ANSWER =
  "Fresh reads can still show stale questions. I don't yet know if your earlier answer was missed.";

describe("a promise of work the voice has not started", () => {
  it("reads a promise off the whole turn, never off a work word inside a statement", () => {
    expect(
      [
        "Right. Let me check those. One sec.",
        // A promise clause standing alone is still a whole promise.
        "Checking.",
        "Sure, one sec.",
        "Okay, having a look.",
        "Got it, one moment.",
        "Sure, give me a moment.",
        "One sec, pulling up the rest of it.",
        "I’ll pull it up.",
        "On it.",
        "Mm-hm.",
        "Good, yeah, that's clear.",
        "Sure, give me a moment. The bot says that key has mostly gone quiet since October third.",
        "It depends on it.",
        "There is a one second delay.",
        "I see what you mean.",
        "Look at that result.",
        "The checking account is closed.",
        // A tag asks the owner, with or without the "?" a transcript drops.
        "Let me check that for you, okay",
        "One sec, is that alright.",
        "I'll pull it up, yeah?",
        "Let me check that, shall I",
        "Let me check that shall I",
        "Let me check that, if you like",
        // A question anywhere in the turn, with or without its "?".
        "Do you want me to pull it up? One sec.",
        "Do you want me to pull it up. One sec.",
        "Tell me which channel. One sec.",
        "Let me check those… The bot says that key has gone quiet since October third.",
        "Let me check those the bot says that key has gone quiet since October third.",
        "Let me check those the bot says no.",
        "Let me check the channel it is quiet",
        "Let me check that will you",
        "Let me check the channel seems quiet.",
        "Let me check that huh",
        // A promise whose object is a short phrase stays one, punctuated or not.
        "Let me check which channel you mean",
        "Okay, let me pull those Slack messages up for you.",
      ].map((text) => voicePromised({ text })),
    ).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  it("reads an answer that ENDS on a promise of work as a promise, the incident's closing line above all", () => {
    expect(
      [
        `${ANSWERED} ${INCIDENT_CLOSE}`,
        INCIDENT_CLOSE,
        `${ANSWERED} I'll look into why the deploy failed.`,
        `${ANSWERED} Okay, I will investigate the retry path.`,
        // An earlier sentence may ask; only the last one counts here.
        `Is it the staging pool? ${ANSWERED} Let me find out whether it shipped.`,
        `${ANSWERED} Let me check alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima.`,
        // An embedded "whether" is no condition put to the owner.
        `${ANSWERED} Let me check if the deploy shipped.`,
        // A clause saying which logs carries its own verb.
        "The deploy is healthy. I'll check the logs that are failing.",
        // A particle with an object after it is still work.
        "The deploy is healthy. I'll check out the logs.",
        // A clause saying when carries its own verb too.
        "The rollout is stable. I'll check the logs before it is deployed.",
        // A work verb with no object is the barest promise of all.
        "The build is green. Let me check.",
      ].map((text) => voicePromised({ text })),
    ).toEqual([true, true, true, true, true, true, true, true, true, true, true]);
  });

  it("never reads completed work, an offer, plain future explanation or an ending question as a terminal promise", () => {
    expect(
      [
        `${ANSWERED} I checked how callers are actually choosing modules.`,
        `${ANSWERED} I can check how callers are actually choosing modules.`,
        `${ANSWERED} I'll be honest, it is the slowest path we have.`,
        `${ANSWERED} Next the team will check the retry path.`,
        `${ANSWERED} Let me check how callers are actually choosing modules?`,
        `${ANSWERED} Should I check how callers are actually choosing modules`,
        `${ANSWERED} Let me know if that works.`,
        `${ANSWERED} I'll look into it if you want.`,
        // Work offered on a condition put to the owner is an offer wherever the condition sits.
        "The deployment is healthy. I'll check the logs if you'd like.",
        `${ANSWERED} Let me pull it up when you're ready.`,
        `${ANSWERED} I'll look into the retry path if that helps.`,
        `${ANSWERED} I'll check the logs if you want me to.`,
        // A one-word condition closing the sentence is an offer, whatever the word.
        "The deployment is healthy. I'll check the logs if desired.",
        `${ANSWERED} Let me pull the trace when convenient.`,
        "The deployment is healthy. I'll check the logs provided you approve.",
        `${ANSWERED} I'll pull the trace as long as you're okay with it.`,
        "The deployment is healthy. I'll check the logs with your permission.",
        // The closing word is a word as the object grammar counts one, hyphen and all.
        "The deployment is healthy. I'll check the logs if low-risk.",
        // A whole-turn promise conditioned on the owner is the same offer.
        "I'll check with your permission.",
        "Let me pull it up if you want.",
        // A condition clause closing on the owner has words between its opener and "you".
        "The deployment is healthy. I'll check the logs as long as that works for you.",
        `${ANSWERED} Let me pull the trace if that's okay with you.`,
        "The deployment is healthy. I'll check if this timing and revised approach suits you.",
        "The deployment is healthy. I'll check the logs as long as that works for you today.",
        // A bare "look", "find", "read" or "get" with a long object reads as a state.
        "The train leaves at eleven. I'll look tired tomorrow.",
        `${ANSWERED} I'll find it hard to say no.`,
        `${ANSWERED} I'll read that as a yes.`,
        `${ANSWERED} I'll get there by the end of the day.`,
        // A phrasal "check out" or "pull over" closing on when is a plan of the owner's day.
        "The hotel closes at ten. I'll check out tomorrow.",
        `${ANSWERED} I'll pull over.`,
        "The booking is sorted. I'll check out of the hotel at ten.",
        // Thirteen words past the opening is over the bound, however the sentence reads.
        `${ANSWERED} Let me check alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike.`,
        `${ANSWERED} Let me check how alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike.`,
        // An embedded question's opener counts toward the budget.
        `${ANSWERED} Let me check how alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima.`,
        // A promise followed by an answer is answered: the last sentence is the fact.
        `${INCIDENT_CLOSE} ${ANSWERED}`,
      ].map((text) => voicePromised({ text })),
    ).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("reads the digging, looking and still-on-it promises, whole or closing an answer", () => {
    expect(
      [
        "I'll keep digging.",
        "I will keep investigating the retry path.",
        "Let me dig deeper.",
        "I'll dig deeper into the trace.",
        "I'll keep looking.",
        "I'll keep looking through the logs.",
        "Still on it.",
        "I'm still on it.",
        `${DIGGING_ANSWER} I'll keep digging.`,
        `${ANSWERED} I'll keep looking.`,
        `${ANSWERED} Let me dig deeper into the retry path.`,
        `${ANSWERED} I'll dig deeper.`,
        `${ANSWERED} I will keep investigating.`,
        `${ANSWERED} Still on it.`,
      ].map((text) => voicePromised({ text })),
    ).toEqual([true, true, true, true, true, true, true, true, true, true, true, true, true, true]);
  });

  // "Dig into" alone is a plan of the voice's own as often as work for the owner.
  it("never reads a present habit, another's work, a state, an offer, a tag, a past or a bare 'dig into' as a digging promise", () => {
    expect(
      [
        "I keep digging into these results.",
        "The team will keep digging.",
        "I'll dig the garden deeper tomorrow.",
        "I'll keep looking tired tomorrow.",
        `${ANSWERED} I'll keep digging if you want.`,
        `${ANSWERED} I'll dig deeper, okay.`,
        `${ANSWERED} I was still on it yesterday.`,
        "I'll dig into dinner.",
        `${ANSWERED} Let me dig into the retry path.`,
        `${ANSWERED} The fleet is still on it.`,
      ].map((text) => voicePromised({ text })),
    ).toEqual([false, false, false, false, false, false, false, false, false, false]);
  });

  it("tells a promise that is the whole turn from one closing an answer", () => {
    expect([
      voicePromiseOf({ text: "I'll keep digging." }),
      voicePromiseOf({ text: "Let me check." }),
      voicePromiseOf({ text: "I'm still on it." }),
      voicePromiseOf({ text: `${DIGGING_ANSWER} I'll keep digging.` }),
      voicePromiseOf({ text: `${ANSWERED} ${INCIDENT_CLOSE}` }),
      voicePromiseOf({ text: `${ANSWERED} Still on it.` }),
      voicePromiseOf({ text: ANSWERED }),
    ]).toEqual(["whole-turn", "whole-turn", "whole-turn", "terminal", "terminal", "terminal", false]);
  });
});
