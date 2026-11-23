/*
 * The Fleet page's parked rows: what the working count leaves out (a count of only two working while
 * more are parked is misleading). Board rows are driven through `readBoard`, so a reader that stops carrying the
 * `parked.wake` the verb publishes fails here, and the words are asserted whole.
 */
import { describe, expect, it } from "vitest";

import { readWakeCi, type WakeCiReading } from "../../components/live/readWakeReading";
import { parkedWaitsOf } from "../../lib/parkedWaits";
import { boardOf, NOW_MS, parked, wakeOf } from "./parkedWaitsFixtures";

describe("a board row's parked wake", () => {
  it("reads a clock wake, with or without a fraction of a second", () => {
    expect(wakeOf({ over: { parked: parked({ wake: { atIso: "2026-10-17T03:13:00Z", kind: "at" } }) } })).toEqual([
      true,
      { atIso: "2026-10-17T03:13:00Z", kind: "at" },
    ]);
    expect(wakeOf({ over: { parked: parked({ wake: { atIso: "2026-10-17T03:13:00.500Z", kind: "at" } }) } })).toEqual([
      true,
      { atIso: "2026-10-17T03:13:00.500Z", kind: "at" },
    ]);
  });

  it("reads a checks wake", () => {
    const wake = { kind: "checks", number: 9877, repo: "acme/acme-admin" };
    expect(wakeOf({ over: { parked: parked({ wake }) } })).toEqual([true, wake]);
  });

  it("carries no wake on a row with no park, nor on a park that waits on the owner", () => {
    expect(wakeOf({ over: {} })).toEqual([false, undefined]);
    expect(wakeOf({ over: { parked: parked({}) } })).toEqual([false, undefined]);
  });

  it("reads a present wake that will not parse as unread, and keeps the row and the board", () => {
    const bad: readonly unknown[] = [
      { atIso: "2026-10-17T03:13:00+10:00", kind: "at" },
      { atIso: "2026-02-30T03:13:00Z", kind: "at" },
      { atIso: "2026-10-17T03:13:00Z", extra: 1, kind: "at" },
      { kind: "checks", number: 9877, repo: "acme-admin" },
      { kind: "checks", number: 0, repo: "acme/acme-admin" },
      { kind: "checks", number: 1.5, repo: "acme/acme-admin" },
      { kind: "checks", number: "9877", repo: "acme/acme-admin" },
      { kind: "soon" },
      "tomorrow",
      null,
    ];
    expect(bad.map((wake) => wakeOf({ over: { parked: parked({ wake }) } }))).toEqual(
      bad.map(() => [true, { kind: "unread" }]),
    );
  });

  it("reads a parked checkpoint that is no object as unread", () => {
    expect(wakeOf({ over: { parked: "yes" } })).toEqual([true, { kind: "unread" }]);
  });
});

describe("parkedWaitsOf", () => {
  it("draws no line and no row when nothing is parked on a clock or CI", () => {
    const rows = boardOf({ rows: [{ slug: "working-row" }, { parked: parked({}), slug: "parked-on-owner" }] });
    expect(parkedWaitsOf({ nowMs: NOW_MS, rows, wakeCi: undefined })).toEqual({ lines: [], waits: [] });
  });

  it("says one row parked on CI in the singular, titled by its summary's first clause", () => {
    const rows = boardOf({
      rows: [
        {
          parked: parked({ wake: { kind: "checks", number: 9877, repo: "acme/acme-admin" } }),
          slug: "land-the-pool-fix",
          summary: "Land the pool fix: the staging pool exhausts under the nightly load.",
        },
      ],
    });
    expect(parkedWaitsOf({ nowMs: NOW_MS, rows, wakeCi: undefined })).toEqual({
      lines: ["1 more is parked on CI no wake reading has measured, closed until it wakes."],
      waits: [
        {
          detail: "wakes when CI on acme/acme-admin#9877 finishes",
          key: "land-the-pool-fix@0",
          slug: "land-the-pool-fix",
          title: "Land the pool fix",
          wake: { kind: "checks", number: 9877, repo: "acme/acme-admin" },
        },
      ],
    });
  });

  it("orders clock wakes by instant, then CI, then unread, each in board order, and names the next clock wake", () => {
    const rows = boardOf({
      rows: [
        { parked: parked({ wake: { kind: "checks", number: 2, repo: "o/r" } }), slug: "ci-first" },
        { parked: parked({ wake: { kind: "soon" } }), slug: "unread-one" },
        { parked: parked({ wake: { atIso: "2026-10-18T05:00:00Z", kind: "at" } }), slug: "clock-late" },
        { parked: parked({ wake: { kind: "checks", number: 1, repo: "o/r" } }), slug: "ci-second" },
        { parked: parked({ wake: { atIso: "2026-10-17T03:25:00Z", kind: "at" } }), slug: "clock-soon" },
      ],
    });
    const view = parkedWaitsOf({ nowMs: NOW_MS, rows, wakeCi: undefined });
    expect(view.lines).toEqual([
      "5 more are parked, closed until they wake: 2 on a clock, 2 on CI no wake reading has measured, 1 with a wake that did not read.",
      "The next clock wake is 03:25Z, in 25m.",
    ]);
    expect(view.waits.map((wait) => [wait.slug, wait.detail])).toEqual([
      ["clock-soon", "wakes at 03:25Z, in 25m"],
      ["clock-late", "wakes at 18 Oct 05:00Z, in 1d 2h"],
      ["ci-first", "wakes when CI on o/r#2 finishes"],
      ["ci-second", "wakes when CI on o/r#1 finishes"],
      ["unread-one", "what wakes it did not read"],
    ]);
  });

  it("says a clock wake already past is due, and that the next tick reseats it", () => {
    const rows = boardOf({
      rows: [{ parked: parked({ wake: { atIso: "2026-10-17T02:50:00Z", kind: "at" } }), slug: "clock-due" }],
    });
    expect(parkedWaitsOf({ nowMs: NOW_MS, rows, wakeCi: undefined })).toEqual({
      lines: [
        "1 more is parked on a clock, closed until it wakes.",
        "The next clock wake was due at 02:50Z; the next tick reseats it.",
      ],
      waits: [
        {
          detail: "due since 02:50Z, the next tick reseats it",
          key: "clock-due@0",
          slug: "clock-due",
          title: "clock-due",
          wake: { atIso: "2026-10-17T02:50:00Z", kind: "at" },
        },
      ],
    });
  });

  it("counts and keys apart two rows that share a slug, each by its board position", () => {
    const rows = boardOf({
      rows: [
        { parked: parked({ wake: { kind: "checks", number: 9, repo: "o/r" } }), slug: "other" },
        { parked: parked({ wake: { kind: "checks", number: 1, repo: "o/r" } }), slug: "dup" },
        { parked: parked({ wake: { kind: "checks", number: 2, repo: "o/r" } }), slug: "dup" },
      ],
    });
    const view = parkedWaitsOf({ nowMs: NOW_MS, rows, wakeCi: undefined });
    expect(view.lines).toEqual(["3 more are parked on CI no wake reading has measured, closed until they wake."]);
    expect(view.waits.map((wait) => wait.key)).toEqual(["other@0", "dup@1", "dup@2"]);
  });

  it("titles a row by its slug when the summary is missing, a slug or a paragraph", () => {
    const wake = { kind: "checks", number: 3, repo: "o/r" };
    const rows = boardOf({
      rows: [
        { parked: parked({ wake }), slug: "no-summary" },
        { parked: parked({ wake }), slug: "slug-summary", summary: "slug-summary" },
        { parked: parked({ wake }), slug: "long-summary", summary: `${"word ".repeat(30)}end` },
      ],
    });
    expect(parkedWaitsOf({ nowMs: NOW_MS, rows, wakeCi: undefined }).waits.map((wait) => wait.title)).toEqual([
      "no-summary",
      "slug-summary",
      "long-summary",
    ]);
  });
});

/** The instant every fixture park is journalled at, as `parked` writes it. */
const PARKED_AT = "2026-10-17T02:00:00.000Z";

/** When the fixture wake judged its rows — its report's own `observedAtIso`, after every fixture park and before the page's clock. */
const JUDGED_AT = "2026-10-17T02:45:00.000Z";

/** The actions after which a fixture park is gone by default, as the wake's own reseat, finish and clear leave it. */
const GONE_AFTER: ReadonlySet<unknown> = new Set(["spawned", "finished", "park-cleared"]);

/**
 * What a fixture row reports of its park once the wake was done: `gone` after a reseat, finish or clear, else
 * `standing`.
 *
 * @returns the row's default `parkStanding`
 */
function standingAfter({ action }: { action: unknown }): string {
  return GONE_AFTER.has(action) ? "gone" : "standing";
}

/** A `handover wake --json` row for one park, as the tick records it, stamped with the park it judged. */
function wakeRow({
  action = "none",
  judgement,
  number,
  parkIndex = 3,
  parkStanding = standingAfter({ action }),
  parkedAtIso = PARKED_AT,
  slug,
}: {
  slug: string;
  number: number;
  judgement: unknown;
  action?: unknown;
  parkIndex?: number;
  parkStanding?: unknown;
  parkedAtIso?: string;
}): unknown {
  return {
    action,
    detail: "",
    judgement,
    parkIndex,
    parkStanding,
    parkedAtIso,
    slug,
    wake: { kind: "checks", number, repo: "o/r" },
  };
}

/** The instant a fixture clock row's park was to wake at. */
const CLOCK_AT = "2026-10-17T05:00:00Z";

/** A `handover wake --json` row for one clock park, stamped like every row the wake reports. */
function clockRow({
  action = "none",
  atIso = CLOCK_AT,
  parkedAtIso = PARKED_AT,
  slug,
}: {
  slug: string;
  action?: string;
  atIso?: string;
  parkedAtIso?: string;
}): unknown {
  // A reseat follows only a due judgement, as the wake writes one.
  const judgement = action === "spawned" ? { kind: "due", reason: "" } : { kind: "not-due", reason: "" };
  return {
    action,
    detail: "",
    judgement,
    parkIndex: 3,
    parkStanding: standingAfter({ action }),
    parkedAtIso,
    slug,
    wake: { atIso, kind: "at" },
  };
}

/** A due judgement on a checks park whose pull request is in `prState`, observed in the wire's exact shape. */
function due({ number, prState }: { number: number; prState: string }): unknown {
  const head = prState === "OPEN" ? { fingerprint: "f", headSha: "abc" } : {};
  const mergeCommit = prState === "MERGED" ? { mergeCommitOid: "2fa140b4" } : {};
  return {
    kind: "due",
    observed: { kind: "checks", number, prState, repo: "o/r", ...head },
    reason: "",
    ...mergeCommit,
  };
}

/** The tick's wake document, read through the real reader. */
function wakeCiOf({ rows }: { rows: readonly unknown[] }): WakeCiReading {
  const read = readWakeCi({ observedAtIso: JUDGED_AT, rows });
  if (read === undefined) {
    throw new Error("the fixture wake document did not read");
  }
  return read;
}

describe("parkedWaitsOf, split by the tick's wake reading", () => {
  /** Six CI parks, one per state the wake reading can leave a park in, and one the reading never saw. */
  const rows = boardOf({
    rows: [1, 2, 3, 4, 5, 6].map((number) => ({
      parked: parked({ wake: { kind: "checks", number, repo: "o/r" } }),
      slug: `ci-${String(number)}`,
    })),
  });
  const wakeCi = wakeCiOf({
    rows: [
      wakeRow({ judgement: due({ number: 1, prState: "MERGED" }), number: 1, slug: "ci-1" }),
      wakeRow({ judgement: { kind: "not-due", reason: "" }, number: 2, slug: "ci-2" }),
      wakeRow({ judgement: due({ number: 3, prState: "CLOSED" }), number: 3, slug: "ci-3" }),
      wakeRow({ judgement: due({ number: 4, prState: "OPEN" }), number: 4, slug: "ci-4" }),
      wakeRow({ judgement: { kind: "unknown", reason: "" }, number: 5, slug: "ci-5" }),
      clockRow({ slug: "clock" }),
    ],
  });

  it("names how many still wait on running CI, and how many are already due, never one number twice", () => {
    expect(parkedWaitsOf({ nowMs: NOW_MS, rows, wakeCi }).lines).toEqual([
      "6 more are parked, closed until they wake: 1 on CI still running, 1 on an open pull request with no check still running, 1 on a pull request that has merged, 1 on a pull request closed unmerged, 2 on CI the last wake did not read.",
      "3 of them are due now: what they waited on already happened, so the next wake settles or reseats each.",
    ]);
  });

  it("orders the fold by state and says each pull request's state", () => {
    expect(parkedWaitsOf({ nowMs: NOW_MS, rows, wakeCi }).waits.map((wait) => [wait.slug, wait.detail])).toEqual([
      ["ci-2", "waits on CI on o/r#2, still running"],
      ["ci-4", "o/r#4 is open with no check still running; the next wake reseats it"],
      ["ci-1", "o/r#1 merged; the next wake settles or reseats it"],
      ["ci-3", "o/r#3 closed unmerged; the next wake reseats it"],
      ["ci-5", "wakes when CI on o/r#5 finishes; the last wake did not read it"],
      ["ci-6", "wakes when CI on o/r#6 finishes; the last wake did not read it"],
    ]);
  });

  it("says every park on a merged pull request as one clause", () => {
    const merged = boardOf({
      rows: [7, 8].map((number) => ({
        parked: parked({ wake: { kind: "checks", number, repo: "o/r" } }),
        slug: `m-${String(number)}`,
      })),
    });
    const reading = wakeCiOf({
      rows: [7, 8].map((number) =>
        wakeRow({ judgement: due({ number, prState: "MERGED" }), number, slug: `m-${String(number)}` }),
      ),
    });
    expect(parkedWaitsOf({ nowMs: NOW_MS, rows: merged, wakeCi: reading }).lines).toEqual([
      "2 more are parked on a pull request that has merged, closed until they wake.",
      "2 of them are due now: what they waited on already happened, so the next wake settles or reseats each.",
    ]);
  });

  it("never reads a park re-parked on another pull request off the old one's state", () => {
    const reparked = boardOf({
      rows: [{ parked: parked({ wake: { kind: "checks", number: 99, repo: "o/r" } }), slug: "ci-1" }],
    });
    expect(parkedWaitsOf({ nowMs: NOW_MS, rows: reparked, wakeCi }).lines).toEqual([
      "1 more is parked on CI the last wake did not read, closed until it wakes.",
    ]);
  });

  it("never reads a park re-parked on the SAME pull request off the earlier park's state, in either order", () => {
    const board = boardOf({
      rows: [{ parked: parked({ wake: { kind: "checks", number: 1, repo: "o/r" } }), slug: "ci-1" }],
    });
    const later = "2026-10-17T02:30:00.000Z";
    const olderPark = wakeCiOf({
      rows: [
        wakeRow({ judgement: due({ number: 1, prState: "MERGED" }), number: 1, parkedAtIso: later, slug: "ci-1" }),
      ],
    });
    expect(parkedWaitsOf({ nowMs: NOW_MS, rows: board, wakeCi: olderPark }).lines).toEqual([
      "1 more is parked on CI the last wake did not read, closed until it wakes.",
    ]);
  });

  it("never reads a park off another park of the same row journalled in the same millisecond", () => {
    // The instant alone aliases two parks of one slug; the journal index is the identity.
    const board = boardOf({
      rows: [{ parked: parked({ parkIndex: 7, wake: { kind: "checks", number: 1, repo: "o/r" } }), slug: "ci-1" }],
    });
    expect(parkedWaitsOf({ nowMs: NOW_MS, rows: board, wakeCi }).lines).toEqual([
      "1 more is parked on CI the last wake did not read, closed until it wakes.",
    ]);
  });

  it("leaves a board park carrying no journal index, or a malformed one, unmeasured", () => {
    const board = boardOf({
      rows: [undefined, -1, 1.5, "3", 4_294_967_295].map((parkIndex, at) => ({
        parked: { ...parked({ wake: { kind: "checks", number: 1, repo: "o/r" } }), parkIndex },
        slug: at === 0 ? "ci-1" : `ci-1-${String(at)}`,
      })),
    });
    expect(board.map((row) => Object.hasOwn(row, "parkIndex"))).toEqual([false, false, false, false, false]);
    expect(parkedWaitsOf({ nowMs: NOW_MS, rows: board.slice(0, 1), wakeCi }).lines).toEqual([
      "1 more is parked on CI the last wake did not read, closed until it wakes.",
    ]);
  });

  it("leaves a slug the board holds twice unmeasured, never one verdict for both", () => {
    const board = boardOf({
      rows: [1, 1].map((number) => ({
        parked: parked({ wake: { kind: "checks", number, repo: "o/r" } }),
        slug: "ci-1",
      })),
    });
    expect(parkedWaitsOf({ nowMs: NOW_MS, rows: board, wakeCi }).lines).toEqual([
      "2 more are parked on CI the last wake did not read, closed until they wake.",
    ]);
  });

  it("drops a park the wake reports gone though another row shares its slug, and says no state of the other", () => {
    // The gone match is exact on the park itself, so a second row of one slug cannot keep it counted.
    const later = "2026-10-17T06:00:00Z";
    const board = boardOf({
      rows: [
        { parked: parked({ parkIndex: 3, wake: { atIso: CLOCK_AT, kind: "at" } }), slug: "dup-clock" },
        { parked: parked({ parkIndex: 7, wake: { atIso: later, kind: "at" } }), slug: "dup-clock" },
        { parked: parked({ parkIndex: 3, wake: { kind: "checks", number: 1, repo: "o/r" } }), slug: "dup-ci" },
        { parked: parked({ parkIndex: 7, wake: { kind: "checks", number: 2, repo: "o/r" } }), slug: "dup-ci" },
      ],
    });
    const merged = due({ number: 1, prState: "MERGED" });
    const reading = wakeCiOf({
      rows: [
        clockRow({ action: "spawned", slug: "dup-clock" }),
        wakeRow({ action: "spawned", judgement: merged, number: 1, slug: "dup-ci" }),
        wakeRow({ judgement: due({ number: 2, prState: "MERGED" }), number: 2, parkIndex: 7, slug: "dup-ci" }),
      ],
    });
    expect(parkedWaitsOf({ nowMs: NOW_MS, rows: board, wakeCi: reading }).lines).toEqual([
      "2 more are parked, closed until they wake: 1 on a clock, 1 on CI the last wake did not read.",
      "2 more on this board are no longer parked: the last wake reseated or settled them after the board was read.",
      "The next clock wake is 06:00Z, in 3h 0m.",
    ]);
  });

  it("refuses a reading that names one park twice, CI or clock, and keeps two parks of one row", () => {
    // The wake reports each park once; a second exact retired clock row would otherwise undo the first.
    const retiredClock = clockRow({ action: "spawned", slug: "clock" });
    const documents: readonly (readonly unknown[])[] = [
      [
        wakeRow({ judgement: due({ number: 1, prState: "MERGED" }), number: 1, slug: "ci-1" }),
        wakeRow({ judgement: { kind: "not-due", reason: "" }, number: 1, slug: "ci-1" }),
      ],
      [retiredClock, retiredClock],
      [clockRow({ slug: "ci-1" }), wakeRow({ judgement: { kind: "not-due", reason: "" }, number: 1, slug: "ci-1" })],
      [
        wakeRow({ judgement: { kind: "not-due", reason: "" }, number: 1, slug: "ci-1" }),
        wakeRow({ judgement: { kind: "not-due", reason: "" }, number: 1, parkIndex: 7, slug: "ci-1" }),
      ],
    ];
    expect(documents.map((reported) => readWakeCi({ observedAtIso: JUDGED_AT, rows: reported })?.rows.length)).toEqual([
      undefined,
      undefined,
      undefined,
      2,
    ]);
  });

  it("never counts as parked a park the wake retired after this board was read, nor as due", () => {
    // The board is read once, so a wake finishing after it can already have reseated a park it still holds.
    const board = boardOf({
      rows: [1, 2].map((number) => ({
        parked: parked({ wake: { kind: "checks", number, repo: "o/r" } }),
        slug: `ci-${String(number)}`,
      })),
    });
    const reading = wakeCiOf({
      rows: [
        wakeRow({ judgement: { kind: "not-due", reason: "" }, number: 1, slug: "ci-1" }),
        wakeRow({ action: "spawned", judgement: due({ number: 2, prState: "OPEN" }), number: 2, slug: "ci-2" }),
      ],
    });
    const waits = parkedWaitsOf({ nowMs: NOW_MS, rows: board, wakeCi: reading });
    expect(waits.lines).toEqual([
      "1 more is parked on CI still running, closed until it wakes.",
      "1 more on this board is no longer parked: the last wake reseated or settled it after the board was read.",
    ]);
    expect(waits.waits.map((wait) => [wait.slug, wait.detail])).toEqual([
      ["ci-1", "waits on CI on o/r#1, still running"],
      [
        "ci-2",
        "parked on o/r#2 until the last wake reseated or settled it, after this board was read; the next board read drops it",
      ],
    ]);
  });

  it("draws only the retired line when every park on the board was retired", () => {
    const board = boardOf({
      rows: [{ parked: parked({ wake: { kind: "checks", number: 1, repo: "o/r" } }), slug: "ci-1" }],
    });
    const reading = wakeCiOf({
      rows: [
        wakeRow({ action: "finished", judgement: due({ number: 1, prState: "MERGED" }), number: 1, slug: "ci-1" }),
      ],
    });
    expect(parkedWaitsOf({ nowMs: NOW_MS, rows: board, wakeCi: reading }).lines).toEqual([
      "1 more on this board is no longer parked: the last wake reseated or settled it after the board was read.",
    ]);
  });

  it("never counts a park the wake CLEARED, though a cleared park is never judged", () => {
    const board = boardOf({
      rows: [{ parked: parked({ wake: { kind: "checks", number: 1, repo: "o/r" } }), slug: "ci-1" }],
    });
    const reading = wakeCiOf({
      rows: [
        wakeRow({
          action: "park-cleared",
          judgement: { kind: "not-judged", reason: "the run is finished" },
          number: 1,
          slug: "ci-1",
        }),
      ],
    });
    expect(parkedWaitsOf({ nowMs: NOW_MS, rows: board, wakeCi: reading }).lines).toEqual([
      "1 more on this board is no longer parked: the last wake reseated or settled it after the board was read.",
    ]);
  });

  it("never counts a CLOCK park the wake reseated, nor says its clock wake is next, joined on the park and its instant", () => {
    // The clock's state is the board's, but a board read before the wake still holds the reseated park.
    const dueAt = "2026-10-17T02:30:00.000Z";
    const board = boardOf({
      rows: [
        { parked: parked({ wake: { atIso: dueAt, kind: "at" } }), slug: "due-clock" },
        { parked: parked({ wake: { atIso: CLOCK_AT, kind: "at" } }), slug: "later-clock" },
      ],
    });
    const reading = wakeCiOf({
      rows: [clockRow({ action: "spawned", atIso: dueAt, slug: "due-clock" }), clockRow({ slug: "later-clock" })],
    });
    const waits = parkedWaitsOf({ nowMs: NOW_MS, rows: board, wakeCi: reading });
    expect(waits.lines).toEqual([
      "1 more is parked on a clock, closed until it wakes.",
      "1 more on this board is no longer parked: the last wake reseated or settled it after the board was read.",
      "The next clock wake is 05:00Z, in 2h 0m.",
    ]);
    expect(waits.waits.map((wait) => [wait.slug, wait.detail])).toEqual([
      ["later-clock", "wakes at 05:00Z, in 2h 0m"],
      [
        "due-clock",
        "was to wake at 02:30Z; the last wake reseated it after this board was read, and the next board read drops it",
      ],
    ]);
    // Another instant, index or slug is another park, so the board's own clock stands.
    const elsewhere = [
      clockRow({ action: "spawned", slug: "due-clock" }),
      { ...(clockRow({ action: "spawned", atIso: dueAt, slug: "due-clock" }) as object), parkIndex: 4 },
      clockRow({ action: "spawned", atIso: dueAt, slug: "other" }),
    ];
    expect(
      elsewhere.map(
        (row) => parkedWaitsOf({ nowMs: NOW_MS, rows: board.slice(0, 1), wakeCi: wakeCiOf({ rows: [row] }) }).lines[0],
      ),
    ).toEqual(elsewhere.map(() => "1 more is parked on a clock, closed until it wakes."));
  });
});
