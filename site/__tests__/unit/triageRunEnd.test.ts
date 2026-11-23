/*
 * `triage_end`, a fresh call's stop, and `triage_next` over a pass they stopped, over plain fake seams: ending stops the
 * pass but keeps the owner's place, a pass picked up inside the window resumes where it was, a fresh one leaves out every
 * card the owner ruled, and no ruled card's thread opens again.
 */
import { describe, expect, it } from "vitest";

import { runTriageEnd, stopTriageForFreshCall } from "../../components/voice/triageClockRun";
import { runTriageNext, type TriageSeams } from "../../components/voice/triageRun";
import { NO_ALIGNMENT_CARDS } from "../../lib/cardToolPlan";
import { noteTriageRuling } from "../../lib/triageWalk";
import { stopTriageWalk, TRIAGE_PASS_IDLE_MS } from "../../lib/triageWalkClock";
import type { TriageWalk } from "../../lib/triageWalkTypes";
import { fakes, handRows, heldVisit, heldWalk, KEY, ROWS, STEP, UNSEEN, WALK_ID } from "./triageRunFixture";

describe("stopTriageForFreshCall", () => {
  it("stops a pass an earlier call left running and its clock, keeping the owner's place in it", () => {
    const running = heldWalk({ over: { current: heldVisit(), shown: [KEY], visits: 1 } });
    const { seams, clocks, kept } = fakes({ walk: running });
    stopTriageForFreshCall({ seams });
    expect([clocks, kept.walk]).toEqual([["stop"], stopTriageWalk({ nowMs: 5000, walk: running })]);
  });

  it("leaves a stopped pass as it stopped and invents none, still stopping any clock", () => {
    const stopped = stopTriageWalk({ nowMs: 4500, walk: heldWalk() });
    const was = fakes({ walk: stopped });
    const none = fakes({ walk: undefined });
    stopTriageForFreshCall({ seams: was.seams });
    stopTriageForFreshCall({ seams: none.seams });
    expect([was.clocks, was.kept.walk, was.writes.count, none.clocks, none.kept.walk, none.writes.count]).toEqual([
      ["stop"],
      stopped,
      0,
      ["stop"],
      undefined,
      0,
    ]);
  });
});

describe("runTriageEnd", () => {
  it("stops the clock, stops the pass without dropping it, and says what it came to", async () => {
    const { seams, clocks, kept } = fakes({ walk: undefined });
    await runTriageNext({ minutes: undefined, seams });
    const before = kept.walk!;
    const ended = runTriageEnd({ seams });
    expect(kept.walk).toEqual({ ...before, stoppedMs: 5000 });
    expect([ended.refused, ended.detail, clocks, kept.walk!.stoppedMs, kept.walk!.shown]).toEqual([
      false,
      "triage ended, 1 of 1 seen",
      ["stop", `start ${WALK_ID}-1`, "stop"],
      5000,
      [KEY],
    ]);
    expect((ended.answer as { note: string }).note).toBe(
      "the owner's place is kept for half an hour: if they triage again inside it, one triage_next brings the next card they " +
        "have not seen, or one they sent back now back rewritten, never another they ruled; after it a fresh pass begins, " +
        "still leaving out every card they ruled whose words have not changed",
    );
    expect(before.stoppedMs).toBe(undefined);
  });

  it("refuses with no pass running, and still stops any clock", () => {
    const { seams, clocks } = fakes({ walk: undefined });
    const ended = runTriageEnd({ seams });
    expect([ended.refused, ended.answer, clocks]).toEqual([
      true,
      { refused: "no triage pass is running: triage_next starts one" },
      ["stop"],
    ]);
  });

  it("refuses a second end on a pass already stopped, and leaves it stopped where it was", async () => {
    const { seams, kept } = fakes({ walk: undefined });
    await runTriageNext({ minutes: undefined, seams });
    runTriageEnd({ seams });
    const stopped = kept.walk;
    const again = runTriageEnd({ seams });
    expect([again.refused, again.detail, kept.walk]).toEqual([true, "no triage pass", stopped]);
  });

  it("refuses a pass already stopped, leaves it as it was, and still stops any clock", () => {
    const already = heldWalk({ over: { stoppedMs: 4000 } });
    const { seams, clocks, kept } = fakes({ walk: already });
    const ended = runTriageEnd({ seams });
    expect([ended.refused, ended.answer, clocks, kept.walk]).toEqual([
      true,
      { refused: "no triage pass is running: triage_next starts one" },
      ["stop"],
      already,
    ]);
  });
});

describe("runTriageNext over a pass triage_end stopped", () => {
  const OTHER = handRows({ steps: [STEP, { ...STEP, id: "say-whether-the-orb-glows" }] });

  /**
   * Seams over two cards whose clock the test moves.
   *
   * @returns the seams, the clock it sets, and what the pass and the clock did
   */
  function clocked(): ReturnType<typeof fakes> {
    return fakes({ rows: OTHER, walk: undefined });
  }

  it("resumes the same pass inside the window, at the card after the one the owner was on", async () => {
    const { seams, kept, now } = clocked();
    await runTriageNext({ minutes: undefined, seams });
    runTriageEnd({ seams });
    now.ms = 5000 + TRIAGE_PASS_IDLE_MS;
    const resumed = await runTriageNext({ minutes: undefined, seams });
    expect([resumed.refused, kept.walk!.walkId, kept.walk!.stoppedMs, kept.walk!.current!.visitId]).toEqual([
      false,
      WALK_ID,
      undefined,
      `${WALK_ID}-2`,
    ]);
  });

  it("begins a fresh pass once the window since the stop has passed, leaving out the card the owner ruled", async () => {
    const { seams, kept, now } = clocked();
    await runTriageNext({ minutes: undefined, seams });
    const ruledKey = kept.walk!.current!.key;
    const otherKey = OTHER.map((row) => row.key).find((key) => key !== ruledKey)!;
    kept.walk = noteTriageRuling({
      front: UNSEEN,
      key: ruledKey,
      ruling: { label: undefined, verdict: "send-it" },
      walk: kept.walk!,
    });
    runTriageEnd({ seams });
    now.ms = 5001 + TRIAGE_PASS_IDLE_MS;
    const fresh = { ...seams, triage: { ...seams.triage, mintId: () => "a0000006-0000-4000-8000-000000000007" } };
    await runTriageNext({ minutes: undefined, seams: fresh });
    const again = await runTriageNext({ minutes: undefined, seams: fresh });
    expect([kept.walk.walkId, kept.walk.rulings, kept.walk.shown, kept.walk.settled.map((one) => one.key)]).toEqual([
      "a0000006-0000-4000-8000-000000000007",
      [],
      [otherKey],
      [ruledKey],
    ]);
    expect(again.detail).toBe("triage done, 1 of 1 seen");
  });

  it("puts a card the owner ruled in front of them again in a fresh pass once its words have changed", async () => {
    const queue = { rows: ROWS };
    const base = fakes({ walk: undefined });
    const now = { ms: 5000 };
    const seams: TriageSeams = {
      ...base.seams,
      cards: () => ({ ...base.seams.cards(), rows: queue.rows }),
      triage: { ...base.seams.triage, nowMs: () => now.ms },
    };
    await runTriageNext({ minutes: undefined, seams });
    base.kept.walk = noteTriageRuling({
      front: UNSEEN,
      key: KEY,
      ruling: { label: undefined, verdict: "send-it" },
      walk: base.kept.walk!,
    });
    runTriageEnd({ seams });
    now.ms = 5001 + TRIAGE_PASS_IDLE_MS;
    queue.rows = handRows({ steps: [{ ...STEP, what: "Say whether the orb should breathe, now with the two looks" }] });
    const ran = await runTriageNext({ minutes: undefined, seams });
    expect([ran.refused, base.kept.walk.current!.key, base.kept.walk.settled.map((one) => one.key)]).toEqual([
      false,
      KEY,
      [KEY],
    ]);
  });

  it("never takes a card the owner ruled as an arrival when it was off their Queue as the fresh pass began", async () => {
    const queue = { rows: ROWS };
    const base = fakes({ walk: undefined });
    const now = { ms: 5000 };
    const seams: TriageSeams = {
      ...base.seams,
      cards: () => ({ ...base.seams.cards(), rows: queue.rows }),
      triage: { ...base.seams.triage, nowMs: () => now.ms },
    };
    await runTriageNext({ minutes: undefined, seams });
    base.kept.walk = noteTriageRuling({
      front: UNSEEN,
      key: KEY,
      ruling: { label: undefined, verdict: "send-it" },
      walk: base.kept.walk!,
    });
    runTriageEnd({ seams });
    now.ms = 5001 + TRIAGE_PASS_IDLE_MS;
    queue.rows = [];
    const away = await runTriageNext({ minutes: undefined, seams });
    queue.rows = ROWS;
    const back = await runTriageNext({ minutes: undefined, seams });
    expect([away.detail, back.detail, base.kept.walk.shown, base.kept.walk.settled.map((one) => one.key)]).toEqual([
      "triage done, 0 of 0 seen",
      "triage done, 0 of 0 seen",
      [],
      [KEY],
    ]);
  });

  it("leaves a pass stopped while its card opened exactly as triage_end left it, with no clock started", async () => {
    const { seams, clocks, kept } = fakes({ walk: undefined });
    const stopped: { walk: TriageWalk | undefined } = { walk: undefined };
    const rows = handRows({
      steps: [{ ...STEP, what: "In https://acme.slack.com/archives/C0TRIAGE/p1111111111111111" }],
    });
    const ending: TriageSeams = {
      ...seams,
      cards: () => ({ ...seams.cards(), rows }),
      openCardsOn: () => true,
      verb: async () => {
        runTriageEnd({ seams });
        stopped.walk = kept.walk;
        return { answer: {}, detail: "read", refused: false };
      },
    };
    await runTriageNext({ minutes: undefined, seams: ending });
    expect([kept.walk, kept.walk!.stoppedMs, kept.walk!.current!.opened, clocks]).toEqual([
      stopped.walk,
      5000,
      false,
      ["stop", "stop"],
    ]);
  });

  it("leaves a pass stopped while its card left the owner's Queue exactly as triage_end left it", async () => {
    const { seams, clocks, kept } = fakes({ walk: undefined });
    const stopped: { walk: TriageWalk | undefined } = { walk: undefined };
    const reads = { n: 0 };
    const leaving: TriageSeams = {
      ...seams,
      cards: () => {
        reads.n += 1;
        if (reads.n === 2) {
          runTriageEnd({ seams });
          stopped.walk = kept.walk;
        }
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
    expect([ran.refused, kept.walk, kept.walk!.current!.key, clocks]).toEqual([
      true,
      stopped.walk,
      KEY,
      ["stop", "stop"],
    ]);
  });
});

/*
 * A stopped pass replayed over card keys in the order a talk log walked them: pass 1 puts these in front of the owner
 * one by one, the owner rules each, the voice calls triage_end to stop the clock, then fires triage_next again and
 * again, and each must not open a card the owner has ruled, its Slack thread included (five of eight were refused into five
 * error toasts). Every card here links a thread and every thread open is refused, as five of those were, so a single
 * one re-opened is a toast this test sees.
 */
describe("a replayed stopped pass picks up where the owner was", () => {
  const RULED = ["sd-d9fa519b", "sd-b9230a1c", "sd-6288fa83", "sd-30e3b8b1", "sd-fba0bad3", "sd-ae075fdf"];
  const NEXT = "sd-3d6257d4";
  const threadOf = ({ id }: { id: string }): string =>
    `https://acme.slack.com/archives/C0TRIAGE/p${String(parseInt(id.slice(3), 16)).padStart(16, "1")}`;
  const steps = [...RULED, NEXT].map((id) => ({
    ...STEP,
    id,
    what: `Card ${id}, in the thread ${threadOf({ id })}`,
  }));
  const rows = handRows({ steps });

  /**
   * Seams with the owner's openCards switch on, recording every `browser_open` and refusing each, as the toasts were.
   *
   * @returns the seams, the urls asked for, and the clock the test moves
   */
  function opening(): {
    seams: TriageSeams;
    urls: string[];
    kept: { walk: TriageWalk | undefined };
    now: { ms: number };
  } {
    const base = fakes({ rows, walk: undefined });
    const urls: string[] = [];
    const now = { ms: 5000 };
    const seams: TriageSeams = {
      ...base.seams,
      openCardsOn: () => true,
      triage: { ...base.seams.triage, nowMs: () => now.ms },
      verb: async ({ args }) => {
        urls.push(String(args["url"]));
        return { answer: {}, detail: "the browser refused", refused: true };
      },
    };
    return { kept: base.kept, now, seams, urls };
  }

  /**
   * Walk pass 1 as the call did: each card put in front of the owner, then ruled, then `triage_end`.
   *
   * @param seams the seams the pass runs over
   * @param kept the pass the seams keep
   * @returns the keys the owner ruled, in the order they ruled them
   */
  async function ruleAndEnd({
    seams,
    kept,
  }: {
    seams: TriageSeams;
    kept: { walk: TriageWalk | undefined };
  }): Promise<string[]> {
    const ruled: string[] = [];
    for (let at = 0; at < RULED.length; at += 1) {
      await runTriageNext({ minutes: undefined, seams });
      const { key } = kept.walk!.current!;
      ruled.push(key);
      kept.walk = noteTriageRuling({
        front: UNSEEN,
        key,
        ruling: { label: undefined, verdict: "send-it" },
        walk: kept.walk!,
      });
    }
    runTriageEnd({ seams });
    return ruled;
  }

  it("opens no ruled card's thread past the half hour either: the fresh pass begins at the card the owner has not ruled", async () => {
    const { seams, urls, kept, now } = opening();
    const ruled = await ruleAndEnd({ kept, seams });
    now.ms = 5001 + TRIAGE_PASS_IDLE_MS;
    const before = urls.length;
    const first = await runTriageNext({ minutes: undefined, seams });
    const second = await runTriageNext({ minutes: undefined, seams });
    const unruled = [...RULED, NEXT].map((id) => `hand:${id}`).find((key) => !ruled.includes(key))!;
    expect([before, (first.answer as { triage: { card: string } }).triage.card, urls.slice(before)]).toEqual([
      6,
      unruled,
      [threadOf({ id: unruled.slice("hand:".length) })],
    ]);
    expect([second.detail, kept.walk!.settled.map((one) => one.key).toSorted()]).toEqual([
      "triage done, 1 of 1 seen",
      [...ruled].toSorted(),
    ]);
  });

  it("never opens a ruled card's thread again: the one triage_next after triage_end opens only the next card's", async () => {
    const { seams, urls, kept } = opening();
    const ruled: string[] = [];
    const toasts: number[] = [];
    for (let at = 0; at < RULED.length; at += 1) {
      toasts.push((await runTriageNext({ minutes: undefined, seams })).partialFailures.length);
      const { key } = kept.walk!.current!;
      ruled.push(key);
      kept.walk = noteTriageRuling({
        front: UNSEEN,
        key,
        ruling: { label: undefined, verdict: "send-it" },
        walk: kept.walk!,
      });
    }
    runTriageEnd({ seams });
    const before = urls.length;
    const resumed = await runTriageNext({ minutes: undefined, seams });
    const card = (resumed.answer as { triage: { card: string } }).triage.card;
    const unruled = [...RULED, NEXT].map((id) => `hand:${id}`).filter((key) => !ruled.includes(key));
    expect([toasts, before, unruled.length]).toEqual([[1, 1, 1, 1, 1, 1], 6, 1]);
    expect([card, urls.slice(before), resumed.partialFailures.map((one) => one.cardKey)]).toEqual([
      unruled[0],
      [threadOf({ id: unruled[0].slice("hand:".length) })],
      [unruled[0]],
    ]);
  });

  it("answers done after the last card, opening nothing, however often triage_next is called after the end", async () => {
    const { seams, urls } = opening();
    for (let at = 0; at <= RULED.length; at += 1) {
      await runTriageNext({ minutes: undefined, seams });
    }
    runTriageEnd({ seams });
    const before = urls.length;
    const again = [
      await runTriageNext({ minutes: undefined, seams }),
      await runTriageNext({ minutes: undefined, seams }),
      await runTriageNext({ minutes: undefined, seams }),
    ];
    expect([before, urls.length, again.map((ran) => ran.detail)]).toEqual([
      7,
      7,
      ["triage done, 7 of 7 seen", "triage done, 7 of 7 seen", "triage done, 7 of 7 seen"],
    ]);
  });
});
