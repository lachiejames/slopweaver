/*
 * The Fleet page's three views: which view an address names, what the fleet works on next in the board's own order
 * with every seated row subtracted, and what settled while still on the board. Board rows are driven through
 * `readBoard`, so a reader that stops carrying a field the views read fails here too.
 */
import { describe, expect, it } from "vitest";

import { type BoardRow, readBoard } from "../../components/live/read";
import type { AutonomyRow } from "../../components/live/readAutonomy";
import type { Outcome, Placed, RankedRow, Reconcile } from "../../components/live/readWorkstreams";
import {
  type FleetBoardRead,
  fleetViewOf,
  foldAt,
  type NextUpView,
  nextUpOf,
  pastOf,
  waitedWords,
} from "../../lib/fleetViews";

/** A ranked ready row as the reconcile reading prints one. */
const ranked = ({ id, priority = "p1", waitingHours = 3 }: { id: string; priority?: string; waitingHours?: number }) =>
  ({
    groomed: true,
    id,
    kind: "ask",
    label: `do ${id}`,
    openedIso: "2026-10-03T06:00:00.000Z",
    priority,
    ready: true,
    standing: "ready",
    waitingHours,
  }) satisfies RankedRow;

/** A live session placed on a row. */
const placed = ({ id }: { id: string }): Placed => ({ rank: 1, row: ranked({ id }), session: `seat-${id}` });

/** The slice of a reconcile reading Next reads, observed and empty unless a test says otherwise. */
const reconcile = (
  over: Partial<Pick<Reconcile, "aligned" | "fleet" | "misaligned" | "outcomes" | "ready" | "unprioritised">>,
): Pick<Reconcile, "aligned" | "fleet" | "misaligned" | "outcomes" | "ready" | "unprioritised"> => ({
  aligned: [],
  fleet: "observed",
  misaligned: [],
  outcomes: [],
  ready: [],
  unprioritised: [],
  ...over,
});

/** One standing outcome holding these ready rows unspawned. */
const outcome = ({ title, ids }: { title: string; ids: readonly string[] }): Outcome => ({
  anchor: "transcript:a#b",
  id: title,
  live: [],
  rows: ids.length,
  title,
  unspawned: ids.map((id) => ranked({ id })),
});

/** Board rows as `handover list --json` publishes them, read back through the console's own reader. */
function boardRows({ rows }: { rows: readonly Record<string, unknown>[] }): readonly BoardRow[] {
  const board = readBoard({
    rows: rows.map((over) => ({
      kind: "ask",
      ownerWait: "not-waiting",
      priority: "p1",
      reason: "ready to run",
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

/** A board read that arrived holding these rows. */
const readyBoard = ({ rows }: { rows: readonly Record<string, unknown>[] }): FleetBoardRead => ({
  kind: "ready",
  rows: boardRows({ rows }),
});

const LOADING: FleetBoardRead = { kind: "loading" };

/** The rows of a Next view that read, above and below the fold together. */
function rowsOf({ view }: { view: NextUpView }) {
  if (view.kind !== "ready") {
    throw new Error(`expected a ready Next view, got: ${view.why}`);
  }
  return [...view.rows.shown, ...view.rows.folded];
}

describe("fleetViewOf", () => {
  it("names each of the three views", () => {
    expect(fleetViewOf({ param: "past" })).toBe("past");
    expect(fleetViewOf({ param: "now" })).toBe("now");
    expect(fleetViewOf({ param: "next" })).toBe("next");
  });

  it("opens on now when the address names no view, or one it does not know", () => {
    expect(fleetViewOf({ param: null })).toBe("now");
    expect(fleetViewOf({ param: "future" })).toBe("now");
    expect(fleetViewOf({ param: "" })).toBe("now");
  });
});

describe("waitedWords", () => {
  it("prints hours under two days and adds days past it", () => {
    expect(waitedWords({ hours: 7 })).toBe("7h");
    expect(waitedWords({ hours: 47 })).toBe("47h");
    expect(waitedWords({ hours: 296 })).toBe("296h (12.3d)");
  });
});

describe("foldAt", () => {
  it("cuts exactly at the count and keeps every row", () => {
    expect(foldAt({ rows: [1, 2, 3], shown: 2 })).toEqual({ folded: [3], shown: [1, 2] });
    expect(foldAt({ rows: [1, 2], shown: 2 })).toEqual({ folded: [], shown: [1, 2] });
    expect(foldAt({ rows: [], shown: 2 })).toEqual({ folded: [], shown: [] });
  });
});

describe("nextUpOf", () => {
  it("keeps the board's order and subtracts a row a seat is on from any of the three placement lists", () => {
    const view = nextUpOf({
      board: LOADING,
      reconcile: reconcile({
        aligned: [placed({ id: "b" })],
        misaligned: [placed({ id: "d" })],
        ready: ["a", "b", "c", "d", "e", "f"].map((id) => ranked({ id })),
        unprioritised: [placed({ id: "e" })],
      }),
      shown: 10,
    });
    expect(rowsOf({ view }).map((row) => [row.position, row.id])).toEqual([
      [1, "a"],
      [2, "c"],
      [3, "f"],
    ]);
    expect(view).toMatchObject({ kind: "ready", seated: 3 });
  });

  it("folds every row past the count and says nothing is next on an empty ready set", () => {
    const view = nextUpOf({
      board: LOADING,
      reconcile: reconcile({ ready: ["a", "b", "c"].map((id) => ranked({ id })) }),
      shown: 2,
    });
    expect(view).toMatchObject({ kind: "ready", seated: 0 });
    const ready = view as Extract<NextUpView, { kind: "ready" }>;
    expect(ready.rows.shown.map((row) => row.id)).toEqual(["a", "b"]);
    expect(ready.rows.folded.map((row) => row.id)).toEqual(["c"]);
    expect(nextUpOf({ board: LOADING, reconcile: reconcile({}), shown: 2 })).toEqual({
      kind: "ready",
      rows: { folded: [], shown: [] },
      seated: 0,
    });
  });

  it("refuses when the reading did not observe the fleet, or predates saying so", () => {
    const unobserved = nextUpOf({
      board: LOADING,
      reconcile: reconcile({ fleet: "unavailable", ready: [ranked({ id: "a" })] }),
      shown: 10,
    });
    expect(unobserved).toEqual({
      kind: "unavailable",
      why: "the reconcile reading could not observe the fleet, so which rows already have a seat cannot be told",
    });
    const old = nextUpOf({
      board: LOADING,
      reconcile: reconcile({ fleet: undefined, ready: [ranked({ id: "a" })] }),
      shown: 10,
    });
    expect(old.kind).toBe("unavailable");
    expect((old as Extract<NextUpView, { kind: "unavailable" }>).why).toContain("predates");
  });

  it("refuses a ready set that carries one id twice rather than guessing which row a seat is on", () => {
    const view = nextUpOf({
      board: LOADING,
      reconcile: reconcile({ ready: [ranked({ id: "a" }), ranked({ id: "b" }), ranked({ id: "a" })] }),
      shown: 10,
    });
    expect(view).toEqual({
      kind: "unavailable",
      why: "the board carries a on more than one ready row, so the order cannot be drawn without guessing which",
    });
  });

  it("names each outcome a row serves once, in the reading's outcome order", () => {
    const view = nextUpOf({
      board: LOADING,
      reconcile: reconcile({
        outcomes: [
          outcome({ ids: ["a"], title: "Voice" }),
          outcome({ ids: ["a", "b"], title: "ISO" }),
          outcome({ ids: ["a"], title: "Voice" }),
        ],
        ready: [ranked({ id: "a" }), ranked({ id: "b" }), ranked({ id: "c" })],
      }),
      shown: 10,
    });
    expect(rowsOf({ view }).map((row) => row.outcomeTitles)).toEqual([["Voice", "ISO"], ["ISO"], []]);
  });

  it("keeps a board still loading, a board not measured, and a row the board lacks or doubles apart", () => {
    const ready = reconcile({ ready: [ranked({ id: "a" }), ranked({ id: "b" })] });
    expect(rowsOf({ view: nextUpOf({ board: LOADING, reconcile: ready, shown: 10 }) })[0].source).toEqual({
      kind: "reading",
    });
    expect(
      rowsOf({
        view: nextUpOf({ board: { kind: "not-measured", why: "timed out" }, reconcile: ready, shown: 10 }),
      })[0].source,
    ).toEqual({ kind: "not-measured", why: "timed out" });
    const joined = rowsOf({
      view: nextUpOf({ board: readyBoard({ rows: [{ slug: "b" }, { slug: "b" }] }), reconcile: ready, shown: 10 }),
    });
    expect(joined.map((row) => row.source)).toEqual([{ kind: "missing-row" }, { kind: "duplicate-row", matches: 2 }]);
  });

  it("carries the owner's held words, and an unread one as unreadable, off the board row", () => {
    const view = nextUpOf({
      board: readyBoard({
        rows: [
          {
            anchor: "talk:abc",
            ownerWords: {
              anchor: "talk:abc",
              atIso: "2026-10-03T09:01:55.316Z",
              cut: "none",
              where: "console-voice",
              words: "what is the order",
            },
            slug: "a",
          },
          { anchor: "talk:def", ownerWordsUnread: "the call log is gone", slug: "b" },
        ],
      }),
      reconcile: reconcile({ ready: [ranked({ id: "a" }), ranked({ id: "b" })] }),
      shown: 10,
    });
    const [first, second] = rowsOf({ view });
    expect(first.source).toMatchObject({
      kind: "read",
      source: { kind: "words", quote: { where: "console-voice", words: "what is the order" } },
    });
    expect(second.source).toEqual({
      kind: "read",
      source: {
        anchor: "talk:def",
        kind: "unreadable",
        steers: [],
        subject: "b",
        why: [{ lead: "its record would not read", why: "the call log is gone" }],
      },
    });
  });

  it("marks a band default only when the board says it was backfilled", () => {
    const view = nextUpOf({
      board: readyBoard({ rows: [{ priorityFrom: "default", slug: "a" }, { slug: "b" }] }),
      reconcile: reconcile({ ready: [ranked({ id: "a" }), ranked({ id: "b" })] }),
      shown: 10,
    });
    expect(rowsOf({ view }).map((row) => row.defaultPriority)).toEqual([true, false]);
  });
});

describe("pastOf", () => {
  /** An autonomy act, newest first as the register prints them. */
  const act = ({ actionId }: { actionId: string }): AutonomyRow => ({
    actionId,
    doneIso: "2026-10-03T08:00:00.000Z",
    directSteer: undefined,
    kind: "merge",
    patternFrom: undefined,
    rule: undefined,
    run: undefined,
    said: `merged ${actionId}`,
    standing: undefined,
    steer: undefined,
    subject: `pr ${actionId}`,
    why: "green and gold",
    witness: undefined,
  });

  it("draws settled rows newest first, slug breaking a tie, and counts the ones with no readable instant", () => {
    const rows = boardRows({
      rows: [
        { movedIso: "2026-10-02T10:00:00.000Z", reason: "answered at #1", section: "DONE", slug: "old" },
        { movedIso: "2026-10-03T09:00:00.000Z", reason: "answered at #2", section: "DONE", slug: "tie-b" },
        { movedIso: "2026-10-03T09:00:00.000Z", reason: "answered at #3", section: "DONE", slug: "tie-a" },
        { reason: "declared done", section: "DONE", slug: "untimed" },
        { movedIso: "2026-10-03T09:30:00.000Z", section: "RUN NOW", slug: "still-open" },
      ],
    });
    const view = pastOf({ acts: [], rows, shown: 2 });
    expect(view.settled.shown.map((row) => [row.id, row.reason])).toEqual([
      ["tie-a", "answered at #3"],
      ["tie-b", "answered at #2"],
    ]);
    expect(view.settled.folded.map((row) => row.id)).toEqual(["old"]);
    expect(view.settledUntimed).toBe(1);
  });

  it("keeps the autonomy ledger in the register's order and folds past the count", () => {
    const view = pastOf({ acts: ["c", "b", "a"].map((actionId) => act({ actionId })), rows: [], shown: 2 });
    expect(view.acts.shown.map((row) => row.actionId)).toEqual(["c", "b"]);
    expect(view.acts.folded.map((row) => row.actionId)).toEqual(["a"]);
    expect(view.settled).toEqual({ folded: [], shown: [] });
    expect(view.settledUntimed).toBe(0);
  });
});
