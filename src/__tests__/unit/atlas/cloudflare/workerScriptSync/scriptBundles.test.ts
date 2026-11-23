/*
 * `syncWorkerScriptKind` over each inventoried script's bundle: a successful read embeds the full bundle, prunes a
 * script the inventory dropped and closes its per-script gaps, and one refused bundle read costs only that script
 * its fresh bundle.
 */
import { describe, expect, it } from "vitest";

import { cloudflareGapId } from "../../../../../atlas/cloudflare/identity.js";
import { CLOUDFLARE_VISIBILITY_SCOPE } from "../../../../../atlas/cloudflare/model.js";
import { syncWorkerScriptKind } from "../../../../../atlas/cloudflare/workerScriptSync.js";
import { unwrap } from "../../../../../lib/result.js";
import { gapLifecycle } from "../sync/zoneSubtypeKind.js";
import {
  ACCOUNT_ID,
  AT,
  BUNDLE_DENIED,
  bareMetadata,
  bundleRoutes,
  expectedEntity,
  KIND_SCOPE,
  OLD,
  rawBundle,
  SCRIPT_A,
  SCRIPT_B,
  SCRIPTS,
  scriptPath,
  servedClient,
  storedFile,
  storedGap,
  storedScript,
  TOKEN_REMEDY,
} from "./harness.js";

/** The sub-resource suffixes one script's bundle read touches, besides its bare content route. */
const BUNDLE_SUFFIXES = [
  "/script-settings",
  "/settings",
  "/deployments",
  "/schedules",
  "/subdomain",
  "/versions",
  "/secrets",
] as const;

/** Every request key one script's fully successful bundle read makes, versions' terminating page included. */
function bundleRequestKeys({ name }: { name: string }): readonly string[] {
  return [
    `${scriptPath({ name, suffix: "" })}@1`,
    ...BUNDLE_SUFFIXES.map((suffix) => `${scriptPath({ name, suffix })}@1`),
    `${scriptPath({ name, suffix: "/versions" })}@2`,
  ];
}

/** The gap scope for one script, keyed by its id (which is its name). */
function scriptScope({ name }: { name: string }): string {
  return `${KIND_SCOPE}/${name}`;
}

/** Sort as `reconcileParentFanout` does: by hashed entity id, not by inventory order. */
function byId<T extends { id: string }>({ entities }: { entities: readonly T[] }): readonly T[] {
  return entities.toSorted((left, right) => left.id.localeCompare(right.id));
}

/** The stored bundle half of a detail served from {@link rawBundle} with the same `marker`, written out. */
function storedBundle({ marker }: { marker: string }) {
  return {
    bindings: [{ name: `KV_${marker}`, namespace_id: `ns-${marker}`, type: "kv_namespace" }],
    content: `export default { fetch() { return "${marker}"; } }`,
    deployments: [
      {
        authorEmail: "dev@example.test",
        createdOn: "2026-01-15T00:00:00Z",
        id: `dep-${marker}`,
        message: `ship ${marker}`,
        source: "wrangler",
        strategy: "percentage",
        triggeredBy: null,
        versions: [{ percentage: 100, versionId: `ver-${marker}` }],
      },
    ],
    schedules: [{ createdOn: null, cron: `0 ${marker.length} * * *`, modifiedOn: null }],
    secrets: [{ name: `SECRET_${marker}`, type: "secret_text" }],
    settings: { logpush: true, marker },
    subdomainEnabled: true,
    subdomainPreviewsEnabled: false,
    versions: [{ authorEmail: "dev@example.test", createdOn: null, id: `ver-${marker}`, number: 3 }],
  };
}

describe("syncWorkerScriptKind", () => {
  it("embeds each script's full bundle, prunes a script the inventory dropped, and closes its per-script gaps", async () => {
    const stored = storedFile({
      entities: [
        storedScript({ bundle: rawBundle({ marker: "old" }), raw: SCRIPT_A }),
        storedScript({ bundle: rawBundle({ marker: "gone" }), raw: { id: "worker-gone" } }),
      ],
      gaps: [
        storedGap({ condition: "permission-refused", scope: scriptScope({ name: "worker-a" }) }),
        storedGap({ condition: "not-found", scope: scriptScope({ name: "worker-b" }) }),
      ],
    });
    const served = servedClient({
      routes: {
        [`${SCRIPTS}@1`]: { result: [SCRIPT_A, SCRIPT_B] },
        ...bundleRoutes({ bundle: rawBundle({ marker: "a" }), name: "worker-a" }),
        ...bundleRoutes({ bundle: rawBundle({ marker: "b" }), name: "worker-b" }),
      },
    });

    const folded = unwrap(await syncWorkerScriptKind({ accountId: ACCOUNT_ID, at: AT, client: served.client, stored }));

    expect(served.requests.toSorted()).toEqual(
      [
        `${SCRIPTS}@1`,
        ...bundleRequestKeys({ name: "worker-a" }),
        ...bundleRequestKeys({ name: "worker-b" }),
      ].toSorted(),
    );
    expect(folded.file.entities).toEqual(
      byId({
        entities: [
          expectedEntity({
            detail: {
              ...bareMetadata({ name: "worker-a" }),
              compatibilityDate: "2026-01-01",
              tag: "tag-a",
              usageModel: "standard",
              ...storedBundle({ marker: "a" }),
            },
            // Already stored, so it keeps the instant it was first seen.
            firstSeenAt: OLD,
            providerId: "worker-a",
          }),
          expectedEntity({
            detail: { ...bareMetadata({ name: "worker-b" }), ...storedBundle({ marker: "b" }) },
            firstSeenAt: AT,
            providerId: "worker-b",
          }),
        ],
      }),
    );
    expect(folded.outcome).toEqual({ complete: true, entityCount: 2, kind: "worker-script", reasons: [] });
    expect(folded.file.coverage).toEqual([
      {
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason: "reconciled 2 Worker script(s)",
        scope: KIND_SCOPE,
        state: "synced",
        unblockedBy: null,
        visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
      },
    ]);
    expect(gapLifecycle({ file: folded.file })).toEqual([
      {
        condition: "permission-refused",
        lastCheckedAt: AT,
        scope: scriptScope({ name: "worker-a" }),
        status: "closed",
      },
      { condition: "not-found", lastCheckedAt: AT, scope: scriptScope({ name: "worker-b" }), status: "closed" },
    ]);
  });

  it("costs only the refused script its fresh bundle: it keeps its whole stored bundle under fresh metadata, the other refreshes", async () => {
    const stored = storedFile({
      entities: [
        storedScript({ bundle: rawBundle({ marker: "old-a" }), raw: SCRIPT_A }),
        storedScript({ bundle: rawBundle({ marker: "old-b" }), raw: SCRIPT_B }),
      ],
      gaps: [],
    });
    const served = servedClient({
      routes: {
        [`${SCRIPTS}@1`]: { result: [SCRIPT_A, { ...SCRIPT_B, usage_model: "bundled" }] },
        ...bundleRoutes({ bundle: rawBundle({ marker: "a" }), name: "worker-a" }),
        // Every read of worker-b's bundle succeeds but the last, which is enough to fail the whole bundle.
        ...bundleRoutes({ bundle: rawBundle({ marker: "b" }), name: "worker-b" }),
        [`${scriptPath({ name: "worker-b", suffix: "/secrets" })}@1`]: { status: 403 },
      },
    });

    const folded = unwrap(await syncWorkerScriptKind({ accountId: ACCOUNT_ID, at: AT, client: served.client, stored }));

    const failedScope = scriptScope({ name: "worker-b" });
    const reason = `worker-b: ${BUNDLE_DENIED}`;
    expect(served.requests.toSorted()).toEqual(
      [
        `${SCRIPTS}@1`,
        ...bundleRequestKeys({ name: "worker-a" }),
        ...bundleRequestKeys({ name: "worker-b" }),
      ].toSorted(),
    );
    expect(folded.file.entities).toEqual(
      byId({
        entities: [
          expectedEntity({
            detail: {
              ...bareMetadata({ name: "worker-a" }),
              compatibilityDate: "2026-01-01",
              tag: "tag-a",
              usageModel: "standard",
              ...storedBundle({ marker: "a" }),
            },
            firstSeenAt: OLD,
            providerId: "worker-a",
          }),
          expectedEntity({
            detail: {
              ...bareMetadata({ name: "worker-b" }),
              usageModel: "bundled",
              ...storedBundle({ marker: "old-b" }),
            },
            firstSeenAt: OLD,
            providerId: "worker-b",
          }),
        ],
      }),
    );
    expect(folded.outcome).toEqual({
      complete: false,
      entityCount: 2,
      kind: "worker-script",
      permissionBlocked: { detail: `${failedScope}: ${BUNDLE_DENIED}`, unblockedBy: TOKEN_REMEDY },
      reasons: [reason],
    });
    expect(folded.file.coverage).toEqual([
      {
        lastSuccessAt: OLD,
        latestAttemptFailed: true,
        reason,
        scope: KIND_SCOPE,
        state: "unreadable",
        unblockedBy: null,
        visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
      },
    ]);
    expect(folded.file.gaps).toEqual([
      {
        condition: "permission-refused",
        firstDetectedAt: AT,
        id: cloudflareGapId({ condition: "permission-refused", scope: failedScope }),
        kind: "worker-script",
        lastCheckedAt: AT,
        lastDetectedAt: AT,
        reason: BUNDLE_DENIED,
        scope: failedScope,
        status: "open",
      },
    ]);
  });
});
