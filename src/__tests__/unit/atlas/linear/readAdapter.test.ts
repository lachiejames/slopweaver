/**
 * What the Linear read seam answers for an unpublished home, a published generation and a corrupt store, and
 * the two decisions that are Linear's own: observation order across channels, and which team a setting is
 * scoped to.
 *
 * Every published case goes through the real publish path (`publishLinearAtlas`) into a throwaway home passed
 * explicitly, so what is read back is what the store really wrote, digests and counts included.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type AtlasEntityView, type AtlasKindView, AtlasReadErrors } from "../../../../atlas/kit/read.js";
import { LINEAR_ATLAS_DESCRIPTOR } from "../../../../atlas/linear/descriptor.js";
import {
  emptyLinearAtlasKindFile,
  initialLinearAtlasManifest,
  LINEAR_ATLAS_KINDS,
  type LinearAtlasEntity,
  type LinearAtlasKind,
  type LinearAtlasKindFile,
  type LinearChannelEntity,
} from "../../../../atlas/linear/model.js";
import { linearEntityScope, linearObservations, readLinearSnapshot } from "../../../../atlas/linear/readAdapter.js";
import { linearAtlasPaths, publishLinearAtlas } from "../../../../atlas/linear/store.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-10-12T00:00:00.000Z";
const SEEN = "2026-10-01T00:00:00.000Z";
const API_OBSERVED = "2026-10-02T00:00:00.000Z";
const BROWSER_OBSERVED = "2026-10-03T00:00:00.000Z";

/**
 * A distinct success instant per kind, from the kind's place in the declared list, so a read of the wrong
 * kind's status shows as the wrong instant. No clock is read.
 */
function successAtOf({ kind }: { kind: LinearAtlasKind }): string {
  return `2026-10-04T00:${String(LINEAR_ATLAS_KINDS.indexOf(kind)).padStart(2, "0")}:00.000Z`;
}

/** The one kind whose latest attempt failed, after it had already succeeded once. */
const FAILED_KIND = "page" satisfies LinearAtlasKind;

/** When that failed attempt ran. */
const FAILED_ATTEMPT_AT = "2026-10-11T00:00:00.000Z";

/** The one kind the manifest records as permission-blocked. */
const BLOCKED_KIND = "setting" satisfies LinearAtlasKind;

/** The permission boundary stamped on {@link BLOCKED_KIND}. */
const PERMISSION_BLOCK = {
  at: "2026-10-10T00:00:00.000Z",
  detail: "the member may not read workspace administration settings",
  unblockedBy: "the workspace admin role",
};

const homes: string[] = [];

/** A throwaway state home this file owns and removes. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-linear-read-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

const SCREENSHOT = {
  byteLength: 4096,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "artifacts/page.png",
  sha256: "c".repeat(64),
} as const;

/** One channel's record of an entity, with a source naming its own endpoint and the instant it was observed. */
function channelRecord({
  channel,
  detail,
  state = "observed",
}: {
  channel: "api" | "browser";
  detail: unknown;
  state?: "observed" | "stale";
}): LinearChannelEntity {
  const isBrowser = channel === "browser";
  return {
    channel,
    detail,
    firstSeenAt: SEEN,
    lastSeenAt: isBrowser ? BROWSER_OBSERVED : API_OBSERVED,
    source: {
      artifacts: isBrowser ? [SCREENSHOT] : [],
      channel,
      deepLink: `https://linear.example.test/${channel}`,
      deepLinkStatus: isBrowser ? "browser-discovered" : "provider-provided",
      endpoint: `/example/${channel}`,
      observedAt: isBrowser ? BROWSER_OBSERVED : API_OBSERVED,
    },
    state,
  };
}

/** An entity whose two channels are whatever a caller gives, so a scope decision can be driven channel by channel. */
function entityWith({
  api,
  browser,
  kind,
}: {
  api: LinearChannelEntity | null;
  browser: LinearChannelEntity | null;
  kind: LinearAtlasKind;
}): LinearAtlasEntity {
  return { channels: { api, browser }, id: `${kind}-id`, kind, providerId: `${kind}-provider` };
}

/** A setting entity whose API and browser details are given, with nothing else in play. */
function settingWith({ apiDetail, browserDetail }: { apiDetail: unknown; browserDetail: unknown }): LinearAtlasEntity {
  return entityWith({
    api: channelRecord({ channel: "api", detail: apiDetail }),
    browser: channelRecord({ channel: "browser", detail: browserDetail }),
    kind: "setting",
  });
}

const OPERATION_API_DETAIL = {
  deprecationReason: null,
  description: "Fetch one issue",
  isDeprecated: false,
  paramNames: ["id"],
  responsePaths: ["id", "title"],
  returnType: "Issue",
  rootKind: "query",
};
const OPERATION_BROWSER_DETAIL = { callCount: 3, responsePaths: ["id"], responsePathsTotal: 1 };
const PAGE_DETAIL = {
  graphqlCallCount: 2,
  redirected: false,
  statusCode: 200,
  title: "Settings",
  url: "https://linear.example.test/settings",
};
const SETTING_DETAIL = { group: "team", label: "Workflow states", settingScope: "team/ENG", value: { states: 6 } };
const TYPE_DETAIL = {
  deprecatedFieldNames: [],
  description: "An issue",
  enumValues: [],
  fieldNames: ["id", "title"],
  inputFieldNames: [],
  typeKind: "OBJECT",
};

/** One entity per kind: an operation seen by both channels, a page only the browser reached, a setting and a type. */
const ENTITIES: Readonly<Record<LinearAtlasKind, LinearAtlasEntity>> = {
  operation: entityWith({
    api: channelRecord({ channel: "api", detail: OPERATION_API_DETAIL }),
    browser: channelRecord({ channel: "browser", detail: OPERATION_BROWSER_DETAIL }),
    kind: "operation",
  }),
  page: entityWith({
    api: null,
    browser: channelRecord({ channel: "browser", detail: PAGE_DETAIL }),
    kind: "page",
  }),
  setting: entityWith({
    api: channelRecord({ channel: "api", detail: SETTING_DETAIL }),
    browser: null,
    kind: "setting",
  }),
  type: entityWith({
    api: channelRecord({ channel: "api", detail: TYPE_DETAIL }),
    browser: null,
    kind: "type",
  }),
};

/**
 * The entities the fixture publishes for one kind: the declared one, then copies with their own ids, one more
 * in all than the kind's place in the declared list, so every kind's published count differs.
 */
function entitiesFor({ kind }: { kind: LinearAtlasKind }): readonly LinearAtlasEntity[] {
  const declared = ENTITIES[kind];
  return Array.from({ length: LINEAR_ATLAS_KINDS.indexOf(kind) + 1 }, (_, index): LinearAtlasEntity => {
    if (index === 0) {
      return declared;
    }
    const suffix = `-${String(index + 1)}`;
    return { ...declared, id: `${declared.id}${suffix}`, providerId: `${declared.providerId}${suffix}` };
  });
}

/**
 * The coverage cell one kind's file carries, its reason, scope and surface naming the kind, so a view that
 * reads another kind's coverage shows the wrong one. The cell names its own surface, which the adapter passes
 * through.
 */
function coverageFor({ kind }: { kind: LinearAtlasKind }): LinearAtlasKindFile["coverage"][number] {
  return {
    artifacts: [],
    channel: "api",
    lastSuccessAt: AT,
    latestAttemptFailed: false,
    reason: `every ${kind} was read from the introspected schema`,
    role: "authoritative",
    scope: `${kind} scope`,
    state: "synced",
    surface: `graphql-${kind}`,
    unblockedBy: null,
    visibilityScope: "one-member-session",
  };
}

/** The open gap one kind's file carries, its id, reason and scope naming the kind for the same reason. */
function gapFor({ kind }: { kind: LinearAtlasKind }): LinearAtlasKindFile["gaps"][number] {
  return {
    condition: "scope-refused",
    fields: [],
    firstDetectedAt: SEEN,
    id: `gap-${kind}`,
    kind,
    lastCheckedAt: AT,
    lastDetectedAt: AT,
    reason: `${kind} administration is outside this member's reach`,
    scope: `${kind} scope`,
    status: "open",
    surfaces: ["api"],
  };
}

/** One kind's real file around its entities, its own coverage cell and its own gap. */
function fileFor({ kind }: { kind: LinearAtlasKind }): LinearAtlasKindFile {
  const empty = emptyLinearAtlasKindFile({ kind, updatedAt: AT });
  return {
    ...empty,
    coverage: [coverageFor({ kind })],
    entities: [...entitiesFor({ kind })],
    gaps: [gapFor({ kind })],
  };
}

/** The latest attempt the fixture records for one kind: a success at its own instant, or the one failure. */
function attemptOf({ kind }: { kind: LinearAtlasKind }): { at: string; outcome: "ok" | "failed"; reasons: string[] } {
  if (kind === FAILED_KIND) {
    return { at: FAILED_ATTEMPT_AT, outcome: "failed", reasons: ["HTTP 503"] };
  }
  return { at: successAtOf({ kind }), outcome: "ok", reasons: [] };
}

/**
 * Publish a generation giving every kind its own history: a success at a distinct instant, one kind whose
 * latest attempt failed after succeeding, one kind blocked by permission, and one kind holding two entities.
 */
function publishClean({ home }: { home: string }): void {
  const initial = initialLinearAtlasManifest({ updatedAt: AT, workspaceId: "workspace-1" });
  const kinds = { ...initial.kinds };
  const files: Partial<Record<LinearAtlasKind, LinearAtlasKindFile>> = {};
  for (const kind of LINEAR_ATLAS_KINDS) {
    files[kind] = fileFor({ kind });
    kinds[kind] = {
      ...initial.kinds[kind],
      lastAttempt: attemptOf({ kind }),
      lastSuccessAt: successAtOf({ kind }),
    };
  }
  kinds[BLOCKED_KIND] = { ...kinds[BLOCKED_KIND], permissionBlocked: PERMISSION_BLOCK };
  unwrap(
    publishLinearAtlas({
      derivedFrom: null,
      files,
      manifest: { ...initial, kinds },
      paths: linearAtlasPaths({ home }),
    }),
  );
}

const API_OBSERVATION = {
  artifacts: [],
  deepLink: "https://linear.example.test/api",
  deepLinkStatus: "provider-provided",
  endpoint: "/example/api",
  observedAt: API_OBSERVED,
  state: "observed",
  surface: "api",
} as const;

const BROWSER_OBSERVATION = {
  artifacts: [SCREENSHOT],
  deepLink: "https://linear.example.test/browser",
  deepLinkStatus: "browser-discovered",
  endpoint: "/example/browser",
  observedAt: BROWSER_OBSERVED,
  state: "observed",
  surface: "browser",
} as const;

/** The permission block the view must carry for one kind: the fixture's one block, or none. */
function expectedPermissionBlockOf({ kind }: { kind: LinearAtlasKind }): typeof PERMISSION_BLOCK | null {
  if (kind === BLOCKED_KIND) {
    return PERMISSION_BLOCK;
  }
  return null;
}

/** The view each kind's declared entity must read back as; its copies differ only by identity. */
const EXPECTED_FIRST_ENTITY_VIEW: Readonly<Record<LinearAtlasKind, AtlasEntityView>> = {
  operation: {
    detail: OPERATION_API_DETAIL,
    id: "operation-id",
    kind: "operation",
    observations: [API_OBSERVATION, BROWSER_OBSERVATION],
    providerId: "operation-provider",
    scope: "linear",
  },
  page: {
    detail: PAGE_DETAIL,
    id: "page-id",
    kind: "page",
    observations: [BROWSER_OBSERVATION],
    providerId: "page-provider",
    scope: "linear",
  },
  setting: {
    detail: SETTING_DETAIL,
    id: "setting-id",
    kind: "setting",
    observations: [API_OBSERVATION],
    providerId: "setting-provider",
    scope: "team/ENG",
  },
  type: {
    detail: TYPE_DETAIL,
    id: "type-id",
    kind: "type",
    observations: [API_OBSERVATION],
    providerId: "type-provider",
    scope: "linear",
  },
};

/** The view a kind must read back as, written out rather than derived from the adapter's own helpers. */
function expectedKindView({ kind }: { kind: LinearAtlasKind }): AtlasKindView {
  const base: Omit<AtlasKindView, "entities"> = {
    coverage: [
      {
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason: `every ${kind} was read from the introspected schema`,
        scope: `${kind} scope`,
        state: "synced",
        surface: `graphql-${kind}`,
        unblockedBy: null,
      },
    ],
    gaps: [
      {
        condition: "scope-refused",
        id: `gap-${kind}`,
        lastDetectedAt: AT,
        reason: `${kind} administration is outside this member's reach`,
        scope: `${kind} scope`,
        status: "open",
      },
    ],
    kind,
    lastSuccessAt: successAtOf({ kind }),
    latestAttemptFailed: kind === FAILED_KIND,
    permissionBlocked: expectedPermissionBlockOf({ kind }),
    publishedCount: entitiesFor({ kind }).length,
  };
  const first = EXPECTED_FIRST_ENTITY_VIEW[kind];
  return {
    ...base,
    entities: entitiesFor({ kind }).map((_, index) => {
      if (index === 0) {
        return first;
      }
      const suffix = `-${String(index + 1)}`;
      return { ...first, id: `${kind}-id${suffix}`, providerId: `${kind}-provider${suffix}` };
    }),
  };
}

describe("readLinearSnapshot", () => {
  it("refuses an empty home as unpublished and names the sync verb, rather than answering zero entities", () => {
    const error = unwrapErr(readLinearSnapshot({ home: scratchHome() }));
    expect(error).toEqual(
      AtlasReadErrors.generationUnpublished({
        platform: "linear",
        remedy: "run: slopweaver atlas linear sync — it reads the whole GraphQL schema and every configuration surface",
      }),
    );
  });

  it("reads a published generation back: the whole generation, in declared kind order, with the static descriptor", () => {
    const home = scratchHome();
    publishClean({ home });
    const snapshot = unwrap(readLinearSnapshot({ home }));
    expect(snapshot.descriptor).toEqual(LINEAR_ATLAS_DESCRIPTOR);
    expect(snapshot.generation).toEqual({
      mismatched: [],
      missing: [],
      platform: "linear",
      schemaVersion: 1,
      superseded: [],
      unpublished: [],
      updatedAt: AT,
    });
    expect(snapshot.kinds.map((view) => view.kind)).toEqual([...LINEAR_ATLAS_KINDS]);
  });

  it("projects every kind to its whole view: first-channel detail, channel-ordered observations, the setting's team scope", () => {
    const home = scratchHome();
    publishClean({ home });
    const snapshot = unwrap(readLinearSnapshot({ home }));
    expect(snapshot.kinds).toEqual(LINEAR_ATLAS_KINDS.map((kind) => expectedKindView({ kind })));
  });

  it("gives each kind its own success instant, never another kind's", () => {
    const home = scratchHome();
    publishClean({ home });

    expect(unwrap(readLinearSnapshot({ home })).kinds.map((view) => view.lastSuccessAt)).toEqual([
      "2026-10-04T00:00:00.000Z",
      "2026-10-04T00:01:00.000Z",
      "2026-10-04T00:02:00.000Z",
      "2026-10-04T00:03:00.000Z",
    ]);
  });

  it("flags a failed latest attempt on the failing kind alone, keeping the success it had", () => {
    const home = scratchHome();
    publishClean({ home });
    const views = unwrap(readLinearSnapshot({ home })).kinds;

    expect(views.map((view) => view.latestAttemptFailed)).toEqual([false, true, false, false]);
    expect(views.find((view) => view.kind === "page")!.lastSuccessAt).toBe("2026-10-04T00:01:00.000Z");
  });

  it("carries the permission block on the blocked kind alone", () => {
    const home = scratchHome();
    publishClean({ home });

    expect(unwrap(readLinearSnapshot({ home })).kinds.map((view) => view.permissionBlocked)).toEqual([
      null,
      null,
      {
        at: "2026-10-10T00:00:00.000Z",
        detail: "the member may not read workspace administration settings",
        unblockedBy: "the workspace admin role",
      },
      null,
    ]);
  });

  it("counts the entities each kind published, a different number for every kind", () => {
    const home = scratchHome();
    publishClean({ home });

    expect(unwrap(readLinearSnapshot({ home })).kinds.map((view) => view.publishedCount)).toEqual([1, 2, 3, 4]);
  });

  it("refuses a corrupt manifest as unreadable, naming the file, rather than reading it as an empty atlas", () => {
    const home = scratchHome();
    const paths = linearAtlasPaths({ home });
    mkdirSync(dirname(paths.manifest), { recursive: true });
    writeFileSync(paths.manifest, "{ this is not json");
    const error = unwrapErr(readLinearSnapshot({ home }));
    expect(error).toEqual(
      AtlasReadErrors.storeUnreadable({
        platform: "linear",
        reasons: [
          `${paths.manifest} is not valid JSON`,
          "refusing rather than treating a corrupt atlas as an empty one",
        ],
      }),
    );
  });
});

describe("linearObservations", () => {
  it("lists the API observation before the browser one", () => {
    const entity = ENTITIES.operation;
    expect(linearObservations({ entity })).toEqual([API_OBSERVATION, BROWSER_OBSERVATION]);
  });

  it("lists the API observation first even when the browser key was written first", () => {
    const entity: LinearAtlasEntity = {
      ...ENTITIES.operation,
      channels: {
        browser: channelRecord({ channel: "browser", detail: OPERATION_BROWSER_DETAIL }),
        api: channelRecord({ channel: "api", detail: OPERATION_API_DETAIL }),
      },
    };
    expect(linearObservations({ entity })).toEqual([API_OBSERVATION, BROWSER_OBSERVATION]);
  });

  it("lists only the channel that has looked, carrying its stale state through", () => {
    const entity = entityWith({
      api: null,
      browser: channelRecord({ channel: "browser", detail: PAGE_DETAIL, state: "stale" }),
      kind: "page",
    });
    expect(linearObservations({ entity })).toEqual([{ ...BROWSER_OBSERVATION, state: "stale" }]);
  });

  it("lists nothing for an entity neither channel has looked at", () => {
    expect(linearObservations({ entity: entityWith({ api: null, browser: null, kind: "type" }) })).toEqual([]);
  });
});

describe("linearEntityScope", () => {
  it("scopes every non-setting kind to the workspace, even when its detail happens to name a team", () => {
    const entity = entityWith({
      api: channelRecord({ channel: "api", detail: { settingScope: "team/ENG" } }),
      browser: null,
      kind: "operation",
    });
    expect(linearEntityScope({ entity })).toBe("linear");
  });

  it("scopes a setting to the team its API detail names", () => {
    expect(linearEntityScope({ entity: ENTITIES.setting })).toBe("team/ENG");
  });

  it("prefers the API team over the browser team when both name one", () => {
    const entity = settingWith({
      apiDetail: { settingScope: "team/ENG" },
      browserDetail: { settingScope: "team/OPS" },
    });
    expect(linearEntityScope({ entity })).toBe("team/ENG");
  });

  it("falls through to the browser team when the API detail names none", () => {
    const entity = settingWith({ apiDetail: {}, browserDetail: { settingScope: "team/OPS" } });
    expect(linearEntityScope({ entity })).toBe("team/OPS");
  });

  it("falls through to the browser team when the API team is the empty string", () => {
    const entity = settingWith({ apiDetail: { settingScope: "" }, browserDetail: { settingScope: "team/OPS" } });
    expect(linearEntityScope({ entity })).toBe("team/OPS");
  });

  it("scopes a setting to the workspace when every channel's team is the empty string", () => {
    const entity = settingWith({ apiDetail: { settingScope: "" }, browserDetail: { settingScope: "" } });
    expect(linearEntityScope({ entity })).toBe("linear");
  });

  it("scopes a setting to the workspace when its details are null", () => {
    const entity = settingWith({ apiDetail: null, browserDetail: null });
    expect(linearEntityScope({ entity })).toBe("linear");
  });

  it("scopes a setting to the workspace when its details are not objects, or its team is not a string", () => {
    const entity = settingWith({ apiDetail: "team/ENG", browserDetail: { settingScope: 7 } });
    expect(linearEntityScope({ entity })).toBe("linear");
  });

  it("scopes a setting no channel has looked at to the workspace", () => {
    expect(linearEntityScope({ entity: entityWith({ api: null, browser: null, kind: "setting" }) })).toBe("linear");
  });
});
