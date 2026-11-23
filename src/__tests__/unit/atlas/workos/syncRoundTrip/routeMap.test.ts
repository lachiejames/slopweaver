/**
 * The route-map half of the sync, end to end against a fake transport and a throwaway home: a run with no key
 * still publishes a complete route map and every declared dashboard address, the oracle control refuses a whole
 * run rather than publishing a wrong one, and an absent pair is kept as an entity.
 */
import { describe, expect, it } from "vitest";

import type { WorkosFetch } from "../../../../../atlas/workos/client.js";
import { WORKOS_DASHBOARD_ROUTES } from "../../../../../atlas/workos/dashboardPages.js";
import type { WorkosOperationApiDetail } from "../../../../../atlas/workos/model.js";
import { WORKOS_ORACLE_CONTROL_PATH, WORKOS_ROUTE_CANDIDATES } from "../../../../../atlas/workos/routeCandidates.js";
import { readWorkosKindFile, workosAtlasPaths } from "../../../../../atlas/workos/store.js";
import { syncWorkosApiSurface } from "../../../../../atlas/workos/sync.js";
import { unwrap } from "../../../../../lib/result.js";

import { AT } from "../workosFixtures.js";

import { noKey, probeOnlyFetch, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

describe("syncWorkosApiSurface with no API key", () => {
  it("publishes the whole route map anyway, because the map needs no credential", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    const synced = await syncWorkosApiSurface({
      apiKey: noKey(),
      at: AT,
      env: {},
      fetch: probeOnlyFetch({ absentPath: "/webhooks" }),
      paths,
    });
    expect(synced.isOk()).toBe(true);
    expect(unwrap(synced).probedCount).toBe(WORKOS_ROUTE_CANDIDATES.length);
    expect(unwrap(synced).presentCount).toBe(WORKOS_ROUTE_CANDIDATES.length - 1);
    expect(unwrap(synced).absentCount).toBe(1);
  });

  it("grades the content half not-configured while the route half is synced", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    const synced = await syncWorkosApiSurface({
      apiKey: noKey(),
      at: AT,
      env: {},
      fetch: probeOnlyFetch({ absentPath: "/webhooks" }),
      paths,
    });
    expect(unwrap(synced).content).toBe("not-configured");

    const operations = readWorkosKindFile({ kind: "operation", paths });
    const cell = unwrap(operations)!.coverage.find((entry) => entry.surface === "api-route-map")!;
    expect(cell.state).toBe("synced");

    const organizations = readWorkosKindFile({ kind: "organization", paths });
    const contentCell = unwrap(organizations)!.coverage.find((entry) => entry.surface === "api-content")!;
    expect(contentCell.state).toBe("not-configured");
  });

  it("publishes every declared dashboard address, with none witnessed", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    await syncWorkosApiSurface({
      apiKey: noKey(),
      at: AT,
      env: {},
      fetch: probeOnlyFetch({ absentPath: "/webhooks" }),
      paths,
    });
    const pages = unwrap(readWorkosKindFile({ kind: "page", paths }))!;
    expect(pages.entities.length).toBe(WORKOS_DASHBOARD_ROUTES.length);
    expect(pages.entities.filter((page) => page.channels.browser !== null)).toEqual([]);
  });

  it("raises a route-candidate-absent gap naming the exact pair", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    await syncWorkosApiSurface({
      apiKey: noKey(),
      at: AT,
      env: {},
      fetch: probeOnlyFetch({ absentPath: "/webhooks" }),
      paths,
    });
    const operations = unwrap(readWorkosKindFile({ kind: "operation", paths }))!;
    const absent = operations.gaps.filter((gap) => gap.condition === "route-candidate-absent");
    expect(absent.map((gap) => gap.scope)).toEqual(["GET /webhooks"]);
  });

  it("raises the standing local-denominator gap on every run, filled map or not", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    await syncWorkosApiSurface({
      apiKey: noKey(),
      at: AT,
      env: {},
      fetch: probeOnlyFetch({ absentPath: "/webhooks" }),
      paths,
    });
    const operations = unwrap(readWorkosKindFile({ kind: "operation", paths }))!;
    const standing = operations.gaps.filter((gap) => gap.condition === "route-denominator-is-local");
    expect(standing.length).toBe(1);
  });

  it("raises the standing dashboard-unverifiable gap, distinct from the per-page unwitnessed ones", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    await syncWorkosApiSurface({
      apiKey: noKey(),
      at: AT,
      env: {},
      fetch: probeOnlyFetch({ absentPath: "/webhooks" }),
      paths,
    });
    const pages = unwrap(readWorkosKindFile({ kind: "page", paths }))!;
    const standing = pages.gaps.filter((gap) => gap.condition === "dashboard-route-unverifiable-without-session");
    const perPage = pages.gaps.filter((gap) => gap.condition === "dashboard-page-unwitnessed");
    expect(standing.length).toBe(1);
    expect(perPage.length).toBe(WORKOS_DASHBOARD_ROUTES.length);
  });
});

describe("syncWorkosApiSurface's oracle control", () => {
  // The route map's whole value rests on `absent` meaning something. A server that stopped distinguishing an
  // unrouted path would otherwise fill this atlas with routes that do not exist.
  it("refuses the whole run when the control path does not prove itself absent", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    const alwaysUnauthorized: WorkosFetch = () => Promise.resolve({ status: 401, text: '{"message":"Unauthorized"}' });
    const synced = await syncWorkosApiSurface({ apiKey: noKey(), at: AT, env: {}, fetch: alwaysUnauthorized, paths });
    expect(synced.isErr()).toBe(true);
    expect(synced._unsafeUnwrapErr()[0]).toContain("rather than proving itself absent");
  });

  it("publishes nothing at all when the control fails", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    const alwaysUnauthorized: WorkosFetch = () => Promise.resolve({ status: 401, text: '{"message":"Unauthorized"}' });
    await syncWorkosApiSurface({ apiKey: noKey(), at: AT, env: {}, fetch: alwaysUnauthorized, paths });
    expect(unwrap(readWorkosKindFile({ kind: "operation", paths }))).toBe(null);
  });
});

describe("the published route map", () => {
  it("records the absent pair as an entity rather than dropping it", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    await syncWorkosApiSurface({
      apiKey: noKey(),
      at: AT,
      env: {},
      fetch: probeOnlyFetch({ absentPath: "/webhooks" }),
      paths,
    });
    const operations = unwrap(readWorkosKindFile({ kind: "operation", paths }))!;
    const webhooks = operations.entities.find((entity) => entity.providerId === "GET /webhooks")!;
    expect((webhooks.channels.api!.detail as WorkosOperationApiDetail).verdict).toBe("absent");
  });

  it("publishes one entity per candidate, and no entity for the control path", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    await syncWorkosApiSurface({
      apiKey: noKey(),
      at: AT,
      env: {},
      fetch: probeOnlyFetch({ absentPath: "/webhooks" }),
      paths,
    });
    const operations = unwrap(readWorkosKindFile({ kind: "operation", paths }))!;
    expect(operations.entities.length).toBe(WORKOS_ROUTE_CANDIDATES.length);
    const control = operations.entities.filter((entity) => entity.providerId.includes(WORKOS_ORACLE_CONTROL_PATH));
    expect(control).toEqual([]);
  });
});
