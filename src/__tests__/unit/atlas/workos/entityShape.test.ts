/**
 * The entity-shaping primitives every WorkOS projection is built from.
 *
 * Two properties are the whole reason these live apart from the projections: an entity leaves exactly ONE
 * channel filled, which is what `merge.ts`'s channel-scoped fold depends on, and a content kind's link is
 * either a resolved dashboard address or an honest `unavailable` — never a guessed one.
 */
import { describe, expect, it } from "vitest";

import { apiEntity, byId, channelEntity, surfaceLink } from "../../../../atlas/workos/entityShape.js";

import { AT, TEST_ENVIRONMENT_ID } from "./workosFixtures.js";

describe("apiEntity", () => {
  it("fills the api channel and leaves the browser channel null", () => {
    const entity = apiEntity({
      at: AT,
      deepLink: null,
      deepLinkStatus: "unavailable",
      detail: { probed: true },
      endpoint: "GET /organizations",
      kind: "operation",
      providerId: "GET /organizations",
    });
    expect(entity.channels.browser).toBe(null);
    expect(entity.channels.api?.channel).toBe("api");
  });

  it("keys the entity off its kind and provider id together", () => {
    const entity = apiEntity({
      at: AT,
      deepLink: null,
      deepLinkStatus: "unavailable",
      detail: {},
      endpoint: "GET /users",
      kind: "user",
      providerId: "user_1",
    });
    expect(entity.providerId).toBe("user_1");
    expect(entity.kind).toBe("user");
  });
});

describe("channelEntity", () => {
  it("stamps this run's instant on the view and carries the source through", () => {
    const view = channelEntity({
      artifacts: [],
      at: AT,
      channel: "browser",
      deepLink: "https://dashboard.workos.com/settings/team",
      deepLinkStatus: "browser-discovered",
      detail: { title: "Team" },
      endpoint: "/settings/team",
    });
    expect(view.firstSeenAt).toBe(AT);
    expect(view.lastSeenAt).toBe(AT);
    expect(view.source?.deepLinkStatus).toBe("browser-discovered");
  });
});

describe("surfaceLink", () => {
  it("resolves a declared path under the environment segment", () => {
    expect(surfaceLink({ environmentId: TEST_ENVIRONMENT_ID, path: "/organizations" })).toEqual({
      deepLink: `https://dashboard.workos.com/${TEST_ENVIRONMENT_ID}/organizations`,
      deepLinkStatus: "unverified",
    });
  });

  // The SSO list is the standing case: the table stopped declaring it after a walk, so a connection
  // must say it has no address rather than point at one nothing has witnessed.
  it("says unavailable for a path the route table no longer declares", () => {
    expect(surfaceLink({ environmentId: TEST_ENVIRONMENT_ID, path: "/sso" })).toEqual({
      deepLink: null,
      deepLinkStatus: "unavailable",
    });
  });

  it("falls back to the bare bootstrap address when no segment is resolved", () => {
    expect(surfaceLink({ environmentId: null, path: "/users" })).toEqual({
      deepLink: "https://dashboard.workos.com/users",
      deepLinkStatus: "unverified",
    });
  });
});

describe("byId", () => {
  it("orders entities by their own ids, so a published file is byte-stable", () => {
    const one = apiEntity({
      at: AT,
      deepLink: null,
      deepLinkStatus: "unavailable",
      detail: {},
      endpoint: "GET /users",
      kind: "user",
      providerId: "user_2",
    });
    const two = apiEntity({
      at: AT,
      deepLink: null,
      deepLinkStatus: "unavailable",
      detail: {},
      endpoint: "GET /users",
      kind: "user",
      providerId: "user_1",
    });
    const ids = byId({ entities: [one, two] }).map((entity) => entity.id);
    expect([...ids]).toEqual([...ids].toSorted());
  });
});
