import { describe, expect, it } from "vitest";

import { fleetJargonRefusal, ungloss } from "../../../briefing/fleetJargon.js";

describe("ungloss", () => {
  it("names the fleet word a card used above the fold and never explained", () => {
    const found = ungloss({ aboveFold: "A settled ask still reads ready and the fill spawned it tonight." });

    expect(found?.term).toBe("settled");
    expect(found?.used).toBe("settled ask");
    expect(found?.plainly).toBe("a request of the owner's that has already been answered");
  });

  it("passes the same word once the card says what it means", () => {
    const aboveFold =
      "A settled ask is a request of yours that has already been answered, and one is still being offered.";

    expect(ungloss({ aboveFold })).toBeUndefined();
  });

  it("accepts a gloss that arrives AFTER the first use, because a card is not read one clause at a time", () => {
    const aboveFold = "The fill spawned it tonight. A fill scan is the pass that starts work nobody is holding.";

    expect(ungloss({ aboveFold })).toBeUndefined();
  });

  it("reads the fill SCAN as the fleet sense and a fill colour as ordinary English", () => {
    expect(ungloss({ aboveFold: "The fill spawned it tonight." })?.term).toBe("fill");
    expect(ungloss({ aboveFold: "The chart's fill colour is unreadable in the dark theme." })).toBeUndefined();
  });

  it("reads a board row as the fleet sense and a row in a table as ordinary English", () => {
    expect(ungloss({ aboveFold: "A finding row reaches a pull request only on your word." })?.term).toBe("row");
    expect(ungloss({ aboveFold: "The first row in the comparison table contains the failed check." })).toBeUndefined();
  });

  it("reads the loop's tick and sweep as the fleet sense, and a tick box or a sweep OF something as ordinary", () => {
    expect(ungloss({ aboveFold: "The next tick drops it." })?.term).toBe("tick");
    expect(ungloss({ aboveFold: "Each tick box on the form is unchecked." })).toBeUndefined();
    expect(ungloss({ aboveFold: "The sweep rebuilds it." })?.term).toBe("sweep");
    expect(ungloss({ aboveFold: "A sweep of the logs found nothing." })).toBeUndefined();
  });

  it("reads a workstream seam as the fleet sense and a seam in a screenshot as ordinary English", () => {
    expect(ungloss({ aboveFold: "The touch-seam page has the timeline." })?.term).toBe("seam");
    expect(ungloss({ aboveFold: "The seam session touched plan-four." })?.term).toBe("seam");
    expect(
      ungloss({ aboveFold: "The exported screenshot has a visible seam between the header and the content." }),
    ).toBeUndefined();
  });

  it("reads a waiver OF a gate as the fleet sense and a legal waiver as ordinary English", () => {
    expect(ungloss({ aboveFold: "568 landed with the waiver acknowledged." })?.term).toBe("waiver");
    expect(
      ungloss({ aboveFold: "Counsel's standard legal waiver shifts the risk to the vendor but adds one day." }),
    ).toBeUndefined();
  });

  it("keeps `reaper` bare, the one term with no ordinary reading a card would reach for", () => {
    expect(ungloss({ aboveFold: "The reaper closed it." })?.term).toBe("reaper");
  });

  it("accepts an em-dash gloss and a parenthetical one", () => {
    expect(ungloss({ aboveFold: "The reaper — the pass that closes a dead run — took it." })).toBeUndefined();
    expect(
      ungloss({ aboveFold: "It landed with a waiver (a recorded decision to skip a rule) on the gate." }),
    ).toBeUndefined();
  });

  it("reads a proof grade only beside landing language, so the gold standard is ordinary English", () => {
    expect(ungloss({ aboveFold: "Two branches would land silver tonight." })?.term).toBe("silver");
    expect(ungloss({ aboveFold: "It is the gold standard for this kind of page." })).toBeUndefined();
  });

  it("names the two phrases the owner's ruling quoted off a card, and passes a golden retriever", () => {
    const golden = ungloss({ aboveFold: "It needs 10 golden runs per case before it can land." })!;
    const batch = ungloss({ aboveFold: "Send the batch review ask to the three teams." })!;

    expect([golden.term, golden.used, golden.plainly]).toEqual([
      "golden",
      "golden runs",
      "a stored example question with the answer we expect",
    ]);
    expect([batch.term, batch.used]).toEqual(["batch review ask", "batch review ask"]);
    expect(ungloss({ aboveFold: "The ten-golden run passed." })?.used).toBe("ten-golden");
    expect(ungloss({ aboveFold: "A golden retriever sat by the desk at golden hour." })).toBeUndefined();
  });

  it("passes the batch review ask once the card says what it is", () => {
    const aboveFold = "A batch review ask is one message asking several people to review several pull requests.";

    expect(ungloss({ aboveFold })).toBeUndefined();
  });

  it("names the word, the phrase and the meaning in one refusal line", () => {
    const found = ungloss({ aboveFold: "The reaper closed it." })!;

    expect(fleetJargonRefusal({ cell: "the card", found })).toBe(
      'the card uses the fleet word "reaper" and never says what it means — "reaper" here is the sweep that ' +
        "closes a run whose session has died. Say what it means in the same breath, above the fold, or write " +
        "the card without the word.",
    );
  });

  it("passes a card written without any of the words", () => {
    const aboveFold =
      "Three of the four Claude logins on this machine have expired. Signing one in is a browser window.";

    expect(ungloss({ aboveFold })).toBeUndefined();
  });
});
