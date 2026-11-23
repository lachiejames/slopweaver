/*
 * A relay naming other cards stands on the Queue read that found them current, so its answer names every register
 * that read could not deliver: a card-deferrals register unread could mean a card named
 * as current had already been deferred.
 */
import { describe, expect, it } from "vitest";

import { runTalkTool } from "../../components/voice/talkToolRun";
import type { ToolSeams } from "../../components/voice/talkToolRunTypes";
import { NO_ALIGNMENT_CARDS } from "../../lib/cardToolPlan";
import type { QueueRow } from "../../lib/queueRows";
import { seams, TOKEN } from "../talkToolSeams";

const DEFERRALS = { source: "card deferrals", why: "not measured" } as const;

/**
 * A relay_steer call, its Queue read leaving the given registers unread.
 *
 * @returns the tool's answer
 */
const relayed = async ({
  also,
  unread,
}: {
  also: readonly string[] | undefined;
  unread: readonly (typeof DEFERRALS)[];
}) => {
  const recording: ToolSeams = {
    ...seams({ relayed: { answer: {}, detail: "", refused: false } }),
    cards: () => ({
      alignment: NO_ALIGNMENT_CARDS,
      focuses: [],
      fromPath: "/queue",
      recentlyLeft: [],
      rows: [{ key: "ask:a" } as QueueRow],
      unread,
    }),
    relay: () => ({ answer: { landed: true }, detail: "relayed", refused: false }),
    servedCards: { read: () => new Set(["ask:a"]), write: () => undefined },
    view: () => ({ open: "ask:open-one", openBy: undefined, path: "/queue", shows: {}, title: "Queue" }),
  };
  const ran = await runTalkTool({
    answerId: undefined,
    name: "relay_steer",
    rawArguments: JSON.stringify({
      answers_open_card: true,
      outward: "none",
      say: "always split oversized files",
      ...(also === undefined ? {} : { also_answers: also }),
    }),
    requestId: TOKEN,
    seams: recording,
  });
  return ran.answer;
};

describe("a relay naming other cards names what its Queue read could not read", () => {
  it("names an unread register beside the relay's answer when also_answers named a card", async () => {
    expect(await relayed({ also: ["ask:a"], unread: [DEFERRALS] })).toEqual({ landed: true, unread: [DEFERRALS] });
  });

  it("names nothing when every register arrived, or when the relay named no other card", async () => {
    expect(await relayed({ also: ["ask:a"], unread: [] })).toEqual({ landed: true });
    expect(await relayed({ also: undefined, unread: [DEFERRALS] })).toEqual({ landed: true });
  });
});
