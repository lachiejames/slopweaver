import { describe, expect, it } from "vitest";

import type { VoiceView } from "../../../../../cli/commands/desktop/e2eCallView.js";
import { readDraftBack } from "../../../../../cli/commands/desktop/e2eDraftReadBackScenario.js";
import type { E2eRow } from "../../../../../desktop/e2eCallRows.js";

/** The rows on screen when the call went live: a turn of the owner's and an answer from an earlier exchange. */
const STANDING: readonly E2eRow[] = [
  { text: "Read the draft back", who: "owner" },
  { text: "Sure.", who: "voice" },
];
const DICTATED: E2eRow = { text: "Can you draft me a two line Slack message?", who: "owner" };
const QUOTED: E2eRow = { text: 'Here is the draft: "The end to end test ran, no rush on your review."', who: "voice" };
const LATE_TURN: E2eRow = { text: "Actually, wait.", who: "owner" };

/** Long enough for a baseline read, one poll and one settle read; short enough that the settle's stillness never comes. */
const CAP_MS = 200;

/**
 * A voice window whose go-live snapshot is `baseline` and whose row reads answer in turn from `reads`, the last
 * answer repeating.
 *
 * @param baseline the settled rows the go-live snapshot sees, `undefined` for a page that never answers
 * @param reads each later row read's rows
 * @returns the view, and how many row reads it served
 */
function voiceWindow({
  baseline,
  reads,
}: {
  baseline: readonly E2eRow[] | undefined;
  reads: readonly (readonly E2eRow[])[];
}): { view: VoiceView; served: { count: number } } {
  const served = { count: 0 };
  const view = {
    readLive: async () => (baseline === undefined ? undefined : { rows: baseline, unsettled: 0 }),
    rows: async () => {
      const read = reads[Math.min(served.count, reads.length - 1)]!;
      served.count += 1;
      return read;
    },
  } as unknown as VoiceView;
  return { served, view };
}

describe("readDraftBack", () => {
  it("proves the owner's dictated turn and the voice's quoted draft after it, judged again on the rows the settle last read", async () => {
    const { view } = voiceWindow({ baseline: STANDING, reads: [[...STANDING, DICTATED, QUOTED]] });
    expect(await readDraftBack({ capMs: CAP_MS, view })).toEqual({ ownerTurn: true, voiceAnswer: true });
  });

  // A turn of the owner's landing while the rows settle is the last row, not the voice's.
  it("fails the answer when a turn of the owner's lands after it while the rows settle", async () => {
    const { view } = voiceWindow({
      baseline: STANDING,
      reads: [
        [...STANDING, DICTATED, QUOTED],
        [...STANDING, DICTATED, QUOTED, LATE_TURN],
      ],
    });
    expect(await readDraftBack({ capMs: CAP_MS, view })).toEqual({ ownerTurn: true, voiceAnswer: false });
  });

  // A turn of the owner's and a voice row standing at go-live never pass before the prompt is heard.
  it("never passes on rows already standing at go-live, though they say draft and end on the voice", async () => {
    const { view } = voiceWindow({ baseline: STANDING, reads: [STANDING] });
    expect(await readDraftBack({ capMs: CAP_MS, view })).toEqual({ ownerTurn: false, voiceAnswer: false });
  });

  // A page with no baseline cannot tell what arrived after go-live, so nothing is read.
  it("reads no rows at all when the go-live snapshot never answers", async () => {
    const { view, served } = voiceWindow({ baseline: undefined, reads: [[DICTATED, QUOTED]] });
    expect([await readDraftBack({ capMs: CAP_MS, view }), served.count]).toEqual([
      { ownerTurn: false, voiceAnswer: false },
      0,
    ]);
  });
});
