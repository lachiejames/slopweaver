import { describe, expect, it } from "vitest";

import { succeededCloudflareCoverageCell } from "../../../../atlas/cloudflare/coverage.js";
import { CloudflareClientErrors } from "../../../../atlas/cloudflare/errors.js";
import { openCloudflareGap } from "../../../../atlas/cloudflare/gaps.js";
import {
  buildFanoutCoverageCell,
  entitiesInZone,
  foldFailedKindRead,
  foldFanoutResult,
  withOtherZonesRetained,
} from "../../../../atlas/cloudflare/kindFold.js";
import { type CloudflareEntity, emptyCloudflareKindFile } from "../../../../atlas/cloudflare/model.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-02T00:00:00.000Z";

function certificateEntity({ id, zoneId }: { id: string; zoneId: string | null }): CloudflareEntity {
  return {
    detail: { kind: "zone-certificate", subtype: "certificate-pack" },
    firstSeenAt: AT,
    id,
    kind: "zone-certificate",
    lastSeenAt: AT,
    providerId: id,
    scope: { accountId: "a", parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: AT, operation: "certificate-packs-list" },
    state: "observed",
  };
}

function fileHolding({ entities }: { entities: readonly CloudflareEntity[] }) {
  return { ...emptyCloudflareKindFile({ kind: "zone-certificate", updatedAt: AT }), entities: [...entities] };
}

describe("entitiesInZone", () => {
  it("keeps only the named zone's entities", () => {
    const stored = fileHolding({
      entities: [
        certificateEntity({ id: "one", zoneId: "zone-1" }),
        certificateEntity({ id: "two", zoneId: "zone-2" }),
        certificateEntity({ id: "three", zoneId: "zone-1" }),
      ],
    });
    const kept = entitiesInZone({ stored, zoneId: "zone-1" });
    expect(kept.map((entity) => entity.id)).toEqual(["one", "three"]);
  });

  it("returns nothing for a zone the store has never held", () => {
    const stored = fileHolding({ entities: [certificateEntity({ id: "one", zoneId: "zone-1" })] });
    expect(entitiesInZone({ stored, zoneId: "zone-9" })).toEqual([]);
  });

  it("excludes an entity carrying no zone at all", () => {
    const stored = fileHolding({ entities: [certificateEntity({ id: "one", zoneId: null })] });
    expect(entitiesInZone({ stored, zoneId: "zone-1" })).toEqual([]);
  });
});

describe("withOtherZonesRetained", () => {
  it("carries every other zone's entities forward alongside this run's", () => {
    const stored = fileHolding({
      entities: [
        certificateEntity({ id: "one", zoneId: "zone-1" }),
        certificateEntity({ id: "two", zoneId: "zone-2" }),
      ],
    });
    const fresh = certificateEntity({ id: "one-refreshed", zoneId: "zone-1" });
    const result = withOtherZonesRetained({ entities: [fresh], stored, zoneId: "zone-1" });
    expect(result.map((entity) => entity.id)).toEqual(["two", "one-refreshed"]);
  });

  it("replaces the read zone's own entities rather than accumulating them", () => {
    const stored = fileHolding({ entities: [certificateEntity({ id: "gone", zoneId: "zone-1" })] });
    const result = withOtherZonesRetained({ entities: [], stored, zoneId: "zone-1" });
    expect(result).toEqual([]);
  });

  it("drops a stored entity with no zone, which no current build can write", () => {
    const stored = fileHolding({ entities: [certificateEntity({ id: "orphan", zoneId: null })] });
    const result = withOtherZonesRetained({ entities: [], stored, zoneId: "zone-1" });
    expect(result).toEqual([]);
  });
});

describe("a failed attempt's coverage cell", () => {
  const scope = "account/a/gateway-list";
  const error = CloudflareClientErrors.provider({ cause: new Error("boom"), operation: "test", status: 500 });
  const storedWithPriorSuccess = {
    ...emptyCloudflareKindFile({ kind: "gateway-list", updatedAt: AT }),
    coverage: [
      succeededCloudflareCoverageCell({ at: AT, reason: "other", scope: "account/a/other", state: "synced" }),
      succeededCloudflareCoverageCell({ at: AT, reason: "ok", scope, state: "synced" }),
    ],
  };

  it("foldFailedKindRead carries forward the prior success recorded under its own scope", () => {
    const { file } = foldFailedKindRead({
      at: LATER,
      error,
      kind: "gateway-list",
      scope,
      stored: storedWithPriorSuccess,
    });
    const cell = file.coverage.find((existing) => existing.scope === scope)!;
    expect([cell.lastSuccessAt, cell.latestAttemptFailed]).toEqual([AT, true]);
  });

  it("foldFailedKindRead records no prior success for a scope never attempted before", () => {
    const stored = emptyCloudflareKindFile({ kind: "gateway-list", updatedAt: AT });
    const { file } = foldFailedKindRead({ at: LATER, error, kind: "gateway-list", scope, stored });
    expect(file.coverage.map((cell) => [cell.scope, cell.lastSuccessAt])).toEqual([[scope, null]]);
  });

  it("buildFanoutCoverageCell carries the prior success forward on an incomplete run, and none without one", () => {
    const fresh = emptyCloudflareKindFile({ kind: "gateway-list", updatedAt: AT });
    const incomplete = { at: LATER, complete: false, reasons: ["a", "b"], scope, successReason: "ok" };
    const carried = buildFanoutCoverageCell({ ...incomplete, stored: storedWithPriorSuccess });
    const none = buildFanoutCoverageCell({ ...incomplete, stored: fresh });
    expect([carried.lastSuccessAt, carried.reason, none.lastSuccessAt]).toEqual([AT, "a; b", null]);
  });
});

describe("foldFanoutResult", () => {
  const scope = "account/a/gateway-list";

  /** The fold of one complete run over a stored file holding the given gaps, saying what it read at the kind scope. */
  function foldOver({
    gaps,
    kindScopeRead,
  }: {
    gaps: ReturnType<typeof openCloudflareGap>[];
    kindScopeRead: "succeeded" | "not-made";
  }) {
    const stored = { ...emptyCloudflareKindFile({ kind: "gateway-list", updatedAt: AT }), gaps };
    const cell = buildFanoutCoverageCell({
      at: LATER,
      complete: true,
      reasons: [],
      scope,
      stored,
      successReason: "ok",
    });
    return unwrap(
      foldFanoutResult({
        at: LATER,
        cell,
        complete: true,
        entities: [],
        gapInputs: { observed: [], rechecks: [] },
        kind: "gateway-list",
        kindScopeRead,
        reasons: [],
        scope,
        stored,
      }),
    );
  }

  const inventoryGap = openCloudflareGap({
    at: AT,
    condition: "permission-refused",
    kind: "gateway-list",
    reason: "denied",
    scope,
  });

  // Before this, nothing rechecked the kind scope, so the gap a failed inventory read opened there stayed open on
  // every later successful run.
  it("closes the gap a failed inventory read opened at the kind scope once that read succeeds", () => {
    const { file } = foldOver({ gaps: [inventoryGap], kindScopeRead: "succeeded" });
    expect(file.gaps).toEqual([{ ...inventoryGap, lastCheckedAt: LATER, status: "closed" }]);
  });

  // A kind of independent subtype reads makes no read at its own scope, so even a complete run proves nothing there.
  it("leaves a kind-scope gap open when no read is made at that scope", () => {
    const { file } = foldOver({ gaps: [inventoryGap], kindScopeRead: "not-made" });
    expect(file.gaps).toEqual([inventoryGap]);
  });

  it("leaves a gap at another scope as it stood", () => {
    const parentGap = openCloudflareGap({
      at: AT,
      condition: "permission-refused",
      kind: "gateway-list",
      reason: "denied",
      scope: `${scope}/list-1`,
    });
    const { file } = foldOver({ gaps: [parentGap], kindScopeRead: "succeeded" });
    expect(file.gaps).toEqual([parentGap]);
  });
});
