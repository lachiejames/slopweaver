/** {@link replayWindow}, {@link windowTrade} and {@link replayWindows} — pricing a window over a real trace. */
import { describe, expect, it } from "vitest";

import { type Measured } from "../../../measurement/status.js";
import type { CallContext, TranscriptCompaction } from "../../../sessions/compactionFold.js";
import {
  observedContextCeiling,
  replayWindow,
  replayWindows,
  type WindowRow,
  type WindowTrade,
  windowTrade,
} from "../../../sessions/compactionWindow.js";

/** One call in a trace. */
function call({
  contextTokens,
  cacheReadTokens,
  afterRealBoundary = false,
}: {
  contextTokens: number;
  cacheReadTokens: number;
  afterRealBoundary?: boolean;
}): CallContext {
  return { afterRealBoundary, cacheReadTokens, contextTokens };
}

/** A folded transcript carrying only the calls a replay reads. */
function transcript({ calls }: { calls: readonly CallContext[] }): TranscriptCompaction {
  return {
    boundaries: [],
    byModel: new Map(),
    calls,
    duplicates: 0,
    sidechainSkipped: 0,
    unreadable: 0,
  };
}

/** The value of a measured trade, or a throw naming why there was none. */
function tradeValue({ trade }: { trade: Measured<WindowTrade> }): WindowTrade {
  if (!trade.known) {
    throw new Error(`expected a trade, got: ${trade.why}`);
  }
  return trade.value;
}

/** A replay's row for one window, or a throw when the table has none. */
function rowAt({ rows, windowTokens }: { rows: readonly WindowRow[]; windowTokens: number }): WindowRow {
  const found = rows.find((row) => row.replay.windowTokens === windowTokens);
  if (found === undefined) {
    throw new Error(`no row for ${String(windowTokens)}`);
  }
  return found;
}

describe("replayWindow", () => {
  it("credits nothing for the call that CROSSES the window — that call is the one firing the compaction", () => {
    const replayed = replayWindow({
      postTokens: 10_000,
      transcripts: [transcript({ calls: [call({ cacheReadTokens: 30_000, contextTokens: 120_000 })] })],
      windowTokens: 100_000,
    });
    expect(replayed.compactions).toBe(1);
    expect(replayed.avoidedCacheReadTokens).toBe(0);
  });

  it("credits a later call's draw above the window once the simulation has shed", () => {
    const replayed = replayWindow({
      postTokens: 10_000,
      transcripts: [
        transcript({
          calls: [
            call({ cacheReadTokens: 0, contextTokens: 150_000 }),
            call({ cacheReadTokens: 100_000, contextTokens: 160_000 }),
          ],
        }),
      ],
      windowTokens: 100_000,
    });
    expect(replayed.compactions).toBe(1);
    expect(replayed.avoidedCacheReadTokens).toBe(60_000);
  });

  it("never credits more than the call's own cache read", () => {
    const replayed = replayWindow({
      postTokens: 10_000,
      transcripts: [
        transcript({
          calls: [
            call({ cacheReadTokens: 0, contextTokens: 150_000 }),
            call({ cacheReadTokens: 5_000, contextTokens: 160_000 }),
          ],
        }),
      ],
      windowTokens: 100_000,
    });
    expect(replayed.avoidedCacheReadTokens).toBe(5_000);
  });

  it("resets its own shed total at a REAL boundary, so the simulated context cannot go negative", () => {
    const calls = [
      call({ cacheReadTokens: 0, contextTokens: 400_000 }),
      call({ afterRealBoundary: true, cacheReadTokens: 0, contextTokens: 20_000 }),
      call({ cacheReadTokens: 0, contextTokens: 420_000 }),
    ];
    expect(
      replayWindow({ postTokens: 10_000, transcripts: [transcript({ calls })], windowTokens: 100_000 }).compactions,
    ).toBe(2);
  });

  it("counts how many transcripts ever reached the window, so a row's base is visible", () => {
    const replayed = replayWindow({
      postTokens: 10_000,
      transcripts: [
        transcript({ calls: [call({ cacheReadTokens: 0, contextTokens: 400_000 })] }),
        transcript({ calls: [call({ cacheReadTokens: 0, contextTokens: 50_000 })] }),
      ],
      windowTokens: 300_000,
    });
    expect(replayed.transcriptsReaching).toBe(1);
  });
});

describe("windowTrade", () => {
  it("prices the step out as tokens bought per extra compaction", () => {
    const trade = tradeValue({
      trade: windowTrade({
        looser: { avoidedCacheReadTokens: 1_000_000, compactions: 10, transcriptsReaching: 1, windowTokens: 400_000 },
        tighter: { avoidedCacheReadTokens: 3_000_000, compactions: 30, transcriptsReaching: 1, windowTokens: 300_000 },
      }),
    });
    expect(trade.extraCompactions).toBe(20);
    expect(trade.extraTokensAvoided).toBe(2_000_000);
    expect(trade.tokensPerExtraCompaction).toBe(100_000);
  });

  it("reports NOT MEASURED rather than an infinity when both windows fire the same count", () => {
    const trade = windowTrade({
      looser: { avoidedCacheReadTokens: 1_000_000, compactions: 10, transcriptsReaching: 1, windowTokens: 400_000 },
      tighter: { avoidedCacheReadTokens: 3_000_000, compactions: 10, transcriptsReaching: 1, windowTokens: 300_000 },
    });
    expect(trade.known).toBe(false);
  });
});

describe("replayWindows", () => {
  const transcripts = [
    transcript({
      calls: [
        call({ cacheReadTokens: 50_000, contextTokens: 150_000 }),
        call({ cacheReadTokens: 80_000, contextTokens: 250_000 }),
      ],
    }),
  ];

  it("refuses to price a window looser than the one that actually ran, even where a transcript reached it", () => {
    const rows = replayWindows({ postTokens: 10_000, ranAtTokens: 200_000, transcripts, windows: [100_000, 250_000] });
    expect(rowAt({ rows, windowTokens: 100_000 }).priceable.known).toBe(true);
    const loose = rowAt({ rows, windowTokens: 250_000 }).priceable;
    expect(loose.known).toBe(false);
    expect(loose.known === false ? loose.why : "").toContain("Move the window and compare two readings");
  });

  it("refuses a window NO transcript reached, whichever side of the compaction point it sits", () => {
    const rows = replayWindows({ postTokens: 10_000, ranAtTokens: 900_000, transcripts, windows: [600_000] });
    const bare = rowAt({ rows, windowTokens: 600_000 }).priceable;
    expect(bare.known).toBe(false);
    expect(bare.known === false ? bare.why : "").toContain("nothing here that window would have changed");
  });

  it("refuses the trade INTO an unpriceable neighbour, rather than reporting a free step out", () => {
    const rows = replayWindows({ postTokens: 10_000, ranAtTokens: 200_000, transcripts, windows: [100_000, 600_000] });
    const step = rowAt({ rows, windowTokens: 100_000 }).tradeVsNext;
    expect(step.known).toBe(false);
    expect(step.known === false ? step.why : "").toContain("cannot be priced from either end");
  });

  it("prices the tightest window first and steps outward", () => {
    const rows = replayWindows({ postTokens: 10_000, ranAtTokens: 500_000, transcripts, windows: [200_000, 100_000] });
    expect(rows.map((row) => row.replay.windowTokens)).toEqual([100_000, 200_000]);
    expect(rows[1]!.tradeVsNext.known).toBe(false);
  });
});

describe("observedContextCeiling", () => {
  it("is the largest context any counted call carried", () => {
    expect(
      observedContextCeiling({
        transcripts: [
          transcript({ calls: [call({ cacheReadTokens: 0, contextTokens: 120_000 })] }),
          transcript({ calls: [call({ cacheReadTokens: 0, contextTokens: 640_999 })] }),
        ],
      }),
    ).toBe(640_999);
  });

  it("is zero over a corpus with no counted calls at all", () => {
    expect(observedContextCeiling({ transcripts: [] })).toBe(0);
  });
});
