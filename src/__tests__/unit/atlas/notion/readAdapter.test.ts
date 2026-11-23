/**
 * The Notion read seam, driven directly: what it refuses before anything is published, what it projects once
 * a generation exists, and how it answers a store it cannot parse.
 *
 * The published generation is built through the atlas's REAL publish path (`publishNotionAtlas`), so the
 * manifest digests and entity counts are the ones the store stamps rather than numbers this file restates.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type AtlasEntityView, type AtlasKindView, AtlasReadErrors } from "../../../../atlas/kit/read.js";
import { NOTION_ATLAS_DESCRIPTOR } from "../../../../atlas/notion/descriptor.js";
import {
  emptyNotionKindFile,
  initialNotionManifest,
  NOTION_ATLAS_KINDS,
  type NotionAtlasEntity,
  type NotionAtlasKind,
  type NotionAtlasKindFile,
  type NotionAtlasManifest,
  type NotionChannelEntity,
} from "../../../../atlas/notion/model.js";
import { notionObservations, readNotionSnapshot } from "../../../../atlas/notion/readAdapter.js";
import { notionAtlasPaths, publishNotionAtlas } from "../../../../atlas/notion/store.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-10-12T00:00:00.000Z";
const SCREENSHOT_SHA = "a".repeat(64);

const homes: string[] = [];

/** A throwaway state home this file owns and removes. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-notion-read-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** One channel's stored view of an entity, with the source a real walk would have written. */
function channelView({
  channel,
  endpoint,
  detail,
  withScreenshot = false,
}: {
  channel: "api" | "browser";
  endpoint: string;
  detail: unknown;
  withScreenshot?: boolean;
}): NotionChannelEntity {
  return {
    channel,
    detail,
    firstSeenAt: AT,
    lastSeenAt: AT,
    source: {
      artifacts: withScreenshot
        ? [
            {
              byteLength: 1024,
              kind: "page-png",
              mediaType: "image/png",
              relativePath: `artifacts/pages/${SCREENSHOT_SHA}.png`,
              sha256: SCREENSHOT_SHA,
            },
          ]
        : [],
      channel,
      deepLink: channel === "browser" ? "https://www.notion.so/acme/settings" : null,
      deepLinkStatus: channel === "browser" ? "browser-discovered" : "unavailable",
      endpoint,
      observedAt: AT,
    },
    state: "observed",
  };
}

const API_DETAIL = { module: "users", name: "listUsers" };
const BROWSER_DETAIL = { callCount: 3, statusCode: 200 };
const PAGE_DETAIL = { title: "Members", finalUrl: "https://www.notion.so/acme/members" };

/** The two entities the published generation holds: one per declared kind. */
const ENTITIES: Readonly<Record<NotionAtlasKind, NotionAtlasEntity>> = {
  // Both channels populated, so the API detail wins and the observations run api then browser.
  method: {
    channels: {
      api: channelView({ channel: "api", endpoint: "GET /v1/users", detail: API_DETAIL }),
      browser: channelView({ channel: "browser", endpoint: "GET /api/v3/getUsers", detail: BROWSER_DETAIL }),
    },
    id: "method-get-users",
    kind: "method",
    providerId: "GET /v1/users",
  },
  // The API channel has looked but holds no detail, so the browser's is the first non-null one.
  page: {
    channels: {
      api: channelView({ channel: "api", endpoint: "GET /v1/pages", detail: null }),
      browser: channelView({
        channel: "browser",
        endpoint: "/members",
        detail: PAGE_DETAIL,
        withScreenshot: true,
      }),
    },
    id: "page-members",
    kind: "page",
    providerId: "/members",
  },
};

/** The second page the fixture publishes, so the page kind holds two distinct entities. */
const SECOND_PAGE: NotionAtlasEntity = { ...ENTITIES.page, id: "page-members-2", providerId: "/members-2" };

/** The entities the fixture publishes for one kind: one method, and two pages. */
function entitiesFor({ kind }: { kind: NotionAtlasKind }): NotionAtlasEntity[] {
  if (kind === "page") {
    return [ENTITIES.page, SECOND_PAGE];
  }
  return [ENTITIES.method];
}

/** One kind file carrying its entities, one coverage cell and one gap. */
function kindFileFor({ kind }: { kind: NotionAtlasKind }): NotionAtlasKindFile {
  return {
    ...emptyNotionKindFile({ kind, updatedAt: AT }),
    coverage: [
      {
        artifacts: [],
        channel: "api",
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason: `${kind} rows were read from the installed client`,
        role: "authoritative",
        scope: `declared-${kind}`,
        state: "synced",
        surface: "rest-api",
        unblockedBy: null,
        visibilityScope: "api-integration-grants",
      },
    ],
    entities: entitiesFor({ kind }),
    gaps: [
      {
        condition: "not-reached",
        fields: [],
        firstDetectedAt: AT,
        id: `gap-${kind}`,
        kind,
        lastCheckedAt: AT,
        lastDetectedAt: AT,
        reason: `one ${kind} the walk could not open`,
        scope: `declared-${kind}`,
        status: "open",
        surfaces: ["browser"],
      },
    ],
  };
}

/** The permission boundary stamped on the page kind, and on no other. */
const PERMISSION_BLOCK = {
  at: "2026-10-10T00:00:00.000Z",
  detail: "the integration is not shared with this page",
  unblockedBy: "share the page with the integration",
};

/** A distinct success instant per kind, so a read of the wrong kind's status shows as the wrong instant. */
const SUCCESS_AT: Readonly<Record<NotionAtlasKind, string>> = {
  method: "2026-10-01T00:00:00.000Z",
  page: "2026-10-02T00:00:00.000Z",
};

/** When the method kind's latest attempt failed, after it had already succeeded at {@link SUCCESS_AT}. */
const METHOD_FAILED_AT = "2026-10-11T00:00:00.000Z";

/**
 * Publish through the real publisher a generation giving each kind its own history: the method kind
 * succeeded once and then failed, while the page kind succeeded at another instant, is permission-blocked
 * and holds two entities.
 */
function publishGeneration({ home }: { home: string }): NotionAtlasManifest {
  const paths = notionAtlasPaths({ home });
  const initial = initialNotionManifest({ updatedAt: AT });
  const manifest: NotionAtlasManifest = {
    ...initial,
    kinds: {
      method: {
        ...initial.kinds.method,
        lastAttempt: { at: METHOD_FAILED_AT, outcome: "failed", reasons: ["HTTP 503"] },
        lastSuccessAt: SUCCESS_AT.method,
      },
      page: {
        ...initial.kinds.page,
        lastAttempt: { at: SUCCESS_AT.page, outcome: "ok", reasons: [] },
        lastSuccessAt: SUCCESS_AT.page,
        permissionBlocked: PERMISSION_BLOCK,
      },
    },
  };
  unwrap(
    publishNotionAtlas({
      derivedFrom: null,
      files: { method: kindFileFor({ kind: "method" }), page: kindFileFor({ kind: "page" }) },
      manifest,
      paths,
    }),
  );
  return manifest;
}

const METHOD_VIEW: AtlasKindView = {
  coverage: [
    {
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "method rows were read from the installed client",
      scope: "declared-method",
      state: "synced",
      surface: "rest-api",
      unblockedBy: null,
    },
  ],
  entities: [
    {
      detail: API_DETAIL,
      id: "method-get-users",
      kind: "method",
      observations: [
        {
          artifacts: [],
          deepLink: null,
          deepLinkStatus: "unavailable",
          endpoint: "GET /v1/users",
          observedAt: AT,
          state: "observed",
          surface: "api",
        },
        {
          artifacts: [],
          deepLink: "https://www.notion.so/acme/settings",
          deepLinkStatus: "browser-discovered",
          endpoint: "GET /api/v3/getUsers",
          observedAt: AT,
          state: "observed",
          surface: "browser",
        },
      ],
      providerId: "GET /v1/users",
      scope: "notion",
    },
  ],
  gaps: [
    {
      condition: "not-reached",
      id: "gap-method",
      lastDetectedAt: AT,
      reason: "one method the walk could not open",
      scope: "declared-method",
      status: "open",
    },
  ],
  kind: "method",
  lastSuccessAt: "2026-10-01T00:00:00.000Z",
  latestAttemptFailed: true,
  permissionBlocked: null,
  publishedCount: 1,
};

/** The view of the page kind's first entity; its second differs only by identity. */
const PAGE_ENTITY_VIEW: AtlasEntityView = {
  detail: PAGE_DETAIL,
  id: "page-members",
  kind: "page",
  observations: [
    {
      artifacts: [],
      deepLink: null,
      deepLinkStatus: "unavailable",
      endpoint: "GET /v1/pages",
      observedAt: AT,
      state: "observed",
      surface: "api",
    },
    {
      artifacts: [
        {
          byteLength: 1024,
          kind: "page-png",
          mediaType: "image/png",
          relativePath: `artifacts/pages/${SCREENSHOT_SHA}.png`,
          sha256: SCREENSHOT_SHA,
        },
      ],
      deepLink: "https://www.notion.so/acme/settings",
      deepLinkStatus: "browser-discovered",
      endpoint: "/members",
      observedAt: AT,
      state: "observed",
      surface: "browser",
    },
  ],
  providerId: "/members",
  scope: "notion",
};

const PAGE_VIEW: AtlasKindView = {
  coverage: [
    {
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "page rows were read from the installed client",
      scope: "declared-page",
      state: "synced",
      surface: "rest-api",
      unblockedBy: null,
    },
  ],
  entities: [PAGE_ENTITY_VIEW, { ...PAGE_ENTITY_VIEW, id: "page-members-2", providerId: "/members-2" }],
  gaps: [
    {
      condition: "not-reached",
      id: "gap-page",
      lastDetectedAt: AT,
      reason: "one page the walk could not open",
      scope: "declared-page",
      status: "open",
    },
  ],
  kind: "page",
  lastSuccessAt: "2026-10-02T00:00:00.000Z",
  latestAttemptFailed: false,
  permissionBlocked: {
    at: "2026-10-10T00:00:00.000Z",
    detail: "the integration is not shared with this page",
    unblockedBy: "share the page with the integration",
  },
  publishedCount: 2,
};

describe("readNotionSnapshot over an empty home", () => {
  it("refuses with the unpublished error and the sync remedy, never an empty snapshot", () => {
    const error = unwrapErr(readNotionSnapshot({ home: scratchHome() }));

    expect(error).toEqual(
      AtlasReadErrors.generationUnpublished({
        platform: "notion",
        remedy: "run: slopweaver atlas notion sync — it reads every endpoint the installed client declares",
      }),
    );
  });
});

describe("readNotionSnapshot over a published generation", () => {
  it("projects the whole snapshot: descriptor, generation, and both kinds in declared order", () => {
    const home = scratchHome();
    publishGeneration({ home });

    const snapshot = unwrap(readNotionSnapshot({ home }));

    expect(snapshot.descriptor).toEqual(NOTION_ATLAS_DESCRIPTOR);
    expect(snapshot.generation).toEqual({
      mismatched: [],
      missing: [],
      platform: "notion",
      schemaVersion: 1,
      superseded: [],
      unpublished: [],
      updatedAt: AT,
    });
    expect(NOTION_ATLAS_KINDS).toEqual(["method", "page"]);
    expect(snapshot.kinds).toEqual([METHOD_VIEW, PAGE_VIEW]);
  });

  it("carries a kind's permissionBlocked from the manifest to that kind's view and no other", () => {
    const home = scratchHome();
    publishGeneration({ home });

    const snapshot = unwrap(readNotionSnapshot({ home }));

    expect(snapshot.kinds.map((kind) => kind.permissionBlocked)).toEqual([
      null,
      {
        at: "2026-10-10T00:00:00.000Z",
        detail: "the integration is not shared with this page",
        unblockedBy: "share the page with the integration",
      },
    ]);
  });

  it("gives each kind its own success instant, never another kind's", () => {
    const home = scratchHome();
    publishGeneration({ home });

    expect(unwrap(readNotionSnapshot({ home })).kinds.map((kind) => kind.lastSuccessAt)).toEqual([
      "2026-10-01T00:00:00.000Z",
      "2026-10-02T00:00:00.000Z",
    ]);
  });

  it("flags a failed latest attempt on the failing kind alone, keeping the success it had", () => {
    const home = scratchHome();
    publishGeneration({ home });
    const kinds = unwrap(readNotionSnapshot({ home })).kinds;

    expect(kinds.map((kind) => kind.latestAttemptFailed)).toEqual([true, false]);
    expect(kinds[0]!.lastSuccessAt).toBe("2026-10-01T00:00:00.000Z");
  });

  it("counts the entities each kind published, two pages and one method", () => {
    const home = scratchHome();
    publishGeneration({ home });

    expect(unwrap(readNotionSnapshot({ home })).kinds.map((kind) => kind.publishedCount)).toEqual([1, 2]);
  });
});

describe("readNotionSnapshot over a store it cannot parse", () => {
  it("returns the unreadable error naming the manifest, rather than treating it as an empty atlas", () => {
    const home = scratchHome();
    const paths = notionAtlasPaths({ home });
    mkdirSync(dirname(paths.manifest), { recursive: true });
    writeFileSync(paths.manifest, "this is not json");

    const error = unwrapErr(readNotionSnapshot({ home }));

    expect(error).toEqual(
      AtlasReadErrors.storeUnreadable({
        platform: "notion",
        reasons: [
          `${paths.manifest} is not valid JSON`,
          "refusing rather than treating a corrupt atlas as an empty one",
        ],
      }),
    );
  });
});

describe("notionObservations", () => {
  it("emits the api observation then the browser one when both channels have looked", () => {
    const observations = notionObservations({ entity: ENTITIES.method });

    expect(observations).toEqual(METHOD_VIEW.entities[0]!.observations);
  });

  it("emits only the browser observation when the api channel has never looked", () => {
    const entity: NotionAtlasEntity = {
      ...ENTITIES.page,
      channels: {
        api: null,
        browser: channelView({ channel: "browser", endpoint: "/members", detail: PAGE_DETAIL }),
      },
    };

    expect(notionObservations({ entity })).toEqual([
      {
        artifacts: [],
        deepLink: "https://www.notion.so/acme/settings",
        deepLinkStatus: "browser-discovered",
        endpoint: "/members",
        observedAt: AT,
        state: "observed",
        surface: "browser",
      },
    ]);
  });
});
