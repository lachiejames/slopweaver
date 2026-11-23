/**
 * Restoring an ask the owner's words landed on: it is asked again, its picture and examples with it, unless a ruling
 * from elsewhere still answers it — the REAL `landCard` and `restoreCard` over a throwaway home and board, an
 * ask's standing read through the same `ownerWaitOf` the queue reads.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { landCard } from "../../../../cli/commands/talk/cardLandApply.js";
import { restoreCard } from "../../../../cli/commands/talk/cardRestoreApply.js";
import { runDisposition } from "../../../../handover/boardTypes.js";
import { applyRowEvent } from "../../../../handover/rowEvent.js";
import { readRunJournal } from "../../../../handover/runStore.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { ANCHOR, active, home, input, QUESTION, RELAY_TURN, stageAsk, useCardLandHome, waitOf } from "./harness.js";

useCardLandHome();

/** Give the staged ask its shape, the way `handover ask` re-cuts an unshaped question a run is waiting on. */
function reshapeAsk({ atIso }: { atIso: string }): void {
  unwrap(
    applyRowEvent({
      event: {
        atIso,
        kind: "question-shaped",
        lean: "keep it",
        options: [
          { letter: "A", option: "keep it", tradeoff: "no change" },
          { letter: "B", option: "drop it", tradeoff: "one less mark" },
        ],
        problem: "the landing left one call open",
        question: "Keep the voice mark?",
        replaces: QUESTION,
        stakes: { blastRadius: "one card", risk: "the mark stays unexplained", stillReal: "read the landing" },
      },
      runsDir: stateHomePaths({ home }).runs,
      slug: "an-ask",
    }),
  );
}

describe("landing on an ask", () => {
  it("leaves an ask a reshape re-cut after the landing as it is, agreeing with the queue that it is the owner's", async () => {
    await stageAsk({ slug: "an-ask" });
    unwrap(await landCard({ input: input({ cardKey: "ask:an-ask" }) }));
    const runsDir = stateHomePaths({ home }).runs;
    reshapeAsk({ atIso: "2026-09-25T16:00:00.000Z" });
    expect(waitOf({ slug: "an-ask" }).kind).toBe("owner");

    const restored = unwrap(
      restoreCard({
        input: {
          anchor: "run:r",
          cardKey: "ask:an-ask",
          home,
          nowIso: "2026-09-25T17:00:00.000Z",
          why: "not about it",
        },
      }),
    );

    expect(restored.ask).toEqual({ kind: "still-asked" });
    const events = unwrap(readRunJournal({ runsDir, slug: "an-ask" })).events;
    expect(runDisposition({ events, unreadableLines: [] })).toMatchObject({
      askedIso: "2026-09-25T11:00:00.000Z",
      question: "Keep the voice mark?",
    });
  });

  // The restated question is a fresh `question` no reshape re-cut, so a ruling the reshape had read competes again.
  it("re-asks after every standing ruling, so one the reshape read cannot answer the restated question", async () => {
    await stageAsk({ slug: "an-ask" });
    const runsDir = stateHomePaths({ home }).runs;
    unwrap(
      applyRowEvent({
        event: {
          anchor: "transcript:earlier#turn",
          atIso: "2026-09-25T12:00:00.000Z",
          decidedIso: "2026-09-25T18:00:00.000Z",
          kind: "ruling",
          ruling: "the pre-reshape ruling",
        },
        runsDir,
        slug: "an-ask",
      }),
    );
    reshapeAsk({ atIso: "2026-09-25T13:00:00.000Z" });
    expect(waitOf({ slug: "an-ask" }).kind).toBe("owner");
    unwrap(await landCard({ input: input({ cardKey: "ask:an-ask" }) }));
    expect(waitOf({ slug: "an-ask" })).toEqual({ kind: "already-ruled", words: "what is a voice mark" });

    const restored = unwrap(
      restoreCard({
        input: {
          anchor: "run:r",
          cardKey: "ask:an-ask",
          home,
          nowIso: "2026-09-25T17:00:00.000Z",
          why: "not about it",
        },
      }),
    );

    expect([restored.ask, waitOf({ slug: "an-ask" }).kind]).toEqual([{ kind: "re-asked" }, "owner"]);
  });

  it("restoring it asks the SAME question again, so it is the owner's again, and keeps the ruling on the journal", async () => {
    await stageAsk({ slug: "an-ask" });
    unwrap(await landCard({ input: input({ cardKey: "ask:an-ask" }) }));
    const restored = unwrap(
      restoreCard({
        input: {
          anchor: "run:r",
          cardKey: "ask:an-ask",
          home,
          nowIso: "2026-09-25T16:00:00.000Z",
          why: "not about it",
        },
      }),
    );
    expect([restored.lifted, restored.ask]).toEqual([1, { kind: "re-asked" }]);
    expect(waitOf({ slug: "an-ask" }).kind).toBe("owner");
    const events = unwrap(readRunJournal({ runsDir: stateHomePaths({ home }).runs, slug: "an-ask" })).events;
    expect(events.map((event) => event.kind)).toEqual(["started", "question", "ruling", "question"]);
    expect(runDisposition({ events, unreadableLines: [] })).toMatchObject({
      askedIso: "2026-09-25T16:00:00.000Z",
      question: QUESTION,
    });
  });

  // A fresh `question` inherits no picture and carries no scene, so a restore gives both back.
  it("restores the ask's picture and examples with it, so the card the owner gets back is the one that was landed", async () => {
    await stageAsk({ slug: "an-ask" });
    const runsDir = stateHomePaths({ home }).runs;
    const scene = "You open the card and see the stacked PR aimed at main. Which base should it target?";
    const shot = {
      boxes: [{ height: 40, label: "the base selector", width: 300, x: 120, y: 80 }],
      height: 900,
      sha256: "c".repeat(64),
      width: 1440,
    };
    const atIso = "2026-09-25T11:30:00.000Z";
    unwrap(
      applyRowEvent({
        event: { atIso, examples: [scene], kind: "question-examples", question: QUESTION },
        runsDir,
        slug: "an-ask",
      }),
    );
    unwrap(
      applyRowEvent({ event: { atIso, kind: "question-shot", question: QUESTION, shot }, runsDir, slug: "an-ask" }),
    );
    unwrap(await landCard({ input: input({ cardKey: "ask:an-ask" }) }));

    const restored = unwrap(
      restoreCard({
        input: { anchor: "run:r", cardKey: "ask:an-ask", home, nowIso: "2026-09-25T16:00:00.000Z", why: "mistaken" },
      }),
    );

    expect(restored.ask).toEqual({ kind: "re-asked" });
    const events = unwrap(readRunJournal({ runsDir, slug: "an-ask" })).events;
    expect(runDisposition({ events, unreadableLines: [] })).toMatchObject({
      askedIso: "2026-09-25T16:00:00.000Z",
      illustration: { examples: [scene], kind: "examples" },
      shot,
    });
  });

  // The relay landed the owner's words and was restored; the transcript's landing of them must not undo that.
  it("keeps a restore of a relay's landing when the transcript lands the same words after it", async () => {
    await stageAsk({ slug: "an-ask" });
    const relayed = {
      anchor: `talk:${RELAY_TURN}`,
      cardKey: "ask:an-ask",
      relayTurns: [RELAY_TURN],
      source: "relay",
    } as const;
    unwrap(await landCard({ input: input(relayed) }));
    unwrap(
      restoreCard({
        input: { anchor: "run:r", cardKey: "ask:an-ask", home, nowIso: "2026-09-25T16:00:00.000Z", why: "mistaken" },
      }),
    );
    const late = unwrap(await landCard({ input: input({ cardKey: "ask:an-ask", relayTurns: [RELAY_TURN] }) }));
    expect([late.outcome, active().length, waitOf({ slug: "an-ask" }).kind]).toEqual(["already", 0, "owner"]);
  });

  // A restore whose ledger row failed after its re-ask left the ask asked and its landing active.
  it("finishes a restore whose ledger row failed after its re-ask when run again, asking once", async () => {
    await stageAsk({ slug: "an-ask" });
    unwrap(await landCard({ input: input({ cardKey: "ask:an-ask" }) }));
    const runsDir = stateHomePaths({ home }).runs;
    const reAsk = { atIso: "2026-09-25T16:00:00.000Z", kind: "question", question: QUESTION } as const;
    unwrap(applyRowEvent({ event: reAsk, runsDir, slug: "an-ask" }));
    const again = unwrap(
      restoreCard({
        input: { anchor: "run:r", cardKey: "ask:an-ask", home, nowIso: "2026-09-25T16:01:00.000Z", why: "retry" },
      }),
    );
    const kinds = unwrap(readRunJournal({ runsDir, slug: "an-ask" })).events.map((event) => event.kind);
    expect([again.lifted, again.ask, active().length, kinds]).toEqual([
      1,
      { kind: "still-asked" },
      0,
      ["started", "question", "ruling", "question"],
    ]);
  });

  // One millisecond past the last instant a Date holds threw, and every retry of the restore threw again.
  it("refuses, naming why, to restore an ask whose landing ruled it at the last instant a date holds", async () => {
    await stageAsk({ slug: "an-ask" });
    unwrap(await landCard({ input: input({ cardKey: "ask:an-ask", decidedIso: "+275760-09-13T00:00:00.000Z" }) }));
    const refused = unwrapErr(
      restoreCard({
        input: { anchor: "run:r", cardKey: "ask:an-ask", home, nowIso: "2026-09-25T16:00:00.000Z", why: "mistaken" },
      }),
    );
    expect([refused.code, active().length]).toEqual(["RESTORE_UNSHAPED", 1]);
  });

  // A ruling decided ahead of the clock outranked a question restated at now, so the ask stayed answered.
  it("restoring it asks again after a ruling the owner's landing dated ahead of the clock", async () => {
    await stageAsk({ slug: "an-ask" });
    unwrap(await landCard({ input: input({ cardKey: "ask:an-ask", decidedIso: "2099-01-01T00:00:00.000Z" }) }));
    const restored = unwrap(
      restoreCard({
        input: { anchor: "run:r", cardKey: "ask:an-ask", home, nowIso: "2026-09-25T16:00:00.000Z", why: "mistaken" },
      }),
    );
    expect([restored.ask, waitOf({ slug: "an-ask" }).kind]).toEqual([{ kind: "re-asked" }, "owner"]);
  });

  // A grown landing wrote no ruling, yet restore counted a ruling matching its words as the landing's.
  it("restoring it leaves answered an ask ruled elsewhere in the words a grown landing carried", async () => {
    await stageAsk({ slug: "an-ask" });
    unwrap(await landCard({ input: input({ cardKey: "ask:an-ask", words: "what is" }) }));
    unwrap(await landCard({ input: input({ cardKey: "ask:an-ask" }) }));
    unwrap(
      applyRowEvent({
        event: {
          anchor: ANCHOR,
          atIso: "2026-09-25T15:50:00.000Z",
          decidedIso: "2026-09-25T15:40:00.000Z",
          kind: "ruling",
          ruling: "what is a voice mark",
        },
        runsDir: stateHomePaths({ home }).runs,
        slug: "an-ask",
      }),
    );
    const restored = unwrap(
      restoreCard({
        input: { anchor: "run:r", cardKey: "ask:an-ask", home, nowIso: "2026-09-25T16:00:00.000Z", why: "not it" },
      }),
    );
    expect([restored.ask, waitOf({ slug: "an-ask" })]).toEqual([
      { anchor: ANCHOR, kind: "ruled-elsewhere" },
      { kind: "already-ruled", words: "what is a voice mark" },
    ]);
  });

  it.each([
    ["from anywhere else", "run:owner-answer"],
    ["under the landing's own anchor", ANCHOR],
  ])(
    "restoring it leaves an ask a later ruling %s answered as answered, and names that ruling",
    async (_label, later) => {
      await stageAsk({ slug: "an-ask" });
      unwrap(await landCard({ input: input({ cardKey: "ask:an-ask" }) }));
      unwrap(
        applyRowEvent({
          event: {
            anchor: later,
            atIso: "2026-09-25T15:50:00.000Z",
            decidedIso: "2026-09-25T15:50:00.000Z",
            kind: "ruling",
            ruling: "stack it on main",
          },
          runsDir: stateHomePaths({ home }).runs,
          slug: "an-ask",
        }),
      );
      const restored = unwrap(
        restoreCard({
          input: {
            anchor: "run:r",
            cardKey: "ask:an-ask",
            home,
            nowIso: "2026-09-25T16:00:00.000Z",
            why: "not about it",
          },
        }),
      );
      expect([restored.lifted, restored.ask]).toEqual([1, { anchor: later, kind: "ruled-elsewhere" }]);
      expect(waitOf({ slug: "an-ask" })).toEqual({ kind: "already-ruled", words: "stack it on main" });
      const events = unwrap(readRunJournal({ runsDir: stateHomePaths({ home }).runs, slug: "an-ask" })).events;
      expect(events.map((event) => event.kind)).toEqual(["started", "question", "ruling", "ruling"]);
    },
  );
});
