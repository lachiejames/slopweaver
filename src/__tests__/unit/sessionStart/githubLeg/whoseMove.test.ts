/*
 * `githubWhoseMove`: whether a pull request is the owner's move, the named reviewer's, or nobody's — and why CodeRabbit
 * never decides it while an answered ask hands it back to the owner.
 */
import { describe, expect, it } from "vitest";

import { githubWhoseMove } from "../../../../sessionStart/githubLeg.js";
import { BOT_IDS, mention, NAMES, sixthOfSix, state } from "./fixtures.js";

describe("githubWhoseMove", () => {
  it("is the owner's on a pull request the owner lands, which nobody is ever asked to review", () => {
    const own = state({ recommendation: "self-merges" });
    expect(githubWhoseMove({ botIds: BOT_IDS, namesById: NAMES, state: own })).toEqual({ party: "owner" });
  });

  it("is the owner's while the pull request is still a draft", () => {
    const draft = state({ recommendation: "still-draft", undrafted: false });
    expect(githubWhoseMove({ botIds: BOT_IDS, namesById: NAMES, state: draft })).toEqual({ party: "owner" });
  });

  it("is nobody's, with the owner already acted, on a stacked pull request — so rule zero suppresses it", () => {
    expect(githubWhoseMove({ botIds: BOT_IDS, namesById: NAMES, state: sixthOfSix() })).toEqual({
      ownerAlreadyActed: true,
      party: "nobody",
    });
  });

  it("is the owner's while the pull request is blocked", () => {
    const blocked = state({ ci: "red", recommendation: "blocked" });
    expect(githubWhoseMove({ botIds: BOT_IDS, namesById: NAMES, state: blocked })).toEqual({ party: "owner" });
  });

  it("is the owner's when the Slack window cannot bound the absence of an ask", () => {
    const unbounded = state({
      recommendation: "unknown",
      slack: { asked: "unknown", asks: [], bounded: true, mentioned: "unknown", mentions: [], why: "window too short" },
    });
    expect(githubWhoseMove({ botIds: BOT_IDS, namesById: NAMES, state: unbounded })).toEqual({ party: "owner" });
  });

  it("never reads CodeRabbit, which is advisory and cannot make a pull request the owner's move", () => {
    // Gating on this would withhold real asks.
    const advisory = state({ codeRabbit: "changes-requested" });
    expect(githubWhoseMove({ botIds: BOT_IDS, namesById: NAMES, state: advisory })).toEqual({
      party: "other",
      who: "A Colleague",
    });
  });

  it("is the named reviewer's when somebody reachable was asked", () => {
    expect(githubWhoseMove({ botIds: BOT_IDS, namesById: NAMES, state: state() })).toEqual({
      party: "other",
      who: "A Colleague",
    });
  });

  it("is the owner's again once the reviewer answered, because the silence ended", () => {
    // MEASURED: three security pull requests read `already-asked` with a landed review, and
    // reading the recommendation alone produced "bump them, they have not answered" on all three.
    const answered = state({ bump: { kind: "replied", why: "they have replied, so there is nothing to chase" } });
    expect(githubWhoseMove({ botIds: BOT_IDS, namesById: NAMES, state: answered })).toEqual({ party: "owner" });
  });

  it("is still the reviewer's while the bump is only due, which is a real chase", () => {
    const due = state({
      bump: { eligibleSinceIso: "2026-08-30T00:00:00.000Z", kind: "due", silentSinceIso: "2026-08-29T00:00:00.000Z" },
      recommendation: "bump",
    });
    expect(githubWhoseMove({ botIds: BOT_IDS, namesById: NAMES, state: due })).toEqual({
      party: "other",
      who: "A Colleague",
    });
  });

  it("is the named reviewer's on a bump too", () => {
    const due = state({ recommendation: "bump" });
    expect(githubWhoseMove({ botIds: BOT_IDS, namesById: NAMES, state: due })).toEqual({
      party: "other",
      who: "A Colleague",
    });
  });

  it("is nobody's when the recommendation says to send an ask", () => {
    const noAsks = state({
      recommendation: "send-ask",
      slack: { asked: "no", asks: [], bounded: true, mentioned: "no", mentions: [], why: "" },
    });
    expect(githubWhoseMove({ botIds: BOT_IDS, namesById: NAMES, state: noAsks })).toEqual({
      ownerAlreadyActed: false,
      party: "nobody",
    });
  });

  it("is nobody's when the ask named nobody a bump could reach", () => {
    // Rule zero would otherwise sit the row with an empty string and print "sitting with  for 53h".
    const unreachable = mention({ counterpartId: "", isDirectMessage: true, tagged: [] });
    const withUnreachable = state({
      slack: { asked: "yes", asks: [unreachable], bounded: true, mentioned: "yes", mentions: [unreachable], why: "" },
    });
    expect(githubWhoseMove({ botIds: BOT_IDS, namesById: NAMES, state: withUnreachable })).toEqual({
      ownerAlreadyActed: false,
      party: "nobody",
    });
  });
});
