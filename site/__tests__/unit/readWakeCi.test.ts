/*
 * The Fleet page's reader of the tick's wake reading: which rows read, which refuse the whole reading, and which park
 * each row names. The words those rows become are `parkedWaits.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { isJournalIndex } from "../../components/live/readParkedWake";
import { readWakeCi, readWakeReading } from "../../components/live/readWakeReading";
import {
  boardOf,
  CLOCK_AT,
  clockRow,
  due,
  JUDGED_AT,
  PARKED_AT,
  parked,
  wakeCiOf,
  wakeRow,
} from "./parkedWaitsFixtures";

describe("readWakeCi", () => {
  it("reads every CI park's state, and of a clock park only whether the wake retired it", () => {
    expect(
      readWakeCi({
        observedAtIso: JUDGED_AT,
        rows: [
          wakeRow({ judgement: due({ number: 1, prState: "MERGED" }), number: 1, slug: "a" }),
          wakeRow({ judgement: { kind: "not-judged", reason: "paused" }, number: 2, slug: "b" }),
          clockRow({ slug: "c" }),
          clockRow({ action: "spawned", slug: "d" }),
        ],
      }),
    ).toEqual({
      observedAtIso: JUDGED_AT,
      retiredClocks: [{ atIso: CLOCK_AT, parkIndex: 3, parkedAtIso: PARKED_AT, slug: "d" }],
      rows: [
        { number: 1, parkIndex: 3, parkedAtIso: PARKED_AT, repo: "o/r", slug: "a", retired: false, state: "merged" },
        { number: 2, parkIndex: 3, parkedAtIso: PARKED_AT, repo: "o/r", slug: "b", retired: false, state: "unknown" },
      ],
    });
  });

  it('reads the envelope `reading last --producer "handover wake" --json` prints, the states aged by the report stamp', () => {
    // The ledger stamps the envelope once the wake has finished every reseat, up to half an hour after it
    // read the pull requests; the value carries the report's own instant, which is the one the page ages.
    const payload = {
      by: "tick-8",
      bytes: 100,
      document: {
        observedAtIso: JUDGED_AT,
        rows: [wakeRow({ judgement: due({ number: 1, prState: "CLOSED" }), number: 1, slug: "a" })],
      },
      observedAtIso: "2026-11-09T12:28:34.644Z",
      producer: "handover wake",
      readingId: "2026-11-09T12:28:34.645Z-handover-wake",
      recordedAtIso: "2026-11-09T12:28:34.645Z",
    };
    expect(readWakeReading(payload)).toEqual({
      by: "tick-8",
      observedAtIso: "2026-11-09T12:28:34.644Z",
      readingId: "2026-11-09T12:28:34.645Z-handover-wake",
      recordedAtIso: "2026-11-09T12:28:34.645Z",
      value: {
        observedAtIso: JUDGED_AT,
        retiredClocks: [],
        rows: [
          { number: 1, parkIndex: 3, parkedAtIso: PARKED_AT, repo: "o/r", slug: "a", retired: false, state: "closed" },
        ],
      },
    });
  });

  it("refuses a reading whose instants are out of order, each on its own, and keeps one in order", () => {
    // The park is journalled, then the wake judges it, then the ledger observes and records
    // the report. A reading with any of those reversed is not this board's, however exact its rows.
    const envelope = ({
      judgedAtIso = JUDGED_AT,
      observedAtIso = "2026-10-17T02:50:00.000Z",
      recordedAtIso = "2026-10-17T02:50:00.000Z",
    }: {
      judgedAtIso?: string;
      observedAtIso?: string;
      recordedAtIso?: string;
    }): unknown => ({
      by: "tick-8",
      bytes: 100,
      document: {
        observedAtIso: judgedAtIso,
        rows: [wakeRow({ judgement: due({ number: 1, prState: "MERGED" }), number: 1, slug: "a" })],
      },
      observedAtIso,
      producer: "handover wake",
      readingId: "r",
      recordedAtIso,
    });
    const before = "2026-10-17T01:00:00.000Z";
    expect(
      [
        {},
        { judgedAtIso: PARKED_AT, observedAtIso: PARKED_AT, recordedAtIso: PARKED_AT },
        { judgedAtIso: before, observedAtIso: before, recordedAtIso: before },
        { observedAtIso: before },
        { recordedAtIso: before },
        { judgedAtIso: "2026-10-17T02:55:00.000Z" },
        { recordedAtIso: "soon" },
        // The park after the wake that judged it, both before the ledger stamped it.
        { judgedAtIso: "2026-10-17T01:59:59.999Z" },
      ].map((over) => readWakeReading(envelope(over))?.value.rows.length),
    ).toEqual([1, 1, undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("refuses a wake document carrying no instant of its own, or one that does not parse", () => {
    const rows = [wakeRow({ judgement: due({ number: 1, prState: "CLOSED" }), number: 1, slug: "a" })];
    expect([
      readWakeCi({ rows }),
      readWakeCi({ observedAtIso: "soon", rows }),
      readWakeCi({ observedAtIso: 7, rows }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("refuses every stamp naming no real instant, though the calendar it rolls over to would order", () => {
    // `Date.parse` reads the thirtieth of February as the second of March, which would join and name a state.
    const reading = ({
      ciParkedAt = "2026-03-02T02:00:00.000Z",
      clockParkedAt = "2026-03-02T02:00:00.000Z",
      judgedAtIso = "2026-03-03T02:00:00.000Z",
      observedAtIso = "2026-03-03T03:00:00.000Z",
      recordedAtIso = "2026-03-03T03:00:00.000Z",
    }: {
      ciParkedAt?: string;
      clockParkedAt?: string;
      judgedAtIso?: string;
      observedAtIso?: string;
      recordedAtIso?: string;
    }): unknown => ({
      by: "tick-8",
      bytes: 100,
      document: {
        observedAtIso: judgedAtIso,
        rows: [
          wakeRow({
            judgement: { kind: "not-due", reason: "running" },
            number: 1,
            parkedAtIso: ciParkedAt,
            slug: "a",
          }),
          clockRow({ atIso: "2026-03-04T00:00:00Z", parkedAtIso: clockParkedAt, slug: "b" }),
        ],
      },
      observedAtIso,
      producer: "handover wake",
      readingId: "r",
      recordedAtIso,
    });
    const rolled = { day: "2026-02-30T02:00:00.000Z", later: "2026-02-31T03:00:00.000Z" };
    expect(
      [
        {},
        { ciParkedAt: rolled.day },
        { clockParkedAt: rolled.day },
        { judgedAtIso: "2026-02-31T02:00:00.000Z" },
        { observedAtIso: rolled.later },
        { recordedAtIso: rolled.later },
      ].map((over) => readWakeReading(reading(over))?.value.rows.length),
    ).toEqual([1, undefined, undefined, undefined, undefined, undefined]);
    // The board's own stamp is held to the same rule, so its park is never joined on one.
    const [row] = boardOf({
      rows: [
        { parked: { ...parked({ wake: { kind: "checks", number: 1, repo: "o/r" } }), atIso: rolled.day }, slug: "a" },
      ],
    });
    expect([row.parkedAtIso, boardOf({ rows: [{ parked: parked({}), slug: "a" }] })[0].parkedAtIso]).toEqual([
      undefined,
      PARKED_AT,
    ]);
  });

  it("refuses a reading from before the wake stamped each row's park", () => {
    const unstamped = {
      judgement: { kind: "not-due", reason: "" },
      slug: "a",
      wake: { kind: "checks", number: 1, repo: "o/r" },
    };
    expect(readWakeCi({ observedAtIso: JUDGED_AT, rows: [unstamped] })).toBe(undefined);
    expect(readWakeCi({ observedAtIso: JUDGED_AT, rows: [{ ...unstamped, parkedAtIso: PARKED_AT }] })).toBe(undefined);
    expect(
      [-1, 1.5, "3", 4_294_967_295].map((parkIndex) =>
        readWakeCi({ observedAtIso: JUDGED_AT, rows: [{ ...unstamped, parkIndex, parkedAtIso: PARKED_AT }] }),
      ),
    ).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("takes as a journal index exactly what `events.indexOf` can answer for a found park", () => {
    // 2^32 - 1 is no array index, so no journal event can sit there.
    expect(
      [0, 3, 4_294_967_294, 4_294_967_295, -1, 1.5, Number.NaN, "3"].map((value) => isJournalIndex(value)),
    ).toEqual([true, true, true, false, false, false, false, false]);
  });

  it("refuses the whole reading when one CI row will not read, rather than calling it absent", () => {
    const bad: readonly unknown[] = [
      wakeRow({ judgement: due({ number: 1, prState: "DRAFT" }), number: 1, slug: "a" }),
      wakeRow({ judgement: { kind: "soon" }, number: 1, slug: "a" }),
      // A due judgement observing another pull request is never this park's state.
      wakeRow({ judgement: due({ number: 999, prState: "MERGED" }), number: 1, slug: "a" }),
      // Only `due` carries an observation, so a `not-due` naming one is not the wire and never "running".
      wakeRow({
        judgement: {
          kind: "not-due",
          observed: { kind: "checks", number: 2, prState: "OPEN", repo: "x/r" },
          reason: "",
        },
        number: 1,
        slug: "a",
      }),
      wakeRow({ judgement: { kind: "not-due" }, number: 1, slug: "a" }),
      // An OPEN observation carries its head and checks digest, and a merged or closed one neither.
      wakeRow({
        judgement: { kind: "due", observed: { kind: "checks", number: 1, prState: "OPEN", repo: "o/r" }, reason: "" },
        number: 1,
        slug: "a",
      }),
      wakeRow({
        judgement: {
          kind: "due",
          observed: { headSha: "abc", kind: "checks", number: 1, prState: "MERGED", repo: "o/r" },
          reason: "",
        },
        number: 1,
        slug: "a",
      }),
      // Every arm is held to its exact field set, so nothing rides beside a reason or an observation.
      wakeRow({ judgement: { kind: "not-due", mergeCommitOid: "abc", reason: "" }, number: 1, slug: "a" }),
      wakeRow({ judgement: { kind: "unknown", reason: "", retry: true }, number: 1, slug: "a" }),
      wakeRow({
        judgement: {
          kind: "due",
          observed: { fingerprint: "f", headSha: "h", kind: "checks", number: 1, prState: "OPEN", repo: "o/r", x: 1 },
          reason: "",
        },
        number: 1,
        slug: "a",
      }),
      // A merged read's merge commit is a string, and no other read carries one.
      wakeRow({
        judgement: {
          kind: "due",
          mergeCommitOid: 7,
          observed: { kind: "checks", number: 1, prState: "MERGED", repo: "o/r" },
          reason: "",
        },
        number: 1,
        slug: "a",
      }),
      wakeRow({
        judgement: {
          kind: "due",
          mergeCommitOid: "abc",
          observed: { kind: "checks", number: 1, prState: "CLOSED", repo: "o/r" },
          reason: "",
        },
        number: 1,
        slug: "a",
      }),
      { judgement: { kind: "not-due", reason: "" }, slug: "a", wake: { kind: "checks", number: "1", repo: "o/r" } },
      { judgement: { kind: "not-due", reason: "" }, wake: { kind: "checks", number: 1, repo: "o/r" } },
    ];
    expect(bad.map((row) => readWakeCi({ observedAtIso: JUDGED_AT, rows: [row] }))).toEqual(bad.map(() => undefined));
    expect(readWakeCi({ observedAtIso: JUDGED_AT, rows: "none" })).toBe(undefined);
  });

  it("refuses a row carrying no action, or one `WakeRowReport` does not declare", () => {
    const judgement = { kind: "not-due", reason: "" };
    expect(
      [undefined, "reseated", 7, "none"].map(
        (action) =>
          readWakeCi({
            observedAtIso: JUDGED_AT,
            rows: [{ ...(wakeRow({ judgement, number: 1, slug: "a" }) as object), action }],
          })?.rows,
      ),
    ).toEqual([
      undefined,
      undefined,
      undefined,
      [{ number: 1, parkIndex: 3, parkedAtIso: PARKED_AT, repo: "o/r", retired: false, slug: "a", state: "running" }],
    ]);
  });

  it("refuses any action on a judgement kind its producers never pair it with", () => {
    // A finish, deferral or reseat follows only a due judgement, a pause or a clear only a park never
    // judged, and only `none` carries any; a paused row carrying a merged judgement would word a park the wake skipped.
    const notDue = { kind: "not-due", reason: "" };
    const notJudged = { kind: "not-judged", reason: "the row is paused" };
    const merged = due({ number: 1, prState: "MERGED" });
    const pairs: readonly [string, unknown][] = [
      ["spawned", notDue],
      ["finished", { kind: "unknown", reason: "" }],
      ["park-cleared", merged],
      ["paused-skipped", merged],
      ["would-clear", notDue],
      ["due-deferred", notJudged],
      ["wake-journal-failed", notDue],
      ["spawned", merged],
      ["park-cleared", notJudged],
      ["paused-skipped", notJudged],
      ["none", merged],
      ["none", notJudged],
    ];
    expect(
      pairs
        .map(([action, judgement]) => wakeRow({ action, judgement, number: 1, slug: "a" }))
        .map((row) => readWakeCi({ observedAtIso: JUDGED_AT, rows: [row] })?.rows[0]?.state),
    ).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "merged",
      "unknown",
      "unknown",
      "merged",
      "unknown",
    ]);
  });

  it("marks retired exactly the rows whose park was gone once the wake was done, a failed spawn either way", () => {
    // A failed spawn may have journalled its dispatch and cleared the park, or left it; the action alone
    // cannot say, so the row's parkStanding does.
    const merged = due({ number: 1, prState: "MERGED" });
    const failed = ["gone", "standing"].map((parkStanding) =>
      wakeRow({ action: "spawn-failed", judgement: merged, number: 1, parkStanding, slug: "a" }),
    );
    expect(failed.map((row) => readWakeCi({ observedAtIso: JUDGED_AT, rows: [row] })?.rows[0]?.retired)).toEqual([
      true,
      false,
    ]);
  });

  it("reads a suspended wake's row as a merged park still standing, rather than refusing the whole reading", () => {
    // `handover wake` suspends a due merged park whose run waits only on the owner's question; the park stays.
    const merged = due({ number: 1, prState: "MERGED" });
    const rows = ["would-suspend", "wake-suspended"].map((action) =>
      readWakeCi({
        observedAtIso: JUDGED_AT,
        rows: [wakeRow({ action, judgement: merged, number: 1, parkStanding: "standing", slug: "a" })],
      }),
    );
    expect(rows.map((reading) => reading?.rows.map(({ retired, state }) => [retired, state]))).toEqual([
      [[false, "merged"]],
      [[false, "merged"]],
    ]);
  });

  it("refuses a row whose park standing is unknown, undeclared or absent", () => {
    // Its journal did not re-read whole, or the producer predates the field: either way the page cannot say whether a
    // board read before the wake still holds the park.
    const merged = due({ number: 1, prState: "MERGED" });
    expect(
      ["unknown", "parked", undefined, "standing"].map(
        (parkStanding) =>
          readWakeCi({
            observedAtIso: JUDGED_AT,
            rows: [{ ...(wakeRow({ judgement: merged, number: 1, slug: "a" }) as object), parkStanding }],
          })?.rows.length,
      ),
    ).toEqual([undefined, undefined, undefined, 1]);
  });

  it("marks retired by default exactly the rows whose wake reseated, settled or cleared the park", () => {
    const actions = ["spawned", "finished", "park-cleared", "would-spawn", "would-finish", "spawn-failed", "none"];
    const judgementOf = ({ action, number }: { action: string; number: number }): unknown => {
      if (action === "park-cleared") {
        return { kind: "not-judged", reason: "finished" };
      }
      return due({ number, prState: "MERGED" });
    };
    const rows = actions.map((action, index) =>
      wakeRow({ action, judgement: judgementOf({ action, number: index + 1 }), number: index + 1, slug: action }),
    );
    expect(wakeCiOf({ rows }).rows.map((row) => [row.slug, row.retired])).toEqual([
      ["spawned", true],
      ["finished", true],
      ["park-cleared", true],
      ["would-spawn", false],
      ["would-finish", false],
      ["spawn-failed", false],
      ["none", false],
    ]);
  });

  it("refuses the whole reading when a CLOCK park in it was journalled after the report, carries no identity, or names no real instant", () => {
    // A clock row is the board's to word, but a document holding any park later than its own judgement
    // is not this board's, so its CI rows are not either.
    const ci = wakeRow({ judgement: due({ number: 1, prState: "MERGED" }), number: 1, slug: "ci" });
    const unstamped = {
      action: "none",
      judgement: { kind: "not-due", reason: "" },
      parkStanding: "standing",
      slug: "c",
      wake: { atIso: "2026-10-17T05:00:00Z", kind: "at" },
    };
    expect(
      [
        clockRow({ slug: "c" }),
        clockRow({ parkedAtIso: "2026-10-17T03:00:00.000Z", slug: "c" }),
        clockRow({ parkedAtIso: "soon", slug: "c" }),
        unstamped,
        // Held to the board's own wake rule, so a clock the board would call unread refuses here too.
        clockRow({ atIso: "not-an-instant", slug: "c" }),
        clockRow({ atIso: "2026-02-30T05:00:00Z", slug: "c" }),
        { ...(clockRow({ slug: "c" }) as object), wake: { atIso: CLOCK_AT, kind: "at", extra: 1 } },
        { ...(clockRow({ slug: "c" }) as object), wake: { kind: "checks", number: 0, repo: "o/r" } },
      ].map((clock) => readWakeCi({ observedAtIso: JUDGED_AT, rows: [ci, clock] })?.rows.length),
    ).toEqual([1, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});
