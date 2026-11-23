/*
 * The voice's live edit of the open parked draft: the page aims every write — the card open on the owner's Queue, the
 * owner's latest turn, this call — and the model supplies only its reading, the words, or the version.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearDraftEdit,
  type DraftEditSeams,
  runDraftEditStart,
  runDraftWrite,
} from "../../components/voice/draftEditRun";
import type { DraftEditRow, TalkDraftWire } from "../../lib/draftEdit";
import type { HeardSegment } from "../../lib/voiceTranscript";

/** The parked draft on the card the owner has open. */
const HELD: DraftEditRow = {
  key: "post:sd-abc123",
  post: { actor: "me", editableText: "Can you look at the pool?", id: "sd-abc123", state: "held" },
};

/** The owner's words on the call, the last finished turn the owner's. */
const HEARD: readonly HeardSegment[] = [
  { final: true, id: "turn_A", text: "Make it  warmer\nand shorter", who: "owner" },
  { final: true, id: "turn_B", text: "Sure, editing it now.", who: "voice" },
];

/**
 * Seams over one open card whose post answers as given, recording every wire and every re-read.
 *
 * @param rows the Queue's rows
 * @param posted what the route answers
 * @returns the seams and what they saw
 */
function recording({
  rows = [HELD],
  posted = { out: '{"version":2}', outcome: "done" },
}: {
  rows?: readonly DraftEditRow[];
  posted?: Awaited<ReturnType<DraftEditSeams["post"]>>;
} = {}): { seams: DraftEditSeams; wires: TalkDraftWire[]; refreshed: number[] } {
  const wires: TalkDraftWire[] = [];
  const refreshed: number[] = [];
  return {
    refreshed,
    seams: {
      call: () => "call-1",
      open: () => "post:sd-abc123",
      post: async ({ wire }) => {
        wires.push(wire);
        return posted;
      },
      refresh: () => refreshed.push(1),
      rows: () => rows,
      segments: () => HEARD,
    },
    wires,
  };
}

beforeEach(() => {
  clearDraftEdit();
});

describe("runDraftEditStart", () => {
  it("answers the open draft's words and version, aimed by the page", () => {
    const { seams } = recording();
    const ran = runDraftEditStart({ args: { reading: ["Warmer opening", "Cut the second line"] }, seams });
    expect(ran).toEqual({
      answer: { text: "Can you look at the pool?", version: 1 },
      detail: "editing sd-abc123 at v1",
      refused: false,
    });
  });

  it("refuses a bot row, an empty reading, and a card that is not a parked draft", () => {
    const bot = recording({ rows: [{ ...HELD, post: { ...HELD.post!, actor: "bot" } }] });
    expect(runDraftEditStart({ args: { reading: ["x"] }, seams: bot.seams }).answer).toEqual({
      refused:
        "sd-abc123 posts as the bot, and only a draft that posts under the owner's identity can be edited live; re-record it",
    });
    expect(runDraftEditStart({ args: { reading: [] }, seams: recording().seams }).refused).toBe(true);
    const other = { ...recording().seams, open: () => "act:ev-9" };
    expect(runDraftEditStart({ args: { reading: ["x"] }, seams: other }).answer).toEqual({
      refused: "the owner has no parked Slack draft open: open its card first (open_card), then start the edit",
    });
  });
});

describe("runDraftWrite", () => {
  it("refuses a rewrite with no edit started, and posts nothing", async () => {
    const { seams, wires } = recording();
    const ran = await runDraftWrite({ args: { text: "New words" }, mode: "revise", seams });
    expect(ran.refused).toBe(true);
    expect(wires).toEqual([]);
  });

  it("posts the page's id, the owner's words and this call's anchor, never an id the model passed, then re-reads", async () => {
    const { seams, wires, refreshed } = recording();
    runDraftEditStart({ args: { reading: ["Warmer opening"] }, seams });
    const ran = await runDraftWrite({ args: { id: "sd-ffffff", text: "Hey, could you look?" }, mode: "revise", seams });
    expect(ran).toEqual({
      answer: { saved: true, sent: false, version: 2 },
      detail: "sd-abc123 now v2",
      refused: false,
    });
    expect(wires).toEqual([
      {
        anchor: "talk-call:call-1#turn_A",
        heard: "Make it warmer and shorter",
        id: "sd-abc123",
        mode: "revise",
        reading: ["Warmer opening"],
        text: "Hey, could you look?",
      },
    ]);
    expect(refreshed).toEqual([1]);
  });

  it("spends a saved edit, so the owner's next ask is started afresh", async () => {
    const { seams, wires } = recording();
    runDraftEditStart({ args: { reading: ["Warmer opening"] }, seams });
    await runDraftWrite({ args: { text: "One" }, mode: "revise", seams });
    const again = await runDraftWrite({ args: { text: "Two" }, mode: "revise", seams });
    expect(again.refused).toBe(true);
    expect(wires.length).toBe(1);
  });

  it("restores without a start, its reading the page's own", async () => {
    const { seams, wires } = recording({ posted: { out: '{"version":3}', outcome: "done" } });
    const ran = await runDraftWrite({ args: { version: 1 }, mode: "restore", seams });
    expect(ran.answer).toEqual({ saved: true, sent: false, version: 3 });
    expect(wires).toEqual([
      {
        anchor: "talk-call:call-1#turn_A",
        heard: "Make it warmer and shorter",
        id: "sd-abc123",
        mode: "restore",
        reading: ["Put v1 back"],
        version: 1,
      },
    ]);
  });

  it("says the verb's refusal and still re-reads, since an unknown outcome may have written", async () => {
    const { seams, refreshed } = recording({ posted: { outcome: "unknown", why: "timed out" } });
    const ran = await runDraftWrite({ args: { version: 1 }, mode: "restore", seams });
    expect(ran.answer).toEqual({ refused: "timed out" });
    expect(refreshed).toEqual([1]);
  });
});
