/**
 * The Xero read seam, driven directly: what it refuses before anything is published, what it projects once
 * a generation exists, and how it answers a store it cannot parse.
 *
 * The published generation is built through the atlas's REAL publish path (`publishXeroAtlas`), so the
 * manifest digests and entity counts are the ones the store stamps rather than numbers this file restates.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type AtlasKindView, type AtlasObservationView, AtlasReadErrors } from "../../../../atlas/kit/read.js";
import { XERO_ATLAS_DESCRIPTOR } from "../../../../atlas/xero/descriptor.js";
import {
  emptyXeroKindFile,
  initialXeroManifest,
  XERO_ATLAS_KINDS,
  type XeroAtlasEntity,
  type XeroAtlasKind,
  type XeroAtlasKindFile,
  type XeroAtlasManifest,
  type XeroChannelEntity,
} from "../../../../atlas/xero/model.js";
import { readXeroSnapshot, xeroObservations } from "../../../../atlas/xero/readAdapter.js";
import { publishXeroAtlas, xeroAtlasPaths } from "../../../../atlas/xero/store.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-10-12T00:00:00.000Z";
const SCREENSHOT_SHA = "c".repeat(64);
const SCREENSHOT = {
  byteLength: 4096,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: `artifacts/pages/${SCREENSHOT_SHA}.png`,
  sha256: SCREENSHOT_SHA,
} as const;

const homes: string[] = [];

/** A throwaway state home this file owns and removes. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-xero-read-"));
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
function successAtOf({ kind }: { kind: XeroAtlasKind }): string {
  return `2026-10-0${String(XERO_ATLAS_KINDS.indexOf(kind) + 1)}T00:00:00.000Z`;
}

/** The one kind whose latest attempt failed, after it had already succeeded once. */
const FAILED_KIND = "page" satisfies XeroAtlasKind;

/** When that failed attempt ran. */
const FAILED_ATTEMPT_AT = "2026-10-11T00:00:00.000Z";

/** The one kind the manifest records as permission-blocked. */
const BLOCKED_KIND = "method" satisfies XeroAtlasKind;

/** What each declared kind's first entity looks like, channel by channel, and the detail a reader should get. */
const SPECS: Readonly<Record<XeroAtlasKind, EntitySpec>> = {
  // A business-object family, known from the SDK alone.
  family: {
    api: {
      detail: { disposition: "configuration", product: "accounting" },
      endpoint: "accountingApi",
      screenshot: false,
    },
    browser: null,
    expectedDetail: { disposition: "configuration", product: "accounting" },
    providerId: "Invoices",
  },
  // Both channels hold a detail, so the API's wins and the observations run api then browser.
  method: {
    api: { detail: { responseFields: ["InvoiceID"] }, endpoint: "GET /Invoices", screenshot: false },
    browser: { detail: { callCount: 7, statusCode: 200 }, endpoint: "GET /api.xro/2.0/Invoices", screenshot: false },
    expectedDetail: { responseFields: ["InvoiceID"] },
    providerId: "GET /Invoices",
  },
  // The API channel has looked but holds no detail, so the browser's is the first non-null one.
  page: {
    api: { detail: null, endpoint: "GET /Pages", screenshot: false },
    browser: { detail: { statusCode: 200, title: "Business overview" }, endpoint: "/dashboard", screenshot: true },
    expectedDetail: { statusCode: 200, title: "Business overview" },
    providerId: "/dashboard",
  },
};

/** The stored form of one channel's view. */
function storedChannel({ channel, spec }: { channel: "api" | "browser"; spec: ChannelSpec }): XeroChannelEntity {
  return {
    channel,
    detail: spec.detail,
    firstSeenAt: AT,
    lastSeenAt: AT,
    source: {
      artifacts: spec.screenshot ? [SCREENSHOT] : [],
      channel,
      deepLink: channel === "browser" ? "https://go.xero.com/app/dashboard" : null,
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
function specsFor({ kind }: { kind: XeroAtlasKind }): readonly { ordinal: number; spec: EntitySpec }[] {
  const declared = SPECS[kind];
  return Array.from({ length: XERO_ATLAS_KINDS.indexOf(kind) + 1 }, (_, index) => {
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
  kind: XeroAtlasKind;
  ordinal: number;
  spec: EntitySpec;
}): XeroAtlasEntity {
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
function entityFor({ kind }: { kind: XeroAtlasKind }): XeroAtlasEntity {
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
      deepLink: "https://go.xero.com/app/dashboard",
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
function kindFileFor({ kind }: { kind: XeroAtlasKind }): XeroAtlasKindFile {
  return {
    ...emptyXeroKindFile({ kind, updatedAt: AT }),
    coverage: [
      {
        artifacts: [],
        channel: "api",
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason: `${kind} rows were read from the installed SDK`,
        role: "authoritative",
        scope: `declared-${kind}`,
        state: "synced",
        surface: "sdk-declared",
        unblockedBy: null,
        visibilityScope: "sdk-declarations",
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
  detail: "the organisation has not consented to this scope",
  unblockedBy: "grant the accounting.transactions scope on the connection",
};

/** The permission block the view must carry for one kind: the fixture's one block, or none. */
function expectedPermissionBlockOf({ kind }: { kind: XeroAtlasKind }): typeof PERMISSION_BLOCK | null {
  if (kind === BLOCKED_KIND) {
    return PERMISSION_BLOCK;
  }
  return null;
}

/** The whole view a published kind should project to. */
function expectedViewFor({ kind }: { kind: XeroAtlasKind }): AtlasKindView {
  const specs = specsFor({ kind });
  return {
    coverage: [
      {
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason: `${kind} rows were read from the installed SDK`,
        scope: `declared-${kind}`,
        state: "synced",
        surface: "sdk-declared",
        unblockedBy: null,
      },
    ],
    entities: specs.map(({ ordinal, spec }) => ({
      detail: spec.expectedDetail,
      id: `${kind}-${String(ordinal)}`,
      kind,
      observations: expectedObservations({ spec }),
      providerId: spec.providerId,
      scope: "xero",
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
function attemptOf({ kind }: { kind: XeroAtlasKind }): { at: string; outcome: "ok" | "failed"; reasons: string[] } {
  if (kind === FAILED_KIND) {
    return { at: FAILED_ATTEMPT_AT, outcome: "failed", reasons: ["HTTP 503"] };
  }
  return { at: successAtOf({ kind }), outcome: "ok", reasons: [] };
}

/** The status the fixture records for one kind: its own success instant, attempt and, for one kind, a block. */
function statusOf({ kind }: { kind: XeroAtlasKind }): XeroAtlasManifest["kinds"][XeroAtlasKind] {
  const initial = initialXeroManifest({ updatedAt: AT });
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
function publishGeneration({ home }: { home: string }): XeroAtlasManifest {
  const paths = xeroAtlasPaths({ home });
  const initial = initialXeroManifest({ updatedAt: AT });
  const manifest: XeroAtlasManifest = {
    ...initial,
    kinds: {
      family: statusOf({ kind: "family" }),
      method: statusOf({ kind: "method" }),
      page: statusOf({ kind: "page" }),
    },
  };
  unwrap(
    publishXeroAtlas({
      derivedFrom: null,
      files: {
        family: kindFileFor({ kind: "family" }),
        method: kindFileFor({ kind: "method" }),
        page: kindFileFor({ kind: "page" }),
      },
      manifest,
      paths,
    }),
  );
  return manifest;
}

describe("readXeroSnapshot over an empty home", () => {
  it("refuses with the unpublished error and the sync remedy, never an empty snapshot", () => {
    const error = unwrapErr(readXeroSnapshot({ home: scratchHome() }));

    expect(error).toEqual(
      AtlasReadErrors.generationUnpublished({
        platform: "xero",
        remedy: "run: slopweaver atlas xero sync — it reads every operation the installed client declares",
      }),
    );
  });
});

describe("readXeroSnapshot over a published generation", () => {
  it("projects the whole snapshot: descriptor, generation, and every kind in declared order", () => {
    const home = scratchHome();
    publishGeneration({ home });

    const snapshot = unwrap(readXeroSnapshot({ home }));

    expect(snapshot.descriptor).toEqual(XERO_ATLAS_DESCRIPTOR);
    expect(snapshot.generation).toEqual({
      mismatched: [],
      missing: [],
      platform: "xero",
      schemaVersion: 1,
      superseded: [],
      unpublished: [],
      updatedAt: AT,
    });
    expect(XERO_ATLAS_KINDS).toEqual(["family", "method", "page"]);
    expect(snapshot.kinds).toEqual([
      expectedViewFor({ kind: "family" }),
      expectedViewFor({ kind: "method" }),
      expectedViewFor({ kind: "page" }),
    ]);
  });

  it("carries a kind's permissionBlocked from the manifest to that kind's view and no other", () => {
    const home = scratchHome();
    publishGeneration({ home });

    const snapshot = unwrap(readXeroSnapshot({ home }));

    expect(snapshot.kinds.map((kind) => kind.permissionBlocked)).toEqual([
      null,
      {
        at: "2026-10-10T00:00:00.000Z",
        detail: "the organisation has not consented to this scope",
        unblockedBy: "grant the accounting.transactions scope on the connection",
      },
      null,
    ]);
  });

  it("gives each kind its own success instant, never another kind's", () => {
    const home = scratchHome();
    publishGeneration({ home });

    expect(unwrap(readXeroSnapshot({ home })).kinds.map((kind) => kind.lastSuccessAt)).toEqual([
      "2026-10-01T00:00:00.000Z",
      "2026-10-02T00:00:00.000Z",
      "2026-10-03T00:00:00.000Z",
    ]);
  });

  it("flags a failed latest attempt on the failing kind alone, keeping the success it had", () => {
    const home = scratchHome();
    publishGeneration({ home });
    const kinds = unwrap(readXeroSnapshot({ home })).kinds;

    expect(kinds.map((kind) => kind.latestAttemptFailed)).toEqual([false, false, true]);
    expect(kinds.find((kind) => kind.kind === "page")!.lastSuccessAt).toBe("2026-10-03T00:00:00.000Z");
  });

  it("counts the entities each kind published, a different number for every kind", () => {
    const home = scratchHome();
    publishGeneration({ home });

    expect(unwrap(readXeroSnapshot({ home })).kinds.map((kind) => kind.publishedCount)).toEqual([1, 2, 3]);
  });
});

describe("readXeroSnapshot over a store it cannot parse", () => {
  it("returns the unreadable error naming the manifest, rather than treating it as an empty atlas", () => {
    const home = scratchHome();
    const paths = xeroAtlasPaths({ home });
    mkdirSync(dirname(paths.manifest), { recursive: true });
    writeFileSync(paths.manifest, "this is not json");

    const error = unwrapErr(readXeroSnapshot({ home }));

    expect(error).toEqual(
      AtlasReadErrors.storeUnreadable({
        platform: "xero",
        reasons: [
          `${paths.manifest} is not valid JSON`,
          "refusing rather than treating a corrupt atlas as an empty one",
        ],
      }),
    );
  });
});

describe("xeroObservations", () => {
  it("emits the api observation then the browser one when both channels have looked", () => {
    expect(xeroObservations({ entity: entityFor({ kind: "method" }) })).toEqual(
      expectedObservations({ spec: SPECS.method }),
    );
  });

  it("emits only the browser observation when the api channel has never looked", () => {
    const entity: XeroAtlasEntity = {
      ...entityFor({ kind: "page" }),
      channels: {
        api: null,
        browser: storedChannel({
          channel: "browser",
          spec: { detail: { title: "Business overview" }, endpoint: "/dashboard", screenshot: false },
        }),
      },
    };

    expect(xeroObservations({ entity })).toEqual([
      {
        artifacts: [],
        deepLink: "https://go.xero.com/app/dashboard",
        deepLinkStatus: "browser-discovered",
        endpoint: "/dashboard",
        observedAt: AT,
        state: "observed",
        surface: "browser",
      },
    ]);
  });
});
