/*
 * The coverage cell each kind carries out of one sync, for the halves a round trip cannot pin exactly.
 *
 * `syncRoundTrip/*.test.ts` prove a cell reaches a published file; what is asserted here is the state and the
 * prose a reader grades the atlas on, and that a run replaces only the `api` cell of its own surface.
 */
import { describe, expect, it } from "vitest";

import type { WorkosContentKind, WorkosFamilyGrade } from "../../../../atlas/workos/contentAcquire.js";
import { succeededWorkosCoverageCell } from "../../../../atlas/workos/coverage.js";
import { emptyWorkosKindFile, type WorkosAtlasKind, type WorkosAtlasKindFile } from "../../../../atlas/workos/model.js";
import { WORKOS_ROUTE_CANDIDATES } from "../../../../atlas/workos/routeCandidates.js";
import { classifyWorkosProbe } from "../../../../atlas/workos/routeProbe.js";
import { coverageFor } from "../../../../atlas/workos/syncCoverage.js";
import type { WorkosAcquisition } from "../../../../atlas/workos/syncGaps.js";

import { AT, genericNotFound, TEST_ENVIRONMENT_ID, unauthorized } from "./workosFixtures.js";

/** An instant before {@link AT}, standing for the last run that read a family successfully. */
const PRIOR_AT = "2026-09-01T00:00:00.000Z";

const NOT_CONFIGURED: WorkosFamilyGrade = { outcome: "not-configured", reason: "no key" };

/** A run whose credentialled half never happened, with one family's grade overridden. */
function acquisitionWith({ kind, grade }: { kind: WorkosContentKind; grade: WorkosFamilyGrade }): WorkosAcquisition {
  return {
    content: { connections: [], directories: [], organizations: [], users: [] },
    families: {
      connection: NOT_CONFIGURED,
      directory: NOT_CONFIGURED,
      organization: NOT_CONFIGURED,
      user: NOT_CONFIGURED,
      [kind]: grade,
    },
    outcome: "not-configured",
    probed: [],
    reason: "no key",
  };
}

/** A stored kind file carrying exactly the given cells. */
function storedWith({
  kind,
  coverage,
}: {
  kind: WorkosAtlasKind;
  coverage: WorkosAtlasKindFile["coverage"];
}): WorkosAtlasKindFile {
  return { ...emptyWorkosKindFile({ kind, updatedAt: AT }), coverage };
}

/** The fields of each cell that grading decides, in order. */
function graded({ cells }: { cells: WorkosAtlasKindFile["coverage"] }): Record<string, unknown>[] {
  return cells.map((cell) => ({
    channel: cell.channel,
    lastSuccessAt: cell.lastSuccessAt,
    latestAttemptFailed: cell.latestAttemptFailed,
    reason: cell.reason,
    role: cell.role,
    scope: cell.scope,
    state: cell.state,
    surface: cell.surface,
  }));
}

describe("coverageFor, on the operation kind", () => {
  it("reports the probed, present and absent counts on the route-map surface", () => {
    const acquisition: WorkosAcquisition = {
      ...acquisitionWith({ grade: NOT_CONFIGURED, kind: "organization" }),
      probed: [
        {
          candidate: WORKOS_ROUTE_CANDIDATES[0]!,
          classification: classifyWorkosProbe({ response: unauthorized() }),
          statusCode: 401,
        },
        {
          candidate: WORKOS_ROUTE_CANDIDATES[1]!,
          classification: classifyWorkosProbe({ response: genericNotFound() }),
          statusCode: 404,
        },
      ],
    };
    const cells = coverageFor({
      acquisition,
      at: AT,
      environment: { reason: "no walk yet", state: "unknown" },
      kind: "operation",
      stored: storedWith({ coverage: [], kind: "operation" }),
    });
    expect(graded({ cells })).toStrictEqual([
      {
        channel: "api",
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason:
          "2 candidate (method, path) pair(s) probed against the running API with no credential; 1 proved " +
          "present by the server's own answer and 1 proved not routed under that method",
        role: "authoritative",
        scope: "probed-route-table",
        state: "synced",
        surface: "api-route-map",
      },
    ]);
  });
});

describe("coverageFor, on the page kind", () => {
  it("declares the page map and keeps the browser channel's cell on the same surface", () => {
    const browserCell = succeededWorkosCoverageCell({
      artifacts: [],
      at: PRIOR_AT,
      channel: "browser",
      reason: "walked",
      role: "authoritative",
      scope: "signed-in-walk",
      state: "synced",
      surface: "dashboard-page-map",
    });
    const cells = coverageFor({
      acquisition: acquisitionWith({ grade: NOT_CONFIGURED, kind: "organization" }),
      at: AT,
      environment: { environmentId: TEST_ENVIRONMENT_ID, source: "witnessed-walk", state: "resolved" },
      kind: "page",
      stored: storedWith({ coverage: [browserCell], kind: "page" }),
    });
    expect(graded({ cells })).toStrictEqual([
      {
        channel: "browser",
        lastSuccessAt: PRIOR_AT,
        latestAttemptFailed: false,
        reason: "walked",
        role: "authoritative",
        scope: "signed-in-walk",
        state: "synced",
        surface: "dashboard-page-map",
      },
      {
        channel: "api",
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason:
          "13 dashboard address(es) declared with their exact URLs, 10 of them under this install's environment " +
          "segment (environment witnessed by a previous dashboard walk). Only /settings is corroborated without " +
          "a session — it redirects to /settings/team rather than to the sign-in catch-all every other path " +
          "answers, so the rest are declared and not evidenced",
        role: "discovery",
        scope: "declared-dashboard-routes",
        state: "synced",
        surface: "dashboard-page-map",
      },
    ]);
  });
});

describe("coverageFor, on a content kind", () => {
  // The family was never attempted, so a "0 organization(s) read" prefix would read as a measurement.
  it("reports an unattempted family by its reason alone", () => {
    const cells = coverageFor({
      acquisition: acquisitionWith({ grade: NOT_CONFIGURED, kind: "organization" }),
      at: AT,
      environment: { reason: "no walk yet", state: "unknown" },
      kind: "organization",
      stored: storedWith({ coverage: [], kind: "organization" }),
    });
    expect(graded({ cells })).toStrictEqual([
      {
        channel: "api",
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason: "no key",
        role: "authoritative",
        scope: "api-key-environment",
        state: "not-configured",
        surface: "api-content",
      },
    ]);
  });

  it("defers a truncated family, leading with its count", () => {
    const cells = coverageFor({
      acquisition: acquisitionWith({ grade: { outcome: "truncated", reason: "page bound hit" }, kind: "user" }),
      at: AT,
      environment: { reason: "no walk yet", state: "unknown" },
      kind: "user",
      stored: storedWith({ coverage: [], kind: "user" }),
    });
    expect(graded({ cells })).toStrictEqual([
      {
        channel: "api",
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason: "0 user(s) read from the API — page bound hit",
        role: "authoritative",
        scope: "api-key-environment",
        state: "deferred",
        surface: "api-content",
      },
    ]);
  });

  // The failed constructor keeps the prior success's instant, so a freshness sweep can tell this family never
  // looked this run.
  it("replaces a failed family's prior cell and keeps its last success", () => {
    const prior = succeededWorkosCoverageCell({
      artifacts: [],
      at: PRIOR_AT,
      channel: "api",
      reason: "3 directory(s) read from the API",
      role: "authoritative",
      scope: "api-key-environment",
      state: "synced",
      surface: "api-content",
    });
    const cells = coverageFor({
      acquisition: acquisitionWith({ grade: { outcome: "failed", reason: "HTTP 500" }, kind: "directory" }),
      at: AT,
      environment: { reason: "no walk yet", state: "unknown" },
      kind: "directory",
      stored: storedWith({ coverage: [prior], kind: "directory" }),
    });
    expect(graded({ cells })).toStrictEqual([
      {
        channel: "api",
        lastSuccessAt: PRIOR_AT,
        latestAttemptFailed: true,
        reason: "0 directory(s) read from the API — HTTP 500",
        role: "authoritative",
        scope: "api-key-environment",
        state: "unreadable",
        surface: "api-content",
      },
    ]);
  });
});
