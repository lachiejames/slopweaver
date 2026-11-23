/*
 * The card tools' `runReadCard` over an Alignment finding act, and the Queue walk an Alignment card never joins
 * (split out of `cardToolPlan.test.ts` to keep that file under the size ratchet).
 */
import { describe, expect, it } from "vitest";

import { readAutonomy } from "../../components/live/readAutonomy";
import { type OpenCardRan, runOpenCard, runReadCard } from "../../components/voice/openCardRun";
import { FINDING_ACT_KIND, withLookedUpPull } from "../../lib/queueActRow";
import { cardForVoice } from "../../lib/queueVoice";
import { ALIGNMENT, FROM, NO_BRIEFING_EXPECTED, QUEUE, rows } from "./cardToolPlanFixture";

// The page draws a finding act from what its branch's lookup found (`AlignmentAct.tsx`); the voice
// read the row from before it, the one sentence saying there was nothing to draw yet.
describe("runReadCard on an Alignment finding act", () => {
  it("reads the act as the page draws it once its branch's lookup settles", async () => {
    const finding = rows({
      acts: readAutonomy([
        {
          action: {
            actionId: "acme-finding",
            doneIso: "2026-11-02T06:00:00.000Z",
            kind: FINDING_ACT_KIND,
            subject: "fix-finding",
            why: "a finding on ABC-1",
          },
        },
      ])!,
      hands: [],
    });
    const row = finding.find((one) => one.key === "act:acme-finding")!;
    const lookup = { branch: "fix-finding", phase: "not-measured", why: "the route is down" } as const;
    const asked: string[] = [];
    const ran = await runReadCard({
      args: { key: "act:acme-finding" },
      seams: {
        actLookup: async ({ branch }) => {
          asked.push(branch);
          return lookup;
        },
        cards: () => ({
          alignment: { acts: finding, settled: [] },
          focuses: [],
          fromPath: FROM,
          recentlyLeft: [],
          rows: QUEUE,
          unread: [],
        }),
        readBriefing: NO_BRIEFING_EXPECTED,
      },
    });
    const drawn = cardForVoice({ row: withLookedUpPull({ lookup, row }) });
    expect(asked).toEqual(["fix-finding"]);
    // Read off the work view (`FROM`), which does not draw this self act, so the voice says whose it is (r9).
    expect((ran.answer as { card: unknown }).card).toEqual({
      ...drawn,
      mark: { label: "the self workspace's card", title: "drawn only in that workspace's view, not this one" },
    });
    expect(drawn).not.toEqual(cardForVoice({ row }));
  });

  // An act settled in this window while its lookup was pending is no longer drawn, so not opened.
  it("refuses an act a press settled while its lookup was pending", async () => {
    const finding = rows({
      acts: readAutonomy([
        {
          action: {
            actionId: "acme-finding",
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
    const ran = await runReadCard({
      args: { key: "act:acme-finding" },
      seams: {
        actLookup: async ({ branch }) => {
          settled.push("act:acme-finding");
          return { branch, phase: "not-measured", why: "the route is down" } as const;
        },
        cards: () => ({
          alignment: { acts: finding, settled: [...settled] },
          focuses: [],
          fromPath: FROM,
          recentlyLeft: [],
          rows: QUEUE,
          unread: [],
        }),
        readBriefing: NO_BRIEFING_EXPECTED,
      },
    });
    expect([ran.refused, ran.detail, ran.answer]).toEqual([
      true,
      "act:acme-finding settled",
      { refused: "act:acme-finding is an Alignment act the owner has already settled, so it is no longer open" },
    ]);
  });

  // Another Queue call replaced the record while the lookup waited, and the refusal named only
  // the later read's unread sources.
  it("names a source unread at the read before the lookup when the record read after it no longer draws the act", async () => {
    const finding = rows({
      acts: readAutonomy([
        {
          action: {
            actionId: "acme-finding",
            doneIso: "2026-11-02T06:00:00.000Z",
            kind: FINDING_ACT_KIND,
            subject: "fix-finding",
            why: "a finding on ABC-1",
          },
        },
      ])!,
      hands: [],
    });
    let replaced = false;
    const ran = await runReadCard({
      args: { key: "act:acme-finding" },
      seams: {
        actLookup: async ({ branch }) => {
          replaced = true;
          return { branch, phase: "not-measured", why: "the route is down" } as const;
        },
        cards: () => ({
          alignment: { acts: replaced ? [] : finding, settled: [] },
          focuses: [],
          fromPath: FROM,
          recentlyLeft: [],
          rows: QUEUE,
          unread: replaced ? [] : [{ source: "the board", why: "timed out" }],
        }),
        readBriefing: NO_BRIEFING_EXPECTED,
      },
    });
    expect(ran.answer).toEqual({
      refused: "act:acme-finding is not among what has loaded; still unread: the board (timed out)",
    });
  });

  // An act another window settled, heard in full, was answered as no such card.
  it("answers an act the owner settled in another window as settled, never as absent", async () => {
    const ran = await runReadCard({
      args: { key: "act:acme-gone" },
      seams: {
        actLookup: async ({ branch }) => ({ branch, phase: "not-measured", why: "unused" }) as const,
        cards: () => ({
          alignment: { acts: [], settled: ["act:acme-gone"] },
          focuses: [],
          fromPath: FROM,
          recentlyLeft: [],
          rows: QUEUE,
          unread: [],
        }),
        readBriefing: NO_BRIEFING_EXPECTED,
      },
    });
    expect([ran.refused, ran.detail]).toEqual([true, "act:acme-gone settled"]);
  });

  // A settle landing while open_card's console opening awaited was never read again.
  it("answers an act settled while it was opening as settled, saying what already opened", async () => {
    const finding = rows({
      acts: readAutonomy([
        {
          action: {
            actionId: "acme-finding",
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
    const moves: string[] = [];
    const ran = await runOpenCard({
      args: { key: "act:acme-finding" },
      seams: {
        actLookup: async ({ branch }) => ({ branch, phase: "not-measured", why: "the route is down" }) as const,
        cards: () => ({
          alignment: { acts: finding, settled: [...settled] },
          focuses: [],
          fromPath: FROM,
          recentlyLeft: [],
          rows: QUEUE,
          unread: [],
        }),
        openCardsOn: () => true,
        presentConsole: async ({ path }) => {
          moves.push(path);
          settled.push("act:acme-finding");
          return { kind: "opened" };
        },
        readBriefing: NO_BRIEFING_EXPECTED,
        undrawnWhy: async () => undefined,
        verb: async () => {
          throw new Error("an act with no page or thread presents nothing");
        },
      },
    });
    expect(moves.length).toBe(1);
    expect([ran.refused, ran.detail, ran.answer]).toEqual([
      true,
      "act:acme-finding settled while opening",
      {
        opened: {
          card: { outcome: "opened" },
          page: { outcome: "none", slug: undefined },
          thread: { outcome: "none" },
        },
        refused: "act:acme-finding is an Alignment act the owner has already settled, so it is no longer open",
      },
    ]);
  });

  // A held list gone partial during the opening can leave the settle out of what is listed, so an
  // act the re-read no longer draws is refused even with neither key listed as settled.
  it("refuses an act the re-read after its openings no longer draws, and opens one still drawn as before", async () => {
    const finding = rows({
      acts: readAutonomy([
        {
          action: {
            actionId: "acme-finding",
            doneIso: "2026-11-02T06:00:00.000Z",
            kind: FINDING_ACT_KIND,
            subject: "fix-finding",
            why: "a finding on ABC-1",
          },
        },
      ])!,
      hands: [],
    });
    const run = async ({ partialAtOpening }: { partialAtOpening: boolean }): Promise<OpenCardRan> => {
      let partial = false;
      return runOpenCard({
        args: { key: "act:acme-finding" },
        seams: {
          actLookup: async ({ branch }) => ({ branch, phase: "not-measured", why: "the route is down" }) as const,
          cards: () => ({
            alignment: { acts: partial ? [] : finding, settled: [] },
            focuses: [],
            fromPath: FROM,
            recentlyLeft: [],
            rows: QUEUE,
            unread: partial ? [{ source: "settled acts", why: "a list was cut short" }] : [],
          }),
          openCardsOn: () => true,
          presentConsole: async () => {
            partial = partialAtOpening;
            return { kind: "opened" };
          },
          readBriefing: NO_BRIEFING_EXPECTED,
          undrawnWhy: async () => undefined,
          verb: async () => {
            throw new Error("an act with no page or thread presents nothing");
          },
        },
      });
    };
    const undrawn = await run({ partialAtOpening: true });
    const drawn = await run({ partialAtOpening: false });
    expect([undrawn.refused, undrawn.detail, (undrawn.answer as { refused: string }).refused]).toEqual([
      true,
      "act:acme-finding undrawn while opening",
      "act:acme-finding is no longer drawn as open since it was opened; still unread: settled acts (a list was cut short)",
    ]);
    expect([drawn.refused, drawn.detail]).toEqual([false, "act:acme-finding, card opened, page none, thread none"]);
    // An act opened is not the next Queue card: the Queue walk never counts it (`cardWalk.ts`).
    expect(drawn.walk).toBe(undefined);
  });
});

// Merging the Queue walk: moving from a Queue card to an Alignment card is not moving on to the next Queue
// card, so an act never enters the walk that takes a card off.
describe("the Queue walk over Alignment cards", () => {
  const seams = {
    actLookup: async () => {
      throw new Error("no finding act is looked up here");
    },
    cards: () => ({ alignment: ALIGNMENT, focuses: [], fromPath: FROM, recentlyLeft: [], rows: QUEUE, unread: [] }),
    readBriefing: NO_BRIEFING_EXPECTED,
  };
  it("carries no walk for an act read, and the Queue card's for a Queue card", async () => {
    const act = await runReadCard({ args: { key: "act:acme-act-1" }, seams });
    const queue = await runReadCard({ args: { key: "hand:acme-step" }, seams });
    expect([act.refused, act.walk]).toEqual([false, undefined]);
    expect(queue.walk).toEqual({ cardKey: "hand:acme-step", opened: false });
  });

  // The voice is learnt from the owner's Slack, never asked, so an old voice question's key names no card.
  it("refuses an old voice question's key as no card at all", async () => {
    const question = await runReadCard({ args: { key: "align:voice-tagging" }, seams });
    expect([question.refused, question.detail]).toEqual([true, "align:voice-tagging not found"]);
  });
});
