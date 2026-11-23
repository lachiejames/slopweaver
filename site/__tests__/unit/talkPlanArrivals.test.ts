/*
 * The order things arrive on a voice call: the owner's utterances beginning and finishing, turns starting, messages
 * completing. What a message is stamped with is what says whether a turn could already have had the owner's words.
 */
import { describe, expect, it } from "vitest";

import { CallArrivals } from "../../lib/talkPlanArrivals";

describe("CallArrivals", () => {
  it("stamps a message with where the owner's newest finished utterance began, not where it finished", () => {
    const arrivals = new CallArrivals();
    arrivals.heard({ nowOpen: true, wasOpen: false, worded: false });
    arrivals.turnStarted({ turnId: "t-1" });
    arrivals.heard({ nowOpen: true, wasOpen: true, worded: false });
    arrivals.heard({ nowOpen: false, wasOpen: true, worded: true });
    expect(arrivals.wroteMessage({ turnId: "t-1" })).toEqual({ completedSeq: 4, heardBeganSeq: 1 });
    expect(arrivals.latestHeardDoneSeq()).toBe(3);
    expect([...arrivals.turnStarts()]).toEqual([["t-1", 2]]);
  });

  it("stamps nothing heard before the owner has finished an utterance with words in it", () => {
    const arrivals = new CallArrivals();
    arrivals.heard({ nowOpen: true, wasOpen: false, worded: false });
    arrivals.heard({ nowOpen: false, wasOpen: true, worded: false });
    expect(arrivals.wroteMessage({ turnId: "t-1" })).toEqual({ completedSeq: 2, heardBeganSeq: undefined });
    expect(arrivals.latestHeardDoneSeq()).toBe(undefined);
  });

  it("has a done with no delta before it begin where it finished, and a blank done forget the open start", () => {
    const arrivals = new CallArrivals();
    arrivals.heard({ nowOpen: true, wasOpen: false, worded: false });
    arrivals.heard({ nowOpen: false, wasOpen: true, worded: false });
    arrivals.heard({ nowOpen: false, wasOpen: false, worded: true });
    expect(arrivals.wroteMessage({ turnId: "t-1" })).toEqual({ completedSeq: 3, heardBeganSeq: 2 });
  });

  it("forgets an open start the transcript no longer holds open, so the next done begins where it finished", () => {
    const arrivals = new CallArrivals();
    arrivals.heard({ nowOpen: true, wasOpen: false, worded: false });
    arrivals.turnStarted({ turnId: "t-1" });
    // A taken resume, or the lost-done ceiling, closed it without a done: the transcript reads it as not open.
    arrivals.heard({ nowOpen: false, wasOpen: false, worded: true });
    expect(arrivals.wroteMessage({ turnId: "t-1" })).toEqual({ completedSeq: 4, heardBeganSeq: 3 });
  });

  it("renumbers an utterance still open when the voice is handed a release, and leaves a closed one alone", () => {
    const arrivals = new CallArrivals();
    arrivals.voiceHanded();
    arrivals.heard({ nowOpen: true, wasOpen: false, worded: false });
    arrivals.turnStarted({ turnId: "t-1" });
    arrivals.voiceHanded();
    arrivals.heard({ nowOpen: false, wasOpen: true, worded: true });
    expect(arrivals.wroteMessage({ turnId: "t-1" })).toEqual({ completedSeq: 5, heardBeganSeq: 3 });
  });

  it("numbers a start arriving after its own turn's message 0, and a replayed start not at all", () => {
    const arrivals = new CallArrivals();
    arrivals.wroteMessage({ turnId: "t-1" });
    arrivals.turnStarted({ turnId: "t-1" });
    arrivals.turnStarted({ turnId: "t-2" });
    arrivals.turnStarted({ turnId: "t-2" });
    expect([...arrivals.turnStarts()]).toEqual([
      ["t-1", 0],
      ["t-2", 2],
    ]);
  });
});
