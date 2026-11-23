/**
 * `recutText`, the substitution half of `briefing recut`: exact outputs for every rewrite, and the proof each
 * one retires — the term's own sense no longer matching afterwards.
 *
 * Four cases are regressions of the Python script it replaced, pinned so they cannot return: `ticks` became
 * `passs`, `fill scan` became `idle-work scan scan`, `landed the gold` became `landed the the strongest proof
 * available`, and `silver` and `bronze` both became the STRONGEST proof, which says the opposite of what they
 * mean.
 */
import { describe, expect, it } from "vitest";

import { recutText, ungloss } from "../../../briefing/fleetJargon.js";

describe("recutText", () => {
  it.each([
    ["This tick ran.", "This pass ran."],
    ["Every tick ran.", "Every pass ran."],
    ["The next ticks ran.", "The next passes ran."],
    ["The board row moved.", "The board entry moved."],
    ["The board rows moved.", "The board entries moved."],
    ["The row on the board moved.", "The entry on the board moved."],
    ["The board's rows moved.", "The board's entries moved."],
    ["The sweep ran.", "The refresh ran."],
    ["Each sweeps ran.", "Each refreshes ran."],
    ["The fill scan ran.", "The idle-work scan ran."],
    ["Two fill scans ran.", "Two idle-work scans ran."],
    ["The fill spawned it.", "The idle-work scan spawned it."],
    ["Tonight's fill picked it.", "Tonight's idle-work scan picked it."],
    ["A settled ask closed.", "A answered ask closed."],
    ["It was already settled.", "It was already answered."],
    ["The reaper closed it.", "The run closer closed it."],
    ["Both reapers ran.", "Both run closers ran."],
    // A `run` already in front of it is consumed, rather than doubled into "the run run closer".
    ["The run reaper closed it.", "The run closer closed it."],
    ["It landed gold.", "It landed the strongest proof available."],
    ["It landed the gold.", "It landed the strongest proof available."],
    ["It landed silver.", "It landed a weaker proof than the best available."],
    ["It landed a silver.", "It landed a weaker proof than the best available."],
    ["It landed bronze.", "It landed the weakest proof this repository records."],
    ["It landed an bronze.", "It landed the weakest proof this repository records."],
    // The grade's STRENGTH survives an anchor or bar: `proof anchor` would let any grade satisfy what
    // required gold, which is what the script it replaces did.
    ["A gold anchor is owed.", "A strongest-proof anchor is owed."],
    ["The silver bar held.", "The weaker-proof bar held."],
    ["A bronze anchor is owed.", "A weakest-proof anchor is owed."],
  ])("rewrites %j to %j", (before, after) => {
    expect(recutText({ text: before }).text).toBe(after);
  });

  it("leaves a grade that QUALIFIES a noun, rather than doubling that noun", () => {
    // The counterexample: the replacement phrase ends in "records", so substituting it in front
    // of the noun the grade qualified read "…this repository records records are archived."
    expect(recutText({ text: "The merged bronze records are archived." })).toEqual({
      counts: {},
      text: "The merged bronze records are archived.",
    });
    expect(recutText({ text: "It landed gold and the entry moved." }).text).toBe("It landed gold and the entry moved.");
  });

  it("can land its replacement beside the same word — named residue, not a defect", () => {
    // A substitution is text, not grammar. The meaning survives and the sentence reads awkwardly; the verb's
    // own header says so, and `--dry-run` shows a composer the change before anything is written.
    expect(recutText({ text: "Did the next tick pass?" }).text).toBe("Did the next pass pass?");
    expect(recutText({ text: "Did the sweep refresh the page?" }).text).toBe("Did the refresh refresh the page?");
  });

  it("leaves what the sense itself excludes: a tick box, a sweep of the room, the gold standard", () => {
    expect(recutText({ text: "Tick the tick box." }).text).toBe("Tick the tick box.");
    expect(recutText({ text: "A sweep of the room found nothing." }).text).toBe("A sweep of the room found nothing.");
    expect(recutText({ text: "It is the gold standard." }).text).toBe("It is the gold standard.");
  });

  it("keeps the case of the word it keeps, and lower-cases what it writes", () => {
    expect(recutText({ text: "This Tick ran." }).text).toBe("This pass ran.");
    expect(recutText({ text: "The Board Row moved." }).text).toBe("The Board entry moved.");
  });

  it("retires the term: its own sense no longer reports a use once rewritten", () => {
    const text = "The reaper ran each tick, the fill scan landed gold, and a settled ask closed a board row.";

    expect(ungloss({ aboveFold: text })?.term).toBe("settled");
    expect(ungloss({ aboveFold: recutText({ text }).text })).toBe(undefined);
  });

  it("counts every substitution by term", () => {
    expect(recutText({ text: "This tick and that tick, and the reaper." }).counts).toEqual({ reaper: 1, tick: 2 });
  });

  it("leaves seam and waiver alone, because no short phrase keeps their meaning", () => {
    const text = "The touch-seam session holds a merged waiver.";

    expect(recutText({ text })).toEqual({ counts: {}, text });
  });

  it("answers the same way on a second call, so no shared pattern carries state between strings", () => {
    const first = recutText({ text: "This tick ran." });
    const second = recutText({ text: "This tick ran." });

    expect(second).toEqual(first);
  });
});
