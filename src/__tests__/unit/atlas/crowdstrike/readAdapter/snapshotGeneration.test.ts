/*
 * `readCrowdstrikeSnapshot` over a generation published through the real store: the whole generation, in declared
 * kind order with the static descriptor, and every kind projected to its whole view. The expected views are
 * written out here rather than derived from the adapter's own export.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { CROWDSTRIKE_ATLAS_DESCRIPTOR } from "../../../../../atlas/crowdstrike/descriptor.js";
import { CROWDSTRIKE_KINDS, type CrowdstrikeKind } from "../../../../../atlas/crowdstrike/model.js";
import { readCrowdstrikeSnapshot } from "../../../../../atlas/crowdstrike/readAdapter.js";
import type { AtlasKindView } from "../../../../../atlas/kit/read.js";
import { SEEN } from "./entities.js";
import {
  AT,
  BLOCKED_KIND,
  entitiesFor,
  FAILED_KIND,
  isConsoleKind,
  PERMISSION_BLOCK,
  publishClean,
  scratchHome,
  successAtOf,
  useScratchHomes,
} from "./harness.js";

useScratchHomes();

/** The coverage view one kind's cell must read back as. */
function expectedCoverage({ kind }: { kind: CrowdstrikeKind }): AtlasKindView["coverage"] {
  if (isConsoleKind({ kind })) {
    return [
      {
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason: `98 of 553 declared ${kind} routes rendered`,
        scope: `${kind} scope`,
        state: "unavailable",
        surface: "falcon-console",
        unblockedBy: "license the missing modules",
      },
    ];
  }
  return [
    {
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: `every ${kind} page was read`,
      scope: `${kind} scope`,
      state: "synced",
      surface: "falcon-api",
      unblockedBy: null,
    },
  ];
}

/** The permission block the view must carry for one kind: the fixture's one block, or none. */
function expectedPermissionBlockOf({ kind }: { kind: CrowdstrikeKind }): typeof PERMISSION_BLOCK | null {
  if (kind === BLOCKED_KIND) {
    return PERMISSION_BLOCK;
  }
  return null;
}

/** The view a kind must read back as, written out rather than derived from the adapter's own export. */
function expectedKindView({ kind }: { kind: CrowdstrikeKind }): AtlasKindView {
  const entities = entitiesFor({ kind });
  return {
    coverage: expectedCoverage({ kind }),
    entities: entities.map((entity) => ({
      detail: entity,
      id: entity.id,
      kind,
      observations: [
        {
          artifacts: entity.source.artifacts,
          deepLink: `https://falcon.example-cloud.test/${kind}`,
          deepLinkStatus: entity.source.deepLinkStatus,
          endpoint: `/example/${kind}`,
          observedAt: SEEN,
          state: "observed",
          surface: entity.source.surface,
        },
      ],
      providerId: entity.providerId,
      scope: "crowdstrike",
    })),
    gaps: [
      {
        condition: "scope-refused",
        id: `gap-${kind}`,
        lastDetectedAt: AT,
        reason: `the client may not read every ${kind} field`,
        scope: `${kind} scope`,
        status: "open",
      },
    ],
    kind,
    lastSuccessAt: successAtOf({ kind }),
    latestAttemptFailed: kind === FAILED_KIND,
    permissionBlocked: expectedPermissionBlockOf({ kind }),
    publishedCount: entities.length,
  };
}

describe("readCrowdstrikeSnapshot", () => {
  it("reads a published generation back: the whole generation, in declared kind order, with the static descriptor", () => {
    const home = scratchHome();
    publishClean({ home });
    const snapshot = unwrap(readCrowdstrikeSnapshot({ home }));
    expect(snapshot.descriptor).toEqual(CROWDSTRIKE_ATLAS_DESCRIPTOR);
    expect(snapshot.generation).toEqual({
      mismatched: [],
      missing: [],
      platform: "crowdstrike",
      schemaVersion: 1,
      superseded: [],
      unpublished: [],
      updatedAt: AT,
    });
    expect(snapshot.kinds.map((view) => view.kind)).toEqual([...CROWDSTRIKE_KINDS]);
  });

  it("projects every kind to its whole view: the entity as detail, one observation from its own source, scope crowdstrike", () => {
    const home = scratchHome();
    publishClean({ home });
    const snapshot = unwrap(readCrowdstrikeSnapshot({ home }));
    expect(snapshot.kinds).toEqual(CROWDSTRIKE_KINDS.map((kind) => expectedKindView({ kind })));
  });
});
