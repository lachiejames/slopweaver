/**
 * Unit: the SURFACES header reads the STORE rather than the descriptor's static declaration.
 *
 * The defect this pins is an atlas underclaiming what it holds. A surface declared unfilled when the atlas
 * was designed goes on printing `declared-unfilled` for as long as nobody compares the declaration against
 * the cells on disk — measured on google-admin, which read 3,503 records through a surface its own header
 * still called unfilled.
 */
import { describe, expect, it } from "vitest";

import type { AtlasKindView } from "../../../../../atlas/kit/read.js";
import { surfaceHasFilledCell } from "../../../../../cli/commands/atlas/coverageCore.js";

/** One kind view carrying a single cell, which is all this judgement reads. */
function kindWith({ surface, lastSuccessAt }: { surface: string; lastSuccessAt: string | null }): AtlasKindView {
  return {
    coverage: [
      {
        lastSuccessAt,
        latestAttemptFailed: false,
        reason: "a reason",
        scope: "a-scope",
        state: lastSuccessAt === null ? "not-configured" : "synced",
        surface,
        unblockedBy: null,
      },
    ],
    entities: [],
    gaps: [],
    kind: "a-kind",
    lastSuccessAt,
    latestAttemptFailed: false,
    permissionBlocked: null,
    publishedCount: 0,
  };
}

describe("surfaceHasFilledCell", () => {
  it("is true when one kind's cell for that surface has ever succeeded", () => {
    const kinds = [kindWith({ lastSuccessAt: "2026-09-06T08:50:33.255Z", surface: "admin-api" })];
    expect(surfaceHasFilledCell({ kinds, surface: "admin-api" })).toBe(true);
  });

  it("is false when every cell for it has never succeeded", () => {
    const kinds = [kindWith({ lastSuccessAt: null, surface: "admin-api" })];
    expect(surfaceHasFilledCell({ kinds, surface: "admin-api" })).toBe(false);
  });

  it("is false when the only successful cell belongs to a DIFFERENT surface", () => {
    const kinds = [kindWith({ lastSuccessAt: "2026-09-06T08:50:33.255Z", surface: "discovery" })];
    expect(surfaceHasFilledCell({ kinds, surface: "admin-api" })).toBe(false);
  });

  it("needs only one filled kind out of many, because a surface is filled as soon as it has read anything", () => {
    const kinds = [
      kindWith({ lastSuccessAt: null, surface: "admin-api" }),
      kindWith({ lastSuccessAt: null, surface: "admin-api" }),
      kindWith({ lastSuccessAt: "2026-09-06T08:50:33.255Z", surface: "admin-api" }),
    ];
    expect(surfaceHasFilledCell({ kinds, surface: "admin-api" })).toBe(true);
  });

  it("is false for an empty snapshot, so a kind filter narrow enough to select nothing claims nothing", () => {
    expect(surfaceHasFilledCell({ kinds: [], surface: "admin-api" })).toBe(false);
  });
});
