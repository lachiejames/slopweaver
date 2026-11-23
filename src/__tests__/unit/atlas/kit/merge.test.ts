import { describe, expect, it } from "vitest";

import { absentAs } from "#lib/absent.js";
import { mergeKind } from "../../../../atlas/kit/merge.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-08-27T00:00:00.000Z";

interface Row {
  readonly id: string;
  readonly firstSeenAt: string;
  readonly state: "observed" | "stale";
  readonly detail: string;
}

function row({ id, detail = "d" }: { id: string; detail?: string }): Row {
  return { detail, firstSeenAt: AT, id, state: "observed" };
}

/** The single-surface fold: replace by id, preserving only the original first-seen stamp. */
function replaceFold({ stored, observed, at }: { stored: Row | undefined; observed: Row; at: string }): Result<Row> {
  return ok({ ...observed, firstSeenAt: absentAs({ value: stored?.firstSeenAt, whenAbsent: at }), state: "observed" });
}

/** Mark an observed row stale; leave an already-stale one exactly as it is. */
function staleRow({ stored }: { stored: Row }): Row | null {
  return stored.state === "stale" ? null : { ...stored, state: "stale" };
}

describe("mergeKind", () => {
  it("preserves the stored first-seen stamp rather than the fresh one", () => {
    const stored = [row({ id: "a" })];
    const observed = [{ ...row({ id: "a", detail: "new" }), firstSeenAt: "2026-09-01T00:00:00.000Z" }];
    const result = unwrap(
      mergeKind({ at: "2026-09-01T00:00:00.000Z", foldEntity: replaceFold, observed, staleEntity: staleRow, stored }),
    );
    expect(result.length).toBe(1);
    expect(result[0]!.firstSeenAt).toBe(AT);
    expect(result[0]!.detail).toBe("new");
  });

  it("stales a stored entity that this run did not observe", () => {
    const stored = [row({ id: "a" }), row({ id: "b" })];
    const result = unwrap(
      mergeKind({ at: AT, foldEntity: replaceFold, observed: [row({ id: "a" })], staleEntity: staleRow, stored }),
    );
    expect(result.length).toBe(2);
    expect(result[0]!.state).toBe("observed");
    expect(result[1]!.state).toBe("stale");
  });

  it("leaves an already-stale entity untouched when the seam returns null", () => {
    const stored = [{ ...row({ id: "b" }), state: "stale" as const, detail: "kept" }];
    const result = unwrap(mergeKind({ at: AT, foldEntity: replaceFold, observed: [], staleEntity: staleRow, stored }));
    expect(result[0]!.detail).toBe("kept");
    expect(result[0]!.state).toBe("stale");
  });

  it("refuses a run that produced the same entity id twice", () => {
    const observed = [row({ id: "a" }), row({ id: "a" })];
    const result = unwrapErr(
      mergeKind({ at: AT, foldEntity: replaceFold, observed, staleEntity: staleRow, stored: [] }),
    );
    expect(result[0]).toContain("the same entity id twice");
    expect(result[1]).toContain("double-counts");
  });

  it("propagates a refusal from the platform's own fold", () => {
    const result = unwrapErr(
      mergeKind({
        at: AT,
        foldEntity: () => err(["the platform refused this entity"]),
        observed: [row({ id: "a" })],
        staleEntity: staleRow,
        stored: [],
      }),
    );
    expect(result[0]).toBe("the platform refused this entity");
  });

  it("returns entities sorted by id, so two runs over the same data write identical bytes", () => {
    const observed = [row({ id: "c" }), row({ id: "a" }), row({ id: "b" })];
    const result = unwrap(mergeKind({ at: AT, foldEntity: replaceFold, observed, staleEntity: staleRow, stored: [] }));
    expect(result.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("adds an entity this run saw for the first time", () => {
    const result = unwrap(
      mergeKind({ at: AT, foldEntity: replaceFold, observed: [row({ id: "new" })], staleEntity: staleRow, stored: [] }),
    );
    expect(result.length).toBe(1);
    expect(result[0]!.id).toBe("new");
    expect(result[0]!.firstSeenAt).toBe(AT);
  });
});
