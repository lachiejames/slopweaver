/**
 * How the sync and the dashboard walk share the page atlas, end to end against a fake transport and a throwaway
 * home: neither writer blanks the other's channel, the next sync addresses the declared pages from the
 * environment a walk was redirected into, and the environment and moved-surface gaps stand until settled.
 */
import { describe, expect, it } from "vitest";

import { parseWorkosWalkDocument, publishWorkosWalk } from "../../../../../atlas/workos/browserSurface.js";
import { WORKOS_DASHBOARD_ROUTES } from "../../../../../atlas/workos/dashboardPages.js";
import { readWorkosKindFile, workosAtlasPaths } from "../../../../../atlas/workos/store.js";
import { syncWorkosApiSurface } from "../../../../../atlas/workos/sync.js";
import { unwrap } from "../../../../../lib/result.js";

import { AT, TEST_ENVIRONMENT_ID } from "../workosFixtures.js";

import { noKey, probeOnlyFetch, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

describe("the two writers", () => {
  // Two passes write this atlas and the merge is channel-scoped, so a sync landing after a walk must leave
  // the walk's witnesses exactly where they were.
  it("a sync after a walk keeps every browser-channel witness", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    await syncWorkosApiSurface({
      apiKey: noKey(),
      at: AT,
      env: {},
      fetch: probeOnlyFetch({ absentPath: "/webhooks" }),
      paths,
    });
    const document = unwrap(
      parseWorkosWalkDocument({
        json: {
          pages: [
            {
              finalUrl: "https://dashboard.workos.com/organizations",
              providerId: "/organizations",
              reached: true,
              requestedUrl: "https://dashboard.workos.com/organizations",
              screenshotPath: null,
              statusCode: 200,
              title: "Organizations",
              unreachableBecause: null,
            },
          ],
          signedIn: true,
          walkedAt: AT,
        },
      }),
    );
    const walked = publishWorkosWalk({ at: AT, document, paths, screenshots: [] });
    expect(walked.isOk()).toBe(true);

    await syncWorkosApiSurface({
      apiKey: noKey(),
      at: "2026-09-06T00:00:00.000Z",
      env: {},
      fetch: probeOnlyFetch({ absentPath: "/webhooks" }),
      paths,
    });
    const pages = unwrap(readWorkosKindFile({ kind: "page", paths }))!;
    const organizations = pages.entities.find((page) => page.providerId === "/organizations")!;
    expect(organizations.channels.browser?.state).toBe("observed");
    expect(organizations.channels.api?.state).toBe("observed");
  });

  it("a walk after a sync keeps every api-channel declared address", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    await syncWorkosApiSurface({
      apiKey: noKey(),
      at: AT,
      env: {},
      fetch: probeOnlyFetch({ absentPath: "/webhooks" }),
      paths,
    });
    const document = unwrap(
      parseWorkosWalkDocument({
        json: {
          pages: [
            {
              finalUrl: "https://dashboard.workos.com/users",
              providerId: "/users",
              reached: true,
              requestedUrl: "https://dashboard.workos.com/users",
              screenshotPath: null,
              statusCode: 200,
              title: "Users",
              unreachableBecause: null,
            },
          ],
          signedIn: true,
          walkedAt: AT,
        },
      }),
    );
    publishWorkosWalk({ at: AT, document, paths, screenshots: [] });
    const pages = unwrap(readWorkosKindFile({ kind: "page", paths }))!;
    expect(pages.entities.length).toBe(WORKOS_DASHBOARD_ROUTES.length);
    const declaredStill = pages.entities.filter((page) => page.channels.api !== null);
    expect(declaredStill.length).toBe(WORKOS_DASHBOARD_ROUTES.length);
  });
});

describe("the environment segment", () => {
  // The whole seam: WorkOS redirects a bare environment route into `/environment_<id>/…`, the walk records
  // where it ENDED, and the next sync addresses every environment route from that witness. Nothing here is
  // configured — the dashboard's own redirect is what taught the atlas its environment.
  it("addresses the declared pages from the environment a previous walk was redirected into", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    await syncWorkosApiSurface({
      apiKey: noKey(),
      at: AT,
      env: {},
      fetch: probeOnlyFetch({ absentPath: "/webhooks" }),
      paths,
    });
    const beforeWalk = unwrap(readWorkosKindFile({ kind: "page", paths }))!;
    const bootstrap = beforeWalk.entities.find((page) => page.providerId === "/api-keys")!;
    expect(bootstrap.channels.api?.source?.deepLink).toBe("https://dashboard.workos.com/api-keys");

    const document = unwrap(
      parseWorkosWalkDocument({
        json: {
          pages: [
            {
              finalUrl: `https://dashboard.workos.com/${TEST_ENVIRONMENT_ID}/api-keys`,
              providerId: "/api-keys",
              reached: true,
              requestedUrl: "https://dashboard.workos.com/api-keys",
              screenshotPath: null,
              statusCode: 200,
              title: "API Keys | WorkOS",
              unreachableBecause: null,
            },
          ],
          signedIn: true,
          walkedAt: AT,
        },
      }),
    );
    expect(publishWorkosWalk({ at: AT, document, paths, screenshots: [] }).isOk()).toBe(true);

    await syncWorkosApiSurface({
      apiKey: noKey(),
      at: "2026-09-06T00:00:00.000Z",
      env: {},
      fetch: probeOnlyFetch({ absentPath: "/webhooks" }),
      paths,
    });
    const pages = unwrap(readWorkosKindFile({ kind: "page", paths }))!;
    const organizations = pages.entities.find((page) => page.providerId === "/organizations")!;
    const team = pages.entities.find((page) => page.providerId === "/settings/team")!;
    expect(organizations.channels.api?.source?.deepLink).toBe(
      `https://dashboard.workos.com/${TEST_ENVIRONMENT_ID}/organizations`,
    );
    expect(team.channels.api?.source?.deepLink).toBe("https://dashboard.workos.com/settings/team");
  });

  // A bootstrap address must SAY it is one, or a reader cannot tell it from a current address.
  it("raises the unresolved-environment gap until a walk settles the segment, and drops it after", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    await syncWorkosApiSurface({
      apiKey: noKey(),
      at: AT,
      env: {},
      fetch: probeOnlyFetch({ absentPath: "/webhooks" }),
      paths,
    });
    const before = unwrap(readWorkosKindFile({ kind: "page", paths }))!;
    expect(before.gaps.filter((gap) => gap.condition === "dashboard-environment-unresolved").length).toBe(1);

    const document = unwrap(
      parseWorkosWalkDocument({
        json: {
          pages: [
            {
              finalUrl: `https://dashboard.workos.com/${TEST_ENVIRONMENT_ID}/webhooks`,
              providerId: "/webhooks",
              reached: true,
              requestedUrl: "https://dashboard.workos.com/webhooks",
              screenshotPath: null,
              statusCode: 200,
              title: "Webhooks | WorkOS",
              unreachableBecause: null,
            },
          ],
          signedIn: true,
          walkedAt: AT,
        },
      }),
    );
    expect(publishWorkosWalk({ at: AT, document, paths, screenshots: [] }).isOk()).toBe(true);
    await syncWorkosApiSurface({
      apiKey: noKey(),
      at: "2026-09-06T00:00:00.000Z",
      env: {},
      fetch: probeOnlyFetch({ absentPath: "/webhooks" }),
      paths,
    });
    const after = unwrap(readWorkosKindFile({ kind: "page", paths }))!;
    expect(after.gaps.filter((gap) => gap.condition === "dashboard-environment-unresolved")).toEqual([]);
  });

  // The SSO surface is gone from the route table; the gap is the only thing carrying that it ever existed.
  it("keeps the moved-surface gap standing for the SSO page it no longer declares", async () => {
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
    const moved = pages.gaps.filter((gap) => gap.condition === "dashboard-surface-moved-unknown-address");
    expect(moved.length).toBe(1);
    expect(moved[0]!.scope).toBe("/sso");
  });

  it("takes a declared environment over a walk's witness", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    await syncWorkosApiSurface({
      apiKey: noKey(),
      at: AT,
      env: { WORKOS_ENVIRONMENT_ID: TEST_ENVIRONMENT_ID },
      fetch: probeOnlyFetch({ absentPath: "/webhooks" }),
      paths,
    });
    const pages = unwrap(readWorkosKindFile({ kind: "page", paths }))!;
    const users = pages.entities.find((page) => page.providerId === "/users")!;
    expect(users.channels.api?.source?.deepLink).toBe(`https://dashboard.workos.com/${TEST_ENVIRONMENT_ID}/users`);
    expect(pages.gaps.filter((gap) => gap.condition === "dashboard-environment-unresolved")).toEqual([]);
  });
});
