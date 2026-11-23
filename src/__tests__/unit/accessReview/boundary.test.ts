import { describe, expect, it } from "vitest";

import { boundaryLines, isDegraded, kindBoundaryOf } from "../../../accessReview/boundary.js";
import type { AtlasKindView } from "../../../atlas/kit/read.js";

import { coverageCell, entity, kindView } from "./fixtures.js";

/** A view carrying a coverage cell or a permission block. */
function viewWith({
  coverage = [],
  permissionBlocked = null,
  lastSuccessAt = "2026-09-06T00:00:00.000Z",
  latestAttemptFailed = false,
  publishedCount,
}: {
  coverage?: AtlasKindView["coverage"];
  permissionBlocked?: AtlasKindView["permissionBlocked"];
  lastSuccessAt?: string | null;
  latestAttemptFailed?: boolean;
  publishedCount?: number;
}): AtlasKindView {
  const base = kindView({
    entities: [entity({ detail: {}, providerId: "a" })],
    kind: "user",
    lastSuccessAt,
    latestAttemptFailed,
    ...(publishedCount === undefined ? {} : { publishedCount }),
  });
  return { ...base, coverage, permissionBlocked };
}

describe("kindBoundaryOf", () => {
  it("reads the kind's own read stamp, counts and failure flag", () => {
    const boundary = kindBoundaryOf({
      platform: "onepassword",
      view: viewWith({ latestAttemptFailed: true, publishedCount: 179 }),
    });
    expect(boundary.platform).toBe("onepassword");
    expect(boundary.kind).toBe("user");
    expect(boundary.readStampIso).toBe("2026-09-06T00:00:00.000Z");
    expect(boundary.latestAttemptFailed).toBe(true);
    expect(boundary.publishedCount).toBe(179);
    expect(boundary.readCount).toBe(1);
  });

  it("takes the permission block as the declared boundary when the manifest carries one", () => {
    const boundary = kindBoundaryOf({
      platform: "onepassword",
      view: viewWith({
        permissionBlocked: {
          at: "2026-09-06T01:02:03.000Z",
          detail: "op signin is interactive",
          unblockedBy: "a service account token",
        },
      }),
    });
    expect(boundary.declaredBoundary).toEqual([
      "permission-blocked since 2026-09-06T01:02:03.000Z — op signin is interactive (unblocked by a service account token)",
    ]);
  });

  it("takes every coverage reason when there is no permission block", () => {
    const boundary = kindBoundaryOf({
      platform: "jumpcloud",
      view: viewWith({
        coverage: [
          coverageCell({ reason: "list scope only", scope: "org", state: "deferred", surface: "v1-systemusers-get" }),
          coverageCell({ reason: "", scope: "org", state: "synced", surface: "v1-systemusers-list" }),
        ],
      }),
    });
    expect(boundary.declaredBoundary).toEqual(["v1-systemusers-get/org: deferred — list scope only"]);
  });

  it("says out loud that nothing is declared rather than printing an empty boundary", () => {
    const boundary = kindBoundaryOf({ platform: "cloudflare", view: viewWith({}) });
    expect(boundary.declaredBoundary).toEqual([
      "no permission block declared and no coverage reason recorded for this kind",
    ]);
  });

  it("de-duplicates and sorts repeated coverage reasons", () => {
    const boundary = kindBoundaryOf({
      platform: "jumpcloud",
      view: viewWith({
        coverage: [
          coverageCell({ reason: "same", scope: "b", state: "deferred", surface: "z" }),
          coverageCell({ reason: "same", scope: "b", state: "deferred", surface: "z" }),
          coverageCell({ reason: "other", scope: "a", state: "deferred", surface: "a" }),
        ],
      }),
    });
    expect(boundary.declaredBoundary).toEqual(["a/a: deferred — other", "z/b: deferred — same"]);
  });

  it("measures a kind as of a failed cell's earlier success, and marks it failed, though the kind's stamp is fresh", () => {
    const failed = {
      ...coverageCell({ reason: "depth limit", scope: "systemusers", state: "unreadable", surface: "directory-api" }),
      lastSuccessAt: "2026-09-01T00:00:00.000Z",
      latestAttemptFailed: true,
    };
    const boundary = kindBoundaryOf({ platform: "jumpcloud", view: viewWith({ coverage: [failed] }) });
    expect(boundary.readStampIso).toBe("2026-09-01T00:00:00.000Z");
    expect(boundary.latestAttemptFailed).toBe(true);
  });

  it("returns a cell stamp that does not parse verbatim, so the join leaves everyone measured against it unmeasured", () => {
    const odd = {
      ...coverageCell({ reason: "", scope: "systemusers", state: "synced", surface: "directory-api" }),
      lastSuccessAt: "yesterday",
    };
    const boundary = kindBoundaryOf({ platform: "jumpcloud", view: viewWith({ coverage: [odd] }) });
    expect(boundary.readStampIso).toBe("yesterday");
  });

  it("answers no stamp when an attempted cell has never read", () => {
    const failed = {
      ...coverageCell({ reason: "depth limit", scope: "systemusers", state: "unreadable", surface: "directory-api" }),
      latestAttemptFailed: true,
    };
    const boundary = kindBoundaryOf({ platform: "jumpcloud", view: viewWith({ coverage: [failed] }) });
    expect(boundary.readStampIso).toBe(null);
  });

  it("is not moved by a cell never attempted, nor by a later cell success", () => {
    const later = {
      ...coverageCell({ reason: "", scope: "systemusers", state: "synced", surface: "directory-api" }),
      lastSuccessAt: "2026-09-07T00:00:00.000Z",
    };
    const idle = coverageCell({
      reason: "not read",
      scope: "systemusers",
      state: "deferred",
      surface: "admin-console",
    });
    const boundary = kindBoundaryOf({ platform: "jumpcloud", view: viewWith({ coverage: [later, idle] }) });
    expect(boundary.readStampIso).toBe("2026-09-06T00:00:00.000Z");
    expect(boundary.latestAttemptFailed).toBe(false);
  });
});

describe("isDegraded", () => {
  it("is degraded when the kind has never read successfully", () => {
    const boundary = kindBoundaryOf({ platform: "onepassword", view: viewWith({ lastSuccessAt: null }) });
    expect(isDegraded({ boundary })).toBe(true);
  });

  it("is degraded when the latest attempt failed", () => {
    const boundary = kindBoundaryOf({ platform: "onepassword", view: viewWith({ latestAttemptFailed: true }) });
    expect(isDegraded({ boundary })).toBe(true);
  });

  it("is degraded when fewer records read back than the manifest vouches for", () => {
    const boundary = kindBoundaryOf({ platform: "jumpcloud", view: viewWith({ publishedCount: 5 }) });
    expect(isDegraded({ boundary })).toBe(true);
  });

  it("is not degraded on a clean, current read", () => {
    const boundary = kindBoundaryOf({ platform: "jumpcloud", view: viewWith({}) });
    expect(isDegraded({ boundary })).toBe(false);
  });
});

describe("boundaryLines", () => {
  it("prints the stamp, the counts and every declared clause", () => {
    const boundary = kindBoundaryOf({
      platform: "jumpcloud",
      view: viewWith({ publishedCount: 2 }),
    });
    expect(boundaryLines({ boundary })).toEqual([
      "read stamp · jumpcloud/user last successful read 2026-09-06T00:00:00.000Z",
      "records · 1 read back, 2 vouched for by the manifest",
      "declared boundary · no permission block declared and no coverage reason recorded for this kind",
    ]);
  });

  it("names a kind that has never read rather than printing a null stamp", () => {
    const boundary = kindBoundaryOf({ platform: "onepassword", view: viewWith({ lastSuccessAt: null }) });
    expect(boundaryLines({ boundary })[0]).toBe(
      "read stamp · onepassword/user last successful read never read successfully",
    );
  });

  it("appends a DEGRADED line when the latest attempt failed", () => {
    const boundary = kindBoundaryOf({ platform: "onepassword", view: viewWith({ latestAttemptFailed: true }) });
    expect(boundaryLines({ boundary }).at(-1)).toBe("DEGRADED · the latest attempt on onepassword/user FAILED");
  });
});
