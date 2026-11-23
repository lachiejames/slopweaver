/*
 * Where each steer of the owner's stands against the order the chair walks: the place is the Next list's own position, the
 * precedence is single, and a reading the Next list refuses is refused here too. Board rows are driven through
 * `readBoard`, so a reader that stops carrying the owner's words fails here as well.
 */
import { describe, expect, it } from "vitest";

import { type BoardRow, readBoard } from "../../components/live/read";
import type { HeldRow, Placed, RankedRow } from "../../components/live/readWorkstreams";
import {
  ordinal,
  quotesBySlug,
  type SteerReconcile,
  type SteerRow,
  type SteersView,
  steerStandingOf,
  steerStateWords,
  wordsBeside,
} from "../../lib/steerStanding";

/** A ranked row as the reconcile reading prints one. */
const ranked = ({ id, standing = "ready" }: { id: string; standing?: string }) =>
  ({
    groomed: true,
    id,
    kind: "ask",
    label: `do ${id}`,
    openedIso: "2026-10-03T06:00:00.000Z",
    priority: "p1",
    ready: standing === "ready",
    standing,
    waitingHours: 3,
  }) satisfies RankedRow;

/** A held row carrying its standing. */
const held = ({ id, standing }: { id: string; standing: string }): HeldRow => ({
  ...ranked({ id, standing }),
  standing,
});

/** A live session placed on a row. */
const placed = ({
  id,
  session,
  standing = "in-flight",
}: {
  id: string;
  session: string;
  standing?: string;
}): Placed => ({
  rank: 1,
  row: ranked({ id, standing }),
  session,
});

/** A reconcile reading, observed and empty unless a test says otherwise. */
const reconcile = (over: Partial<SteerReconcile>): SteerReconcile => ({
  aligned: [],
  fleet: "observed",
  held: [],
  misaligned: [],
  ready: [],
  unprioritised: [],
  ...over,
});

/** The owner's words on a row, said at the given minute of a fixed day. */
const said = ({ words, minute }: { words: string; minute: number }) => ({
  hisWords: {
    anchor: "talk-call:anchor-a",
    atIso: `2026-10-05T03:${String(minute).padStart(2, "0")}:00.000Z`,
    cut: "none",
    where: "call",
    words,
  },
});

/** Board rows as `handover list --json` publishes them, read back through the console's own reader. */
function boardRows({ rows }: { rows: readonly Record<string, unknown>[] }): readonly BoardRow[] {
  const board = readBoard({
    rows: rows.map((over) => ({
      kind: "ask",
      ownerWait: "not-waiting",
      priority: "p1",
      reason: "declared ready",
      section: "RUN NOW",
      status: "ready",
      ...over,
    })),
    unresolved: 0,
  });
  if (board === undefined) {
    throw new Error("the fixture board did not read");
  }
  return board.rows;
}

/** A view that read, or a thrown error naming why it did not. */
function readyOf({ view }: { view: SteersView }): Extract<SteersView, { kind: "ready" }> {
  if (view.kind !== "ready") {
    throw new Error(`expected a ready steers view, got: ${view.why}`);
  }
  return view;
}

/** Every steer of a view that read, every group together. */
function steersOf({ view }: { view: SteersView }): readonly SteerRow[] {
  const ready = readyOf({ view });
  return [
    ...ready.working,
    ...ready.queued.shown,
    ...ready.queued.folded,
    ...ready.held,
    ...ready.unranked,
    ...ready.settled,
  ];
}

/** The ids of a group, in its order. */
const ids = ({ rows }: { rows: readonly SteerRow[] }): readonly string[] => rows.map((row) => row.id);

/** One steer by id. */
function steer({ view, id }: { view: SteersView; id: string }): SteerRow {
  return steersOf({ view }).find((row) => row.id === id)!;
}

describe("steerStandingOf", () => {
  it("places a queued steer at the Next list's own position, naming how many ahead are the owner's too", () => {
    const rows = boardRows({
      rows: [
        { slug: "alignment", ...said({ minute: 1, words: "the alignment page" }) },
        { slug: "fleet-found" },
        { slug: "landed", ...said({ minute: 2, words: "what landed" }) },
        { slug: "particles", ...said({ minute: 3, words: "free-form particles" }) },
      ],
    });
    const view = steerStandingOf({
      reconcile: reconcile({
        aligned: [placed({ id: "landed", session: "workspace:402" })],
        ready: ["alignment", "landed", "fleet-found", "particles"].map((id) => ranked({ id })),
      }),
      rows,
      shown: 10,
    });
    expect(steer({ id: "particles", view }).state).toEqual({
      ahead: 2,
      aheadYours: 1,
      kind: "queued",
      of: 3,
      position: 3,
      priority: "p1",
    });
    expect(steer({ id: "alignment", view }).state).toEqual({
      ahead: 0,
      aheadYours: 0,
      kind: "queued",
      of: 3,
      position: 1,
      priority: "p1",
    });
    expect(steer({ id: "landed", view }).state).toEqual({
      kind: "working",
      sessions: ["workspace:402"],
      standing: "in-flight",
    });
    expect(steer({ id: "particles", view }).label).toBe("do particles");
  });

  it("lists only rows holding the owner's words, the queue in its order and folded past the count", () => {
    const view = readyOf({
      view: steerStandingOf({
        reconcile: reconcile({ ready: ["a", "b", "c"].map((id) => ranked({ id })) }),
        rows: boardRows({
          rows: [
            { slug: "c", ...said({ minute: 9, words: "newer" }) },
            { slug: "b" },
            { slug: "a", ...said({ minute: 5, words: "older" }) },
          ],
        }),
        shown: 1,
      }),
    });
    expect(ids({ rows: view.queued.shown })).toEqual(["a"]);
    expect(ids({ rows: view.queued.folded })).toEqual(["c"]);
    expect(view.queued.shown[0].quote.words).toBe("older");
    expect(view.total).toBe(2);
  });

  it("puts every other group newest said first", () => {
    const view = readyOf({
      view: steerStandingOf({
        reconcile: reconcile({
          aligned: [placed({ id: "w1", session: "workspace:1" }), placed({ id: "w2", session: "workspace:2" })],
          held: [held({ id: "h1", standing: "blocked" }), held({ id: "h2", standing: "paused" })],
        }),
        rows: boardRows({
          rows: [
            { slug: "w1", ...said({ minute: 1, words: "x" }) },
            { slug: "w2", ...said({ minute: 2, words: "x" }) },
            { slug: "h1", ...said({ minute: 3, words: "x" }) },
            { slug: "h2", ...said({ minute: 4, words: "x" }) },
            { reason: "merged", section: "DONE", slug: "s1", status: "done", ...said({ minute: 5, words: "x" }) },
            { reason: "merged", section: "DONE", slug: "s2", status: "done", ...said({ minute: 6, words: "x" }) },
          ],
        }),
        shown: 10,
      }),
    });
    expect(ids({ rows: view.working })).toEqual(["w2", "w1"]);
    expect(ids({ rows: view.held })).toEqual(["h2", "h1"]);
    expect(ids({ rows: view.settled })).toEqual(["s2", "s1"]);
    expect(ids({ rows: view.unranked })).toEqual([]);
  });

  it("settles a DONE row even while a seat is still placed on it", () => {
    const view = steerStandingOf({
      reconcile: reconcile({ aligned: [placed({ id: "a", session: "workspace:7" })] }),
      rows: boardRows({
        rows: [
          {
            reason: "merged in the pull request",
            section: "DONE",
            slug: "a",
            status: "done",
            ...said({ minute: 1, words: "x" }),
          },
        ],
      }),
      shown: 10,
    });
    expect(steer({ id: "a", view }).state).toEqual({ kind: "settled", reason: "merged in the pull request" });
  });

  it("carries every seat on one row, and the placed row's own standing", () => {
    const view = steerStandingOf({
      reconcile: reconcile({
        aligned: [placed({ id: "a", session: "workspace:4", standing: "waiting-on-owner" })],
        misaligned: [placed({ id: "a", session: "workspace:9", standing: "waiting-on-owner" })],
      }),
      rows: boardRows({ rows: [{ slug: "a", ...said({ minute: 1, words: "x" }) }] }),
      shown: 10,
    });
    expect(steer({ id: "a", view }).state).toEqual({
      kind: "working",
      sessions: ["workspace:4", "workspace:9"],
      standing: "waiting-on-owner",
    });
  });

  it("reads a held row's standing, and says a row the last ranking does not carry is not ranked", () => {
    const view = steerStandingOf({
      reconcile: reconcile({ held: [held({ id: "a", standing: "blocked" })] }),
      rows: boardRows({
        rows: [
          { slug: "a", ...said({ minute: 1, words: "x" }) },
          { reason: "registered since", section: "NOT YET", slug: "b", ...said({ minute: 2, words: "y" }) },
          { reason: "", section: "NOT YET", slug: "c", ...said({ minute: 3, words: "z" }) },
        ],
      }),
      shown: 10,
    });
    expect(steer({ id: "a", view }).state).toEqual({ kind: "held", standing: "blocked" });
    expect(steer({ id: "b", view }).state).toEqual({
      kind: "unranked",
      why: "the last ranking does not carry it: the board files it under NOT YET: registered since",
    });
    expect(steer({ id: "c", view }).state).toEqual({
      kind: "unranked",
      why: "the last ranking does not carry it: the board files it under NOT YET",
    });
  });

  it("says a reading too old to carry held rows cannot place a row that is neither ready nor seated", () => {
    const view = steerStandingOf({
      reconcile: reconcile({ held: undefined }),
      rows: boardRows({ rows: [{ slug: "a", ...said({ minute: 1, words: "x" }) }] }),
      shown: 10,
    });
    expect(steer({ id: "a", view }).state).toEqual({
      kind: "unranked",
      why: "the last ranking is too old to say which rows are held",
    });
  });

  it("groups each state once and counts the seats on work that holds no words of the owner's", () => {
    const view = steerStandingOf({
      reconcile: reconcile({
        aligned: [placed({ id: "a", session: "workspace:1" }), placed({ id: "z", session: "workspace:2" })],
        held: [held({ id: "c", standing: "paused" })],
        ready: [ranked({ id: "b" })],
      }),
      rows: boardRows({
        rows: [
          { slug: "a", ...said({ minute: 1, words: "x" }) },
          { slug: "b", ...said({ minute: 2, words: "x" }) },
          { slug: "c", ...said({ minute: 3, words: "x" }) },
          { slug: "z" },
        ],
      }),
      shown: 10,
    });
    const ready = readyOf({ view });
    expect(ids({ rows: ready.working })).toEqual(["a"]);
    expect(ids({ rows: ready.queued.shown })).toEqual(["b"]);
    expect(ids({ rows: ready.held })).toEqual(["c"]);
    expect(ready.seatedElsewhere).toBe(1);
    expect(ready.total).toBe(3);
  });

  it("is refused exactly when the Next list is", () => {
    const rows = boardRows({ rows: [{ slug: "a", ...said({ minute: 1, words: "x" }) }] });
    expect(steerStandingOf({ reconcile: reconcile({ fleet: "unavailable" }), rows, shown: 10 })).toEqual({
      kind: "unavailable",
      why: "the reconcile reading could not observe the fleet, so which rows already have a seat cannot be told",
    });
    expect(
      steerStandingOf({ reconcile: reconcile({ ready: [ranked({ id: "a" }), ranked({ id: "a" })] }), rows, shown: 10 }),
    ).toEqual({
      kind: "unavailable",
      why: "the board carries a on more than one ready row, so the order cannot be drawn without guessing which",
    });
  });
});

describe("steerStateWords", () => {
  it("says a queued steer's place and what is ahead, in ordinals and counts", () => {
    expect(
      steerStateWords({
        state: { ahead: 2, aheadYours: 1, kind: "queued", of: 406, position: 3, priority: "p1" },
      }),
    ).toEqual({
      line: "3rd of 406 in the order nobody is on yet (p1): 2 rows ahead of it, 1 of them yours",
      tag: "queued 3rd",
    });
    expect(
      steerStateWords({ state: { ahead: 0, aheadYours: 0, kind: "queued", of: 1, position: 1, priority: "p0" } }).line,
    ).toBe("1st of 1 in the order nobody is on yet (p0): nothing ahead of it");
  });

  it("names the seats on a working steer, and a seat whose row waits on the owner", () => {
    expect(steerStateWords({ state: { kind: "working", sessions: ["workspace:408"], standing: "in-flight" } })).toEqual(
      { line: "a seat is on it (workspace:408)", tag: "working" },
    );
    expect(
      steerStateWords({
        state: { kind: "working", sessions: ["workspace:4", "workspace:9"], standing: "waiting-on-owner" },
      }),
    ).toEqual({ line: "2 seats are on it (workspace:4, workspace:9), and it is waiting on you", tag: "asking you" });
  });

  it("words each held standing, and an unknown one as the verb printed it", () => {
    expect(steerStateWords({ state: { kind: "held", standing: "waiting-on-owner" } }).tag).toBe("waiting on you");
    expect(steerStateWords({ state: { kind: "held", standing: "in-flight" } }).tag).toBe("started, nobody on it");
    expect(steerStateWords({ state: { kind: "held", standing: "retired-chair" } })).toEqual({
      line: "held: retired-chair",
      tag: "retired-chair",
    });
  });
});

describe("ordinal", () => {
  it("spells the teens and the tens apart", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 111, 112, 196].map((n) => ordinal({ n }))).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "111th",
      "112th",
      "196th",
    ]);
  });
});

describe("quotesBySlug and wordsBeside", () => {
  it("quotes a row's words with their anchor by slug and leaves out a slug two rows share", () => {
    const rows = boardRows({
      rows: [
        { slug: "a", ...said({ minute: 1, words: "the owner's words" }) },
        { slug: "b", ...said({ minute: 2, words: "one" }) },
        { slug: "b", ...said({ minute: 3, words: "two" }) },
        { slug: "c" },
      ],
    });
    expect([...quotesBySlug({ rows })]).toEqual([
      [
        "a",
        {
          anchor: "talk-call:anchor-a",
          atIso: "2026-10-05T03:01:00.000Z",
          cut: "none",
          where: "call",
          words: "the owner's words",
        },
      ],
    ]);
  });

  it("draws words only for a source that holds them", () => {
    const rows = boardRows({ rows: [{ slug: "a", ...said({ minute: 1, words: "the owner's words" }) }] });
    const view = steerStandingOf({ reconcile: reconcile({}), rows, shown: 10 });
    expect(wordsBeside({ source: steer({ id: "a", view }).source })).toBe("the owner's words");
    expect(wordsBeside({ source: { kind: "none", origin: "a fleet finding", steers: [] } })).toBe(undefined);
  });
});
