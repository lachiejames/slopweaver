/*
 * The workstreams page's own half of "where is each item, what is ready, what is blocked".
 *
 * `src/handover/reconcile.ts` decides which rows may enter the top band and which are held, and
 * `src/__tests__/unit/handover/reconcile.test.ts` pins that. What is pinned here is what the PAGE does with
 * the answer: that it DEGRADES to a stated gap when an older producer left the grouping fields out rather
 * than blanking the whole tile — while a list that is PRESENT and will not read is still a refusal, since an
 * absent field is a vintage and a broken one is a defect — that it joins the verb's four placement lists
 * into one seat list in the verb's own order and words, and that it groups held rows by the verb's standing
 * rather than by anything it worked out.
 *
 * The last one is the defect this file exists for. The tile used to draw the verb's top band and label
 * every unattended row in it "nobody" — and measured on one tick, that band was one
 * contradiction, one in-flight row, two paused rows and one parked on the owner, so it reported five rows nobody
 * was on and nobody COULD be on. The live check is `slopweaver handover reconcile --json | jq '[.starving[]
 * | {id, standing, ready}]'`, where every entry must read `ready` — `src/handover/reconcile.ts`'s header
 * owns the anchor for that tick and the command that reads its kept document. A page that derived its own
 * sections from `ready` plus a priority would rebuild the band exactly, so the grouping has to arrive
 * already made.
 *
 * It sits under `site/__tests__/unit/` because a file under `src/` may not import one outside it (TS6059,
 * the CI `compile` job); the unit lane reaches both roots.
 */

import { describe, expect, it } from "vitest";

import {
  fleetClaim,
  heldByStanding,
  partitionClaim,
  type Reconcile,
  readReconcile,
  readyFold,
  SHOWN,
  seatsOf,
  starvingWords,
} from "../../components/live/readWorkstreams";

/** One ranked row as the verb prints it, with `ready` agreeing with `standing` the way the verb derives it. */
function rowDoc({
  id,
  standing,
  priority = "p1",
}: {
  id: string;
  standing: string;
  priority?: string;
}): Record<string, unknown> {
  return {
    groomed: true,
    id,
    kind: "ask",
    label: `what about ${id}`,
    openedIso: "2026-09-15T00:00:00.000Z",
    priority,
    ready: standing === "ready",
    standing,
    waitingHours: 208,
  };
}

/** One placement as the verb prints it. */
function placedDoc({
  session,
  rank,
  row,
}: {
  session: string;
  rank: number;
  row: Record<string, unknown>;
}): Record<string, unknown> {
  return { rank, row, session };
}

/** The intake half, in its read arm, so the whole document parses. */
const INTAKE_DOC = {
  finding: { inGrace: 0, markedNoAsk: 0, sinceIso: "2026-09-21T00:00:00.000Z", unwitnessed: [], witnessed: 2 },
  inbound: { answered: 1, read: 3, unanswered: [] },
  kind: "read",
};

/** A document of the shape the owner saw, cut down: a held row per standing, plus the seats a tick holds. */
const DOCUMENT: Record<string, unknown> = {
  aligned: [
    placedDoc({ rank: 1, row: rowDoc({ id: "loop-c", priority: "p0", standing: "in-flight" }), session: "ws:183" }),
  ],
  fleet: "observed",
  headline: "1 of 4 live session(s) are on the board's top 3",
  held: [
    rowDoc({ id: "paused-a", standing: "paused" }),
    rowDoc({ id: "paused-b", standing: "paused" }),
    rowDoc({ id: "parked", standing: "waiting-on-owner" }),
    rowDoc({ id: "retired-chair", standing: "blocked" }),
  ],
  intake: INTAKE_DOC,
  intakeClause: "every turn of the owner's is witnessed.",
  misaligned: [placedDoc({ rank: 40, row: rowDoc({ id: "lower", standing: "in-flight" }), session: "ws:200" })],
  outcomeSource: { kind: "absent" },
  outcomes: [],
  rankedCount: 9,
  ready: [rowDoc({ id: "atlas-a", standing: "ready" }), rowDoc({ id: "atlas-b", standing: "ready" })],
  source: "cmux",
  staleAsks: [],
  starving: [rowDoc({ id: "atlas-a", standing: "ready" }), rowDoc({ id: "atlas-b", standing: "ready" })],
  top: [
    rowDoc({ id: "loop-c", priority: "p0", standing: "in-flight" }),
    rowDoc({ id: "atlas-a", standing: "ready" }),
    rowDoc({ id: "atlas-b", standing: "ready" }),
  ],
  uncoveredOutcomes: [],
  ungroomed: 2,
  unprioritised: [placedDoc({ rank: 77, row: rowDoc({ id: "unplaced", standing: "in-flight" }), session: "ws:210" })],
  unregistered: ["ws:220"],
};

/**
 * The same document with one key removed — the shape an older seat in the one shared home writes, since
 * every checkout ticks into it and the readings ledger carries as many vintages of the verb as there are
 * seats.
 */
function without({ key }: { key: string }): Record<string, unknown> {
  const copy = { ...DOCUMENT };
  delete copy[key];
  return copy;
}

describe("readReconcile", () => {
  it("reads the fields the page's grouping rests on", () => {
    const read = readReconcile(DOCUMENT)!;

    expect(read.fleet).toBe("observed");
    expect(read.held!.map((row) => row.id)).toEqual(["paused-a", "paused-b", "parked", "retired-chair"]);
    expect(read.top.map((row) => row.standing)).toEqual(["in-flight", "ready", "ready"]);
  });

  it("keeps the reading when only some hold lists are present, carrying the holds as malformed", () => {
    const read = readReconcile({ ...DOCUMENT, repolessRows: [] })!;

    expect(read.top.map((row) => row.standing)).toEqual(["in-flight", "ready", "ready"]);
    expect(read.holds).toEqual({
      kind: "malformed",
      named: [],
      repos: [],
      why: "it carries some hold lists but not supersededSupervisors, sharedSlugs, trunkMovedRows, trunkUnread, trunkPullsUnchecked",
    });
  });

  it("still reads a reading whose producer published no `held`, leaving the split unstated", () => {
    const older = readReconcile(without({ key: "held" }))!;

    expect(older.held).toBeUndefined();
    expect(older.starving.map((row) => row.id)).toEqual(["atlas-a", "atlas-b"]);
  });

  it("still reads a reading whose producer published no `fleet`, leaving what it observed unstated", () => {
    const older = readReconcile(without({ key: "fleet" }))!;

    expect(older.fleet).toBeUndefined();
    expect(older.rankedCount).toBe(9);
  });

  it("refuses a HELD row carrying no standing, which would make the page invent a grouping word", () => {
    const noStanding = {
      ...DOCUMENT,
      held: [{ ...rowDoc({ id: "paused-a", standing: "paused" }), standing: undefined }],
    };

    expect(readReconcile(noStanding)).toBeUndefined();
  });

  it("refuses a held list that will not read, which is a defect rather than an older vintage", () => {
    const noId = { ...DOCUMENT, held: [{ ...rowDoc({ id: "paused-a", standing: "paused" }), id: undefined }] };

    expect(readReconcile(noId)).toBeUndefined();
  });

  // The key's PRESENCE decides the outcome, not whether it decoded: a `held` that is null, an object, or an
  // array with a non-object in it all read as absent through the bag helper, and reporting any of them to
  // the page as an older producer is the same conflation one container level up.
  it("refuses a held key that is PRESENT and is not a list of rows at all", () => {
    expect(readReconcile({ ...DOCUMENT, held: null })).toBeUndefined();
    expect(readReconcile({ ...DOCUMENT, held: {} })).toBeUndefined();
    expect(readReconcile({ ...DOCUMENT, held: [null] })).toBeUndefined();
    expect(readReconcile({ ...DOCUMENT, held: "none" })).toBeUndefined();
  });

  // A sparse array is the one shape `every(isBag)` waves through, because `every` SKIPS holes — so the
  // reader was handed an `undefined` where it had been promised a row and THREW, blanking the page rather
  // than refusing the document. Closed in `site/lib/bag.ts` for every list, not just this one.
  it("refuses a held array with a HOLE in it rather than throwing on the row that is not there", () => {
    const sparse: unknown[] = [];
    sparse.length = 1;

    expect(readReconcile({ ...DOCUMENT, held: sparse })).toBeUndefined();
  });

  // The same class as the hole, one access along, found twice by two review passes: `Array.isArray` is true
  // of an array whose own `filter` has been overwritten, AND of one whose index is a throwing getter. Each
  // threw out of the reader and blanked the page rather than refusing the one document. Both are closed in
  // `site/lib/bag.ts` — the first by reading the list by index, the second by bounding the read itself,
  // because "an array cannot shadow X" was a claim that turned out to be false twice running.
  it("refuses a held array whose own `filter` is not callable, rather than throwing on the call", () => {
    const shadowed = Object.assign([null], { filter: null });

    expect(readReconcile({ ...DOCUMENT, held: shadowed })).toBeUndefined();
  });

  it("refuses a held array whose index THROWS, rather than letting it escape into the page", () => {
    const throwing = Object.defineProperty([], "0", {
      get: () => {
        throw new Error("unreadable held[0]");
      },
    });

    expect(readReconcile({ ...DOCUMENT, held: throwing })).toBeUndefined();
  });

  // A key present with the value `undefined` cannot come out of `JSON.parse`, so the only way to build one
  // is in memory — which makes it a caller's bug rather than an older producer, and refusing is the same
  // answer as for every other present-but-unreadable `held`.
  it("refuses a held key present with an undefined value, which no parsed document can carry", () => {
    expect(readReconcile({ ...DOCUMENT, held: undefined })).toBeUndefined();
  });

  it("refuses a reading missing a field EVERY vintage has published, so a real gap is still a refusal", () => {
    expect(readReconcile(without({ key: "starving" }))).toBeUndefined();
  });
});

/** One kept outcome row, as reconcile projects it off the owner's Workstreams register. */
const OUTCOME_ROW = {
  anchor: "talk-call:abc#turn_1",
  id: "n901",
  live: [],
  rows: 1,
  title: "ABC-1 ships",
  unspawned: [],
  words: "ship ABC-1",
};

// A reconciliation written before the owner's outcomes had one source carries rows from the deleted coded register and
// no `outcomeSource`. Read, it would put those outcomes on Fleet and the Board as if the owner had kept them.
describe("readReconcile's outcome source", () => {
  it("reads outcomes only under a present source whose count is the rows it carries", () => {
    const read = readReconcile({ ...DOCUMENT, outcomeSource: { count: 1, kind: "present" }, outcomes: [OUTCOME_ROW] })!;

    expect(read.outcomes.map((outcome) => outcome.id)).toEqual(["n901"]);
  });

  it("reads an absent source carrying no rows, which is a fresh install with nothing kept yet", () => {
    expect(readReconcile(DOCUMENT)!.outcomes).toEqual([]);
  });

  it("refuses a reconciliation from before the one source, which names no outcomeSource", () => {
    expect(readReconcile({ ...without({ key: "outcomeSource" }), outcomes: [OUTCOME_ROW] })).toBeUndefined();
  });

  it("refuses an absent source that still carries rows", () => {
    expect(readReconcile({ ...DOCUMENT, outcomes: [OUTCOME_ROW] })).toBeUndefined();
  });

  it("refuses a present source whose count disagrees with its rows", () => {
    expect(
      readReconcile({ ...DOCUMENT, outcomeSource: { count: 2, kind: "present" }, outcomes: [OUTCOME_ROW] }),
    ).toBeUndefined();
  });

  it("refuses a source of a kind reconcile never writes, or one carrying a stray key", () => {
    expect(readReconcile({ ...DOCUMENT, outcomeSource: { kind: "coded" } })).toBeUndefined();
    expect(readReconcile({ ...DOCUMENT, outcomeSource: { count: 0, kind: "absent" } })).toBeUndefined();
  });
});

describe("seatsOf", () => {
  const read: Reconcile = readReconcile(DOCUMENT)!;

  it("joins the verb's four placement lists into one, top band first and unregistered last", () => {
    expect(seatsOf({ reconcile: read }).map((seat) => seat.session)).toEqual(["ws:183", "ws:200", "ws:210", "ws:220"]);
  });

  it("carries one fixed phrase per placement list, the same for every session on it", () => {
    expect(seatsOf({ reconcile: read }).map((seat) => seat.where)).toEqual([
      "on the board's top 3",
      "lower down",
      "on an unplaced row",
      "on nothing the board knows",
    ]);
  });

  it("gives a session on nothing the board claims no row and no rank, rather than a placeholder row", () => {
    const last = seatsOf({ reconcile: read }).at(-1)!;

    expect(last.row).toBeUndefined();
    expect(last.rank).toBeUndefined();
  });

  it("carries the row and its rank for a placed session, so the page never has to look one up", () => {
    const first = seatsOf({ reconcile: read }).at(0)!;

    expect(first.rank).toBe(1);
    expect(first.row!.id).toBe("loop-c");
  });

  it("is empty when no session is live, which is what lets the tile say idle rather than show nothing", () => {
    const idle = readReconcile({ ...DOCUMENT, aligned: [], misaligned: [], unprioritised: [], unregistered: [] })!;

    expect(seatsOf({ reconcile: idle })).toEqual([]);
  });
});

describe("heldByStanding", () => {
  const read: Reconcile = readReconcile(DOCUMENT)!;

  it("groups by the verb's own standing word, biggest group first", () => {
    expect(
      heldByStanding({ held: read.held! }).map((group) => `${group.standing}:${String(group.rows.length)}`),
    ).toEqual(["paused:2", "waiting-on-owner:1", "blocked:1"]);
  });

  it("keeps every held row, so the groups add back up to what the verb published", () => {
    const grouped = heldByStanding({ held: read.held! }).flatMap((group) => group.rows.map((row) => row.id));

    expect(grouped.toSorted()).toEqual(["parked", "paused-a", "paused-b", "retired-chair"]);
  });

  it("is empty when nothing is held", () => {
    expect(heldByStanding({ held: [] })).toEqual([]);
  });
});

describe("starvingWords", () => {
  it("calls the top band's unattended rows READY off a reading that carries `held`", () => {
    const read: Reconcile = readReconcile(DOCUMENT)!;

    expect(starvingWords({ reconcile: read })).toEqual({
      long: "top-band rows ready with nobody on them",
      short: "ready, nobody on it",
    });
  });

  it("refuses the word `ready` off an older producer, because `starving` still means merely groomed there", () => {
    const older: Reconcile = readReconcile(without({ key: "held" }))!;
    const words = starvingWords({ reconcile: older });

    expect(words).toEqual({
      long: "top-band rows with nobody on them (this reading is too old to say they are ready)",
      short: "on the top band, nobody on it",
    });
    expect(words.long.includes("ready with nobody")).toBe(false);
  });
});

describe("fleetClaim", () => {
  it("says the seats were observed when the reading says so", () => {
    expect(fleetClaim({ reconcile: readReconcile(DOCUMENT)! })).toBe("observed");
  });

  it("says a producer that never published the field claims nothing either way", () => {
    expect(fleetClaim({ reconcile: readReconcile(without({ key: "fleet" }))! })).toBe("predates-field");
  });

  it("says the seats are open runs rather than sessions when the fleet could not be read", () => {
    expect(fleetClaim({ reconcile: readReconcile({ ...DOCUMENT, fleet: "unavailable" })! })).toBe("not-observed");
  });
});

describe("readyFold", () => {
  // The defect this replaced: the fold was `ready` minus `starving` under the flat words "below the top
  // band". A `RUN NOW` row a session is already sitting on is in `top` AND in `ready` AND in neither list
  // the band draws, so it fell into that fold wearing a label its own reading contradicts.
  const seated = rowDoc({ id: "seated-runnable", standing: "ready" });
  const lower = rowDoc({ id: "lower-runnable", standing: "ready" });

  it("folds nothing when every ready row is already open above the fold", () => {
    const fold = readyFold({ reconcile: readReconcile(DOCUMENT)! });

    expect(fold.rows).toEqual([]);
    expect(fold.summary).toBe("and 0 more ready, below the top band");
    expect(fold.past).toBeUndefined();
    expect([fold.foldedIds, fold.pastIds]).toEqual([[], []]);
  });

  // The cut lives in the fold rather than in the renderer: the sentence past it is a claim about a count
  // like every other one here, and nothing in the lanes mounts a component that could be asked about it.
  it("shows the first SHOWN rows and says, in its own words, how many it did not", () => {
    const many = Array.from({ length: SHOWN + 3 }, (_unused, index) =>
      rowDoc({ id: `r${String(index)}`, standing: "ready" }),
    );
    const doc = { ...DOCUMENT, ready: [...(DOCUMENT["ready"] as unknown[]), ...many] };
    const fold = readyFold({ reconcile: readReconcile(doc)! });

    expect(fold.rows.map((row) => row.id)).toEqual(["r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7"]);
    expect(fold.past).toBe("and 3 more, in `slopweaver handover list`");
    expect(fold.summary).toBe("and 11 more ready, below the top band");
    // The ids the page counts marks over: every folded one on the closed fold, the three past the cut on its line.
    expect(fold.pastIds).toEqual(["r8", "r9", "r10"]);
    expect(fold.foldedIds).toHaveLength(SHOWN + 3);
  });

  it("keeps every row it has when the fold is exactly the cut, so no count is printed past it", () => {
    const many = Array.from({ length: SHOWN }, (_unused, index) =>
      rowDoc({ id: `r${String(index)}`, standing: "ready" }),
    );
    const doc = { ...DOCUMENT, ready: [...(DOCUMENT["ready"] as unknown[]), ...many] };
    const fold = readyFold({ reconcile: readReconcile(doc)! });

    expect(fold.rows.length).toBe(SHOWN);
    expect(fold.past).toBeUndefined();
  });

  it("says `below the top band` only of rows the reading does not put on the band", () => {
    const doc = { ...DOCUMENT, ready: [...(DOCUMENT["ready"] as unknown[]), lower] };
    const fold = readyFold({ reconcile: readReconcile(doc)! });

    expect(fold.rows.map((row) => row.id)).toEqual(["lower-runnable"]);
    expect(fold.summary).toBe("and 1 more ready, below the top band");
  });

  it("refuses `below the top band` for a band row a session is on, which is the label the reading denies", () => {
    const doc = {
      ...DOCUMENT,
      ready: [...(DOCUMENT["ready"] as unknown[]), seated],
      top: [...(DOCUMENT["top"] as unknown[]), seated],
    };
    const fold = readyFold({ reconcile: readReconcile(doc)! });

    expect(fold.rows.map((row) => row.id)).toEqual(["seated-runnable"]);
    expect(fold.summary).toBe("and 1 more ready, on the top band with a session already on it");
    expect(fold.summary.includes("below the top band")).toBe(false);
  });

  it("names both groups when the fold holds one of each, rather than asserting the commoner one over both", () => {
    const doc = {
      ...DOCUMENT,
      ready: [...(DOCUMENT["ready"] as unknown[]), seated, lower],
      top: [...(DOCUMENT["top"] as unknown[]), seated],
    };
    const fold = readyFold({ reconcile: readReconcile(doc)! });

    expect(fold.rows.map((row) => row.id)).toEqual(["seated-runnable", "lower-runnable"]);
    expect(fold.summary).toBe("and 2 more ready: 1 below the top band, 1 on it with a session already on them");
  });
});

describe("partitionClaim", () => {
  it("carries the held rows on the arm that says the reading can be split", () => {
    const claim = partitionClaim({ reconcile: readReconcile(DOCUMENT)! });

    expect(claim.kind).toBe("split");
    expect(claim).toEqual({
      held: readReconcile(DOCUMENT)!.held,
      kind: "split",
    });
  });

  it("says an older producer's reading cannot be split, so the page draws neither section", () => {
    expect(partitionClaim({ reconcile: readReconcile(without({ key: "held" }))! })).toEqual({
      kind: "unsplittable",
    });
  });
});
