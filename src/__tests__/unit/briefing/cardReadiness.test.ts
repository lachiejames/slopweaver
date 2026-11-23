/**
 * The readiness criterion, one case each.
 *
 * The phrase the owner's own screenshot carried is asserted verbatim, because it is the
 * measurement this rule exists for — a criterion that stopped catching that card would be a rule that had
 * quietly stopped doing its job while every other test still passed.
 *
 * The negatives matter as much as the positives here, and more than they do for `./ownHandAction.test.ts`:
 * this criterion is deliberately NARROW, so the cases it must leave alone are part of the contract rather
 * than a courtesy.
 */
import { describe, expect, it } from "vitest";

import { readinessRefusal, sessionStillWorking, waitingAboveReadyRefusal } from "../../../briefing/cardReadiness.js";

describe("sessionStillWorking", () => {
  it("catches the card the owner screenshotted, verbatim", () => {
    expect(
      sessionStillWorking({
        text:
          "You will not put it in front of anyone yet. The chain of four is not a native stack, and the " +
          "Problem section shows no proof or origin. The session is adopting the four into one native stack " +
          "and rewriting the Problem section to lead with the origin.",
      }),
    ).toBe("The session is adopting");
  });

  it("catches the four verbs the owner named themselves", () => {
    expect(sessionStillWorking({ text: "The session is measuring the cost." })).toBe("The session is measuring");
    expect(sessionStillWorking({ text: "The session is building the page." })).toBe("The session is building");
    expect(sessionStillWorking({ text: "The session is adopting the stack." })).toBe("The session is adopting");
    expect(sessionStillWorking({ text: "The session is rewriting the section." })).toBe("The session is rewriting");
  });

  it("binds an actor to its verb across an adverb of incompleteness", () => {
    expect(sessionStillWorking({ text: "The session is still measuring the query cost." })).toBe(
      "The session is still measuring",
    );
    expect(sessionStillWorking({ text: "That run is now landing the fix." })).toBe("That run is now landing");
  });

  it("reads a qualified actor as one actor", () => {
    expect(sessionStillWorking({ text: "An Opus session is reworking the roster." })).toBe(
      "An Opus session is reworking",
    );
    expect(sessionStillWorking({ text: "The query-layer session is porting slice one." })).toBe(
      "The query-layer session is porting",
    );
  });

  it("leaves a report of work that has FINISHED alone", () => {
    expect(sessionStillWorking({ text: "The session landed it as pull request 496." })).toBeUndefined();
    expect(sessionStillWorking({ text: "The session adopted the four into one native stack." })).toBeUndefined();
  });

  it("leaves a consequence of the owner's own answer alone", () => {
    expect(
      sessionStillWorking({ text: "The query-layer session respawns fresh on your word this tick." }),
    ).toBeUndefined();
    expect(sessionStillWorking({ text: "The session opens the consent tab on that paste." })).toBeUndefined();
  });

  it("leaves a steady state alone, because a session that is running is still answerable", () => {
    expect(sessionStillWorking({ text: "The listener session is running and has missed no tag." })).toBeUndefined();
  });

  it("needs a fleet actor, so an ordinary progressive sentence passes", () => {
    expect(sessionStillWorking({ text: "The gate is measuring every field above the fold." })).toBeUndefined();
  });
});

describe("the refusals", () => {
  it("names the cell, the phrase and the shape that replaces it", () => {
    expect(readinessRefusal({ cell: "what", phrase: "The session is adopting" })).toBe(
      'what says a session is still working, with "The session is adopting", while the card declares itself ' +
        'ready for your word. Declare `"readiness": { "state": "waiting", "session": "…", "event": "…" }` so ' +
        "the card ranks below the ones you can answer now, or reword the `what` to report work that has " +
        "finished.",
    );
  });

  it("names both positions when a waiting card outranks a ready one", () => {
    expect(waitingAboveReadyRefusal({ card: 1, ready: 3 })).toBe(
      "card 1 waits on a session and ranks above card 3, which you can answer now. Every ready card comes " +
        "first; the waiting ones sit under their own heading below.",
    );
  });
});
