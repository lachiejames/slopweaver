/**
 * Unit: `draft-read-back` reads only this call's rows. Carried history ending on a
 * turn of the owner's and a voice answer must not pass the scenario before the dictated prompt was heard.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DRAFT_READ_BACK_PROMPT } from "../../../desktop/e2eCallPlan.js";
import { E2E_LIVE_ROWS } from "../../../desktop/e2eCallRows.js";
import { DRAFT_TURN_WORD, draftTurnAndAnswer, rowsAfterBaseline } from "../../../desktop/e2eDraftReadBackRows.js";

const HISTORY = [
  { text: "Earlier question", who: "owner" as const },
  { text: "Earlier answer", who: "voice" as const },
];

/** A voice row reading a faithful draft back: a quoted body carrying both read-back words. */
const READ_BACK = 'Here\'s the draft: "The end to end test ran, no rush on your review."';

describe("draftTurnAndAnswer", () => {
  it("passes nothing on the live rows standing at go-live, a turn of the owner's and an answer though they hold", () => {
    expect(draftTurnAndAnswer({ baseline: HISTORY, rows: HISTORY })).toEqual({ ownerTurn: false, voiceAnswer: false });
  });

  it("passes the owner's dictated turn and the voice's read-back after go-live, whatever the case of 'Draft'", () => {
    const rows = [
      ...HISTORY,
      { text: "Um, can you Draft me a message", who: "owner" as const },
      { text: READ_BACK, who: "voice" as const },
    ];
    expect(draftTurnAndAnswer({ baseline: HISTORY, rows })).toEqual({ ownerTurn: true, voiceAnswer: true });
  });

  it("holds an answer that is not yet the last row, and a fresh turn that is not the dictated one", () => {
    const pending = [
      ...HISTORY,
      { text: "draft it", who: "owner" as const },
      { text: READ_BACK, who: "voice" as const },
      { text: "and?", who: "owner" as const },
    ];
    const other = [...HISTORY, { text: "Hello.", who: "owner" as const }, { text: READ_BACK, who: "voice" as const }];
    expect([
      draftTurnAndAnswer({ baseline: HISTORY, rows: pending }),
      draftTurnAndAnswer({ baseline: HISTORY, rows: other }),
    ]).toEqual([
      { ownerTurn: true, voiceAnswer: false },
      { ownerTurn: false, voiceAnswer: false },
    ]);
  });

  // "redrafting" carries "draft" as a substring, and "drafté" passes `\b`; neither is the word.
  it("matches 'draft' as a whole word only, in any script's neighbours, never 'redrafting' or 'drafté'", () => {
    const turn = ({ text }: { text: string }) =>
      draftTurnAndAnswer({
        baseline: [],
        rows: [
          { text, who: "owner" },
          { text: READ_BACK, who: "voice" },
        ],
      }).ownerTurn;
    expect([
      turn({ text: "I am redrafting this now" }),
      turn({ text: "Please use the drafté version" }),
      turn({ text: "Read the draft, then stop." }),
    ]).toEqual([false, false, true]);
  });

  // The page's 40-row window pushes the oldest baseline rows off the top, and slicing by the baseline's count would
  // slice the new rows away.
  it("finds the rows after go-live once the page's rolling window has dropped the oldest baseline rows", () => {
    const full = Array.from(
      { length: 40 },
      (_, at) => ({ text: `row ${at}`, who: at % 2 === 0 ? "owner" : "voice" }) as const,
    );
    const rolled = [
      ...full.slice(2),
      { text: "draft this", who: "owner" as const },
      { text: READ_BACK, who: "voice" as const },
    ];
    expect([
      rowsAfterBaseline({ baseline: full, rows: rolled }),
      draftTurnAndAnswer({ baseline: full, rows: rolled }),
    ]).toEqual([
      [
        { text: "draft this", who: "owner" },
        { text: READ_BACK, who: "voice" },
      ],
      { ownerTurn: true, voiceAnswer: true },
    ]);
  });

  it("counts every row new once the window has dropped the whole baseline, and none while it all still stands", () => {
    const fresh = [
      { text: "draft this", who: "owner" as const },
      { text: READ_BACK, who: "voice" as const },
    ];
    expect([
      rowsAfterBaseline({ baseline: HISTORY, rows: fresh }),
      rowsAfterBaseline({ baseline: HISTORY, rows: HISTORY }),
      rowsAfterBaseline({ baseline: [], rows: fresh }),
    ]).toEqual([fresh, [], fresh]);
  });

  it("never counts a standing row new: a new row repeating the baseline's tail at the seam is taken as standing", () => {
    const baseline = [
      { text: "draft it", who: "owner" as const },
      { text: READ_BACK, who: "voice" as const },
    ];
    const rows = [...baseline, ...baseline];
    expect(rowsAfterBaseline({ baseline, rows })).toEqual(baseline);
  });

  // A whole baseline's worth of identical new rows rolling it off reads as the baseline.
  it("takes new rows identical to a whole baseline rolled off as standing, so the leg fails rather than passes", () => {
    const baseline = [
      { text: "draft this", who: "owner" as const },
      { text: READ_BACK, who: "voice" as const },
    ];
    expect([rowsAfterBaseline({ baseline, rows: baseline }), draftTurnAndAnswer({ baseline, rows: baseline })]).toEqual(
      [[], { ownerTurn: false, voiceAnswer: false }],
    );
  });

  it("matches a word the dictated prompt actually says", () => {
    expect(DRAFT_READ_BACK_PROMPT.split(DRAFT_TURN_WORD).length - 1).toBe(2);
  });
});

// A path joined, never `new URL(<literal>, import.meta.url)`: knip reads that shape as an import and pulls the site
// page, and its `react`, into the root workspace as an unlisted dependency.
const HERE = dirname(fileURLToPath(import.meta.url));

// Carried history rendering after the go-live baseline would pass the leg, were it a row
// the leg reads. The page draws it as `earlier:` rows and the leg's selector takes only `live:` ones.
describe("E2E_LIVE_ROWS", () => {
  it("reads only the live call's settled rows, never the page's carried-history rows", () => {
    const page = readFileSync(join(HERE, "../../../../site/components/voice/StageHistory.tsx"), "utf8");
    expect(E2E_LIVE_ROWS).toBe('ol[aria-label="what was said"] li[data-row^="live:"][data-final="true"]');
    expect(page).toContain("{earlierRows.map((row) => {");
    expect(page).toContain("data-row={`earlier:${id}`}");
    expect(page).toContain("data-row={`live:${id}`}");
  });
});
