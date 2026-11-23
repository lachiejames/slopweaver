import { describe, expect, it } from "vitest";

import {
  isKnockVoluminousPath,
  KNOCK_CROSS_API_IDENTIFIERS,
  KNOCK_VOLUMINOUS_PREFIXES,
  knockCrossApiProducer,
  knockIdentifierSources,
} from "../../../../atlas/knock/dispositions.js";
import { KNOCK_ROUTES } from "../../../../atlas/knock/generated/routes.js";
import { KNOCK_SURFACES } from "../../../../atlas/knock/generated/surfaces.js";
import { knockKindForPath, knockKindForRoute } from "../../../../atlas/knock/kinds.js";

describe("knock voluminous judgement", () => {
  it("has at least one entry in KNOCK_VOLUMINOUS_PREFIXES, so the guards below are not vacuously green", () => {
    expect(KNOCK_VOLUMINOUS_PREFIXES.length).toBeGreaterThan(0);
  });

  it("treats a delivered message as an observation and its message TYPE as configuration", () => {
    expect(isKnockVoluminousPath({ path: "/v1/messages" })).toBe(true);
    expect(isKnockVoluminousPath({ path: "/v1/messages/{message_id}/events" })).toBe(true);
    expect(isKnockVoluminousPath({ path: "/v1/message_types" })).toBe(false);
  });

  it("cuts through a source's family rather than along it", () => {
    expect(isKnockVoluminousPath({ path: "/v1/sources/{key}/events" })).toBe(true);
    expect(isKnockVoluminousPath({ path: "/v1/sources/{key}/logs" })).toBe(true);
    expect(isKnockVoluminousPath({ path: "/v1/sources/{key}/status" })).toBe(false);
    expect(isKnockVoluminousPath({ path: "/v1/sources" })).toBe(false);
  });

  it("does not treat a commit log as voluminous, because a person creates one", () => {
    expect(isKnockVoluminousPath({ path: "/v1/commits" })).toBe(false);
  });

  it("keeps every declared prefix matching at least one live operation", () => {
    for (const prefix of KNOCK_VOLUMINOUS_PREFIXES) {
      const matched = KNOCK_SURFACES.filter((row) => row.path === prefix || row.path.startsWith(`${prefix}/`));
      expect(matched.length).toBeGreaterThan(0);
    }
  });
});

describe("knock identifier sourcing", () => {
  it("names the collection above each brace segment, in path order", () => {
    expect(knockIdentifierSources({ path: "/v1/users/{user_id}/preferences/{id}" })).toStrictEqual([
      { parameter: "user_id", prefix: "/v1/users" },
      { parameter: "id", prefix: "/v1/users/{user_id}/preferences" },
    ]);
  });

  it("answers an empty list for a collection root", () => {
    expect(knockIdentifierSources({ path: "/v1/workflows" })).toStrictEqual([]);
  });

  it("routes a channel identifier to the Management API's channel list", () => {
    expect(
      knockCrossApiProducer({ parameter: "channel_id", path: "/v1/users/{user_id}/channel_data/{channel_id}" }),
    ).toBe("/v1/channels");
  });

  it("answers null for a parameter it has no producer for", () => {
    expect(knockCrossApiProducer({ parameter: "collection", path: "/v1/objects/{collection}" })).toBe(null);
  });

  it("resolves every cross-API entry through the lookup", () => {
    const entries = Object.entries(KNOCK_CROSS_API_IDENTIFIERS);
    expect(entries.length).toBeGreaterThan(0);
    const unresolved = entries.filter(([key, producer]) => {
      const [path, parameter] = key.split("#");
      return knockCrossApiProducer({ parameter: parameter!, path: path! }) !== producer;
    });
    expect(unresolved).toStrictEqual([]);
  });

  it("keeps every cross-API entry pointing at a path some document still declares", () => {
    for (const producer of Object.values(KNOCK_CROSS_API_IDENTIFIERS)) {
      expect(KNOCK_SURFACES.some((row) => row.method === "GET" && row.path === producer)).toBe(true);
    }
  });
});

describe("knock kind assignment", () => {
  it("claims every declared operation", () => {
    const unmatched = KNOCK_SURFACES.filter((row) => knockKindForPath({ path: row.path }) === null);
    expect(unmatched).toStrictEqual([]);
  });

  it("files a recipient's preference SET apart from the account's preference CENTER", () => {
    expect(knockKindForPath({ path: "/v1/users/{user_id}/preferences" })).toBe("preference-set");
    expect(knockKindForPath({ path: "/v1/preference_center" })).toBe("preference-center");
  });

  it("prefers the longer prefix when two could claim a path", () => {
    expect(knockKindForPath({ path: "/v1/audiences/{key}/members" })).toBe("audience");
    expect(knockKindForPath({ path: "/v1/users/{user_id}/subscriptions" })).toBe("subscription");
  });

  it("answers null for the dashboard pages no kind covers", () => {
    expect(knockKindForRoute({ route: "/[slug]/agents" })).toBe(null);
    expect(knockKindForRoute({ route: "/[slug]/settings/audit-log" })).toBe(null);
    expect(knockKindForRoute({ route: "/[slug]/settings/service-tokens" })).toBe(null);
  });

  it("resolves a two-segment settings section rather than only its first word", () => {
    expect(knockKindForRoute({ route: "/[slug]/settings/integrations/channels" })).toBe("channel");
    expect(knockKindForRoute({ route: "/[slug]/settings/integrations/extensions" })).toBe(null);
  });

  // Before: a bare index into a plain object literal answered an inherited Object.prototype member, so a
  // route segment named `constructor` came back as a FUNCTION where a kind or null was promised.
  it("answers null for a route segment that is only an inherited object member", () => {
    expect(knockKindForRoute({ route: "/[slug]/[environment]/constructor" })).toBe(null);
    expect(knockKindForRoute({ route: "/[slug]/settings/toString" })).toBe(null);
  });

  it("resolves an environment route and a settings route through their declared rows", () => {
    expect(knockKindForRoute({ route: "/[slug]/[environment]/workflows/[key]" })).toBe("workflow");
    expect(knockKindForRoute({ route: "/[slug]/settings/team" })).toBe("member");
  });

  it("files the account picker under the account rather than as an internal route", () => {
    const root = KNOCK_ROUTES.find((route) => route.route === "/")!;
    expect(root.scope).toBe("account");
  });
});
