/*
 * A Queue tool reads the record fresh before it answers, never the page's held copy, and so does a relay checking `also_answers` against the cards on the owner's Queue; a relay naming
 * no other card costs no read.
 */
import { describe, expect, it } from "vitest";

import { runTalkTool } from "../../components/voice/talkToolRun";
import type { ToolSeams } from "../../components/voice/talkToolRunTypes";
import { unreadShown } from "../../lib/queueScreenVoice";
import { shownForVoice } from "../../lib/queueShownCounts";
import type { ActionItemsAnswer } from "../../lib/talkActionItems";
import { seams, TOKEN } from "../talkToolSeams";
import { askRow } from "./queueVoiceFixture";

/** An `action_items` answer listing no card. */
const EMPTY: ActionItemsAnswer = {
  beyondCap: { marked: false, more: false, parked: false },
  complete: true,
  context: "acme",
  cut: undefined,
  itemNames: [],
  items: [],
  observedAtIso: undefined,
  recentlyLeft: [],
  recentlyLeftBeyondCap: 0,
  recentlyLeftNames: [],
  shown: shownForVoice({ shown: unreadShown({ otherContext: "slopweaver", view: "all" }) }),
  top: undefined,
  unread: [],
  withheld: 0,
};

/**
 * Seams that log the record read and every read after it, in order.
 *
 * @param log where each read is written
 * @returns the seams
 */
function logging({ log }: { log: string[] }): ToolSeams {
  const card = { ...askRow(), key: "ask:acme-1" };
  return {
    ...seams({ relayed: { answer: { relayed: true }, detail: "relayed", refused: false } }),
    actionItems: () => {
      log.push("answer");
      return EMPTY;
    },
    cards: () => {
      log.push("cards");
      return {
        alignment: { acts: [], settled: [] },
        focuses: [],
        fromPath: "/queue",
        recentlyLeft: [],
        rows: [card],
        unread: [],
      };
    },
    readQueueRecord: async () => {
      log.push("record read");
      return { undrawnWhy: async () => undefined, within: ({ ask }) => ask() };
    },
    servedCards: { read: () => new Set(["ask:acme-1"]), write: () => undefined },
    view: () => ({ open: undefined, openBy: undefined, path: "/queue", shows: undefined, title: "Queue" }),
  };
}

describe("runTalkTool, the record read", () => {
  it("reads the record before action_items answers", async () => {
    const log: string[] = [];
    const ran = await runTalkTool({
      answerId: undefined,
      name: "action_items",
      rawArguments: "{}",
      requestId: TOKEN,
      seams: logging({ log }),
    });
    expect(ran.answer).toEqual(EMPTY);
    expect(log).toEqual(["record read", "answer"]);
  });

  it("reads the record before a relay checks also_answers against the owner's Queue", async () => {
    const log: string[] = [];
    const ran = await runTalkTool({
      answerId: undefined,
      name: "relay_steer",
      rawArguments: JSON.stringify({
        also_answers: ["ask:acme-1"],
        answers_open_card: false,
        outward: "none",
        say: "park it",
      }),
      requestId: TOKEN,
      seams: logging({ log }),
    });
    expect([ran.refused, ran.detail]).toEqual([false, "relayed"]);
    expect(log).toEqual(["record read", "cards"]);
  });

  it("names an unread overlay beside a card read_card found, which that overlay may withdraw", async () => {
    const unread = [{ source: "reviewer suggestions", why: "the voice record read did not answer within 20 s" }];
    const base = logging({ log: [] });
    const ran = await runTalkTool({
      answerId: undefined,
      name: "read_card",
      rawArguments: JSON.stringify({ key: "ask:acme-1" }),
      requestId: TOKEN,
      seams: { ...base, cards: () => ({ ...base.cards(), unread }) },
    });
    expect(ran.refused).toBe(false);
    expect((ran.answer as { unread: unknown }).unread).toStrictEqual(unread);
  });

  it("adds no unread field to a card read_card found over a whole read", async () => {
    const ran = await runTalkTool({
      answerId: undefined,
      name: "read_card",
      rawArguments: JSON.stringify({ key: "ask:acme-1" }),
      requestId: TOKEN,
      seams: logging({ log: [] }),
    });
    expect(ran.refused).toBe(false);
    expect("unread" in (ran.answer as object)).toBe(false);
  });

  it("makes no read for a relay naming no other card", async () => {
    const log: string[] = [];
    const ran = await runTalkTool({
      answerId: undefined,
      name: "relay_steer",
      rawArguments: JSON.stringify({ answers_open_card: false, outward: "none", say: "park it" }),
      requestId: TOKEN,
      seams: logging({ log }),
    });
    expect([ran.refused, ran.detail]).toEqual([false, "relayed"]);
    expect(log).toEqual([]);
  });
});
