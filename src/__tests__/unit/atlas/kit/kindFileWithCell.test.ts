/*
 * A publisher replaces ONLY its own surface's coverage cell: filtering on any other field is how one
 * channel's publish silently deletes another channel's coverage in a two-channel atlas.
 */
import { describe, expect, it } from "vitest";

import { kindFileWithCell } from "../../../../atlas/kit/kindFileWithCell.js";

interface Cell {
  readonly surface: string;
  readonly state: string;
}

interface Gap {
  readonly id: string;
}

interface KindFile {
  readonly coverage: Cell[];
  readonly entities: { readonly id: string }[];
  readonly gaps: Gap[];
  readonly kind: string;
  readonly schemaVersion: number;
  readonly updatedAt: string;
}

const STORED: KindFile = {
  coverage: [
    { state: "synced", surface: "api" },
    { state: "deferred", surface: "browser" },
  ],
  entities: [{ id: "acme-old" }],
  gaps: [{ id: "gap-stored" }],
  kind: "method",
  schemaVersion: 3,
  updatedAt: "2026-11-01T00:00:00.000Z",
};

describe("kindFileWithCell", () => {
  it("replaces its own surface's cell, keeps the other, and copies the entities and gaps it is given", () => {
    const entities = [{ id: "acme-new-1" }, { id: "acme-new-2" }];
    const gaps = [{ id: "gap-new" }];
    const result = kindFileWithCell({
      at: "2026-11-08T00:00:00.000Z",
      cell: { state: "synced", surface: "browser" },
      entities,
      gaps,
      stored: STORED,
    });

    expect(result).toEqual({
      coverage: [
        { state: "synced", surface: "api" },
        { state: "synced", surface: "browser" },
      ],
      entities: [{ id: "acme-new-1" }, { id: "acme-new-2" }],
      gaps: [{ id: "gap-new" }],
      kind: "method",
      schemaVersion: 3,
      updatedAt: "2026-11-08T00:00:00.000Z",
    });
    expect(result.entities).not.toBe(entities);
    expect(result.gaps).not.toBe(gaps);
  });

  it("keeps the stored gap list itself when no gaps are given", () => {
    const NO_ENTITIES: KindFile["entities"] = [];
    const result = kindFileWithCell({
      at: "2026-11-08T00:00:00.000Z",
      cell: { state: "failed", surface: "api" },
      entities: NO_ENTITIES,
      stored: STORED,
    });

    expect(result).toEqual({
      coverage: [
        { state: "deferred", surface: "browser" },
        { state: "failed", surface: "api" },
      ],
      entities: [],
      gaps: [{ id: "gap-stored" }],
      kind: "method",
      schemaVersion: 3,
      updatedAt: "2026-11-08T00:00:00.000Z",
    });
    expect(result.gaps).toBe(STORED.gaps);
  });
});
