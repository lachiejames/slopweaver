import { describe, expect, it } from "vitest";

import { untilTranscriptStill } from "../../../../../cli/commands/desktop/e2eCallAnswerSettle.js";
import { goLiveBaseline, hangUp, isIdle, isLive, withinCap } from "../../../../../cli/commands/desktop/e2eCallPage.js";
import type { VoiceView } from "../../../../../cli/commands/desktop/e2eCallView.js";
import { type E2eRow, liveSnapshotOf } from "../../../../../desktop/e2eCallRows.js";

/**
 * A voice window as a set of what shows: a live call whose card a click into another app folded to the orb, which
 * the orb's press brings back.
 *
 * @param folded whether the card starts folded
 * @param call whether a call is up behind it
 * @returns the view and the selectors it was clicked on
 */
function voiceWindow({ call, folded }: { call: boolean; folded: boolean }): { view: VoiceView; clicks: string[] } {
  const state = { folded };
  const clicks: string[] = [];
  const showing = ({ selector }: { selector: string }): boolean => {
    if (!call) {
      return selector.includes('"open the voice') || selector.includes('"talk"');
    }
    if (state.folded) {
      return selector.includes(": open the voice");
    }
    return selector.includes('"mute"') || selector.includes('"hang up"');
  };
  const view = {
    click: async ({ selector }: { selector: string }) => {
      clicks.push(selector);
      state.folded = false;
      return true;
    },
    page: undefined,
    shows: async ({ selector }: { selector: string }) => showing({ selector }),
  } as unknown as VoiceView;
  return { clicks, view };
}

/**
 * A voice window whose live snapshots answer in turn from a script, the last answer repeating.
 *
 * @param reads each read's settled rows, `undefined` for a page that could not be read
 * @param unsettled how many rows each read saw still being heard
 * @returns the view
 */
function readsInTurn({
  reads,
  unsettled = 0,
}: {
  reads: readonly (readonly E2eRow[] | undefined)[];
  unsettled?: number;
}): VoiceView {
  const at = { next: 0 };
  return {
    readLive: async () => {
      const read = reads[Math.min(at.next, reads.length - 1)];
      at.next += 1;
      if (read === undefined) {
        return undefined;
      }
      return { rows: read, unsettled };
    },
  } as unknown as VoiceView;
}

const STANDING: readonly E2eRow[] = [
  { text: "Read the draft back", who: "owner" },
  { text: "Sure.", who: "voice" },
];

// A failed baseline read taken as none counted every row standing at go-live as new. Read again, it took the owner's
// turn and the voice's answer landing after go-live as standing.
describe("goLiveBaseline", () => {
  it("takes the one read straight after go-live, never a later one that may hold rows landing after it", async () => {
    expect([
      await goLiveBaseline({ capMs: 5000, view: readsInTurn({ reads: [STANDING, []] }) }),
      await goLiveBaseline({ capMs: 5000, view: readsInTurn({ reads: [undefined, STANDING] }) }),
    ]).toEqual([STANDING, undefined]);
  });

  it("answers no baseline at all when the page never answers by the cap", async () => {
    expect(await goLiveBaseline({ capMs: 0, view: readsInTurn({ reads: [undefined] }) })).toBe(undefined);
  });

  it("takes a page that answers with no rows as none", async () => {
    expect(await goLiveBaseline({ capMs: 5000, view: readsInTurn({ reads: [[]] }) })).toEqual([]);
  });

  // A row on screen but still being heard at go-live was hidden from the baseline, then
  // settled and read as new.
  it("answers no baseline when the snapshot saw a row still being heard, never reading again", async () => {
    expect(
      await goLiveBaseline({ capMs: 5000, view: readsInTurn({ reads: [STANDING, STANDING], unsettled: 1 }) }),
    ).toBe(undefined);
  });
});

describe("liveSnapshotOf", () => {
  it("keeps the settled rows the owner's or the voice's, and counts the ones still being heard", () => {
    expect(
      liveSnapshotOf({
        raw: [
          { final: "true", medium: null, text: "Read the draft back", who: "owner" },
          { final: "true", medium: null, text: "Sure.", who: "voice" },
          { final: "false", medium: null, text: "draft th", who: "owner" },
          { final: "false", medium: null, text: "stray", who: null },
        ],
      }),
    ).toEqual({ rows: STANDING, unsettled: 1 });
  });
});

/** A voice window whose every row read hangs, the renderer frozen mid-evaluate. */
const FROZEN = {
  readLive: async () => new Promise<never>(() => undefined),
  rows: async () => new Promise<never>(() => undefined),
} as unknown as VoiceView;

// `until` checks its cap only between reads, so a read that never resolved held the leg.
describe("a page read that never resolves", () => {
  it("cuts a wait off at the cap", async () => {
    const ran = { finished: false };
    await withinCap({
      capMs: 20,
      run: async () => {
        await new Promise<never>(() => undefined);
        ran.finished = true;
      },
    });
    expect(ran.finished).toBe(false);
  });

  // The cap is a hard cut, so a read that crosses it and then resolves is unseen.
  it("leaves a read that crosses the cap unseen, even once it resolves", async () => {
    const ran = { finished: false };
    await withinCap({
      capMs: 10,
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        ran.finished = true;
      },
    });
    expect(ran.finished).toBe(false);
  });

  // A read that blocks the event loop past the cap beats the cap's timer, so the clock,
  // read when the read returns, is what leaves it unseen.
  it("leaves a read returning past the cap unseen, even one that beat the cap's timer", async () => {
    const blocking = async (): Promise<readonly E2eRow[]> => {
      const until = performance.now() + 40;
      while (performance.now() < until) {
        // Busy: the event loop is held, so the cap's timer cannot fire before this read returns.
      }
      return STANDING;
    };
    const view = {
      readLive: async () => ({ rows: await blocking(), unsettled: 0 }),
      rows: blocking,
    } as unknown as VoiceView;
    expect([await goLiveBaseline({ capMs: 10, view }), await untilTranscriptStill({ capMs: 10, view })]).toEqual([
      undefined,
      undefined,
    ]);
  });

  // The cap's timer won during `until`'s pause, and the loop it never cancelled read
  // again ~500ms later.
  it("starts no read past the cap from the loop the cap's timer left running", async () => {
    const reads = { count: 0 };
    const view = {
      rows: async () => {
        reads.count += 1;
        return reads.count === 1 ? STANDING : [...STANDING, { text: "more", who: "owner" }];
      },
    } as unknown as VoiceView;
    await untilTranscriptStill({ capMs: 20, view });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(reads.count).toBe(1);
  });

  // A remaining duration re-based after a pause moved the leg's cap later.
  it("never settles past the caller's own deadline, whatever duration it is handed", async () => {
    const reads = { count: 0 };
    const view = {
      rows: async () => {
        reads.count += 1;
        return STANDING;
      },
    } as unknown as VoiceView;
    const settled = await untilTranscriptStill({ capMs: 5000, deadline: performance.now() - 1, view });
    expect([settled, reads.count]).toEqual([undefined, 0]);
  });

  it("leaves no baseline, and no settled rows, when the page froze", async () => {
    expect([
      await goLiveBaseline({ capMs: 20, view: FROZEN }),
      await untilTranscriptStill({ capMs: 20, view: FROZEN }),
    ]).toEqual([undefined, undefined]);
  });

  // The poll spending the leg's whole cap left a settle of 0ms, whose `until` still read once, so a row of the
  // owner's landing after the cap could fail the leg.
  it("reads nothing once the cap is spent, so no row after it can change the verdict", async () => {
    const reads = { count: 0 };
    const view = {
      rows: async () => {
        reads.count += 1;
        return STANDING;
      },
    } as unknown as VoiceView;
    expect([await untilTranscriptStill({ capMs: 0, view }), reads.count]).toEqual([undefined, 0]);
  });

  it("hands back the rows the settle last read, for the leg to judge rather than read past the cap", async () => {
    const view = { rows: async () => STANDING } as unknown as VoiceView;
    expect(await untilTranscriptStill({ capMs: 20, view })).toEqual(STANDING);
  });
});

describe("reading a call through a fold", () => {
  it("reads a folded live call as live, by unfolding it", async () => {
    const { clicks, view } = voiceWindow({ call: true, folded: true });
    expect([await isLive({ view }), clicks]).toEqual([true, ['button[aria-label*=": open the voice"]']]);
  });

  it("never reads a folded live call as idle", async () => {
    expect(await isIdle({ view: voiceWindow({ call: true, folded: true }).view })).toBe(false);
  });

  it("hangs up a folded call", async () => {
    const { clicks, view } = voiceWindow({ call: true, folded: true });
    expect([await hangUp({ view }), clicks]).toEqual([
      true,
      ['button[aria-label*=": open the voice"]', 'button[aria-label="hang up"]'],
    ]);
  });

  it("reads no call as not live and idle, pressing nothing", async () => {
    const { clicks, view } = voiceWindow({ call: false, folded: false });
    expect([await isLive({ view }), await isIdle({ view }), clicks]).toEqual([false, true, []]);
  });
});
