/*
 * A settled Alignment act's refusal names every record source the card tool could not read: the settle
 * rests on the owner's own press, but the record read beside it may be partial, and "already settled" alone hid that.
 */
import { describe, expect, it } from "vitest";

import { readAutonomy } from "../../components/live/readAutonomy";
import { TOOL_OUTPUT_MAX, toolOutputOf } from "../../components/live/talkSession";
import { OPENING_WHY_MAX, type Opening } from "../../components/voice/openCardAnswer";
import { runOpenCard } from "../../components/voice/openCardRun";
import { runTalkTool } from "../../components/voice/talkToolRun";
import { FINDING_ACT_KIND } from "../../lib/queueActRow";
import { withCardsUnread } from "../../lib/voiceRecordQueue";
import { seams, TOKEN } from "../talkToolSeams";
import { FROM, NO_BRIEFING_EXPECTED, QUEUE, rows } from "./cardToolPlanFixture";

const BOARD = { source: "the board", why: "timed out" } as const;
const SETTLED = "act:acme-gone is an Alignment act the owner has already settled, so it is no longer open";

describe("a settled act's refusal names what the record read could not read", () => {
  it("names them through read_card, beside the settle, when another window settled it", async () => {
    const ran = await runTalkTool({
      answerId: undefined,
      name: "read_card",
      rawArguments: JSON.stringify({ key: "act:acme-gone" }),
      requestId: TOKEN,
      seams: {
        ...seams({ relayed: { answer: undefined, detail: "", refused: false } }),
        cards: () => ({
          alignment: { acts: [], settled: ["act:acme-gone"] },
          focuses: [],
          fromPath: FROM,
          recentlyLeft: [],
          rows: QUEUE,
          unread: [BOARD],
        }),
      },
    });
    expect([ran.refused, ran.detail, ran.answer]).toEqual([
      true,
      "act:acme-gone settled",
      { refused: SETTLED, unread: [BOARD] },
    ]);
  });

  it("says nothing is unread when every source arrived", async () => {
    const ran = await runTalkTool({
      answerId: undefined,
      name: "read_card",
      rawArguments: JSON.stringify({ key: "act:acme-gone" }),
      requestId: TOKEN,
      seams: {
        ...seams({ relayed: { answer: undefined, detail: "", refused: false } }),
        cards: () => ({
          alignment: { acts: [], settled: ["act:acme-gone"] },
          focuses: [],
          fromPath: FROM,
          recentlyLeft: [],
          rows: QUEUE,
          unread: [],
        }),
      },
    });
    expect(ran.answer).toEqual({ refused: SETTLED });
  });

  it("names them when the act settled while it was opening, beside what already opened", async () => {
    const finding = rows({
      acts: readAutonomy([
        {
          action: {
            actionId: "acme-gone",
            doneIso: "2026-11-02T06:00:00.000Z",
            kind: FINDING_ACT_KIND,
            subject: "fix-finding",
            why: "a finding on ABC-1",
          },
        },
      ])!,
      hands: [],
    });
    const settled: string[] = [];
    const ran = await runOpenCard({
      args: { key: "act:acme-gone" },
      seams: {
        actLookup: async ({ branch }) => ({ branch, phase: "not-measured", why: "the route is down" }) as const,
        cards: () => ({
          alignment: { acts: finding, settled: [...settled] },
          focuses: [],
          fromPath: FROM,
          recentlyLeft: [],
          rows: QUEUE,
          // The board stops answering once the console has moved.
          unread: settled.length > 0 ? [BOARD] : [],
        }),
        openCardsOn: () => true,
        presentConsole: async () => {
          settled.push("act:acme-gone");
          return { kind: "opened" };
        },
        readBriefing: NO_BRIEFING_EXPECTED,
        undrawnWhy: async () => undefined,
        verb: async () => {
          throw new Error("an act with no page or thread presents nothing");
        },
      },
    });
    expect([ran.detail, ran.answer]).toEqual([
      "act:acme-gone settled while opening",
      {
        opened: {
          card: { outcome: "opened" },
          page: { outcome: "none", slug: undefined },
          thread: { outcome: "none" },
        },
        refused: SETTLED,
        unread: [BOARD],
      },
    ]);
  });

  // A near-cap refused opening plus the unread list passed the tool output cap.
  it("fits under the cap when the console's refusal is near the cap and a long unread list rides beside it", async () => {
    const finding = rows({
      acts: readAutonomy([
        {
          action: {
            actionId: "acme-gone",
            doneIso: "2026-11-02T06:00:00.000Z",
            kind: FINDING_ACT_KIND,
            subject: "fix-finding",
            why: "a finding on ABC-1",
          },
        },
      ])!,
      hands: [],
    });
    const settled: string[] = [];
    const longUnread = [{ source: "autonomy acts", why: "e".repeat(30_000) }];
    const ran = await runOpenCard({
      args: { key: "act:acme-gone" },
      seams: {
        actLookup: async ({ branch }) => ({ branch, phase: "not-measured", why: "the route is down" }) as const,
        cards: () => ({
          alignment: { acts: finding, settled: [...settled] },
          focuses: [],
          fromPath: FROM,
          recentlyLeft: [],
          rows: QUEUE,
          unread: longUnread,
        }),
        openCardsOn: () => true,
        presentConsole: async () => {
          settled.push("act:acme-gone");
          return { kind: "refused", why: "r".repeat(23_000) };
        },
        readBriefing: NO_BRIEFING_EXPECTED,
        undrawnWhy: async () => undefined,
        verb: async () => {
          throw new Error("an act with no page or thread presents nothing");
        },
      },
    });
    const answer = ran.answer as { opened: { card: { why: string } } };
    expect([ran.detail, answer.opened.card.why]).toEqual([
      "act:acme-gone settled while opening",
      `${"r".repeat(OPENING_WHY_MAX)}… (cut at ${String(OPENING_WHY_MAX)} characters)`,
    ]);
    expect(toolOutputOf({ answer: ran.answer, tool: "open_card" })).toBe(JSON.stringify(ran.answer));
  });

  // A screen ask's near-cap thrown message rode whole as the skipped opening's reason, so
  // the unread list appended after it carried the answer past the tool output cap.
  it("fits under the cap when the screen's reason for not drawing the card is near the cap", async () => {
    const finding = rows({
      acts: readAutonomy([
        {
          action: {
            actionId: "acme-gone",
            doneIso: "2026-11-02T06:00:00.000Z",
            kind: FINDING_ACT_KIND,
            subject: "fix-finding",
            why: "a finding on ABC-1",
          },
        },
      ])!,
      hands: [],
    });
    const longUnread = [{ source: "autonomy acts", why: "e".repeat(30_000) }];
    const ran = await runOpenCard({
      args: { key: "act:acme-gone" },
      seams: {
        actLookup: async ({ branch }) => ({ branch, phase: "not-measured", why: "the route is down" }) as const,
        cards: () => ({
          alignment: { acts: finding, settled: [] },
          focuses: [],
          fromPath: FROM,
          recentlyLeft: [],
          rows: QUEUE,
          unread: longUnread,
        }),
        openCardsOn: () => true,
        presentConsole: async () => {
          throw new Error("an undrawn card never moves the console");
        },
        readBriefing: NO_BRIEFING_EXPECTED,
        undrawnWhy: async () => "u".repeat(23_000),
        verb: async () => {
          throw new Error("an act with no page or thread presents nothing");
        },
      },
    });
    const { answer } = withCardsUnread({ capBytes: TOOL_OUTPUT_MAX, ran, unreadSeen: () => longUnread });
    expect((answer as { opened: { card: Opening } }).opened.card).toEqual({
      outcome: "skipped",
      why: `${"u".repeat(OPENING_WHY_MAX)}… (cut at ${String(OPENING_WHY_MAX)} characters)`,
    });
    expect(toolOutputOf({ answer, tool: "open_card" })).toBe(JSON.stringify(answer));
  });
});
