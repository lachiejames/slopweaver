/*
 * The triage pass the owner walks by voice, held whole in the unit lane: the order it takes, the card the owner sent
 * back coming first once it is back, an arrival walked after the cards the pass began with, and the clock owed only on
 * a card the owner has not ruled and, once shown, has not closed.
 */
import { describe, expect, it } from "vitest";

import {
  markTriageOpened,
  nextTriageCard,
  noteTriageRuling,
  startTriageWalk,
  triageSummary,
  triageVisitFor,
  triageVisitIdOf,
} from "../../lib/triageWalk";
import {
  resumeTriageWalk,
  shownVisitAfter,
  stopTriageWalk,
  TRIAGE_PASS_IDLE_MS,
  triageClockOwed,
  triageClockOwedOnScreen,
  triageClockResumed,
  triageDueReady,
  triageWalkSpent,
} from "../../lib/triageWalkClock";
import type { TriageFront, TriageVisit, TriageWalk, TriageWalkRow } from "../../lib/triageWalkTypes";

const WALK_ID = "0b6c1f7e-2a4d-4e5b-9c3a-7d8e9f0a1b2c";

const row = ({ key, fingerprint = `${key} words`, tier = "fleet-blocked" }: Partial<TriageWalkRow> & { key: string }) =>
  ({ fingerprint, key, kind: "ask", section: tier, tier }) satisfies TriageWalkRow;

const A = row({ key: "ask:a" });
const B = row({ key: "ask:b", tier: "team-blocked" });
const C = row({ key: "ask:c" });

/** The board tag of the focus a case switches on. */
const ISO = "iso-certification";

/** A ruling whose answer the page never heard begin. */
const UNSEEN = { seen: false } as const satisfies TriageFront;

/**
 * A ruling whose answer began with this card in front of the owner.
 *
 * @param visitId the visit then current, `undefined` for none
 * @returns the front
 */
const seenOn = ({ visitId }: { visitId: string | undefined }): TriageFront => ({ seen: true, visitId });

/**
 * Take the next card and open it, as `triage_next` does once its open goes through, failing the test when there is
 * none.
 *
 * @param walk the pass so far
 * @param rows the Queue now
 * @param focus the board tags of the owner's focus now, none unless a case switches one on
 * @param nowMs when it goes in front of the owner
 * @returns the pass and the visit
 */
function next({
  walk,
  rows,
  focus = [],
  nowMs = 1000,
}: {
  walk: TriageWalk;
  rows: readonly TriageWalkRow[];
  focus?: readonly string[];
  nowMs?: number;
}) {
  const taken = nextTriageCard({ focus, nowMs, rows, walk });
  const visit = taken.pick!.visit;
  return { visit, walk: markTriageOpened({ visitId: visit.visitId, walk: taken.walk }) };
}

describe("startTriageWalk and nextTriageCard", () => {
  it("walks the Queue in its own order, team-blocked first, one visit id per card", () => {
    const begun = startTriageWalk({ focus: [], nowMs: 0, rows: [A, B, C], walkId: WALK_ID });
    const first = next({ rows: [A, B, C], walk: begun });
    const second = next({ rows: [A, B, C], walk: first.walk });
    expect(begun.order).toEqual(["ask:b", "ask:a", "ask:c"]);
    expect([first.visit.key, first.visit.visitId, second.visit.key, second.visit.visitId]).toEqual([
      "ask:b",
      `${WALK_ID}-1`,
      "ask:a",
      `${WALK_ID}-2`,
    ]);
    expect(second.walk.shown).toEqual(["ask:b", "ask:a"]);
  });

  it("puts a card stopping the owner's work in front of them next, even one arriving mid-pass", () => {
    const begun = startTriageWalk({ focus: [], nowMs: 0, rows: [A, B], walkId: WALK_ID });
    const first = next({ rows: [A, B], walk: begun });
    const stopped = { ...row({ key: "hand:held" }), section: "stopping" as const };
    const led = next({ rows: [A, B, stopped], walk: first.walk });
    const after = next({ rows: [A, B, stopped], walk: led.walk });
    expect([first.visit.key, led.visit.key, led.visit.arrived, after.visit.key]).toEqual([
      "ask:b",
      "hand:held",
      true,
      "ask:a",
    ]);
  });

  it("puts an arriving blocker first and an arriving stopped automation straight after the owner's priorities", () => {
    const F = { ...row({ key: "ask:f" }), section: "focus" as const };
    const begun = startTriageWalk({ focus: [ISO], nowMs: 0, rows: [A, B, F], walkId: WALK_ID });
    const R = { ...row({ key: "ask:r" }), section: "blocker" as const };
    const held = { ...row({ key: "hand:held" }), section: "stopping" as const };
    const rows = [A, B, F, held, R];
    const first = next({ focus: [ISO], rows, walk: begun });
    const second = next({ focus: [ISO], rows, walk: first.walk });
    const third = next({ focus: [ISO], rows, walk: second.walk });
    const fourth = next({ focus: [ISO], rows, walk: third.walk });
    expect([begun.order, first.visit.key, second.visit.key, third.visit.key, fourth.visit.key]).toEqual([
      ["ask:f", "ask:b", "ask:a"],
      "ask:r",
      "ask:f",
      "hand:held",
      "ask:b",
    ]);
  });

  it("begins a pass with the clock running and not stopped", () => {
    const begun = startTriageWalk({ focus: [], nowMs: 0, rows: [A], walkId: WALK_ID });
    expect([begun.paused, begun.stoppedMs]).toEqual([false, undefined]);
  });

  it("moves the unseen remainder when a focus is switched on mid-pass, and back when it is switched off", () => {
    const begun = startTriageWalk({ focus: [], nowMs: 0, rows: [A, B, C], walkId: WALK_ID });
    const first = next({ rows: [A, B, C], walk: begun });
    const focused = { ...C, section: "focus" as const };
    const lifted = next({ focus: [ISO], rows: [A, B, focused], walk: first.walk });
    const dropped = nextTriageCard({ focus: [], nowMs: 2000, rows: [A, B, C], walk: lifted.walk });
    expect([begun.order, first.visit.key, lifted.visit.key, lifted.walk.focus, dropped.pick!.visit.key]).toEqual([
      ["ask:b", "ask:a", "ask:c"],
      "ask:b",
      "ask:c",
      [ISO],
      "ask:a",
    ]);
  });

  it("keeps the order it began with when a card only changes tier mid-pass, with no focus standing", () => {
    const begun = startTriageWalk({ focus: [], nowMs: 0, rows: [A, B, C], walkId: WALK_ID });
    const demoted = { ...B, section: "check-in" as const, tier: "check-in" as const };
    const promoted = { ...C, section: "team-blocked" as const, tier: "team-blocked" as const };
    const first = next({ rows: [A, demoted, promoted], walk: begun });
    const second = next({ rows: [A, demoted, promoted], walk: first.walk });
    expect([begun.focus, first.visit.key, second.visit.key, second.walk.order]).toEqual([
      [],
      "ask:b",
      "ask:a",
      ["ask:b", "ask:a", "ask:c"],
    ]);
  });

  it("keeps the order it began with when a card leaves the owner's focus while the focus stands", () => {
    const R = { ...row({ key: "ask:r" }), section: "blocker" as const };
    const F = { ...row({ key: "ask:f" }), section: "focus" as const };
    const G = { ...row({ key: "ask:g" }), section: "focus" as const };
    const begun = startTriageWalk({ focus: [ISO], nowMs: 0, rows: [R, F, G, A], walkId: WALK_ID });
    const first = next({ focus: [ISO], rows: [R, F, G, A], walk: begun });
    const left = { ...F, section: "check-in" as const, tier: "check-in" as const };
    const second = next({ focus: [ISO], rows: [R, left, G, A], walk: first.walk });
    expect([begun.order, first.visit.key, second.visit.key, second.walk.order]).toEqual([
      ["ask:r", "ask:f", "ask:g", "ask:a"],
      "ask:r",
      "ask:f",
      ["ask:r", "ask:f", "ask:g", "ask:a"],
    ]);
  });

  it("walks a card that arrived after the cards the pass began with, even when a focus switched on lifts it", () => {
    const begun = startTriageWalk({ focus: [], nowMs: 0, rows: [B, A], walkId: WALK_ID });
    const first = next({ rows: [B, A], walk: begun });
    const F = { ...row({ key: "ask:f" }), section: "focus" as const };
    const second = next({ focus: [ISO], rows: [B, A, F], walk: first.walk });
    const third = next({ focus: [ISO], rows: [B, A, F], walk: second.walk });
    expect([second.visit.key, third.visit.key, third.visit.arrived]).toEqual(["ask:a", "ask:f", true]);
  });

  it("reads a second workstream naming the same board tag as the same focus, never as one switched on", () => {
    const F = { ...row({ key: "ask:f" }), section: "focus" as const };
    const begun = startTriageWalk({ focus: [ISO], nowMs: 0, rows: [F, B, A], walkId: WALK_ID });
    const first = next({ focus: [ISO], rows: [F, B, A], walk: begun });
    const demoted = { ...B, section: "fleet-blocked" as const, tier: "fleet-blocked" as const };
    const promoted = { ...A, section: "team-blocked" as const, tier: "team-blocked" as const };
    const second = next({ focus: [ISO, ISO], rows: [F, demoted, promoted], walk: first.walk });
    expect([begun.order, second.visit.key, second.walk.order, second.walk.focus]).toEqual([
      ["ask:f", "ask:b", "ask:a"],
      "ask:b",
      ["ask:f", "ask:b", "ask:a"],
      [ISO],
    ]);
  });

  it("re-orders a pass begun under a focus once the focus is switched off, before its first card", () => {
    const focused = { ...C, section: "focus" as const };
    const begun = startTriageWalk({ focus: [ISO], nowMs: 0, rows: [A, B, focused], walkId: WALK_ID });
    const off = next({ rows: [A, B, C], walk: begun });
    expect([begun.order, begun.focus, off.visit.key, off.walk.order, off.walk.focus]).toEqual([
      ["ask:c", "ask:b", "ask:a"],
      [ISO],
      "ask:b",
      // C and A share a tier, so the pass's own order breaks the tie.
      ["ask:b", "ask:c", "ask:a"],
      [],
    ]);
  });

  it("judges a card an earlier pass saw the owner rule by its words at each pick, so words changed back are never theirs to rule again", () => {
    const ruled = noteTriageRuling({
      front: UNSEEN,
      key: "ask:a",
      ruling: { label: undefined, verdict: "send-it" },
      walk: next({ rows: [A], walk: startTriageWalk({ focus: [], nowMs: 0, rows: [A], walkId: WALK_ID }) }).walk,
    });
    const changed = row({ fingerprint: "ask:a other words", key: "ask:a" });
    const fresh = startTriageWalk({ before: ruled, focus: [], nowMs: 0, rows: [changed, B], walkId: WALK_ID });
    const first = next({ rows: [changed, B], walk: fresh });
    expect([fresh.order, first.visit.key, fresh.settled]).toEqual([
      ["ask:b", "ask:a"],
      "ask:b",
      [{ fingerprint: "ask:a words", key: "ask:a" }],
    ]);
    expect([
      nextTriageCard({ focus: [], nowMs: 2000, rows: [A, B], walk: first.walk }).pick,
      nextTriageCard({ focus: [], nowMs: 2000, rows: [changed, B], walk: first.walk }).pick!.visit.key,
    ]).toEqual([undefined, "ask:a"]);
  });

  it("keeps both words a card was ruled on in one pass, sent back and then ruled rewritten", () => {
    const changed = row({ fingerprint: "ask:a other words", key: "ask:a" });
    const sent = noteTriageRuling({
      front: UNSEEN,
      key: "ask:a",
      ruling: { label: undefined, verdict: "rewrite" },
      walk: next({ rows: [A], walk: startTriageWalk({ focus: [], nowMs: 0, rows: [A], walkId: WALK_ID }) }).walk,
    });
    const back = next({ rows: [changed], walk: sent });
    const ruled = noteTriageRuling({
      front: UNSEEN,
      key: "ask:a",
      ruling: { label: undefined, verdict: "send-it" },
      walk: back.walk,
    });
    const fresh = startTriageWalk({ before: ruled, focus: [], nowMs: 0, rows: [A], walkId: WALK_ID });
    expect([
      back.visit.rewritten,
      ruled.settled,
      nextTriageCard({ focus: [], nowMs: 2000, rows: [A], walk: fresh }).pick,
    ]).toEqual([
      true,
      [
        { fingerprint: "ask:a words", key: "ask:a" },
        { fingerprint: "ask:a other words", key: "ask:a" },
      ],
      undefined,
    ]);
  });

  it("keeps every set of words the owner ruled a card on, so a third pass never shows words a first one ruled", () => {
    const send = { label: undefined, verdict: "send-it" } as const;
    const changed = row({ fingerprint: "ask:a other words", key: "ask:a" });
    const first = noteTriageRuling({
      front: UNSEEN,
      key: "ask:a",
      ruling: send,
      walk: next({ rows: [A], walk: startTriageWalk({ focus: [], nowMs: 0, rows: [A], walkId: WALK_ID }) }).walk,
    });
    const second = noteTriageRuling({
      front: UNSEEN,
      key: "ask:a",
      ruling: send,
      walk: next({
        rows: [changed],
        walk: startTriageWalk({ before: first, focus: [], nowMs: 0, rows: [changed], walkId: WALK_ID }),
      }).walk,
    });
    const third = startTriageWalk({ before: second, focus: [], nowMs: 0, rows: [A], walkId: WALK_ID });
    expect([third.settled, nextTriageCard({ focus: [], nowMs: 2000, rows: [A], walk: third }).pick]).toEqual([
      [
        { fingerprint: "ask:a words", key: "ask:a" },
        { fingerprint: "ask:a other words", key: "ask:a" },
      ],
      undefined,
    ]);
  });

  it("skips a card that left the owner's Queue before they reached it, and counts it as left", () => {
    const begun = startTriageWalk({ focus: [], nowMs: 0, rows: [A, B, C], walkId: WALK_ID });
    const first = next({ rows: [A, C], walk: begun });
    expect(first.visit.key).toBe("ask:a");
    expect(triageSummary({ rows: [A, C], walk: first.walk })).toEqual({
      labels: [],
      leftBeforeReached: 1,
      notReached: 1,
      of: 3,
      outForRewrite: 0,
      seen: 1,
      verdicts: [],
    });
  });

  it("walks a card that reached the owner's Queue after the pass began once the first cards are seen, marked arrived", () => {
    const D = row({ key: "ask:d" });
    const one = next({ rows: [A], walk: startTriageWalk({ focus: [], nowMs: 0, rows: [A], walkId: WALK_ID }) });
    const two = next({ rows: [A, D], walk: one.walk });
    expect([one.visit.arrived, two.visit.key, two.visit.arrived]).toEqual([false, "ask:d", true]);
    expect(triageSummary({ rows: [A, D], walk: two.walk }).of).toBe(2);
  });

  it("says the pass is done when every card is seen, and leaves no card current", () => {
    const one = next({ rows: [A], walk: startTriageWalk({ focus: [], nowMs: 0, rows: [A], walkId: WALK_ID }) });
    const done = nextTriageCard({ focus: [], nowMs: 2000, rows: [A], walk: one.walk });
    expect([done.pick, done.walk.current, done.walk.touchedMs]).toEqual([undefined, undefined, 2000]);
  });
});

describe("a card the owner sent back to be rewritten", () => {
  const sentBack = (): TriageWalk => {
    const one = next({
      rows: [A, B, C],
      walk: startTriageWalk({ focus: [], nowMs: 0, rows: [A, B, C], walkId: WALK_ID }),
    });
    return noteTriageRuling({
      front: UNSEEN,
      key: "ask:b",
      ruling: { label: undefined, verdict: "rewrite" },
      walk: one.walk,
    });
  };

  it("never holds the pass: the next card comes while the rewrite is out", () => {
    const moved = next({ rows: [A, C], walk: sentBack() });
    expect([moved.visit.key, moved.visit.rewritten, moved.walk.out]).toEqual([
      "ask:a",
      false,
      [{ fingerprint: "ask:b words", key: "ask:b", seenGone: true }],
    ]);
  });

  it("comes back first, marked rewritten, once it is back on the owner's Queue after the pass saw it gone", () => {
    const gone = next({ rows: [A, C], walk: sentBack() });
    const back = next({ rows: [A, B, C], walk: gone.walk });
    expect([back.visit.key, back.visit.rewritten, back.walk.out, back.walk.shown]).toEqual([
      "ask:b",
      true,
      [],
      ["ask:b", "ask:a"],
    ]);
  });

  it("comes back first when its words changed before the pass ever saw it gone", () => {
    const rewritten = row({ fingerprint: "ask:b clearer words", key: "ask:b", tier: "team-blocked" });
    const back = next({ rows: [A, rewritten, C], walk: sentBack() });
    expect([back.visit.key, back.visit.rewritten, back.visit.fingerprint]).toEqual([
      "ask:b",
      true,
      "ask:b clearer words",
    ]);
  });

  it("is not back while it still shows the words the owner could not follow", () => {
    const still = next({ rows: [A, B, C], walk: sentBack() });
    expect([still.visit.key, still.walk.out.length]).toEqual(["ask:a", 1]);
    expect(triageSummary({ rows: [A, B, C], walk: still.walk }).outForRewrite).toBe(1);
  });
});

describe("noteTriageRuling and triageClockOwed", () => {
  it("owes the time-up line on the card in front of the owner until they rule it, and never on another visit", () => {
    const one = next({ rows: [A], walk: startTriageWalk({ focus: [], nowMs: 0, rows: [A], walkId: WALK_ID }) });
    const ruled = noteTriageRuling({
      front: UNSEEN,
      key: "ask:a",
      ruling: { label: "action-now", verdict: "send-it" },
      walk: one.walk,
    });
    expect([
      triageClockOwed({ visitId: one.visit.visitId, walk: one.walk }),
      triageClockOwed({ visitId: `${WALK_ID}-9`, walk: one.walk }),
      triageClockOwed({ visitId: one.visit.visitId, walk: ruled }),
      triageClockOwed({ visitId: one.visit.visitId, walk: undefined }),
    ]).toEqual([true, false, false, false]);
  });

  it("owes no time-up line while the clock is paused, nor once the pass is stopped", () => {
    const one = next({ rows: [A], walk: startTriageWalk({ focus: [], nowMs: 0, rows: [A], walkId: WALK_ID }) });
    expect([
      triageClockOwed({ visitId: one.visit.visitId, walk: one.walk }),
      triageClockOwed({ visitId: one.visit.visitId, walk: { ...one.walk, paused: true } }),
      triageClockOwed({ visitId: one.visit.visitId, walk: stopTriageWalk({ nowMs: 2000, walk: one.walk }) }),
    ]).toEqual([true, false, false]);
  });

  // A card shown, then closed and left for another card unruled, is not owed "Two minutes are up" later.
  it("spends the line on a card the owner closed or left for another, and never on one read with nothing open", () => {
    const vanta = row({ key: "ask:vanta-v5-network-and-test-data-docs" });
    const one = next({ rows: [vanta], walk: startTriageWalk({ focus: [], nowMs: 0, rows: [vanta], walkId: WALK_ID }) });
    const owed = ({ shown, openKey }: { shown: boolean; openKey: string | undefined }): boolean =>
      triageClockOwedOnScreen({ openKey, shown, visitId: one.visit.visitId, walk: one.walk });
    expect([
      owed({ openKey: vanta.key, shown: true }),
      owed({ openKey: undefined, shown: true }),
      owed({ openKey: "ask:the-floating-note", shown: true }),
      owed({ openKey: undefined, shown: false }),
      owed({ openKey: "ask:the-floating-note", shown: false }),
      triageClockOwedOnScreen({
        openKey: vanta.key,
        shown: true,
        visitId: one.visit.visitId,
        walk: { ...one.walk, paused: true },
      }),
    ]).toEqual([true, false, false, true, true, false]);
  });

  it("keeps a card shown through a triage_clock restart after the owner closed it, and never marks one read unopened", () => {
    const vanta = row({ key: "ask:vanta-v5-network-and-test-data-docs" });
    const one = next({ rows: [vanta], walk: startTriageWalk({ focus: [], nowMs: 0, rows: [vanta], walkId: WALK_ID }) });
    const started = shownVisitAfter({ openKey: vanta.key, opened: false, shownVisit: undefined, visit: one.visit });
    const restarted = shownVisitAfter({ openKey: undefined, opened: false, shownVisit: started, visit: one.visit });
    const neverOpen = shownVisitAfter({
      openKey: undefined,
      opened: false,
      shownVisit: `${WALK_ID}-0`,
      visit: one.visit,
    });
    // A browser open answers before its card renders, so the page still shows nothing as the clock starts.
    const notRenderedYet = shownVisitAfter({
      openKey: undefined,
      opened: true,
      shownVisit: undefined,
      visit: one.visit,
    });
    expect([
      notRenderedYet,
      restarted,
      triageClockOwedOnScreen({
        openKey: undefined,
        shown: restarted === one.visit.visitId,
        visitId: one.visit.visitId,
        walk: one.walk,
      }),
      neverOpen,
    ]).toEqual([one.visit.visitId, one.visit.visitId, false, `${WALK_ID}-0`]);
  });

  it("counts a card the owner opened themselves mid-clock as shown, so leaving it spends the line", () => {
    const vanta = row({ key: "ask:vanta-v5-network-and-test-data-docs" });
    const one = next({ rows: [vanta], walk: startTriageWalk({ focus: [], nowMs: 0, rows: [vanta], walkId: WALK_ID }) });
    // Read with the switch off: nothing open as the clock starts.
    const atStart = shownVisitAfter({ openKey: undefined, opened: false, shownVisit: undefined, visit: one.visit });
    // The owner opens it from the Queue while its clock runs, then opens another.
    const heOpened = shownVisitAfter({ openKey: vanta.key, opened: false, shownVisit: atStart, visit: one.visit });
    const owed = ({ shownVisit }: { shownVisit: string | undefined }): boolean =>
      triageClockOwedOnScreen({
        openKey: "ask:other",
        shown: shownVisit === one.visit.visitId,
        visitId: one.visit.visitId,
        walk: one.walk,
      });
    expect([atStart, owed({ shownVisit: atStart }), heOpened, owed({ shownVisit: heOpened })]).toEqual([
      undefined,
      true,
      one.visit.visitId,
      false,
    ]);
  });

  it("keeps the owner's latest word on a card, and counts verdicts and labels by what they gave", () => {
    const one = next({ rows: [A, B], walk: startTriageWalk({ focus: [], nowMs: 0, rows: [A, B], walkId: WALK_ID }) });
    const first = noteTriageRuling({
      front: UNSEEN,
      key: "ask:b",
      ruling: { label: "waiting-on-me", verdict: "needs-more-info" },
      walk: one.walk,
    });
    const changed = noteTriageRuling({
      front: UNSEEN,
      key: "ask:b",
      ruling: { label: "waiting-on-them", verdict: "park-slow-triage" },
      walk: first,
    });
    const two = next({ rows: [A, B], walk: changed });
    const both = noteTriageRuling({
      front: UNSEEN,
      key: "ask:a",
      ruling: { label: undefined, verdict: "park-slow-triage" },
      walk: two.walk,
    });
    expect(both.rulings).toEqual([
      { key: "ask:b", label: "waiting-on-them", verdict: "park-slow-triage" },
      { key: "ask:a", label: undefined, verdict: "park-slow-triage" },
    ]);
    expect(triageSummary({ rows: [A, B], walk: both })).toEqual({
      labels: [{ count: 1, label: "waiting-on-them" }],
      leftBeforeReached: 0,
      notReached: 0,
      of: 2,
      outForRewrite: 0,
      seen: 2,
      verdicts: [{ count: 2, verdict: "park-slow-triage" }],
    });
  });

  it("leaves the pass as it was when the card the owner named is neither in front of them nor the one before it", () => {
    const begun = startTriageWalk({ focus: [], nowMs: 0, rows: [A, B, C], walkId: WALK_ID });
    const one = next({ rows: [A, B, C], walk: begun });
    const two = next({ rows: [A, B, C], walk: one.walk });
    const three = next({ rows: [A, B, C], walk: two.walk });
    const ruling = { label: undefined, verdict: "send-it" } as const;
    expect([
      noteTriageRuling({ front: UNSEEN, key: "ask:a", ruling, walk: begun }),
      noteTriageRuling({ front: UNSEEN, key: "ask:b", ruling, walk: three.walk }),
    ]).toEqual([begun, three.walk]);
  });

  it("lands the owner's ruling on the card before when the next one came up first, and leaves the new card unruled", () => {
    const one = next({ rows: [A, B], walk: startTriageWalk({ focus: [], nowMs: 0, rows: [A, B], walkId: WALK_ID }) });
    const two = next({ rows: [A, B], walk: one.walk });
    const ruled = noteTriageRuling({
      front: seenOn({ visitId: one.visit.visitId }),
      key: "ask:b",
      ruling: { label: "action-now", verdict: "send-it" },
      walk: two.walk,
    });
    expect([ruled.rulings, ruled.previous!.ruled, ruled.current!.key, ruled.current!.ruled]).toEqual([
      [{ key: "ask:b", label: "action-now", verdict: "send-it" }],
      true,
      "ask:a",
      false,
    ]);
    expect([
      triageClockOwed({ visitId: two.visit.visitId, walk: ruled }),
      triageClockOwed({ visitId: one.visit.visitId, walk: ruled }),
    ]).toEqual([true, false]);
  });

  it("refuses a stale key for the card before once either card is ruled, so it never lands on a later answer", () => {
    const send = { label: undefined, verdict: "send-it" } as const;
    const one = next({ rows: [A, B], walk: startTriageWalk({ focus: [], nowMs: 0, rows: [A, B], walkId: WALK_ID }) });
    const ruledFirst = next({
      rows: [A, B],
      walk: noteTriageRuling({ front: UNSEEN, key: "ask:b", ruling: send, walk: one.walk }),
    });
    const skipped = next({ rows: [A, B], walk: one.walk });
    const currentRuled = noteTriageRuling({ front: UNSEEN, key: "ask:a", ruling: send, walk: skipped.walk });
    const park = { label: undefined, verdict: "park-slow-triage" } as const;
    expect([
      noteTriageRuling({ front: UNSEEN, key: "ask:b", ruling: park, walk: ruledFirst.walk }),
      noteTriageRuling({ front: UNSEEN, key: "ask:b", ruling: park, walk: currentRuled }),
    ]).toEqual([ruledFirst.walk, currentRuled]);
  });

  it("rules no card still opening, and rules it once its open went through", () => {
    const send = { label: undefined, verdict: "send-it" } as const;
    const begun = startTriageWalk({ focus: [], nowMs: 0, rows: [A], walkId: WALK_ID });
    const opening = nextTriageCard({ focus: [], nowMs: 0, rows: [A], walk: begun }).walk;
    const opened = markTriageOpened({ visitId: `${WALK_ID}-1`, walk: opening });
    expect([
      noteTriageRuling({ front: UNSEEN, key: "ask:a", ruling: send, walk: opening }),
      markTriageOpened({ visitId: `${WALK_ID}-9`, walk: opening }),
      noteTriageRuling({ front: UNSEEN, key: "ask:a", ruling: send, walk: opened }).rulings,
    ]).toEqual([opening, opening, [{ key: "ask:a", label: undefined, verdict: "send-it" }]]);
    expect([
      triageClockOwed({ visitId: `${WALK_ID}-1`, walk: opening }),
      triageClockOwed({ visitId: `${WALK_ID}-1`, walk: opened }),
    ]).toEqual([false, true]);
  });

  // B opened, A refused (triage_next clears it), then C opened. B is two visits behind C.
  it("keeps the card before rulable past a refused open, and drops it once the next card comes up", () => {
    const send = { label: undefined, verdict: "send-it" } as const;
    const rows = [A, B, C];
    const one = next({ rows, walk: startTriageWalk({ focus: [], nowMs: 0, rows, walkId: WALK_ID }) });
    const refused = { ...nextTriageCard({ focus: [], nowMs: 0, rows, walk: one.walk }).walk, current: undefined };
    const three = next({ rows, walk: refused });
    expect([one.visit.key, three.visit.key, three.walk.previous]).toEqual(["ask:b", "ask:c", undefined]);
    expect([
      noteTriageRuling({ front: UNSEEN, key: "ask:b", ruling: send, walk: refused }).rulings,
      noteTriageRuling({ front: UNSEEN, key: "ask:b", ruling: send, walk: three.walk }),
    ]).toEqual([[{ key: "ask:b", label: undefined, verdict: "send-it" }], three.walk]);
  });

  it("marks the card before opened when a second triage_next moved past it while it opened", () => {
    const begun = startTriageWalk({ focus: [], nowMs: 0, rows: [A, B], walkId: WALK_ID });
    const first = nextTriageCard({ focus: [], nowMs: 0, rows: [A, B], walk: begun }).walk;
    const second = nextTriageCard({ focus: [], nowMs: 0, rows: [A, B], walk: first }).walk;
    const late = markTriageOpened({ visitId: `${WALK_ID}-1`, walk: second });
    const send = { label: undefined, verdict: "send-it" } as const;
    const front = seenOn({ visitId: `${WALK_ID}-1` });
    expect([late.previous!.opened, late.current!.opened]).toEqual([true, false]);
    expect(noteTriageRuling({ front, key: "ask:b", ruling: send, walk: late }).rulings).toEqual([
      { key: "ask:b", label: undefined, verdict: "send-it" },
    ]);
  });
});

describe("stopTriageWalk and resumeTriageWalk", () => {
  const send = { label: undefined, verdict: "send-it" } as const;

  it("begins running, stops keeping every field but the instant, and resumes clearing only that", () => {
    const begun = startTriageWalk({ focus: [], nowMs: 0, rows: [A, B], walkId: WALK_ID });
    const one = next({ rows: [A, B], walk: begun });
    const stopped = stopTriageWalk({ nowMs: 3000, walk: one.walk });
    expect([begun.stoppedMs, stopped, resumeTriageWalk({ walk: stopped })]).toEqual([
      undefined,
      { ...one.walk, stoppedMs: 3000 },
      one.walk,
    ]);
    expect(triageSummary({ rows: [A, B], walk: stopped })).toEqual(triageSummary({ rows: [A, B], walk: one.walk }));
  });

  it("makes a stopped pass inert: no clock owed, no ruling landed, no late open marked", () => {
    const begun = startTriageWalk({ focus: [], nowMs: 0, rows: [A], walkId: WALK_ID });
    const one = next({ rows: [A], walk: begun });
    const stopped = stopTriageWalk({ nowMs: 3000, walk: one.walk });
    const opening = stopTriageWalk({
      nowMs: 3000,
      walk: nextTriageCard({ focus: [], nowMs: 0, rows: [A], walk: begun }).walk,
    });
    expect([
      triageClockOwed({ visitId: one.visit.visitId, walk: stopped }),
      triageVisitFor({ front: UNSEEN, key: "ask:a", walk: stopped }),
      triageVisitFor({ front: seenOn({ visitId: one.visit.visitId }), key: "ask:a", walk: stopped }),
      noteTriageRuling({ front: UNSEEN, key: "ask:a", ruling: send, walk: stopped }),
      markTriageOpened({ visitId: `${WALK_ID}-1`, walk: opening }),
    ]).toEqual([false, undefined, undefined, stopped, opening]);
  });

  it("picks up at the next card the owner has not been shown, never back over one they were, and runs again", () => {
    const rows = [A, B, C];
    const one = next({ rows, walk: startTriageWalk({ focus: [], nowMs: 0, rows, walkId: WALK_ID }) });
    const ruled = noteTriageRuling({ front: UNSEEN, key: "ask:b", ruling: send, walk: one.walk });
    const stopped = stopTriageWalk({ nowMs: 3000, walk: ruled });
    const resumed = next({ nowMs: 4000, rows, walk: resumeTriageWalk({ walk: stopped }) });
    expect([resumed.visit.key, resumed.visit.visitId, resumed.walk.stoppedMs, resumed.walk.shown]).toEqual([
      "ask:a",
      `${WALK_ID}-2`,
      undefined,
      ["ask:b", "ask:a"],
    ]);
    expect(triageClockOwed({ visitId: resumed.visit.visitId, walk: resumed.walk })).toBe(true);
  });

  it("answers done on a resumed pass whose every card the owner has seen, and puts no card in front of them", () => {
    const one = next({ rows: [A], walk: startTriageWalk({ focus: [], nowMs: 0, rows: [A], walkId: WALK_ID }) });
    const resumed = resumeTriageWalk({ walk: stopTriageWalk({ nowMs: 3000, walk: one.walk }) });
    const done = nextTriageCard({ focus: [], nowMs: 4000, rows: [A], walk: resumed });
    expect([done.pick, done.walk.shown]).toEqual([undefined, ["ask:a"]]);
  });
});

describe("triageVisitFor by the card in front of the owner as the ruling's answer began", () => {
  /** B then A put up, both opened: A is current, B the card before, C still to come. */
  const twoCards = (): { walk: TriageWalk; before: TriageVisit; now: TriageVisit } => {
    const one = next({
      rows: [A, B, C],
      walk: startTriageWalk({ focus: [], nowMs: 0, rows: [A, B, C], walkId: WALK_ID }),
    });
    const two = next({ rows: [A, B, C], walk: one.walk });
    return { before: two.walk.previous!, now: two.walk.current!, walk: two.walk };
  };

  it("names exactly the card in front of the owner as the answer began, by the key that card carries", () => {
    const { walk, before, now } = twoCards();
    const onNow = seenOn({ visitId: now.visitId });
    const onBefore = seenOn({ visitId: before.visitId });
    expect([
      triageVisitFor({ front: onNow, key: "ask:a", walk }),
      triageVisitFor({ front: onNow, key: "ask:b", walk }),
      triageVisitFor({ front: onBefore, key: "ask:b", walk }),
      triageVisitFor({ front: onBefore, key: "ask:a", walk }),
    ]).toEqual([now, undefined, before, undefined]);
  });

  // An answer begins with B in front of the owner; a second answer running beside it puts A up; the first
  // answer's ruling then arrives naming A. Two opaque answer ids could not order them; what was in front of the owner can.
  it("never names a card put up after the answer began, in that answer or in another one beside it", () => {
    const { walk, before } = twoCards();
    const began = seenOn({ visitId: before.visitId });
    expect([
      triageVisitFor({ front: began, key: "ask:a", walk }),
      triageVisitFor({ front: seenOn({ visitId: undefined }), key: "ask:a", walk }),
      triageVisitFor({ front: seenOn({ visitId: undefined }), key: "ask:b", walk }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("names no card two behind the one in front of the owner now, nor one still opening", () => {
    const { walk, before, now } = twoCards();
    const three = next({ rows: [A, B, C], walk });
    const opening = { ...walk, current: { ...now, opened: false } };
    expect([
      triageVisitFor({ front: seenOn({ visitId: before.visitId }), key: "ask:b", walk: three.walk }),
      triageVisitFor({ front: seenOn({ visitId: now.visitId }), key: "ask:a", walk: opening }),
    ]).toEqual([undefined, undefined]);
  });

  it("names that card again once ruled, so the owner's latest word on it stands", () => {
    const send = { label: undefined, verdict: "send-it" } as const;
    const { walk, before } = twoCards();
    const front = seenOn({ visitId: before.visitId });
    const ruled = noteTriageRuling({ front, key: "ask:b", ruling: send, walk });
    expect([ruled.previous!.ruled, triageVisitFor({ front, key: "ask:b", walk: ruled })]).toEqual([
      true,
      ruled.previous,
    ]);
  });

  it("names neither of two unruled cards when the page never heard the answer begin, and the card in front of the owner once the one before is ruled", () => {
    const send = { label: undefined, verdict: "send-it" } as const;
    const { walk, before, now } = twoCards();
    const beforeRuled = noteTriageRuling({
      front: seenOn({ visitId: before.visitId }),
      key: "ask:b",
      ruling: send,
      walk,
    });
    expect([
      triageVisitFor({ front: UNSEEN, key: "ask:a", walk }),
      triageVisitFor({ front: UNSEEN, key: "ask:b", walk }),
      triageVisitFor({ front: UNSEEN, key: "ask:a", walk: beforeRuled }),
      triageVisitFor({ front: UNSEEN, key: "ask:b", walk: beforeRuled }),
    ]).toEqual([undefined, undefined, now, undefined]);
  });

  // An unheard answer began on B, put A up, and a heard answer ruled A; B is still unruled, so the
  // unheard answer's ruling naming A cannot be told from one meant for B.
  it("names neither card when the page never heard the answer begin and the one before is unruled, though the card in front of the owner is ruled", () => {
    const send = { label: undefined, verdict: "send-it" } as const;
    const { walk, now } = twoCards();
    const nowRuled = noteTriageRuling({ front: seenOn({ visitId: now.visitId }), key: "ask:a", ruling: send, walk });
    expect([
      nowRuled.current!.ruled,
      triageVisitFor({ front: UNSEEN, key: "ask:a", walk: nowRuled }),
      triageVisitFor({ front: UNSEEN, key: "ask:b", walk: nowRuled }),
    ]).toEqual([true, undefined, undefined]);
  });

  it("names the only card held when the page never heard the answer begin", () => {
    const one = next({ rows: [A], walk: startTriageWalk({ focus: [], nowMs: 0, rows: [A], walkId: WALK_ID }) });
    expect(triageVisitFor({ front: UNSEEN, key: "ask:a", walk: one.walk })).toBe(one.walk.current);
  });
});

describe("triageClockResumed", () => {
  it("arms the card in front of the owner afresh from the instant the clock resumes, and nothing else of it changes", () => {
    const one = next({
      nowMs: 1000,
      rows: [A],
      walk: startTriageWalk({ focus: [], nowMs: 0, rows: [A], walkId: WALK_ID }),
    });
    expect(triageClockResumed({ nowMs: 90_000, walk: one.walk })).toEqual({
      ...one.visit,
      opened: true,
      presentedMs: 90_000,
    });
  });

  it("arms nothing when no card is in front of the owner", () => {
    const begun = startTriageWalk({ focus: [], nowMs: 0, rows: [A], walkId: WALK_ID });
    const one = next({ rows: [A], walk: begun });
    const done = nextTriageCard({ focus: [], nowMs: 2000, rows: [A], walk: one.walk });
    expect([
      triageClockResumed({ nowMs: 5000, walk: begun }),
      triageClockResumed({ nowMs: 5000, walk: { ...done.walk, paused: true } }),
    ]).toEqual([undefined, undefined]);
  });

  it("arms nothing for a card the owner has ruled, one still opening, a clock still paused, or a pass stopped", () => {
    const one = next({ rows: [A], walk: startTriageWalk({ focus: [], nowMs: 0, rows: [A], walkId: WALK_ID }) });
    const ruled = noteTriageRuling({
      front: UNSEEN,
      key: "ask:a",
      ruling: { label: undefined, verdict: "send-it" },
      walk: one.walk,
    });
    const opening = { ...one.walk, current: { ...one.walk.current!, opened: false } };
    expect([
      triageClockResumed({ nowMs: 5000, walk: ruled }),
      triageClockResumed({ nowMs: 5000, walk: opening }),
      triageClockResumed({ nowMs: 5000, walk: { ...one.walk, paused: true } }),
      triageClockResumed({ nowMs: 5000, walk: stopTriageWalk({ nowMs: 4000, walk: one.walk }) }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("triageWalkSpent", () => {
  it("is spent only past the idle window since a card was last put in front of the owner", () => {
    const begun = startTriageWalk({ focus: [], nowMs: 0, rows: [A], walkId: WALK_ID });
    expect([
      triageWalkSpent({ nowMs: TRIAGE_PASS_IDLE_MS, walk: begun }),
      triageWalkSpent({ nowMs: TRIAGE_PASS_IDLE_MS + 1, walk: begun }),
    ]).toEqual([false, true]);
  });

  it("counts a stopped pass's window from when it stopped", () => {
    const stopped = stopTriageWalk({
      nowMs: 5000,
      walk: startTriageWalk({ focus: [], nowMs: 0, rows: [A], walkId: WALK_ID }),
    });
    expect([
      triageWalkSpent({ nowMs: 5000 + TRIAGE_PASS_IDLE_MS, walk: stopped }),
      triageWalkSpent({ nowMs: 5000 + TRIAGE_PASS_IDLE_MS + 1, walk: stopped }),
    ]).toEqual([false, true]);
  });
});

describe("triageVisitIdOf", () => {
  it("takes a pass id and visit number, and nothing else", () => {
    expect([
      triageVisitIdOf({ value: `${WALK_ID}-3` }),
      triageVisitIdOf({ value: WALK_ID }),
      triageVisitIdOf({ value: `${WALK_ID}-3; rm` }),
      triageVisitIdOf({ value: 3 }),
    ]).toEqual([`${WALK_ID}-3`, undefined, undefined, undefined]);
  });
});

// The line was taken 90s into the owner's bug report, its transcript stalled.
describe("triageDueReady", () => {
  it("keeps a due line owed while the owner's microphone sounds", () => {
    expect([
      triageDueReady({ microphoneSounding: true, owed: true }),
      triageDueReady({ microphoneSounding: false, owed: true }),
      triageDueReady({ microphoneSounding: true, owed: false }),
      triageDueReady({ microphoneSounding: false, owed: false }),
    ]).toEqual([false, true, false, false]);
  });
});
