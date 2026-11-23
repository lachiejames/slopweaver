/*
 * `readGithubSnapshot` over a generation published through the real store: the whole generation, in declared kind
 * order with the static descriptor, and every kind projected to its whole view under its own scope. The expected
 * views are written out here rather than derived from the adapter's own export.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { GITHUB_ATLAS_DESCRIPTOR } from "../../../../../atlas/github/descriptor.js";
import { GITHUB_KINDS, type GithubKind } from "../../../../../atlas/github/model.js";
import { readGithubSnapshot } from "../../../../../atlas/github/readAdapter.js";
import type { AtlasKindView } from "../../../../../atlas/kit/read.js";
import { SCREENSHOT, SEEN, surfaceFor } from "./entities.js";
import {
  AT,
  BLOCKED_KIND,
  entitiesFor,
  FAILED_KIND,
  isWebKind,
  PERMISSION_BLOCK,
  publishClean,
  scratchHome,
  successAtOf,
  useScratchHomes,
} from "./harness.js";

useScratchHomes();

/** The scope the adapter must render for each kind: the entity's own `scopeRef`, or `github` for the two without one. */
const EXPECTED_SCOPE: Readonly<Record<GithubKind, string>> = {
  "actions-policy": "example-org",
  "admin-page": "example-org",
  "code-scanning-default-setup": "example-org/example-repo",
  "code-security-configuration": "example-org",
  "custom-property-definition": "example-org",
  "custom-repository-role": "example-org",
  "deploy-key": "example-org/example-repo",
  environment: "example-org/example-repo/production",
  "github-app-installation": "example-org",
  "organization-settings": "example-org",
  "repository-label": "example-org/example-repo",
  "repository-security-settings": "example-org/example-repo",
  "repository-settings": "example-org/example-repo",
  "rest-operation": "github",
  ruleset: "example-org",
  "secret-name": "example-org",
  "variable-name": "example-org/example-repo",
  "web-request": "github",
  webhook: "example-org",
};

/** The coverage view one kind's cell must read back as. */
function expectedCoverage({ kind }: { kind: GithubKind }): AtlasKindView["coverage"] {
  if (isWebKind({ kind })) {
    return [
      {
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason: `the ${kind} walk stopped at its frontier`,
        scope: `${kind} scope`,
        state: "unavailable",
        surface: "github-web",
        unblockedBy: "widen the walk frontier",
      },
    ];
  }
  return [
    {
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: `every ${kind} was read`,
      scope: `${kind} scope`,
      state: "synced",
      surface: surfaceFor({ kind }),
      unblockedBy: null,
    },
  ];
}

/** The permission block the view must carry for one kind: the fixture's one block, or none. */
function expectedPermissionBlockOf({ kind }: { kind: GithubKind }): typeof PERMISSION_BLOCK | null {
  if (kind === BLOCKED_KIND) {
    return PERMISSION_BLOCK;
  }
  return null;
}

/** The view a kind must read back as, written out rather than derived from the adapter's own export. */
function expectedKindView({ kind }: { kind: GithubKind }): AtlasKindView {
  const entities = entitiesFor({ kind });
  const isAdminPage = kind === "admin-page";
  return {
    coverage: expectedCoverage({ kind }),
    entities: entities.map((entity) => ({
      detail: entity,
      id: entity.id,
      kind,
      observations: [
        {
          artifacts: isAdminPage ? [SCREENSHOT] : [],
          deepLink: `https://github.example.test/${kind}`,
          deepLinkStatus: isAdminPage ? "browser-discovered" : "provider-provided",
          endpoint: `/example/${kind}`,
          observedAt: SEEN,
          state: "observed",
          surface: surfaceFor({ kind }),
        },
      ],
      providerId: entity.providerId,
      scope: EXPECTED_SCOPE[kind],
    })),
    gaps: [
      {
        condition: "admin-page-unreachable",
        id: `gap-${kind}`,
        lastDetectedAt: AT,
        reason: `one ${kind} redirected`,
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

describe("readGithubSnapshot", () => {
  it("reads a published generation back: the whole generation, in declared kind order, with the static descriptor", () => {
    const home = scratchHome();
    publishClean({ home });
    const snapshot = unwrap(readGithubSnapshot({ home }));
    expect(snapshot.descriptor).toEqual(GITHUB_ATLAS_DESCRIPTOR);
    expect(snapshot.generation).toEqual({
      mismatched: [],
      missing: [],
      platform: "github",
      schemaVersion: 2,
      superseded: [],
      unpublished: [],
      updatedAt: AT,
    });
    expect(snapshot.kinds.map((view) => view.kind)).toEqual([...GITHUB_KINDS]);
  });

  it("projects every kind to its whole view: the entity as detail, one observation from its own source, its own scope", () => {
    const home = scratchHome();
    publishClean({ home });
    const snapshot = unwrap(readGithubSnapshot({ home }));
    expect(snapshot.kinds).toEqual(GITHUB_KINDS.map((kind) => expectedKindView({ kind })));
  });
});
