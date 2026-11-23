import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  completeThrough,
  joinBatch,
  type PropagationBatch,
  type PropagationRecord,
  parsePropagationBatch,
  parsePropagationRecord,
  passSlugOf,
  pendingSyncs,
  propagationIdOf,
  reseatBatch,
  seatNeed,
} from "../../../../live/resync/propagationBatch.js";
import { PropagationErrors } from "../../../../live/resync/propagationErrors.js";

const NOW = "2026-09-27T14:30:00.000Z";

function record({
  recipeId = "resync-corpus-github",
  syncFinishedAtIso = "2026-09-27T14:20:00.000Z",
  ...over
}: Partial<PropagationRecord> = {}): PropagationRecord {
  return {
    propagatedAtIso: "2026-09-27T14:21:00.000Z",
    propagationId: propagationIdOf({ recipeId, syncFinishedAtIso }),
    recipeId,
    schemaVersion: 1,
    source: "github",
    surfaces: [{ detail: "the pass decides", status: "judgement", surface: "workstreams" }],
    syncFinishedAtIso,
    ...over,
  };
}

/** A batch opened by one sync and joined by a second. */
function twoSyncBatch(): PropagationBatch {
  const first = joinBatch({ active: null, batchId: "abcdef0123456789", nowIso: NOW, record: record() });
  return joinBatch({
    active: first.batch,
    batchId: "unused",
    nowIso: NOW,
    record: record({ recipeId: "resync-corpus-slack", source: "slack" }),
  }).batch;
}

describe("propagationIdOf", () => {
  it("is stable for one sync and differs between two", () => {
    const one = propagationIdOf({ recipeId: "resync-corpus-github", syncFinishedAtIso: NOW });
    expect(one).toBe(propagationIdOf({ recipeId: "resync-corpus-github", syncFinishedAtIso: NOW }));
    expect(one).toMatch(/^[0-9a-f]{16}$/);
    expect(one).not.toBe(propagationIdOf({ recipeId: "resync-corpus-slack", syncFinishedAtIso: NOW }));
  });
});

describe("passSlugOf", () => {
  it("names the pass by day and the batch id's first eight characters", () => {
    expect(passSlugOf({ batchId: "BCDEF0123456789A", nowIso: NOW })).toBe(
      "corpus-propagation-pass-2026-09-27-bcdef012",
    );
  });
});

describe("joinBatch", () => {
  it("OPENS a batch when none is open, at revision 1, unseated", () => {
    const joined = joinBatch({ active: null, batchId: "abcdef0123456789", nowIso: NOW, record: record() });
    expect([joined.opened, joined.repeat, joined.batch.revision, joined.batch.doneThrough]).toEqual([
      true,
      false,
      1,
      0,
    ]);
    expect(joined.batch.seat).toEqual({
      lastProblem: null,
      registeredAtIso: null,
      seatedAtIso: null,
      slug: "corpus-propagation-pass-2026-09-27-abcdef01",
    });
  });

  it("JOINS an open batch without opening another, bumping the revision", () => {
    const batch = twoSyncBatch();
    expect(batch.revision).toBe(2);
    expect(batch.covered.map((sync) => [sync.recipeId, sync.revision])).toEqual([
      ["resync-corpus-github", 1],
      ["resync-corpus-slack", 2],
    ]);
    expect(batch.seat.slug).toBe("corpus-propagation-pass-2026-09-27-abcdef01");
  });

  it("is idempotent on one sync: a repeat changes nothing", () => {
    const batch = twoSyncBatch();
    const again = joinBatch({ active: batch, batchId: "unused", nowIso: NOW, record: record() });
    expect([again.repeat, again.opened]).toEqual([true, false]);
    expect(again.batch).toEqual(batch);
  });
});

describe("seatNeed", () => {
  it("is unseated until a seat is stamped", () => {
    expect(seatNeed({ batch: twoSyncBatch(), batchId: "b", nowIso: NOW, session: "gone" })).toEqual({
      kind: "unseated",
    });
  });

  it("LAPSES only when the seated workspace is gone with syncs pending — never on age, never on silence", () => {
    const opened = twoSyncBatch();
    const seated: PropagationBatch = { ...opened, seat: { ...opened.seat, seatedAtIso: NOW } };
    const laterIso = "2026-09-28T02:00:00.000Z";
    expect(
      (["open", "unknown"] as const).map((session) =>
        seatNeed({ batch: seated, batchId: "b", nowIso: laterIso, session }),
      ),
    ).toEqual([{ kind: "seated" }, { kind: "seated" }]);
    expect(seatNeed({ batch: seated, batchId: "99887766aa", nowIso: laterIso, session: "gone" })).toEqual({
      kind: "lapsed",
      slug: "corpus-propagation-pass-2026-09-28-99887766",
    });
    const confirmed: PropagationBatch = { ...seated, doneThrough: 2 };
    expect(seatNeed({ batch: confirmed, batchId: "b", nowIso: laterIso, session: "gone" })).toEqual({
      kind: "seated",
    });
  });
});

describe("reseatBatch", () => {
  it("clears every seat stage under the fresh slug, keeping what the batch covers", () => {
    const opened = twoSyncBatch();
    const reseated = reseatBatch({
      batch: { ...opened, seat: { ...opened.seat, registeredAtIso: NOW, seatedAtIso: NOW } },
      slug: "fresh",
    });
    expect(reseated.seat).toEqual({ lastProblem: null, registeredAtIso: null, seatedAtIso: null, slug: "fresh" });
    expect(reseated.covered).toEqual(opened.covered);
  });
});

describe("completeThrough", () => {
  it("confirms through the revision read and reports a sync that joined after it", () => {
    const done = unwrap(completeThrough({ batch: twoSyncBatch(), batchId: "abcdef0123456789", through: 1 }));
    expect(done.batch.doneThrough).toBe(1);
    expect(done.remaining.map((sync) => sync.recipeId)).toEqual(["resync-corpus-slack"]);
  });

  it("leaves nothing pending once confirmed through the head", () => {
    const done = unwrap(completeThrough({ batch: twoSyncBatch(), batchId: "abcdef0123456789", through: 2 }));
    expect(pendingSyncs({ batch: done.batch })).toEqual([]);
  });

  it("never moves the confirmation backwards", () => {
    const batch: PropagationBatch = { ...twoSyncBatch(), doneThrough: 2 };
    expect(unwrap(completeThrough({ batch, batchId: "abcdef0123456789", through: 1 })).batch.doneThrough).toBe(2);
  });

  it("refuses a revision the batch has not reached, which a stale read would name", () => {
    expect(unwrapErr(completeThrough({ batch: twoSyncBatch(), batchId: "abcdef0123456789", through: 3 }))).toEqual(
      PropagationErrors.revisionAhead({ revision: 2, through: 3 }),
    );
  });

  it("refuses a batch other than the open one, whose revisions count from 1 again", () => {
    expect(unwrapErr(completeThrough({ batch: twoSyncBatch(), batchId: "retired0000000000", through: 1 }))).toEqual(
      PropagationErrors.batchMismatch({ expected: "abcdef0123456789", got: "retired0000000000" }),
    );
  });

  it("refuses zero and a fraction", () => {
    expect(
      [0, 1.5].map(
        (through) =>
          unwrapErr(completeThrough({ batch: twoSyncBatch(), batchId: "abcdef0123456789", through })).message,
      ),
    ).toEqual([
      "--through-revision must be a positive whole number, not 0",
      "--through-revision must be a positive whole number, not 1.5",
    ]);
  });
});

describe("parsing", () => {
  it("round-trips a record and a batch through JSON", () => {
    const batch = twoSyncBatch();
    expect(unwrap(parsePropagationRecord({ value: JSON.parse(JSON.stringify(record())) }))).toEqual(record());
    expect(unwrap(parsePropagationBatch({ value: JSON.parse(JSON.stringify(batch)) }))).toEqual(batch);
  });

  it("refuses a batch naming a source this build does not have", () => {
    const batch = twoSyncBatch();
    const bad = { ...batch, covered: [{ ...batch.covered[0]!, source: "nowhere" }] };
    expect(unwrapErr(parsePropagationBatch({ value: bad }))[0]).toContain("covered.0.source");
  });

  it("refuses a record carrying a field it does not declare", () => {
    expect(unwrapErr(parsePropagationRecord({ value: { ...record(), extra: 1 } }))[0]).toContain("extra");
  });
});
