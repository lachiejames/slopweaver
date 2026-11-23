/*
 * `triage_next` over plain fake seams: a card is put in front of the owner through open_card's own presenter, its clock
 * starts, a ruled-out pass says it is done, and a paused clock arms nothing. Ending the pass and picking a stopped one
 * up is `./triageRunEnd.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { toolOutputOf } from "../../components/live/talkSession";
import { runTriageNext, type TriageSeams } from "../../components/voice/triageRun";
import { CARD_ANSWER_MAX_BYTES } from "../../lib/cardBriefings";
import { NO_ALIGNMENT_CARDS } from "../../lib/cardToolPlan";
import type { QueueFocus } from "../../lib/queueFocus";
import { stopTriageWalk } from "../../lib/triageWalkClock";
import { reloadedTriageWalk } from "../../lib/triageWalkKept";
import {
  CLOCK_NOTE,
  fakes,
  handRows,
  heldVisit,
  heldWalk,
  KEY,
  NOT_ASKED,
  OTHER_WALK_ID,
  PAUSED_NOTE,
  ROWS,
  STEP,
  SWITCH_OFF_NOTE,
  WALK_ID,
  wholeBriefing,
} from "./triageRunFixture";

describe("runTriageNext when the owner has not asked to triage", () => {
  it("begins no pass on 'the next card': no card read or opened, nothing written, no clock armed, no card named", async () => {
    const { seams, clocks, kept, writes, cardReads } = fakes({ asked: false, walk: undefined });
    const ran = await runTriageNext({ minutes: undefined, seams });
    expect([ran, clocks, kept.walk, writes.count, cardReads.count]).toEqual([NOT_ASKED, ["stop"], undefined, 0, 0]);
  });

  it("begins no fresh pass over one spent past the window either, leaving it as it was", async () => {
    const stale = heldWalk({ over: { shown: [KEY], touchedMs: -10_000_000, visits: 1 } });
    const { seams, clocks, kept, writes } = fakes({ asked: false, walk: stale });
    const ran = await runTriageNext({ minutes: undefined, seams });
    expect([ran, clocks, kept.walk, writes.count]).toEqual([NOT_ASKED, ["stop"], stale, 0]);
  });

  it("never picks up a pass the owner stopped, leaving it stopped where it was", async () => {
    const stopped = stopTriageWalk({ nowMs: 4500, walk: heldWalk() });
    const { seams, clocks, kept, writes } = fakes({ asked: false, walk: stopped });
    const ran = await runTriageNext({ minutes: undefined, seams });
    expect([ran, clocks, kept.walk, writes.count]).toEqual([NOT_ASKED, ["stop"], stopped, 0]);
  });

  it("carries on a pass the owner started in this call, whose next card needs no second ask", async () => {
    const { seams, clocks } = fakes({ asked: false, walk: heldWalk() });
    const ran = await runTriageNext({ minutes: undefined, seams });
    expect([ran.refused, clocks, ran.triageVisit]).toEqual([
      false,
      ["stop", `start ${OTHER_WALK_ID}-1`],
      `${OTHER_WALK_ID}-1`,
    ]);
  });
});

describe("runTriageNext", () => {
  it("begins a pass, puts the first card in front of the owner with where the pass stands, and starts its clock", async () => {
    const { seams, clocks, kept } = fakes({ walk: undefined });
    const ran = await runTriageNext({ minutes: undefined, seams });
    const answer = ran.answer as { card: { key: string }; triage: unknown };
    expect([ran.refused, answer.card.key, clocks, kept.walk!.current!.key, kept.walk!.current!.opened]).toEqual([
      false,
      KEY,
      ["stop", `start ${WALK_ID}-1`],
      KEY,
      true,
    ]);
    expect(answer.triage).toEqual({
      arrivedSincePassBegan: false,
      card: KEY,
      clock: CLOCK_NOTE,
      of: 1,
      onOwnerScreen: false,
      outForRewrite: 0,
      rewrittenAfterOwnerSentItBack: false,
      seen: 1,
      switchOff: SWITCH_OFF_NOTE,
    });
    expect(ran.triageVisit).toBe(`${WALK_ID}-1`);
    expect(ran.detail).toBe(`triage 1/1: ${KEY}, card skipped, page none, thread none`);
  });

  it("takes the pass's ordering basis from the owner's focus as the Queue reads it, by board tag", async () => {
    const focus: QueueFocus = {
      anchor: "talk-call:a0000024-0000-4000-8000-000000000027#turn_000000000000000000019",
      because: "the owner's ISO steer",
      id: "iso-27001-controls",
      name: "ISO 27001 controls",
      queueWorkstream: "iso-certification",
    };
    const { seams, kept } = fakes({ focuses: [focus], walk: undefined });
    await runTriageNext({ minutes: undefined, seams });
    expect(kept.walk!.focus).toEqual(["iso-certification"]);
  });

  it("says the pass is done once every card is seen, stops the clock, and keeps the pass for a card coming back", async () => {
    const { seams, clocks, kept } = fakes({ walk: undefined });
    await runTriageNext({ minutes: undefined, seams });
    const done = await runTriageNext({ minutes: undefined, seams });
    expect([done.refused, done.detail, clocks]).toEqual([
      false,
      "triage done, 1 of 1 seen",
      ["stop", `start ${WALK_ID}-1`, "stop"],
    ]);
    expect((done.answer as { done: boolean }).done).toBe(true);
    expect(kept.walk!.shown).toEqual([KEY]);
  });

  it("begins a fresh pass when the one on the page sat idle past the window", async () => {
    const stale = heldWalk({ over: { shown: [KEY], touchedMs: -10_000_000, visits: 1 } });
    const { seams, kept } = fakes({ walk: stale });
    const ran = await runTriageNext({ minutes: undefined, seams });
    expect([ran.refused, kept.walk!.walkId, kept.walk!.current!.visitId]).toEqual([false, WALK_ID, `${WALK_ID}-1`]);
  });

  it("picks a pass a reload stopped up where it was rather than beginning a new one, putting back the card the owner did not rule", async () => {
    const reloaded = reloadedTriageWalk({
      walk: heldWalk({ over: { current: heldVisit(), shown: [KEY], visits: 1 } }),
    });
    const { seams, kept } = fakes({ walk: reloaded });
    const ran = await runTriageNext({ minutes: undefined, seams });
    expect([
      ran.refused,
      kept.walk!.walkId,
      kept.walk!.stoppedMs,
      kept.walk!.current!.key,
      kept.walk!.current!.visitId,
    ]).toEqual([false, OTHER_WALK_ID, undefined, KEY, `${OTHER_WALK_ID}-2`]);
  });

  it("starts no clock while the pass is paused, and says so instead of the card's length", async () => {
    const { seams, clocks, kept } = fakes({ walk: heldWalk({ over: { paused: true } }) });
    const ran = await runTriageNext({ minutes: undefined, seams });
    const answer = ran.answer as { triage: { clock: string } };
    expect([clocks, answer.triage.clock, kept.walk!.paused, kept.walk!.current!.opened]).toEqual([
      ["stop"],
      PAUSED_NOTE,
      true,
      true,
    ]);
    expect(ran.triageVisit).toBe(`${OTHER_WALK_ID}-1`);
  });

  it("says the card is off the owner's screen and why, when the Open cards switch is what kept it off", async () => {
    const { seams } = fakes({ walk: undefined, openCards: false });
    const ran = await runTriageNext({ minutes: undefined, seams });
    const triage = (ran.answer as { triage: { onOwnerScreen: boolean; switchOff?: string } }).triage;
    expect([triage.onOwnerScreen, triage.switchOff]).toEqual([false, SWITCH_OFF_NOTE]);
  });

  it("says the card is on the owner's screen and carries no switch note, when the card opened", async () => {
    const { seams } = fakes({ openCards: true, walk: undefined });
    const ran = await runTriageNext({ minutes: undefined, seams });
    const triage = (ran.answer as { triage: { onOwnerScreen: boolean } }).triage;
    expect(ran.detail).toBe(`triage 1/1: ${KEY}, card opened, page none, thread none`);
    expect(triage.onOwnerScreen).toBe(true);
    expect(Object.keys(triage)).toContain("onOwnerScreen");
    expect(Object.keys(triage)).not.toContain("switchOff");
  });

  // A card walked in a pass is read with its briefing, as one the owner asks for is.
  it("hands the voice the card's briefing already read, on a card triage_next walks to", async () => {
    const rows = handRows({
      steps: [{ ...STEP, what: "Read file:///Users/someone/.slopweaver/pages/orb-notes/index.html first" }],
    });
    const { seams } = fakes({ openCards: false, rows, walk: undefined });
    const ran = await runTriageNext({ minutes: undefined, seams });
    expect((ran.answer as { briefings: unknown }).briefings).toEqual([
      { read: true, slug: "orb-notes", text: "the words of orb-notes" },
    ]);
  });

  // A card fitted to the page's whole cap must not be wrapped in the pass and refused whole. The card is
  // sized to land between the 20 KiB aim and its cap, which also reserves the unread list's 2 KiB.
  it("keeps a card fitted past the budget under the page's cap once the pass wraps it, its briefing still read", async () => {
    const id = `say-whether-${"the-orb-breathes-".repeat(40)}now`;
    const filler = "the orb breathes slowly while it talks ".repeat(200);
    const rows = handRows({
      steps: [{ ...STEP, id, what: `Read file:///Users/someone/.slopweaver/pages/orb-notes/index.html ${filler}` }],
    });
    const { seams } = fakes({ openCards: false, rows, walk: undefined });
    const words = wholeBriefing({ slug: "orb-notes", text: "words ".repeat(8000) });
    const ran = await runTriageNext({ minutes: undefined, seams: { ...seams, readBriefing: async () => words } });
    const sent = toolOutputOf({ answer: ran.answer, tool: "triage_next" });
    const answer = ran.answer as { briefings: readonly { slug: string; read: unknown }[]; triage: { card: string } };
    expect(new TextEncoder().encode(JSON.stringify(ran.answer)).length).toBeGreaterThan(CARD_ANSWER_MAX_BYTES);
    expect(sent).toBe(JSON.stringify(ran.answer));
    expect([answer.triage.card, answer.briefings.map(({ slug, read }) => [slug, read])]).toEqual([
      `hand:${id}`,
      [["orb-notes", "partial"]],
    ]);
  });

  it("says the card is off the owner's screen without blaming the switch when the console refused to move", async () => {
    const { seams } = fakes({ openCards: true, refuseConsole: true, walk: undefined });
    const ran = await runTriageNext({ minutes: undefined, seams });
    const triage = (ran.answer as { triage: { onOwnerScreen: boolean } }).triage;
    expect(ran.detail).toBe(`triage 1/1: ${KEY}, card refused, page none, thread none`);
    expect(triage.onOwnerScreen).toBe(false);
    expect(Object.keys(triage)).not.toContain("switchOff");
  });

  it("starts the clock on the open's own word, before the page has drawn the card", async () => {
    const opened = fakes({ openCards: true, walk: undefined });
    const refused = fakes({ openCards: true, refuseConsole: true, walk: undefined });
    const switchedOff = fakes({ walk: undefined });
    await runTriageNext({ minutes: undefined, seams: opened.seams });
    await runTriageNext({ minutes: undefined, seams: refused.seams });
    await runTriageNext({ minutes: undefined, seams: switchedOff.seams });
    expect([opened.shownAtStart, refused.shownAtStart, switchedOff.shownAtStart]).toEqual([[true], [false], [false]]);
  });
});

describe("runTriageNext over a card that leaves before it opens", () => {
  it("never puts it in front of the owner: no clock, no card key, and nothing current to rule", async () => {
    const { seams, clocks, kept } = fakes({ walk: undefined });
    const reads = { n: 0 };
    const leaving: TriageSeams = {
      ...seams,
      cards: () => {
        reads.n += 1;
        return {
          alignment: NO_ALIGNMENT_CARDS,
          focuses: [],
          fromPath: "/queue?context=slopweaver",
          recentlyLeft: [],
          rows: reads.n === 1 ? ROWS : [],
          unread: [],
        };
      },
    };
    const ran = await runTriageNext({ minutes: undefined, seams: leaving });
    expect([ran.refused, clocks, kept.walk!.current, kept.walk!.shown]).toEqual([true, ["stop"], undefined, [KEY]]);
    expect((ran.answer as { triage?: unknown }).triage).toBe(undefined);
  });

  it("says it left when it opens off the cards that recently left, and leaves nothing current to rule", async () => {
    const { seams, clocks, kept } = fakes({ walk: undefined });
    const reads = { n: 0 };
    const removed = { atIso: "2026-10-04T09:00:00.000Z", why: "settled" };
    const leaving: TriageSeams = {
      ...seams,
      cards: () => {
        reads.n += 1;
        const first = reads.n === 1;
        return {
          alignment: NO_ALIGNMENT_CARDS,
          focuses: [],
          fromPath: "/queue?context=slopweaver",
          recentlyLeft: first ? [] : [{ removed, row: ROWS[0] }],
          rows: first ? ROWS : [],
          unread: [],
        };
      },
    };
    const ran = await runTriageNext({ minutes: undefined, seams: leaving });
    expect([ran.refused, ran.answer, clocks, kept.walk!.current]).toEqual([
      false,
      {
        left: true,
        note: "this card left the owner's Queue as it opened, so there is nothing to rule: call triage_next for the next",
      },
      ["stop"],
      undefined,
    ]);
  });
});

describe("runTriageNext when a second triage_next moved past the card while it opened", () => {
  it("marks the card opened as the card before, and leaves the clock to the card now in front of the owner", async () => {
    const { seams, clocks, kept } = fakes({ walk: undefined });
    const reads = { n: 0 };
    const overtaken: TriageSeams = {
      ...seams,
      cards: () => {
        reads.n += 1;
        if (reads.n === 2) {
          // The second triage_next, landing while this card opens: this card becomes the one before.
          const walk = kept.walk!;
          const later = { ...walk.current!, key: "hand:later", opened: true, visitId: `${WALK_ID}-2` };
          kept.walk = { ...walk, current: later, previous: walk.current, visits: 2 };
        }
        return {
          alignment: NO_ALIGNMENT_CARDS,
          focuses: [],
          fromPath: "/queue?context=slopweaver",
          recentlyLeft: [],
          rows: ROWS,
          unread: [],
        };
      },
    };
    const ran = await runTriageNext({ minutes: undefined, seams: overtaken });
    expect([clocks, kept.walk!.previous!.key, kept.walk!.previous!.opened, kept.walk!.current!.key]).toEqual([
      // This call's stop as it moved past the card before; no start, since the later card owns the clock.
      ["stop"],
      KEY,
      true,
      "hand:later",
    ]);
    expect(ran.triageVisit).toBe(undefined);
  });

  it("arms no clock and names no card when a triage_end stopped the pass while the card opened", async () => {
    const { seams, clocks, kept } = fakes({ walk: undefined });
    const reads = { n: 0 };
    const ended: TriageSeams = {
      ...seams,
      cards: () => {
        reads.n += 1;
        if (reads.n === 2) {
          // The triage_end, landing while this card opens: the card stays current in a stopped pass.
          kept.walk = stopTriageWalk({ nowMs: 5000, walk: kept.walk! });
        }
        return {
          alignment: NO_ALIGNMENT_CARDS,
          focuses: [],
          fromPath: "/queue?context=slopweaver",
          recentlyLeft: [],
          rows: ROWS,
          unread: [],
        };
      },
    };
    const ran = await runTriageNext({ minutes: undefined, seams: ended });
    expect([clocks, kept.walk!.stoppedMs, kept.walk!.current!.visitId]).toEqual([["stop"], 5000, `${WALK_ID}-1`]);
    expect(Object.keys(ran)).not.toContain("triageVisit");
  });
});
