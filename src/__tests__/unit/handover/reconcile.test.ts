import { describe, expect, it } from "vitest";

import { ALIGNMENT_MAX_SENTENCES, ALIGNMENT_MAX_WORDS } from "../../../briefing/caps.js";
import { sentenceCount, wordCount } from "../../../briefing/text.js";
import type { BoardRow } from "../../../handover/rank.js";
import { ASK_STALE_HOURS, emptyBandLine, RECONCILE_TOP_BAND, reconcile } from "../../../handover/reconcile.js";

/**
 * One row, with `ready` DERIVED from its standing exactly as `rowOfDoc` derives it.
 *
 * `ready` is deliberately not in this builder's input type: the two are one fact, and a fixture free to say
 * `{ ready: false, standing: "ready" }` could assert behaviour no real row can reach.
 */
const row = ({ standing = "ready", ...over }: Omit<Partial<BoardRow>, "ready"> & { id: string }): BoardRow => ({
  groomed: true,
  kind: "doc",
  label: over.id,
  openedIso: undefined,
  priority: "p2",
  ruled: false,
  waitingHours: 0,
  ...over,
  ready: standing === "ready",
  standing,
});

describe("reconcile", () => {
  it("calls a session on the top band aligned", () => {
    const result = reconcile({
      ranked: [row({ id: "top" })],
      worked: [{ rowId: "top", session: "ws:1" }],
    });

    expect(result.aligned.map((item) => item.session)).toEqual(["ws:1"]);
    expect(result.misaligned).toEqual([]);
    expect(result.headline).toBe("0 of the board's most urgent startable rows have nobody on them — nothing to chase.");
  });

  it("calls a session on a placed row below the band misaligned, and says where it sits", () => {
    const ranked = Array.from({ length: 7 }, (_, index) => row({ id: `r${String(index)}` }));
    const result = reconcile({ ranked, worked: [{ rowId: "r6", session: "ws:1" }] });

    expect(result.misaligned).toEqual([{ rank: 7, row: ranked[6], session: "ws:1" }]);
  });

  it("calls a session on an unplaced row unprioritised, never misaligned", () => {
    const result = reconcile({
      ranked: [row({ groomed: false, id: "nobody-placed-this" })],
      worked: [{ rowId: "nobody-placed-this", session: "ws:1" }],
    });

    expect(result.misaligned).toEqual([]);
    expect(result.unprioritised.map((item) => item.session)).toEqual(["ws:1"]);
    expect(result.top).toEqual([]);
  });

  it("never puts an unplaced row in the top band, so an alphabetical top cannot be reported as a finding", () => {
    const result = reconcile({
      ranked: [row({ groomed: false, id: "aaa" }), row({ groomed: false, id: "bbb" })],
      worked: [],
    });

    expect(result.top).toEqual([]);
    expect(result.starving).toEqual([]);
    expect(result.ungroomed).toBe(2);
  });

  it("calls a session on nothing the board claims unregistered — the original defect", () => {
    const result = reconcile({ ranked: [row({ id: "top" })], worked: [{ rowId: undefined, session: "ws:9" }] });

    expect(result.unregistered).toEqual(["ws:9"]);
  });

  // The two exclusion buckets were removed with the standing scheduler and its children. EVERY
  // live session claiming no row is now the finding, with nothing exempted from it.
  it("reports every session claiming no row, with no exemption for any of them", () => {
    const result = reconcile({
      ranked: [row({ id: "top" })],
      worked: [
        { rowId: undefined, session: "ws:840" },
        { rowId: undefined, session: "ws:884" },
        { rowId: undefined, session: "ws:9" },
      ],
    });

    expect(result.unregistered).toEqual(["ws:840", "ws:884", "ws:9"]);
  });

  it("says only what the fleet is on, with no by-contract clause left to add", () => {
    const result = reconcile({
      ranked: [row({ id: "top" })],
      worked: [{ rowId: "top", session: "ws:1" }],
    });

    expect(result.headline).toBe("0 of the board's most urgent startable rows have nobody on them — nothing to chase.");
  });

  it("says nothing is startable on an empty board and fleet, with no exclusion to absorb", () => {
    const result = reconcile({ ranked: [], worked: [] });

    expect(result.headline).toBe("Nothing on the board is startable — unblock a held row or register the next one.");
    expect(result.unregistered).toEqual([]);
    expect(result.top).toEqual([]);
  });

  it("treats a rowId no row answers to as unregistered rather than crashing", () => {
    const result = reconcile({ ranked: [row({ id: "top" })], worked: [{ rowId: "ghost", session: "ws:9" }] });

    expect(result.unregistered).toEqual(["ws:9"]);
  });

  it("names a placed top row nobody is working", () => {
    const result = reconcile({ ranked: [row({ id: "lonely" })], worked: [] });

    expect(result.starving.map((entry) => entry.id)).toEqual(["lonely"]);
    expect(result.headline).toBe(
      "1 of the board's most urgent startable rows have nobody on them — nothing is in flight, so each needs a new session.",
    );
  });

  it("names an ask that has been open past the age budget", () => {
    const result = reconcile({
      ranked: [row({ id: "ask", kind: "ask", priority: "p1", waitingHours: ASK_STALE_HOURS })],
      worked: [],
    });

    expect(result.staleAsks.map((entry) => entry.id)).toEqual(["ask"]);
  });

  it("leaves an ask younger than the budget alone", () => {
    const result = reconcile({
      ranked: [row({ id: "ask", kind: "ask", priority: "p1", waitingHours: ASK_STALE_HOURS - 1 })],
      worked: [],
    });

    expect(result.staleAsks).toEqual([]);
  });

  it("says the board has nothing to compare against rather than reporting a fleet doing the wrong thing", () => {
    const result = reconcile({
      ranked: [row({ groomed: false, id: "unplaced" })],
      worked: [{ rowId: "unplaced", session: "ws:1" }],
    });

    expect(result.headline).toBe(
      "Nothing placed is startable: 1 ready row(s) want a stated priority (`handover set-priority`) before the board can rank them.",
    );
  });

  it("reports a quiet, fully placed board as nothing to say", () => {
    const result = reconcile({ ranked: [row({ id: "top" })], worked: [{ rowId: "top", session: "ws:1" }] });

    expect(result.ungroomed).toBe(0);
    expect(result.starving).toEqual([]);
    expect(result.staleAsks).toEqual([]);
  });

  it("honours a narrower top band", () => {
    const ranked = [row({ id: "a" }), row({ id: "b" })];
    const result = reconcile({ ranked, topBand: 1, worked: [{ rowId: "b", session: "ws:1" }] });

    expect(result.misaligned.map((item) => item.session)).toEqual(["ws:1"]);
  });
});

/** The widest branch's word count, pinned so a longer sentence is a visible change rather than a quiet one. */
const WIDEST_WORDS = 31;

/**
 * Every sentence the headline can be, one reconciliation per branch.
 *
 * The branches are mutually exclusive and a count's digits never change the word count, so the widest
 * sentence this generator has is the widest entry here — which is what makes the cap measurement below a
 * bound and not a sample. A branch added to `headlineFor` without a row here is a sentence nobody measured.
 */
const HEADLINE_BRANCHES = (): readonly { readonly name: string; readonly headline: string }[] => [
  {
    headline: reconcile({
      fleet: "unavailable",
      ranked: [row({ id: "top" })],
      worked: [{ rowId: "top", session: "ws:1" }],
    }).headline,
    name: "fleet unavailable",
  },
  {
    headline: reconcile({ ranked: [row({ groomed: false, id: "unplaced" })], worked: [] }).headline,
    name: "nothing placed, something ready",
  },
  {
    headline: reconcile({ ranked: [row({ id: "held", standing: "paused" })], worked: [] }).headline,
    name: "nothing startable",
  },
  {
    headline: reconcile({ ranked: [row({ id: "top" })], worked: [{ rowId: "top", session: "ws:1" }] }).headline,
    name: "nothing to chase",
  },
  { headline: reconcile({ ranked: [row({ id: "lonely" })], worked: [] }).headline, name: "gap, empty fleet" },
  {
    headline: reconcile({
      ranked: [row({ id: "a" }), row({ id: "b" })],
      worked: [{ rowId: undefined, session: "ws:1" }],
    }).headline,
    name: "gap, a session could move",
  },
  {
    headline: reconcile({ ranked: [row({ id: "a" }), row({ id: "b" })], worked: [{ rowId: "a", session: "ws:1" }] })
      .headline,
    name: "gap, no session free to move",
  },
];

describe("reconcile's headline states ONE number to chase", () => {
  it("names the gap, and says nothing about the fleet's other findings", () => {
    const result = reconcile({
      ranked: [
        ...Array.from({ length: RECONCILE_TOP_BAND }, (_, index) =>
          row({ id: `top-${String(index)}`, kind: "ask", waitingHours: ASK_STALE_HOURS }),
        ),
        row({ id: "lower" }),
        row({ groomed: false, id: "unplaced" }),
        row({ id: "held", standing: "paused" }),
      ],
      worked: [
        { rowId: "top-0", session: "ws:1" },
        { rowId: "lower", session: "ws:2" },
        { rowId: "unplaced", session: "ws:3" },
        { rowId: undefined, session: "ws:4" },
      ],
    });

    expect(result.headline).toBe(
      "4 of the board's most urgent startable rows have nobody on them — a live session could move to one before " +
        "anything new is spawned.",
    );
    expect(result.misaligned.length).toBe(1);
    expect(result.unprioritised.length).toBe(1);
    expect(result.unregistered.length).toBe(1);
    expect(result.held.length).toBe(1);
    expect(result.staleAsks.length).toBe(RECONCILE_TOP_BAND);
    expect(result.ungroomed).toBe(1);
  });

  // The open-runs fallback fills `worked` with JOURNALS. Counting a gap off them would state a number nobody
  // observed, so the unreadable fleet is said out loud before anything is counted.
  it("refuses to count the gap when the fleet could not be read, whatever the fallback holds", () => {
    const result = reconcile({ fleet: "unavailable", ranked: [row({ id: "free" })], worked: [] });

    expect(result.starving.map((entry) => entry.id)).toEqual(["free"]);
    expect(result.headline).toBe(
      "The live fleet could not be read, so the urgent rows nobody is on cannot be counted.",
    );
  });

  it("says each needs a new session when every live session is alone on its own top row", () => {
    const result = reconcile({
      ranked: [row({ id: "a" }), row({ id: "b" })],
      worked: [{ rowId: "a", session: "ws:1" }],
    });

    expect(result.headline).toBe(
      "1 of the board's most urgent startable rows have nobody on them — every live session is the only one on " +
        "its own top row, so each needs a new session.",
    );
  });

  // Two sessions on ONE top row leave one free to move without uncovering it — the wiggle room the obvious
  // "is any session off the band" test misses.
  it("finds wiggle room in two sessions sharing one top row", () => {
    const result = reconcile({
      ranked: [row({ id: "a" }), row({ id: "b" })],
      worked: [
        { rowId: "a", session: "ws:1" },
        { rowId: "a", session: "ws:2" },
      ],
    });

    expect(result.misaligned).toEqual([]);
    expect(result.headline).toBe(
      "1 of the board's most urgent startable rows have nobody on them — a live session could move to one before " +
        "anything new is spawned.",
    );
  });

  it("enumerates seven distinct sentences, one per branch", () => {
    const branches = HEADLINE_BRANCHES();

    expect(branches.length).toBe(7);
    expect(new Set(branches.map((branch) => branch.headline)).size).toBe(7);
  });

  it("keeps every branch to one sentence inside the briefing's alignment caps, so the two halves cannot disagree", () => {
    const branches = HEADLINE_BRANCHES();
    const widest = Math.max(...branches.map((branch) => wordCount({ text: branch.headline })));

    expect(branches.filter((branch) => sentenceCount({ text: branch.headline }) !== 1)).toEqual([]);
    expect(widest).toBe(WIDEST_WORDS);
    expect(widest).toBeLessThanOrEqual(ALIGNMENT_MAX_WORDS);
    expect(branches.filter((branch) => sentenceCount({ text: branch.headline }) > ALIGNMENT_MAX_SENTENCES)).toEqual([]);
  });
});

/**
 * The band the owner actually saw, rebuilt row for row.
 *
 * Its five rows are the five a tick published, in order, and all five were reported to the owner as top rows
 * with nobody on them. That tick's own document is still on disk and settles two of the three things said
 * here: `jq '[.starving[] | {id, ready}]'
 * "${SLOPWEAVER_HOME:-$HOME/.slopweaver}/readings/handover-reconcile/2026-09-22T084830.237Z.json"` names the
 * five at full length, in this order, and answers `false` on every one — so none was startable, from the
 * publishing reading's own hand. The board SECTION each row sat in is the one thing that file cannot carry,
 * since it predates `standing`; the sections below are rebuilt from the board and are what the case is
 * actually about, so a wrong one here reddens the assertion rather than passing as prose. The live check
 * that the fix holds is `slopweaver handover reconcile --json | jq '[.starving[] | {id, standing, ready}]'`,
 * every entry `ready`. The ids below are that document's slugs cut to their first words.
 */
const TICK_358_TOP = (): readonly BoardRow[] => [
  row({ id: "people-waiting-on-owner", kind: "ask", priority: "p0", standing: "blocked", waitingHours: 343 }),
  row({ id: "re-architect-plan-routing", kind: "ask", priority: "p0", standing: "in-flight", waitingHours: 316 }),
  row({ id: "bot-dms-policies", kind: "ask", priority: "p0", standing: "paused", waitingHours: 314 }),
  row({ id: "routing-gate-repairs-token", kind: "ask", priority: "p0", standing: "paused", waitingHours: 248 }),
  row({ id: "team-facing-register", kind: "ask", priority: "p0", standing: "waiting-on-owner", waitingHours: 186 }),
];

describe("reconcile's top band holds only work the fleet can be on", () => {
  it("keeps every unstartable row out of the band — the five the owner was shown on 2026-09-22", () => {
    const result = reconcile({
      ranked: [...TICK_358_TOP(), row({ id: "startable", kind: "ask", priority: "p1", waitingHours: 208 })],
      worked: [],
    });

    expect(result.top.map((entry) => entry.id)).toEqual(["startable"]);
    expect(result.starving.map((entry) => entry.id)).toEqual(["startable"]);
  });

  it("names those five as HELD rather than as top rows nobody is on", () => {
    const result = reconcile({ ranked: TICK_358_TOP(), worked: [] });

    expect(result.held.map((entry) => entry.standing)).toEqual([
      "blocked",
      "in-flight",
      "paused",
      "paused",
      "waiting-on-owner",
    ]);
    expect(result.starving).toEqual([]);
    expect(result.headline).toBe("Nothing on the board is startable — unblock a held row or register the next one.");
  });

  it("lets an in-flight row into the band when a seat is OBSERVED on it, though it is not ready", () => {
    const ranked = [row({ id: "worked", priority: "p0", standing: "in-flight" }), row({ id: "free" })];
    const result = reconcile({ ranked, worked: [{ rowId: "worked", session: "ws:1" }] });

    expect(result.top.map((entry) => entry.id)).toEqual(["worked", "free"]);
    expect(result.aligned.map((item) => item.session)).toEqual(["ws:1"]);
    expect(result.held).toEqual([]);
  });

  // `run.kind === "active"` proves an unclosed journal cycle, never a living agent. Without this an abandoned
  // run holds a p0 at the top of the owner's board for ever and the band reports the fleet as correctly allocated.
  it("keeps an in-flight row with NO observed seat out of the band, and calls it held", () => {
    const ranked = [row({ id: "dead-journal", priority: "p0", standing: "in-flight" }), row({ id: "free" })];
    const result = reconcile({ ranked, worked: [] });

    expect(result.top.map((entry) => entry.id)).toEqual(["free"]);
    expect(result.held.map((entry) => entry.id)).toEqual(["dead-journal"]);
  });

  // A socket that is down is IGNORANCE. The open-runs fallback proves journals, not seats, so promoting an
  // in-flight row on it would let a failed read read as a correctly allocated fleet.
  it("closes the in-flight arm entirely when the fleet could not be read", () => {
    const ranked = [row({ id: "worked", priority: "p0", standing: "in-flight" }), row({ id: "free" })];
    const result = reconcile({ fleet: "unavailable", ranked, worked: [{ rowId: "worked", session: "ws:1" }] });

    expect(result.top.map((entry) => entry.id)).toEqual(["free"]);
    expect(result.fleet).toBe("unavailable");
  });

  // `ready`, `held` and the seated rows COVER the ranked board. An earlier draft required `groomed` on
  // `held`, which left the ungroomed unready row below in neither list — counted in `rankedCount` and drawn
  // nowhere, which is the class of silent hole this whole repair is about.
  it("puts every ranked row in at least one of ready, held and seated", () => {
    const ranked = [
      ...TICK_358_TOP(),
      row({ id: "ready-one" }),
      row({ id: "seated", standing: "in-flight" }),
      row({ groomed: false, id: "unplaced-and-blocked", standing: "blocked" }),
    ];
    const result = reconcile({ ranked, worked: [{ rowId: "seated", session: "ws:1" }] });

    expect(result.ready.map((entry) => entry.id)).toEqual(["ready-one"]);
    expect(result.held.map((entry) => entry.id)).toEqual([
      "people-waiting-on-owner",
      "re-architect-plan-routing",
      "bot-dms-policies",
      "routing-gate-repairs-token",
      "team-facing-register",
      "unplaced-and-blocked",
    ]);
    expect(result.ready.length + result.held.length + 1).toBe(ranked.length);
    expect(result.ungroomed).toBe(1);
  });

  // The one overlap, pinned so the claim above stays honest: a Codex review pass read "partition" and found
  // this state, which the code had always produced and no case had ever named. A `RUN NOW` row a live
  // session is already on is genuinely both startable and picked up, so it is in `ready` AND seated — and
  // out of `held`, which is the list the page's "startable by nobody" heading actually rests on.
  it("keeps a ready row a session is already on in BOTH ready and seated, and out of held", () => {
    const ranked = [row({ id: "ready-and-seated" })];
    const result = reconcile({ ranked, worked: [{ rowId: "ready-and-seated", session: "ws:1" }] });

    expect(result.ready.map((entry) => entry.id)).toEqual(["ready-and-seated"]);
    expect(result.aligned.map((entry) => entry.row.id)).toEqual(["ready-and-seated"]);
    expect(result.held).toEqual([]);
    expect(result.starving).toEqual([]);
  });

  // Both claims above hold while every ranked row carries its own id, and two review passes found one
  // direction each in which a DUPLICATE id breaks them. These two cases keep the JSDoc from overreaching,
  // and they redden the day the duplicate-slug defect is resolved one level up — which is exactly when the
  // prose has to change too. It is not this filter's to fix alone; `src/handover/reconcile.ts`'s `held`
  // names where it is owned, and a second copy of the resolution here is how two doors come to disagree.
  it("loses the EARLIER of two ranked rows sharing one id when a seat names it", () => {
    const first = row({ id: "same", priority: "p0", standing: "blocked" });
    const second = row({ id: "same", priority: "p1", standing: "paused" });
    const result = reconcile({ ranked: [first, second], worked: [{ rowId: "same", session: "ws:1" }] });

    expect(result.ready).toEqual([]);
    expect(result.held).toEqual([]);
    expect(result.misaligned.map((entry) => entry.row.priority)).toEqual(["p1"]);
  });

  it("puts one id in BOTH ready and held when two rows share it and disagree about readiness", () => {
    const startable = row({ id: "same", priority: "p0" });
    const blocked = row({ id: "same", priority: "p1", standing: "blocked" });
    const result = reconcile({ ranked: [startable, blocked], worked: [] });

    expect(result.ready.map((entry) => entry.priority)).toEqual(["p0"]);
    expect(result.held.map((entry) => entry.priority)).toEqual(["p1"]);
    expect(result.ready[0]!.id).toBe(result.held[0]!.id);
  });
});

describe("reconcile's ready set", () => {
  it("carries every ready row ranked, not the top band, and leaves the unready ones out", () => {
    const result = reconcile({
      ranked: [
        row({ id: "a", priority: "p0" }),
        row({ id: "b", standing: "in-flight" }),
        ...Array.from({ length: 8 }, (_, index) => row({ id: `r${String(index)}` })),
      ],
      worked: [],
    });

    expect(result.ready.map((entry) => entry.id)).toEqual(["a", "r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7"]);
    expect(result.top.length).toBe(RECONCILE_TOP_BAND);
  });
});

describe("emptyBandLine", () => {
  // The defect: `eligible` rejects an UNGROOMED row whatever its standing, while `ready` does not, so an
  // ordinary RUN NOW doc nobody has given a `priority:` is in `ready` and out of `top`. The old line read
  // "no row on the board is startable" off an empty band alone, inside a report that listed that row as
  // ready — the same overclaim the top band itself had been making, one list along.
  it("refuses `no row is startable` while its own ready list holds an ungroomed runnable row", () => {
    const runnable = { ...row({ id: "unplaced-but-runnable" }), groomed: false };
    const result = reconcile({ ranked: [runnable], worked: [] });

    expect(result.top).toEqual([]);
    expect(result.ready.map((item) => item.id)).toEqual(["unplaced-but-runnable"]);

    const line = emptyBandLine({ rankedCount: 1, result });

    expect(line).toBe(
      "no row on the board is PLACED and startable — of 1 ranked, 0 are held (paused, blocked or parked on " +
        "the owner) and 1 carry no stated position. 1 row(s) are ready to run and want only a stated position: " +
        '`slopweaver handover set-priority <slug> --priority <band> --because "<why>"` on the ones that matter, ' +
        "or unblock a held row.",
    );
  });

  it("does say nothing is startable when the ready list is genuinely empty", () => {
    const result = reconcile({ ranked: [row({ id: "parked", standing: "waiting-on-owner" })], worked: [] });

    expect(result.top).toEqual([]);
    expect(result.ready).toEqual([]);
    expect(emptyBandLine({ rankedCount: 1, result })).toBe(
      "no row on the board is startable — of 1 ranked, 1 are held (paused, blocked or parked on the owner) and 0 " +
        "carry no stated position, so the board cannot say what to do next. Unblock a held row.",
    );
  });
});
