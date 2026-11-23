/*
 * The triage pass kept across a reload: the text it is kept as, read back strictly (one field off shape drops the whole
 * pass), and the pass a reload holds, stopped exactly as a `triage_end` leaves one. */
import { describe, expect, it } from "vitest";

import { markTriageOpened, nextTriageCard, noteTriageRuling, startTriageWalk } from "../../lib/triageWalk";
import { resumeTriageWalk } from "../../lib/triageWalkClock";
import {
  keptTriageWalkChanged,
  keptTriageWalkOf,
  keptTriageWalkText,
  reloadedTriageWalk,
  TRIAGE_WALK_KEY,
} from "../../lib/triageWalkKept";
import type { TriageVisit, TriageWalk, TriageWalkRow } from "../../lib/triageWalkTypes";

const WALK_ID = "0b6c1f7e-2a4d-4e5b-9c3a-7d8e9f0a1b2c";

/**
 * One visit on the kept pass, opened and unruled unless a test says otherwise.
 *
 * @param key the card it is on
 * @param number its number in the pass
 * @param over the fields that differ from that
 * @returns the visit
 */
function visitOn({
  key,
  number,
  over = {},
}: {
  key: string;
  number: number;
  over?: Partial<TriageVisit>;
}): TriageVisit {
  return {
    arrived: false,
    fingerprint: `${key} words`,
    key,
    opened: true,
    presentedMs: 1000 * number,
    rewritten: false,
    ruled: false,
    visitId: `${WALK_ID}-${String(number)}`,
    ...over,
  };
}

/**
 * A pass part-way through and still running: three cards shown, the third in front of the owner and the second just left,
 * one ruling, one card out for rewrite, one card settled from a pass before, a focus on.
 *
 * @param over the fields that differ from that
 * @returns the pass
 */
function midWalk({ over = {} }: { over?: Partial<TriageWalk> } = {}): TriageWalk {
  return {
    current: visitOn({ key: "ask:c", number: 3 }),
    focus: ["slopweaver"],
    order: ["ask:a", "ask:b", "ask:c", "ask:d"],
    out: [{ fingerprint: "ask:a words", key: "ask:a", seenGone: true }],
    paused: true,
    previous: visitOn({ key: "ask:b", number: 2 }),
    rulings: [{ key: "ask:a", label: "action-now", verdict: "rewrite" }],
    settled: [{ fingerprint: "ask:z words", key: "ask:z" }],
    shown: ["ask:a", "ask:b", "ask:c"],
    stoppedMs: undefined,
    touchedMs: 4000,
    visits: 3,
    walkId: WALK_ID,
    ...over,
  };
}

describe("TRIAGE_WALK_KEY", () => {
  it("is the one key the pass is kept under", () => {
    expect(TRIAGE_WALK_KEY).toBe("slopweaver.triage-walk");
  });
});

describe("keptTriageWalkOf over keptTriageWalkText", () => {
  it("reads back exactly the pass that was kept, its paused flag, stop instant, focus and settled cards and all", () => {
    const walk = midWalk({ over: { stoppedMs: 4500 } });
    expect(keptTriageWalkOf({ raw: keptTriageWalkText({ walk }) })).toEqual(walk);
  });

  it("reads back a running pass as running", () => {
    const back = keptTriageWalkOf({ raw: keptTriageWalkText({ walk: midWalk() }) });
    expect(back!.stoppedMs).toBe(undefined);
  });

  it("reads back a pass with no card in front of the owner or before", () => {
    const walk = midWalk({ over: { current: undefined, previous: undefined } });
    const back = keptTriageWalkOf({ raw: keptTriageWalkText({ walk }) });
    expect([back!.current, back!.previous, back!.shown]).toEqual([undefined, undefined, walk.shown]);
  });

  it("reads nothing from nothing kept", () => {
    expect(keptTriageWalkOf({ raw: null })).toBe(undefined);
  });

  it("reads nothing from text that is not JSON, or JSON that is not a pass", () => {
    expect([
      keptTriageWalkOf({ raw: "{not json" }),
      keptTriageWalkOf({ raw: "[]" }),
      keptTriageWalkOf({ raw: "7" }),
      keptTriageWalkOf({ raw: "{}" }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("reads nothing from a pass kept without its paused flag, its focus or its settled cards", () => {
    const walk = midWalk();
    const noPaused = JSON.stringify({ ...walk, paused: undefined });
    const noFocus = JSON.stringify({ ...walk, focus: undefined });
    const noSettled = JSON.stringify({ ...walk, settled: undefined });
    expect(noPaused).not.toContain("paused");
    expect(noSettled).not.toContain("settled");
    expect([
      keptTriageWalkOf({ raw: noPaused }),
      keptTriageWalkOf({ raw: noFocus }),
      keptTriageWalkOf({ raw: noSettled }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("reads nothing from a pass whose paused flag is not a boolean or whose stop instant is not a number", () => {
    const walk = midWalk();
    expect([
      keptTriageWalkOf({ raw: JSON.stringify({ ...walk, paused: "yes" }) }),
      keptTriageWalkOf({ raw: JSON.stringify({ ...walk, stoppedMs: "4500" }) }),
      keptTriageWalkOf({ raw: JSON.stringify({ ...walk, stoppedMs: null }) }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("reads nothing from a pass whose card key, pass id, visit id or settled card is not one", () => {
    const walk = midWalk();
    expect([
      keptTriageWalkOf({ raw: JSON.stringify({ ...walk, walkId: "not-a-uuid" }) }),
      keptTriageWalkOf({ raw: JSON.stringify({ ...walk, shown: ["ask:a", "nope"] }) }),
      keptTriageWalkOf({ raw: JSON.stringify({ ...walk, current: { ...walk.current, visitId: "7" } }) }),
      keptTriageWalkOf({ raw: JSON.stringify({ ...walk, settled: [{ key: "ask:z" }] }) }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("reloadedTriageWalk", () => {
  it("holds neither card, stops a running pass at the instant it was last touched, and keeps a paused clock paused", () => {
    const reloaded = reloadedTriageWalk({ walk: midWalk() });
    expect([reloaded.current, reloaded.previous, reloaded.stoppedMs, reloaded.paused]).toEqual([
      undefined,
      undefined,
      4000,
      true,
    ]);
  });

  it("keeps a pass triage_end stopped stopped at the instant it stopped", () => {
    expect(reloadedTriageWalk({ walk: midWalk({ over: { stoppedMs: 4500 } }) }).stoppedMs).toBe(4500);
  });

  it("keeps every ruling, every settled card, every card out for rewrite, the order, the focus, and the pass's own id and count", () => {
    const walk = midWalk({ over: { stoppedMs: 4500 } });
    const reloaded = reloadedTriageWalk({ walk });
    expect([
      reloaded.rulings,
      reloaded.settled,
      reloaded.out,
      reloaded.order,
      reloaded.focus,
      reloaded.walkId,
      reloaded.visits,
      reloaded.touchedMs,
    ]).toEqual([walk.rulings, walk.settled, walk.out, walk.order, walk.focus, WALK_ID, 3, 4000]);
  });

  it("takes the card in front of the owner back out of the cards seen when they did not rule it, so it is put in front of them again", () => {
    const reloaded = reloadedTriageWalk({ walk: midWalk() });
    expect(reloaded.shown).toEqual(["ask:a", "ask:b"]);
  });

  it("keeps the card in front of the owner among the cards seen when they ruled it", () => {
    const walk = midWalk({ over: { current: visitOn({ key: "ask:c", number: 3, over: { ruled: true } }) } });
    expect(reloadedTriageWalk({ walk }).shown).toEqual(["ask:a", "ask:b", "ask:c"]);
  });

  it("puts a card the owner sent back, back unchanged and not yet ruled again, up again after the reload", () => {
    const row = {
      fingerprint: "ask:a words",
      key: "ask:a",
      kind: "ask",
      section: "fleet-blocked",
      tier: "fleet-blocked",
    } as const satisfies TriageWalkRow;
    const begun = startTriageWalk({ focus: [], nowMs: 0, rows: [row], walkId: WALK_ID });
    const first = nextTriageCard({ focus: [], nowMs: 1000, rows: [row], walk: begun }).walk;
    const sent = noteTriageRuling({
      front: { seen: false },
      key: "ask:a",
      ruling: { label: undefined, verdict: "rewrite" },
      walk: markTriageOpened({ visitId: first.current!.visitId, walk: first }),
    });
    const away = nextTriageCard({ focus: [], nowMs: 2000, rows: [], walk: sent }).walk;
    const back = nextTriageCard({ focus: [], nowMs: 3000, rows: [row], walk: away }).walk;
    const reloaded = reloadedTriageWalk({ walk: markTriageOpened({ visitId: back.current!.visitId, walk: back }) });
    const again = nextTriageCard({ focus: [], nowMs: 4000, rows: [row], walk: resumeTriageWalk({ walk: reloaded }) });
    expect([back.current!.rewritten, back.out, sent.settled.map((one) => one.key)]).toEqual([true, [], ["ask:a"]]);
    expect([again.pick!.visit.key, again.pick!.visit.rewritten, again.walk.out]).toEqual(["ask:a", true, []]);
  });

  it("keeps an unruled card before among the cards seen: the pass counts cards seen, not cards ruled", () => {
    const walk = midWalk({ over: { current: undefined } });
    expect(walk.previous!.ruled).toBe(false);
    expect(reloadedTriageWalk({ walk }).shown).toEqual(["ask:a", "ask:b", "ask:c"]);
  });
});

// Codex final-tree r1: a tab that cached the pass on an earlier turn started over instead of resuming another tab's.
describe("keptTriageWalkChanged", () => {
  it("reads the pass again on another tab's write to its key, or a cleared store, and on nothing else", () => {
    expect([TRIAGE_WALK_KEY, null, "slopweaver.other", ""].map((key) => keptTriageWalkChanged({ key }))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});
