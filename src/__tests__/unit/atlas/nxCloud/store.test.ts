import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NxCloudBrowserWalkResult } from "../../../../atlas/nxCloud/browserObservation.js";
import { buildNxCloudBrowserSurface, publishNxCloudBrowserSurface } from "../../../../atlas/nxCloud/browserSurface.js";
import { readNxCloudSnapshot } from "../../../../atlas/nxCloud/readAdapter.js";
import { resetNxCloudAtlas } from "../../../../atlas/nxCloud/reset.js";
import {
  type NxCloudAtlasPaths,
  nxCloudAtlasPaths,
  readNxCloudAtlas,
  readNxCloudKindFile,
} from "../../../../atlas/nxCloud/store.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";
const SCOPE = { orgId: "aaaaaaaaaaaaaaaaaaaaaaaa", workspaceId: "bbbbbbbbbbbbbbbbbbbbbbbb" };

let home: string;
let paths: NxCloudAtlasPaths;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-nx-cloud-store-"));
  paths = nxCloudAtlasPaths({ home });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A walk that reached one page and photographed it. */
const WALK: NxCloudBrowserWalkResult = {
  declaredRoutes: [{ index: false, parentId: null, path: "profile/tokens", routeId: "routes/_auth.profile.tokens" }],
  routes: [
    {
      artifacts: [
        {
          byteLength: 4,
          kind: "page-png",
          mediaType: "image/png",
          relativePath: "artifacts/pages/x.png",
          sha256: "b".repeat(64),
        },
      ],
      attempted: true,
      calls: [],
      captureComplete: true,
      finalUrl: "https://cloud.nx.app/profile/tokens",
      observedAt: AT,
      pathPattern: "/profile/tokens",
      redirected: false,
      requestedUrl: "https://cloud.nx.app/profile/tokens",
      responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
      screenshotMissingBecause: null,
      statusCode: 200,
      title: "Personal access tokens",
      unreachableBecause: null,
    },
  ],
  sessionLost: false,
};

describe("publishNxCloudBrowserSurface", () => {
  it("writes a route file the store can read back", () => {
    unwrap(publishNxCloudBrowserSurface({ at: AT, denylist: [], paths, scope: SCOPE, walk: WALK }));
    expect(unwrap(readNxCloudKindFile({ kind: "route", paths }))!.entities.length).toBe(1);
  });

  it("stamps the manifest for the kinds it wrote and leaves the others never-synced", () => {
    unwrap(publishNxCloudBrowserSurface({ at: AT, denylist: [], paths, scope: SCOPE, walk: WALK }));
    const snapshot = unwrap(readNxCloudAtlas({ paths }));
    expect([snapshot.manifest!.kinds.route.lastSuccessAt, snapshot.manifest!.kinds.workspace.lastSuccessAt]).toEqual([
      AT,
      null,
    ]);
  });

  it("refuses to write a generation carrying a credential, and writes nothing at all", () => {
    const leaky: NxCloudBrowserWalkResult = {
      ...WALK,
      routes: [{ ...WALK.routes[0]!, title: "cookie: _nxCloudSession=abc" }],
    };
    const refused = publishNxCloudBrowserSurface({ at: AT, denylist: [], paths, scope: SCOPE, walk: leaky });
    expect([refused.isErr(), existsSync(paths.manifest)]).toEqual([true, false]);
  });

  it("accumulates rather than replacing: a second publish keeps the first run's first-seen stamp", () => {
    unwrap(publishNxCloudBrowserSurface({ at: AT, denylist: [], paths, scope: SCOPE, walk: WALK }));
    const later = "2026-09-06T00:00:00.000Z";
    unwrap(publishNxCloudBrowserSurface({ at: later, denylist: [], paths, scope: SCOPE, walk: WALK }));
    const entity = unwrap(readNxCloudKindFile({ kind: "route", paths }))!.entities[0]!;
    expect(entity.channels.browser!.firstSeenAt).toBe(AT);
  });
});

describe("readNxCloudSnapshot", () => {
  it("projects the descriptor a catalogue reads", () => {
    expect(unwrap(readNxCloudSnapshot({ home })).descriptor.platform).toBe("nx-cloud");
  });

  it("reports every kind even before anything has been published", () => {
    expect(unwrap(readNxCloudSnapshot({ home })).kinds.map((kind) => kind.kind)).toEqual([
      "organization",
      "workspace",
      "route",
      "endpoint",
      "family",
    ]);
  });

  it("projects a published route into one observation per channel that looked", () => {
    unwrap(publishNxCloudBrowserSurface({ at: AT, denylist: [], paths, scope: SCOPE, walk: WALK }));
    const routes = unwrap(readNxCloudSnapshot({ home })).kinds.find((kind) => kind.kind === "route")!;
    expect(routes.entities[0]!.observations.map((observation) => observation.surface)).toEqual(["browser"]);
  });

  it("carries the workspace an entity was read under as its scope", () => {
    unwrap(publishNxCloudBrowserSurface({ at: AT, denylist: [], paths, scope: SCOPE, walk: WALK }));
    const routes = unwrap(readNxCloudSnapshot({ home })).kinds.find((kind) => kind.kind === "route")!;
    expect(routes.entities[0]!.scope).toBe(SCOPE.workspaceId);
  });
});

describe("resetNxCloudAtlas", () => {
  it("leaves the prior generation on disk rather than deleting it", () => {
    unwrap(publishNxCloudBrowserSurface({ at: AT, denylist: [], paths, scope: SCOPE, walk: WALK }));
    expect(existsSync(unwrap(resetNxCloudAtlas({ at: AT, paths })).archivedTo)).toBe(true);
  });

  it("installs an empty generation for every kind, so what is current is complete", () => {
    unwrap(publishNxCloudBrowserSurface({ at: AT, denylist: [], paths, scope: SCOPE, walk: WALK }));
    unwrap(resetNxCloudAtlas({ at: AT, paths }));
    expect(unwrap(readNxCloudKindFile({ kind: "route", paths }))!.entities).toEqual([]);
  });

  it("leaves the atlas publishable again straight afterwards", () => {
    unwrap(publishNxCloudBrowserSurface({ at: AT, denylist: [], paths, scope: SCOPE, walk: WALK }));
    unwrap(resetNxCloudAtlas({ at: AT, paths }));
    const republished = publishNxCloudBrowserSurface({ at: AT, denylist: [], paths, scope: SCOPE, walk: WALK });
    expect(republished.isOk()).toBe(true);
  });
});

describe("buildNxCloudBrowserSurface + the store together", () => {
  it("publishes exactly the entities the pure build produced", () => {
    const built = buildNxCloudBrowserSurface({ at: AT, scope: SCOPE, walk: WALK });
    unwrap(publishNxCloudBrowserSurface({ at: AT, denylist: [], paths, scope: SCOPE, walk: WALK }));
    const stored = unwrap(readNxCloudKindFile({ kind: "route", paths }))!;
    expect(stored.entities.map((entity) => entity.providerId).toSorted()).toEqual(
      built.entities.route.map((entity) => entity.providerId).toSorted(),
    );
  });
});
