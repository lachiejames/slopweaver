/**
 * `foldWordingIssues` and the one-note projection under it: the fleet-word check `tick close` applies to the new
 * recent note's fold, asked at `tick fill`, with a rewrite offered only when re-judging it clears the refusal.
 */
import { describe, expect, it } from "vitest";

import { recentBlock } from "../../../briefing/sweepBlock.js";
import { recentNoteSectionIssues } from "../../../outbound/briefing/sectionQuality.js";
import { foldWordingIssues } from "../../../supervisor/tickFoldWording.js";

/** The refusal close prints for one unglossed fleet word in the new note's fold. */
function refusal({ used, term, plainly }: { used: string; term: string; plainly: string }): string {
  return (
    `"done since you last looked" uses the fleet word "${used}" and never says what it means — "${term}" here is ` +
    `${plainly}. Say what it means in the same breath, above the fold, or write the card without the word.`
  );
}

const PLAIN = { foldSummary: "Two merges landed.", sentences: ["The merge queue is clear."] };

/** What the registry says "gold" means, as the refusal prints it. */
const GOLD_PLAINLY = "a landing carrying the strongest proof that was available";

describe("recentNoteSectionIssues", () => {
  it("refuses a fold's fleet word at the path close names, with its rule", () => {
    const note = recentBlock({ input: { ...PLAIN, folds: ["The queue drained. This tick landed two merges."] } });
    expect(recentNoteSectionIssues({ note })).toEqual([
      {
        message: refusal({ plainly: "one pass of the supervisor's loop", term: "tick", used: "This tick" }),
        path: ["recent", 0, "detail"],
        rule: "fleet-jargon",
      },
    ]);
  });

  it("reports nothing for a plain fold", () => {
    const note = recentBlock({ input: { ...PLAIN, folds: ["The queue drained after the rebase landed."] } });
    expect(recentNoteSectionIssues({ note })).toEqual([]);
  });

  it("takes a gloss from the headline enclosing the fold", () => {
    const sentences = ["Each tick is one pass of the supervisor's loop."];
    const note = recentBlock({ input: { ...PLAIN, folds: ["This tick landed two merges."], sentences } });
    expect(recentNoteSectionIssues({ note })).toEqual([]);
  });
});

describe("foldWordingIssues", () => {
  it("reports nothing for plain folds", () => {
    expect(foldWordingIssues({ recent: { ...PLAIN, folds: ["The queue drained."] } })).toEqual([]);
  });

  it("offers only the one fold whose rewrite clears the level, never a glossed fold recut also changed", () => {
    const folds = ["The sweep closed it.", "The queue drained.", "This tick landed two merges."];
    const sentences = ["Each sweep is one pass over the open work."];
    expect(foldWordingIssues({ recent: { ...PLAIN, folds, sentences } })).toEqual([
      `folds: ${refusal({ plainly: "one pass of the supervisor's loop", term: "tick", used: "This tick" })}`,
      "  in plain words: --fold-at 2 --fold 'This pass landed two merges.'",
    ]);
  });

  it("offers a fold carrying a word close names only next as part of the set, since the level needs both", () => {
    const folds = ["The sweep closed it.", "The queue drained.", "This tick landed two merges."];
    expect(foldWordingIssues({ recent: { ...PLAIN, folds } })).toEqual([
      `folds: ${refusal({ plainly: "one pass of the supervisor's loop", term: "tick", used: "This tick" })}`,
      "  in plain words, applied together:",
      "    --fold-at 0 --fold 'The refresh closed it.'",
      "    --fold-at 2 --fold 'This pass landed two merges.'",
    ]);
  });

  it("offers the rewrites as one set when the phrase sits in two folds and neither alone clears it", () => {
    const folds = ["This tick landed.", "This tick drained the queue."];
    expect(foldWordingIssues({ recent: { ...PLAIN, folds } })).toEqual([
      `folds: ${refusal({ plainly: "one pass of the supervisor's loop", term: "tick", used: "This tick" })}`,
      "  in plain words, applied together:",
      "    --fold-at 0 --fold 'This pass landed.'",
      "    --fold-at 1 --fold 'This pass drained the queue.'",
    ]);
  });

  it("offers no rewrite for a fold holding a NUL, which no shell argument can carry", () => {
    const folds = ["This tick landed.\u0000 The rest."];
    expect(foldWordingIssues({ recent: { ...PLAIN, folds } })).toEqual([
      `folds: ${refusal({ plainly: "one pass of the supervisor's loop", term: "tick", used: "This tick" })}`,
    ]);
  });

  it("offers no rewrite for a fold opening --, which fill's flag parser reads as a missing value", () => {
    const folds = ["-- This tick landed."];
    expect(foldWordingIssues({ recent: { ...PLAIN, folds } })).toEqual([
      `folds: ${refusal({ plainly: "one pass of the supervisor's loop", term: "tick", used: "This tick" })}`,
    ]);
  });

  it("offers no rewrite at a fold index past the digits fill's --fold-at accepts", () => {
    const folds = [...Array.from({ length: 1000 }, () => "The queue drained."), "This tick landed two merges."];
    expect(foldWordingIssues({ recent: { ...PLAIN, folds } })).toEqual([
      `folds: ${refusal({ plainly: "one pass of the supervisor's loop", term: "tick", used: "This tick" })}`,
    ]);
  });

  it("offers the rewrite at the last index fill's --fold-at accepts", () => {
    const folds = [...Array.from({ length: 999 }, () => "The queue drained."), "This tick landed two merges."];
    expect(foldWordingIssues({ recent: { ...PLAIN, folds } })).toEqual([
      `folds: ${refusal({ plainly: "one pass of the supervisor's loop", term: "tick", used: "This tick" })}`,
      "  in plain words: --fold-at 999 --fold 'This pass landed two merges.'",
    ]);
  });

  it("quotes the rewrite so a shell passes a $ or a quote in the fold through exactly as it was judged", () => {
    const folds = ["This tick landed $X, the team's fix."];
    expect(foldWordingIssues({ recent: { ...PLAIN, folds } })).toEqual([
      `folds: ${refusal({ plainly: "one pass of the supervisor's loop", term: "tick", used: "This tick" })}`,
      String.raw`  in plain words: --fold-at 0 --fold 'This pass landed $X, the team'\''s fix.'`,
    ]);
  });

  it("offers no rewrite for a word recut has no substitution for", () => {
    const folds = ["568 landed with the waiver acknowledged."];
    expect(foldWordingIssues({ recent: { ...PLAIN, folds } })).toEqual([
      `folds: ${refusal({
        plainly: "a recorded decision to land without something a rule normally requires",
        term: "waiver",
        used: "waiver acknowledged",
      })}`,
    ]);
  });

  it("offers no rewrite when the refused word is one recut cannot replace, though another fold changed", () => {
    const folds = ["The touch-seam page has the timeline.", "This tick landed."];
    expect(foldWordingIssues({ recent: { ...PLAIN, folds } })).toEqual([
      `folds: ${refusal({
        plainly: "the boundary between two systems that an investigation is tracing",
        term: "seam",
        used: "touch-seam",
      })}`,
    ]);
  });

  it("offers no rewrite while another fleet word would still be refused after it", () => {
    const folds = ["This tick landed.", "568 landed with the waiver acknowledged."];
    expect(foldWordingIssues({ recent: { ...PLAIN, folds } })).toEqual([
      `folds: ${refusal({ plainly: "one pass of the supervisor's loop", term: "tick", used: "This tick" })}`,
    ]);
  });

  it("offers no rewrite that changes the named phrase while a second phrase of the same word stays", () => {
    const folds = ["Gold anchor passed, but gold proof remains."];
    expect(foldWordingIssues({ recent: { ...PLAIN, folds } })).toEqual([
      `folds: ${refusal({ plainly: GOLD_PLAINLY, term: "gold", used: "Gold anchor" })}`,
    ]);
  });
});
