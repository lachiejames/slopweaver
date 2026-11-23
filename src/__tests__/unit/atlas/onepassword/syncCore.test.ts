/**
 * The pure half of a sync run. Every branch here is reachable without a subprocess, a network call or a
 * clock — which is the whole reason `syncCore.ts` exists as its own file.
 */
import { describe, expect, it } from "vitest";

import {
  ONEPASSWORD_REQUIRED_SURFACES,
  type OnepasswordRequiredSurfaceName,
} from "../../../../atlas/onepassword/inventory.js";
import { emptyOnepasswordKindFile, type OnepasswordEntity } from "../../../../atlas/onepassword/model.js";
import { projectOnepasswordVault } from "../../../../atlas/onepassword/projection.js";
import {
  kindResult,
  mergeVaultPasses,
  onepasswordSurfaceRole,
  progressLineFor,
  projectionGaps,
  projectOnepasswordRows,
} from "../../../../atlas/onepassword/syncCore.js";
import { err, ok, type Result, unwrap } from "../../../../lib/result.js";

const AT = "2026-08-29T00:00:00.000Z";

/** One projected vault, built through the real projection so the shape cannot drift from production's. */
const vault = ({ id, items }: { id: string; items: number | null }): OnepasswordEntity =>
  unwrap(
    projectOnepasswordVault({
      at: AT,
      raw: {
        created_at: "2026-01-02T03:04:05Z",
        description: "a vault",
        id,
        name: `Vault ${id}`,
        type: "USER_CREATED",
        updated_at: "2026-08-01T00:00:00Z",
        ...(items === null ? {} : { items }),
      },
    }),
  );

describe("onepasswordSurfaceRole", () => {
  it("resolves every required surface to the role its own row declares", () => {
    expect(ONEPASSWORD_REQUIRED_SURFACES.length).toBeGreaterThan(0);
    expect(
      ONEPASSWORD_REQUIRED_SURFACES.filter((row) => onepasswordSurfaceRole({ surface: row.surface }) !== row.role),
    ).toStrictEqual([]);
  });

  // The lookup reads by surface alone, which is only total because no two rows share a surface name.
  it("never declares one surface name twice, so a surface names exactly one role", () => {
    const names = ONEPASSWORD_REQUIRED_SURFACES.map((row) => row.surface);
    expect(new Set(names).size).toBe(names.length);
  });

  // Before the surface was closed, an unlisted surface silently earned "authoritative"; now it cannot compile.
  it("reads a browser surface as corroborating and refuses an undeclared surface at compile time", () => {
    expect(onepasswordSurfaceRole({ surface: "people-console" })).toBe("corroborating");
    expect(onepasswordSurfaceRole({ surface: "users-list" })).toBe("authoritative");
    // @ts-expect-error -- "users-lists" is not a declared surface, so it cannot reach the lookup
    const misspelled: OnepasswordRequiredSurfaceName = "users-lists";
    expect(ONEPASSWORD_REQUIRED_SURFACES.some((row) => row.surface === misspelled)).toBe(false);
  });
});

describe("mergeVaultPasses", () => {
  it("supersedes a listed vault with the detail pass's own record, which is the one carrying the count", () => {
    const listed = vault({ id: "AAAAAAAAAAAAAAAAAAAAAAAAAA", items: null });
    const detailed = vault({ id: "AAAAAAAAAAAAAAAAAAAAAAAAAA", items: 12 });

    const merged = mergeVaultPasses({ at: AT, detail: [detailed], listed: [listed], reasons: [] });

    expect(merged.observed).toEqual([detailed]);
    expect(merged.extraGaps).toEqual([]);
  });

  it("keeps a vault the detail pass never reached rather than dropping it", () => {
    const reached = vault({ id: "AAAAAAAAAAAAAAAAAAAAAAAAAA", items: 12 });
    const unreached = vault({ id: "BBBBBBBBBBBBBBBBBBBBBBBBBB", items: null });

    const merged = mergeVaultPasses({ at: AT, detail: [reached], listed: [reached, unreached], reasons: [] });

    expect(merged.observed.map((entity) => entity.providerId)).toEqual([
      "AAAAAAAAAAAAAAAAAAAAAAAAAA",
      "BBBBBBBBBBBBBBBBBBBBBBBBBB",
    ]);
  });

  it("folds every projection refusal into ONE vault gap rather than one gap per row", () => {
    const merged = mergeVaultPasses({
      at: AT,
      detail: [],
      listed: [],
      reasons: ["row 0 is missing an id", "row 3 is missing a name"],
    });

    expect(merged.extraGaps).toHaveLength(1);
    expect(merged.extraGaps[0]!.kind).toBe("vault");
    expect(merged.extraGaps[0]!.reason).toBe("row 0 is missing an id; row 3 is missing a name");
  });

  it("opens no gap at all when both passes took every row", () => {
    expect(mergeVaultPasses({ at: AT, detail: [], listed: [], reasons: [] }).extraGaps).toEqual([]);
  });
});

describe("kindResult", () => {
  it("reports the entity count off the folded file rather than from a separate tally", () => {
    const file = emptyOnepasswordKindFile({ kind: "vault", updatedAt: AT });

    const result = kindResult({
      fold: {
        complete: true,
        file: { ...file, entities: [vault({ id: "AAAAAAAAAAAAAAAAAAAAAAAAAA", items: 3 })] },
        reasons: [],
      },
      kind: "vault",
    });

    expect(result).toEqual({ complete: true, entityCount: 1, file: result.file, kind: "vault", reasons: [] });
    expect(result.entityCount).toBe(1);
  });

  it("carries an incomplete fold's reasons through untouched", () => {
    const result = kindResult({
      fold: {
        complete: false,
        file: emptyOnepasswordKindFile({ kind: "user", updatedAt: AT }),
        reasons: ["no usable `op` session"],
      },
      kind: "user",
    });

    expect(result.complete).toBe(false);
    expect(result.reasons).toEqual(["no usable `op` session"]);
  });
});

describe("projectionGaps", () => {
  it("is empty when nothing was refused", () => {
    expect(projectionGaps({ at: AT, kind: "user", reasons: [], scope: "users-list" })).toEqual([]);
  });

  it("carries the refusal's own text so the gap says what the projection said", () => {
    const gaps = projectionGaps({ at: AT, kind: "user", reasons: ["row 2 is missing an email"], scope: "users-list" });

    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.reason).toBe("row 2 is missing an email");
    expect(gaps[0]!.scope).toBe("users-list:projection");
  });

  it("keeps only the first four reasons, so one broken schema cannot write an unbounded gap", () => {
    const gaps = projectionGaps({
      at: AT,
      kind: "user",
      reasons: ["one", "two", "three", "four", "five"],
      scope: "users-list",
    });

    expect(gaps[0]!.reason).toBe("one; two; three; four");
  });
});

describe("projectOnepasswordRows", () => {
  it("takes every row a projection accepts and records a reason for each one it refuses", () => {
    const project = ({ raw }: { raw: unknown }): Result<OnepasswordEntity> =>
      raw === "good" ? ok(vault({ id: "AAAAAAAAAAAAAAAAAAAAAAAAAA", items: 1 })) : err(["not a vault"]);

    const projected = projectOnepasswordRows({ project, rows: ["good", "bad", "good"] });

    expect(projected.entities).toHaveLength(2);
    expect(projected.reasons).toEqual(["not a vault"]);
  });

  it("does not stop at the first refusal", () => {
    const project = ({ raw }: { raw: unknown }): Result<OnepasswordEntity> =>
      raw === "good" ? ok(vault({ id: "AAAAAAAAAAAAAAAAAAAAAAAAAA", items: 1 })) : err(["not a vault"]);

    const projected = projectOnepasswordRows({ project, rows: ["bad", "good"] });

    expect(projected.entities).toHaveLength(1);
  });

  it("projects nothing and records no reason when the surface call read no rows at all", () => {
    const project = ({ raw }: { raw: unknown }): Result<OnepasswordEntity> =>
      raw === "good" ? ok(vault({ id: "AAAAAAAAAAAAAAAAAAAAAAAAAA", items: 1 })) : err(["not a vault"]);

    expect(projectOnepasswordRows({ project, rows: null })).toStrictEqual({ entities: [], reasons: [] });
  });
});

describe("progressLineFor", () => {
  it("says synced with the count when the kind read completely", () => {
    expect(progressLineFor({ result: { complete: true, entityCount: 41, kind: "vault", reasons: [] } })).toBe(
      "vault: synced, 41 record(s)",
    );
  });

  it("says INCOMPLETE with the count it did get, so a partial read is never mistaken for a clean one", () => {
    expect(
      progressLineFor({ result: { complete: false, entityCount: 3, kind: "vault", reasons: ["one call failed"] } }),
    ).toBe("vault: INCOMPLETE, 3 record(s)");
  });
});
