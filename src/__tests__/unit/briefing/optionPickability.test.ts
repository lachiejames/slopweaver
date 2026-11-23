import { describe, expect, it } from "vitest";

import {
  changesWhatShips,
  scopeChangeRefusal,
  sentElsewhere,
  sentElsewhereRefusal,
} from "../../../briefing/optionPickability.js";

describe("sentElsewhere", () => {
  it("refuses the option that asked the owner to decide off numbers in a fold", () => {
    expect(sentElsewhere({ text: "Tell the supervisor D, decide per pull request off the numbers in the fold." })).toBe(
      "decide per pull request off the numbers",
    );
  });

  it("refuses the hold-and-go-read option four of the seven cards carried", () => {
    expect(sentElsewhere({ text: "Tell the supervisor hold, you will read the page first." })).toBe("read the page");
  });

  it("reaches a target with a word in front of it, which a determiner-only gap misses", () => {
    expect(sentElsewhere({ text: "Tell the supervisor hold, you will read the touch-seam page first." })).toBe(
      "read the touch-seam page",
    );
  });

  it("passes an option the owner can pick where it sits", () => {
    expect(
      sentElsewhere({ text: "Tell the supervisor A, wait until those sessions finish and restack then." }),
    ).toBeUndefined();
  });

  it("passes a bare hold, which sends the owner nowhere", () => {
    expect(sentElsewhere({ text: "Tell the supervisor hold." })).toBeUndefined();
  });

  it("passes an option that cites its evidence without making the owner go and read it", () => {
    expect(sentElsewhere({ text: "Tell the supervisor B, take the two drifted branches now." })).toBeUndefined();
  });

  it("names the phrase and what to do instead", () => {
    expect(sentElsewhereRefusal({ cell: "option D", phrase: "read the page" })).toBe(
      'option D cannot be picked where it sits — "read the page" sends the owner somewhere else to decide. An option ' +
        "is something the owner picks from the card alone. Put the fact that decides it above the fold, or drop the " +
        "option — `if silent` already covers the owner saying nothing.",
    );
  });
});

describe("changesWhatShips", () => {
  it("refuses the option that named its own defect in its own sentence", () => {
    expect(
      changesWhatShips({ text: "Tell the supervisor C, rebase each onto staging, three change what they ship." }),
    ).toBe("change what they ship");
  });

  it("refuses an option that would absorb a parent's commits", () => {
    expect(changesWhatShips({ text: "Rebase it and absorb the parent's three commits." })).toBe(
      "absorb the parent's three commits",
    );
  });

  it("passes an option that touches only a pull request's metadata", () => {
    expect(changesWhatShips({ text: "Remove the draft label and request review from Tobias." })).toBeUndefined();
    expect(changesWhatShips({ text: "Change the reviewer to somebody who owns that area." })).toBeUndefined();
  });

  it("passes an option that leaves the pull request alone entirely", () => {
    expect(changesWhatShips({ text: "Wait until those sessions finish and restack then." })).toBeUndefined();
  });

  it("names the phrase and says it is a different pull request", () => {
    expect(scopeChangeRefusal({ cell: "option C", phrase: "change what they ship" })).toBe(
      'option C would change what the pull request ships, with "change what they ship". That is a different ' +
        "pull request, not an option on this decision. Offer the routes that leave what it ships alone, and " +
        "say in `what` why the other one is not on the card.",
    );
  });
});
