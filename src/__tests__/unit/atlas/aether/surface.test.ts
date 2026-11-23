/**
 * Publishing a walk into the store, and reading it back through the real read adapter.
 *
 * A round-trip in a per-test temp home (never the ambient `$SLOPWEAVER_HOME`): a walk that read the portal
 * stores its findings and project and grades every kind synced; a walk that hit the sign-in wall stores
 * nothing new and leaves the prior generation's records exactly as they were.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readAetherSnapshot } from "../../../../atlas/aether/readAdapter.js";
import { aetherAtlasPaths } from "../../../../atlas/aether/store.js";
import { publishAetherWalk } from "../../../../atlas/aether/surface.js";
import type { AetherPageObservation, AetherWalkResult, CapturedPortalResponse } from "../../../../atlas/aether/walk.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-15T12:00:00.000Z";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "aether-surface-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A landed page observation. */
function page({ href, responseCount = 0 }: { href: string; responseCount?: number }): AetherPageObservation {
  return {
    artifacts: [],
    finalUrl: `https://app.tryaether.ai${href}`,
    href,
    outcome: "landed",
    rendered: true,
    responseCount,
    section: "s",
    statusCode: 200,
    title: "Aether",
  };
}

/** A `/api/findings?tab=open` response carrying one finding. */
function openFindingsResponse(): CapturedPortalResponse {
  return {
    body: {
      data: [
        {
          createdAt: "2026-04-14T11:21:46+00:00",
          findingId: "AETHER-APP-127",
          id: 2464,
          lastUpdatedAt: "2026-04-22T05:09:16+00:00",
          projectName: "Application Suite",
          severity: "medium",
          sourceType: "report",
          status: 1,
          title: "GraphQL Alias-Based Batching",
        },
      ],
    },
    method: "GET",
    onPage: "/api/findings?tab=open&page=1&limit=100",
    statusCode: 200,
    url: "https://app.tryaether.ai/api/findings?tab=open&page=1&limit=100",
  };
}

/** The `/api/findings/stats` response carrying the project. */
function statsResponse(): CapturedPortalResponse {
  return {
    body: { sources: [{ name: "Application Suite", uuid: "00ecd21a-876e-4ae9-9218-2dc5711f88a9" }], total: 33 },
    method: "GET",
    onPage: "/api/findings/stats",
    statusCode: 200,
    url: "https://app.tryaether.ai/api/findings/stats",
  };
}

/** A successful walk carrying one finding and its project. */
function readWalk(): AetherWalkResult {
  return {
    artifactsWritten: 1,
    finalUrls: ["https://app.tryaether.ai/home"],
    incompletePages: [],
    loginWallPages: [],
    notAttempted: [],
    pages: [page({ href: "/home" }), page({ href: "/api/findings?tab=open&page=1&limit=100", responseCount: 1 })],
    responses: [statsResponse(), openFindingsResponse()],
    unrenderedPages: [],
  };
}

describe("publishAetherWalk", () => {
  it("stores the walk's findings and project, and reads them back", () => {
    const outcome = unwrap(publishAetherWalk({ at: AT, paths: aetherAtlasPaths({ home }), walk: readWalk() }));
    expect(outcome.findingCount).toBe(1);
    expect(outcome.projectCount).toBe(1);
    expect(outcome.loggedOut).toBe(false);

    const snapshot = unwrap(readAetherSnapshot({ home }));
    const finding = snapshot.kinds.find((kind) => kind.kind === "finding")!;
    expect(finding.entities.length).toBe(1);
    expect(finding.publishedCount).toBe(1);
    const project = snapshot.kinds.find((kind) => kind.kind === "project")!;
    expect(project.entities.length).toBe(1);
  });

  it("marks the portal surface filled once every kind has a recorded success", () => {
    unwrap(publishAetherWalk({ at: AT, paths: aetherAtlasPaths({ home }), walk: readWalk() }));
    const snapshot = unwrap(readAetherSnapshot({ home }));
    const surface = snapshot.descriptor.surfaces.find((s) => s.name === "aether-portal")!;
    expect(surface.status).toBe("filled");
  });

  it("a login-wall walk stores nothing new and leaves the prior findings untouched", () => {
    unwrap(publishAetherWalk({ at: AT, paths: aetherAtlasPaths({ home }), walk: readWalk() }));
    const loggedOut: AetherWalkResult = {
      artifactsWritten: 0,
      finalUrls: ["https://app.tryaether.ai/login"],
      incompletePages: [],
      loginWallPages: ["/home"],
      notAttempted: [],
      pages: [
        {
          ...page({ href: "/home" }),
          finalUrl: "https://app.tryaether.ai/login",
          outcome: "login-wall",
          rendered: false,
        },
      ],
      responses: [],
      unrenderedPages: [],
    };
    const outcome = unwrap(
      publishAetherWalk({ at: "2026-09-15T13:00:00.000Z", paths: aetherAtlasPaths({ home }), walk: loggedOut }),
    );
    expect(outcome.loggedOut).toBe(true);

    const snapshot = unwrap(readAetherSnapshot({ home }));
    const finding = snapshot.kinds.find((kind) => kind.kind === "finding")!;
    expect(finding.entities.length).toBe(1);
    expect(finding.latestAttemptFailed).toBe(true);
  });
});
