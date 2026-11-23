/**
 * Turning what each channel saw into entities.
 *
 * Three properties carry the two-surface design and none of them is visible from a passing sync: a projected
 * entity fills exactly ONE channel, a route the server does not serve is still an entity, and a declared
 * page's link is `unverified` rather than `browser-discovered` because nothing opened it.
 */
import { describe, expect, it } from "vitest";

import type { WorkosOperationApiDetail, WorkosPageDetail } from "../../../../atlas/workos/model.js";
import {
  projectWorkosConnections,
  projectWorkosDeclaredPages,
  projectWorkosDirectories,
  projectWorkosOperations,
  projectWorkosOrganizations,
  projectWorkosUsers,
  projectWorkosWitnessedPages,
  type WorkosProbedRoute,
} from "../../../../atlas/workos/projection.js";

import { AT, TEST_ENVIRONMENT_ID } from "./workosFixtures.js";

/** One probed route, present unless a caller says otherwise. */
function probed({
  verdict = "authenticated",
  statusCode = 401,
  declaredParams = [],
}: {
  verdict?: WorkosOperationApiDetail["verdict"];
  statusCode?: number;
  declaredParams?: readonly string[];
} = {}): WorkosProbedRoute {
  return {
    candidate: { family: "Organizations", httpMethod: "GET", path: "/organizations", writes: false },
    classification: { declaredParams, verdict },
    statusCode,
  };
}

describe("projectWorkosOperations", () => {
  it("keys an operation on the METHOD and the path together", () => {
    const entities = projectWorkosOperations({ at: AT, probed: [probed()] });
    expect(entities[0]?.providerId).toBe("GET /organizations");
  });

  it("fills the api channel and leaves the browser channel untouched", () => {
    const entity = projectWorkosOperations({ at: AT, probed: [probed()] })[0]!;
    expect(entity.channels.browser).toBe(null);
    expect(entity.channels.api?.channel).toBe("api");
  });

  it("carries the status code beside the verdict, so the classification is checkable", () => {
    const entity = projectWorkosOperations({ at: AT, probed: [probed({ statusCode: 422 })] })[0]!;
    const detail = entity.channels.api!.detail as WorkosOperationApiDetail;
    expect(detail.statusCode).toBe(422);
    expect(detail.verdict).toBe("authenticated");
  });

  // Dropping it would turn a measured negative into a silence, and the negative is half of what makes the
  // map falsifiable.
  it("still publishes a route the server does not serve", () => {
    const entities = projectWorkosOperations({ at: AT, probed: [probed({ statusCode: 404, verdict: "absent" })] });
    expect(entities.length).toBe(1);
    expect((entities[0]!.channels.api!.detail as WorkosOperationApiDetail).verdict).toBe("absent");
  });

  it("keeps the parameter names the server volunteered", () => {
    const entities = projectWorkosOperations({
      at: AT,
      probed: [probed({ declaredParams: ["client_id", "code"], statusCode: 422, verdict: "validation-echo" })],
    });
    expect((entities[0]!.channels.api!.detail as WorkosOperationApiDetail).declaredParams).toEqual([
      "client_id",
      "code",
    ]);
  });

  it("records no deep link for a route, since a route has no page of its own", () => {
    const entity = projectWorkosOperations({ at: AT, probed: [probed()] })[0]!;
    expect(entity.channels.api?.source?.deepLink).toBe(null);
    expect(entity.channels.api?.source?.deepLinkStatus).toBe("unavailable");
  });

  it("sorts by id, so a published file is byte-stable across runs that saw the same things", () => {
    const rows = [
      probed(),
      {
        candidate: { family: "Events", httpMethod: "GET" as const, path: "/events", writes: false },
        classification: { declaredParams: [], verdict: "authenticated" as const },
        statusCode: 401,
      },
    ];
    const ids = projectWorkosOperations({ at: AT, probed: rows }).map((entity) => entity.id);
    expect([...ids]).toEqual([...ids].toSorted());
  });
});

describe("projectWorkosDeclaredPages", () => {
  it("publishes an exact URL for every declared page before any browser runs", () => {
    const pages = projectWorkosDeclaredPages({ at: AT, environmentId: TEST_ENVIRONMENT_ID });
    const withoutLink = pages.filter((page) => page.channels.api?.source?.deepLink === null);
    expect(withoutLink).toEqual([]);
  });

  // The distinction the whole provenance contract rests on: this atlas COMPUTED the address, it did not
  // open it, and only a walk earns `browser-discovered`.
  it("marks every declared link unverified rather than browser-discovered", () => {
    const statuses = projectWorkosDeclaredPages({ at: AT, environmentId: TEST_ENVIRONMENT_ID }).map(
      (page) => page.channels.api?.source?.deepLinkStatus,
    );
    expect(new Set(statuses)).toEqual(new Set(["unverified"]));
  });

  it("addresses an environment route under the resolved segment and a root route without it", () => {
    const pages = projectWorkosDeclaredPages({ at: AT, environmentId: TEST_ENVIRONMENT_ID });
    const organizations = pages.find((page) => page.providerId === "/organizations")!;
    const team = pages.find((page) => page.providerId === "/settings/team")!;
    expect(organizations.channels.api?.source?.deepLink).toBe(
      `https://dashboard.workos.com/${TEST_ENVIRONMENT_ID}/organizations`,
    );
    expect(team.channels.api?.source?.deepLink).toBe("https://dashboard.workos.com/settings/team");
  });

  // The provider id is the entity's key, so it must not move when the environment does — otherwise every
  // page row would churn on the install that resolves its segment.
  it("keys a page on the bare path even when the address carries the environment", () => {
    const pages = projectWorkosDeclaredPages({ at: AT, environmentId: TEST_ENVIRONMENT_ID });
    const scoped = pages.filter((page) => page.providerId.includes(TEST_ENVIRONMENT_ID));
    expect(scoped).toEqual([]);
  });

  // The bootstrap deadlock, asserted rather than reasoned about: `declaredPagesFrom` drops a page with no
  // deepLink from the walk brief, and the walk's own witnessed finalUrl is the ONLY thing that reveals the
  // segment. Publish null here and an install that has never walked can never learn its own environment.
  it("still publishes an address for every page when no environment is resolved", () => {
    const pages = projectWorkosDeclaredPages({ at: AT, environmentId: null });
    expect(pages.length).toBeGreaterThan(0);
    const withoutLink = pages.filter((page) => page.channels.api?.source?.deepLink === null);
    expect(withoutLink).toEqual([]);
  });

  it("leaves reachedAt null, which is what separates a declared address from a witnessed one", () => {
    const details = projectWorkosDeclaredPages({ at: AT, environmentId: TEST_ENVIRONMENT_ID }).map(
      (page) => page.channels.api!.detail as WorkosPageDetail,
    );
    expect(details.filter((detail) => detail.reachedAt !== null)).toEqual([]);
  });
});

describe("projectWorkosWitnessedPages", () => {
  it("fills the browser channel and leaves the api channel untouched", () => {
    const entities = projectWorkosWitnessedPages({
      at: AT,
      witnessed: [
        {
          artifact: null,
          finalUrl: "https://dashboard.workos.com/organizations",
          path: "/organizations",
          title: "Organizations",
          unreachableBecause: null,
        },
      ],
    });
    expect(entities[0]?.channels.api).toBe(null);
    expect(entities[0]?.channels.browser?.source?.deepLinkStatus).toBe("browser-discovered");
  });

  it("keys a witness on the SAME provider id the declared row uses, so the two are one entity", () => {
    const declared = projectWorkosDeclaredPages({ at: AT, environmentId: TEST_ENVIRONMENT_ID }).find(
      (page) => page.providerId === "/organizations",
    )!;
    const witnessed = projectWorkosWitnessedPages({
      at: AT,
      witnessed: [
        {
          artifact: null,
          finalUrl: "https://dashboard.workos.com/organizations",
          path: "/organizations",
          title: null,
          unreachableBecause: null,
        },
      ],
    })[0]!;
    expect(witnessed.id).toBe(declared.id);
  });

  it("keeps an unreachable page and records why, rather than dropping it", () => {
    const entity = projectWorkosWitnessedPages({
      at: AT,
      witnessed: [
        {
          artifact: null,
          finalUrl: "https://dashboard.workos.com/signin",
          path: "/api-keys",
          title: null,
          unreachableBecause: "the account's dashboard role does not open this page",
        },
      ],
    })[0]!;
    const detail = entity.channels.browser!.detail as WorkosPageDetail;
    expect(detail.reachedAt).toBe(null);
    expect(detail.unreachableBecause).toBe("the account's dashboard role does not open this page");
  });

  it("keeps a witness for an address the declared table does not name", () => {
    const entity = projectWorkosWitnessedPages({
      at: AT,
      witnessed: [
        {
          artifact: null,
          finalUrl: "https://dashboard.workos.com/vault",
          path: "/vault",
          title: null,
          unreachableBecause: null,
        },
      ],
    })[0]!;
    expect(entity.providerId).toBe("/vault");
  });
});

describe("the content projections", () => {
  it("keys an organisation on WorkOS's own id and points at the dashboard list page", () => {
    const entity = projectWorkosOrganizations({
      at: AT,
      environmentId: TEST_ENVIRONMENT_ID,
      records: [{ domainCount: 1, id: "org_1", name: "One" }],
    })[0]!;
    expect(entity.providerId).toBe("org_1");
    expect(entity.channels.api?.source?.deepLink).toBe(
      `https://dashboard.workos.com/${TEST_ENVIRONMENT_ID}/organizations`,
    );
  });

  // The SSO page is gone from the route table and nothing has witnessed what replaced it, so a connection
  // says it has no address rather than pointing at one this atlas has stopped expecting to exist.
  it("gives a connection no dashboard link at all, and says the link is unavailable", () => {
    const entity = projectWorkosConnections({
      at: AT,
      environmentId: TEST_ENVIRONMENT_ID,
      records: [{ connectionType: "OktaSAML", id: "conn_1", organizationId: "org_1", state: "active" }],
    })[0]!;
    expect(entity.channels.api?.source?.deepLink).toBe(null);
    expect(entity.channels.api?.source?.deepLinkStatus).toBe("unavailable");
  });

  it("sorts a user's organisation ids so a stored file is stable", () => {
    const entity = projectWorkosUsers({
      at: AT,
      environmentId: TEST_ENVIRONMENT_ID,
      records: [{ emailVerified: true, id: "user_1", organizationIds: ["org_2", "org_1"] }],
    })[0]!;
    expect(entity.channels.api?.detail).toEqual({ emailVerified: true, organizationIds: ["org_1", "org_2"] });
  });

  it("records a connection's endpoint as the list route it came from", () => {
    const entity = projectWorkosConnections({
      at: AT,
      environmentId: TEST_ENVIRONMENT_ID,
      records: [{ connectionType: "OktaSAML", id: "conn_1", organizationId: "org_1", state: "active" }],
    })[0]!;
    expect(entity.channels.api?.source?.endpoint).toBe("GET /connections");
  });

  it("records a directory's endpoint as the list route it came from", () => {
    const entity = projectWorkosDirectories({
      at: AT,
      environmentId: TEST_ENVIRONMENT_ID,
      records: [{ directoryType: "okta scim v2.0", id: "directory_1", organizationId: "org_1", state: "linked" }],
    })[0]!;
    expect(entity.channels.api?.source?.endpoint).toBe("GET /directories");
  });
});
