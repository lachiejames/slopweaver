/**
 * `tick open` leads with what changed since the previous tick, keeps every standing obligation and unknown in view,
 * and folds the rest behind one line naming the file every line is in. The lines here are the shapes the digest
 * modules really print, taken from one chair's ticks.
 */
import { describe, expect, it } from "vitest";

import {
  deltaLines,
  digestDelta,
  digestLineKey,
  digestLinePolicy,
  type PriorDigest,
} from "../../../supervisor/tickDigestDelta.js";

/** The previous tick's digest, read. */
const priorOf = ({ lines }: { lines: readonly string[] }): PriorDigest => ({ kind: "read", lines, tick: 2 });

describe("digestLineKey", () => {
  it("blanks only a generated shape's moving numerals, so an age, a load or a plan's percent matches", () => {
    const pairs = [
      ["watch: needs-input 203m — slug-a", "watch: needs-input 225m — slug-a"],
      ["machine: clear — load 13.1/13.9/15.4 against 45", "machine: clear — load 33.4/29.0/23.7 against 45"],
      [
        "gauge: PLAN plan-two: week 80% ALLOWED_WARNING resets 2026-11-06T07:00:00.000Z",
        "gauge: PLAN plan-two: week 81% ALLOWED_WARNING resets 2026-11-13T07:00:00.000Z",
      ],
      ["watch: 1122 suppressed", "watch: 1127 suppressed"],
      ["landing: not due — next 2026-11-05T16:17:27.363Z", "landing: not due — next 2026-11-05T16:28:33.143Z"],
      [
        "intake: Owner turns: 2 read since 2026-11-04T15:57:17.842Z, all witnessed",
        "intake: Owner turns: 2 read since 2026-11-04T16:19:23.652Z, all witnessed",
      ],
      ["owner's list: 5 min old", "owner's list: 12 min old"],
    ] as const;

    expect(pairs.map(([a, b]) => digestLineKey({ line: a }) === digestLineKey({ line: b }))).toEqual(
      pairs.map(() => true),
    );
  });

  it("keeps every number that names a fact: a pull request, a due count, a state word, a seat's signal", () => {
    const pairs = [
      ["landing pressed: #3110 acme/widgets", "landing pressed: #3244 acme/widgets"],
      ["recipes: 1 due", "recipes: 2 due"],
      ["machine: clear — load 13.1/13.9/15.4 against 45", "machine: HOLD — load 13.1/13.9/15.4 against 45"],
      ["watch: silent 20m — slug-a", "watch: needs-input 20m — slug-a"],
      ["watch: silent 20m — slug-a", "watch: silent 20m — slug-b"],
      ["owner's list: 5 min old", "owner's list: 95 min old — past 90, the render refuses it; close refreshes it"],
      ["seatable: 53 of 53 ready row(s)", "seatable: 52 of 52 ready row(s)"],
      // A problem's own text can read like `capped`'s trailer, so no `and N more` is blanked.
      ["standing: and 1 more", "standing: and 2 more"],
      [
        "machine: HOLD — load unreadable; culprit worker (load 1.0/2.0/3.0): stop",
        "machine: HOLD — load unreadable; culprit worker (load 4.0/5.0/6.0): stop",
      ],
      [
        "gauge: PLAN plan-three: PAUSED since 2026-11-01T00:00:00.000Z — a bounced charge",
        "gauge: PLAN plan-three: PAUSED since 2026-11-02T00:00:00.000Z — a bounced charge",
      ],
    ] as const;

    expect(pairs.map(([a, b]) => digestLineKey({ line: a }) === digestLineKey({ line: b }))).toEqual(
      pairs.map(() => false),
    );
  });

  it("never blanks a percentage outside the plan inventory — a card's own text, the chair's wall", () => {
    const lines = [
      'queue leader: "ship at 80% coverage?" — open it',
      "gauge: CHAIR — the supervisor chair spends plan-two, whose week is at 85% (allowed_warning)",
    ];

    expect(lines.map((line) => digestLineKey({ line }))).toEqual(lines);
  });

  it("never keys a line's own text equal to a blanked clause, whatever marker-like text it carries", () => {
    const pairs = [
      ["intake: status 2026-11-01T00:00:00Z", "intake: status …"],
      ["intake: status 2026-11-01T00:00:00Z", "intake: status \\#"],
      ["owner's list: 5 min old", "owner's list: \\# min old"],
      ["watch: 3 suppressed", "watch: \\# suppressed"],
    ] as const;

    expect(pairs.map(([a, b]) => digestLineKey({ line: a }) === digestLineKey({ line: b }))).toEqual(
      pairs.map(() => false),
    );
  });
});

describe("digestLinePolicy", () => {
  it("holds an obligation or an unknown in view every tick it stands, and lets a clean reading fold", () => {
    const lines = [
      "queue leader: none — nothing stops the owner's work",
      "queue leader unread: console — timed out",
      "stopping the owner's work: a card",
      "gauge: CHAIR — the chair spends plan-two at 85%",
      "gauge: REACT NOW — plan-one week at 75%",
      "BROKEN r1 — OFF on finding f1",
      "recipes absent: r2 — never registered",
      "recipes: 1 declared automation(s) ABSENT",
      "standing: unavailable — exit 3",
      "turn sweep: NOT READ — not captured",
      "reconcile: _UNKNOWN_",
      "events: no alerts",
      "fleet health: clear",
      "watch: silent 20m — slug-a",
      "intake: UNKNOWNS resolved",
    ];

    expect(lines.map((line) => digestLinePolicy({ line }))).toEqual([
      ...Array.from({ length: 11 }, () => "always"),
      "comparable",
      "comparable",
      "comparable",
      "comparable",
    ]);
  });
});

describe("digestDelta", () => {
  it("compares against nothing on the seat's first tick, and says why on an unreadable one", () => {
    expect([
      digestDelta({ lines: ["a: 1"], prior: { kind: "none" } }),
      digestDelta({ lines: ["a: 1"], prior: { kind: "unreadable", tick: 4, why: "tick-4/digest.txt: ENOENT" } }),
    ]).toEqual([{ kind: "first" }, { kind: "unreadable", priorTick: 4, why: "tick-4/digest.txt: ENOENT" }]);
  });

  it("leads with the card stopping the owner's work, then the changed lines in digest order, holds obligations, folds the rest", () => {
    const prior = [
      "queue leader: none — nothing stops the owner's work",
      "gauge: CHAIR — the chair spends plan-two at 85%",
      "events: no alerts",
      "watch: silent 20m — slug-a",
      "watch: silent 9m — slug-b",
      "fleet health: clear",
    ];
    const lines = [
      "queue leader: none — nothing stops the owner's work",
      "machine: HOLD — load 30.0/20.0/10.0 against 24",
      "gauge: CHAIR — the chair spends plan-two at 85%",
      "events: no alerts",
      "watch: silent 42m — slug-a",
      "watch: needs-input 1m — slug-c",
      "fleet health: clear",
    ];

    expect(digestDelta({ lines, prior: priorOf({ lines: prior }) })).toEqual({
      changed: ["machine: HOLD — load 30.0/20.0/10.0 against 24", "watch: needs-input 1m — slug-c"],
      kind: "compared",
      lead: ["queue leader: none — nothing stops the owner's work"],
      priorTick: 2,
      repeatedAction: ["gauge: CHAIR — the chair spends plan-two at 85%"],
      unchangedCount: 3,
      unchangedSections: ["events", "watch", "fleet health"],
    });
  });

  it("calls a line the previous tick did not print a change, whatever an earlier tick printed", () => {
    expect(
      digestDelta({ lines: ["event: stale supervisor"], prior: priorOf({ lines: ["events: no alerts"] }) }),
    ).toEqual({
      changed: ["event: stale supervisor"],
      kind: "compared",
      lead: [],
      priorTick: 2,
      repeatedAction: [],
      unchangedCount: 0,
      unchangedSections: [],
    });
  });

  it("compares as a multiset: a second copy is a change, and a dropped copy invents nothing", () => {
    const twice = digestDelta({ lines: ["kept: x", "kept: x"], prior: priorOf({ lines: ["kept: x"] }) });
    const once = digestDelta({ lines: ["kept: x"], prior: priorOf({ lines: ["kept: x", "kept: x"] }) });

    expect([twice, once]).toEqual([
      {
        changed: ["kept: x"],
        kind: "compared",
        lead: [],
        priorTick: 2,
        repeatedAction: [],
        unchangedCount: 1,
        unchangedSections: ["kept"],
      },
      {
        changed: [],
        kind: "compared",
        lead: [],
        priorTick: 2,
        repeatedAction: [],
        unchangedCount: 1,
        unchangedSections: ["kept"],
      },
    ]);
  });
});

describe("deltaLines", () => {
  const PATH = "/s/handoff-9009/tick-3/digest.txt";

  it("prints every line under the reason when nothing was compared", () => {
    expect([
      deltaLines({ delta: { kind: "first" }, digestPath: PATH, lines: ["a: 1"] }),
      deltaLines({
        delta: { kind: "unreadable", priorTick: 2, why: "tick-2/digest.txt: ENOENT" },
        digestPath: PATH,
        lines: ["a: 1"],
      }),
    ]).toEqual([
      ["no earlier tick in this seat — every reading follows:", "a: 1"],
      [
        "tick 2's digest is unreadable, so nothing is compared — every reading follows: tick-2/digest.txt: ENOENT",
        "a: 1",
      ],
    ]);
  });

  it("leads with the card stopping the owner's work, then the changes, then what still stands, then ONE fold line naming the whole digest's file", () => {
    const lines = [
      "queue leader: none",
      "gauge: CHAIR — at 85%",
      "machine: HOLD",
      "events: no alerts",
      "fleet health: clear",
    ];

    expect(
      deltaLines({
        delta: {
          changed: ["machine: HOLD"],
          kind: "compared",
          lead: ["queue leader: none"],
          priorTick: 2,
          repeatedAction: ["gauge: CHAIR — at 85%"],
          unchangedCount: 2,
          unchangedSections: ["events", "fleet health"],
        },
        digestPath: PATH,
        lines,
      }),
    ).toEqual([
      "queue leader: none",
      "changed since tick 2 — 1 of 5 line(s), act on these:",
      "machine: HOLD",
      "still standing since tick 2, act on these too:",
      "gauge: CHAIR — at 85%",
      `unchanged since tick 2: 2 line(s) (events, fleet health) — every line: ${PATH}`,
    ]);
  });

  it("says a quiet tick is quiet rather than inventing a change", () => {
    expect(
      deltaLines({
        delta: {
          changed: [],
          kind: "compared",
          lead: [],
          priorTick: 2,
          repeatedAction: [],
          unchangedCount: 1,
          unchangedSections: ["events"],
        },
        digestPath: PATH,
        lines: ["events: no alerts"],
      }),
    ).toEqual([
      "nothing changed since tick 2 — 0 of 1 line(s)",
      `unchanged since tick 2: 1 line(s) (events) — every line: ${PATH}`,
    ]);
  });
});
