/**
 * The three platform read adapters' own projection judgement.
 *
 * What each adapter DECIDES is small and load-bearing: how a platform's scope becomes one greppable string,
 * and how its channels become observations. Both are the places a normalized view could quietly lie — a
 * dropped channel understates coverage, and a channel invented for a surface that never looked overstates
 * it. Neither is exercised by reading a real generation, so both are tested directly here.
 */
import { describe, expect, it } from "vitest";

import type { CloudflareEntity } from "../../../atlas/cloudflare/model.js";
import { cloudflareEntityView, renderCloudflareScope } from "../../../atlas/cloudflare/readAdapter.js";
import type { OnepasswordChannel, OnepasswordEntity } from "../../../atlas/onepassword/model.js";
import { onepasswordObservations } from "../../../atlas/onepassword/readAdapter.js";
import { atlasPlatforms, findAtlasPlatform } from "../../../atlas/registry.js";
import type { SlackAtlasEntity } from "../../../atlas/slackApi/atlasModel.js";
import { slackObservations } from "../../../atlas/slackApi/readAdapter.js";
import type { VantaEntity } from "../../../atlas/vanta/model.js";
import { vantaObservations } from "../../../atlas/vanta/readAdapter.js";
import type { WorkosAtlasEntity, WorkosChannelEntity } from "../../../atlas/workos/model.js";
import { workosObservations } from "../../../atlas/workos/readAdapter.js";

describe("renderCloudflareScope", () => {
  it("renders an account-only scope as just the account", () => {
    expect(renderCloudflareScope({ scope: { accountId: "acct", parentId: null, zoneId: null } })).toBe("account/acct");
  });

  it("appends the zone and the parent when each is present, in that order", () => {
    expect(renderCloudflareScope({ scope: { accountId: "acct", parentId: "app", zoneId: "z1" } })).toBe(
      "account/acct/zone/z1/parent/app",
    );
  });

  it("keeps a parent without a zone rather than dropping it", () => {
    expect(renderCloudflareScope({ scope: { accountId: "acct", parentId: "app", zoneId: null } })).toBe(
      "account/acct/parent/app",
    );
  });
});

describe("cloudflareEntityView", () => {
  const entity: CloudflareEntity = {
    detail: { name: "acme.com" },
    firstSeenAt: "2026-08-20T07:07:53.351Z",
    id: "atlas-1",
    kind: "zone",
    lastSeenAt: "2026-08-20T07:07:53.351Z",
    providerId: "00000000000000000000000000002e01",
    scope: { accountId: "acct", parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: "2026-08-20T07:07:53.351Z", operation: "zones-list" },
    state: "observed",
  };

  it("projects exactly one observation, because this atlas has one channel", () => {
    expect(cloudflareEntityView({ entity }).observations.length).toBe(1);
  });

  it("carries the operation forward as the reproduction handle", () => {
    expect(cloudflareEntityView({ entity }).observations[0]?.endpoint).toBe("zones-list");
  });

  it("records the deep link as ABSENT and unverified rather than constructing a dashboard URL from ids", () => {
    const observation = cloudflareEntityView({ entity }).observations[0]!;
    expect(observation.deepLink).toBe(null);
    expect(observation.deepLinkStatus).toBe("unverified");
  });
});

describe("vantaObservations", () => {
  /** A channel record with everything defaulted. */
  const channel = (over: Partial<NonNullable<VantaEntity["channels"]["manage-api"]>> = {}) => ({
    channel: "manage-api" as const,
    detail: { title: "a control" },
    firstSeenAt: "2026-08-01T00:00:00.000Z",
    lastSeenAt: "2026-08-02T00:00:00.000Z",
    source: null,
    state: "observed" as const,
    ...over,
  });

  it("omits a channel that has never looked, rather than inventing an empty observation", () => {
    const entity: VantaEntity = {
      channels: { browser: null, "manage-api": channel() },
      financialDetail: null,
      id: "v-1",
      kind: "control",
      providerId: "ctrl-1",
      sensitivity: null,
    };
    const observations = vantaObservations({ entity });
    expect(observations.length).toBe(1);
    expect(observations[0]?.surface).toBe("manage-api");
  });

  it("falls back to the channel's own lastSeenAt when it carries no source provenance", () => {
    const entity: VantaEntity = {
      channels: { browser: null, "manage-api": channel() },
      financialDetail: null,
      id: "v-1",
      kind: "control",
      providerId: "ctrl-1",
      sensitivity: null,
    };
    expect(vantaObservations({ entity })[0]?.observedAt).toBe("2026-08-02T00:00:00.000Z");
    expect(vantaObservations({ entity })[0]?.endpoint).toBe("manage-api");
  });

  it("returns one observation per channel that has looked, in declared order", () => {
    const entity: VantaEntity = {
      channels: {
        browser: { ...channel(), channel: "browser" as const },
        "manage-api": channel(),
      },
      financialDetail: null,
      id: "v-1",
      kind: "control",
      providerId: "ctrl-1",
      sensitivity: null,
    };
    expect(vantaObservations({ entity }).map((one) => one.surface)).toEqual(["manage-api", "browser"]);
  });
});

describe("slackObservations", () => {
  it("carries a browser-discovered deep link through, because Slack's browser surface is actually filled", () => {
    const entity: SlackAtlasEntity = {
      channels: {
        api: null,
        browser: {
          channel: "browser",
          detail: null,
          firstSeenAt: "2026-08-31T00:00:00.000Z",
          lastSeenAt: "2026-08-31T00:00:00.000Z",
          source: {
            artifacts: [],
            deepLink: "https://app.slack.com/client/E1/browse-channels",
            deepLinkStatus: "browser-discovered",
            channel: "browser",
            endpoint: "/browse-channels",
            observedAt: "2026-08-31T00:00:00.000Z",
          },
          state: "observed",
        },
      },
      id: "s-1",
      kind: "page",
      providerId: "/browse-channels",
    };
    const observations = slackObservations({ entity });
    expect(observations.length).toBe(1);
    expect(observations[0]?.deepLink).toBe("https://app.slack.com/client/E1/browse-channels");
    expect(observations[0]?.deepLinkStatus).toBe("browser-discovered");
  });
});

describe("the platform registry", () => {
  // No count in the name: it read "eight" while listing ten, then "eleven", then "eighteen" — each
  // atlas landing moved it, which is the stale-number rot this repo gates against elsewhere.
  // Completeness against DISK is `registryCoversEveryAtlas.test.ts`'s job; what this pins is the ORDER,
  // which an unknown-platform error prints back to a reader.
  it("lists every atlas this build has, one row per PLATFORM, in catalogue order", () => {
    expect([...atlasPlatforms()]).toEqual([
      "aether",
      "airtable",
      "braze",
      "canva",
      "clerk",
      "cloudflare",
      "crowdstrike",
      "datadog",
      "figma",
      "gemini-ai-studio",
      "github",
      "google-admin",
      "google-secops",
      "graphql-hive",
      "hex",
      "inngest",
      "jam",
      "jumpcloud",
      "knock",
      "knowbe4",
      "linear",
      "make",
      "microsoft365",
      "nightfall",
      "notion",
      "nx-cloud",
      "onepassword",
      "prisma-data-platform",
      "slack",
      "trelica",
      "twilio",
      "vanta",
      "workos",
      "xero",
    ]);
  });

  it("keys Slack on its platform discriminator, not on its directory name", () => {
    expect(findAtlasPlatform({ platform: "slack-api" })).toBe(null);
    expect(findAtlasPlatform({ platform: "slack" })?.platform).toBe("slack");
  });

  it("returns null for a platform this build has no atlas for", () => {
    expect(findAtlasPlatform({ platform: "pagerduty" })).toBe(null);
  });

  // Datadog was the platform this test used as its known-absent example until its atlas
  // landed. Swapping the example rather than deleting the case keeps the assertion — that an unknown
  // platform resolves to null rather than throwing — which is the thing being tested.
  it("resolves the Datadog atlas, which is registered rather than absent", () => {
    expect(findAtlasPlatform({ platform: "datadog" })?.platform).toBe("datadog");
  });
});

describe("onepasswordObservations", () => {
  /** A channel record with everything defaulted; `detail` stays null because ordering is what is under test. */
  const channel = ({ name }: { name: OnepasswordChannel }) => ({
    channel: name,
    detail: null,
    firstSeenAt: "2026-08-01T00:00:00.000Z",
    lastSeenAt: "2026-08-02T00:00:00.000Z",
    source: null,
    state: "observed" as const,
  });

  /** An entity with only the named channels having looked. */
  const entityWith = ({ looked }: { looked: readonly OnepasswordChannel[] }): OnepasswordEntity => ({
    channels: {
      "admin-cli": looked.includes("admin-cli") ? channel({ name: "admin-cli" }) : null,
      browser: looked.includes("browser") ? channel({ name: "browser" }) : null,
      "events-api": looked.includes("events-api") ? channel({ name: "events-api" }) : null,
    },
    id: "op-1",
    kind: "user",
    providerId: "u-1",
  });

  it("omits a channel that has never looked, rather than inventing an empty observation", () => {
    const observations = onepasswordObservations({ entity: entityWith({ looked: ["admin-cli"] }) });
    expect(observations.length).toBe(1);
    expect(observations[0]?.surface).toBe("admin-cli");
  });

  // Three channels rather than Vanta's two, so declared order is the part worth pinning: a reader that
  // takes the first observation must get the same channel every time.
  it("returns one observation per channel that has looked, in declared order", () => {
    const observations = onepasswordObservations({
      entity: entityWith({ looked: ["admin-cli", "events-api", "browser"] }),
    });
    expect(observations.map((observation) => observation.surface)).toEqual(["admin-cli", "events-api", "browser"]);
  });

  it("returns nothing at all when no channel has looked", () => {
    expect(onepasswordObservations({ entity: entityWith({ looked: [] }) })).toEqual([]);
  });
});

describe("workosObservations", () => {
  /** One channel's view, stamped as observed. */
  const channel = ({ name }: { name: WorkosChannelEntity["channel"] }): WorkosChannelEntity => ({
    channel: name,
    detail: null,
    firstSeenAt: "2026-09-01T00:00:00.000Z",
    lastSeenAt: "2026-09-02T00:00:00.000Z",
    source: null,
    state: "observed",
  });

  /** A page entity with only the named channels having looked. */
  const entityWith = ({ looked }: { looked: readonly WorkosChannelEntity["channel"][] }): WorkosAtlasEntity => ({
    channels: {
      api: looked.includes("api") ? channel({ name: "api" }) : null,
      browser: looked.includes("browser") ? channel({ name: "browser" }) : null,
    },
    id: "workos-1",
    kind: "page",
    providerId: "/organizations",
  });

  // The whole two-surface design in one assertion: a channel that has never looked must contribute nothing,
  // rather than an observation claiming it looked and found nothing.
  it("omits a channel that has never looked", () => {
    const observations = workosObservations({ entity: entityWith({ looked: ["api"] }) });
    expect(observations.length).toBe(1);
    expect(observations[0]?.surface).toBe("api");
  });

  it("returns one observation per channel that has looked, in declared order", () => {
    const observations = workosObservations({ entity: entityWith({ looked: ["browser", "api"] }) });
    expect(observations.map((observation) => observation.surface)).toEqual(["api", "browser"]);
  });

  it("returns nothing at all when no channel has looked", () => {
    expect(workosObservations({ entity: entityWith({ looked: [] }) })).toEqual([]);
  });
});
