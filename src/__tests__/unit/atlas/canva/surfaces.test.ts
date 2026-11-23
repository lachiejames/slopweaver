/**
 * The committed surface registry's own invariants, checked without the vendor's bytes.
 *
 * `tools/generateCanvaSurfaces.ts --verify` asserts the same things and runs in CI, but only when somebody
 * runs the tool. These are the checks that fail on `yarn test:unit` — the lane a session actually runs
 * before it commits — and they exist because a hand-edited generated table is exactly the shape of change
 * that looks harmless in a diff.
 */
import { describe, expect, it } from "vitest";

import { canvaEffectFor, canvaJudgedPosts } from "../../../../atlas/canva/effects.js";
import {
  CANVA_EFFECT_CENSUS,
  CANVA_ENTITLEMENT_CENSUS,
  CANVA_OPERATION_CENSUS,
  CANVA_SCOPE_CENSUS,
  CANVA_STABILITY_CENSUS,
} from "../../../../atlas/canva/generated/specLock.js";
import { CANVA_SCOPES, CANVA_SURFACES } from "../../../../atlas/canva/generated/surfaces.js";
import { CANVA_ATLAS_KINDS } from "../../../../atlas/canva/model.js";
import { canvaKindForScope, canvaPagingFor, canvaProviderId } from "../../../../atlas/canva/surfaceNaming.js";

describe("the committed Canva surface registry", () => {
  it("holds exactly the census specLock pins", () => {
    expect(CANVA_SURFACES.length).toBe(CANVA_OPERATION_CENSUS);
    expect(CANVA_SURFACES.length).toBe(59);
  });

  it("names every operation with the vendor's own operationId, and none collides", () => {
    expect(new Set(CANVA_SURFACES.map((row) => row.name)).size).toBe(CANVA_SURFACES.length);
  });

  it("keys every operation on a distinct <METHOD> <path>, which is why the server is not in the key", () => {
    const keys = CANVA_SURFACES.map((row) => canvaProviderId({ method: row.method, path: row.path }));
    expect(new Set(keys).size).toBe(CANVA_SURFACES.length);
    expect(new Set(CANVA_SURFACES.map((row) => row.server)).size).toBe(1);
  });

  it("counts each effect exactly as specLock pins it, so a row cannot silently change side", () => {
    const counted = { mutating: 0, read: 0, "side-effecting": 0 };
    for (const row of CANVA_SURFACES) {
      counted[row.effect] += 1;
    }
    expect(counted).toStrictEqual({ ...CANVA_EFFECT_CENSUS });
  });

  it("counts each stability exactly as specLock pins it", () => {
    const counted = { deprecated: 0, preview: 0, stable: 0 };
    for (const row of CANVA_SURFACES) {
      counted[row.stability] += 1;
    }
    expect(counted).toStrictEqual({ ...CANVA_STABILITY_CENSUS });
  });

  it("counts each entitlement exactly as specLock pins it", () => {
    const counted = { "enterprise-organization": 0, none: 0, "premium-plan": 0 };
    for (const row of CANVA_SURFACES) {
      counted[row.entitlement] += 1;
    }
    expect(counted).toStrictEqual({ ...CANVA_ENTITLEMENT_CENSUS });
  });

  it("stores the effect its own rule derives, for every row", () => {
    const disagreeing = CANVA_SURFACES.filter(
      (row) => canvaEffectFor({ method: row.method, name: row.name }).effect !== row.effect,
    );
    expect(disagreeing.map((row) => row.name)).toStrictEqual([]);
  });

  it("stores the paging its own rule derives, for every row", () => {
    const disagreeing = CANVA_SURFACES.filter(
      (row) => canvaPagingFor({ queryParams: row.queryParams, responseFields: row.responseFields }) !== row.paging,
    );
    expect(disagreeing.map((row) => row.name)).toStrictEqual([]);
  });

  it("judges every POST in effects.ts and no POST that is not in the registry", () => {
    const posts = CANVA_SURFACES.filter((row) => row.method === "POST")
      .map((row) => row.name)
      .toSorted();
    expect([...canvaJudgedPosts()]).toStrictEqual(posts);
    expect(posts.length).toBe(21);
  });

  it("files every operation under a kind the model declares", () => {
    const stray = CANVA_SURFACES.filter((row) => !CANVA_ATLAS_KINDS.some((kind) => kind === row.kind));
    expect(stray.map((row) => row.name)).toStrictEqual([]);
  });

  it("carries a reason on exactly the rows that are not plain reads", () => {
    const inconsistent = CANVA_SURFACES.filter((row) => (row.effect === "read") !== (row.effectBecause === null));
    expect(inconsistent.map((row) => row.name)).toStrictEqual([]);
  });

  it("carries the vendor's own requirement sentence on exactly the entitled rows", () => {
    const inconsistent = CANVA_SURFACES.filter(
      (row) => (row.entitlement === "none") !== (row.entitlementBecause === null),
    );
    expect(inconsistent.map((row) => row.name)).toStrictEqual([]);
  });

  it("gives every row a real synopsis, because the vendor declares no summary on any of them", () => {
    const empty = CANVA_SURFACES.filter((row) => row.synopsis.trim().length === 0);
    expect(empty.map((row) => row.name)).toStrictEqual([]);
    expect(CANVA_SURFACES.filter((row) => row.synopsis.startsWith("<")).map((row) => row.name)).toStrictEqual([]);
  });

  it("holds the one deprecated operation the vendor flags, and its prose agrees with its flag", () => {
    const flagged = CANVA_SURFACES.filter((row) => row.deprecated).map((row) => row.name);
    const said = CANVA_SURFACES.filter((row) => row.stability === "deprecated").map((row) => row.name);
    expect(flagged).toStrictEqual(["createComment"]);
    expect(said).toStrictEqual(["createComment"]);
  });

  it("records the two autofill operations whose prose and extension disagree — this atlas's own finding", () => {
    const proseOnly = CANVA_SURFACES.filter((row) => row.entitlement !== "none" && row.capabilities.length === 0);
    expect(proseOnly.map((row) => row.name).toSorted()).toStrictEqual([
      "createDesignAutofillJob",
      "getDesignAutofillJob",
    ]);
  });
});

describe("the committed Canva scope table", () => {
  it("holds every declared scope, including the ones no operation names", () => {
    expect(CANVA_SCOPES.length).toBe(CANVA_SCOPE_CENSUS.declared);
    expect(CANVA_SCOPES.filter((scope) => scope.namedBy.length > 0).length).toBe(CANVA_SCOPE_CENSUS.named);
  });

  it("names the two grantable scopes the published call surface never spends", () => {
    expect(
      CANVA_SCOPES.filter((scope) => scope.namedBy.length === 0)
        .map((scope) => scope.scope)
        .toSorted(),
    ).toStrictEqual(["collaboration:event", "folder:permission:write"]);
  });

  it("files every scope under the kind its own prefix rule derives", () => {
    const disagreeing = CANVA_SCOPES.filter((scope) => canvaKindForScope({ scope: scope.scope }) !== scope.kind);
    expect(disagreeing.map((scope) => scope.scope)).toStrictEqual([]);
  });

  it("names only operations the registry actually holds", () => {
    const known = new Set(CANVA_SURFACES.map((row) => row.name));
    const dangling = CANVA_SCOPES.flatMap((scope) => scope.namedBy).filter((name) => !known.has(name));
    expect(dangling).toStrictEqual([]);
  });
});
