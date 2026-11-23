/**
 * The Twilio read seam, driven directly: what it refuses before anything is published, what it projects once
 * a generation exists, and how it answers a store it cannot parse.
 *
 * The published generation is built through the atlas's REAL publish path (`publishTwilioAtlas`), so the
 * manifest digests and entity counts are the ones the store stamps rather than numbers this file restates.
 * Twilio's descriptor is derived from the manifest, so the expected one is built from the manifest as it is
 * read back from disk, never from the module constant.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type AtlasKindView, type AtlasObservationView, AtlasReadErrors } from "../../../../atlas/kit/read.js";
import {
  emptyTwilioKindFile,
  initialTwilioManifest,
  TWILIO_ATLAS_KINDS,
  type TwilioAtlasEntity,
  type TwilioAtlasKind,
  type TwilioAtlasKindFile,
  type TwilioAtlasManifest,
  type TwilioChannelEntity,
} from "../../../../atlas/twilio/model.js";
import { readTwilioSnapshot, twilioObservations } from "../../../../atlas/twilio/readAdapter.js";
import { publishTwilioAtlas, readTwilioManifest, twilioAtlasPaths } from "../../../../atlas/twilio/store.js";
import { twilioDescriptorFor } from "../../../../atlas/twilio/surfaceFill.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-10-12T00:00:00.000Z";
const SCREENSHOT_SHA = "b".repeat(64);
const SCREENSHOT = {
  byteLength: 2048,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: `artifacts/pages/${SCREENSHOT_SHA}.png`,
  sha256: SCREENSHOT_SHA,
} as const;

const homes: string[] = [];

/** A throwaway state home this file owns and removes. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-twilio-read-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** What one channel recorded for one entity: the reproduction handle, its detail, and whether it kept a picture. */
interface ChannelSpec {
  readonly detail: unknown;
  readonly endpoint: string;
  readonly screenshot: boolean;
}

/** What one entity looks like, channel by channel, and the detail a reader should get. */
interface EntitySpec {
  readonly api: ChannelSpec | null;
  readonly browser: ChannelSpec | null;
  readonly expectedDetail: unknown;
  readonly providerId: string;
}

/**
 * A distinct success instant per kind, from the kind's place in the declared list, so a read of the wrong
 * kind's status shows as the wrong instant. No clock is read.
 */
function successAtOf({ kind }: { kind: TwilioAtlasKind }): string {
  return `2026-10-0${String(TWILIO_ATLAS_KINDS.indexOf(kind) + 1)}T00:00:00.000Z`;
}

/** The one kind whose latest attempt failed, after it had already succeeded once. */
const FAILED_KIND = "method" satisfies TwilioAtlasKind;

/** When that failed attempt ran. */
const FAILED_ATTEMPT_AT = "2026-10-11T00:00:00.000Z";

/** The one kind the manifest records as permission-blocked. */
const BLOCKED_KIND = "resource" satisfies TwilioAtlasKind;

/** What each declared kind's first entity looks like, channel by channel, and the detail a reader should get. */
const SPECS: Readonly<Record<TwilioAtlasKind, EntitySpec>> = {
  // Credentialled surface, observed through the API channel only.
  account: {
    api: { detail: { friendlyName: "acme" }, endpoint: "GET /2010-04-01/Accounts", screenshot: false },
    browser: null,
    expectedDetail: { friendlyName: "acme" },
    providerId: "account/acme",
  },
  // A published document, observed through the API channel only.
  api: {
    api: { detail: { product: "messaging", version: "v1" }, endpoint: "twilio_messaging_v1.json", screenshot: false },
    browser: null,
    expectedDetail: { product: "messaging", version: "v1" },
    providerId: "twilio_messaging_v1",
  },
  // Both channels hold a detail, so the API's wins and the observations run api then browser.
  method: {
    api: {
      detail: { host: "messaging.twilio.com", specs: ["twilio_messaging_v1"] },
      endpoint: "GET /v1/Services",
      screenshot: false,
    },
    browser: { detail: { callCount: 4, statusCode: 200 }, endpoint: "GET /v1/Services?PageSize", screenshot: false },
    expectedDetail: { host: "messaging.twilio.com", specs: ["twilio_messaging_v1"] },
    providerId: "GET /v1/Services",
  },
  // The API channel has looked but holds no detail, so the browser's is the first non-null one.
  page: {
    api: { detail: null, endpoint: "GET /v1/Pages", screenshot: false },
    browser: { detail: { statusCode: 200, title: "Console home" }, endpoint: "/console", screenshot: true },
    expectedDetail: { statusCode: 200, title: "Console home" },
    providerId: "/console",
  },
  // Looked at, but neither channel holds a detail: the reader gets null, not a missing field.
  resource: {
    api: { detail: null, endpoint: "GET /v1/Services/{Sid}", screenshot: false },
    browser: null,
    expectedDetail: null,
    providerId: "resource/service",
  },
};

/** The stored form of one channel's view. */
function storedChannel({ channel, spec }: { channel: "api" | "browser"; spec: ChannelSpec }): TwilioChannelEntity {
  return {
    channel,
    detail: spec.detail,
    firstSeenAt: AT,
    lastSeenAt: AT,
    source: {
      artifacts: spec.screenshot ? [SCREENSHOT] : [],
      channel,
      deepLink: channel === "browser" ? "https://console.twilio.com/" : null,
      deepLinkStatus: channel === "browser" ? "browser-discovered" : "unavailable",
      endpoint: spec.endpoint,
      observedAt: AT,
    },
    state: "observed",
  };
}

/**
 * The specs of the entities the fixture publishes for one kind, numbered from one: the declared spec, then
 * copies with their own provider ids, one more in all than the kind's place in the declared list, so every
 * kind's published count differs.
 */
function specsFor({ kind }: { kind: TwilioAtlasKind }): readonly { ordinal: number; spec: EntitySpec }[] {
  const declared = SPECS[kind];
  return Array.from({ length: TWILIO_ATLAS_KINDS.indexOf(kind) + 1 }, (_, index) => {
    const ordinal = index + 1;
    if (index === 0) {
      return { ordinal, spec: declared };
    }
    return { ordinal, spec: { ...declared, providerId: `${declared.providerId}-${String(ordinal)}` } };
  });
}

/** The entity one spec stores under a kind. */
function storedEntity({
  kind,
  ordinal,
  spec,
}: {
  kind: TwilioAtlasKind;
  ordinal: number;
  spec: EntitySpec;
}): TwilioAtlasEntity {
  return {
    channels: {
      api: spec.api === null ? null : storedChannel({ channel: "api", spec: spec.api }),
      browser: spec.browser === null ? null : storedChannel({ channel: "browser", spec: spec.browser }),
    },
    id: `${kind}-${String(ordinal)}`,
    kind,
    providerId: spec.providerId,
  };
}

/** The first entity a kind's file stores. */
function entityFor({ kind }: { kind: TwilioAtlasKind }): TwilioAtlasEntity {
  return storedEntity({ kind, ordinal: 1, spec: SPECS[kind] });
}

/** The observations a reader should see for one entity, written out rather than derived by the adapter. */
function expectedObservations({ spec }: { spec: EntitySpec }): readonly AtlasObservationView[] {
  const { api, browser } = spec;
  const views: AtlasObservationView[] = [];
  if (api !== null) {
    views.push({
      artifacts: [],
      deepLink: null,
      deepLinkStatus: "unavailable",
      endpoint: api.endpoint,
      observedAt: AT,
      state: "observed",
      surface: "api",
    });
  }
  if (browser !== null) {
    views.push({
      artifacts: browser.screenshot ? [SCREENSHOT] : [],
      deepLink: "https://console.twilio.com/",
      deepLinkStatus: "browser-discovered",
      endpoint: browser.endpoint,
      observedAt: AT,
      state: "observed",
      surface: "browser",
    });
  }
  return views;
}

/** One kind file carrying one entity, one coverage cell and one gap. */
function kindFileFor({ kind }: { kind: TwilioAtlasKind }): TwilioAtlasKindFile {
  return {
    ...emptyTwilioKindFile({ kind, updatedAt: AT }),
    coverage: [
      {
        artifacts: [],
        channel: "api",
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason: `${kind} rows were compiled from the pinned definitions`,
        role: "authoritative",
        scope: `declared-${kind}`,
        state: "synced",
        surface: "definitions",
        unblockedBy: null,
        visibilityScope: "api-published-definitions",
      },
    ],
    entities: specsFor({ kind }).map(({ ordinal, spec }) => storedEntity({ kind, ordinal, spec })),
    gaps: [
      {
        condition: "not-reached",
        fields: [],
        firstDetectedAt: AT,
        id: `gap-${kind}`,
        kind,
        lastCheckedAt: AT,
        lastDetectedAt: AT,
        reason: `one ${kind} nobody has opened`,
        scope: `declared-${kind}`,
        status: "open",
        surfaces: ["browser"],
      },
    ],
  };
}

/** The permission boundary stamped on {@link BLOCKED_KIND}. */
const PERMISSION_BLOCK = {
  at: "2026-10-10T00:00:00.000Z",
  detail: "the API key is not authorised for this account",
  unblockedBy: "create a standard API key on the account",
};

/** The permission block the view must carry for one kind: the fixture's one block, or none. */
function expectedPermissionBlockOf({ kind }: { kind: TwilioAtlasKind }): typeof PERMISSION_BLOCK | null {
  if (kind === BLOCKED_KIND) {
    return PERMISSION_BLOCK;
  }
  return null;
}

/** The whole view a published kind should project to. */
function expectedViewFor({ kind }: { kind: TwilioAtlasKind }): AtlasKindView {
  const specs = specsFor({ kind });
  return {
    coverage: [
      {
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason: `${kind} rows were compiled from the pinned definitions`,
        scope: `declared-${kind}`,
        state: "synced",
        surface: "definitions",
        unblockedBy: null,
      },
    ],
    entities: specs.map(({ ordinal, spec }) => ({
      detail: spec.expectedDetail,
      id: `${kind}-${String(ordinal)}`,
      kind,
      observations: expectedObservations({ spec }),
      providerId: spec.providerId,
      scope: "twilio",
    })),
    gaps: [
      {
        condition: "not-reached",
        id: `gap-${kind}`,
        lastDetectedAt: AT,
        reason: `one ${kind} nobody has opened`,
        scope: `declared-${kind}`,
        status: "open",
      },
    ],
    kind,
    lastSuccessAt: successAtOf({ kind }),
    latestAttemptFailed: kind === FAILED_KIND,
    permissionBlocked: expectedPermissionBlockOf({ kind }),
    publishedCount: specs.length,
  };
}

/** The latest attempt the fixture records for one kind: a success at its own instant, or the one failure. */
function attemptOf({ kind }: { kind: TwilioAtlasKind }): { at: string; outcome: "ok" | "failed"; reasons: string[] } {
  if (kind === FAILED_KIND) {
    return { at: FAILED_ATTEMPT_AT, outcome: "failed", reasons: ["HTTP 503"] };
  }
  return { at: successAtOf({ kind }), outcome: "ok", reasons: [] };
}

/** The status the fixture records for one kind: its own success instant, attempt and, for one kind, a block. */
function statusOf({ kind }: { kind: TwilioAtlasKind }): TwilioAtlasManifest["kinds"][TwilioAtlasKind] {
  const initial = initialTwilioManifest({ updatedAt: AT });
  const status = { ...initial.kinds[kind], lastAttempt: attemptOf({ kind }), lastSuccessAt: successAtOf({ kind }) };
  if (kind === BLOCKED_KIND) {
    return { ...status, permissionBlocked: PERMISSION_BLOCK };
  }
  return status;
}

/**
 * Publish through the real publisher a generation giving every kind its own history: a success at a distinct
 * instant, one kind whose latest attempt failed after succeeding, one kind blocked by permission, and one
 * kind holding two entities.
 */
function publishGeneration({ home }: { home: string }): TwilioAtlasManifest {
  const paths = twilioAtlasPaths({ home });
  const initial = initialTwilioManifest({ updatedAt: AT });
  const manifest: TwilioAtlasManifest = {
    ...initial,
    kinds: {
      account: statusOf({ kind: "account" }),
      api: statusOf({ kind: "api" }),
      method: statusOf({ kind: "method" }),
      page: statusOf({ kind: "page" }),
      resource: statusOf({ kind: "resource" }),
    },
  };
  unwrap(
    publishTwilioAtlas({
      derivedFrom: null,
      files: {
        account: kindFileFor({ kind: "account" }),
        api: kindFileFor({ kind: "api" }),
        method: kindFileFor({ kind: "method" }),
        page: kindFileFor({ kind: "page" }),
        resource: kindFileFor({ kind: "resource" }),
      },
      manifest,
      paths,
    }),
  );
  return manifest;
}

describe("readTwilioSnapshot over an empty home", () => {
  it("refuses with the unpublished error and the sync remedy, never an empty snapshot", () => {
    const error = unwrapErr(readTwilioSnapshot({ home: scratchHome() }));

    expect(error).toEqual(
      AtlasReadErrors.generationUnpublished({
        platform: "twilio",
        remedy:
          "run: slopweaver atlas twilio sync — it compiles every published API definition from Twilio's own pinned twilio-oai repository",
      }),
    );
  });
});

describe("readTwilioSnapshot over a published generation", () => {
  it("projects the whole snapshot: derived descriptor, generation, and every kind in declared order", () => {
    const home = scratchHome();
    publishGeneration({ home });
    const stored = unwrap(readTwilioManifest({ paths: twilioAtlasPaths({ home }) }))!;

    const snapshot = unwrap(readTwilioSnapshot({ home }));

    expect(snapshot.descriptor).toEqual(twilioDescriptorFor({ manifest: stored }));
    expect(snapshot.generation).toEqual({
      mismatched: [],
      missing: [],
      platform: "twilio",
      schemaVersion: 1,
      superseded: [],
      unpublished: [],
      updatedAt: AT,
    });
    expect(TWILIO_ATLAS_KINDS).toEqual(["account", "api", "method", "page", "resource"]);
    expect(snapshot.kinds).toEqual(TWILIO_ATLAS_KINDS.map((kind) => expectedViewFor({ kind })));
  });

  it("fills the compiled and console surfaces from an all-success manifest and leaves the credentialled API unfilled", () => {
    const home = scratchHome();
    publishGeneration({ home });

    const snapshot = unwrap(readTwilioSnapshot({ home }));

    expect(snapshot.descriptor.surfaces.map((surface) => [surface.acquisition, surface.status])).toEqual([
      ["compiled", "filled"],
      ["api", "declared-unfilled"],
      ["driven-browser", "filled"],
    ]);
  });

  it("carries a kind's permissionBlocked from the manifest to that kind's view and no other", () => {
    const home = scratchHome();
    publishGeneration({ home });

    const snapshot = unwrap(readTwilioSnapshot({ home }));

    expect(snapshot.kinds.map((kind) => kind.permissionBlocked)).toEqual([
      null,
      null,
      null,
      null,
      {
        at: "2026-10-10T00:00:00.000Z",
        detail: "the API key is not authorised for this account",
        unblockedBy: "create a standard API key on the account",
      },
    ]);
  });

  it("gives each kind its own success instant, never another kind's", () => {
    const home = scratchHome();
    publishGeneration({ home });

    expect(unwrap(readTwilioSnapshot({ home })).kinds.map((kind) => kind.lastSuccessAt)).toEqual([
      "2026-10-01T00:00:00.000Z",
      "2026-10-02T00:00:00.000Z",
      "2026-10-03T00:00:00.000Z",
      "2026-10-04T00:00:00.000Z",
      "2026-10-05T00:00:00.000Z",
    ]);
  });

  it("flags a failed latest attempt on the failing kind alone, keeping the success it had", () => {
    const home = scratchHome();
    publishGeneration({ home });
    const kinds = unwrap(readTwilioSnapshot({ home })).kinds;

    expect(kinds.map((kind) => kind.latestAttemptFailed)).toEqual([false, false, true, false, false]);
    expect(kinds.find((kind) => kind.kind === "method")!.lastSuccessAt).toBe("2026-10-03T00:00:00.000Z");
  });

  it("counts the entities each kind published, a different number for every kind", () => {
    const home = scratchHome();
    publishGeneration({ home });

    expect(unwrap(readTwilioSnapshot({ home })).kinds.map((kind) => kind.publishedCount)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("readTwilioSnapshot over a store it cannot parse", () => {
  it("returns the unreadable error naming the manifest, rather than treating it as an empty atlas", () => {
    const home = scratchHome();
    const paths = twilioAtlasPaths({ home });
    mkdirSync(dirname(paths.manifest), { recursive: true });
    writeFileSync(paths.manifest, "this is not json");

    const error = unwrapErr(readTwilioSnapshot({ home }));

    expect(error).toEqual(
      AtlasReadErrors.storeUnreadable({
        platform: "twilio",
        reasons: [
          `${paths.manifest} is not valid JSON`,
          "refusing rather than treating a corrupt atlas as an empty one",
        ],
      }),
    );
  });
});

describe("twilioObservations", () => {
  it("emits the api observation then the browser one when both channels have looked", () => {
    expect(twilioObservations({ entity: entityFor({ kind: "method" }) })).toEqual(
      expectedObservations({ spec: SPECS.method }),
    );
  });

  it("emits only the browser observation when the api channel has never looked", () => {
    const entity: TwilioAtlasEntity = {
      ...entityFor({ kind: "page" }),
      channels: {
        api: null,
        browser: storedChannel({
          channel: "browser",
          spec: { detail: { title: "Console home" }, endpoint: "/console", screenshot: false },
        }),
      },
    };

    expect(twilioObservations({ entity })).toEqual([
      {
        artifacts: [],
        deepLink: "https://console.twilio.com/",
        deepLinkStatus: "browser-discovered",
        endpoint: "/console",
        observedAt: AT,
        state: "observed",
        surface: "browser",
      },
    ]);
  });
});
