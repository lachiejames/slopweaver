/**
 * `readBrazeSnapshot` and `brazeObservations`, over a real published generation.
 *
 * The published case goes through `publishBrazeAtlas` rather than a hand-written store, so digest stamping,
 * the manifest clock and the schemas are exercised exactly as a sync exercises them.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  BRAZE_KINDS,
  type BrazeAtlasEntity,
  type BrazeAtlasKindFile,
  type BrazeAtlasManifest,
  type BrazeChannel,
  type BrazeChannelEntity,
  type BrazeKind,
  emptyBrazeKindFile,
  initialBrazeManifest,
} from "../../../../atlas/braze/model.js";
import { brazeObservations, readBrazeSnapshot } from "../../../../atlas/braze/readAdapter.js";
import { brazeAtlasPaths, publishBrazeAtlas } from "../../../../atlas/braze/store.js";
import { brazeDescriptorFor } from "../../../../atlas/braze/surfaceFill.js";
import { type AtlasEntityView, type AtlasKindView, AtlasReadErrors } from "../../../../atlas/kit/read.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-10-12T00:00:00.000Z";

/** Braze's declared kinds, written out so a reordering of the constant is a visible change here. */
const EXPECTED_KINDS: readonly BrazeKind[] = [
  "apps",
  "catalogs",
  "cdi",
  "data_objects",
  "email",
  "export",
  "messaging",
  "page",
  "preference_center",
  "scim",
  "sdk_authentication",
  "sms",
  "subscription_groups",
  "templates",
  "translations",
  "undocumented",
  "user_data",
];

/**
 * A distinct success instant per kind, from the kind's place in the declared list, so a read of the wrong
 * kind's status shows as the wrong instant. No clock is read.
 */
function successAtOf({ kind }: { kind: BrazeKind }): string {
  return `2026-10-01T00:${String(EXPECTED_KINDS.indexOf(kind)).padStart(2, "0")}:00.000Z`;
}

/** The one kind whose latest attempt failed, after it had already succeeded once. */
const FAILED_KIND: BrazeKind = "sms";

/** When that failed attempt ran. */
const FAILED_ATTEMPT_AT = "2026-10-11T00:00:00.000Z";

/** The one kind the manifest records as permission-blocked. */
const BLOCKED_KIND: BrazeKind = "scim";

/** The permission boundary stamped on {@link BLOCKED_KIND}. */
const PERMISSION_BLOCK = {
  at: "2026-10-10T00:00:00.000Z",
  detail: "the API key may not read SCIM resources",
  unblockedBy: "the scim.* permissions on the API key",
};

/**
 * How many entities the fixture publishes for one kind: one more than its place in the declared list, so
 * every kind's published count differs from every other kind's.
 */
function entityCountOf({ kind }: { kind: BrazeKind }): number {
  return EXPECTED_KINDS.indexOf(kind) + 1;
}

/** The ordinals of the entities the fixture publishes for one kind, starting at one. */
function ordinalsOf({ kind }: { kind: BrazeKind }): readonly number[] {
  return Array.from({ length: entityCountOf({ kind }) }, (_, index) => index + 1);
}

const homes: string[] = [];

/** A throwaway state home, so nothing here ever touches the ambient one. */
const freshHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "braze-read-"));
  homes.push(home);
  return home;
};

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

/** The endpoint a channel records for an entity of one kind. */
function endpointOf({ channel, kind }: { channel: BrazeChannel; kind: BrazeKind }): string {
  return `${channel}://${kind}`;
}

/** The detail a channel stores for an entity of one kind. */
function detailOf({ channel, kind }: { channel: BrazeChannel; kind: BrazeKind }): { channel: string; kind: string } {
  return { channel, kind };
}

/** One channel's stored record, with a source that names its own endpoint. */
function channelOf({
  channel,
  detail,
  endpoint,
}: {
  channel: BrazeChannel;
  detail: unknown;
  endpoint: string;
}): BrazeChannelEntity {
  return {
    channel,
    detail,
    firstSeenAt: AT,
    lastSeenAt: AT,
    source: { artifacts: [], channel, deepLink: null, deepLinkStatus: "unavailable", endpoint, observedAt: AT },
    state: "observed",
  };
}

/** Which channels have looked at an entity of this kind, in declared channel order. */
function channelNamesOf({ kind }: { kind: BrazeKind }): readonly BrazeChannel[] {
  if (kind === "page") {
    return ["browser"];
  }
  if (kind === "undocumented") {
    return ["collection"];
  }
  return ["docs", "collection"];
}

/** The id and providerId an entity of one kind carries. */
function providerIdOf({ kind, ordinal }: { kind: BrazeKind; ordinal: number }): string {
  return `GET /${kind}/example-${String(ordinal)}`;
}

/** One stored entity of one kind, filled in only the channels that kind is observed through. */
function entityOf({ kind, ordinal }: { kind: BrazeKind; ordinal: number }): BrazeAtlasEntity {
  const channels: BrazeAtlasEntity["channels"] = { api: null, browser: null, collection: null, docs: null };
  for (const channel of channelNamesOf({ kind })) {
    channels[channel] = channelOf({
      channel,
      detail: detailOf({ channel, kind }),
      endpoint: endpointOf({ channel, kind }),
    });
  }
  return { channels, id: `id-${kind}-${String(ordinal)}`, kind, providerId: providerIdOf({ kind, ordinal }) };
}

/** The view an entity of one kind must project to. */
function expectedEntityView({ kind, ordinal }: { kind: BrazeKind; ordinal: number }): AtlasEntityView {
  const names = channelNamesOf({ kind });
  return {
    detail: detailOf({ channel: names[0]!, kind }),
    id: `id-${kind}-${String(ordinal)}`,
    kind,
    observations: names.map((channel) => ({
      artifacts: [],
      deepLink: null,
      deepLinkStatus: "unavailable",
      endpoint: endpointOf({ channel, kind }),
      observedAt: AT,
      state: "observed",
      surface: channel,
    })),
    providerId: providerIdOf({ kind, ordinal }),
    scope: "braze",
  };
}

/**
 * The coverage cell one kind's file carries, its reason naming the kind, so a view that reads another
 * kind's coverage shows the wrong reason.
 */
function coverageOf({ kind }: { kind: BrazeKind }): BrazeAtlasKindFile["coverage"][number] {
  return {
    artifacts: [],
    channel: "docs",
    lastSuccessAt: AT,
    latestAttemptFailed: false,
    reason: `the ${kind} endpoint reference was read offline`,
    role: "authoritative",
    scope: kind,
    state: "synced",
    surface: "docs",
    unblockedBy: null,
    visibilityScope: "docs-published-reference",
  };
}

/** The gap one kind's file carries, its id and reason naming the kind for the same reason. */
function gapOf({ kind }: { kind: BrazeKind }): BrazeAtlasKindFile["gaps"][number] {
  return {
    condition: "operation-in-one-channel-only",
    fields: [],
    firstDetectedAt: AT,
    id: `gap-${kind}-1`,
    kind,
    lastCheckedAt: AT,
    lastDetectedAt: AT,
    reason: `the collection omits a ${kind} operation`,
    scope: kind,
    status: "open",
    surfaces: ["docs", "collection"],
  };
}

/** The kind file for one kind: its entities, its own coverage cell and its own gap. */
function fileOf({ kind }: { kind: BrazeKind }): BrazeAtlasKindFile {
  const empty = emptyBrazeKindFile({ kind, updatedAt: AT });
  const entities = ordinalsOf({ kind }).map((ordinal) => entityOf({ kind, ordinal }));
  return { ...empty, coverage: [coverageOf({ kind })], entities, gaps: [gapOf({ kind })] };
}

/** The latest attempt the fixture records for one kind: a success at its own instant, or the one failure. */
function attemptOf({ kind }: { kind: BrazeKind }): { at: string; outcome: "ok" | "failed"; reasons: string[] } {
  if (kind === FAILED_KIND) {
    return { at: FAILED_ATTEMPT_AT, outcome: "failed", reasons: ["HTTP 503"] };
  }
  return { at: successAtOf({ kind }), outcome: "ok", reasons: [] };
}

/**
 * A manifest giving every kind its own history: a success at a distinct instant, one kind whose latest
 * attempt failed after succeeding, and one kind blocked by permission.
 */
function succeededManifest(): BrazeAtlasManifest {
  const initial = initialBrazeManifest({ updatedAt: AT });
  const kinds = { ...initial.kinds };
  for (const kind of BRAZE_KINDS) {
    kinds[kind] = {
      ...initial.kinds[kind],
      lastAttempt: attemptOf({ kind }),
      lastSuccessAt: successAtOf({ kind }),
    };
  }
  kinds[BLOCKED_KIND] = { ...kinds[BLOCKED_KIND], permissionBlocked: PERMISSION_BLOCK };
  return { ...initial, kinds };
}

/** Publish the fixture's entities into a fresh home through the atlas's own publisher. */
function publishedHome(): {
  home: string;
  manifest: BrazeAtlasManifest;
} {
  const manifest = succeededManifest();
  const home = freshHome();
  const files: Partial<Record<BrazeKind, BrazeAtlasKindFile>> = {};
  for (const kind of BRAZE_KINDS) {
    files[kind] = fileOf({ kind });
  }
  unwrap(publishBrazeAtlas({ derivedFrom: null, files, manifest, paths: brazeAtlasPaths({ home }) }));
  return { home, manifest };
}

/** The permission block the view must carry for one kind: the fixture's one block, or none. */
function expectedPermissionBlockOf({ kind }: { kind: BrazeKind }): typeof PERMISSION_BLOCK | null {
  if (kind === BLOCKED_KIND) {
    return PERMISSION_BLOCK;
  }
  return null;
}

/** The whole view the adapter must give for one kind of the published fixture. */
function expectedKindView({ kind }: { kind: BrazeKind }): AtlasKindView {
  return {
    coverage: [
      {
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason: `the ${kind} endpoint reference was read offline`,
        scope: kind,
        state: "synced",
        surface: "docs",
        unblockedBy: null,
      },
    ],
    entities: ordinalsOf({ kind }).map((ordinal) => expectedEntityView({ kind, ordinal })),
    gaps: [
      {
        condition: "operation-in-one-channel-only",
        id: `gap-${kind}-1`,
        lastDetectedAt: AT,
        reason: `the collection omits a ${kind} operation`,
        scope: kind,
        status: "open",
      },
    ],
    kind,
    lastSuccessAt: successAtOf({ kind }),
    latestAttemptFailed: kind === FAILED_KIND,
    permissionBlocked: expectedPermissionBlockOf({ kind }),
    publishedCount: entityCountOf({ kind }),
  };
}

describe("readBrazeSnapshot with nothing published", () => {
  it("refuses with the exact unpublished error and Braze's own remedy", () => {
    const error = unwrapErr(readBrazeSnapshot({ home: freshHome() }));

    expect(error).toEqual(
      AtlasReadErrors.generationUnpublished({
        platform: "braze",
        remedy:
          "run: slopweaver atlas braze sync — it reads Braze's own published reference and official Postman collection, and needs no credential",
      }),
    );
  });
});

describe("readBrazeSnapshot over a published generation", () => {
  it("reports the generation whole: nothing missing, mismatched, superseded or unpublished", () => {
    const { home } = publishedHome();

    expect(unwrap(readBrazeSnapshot({ home })).generation).toEqual({
      mismatched: [],
      missing: [],
      platform: "braze",
      schemaVersion: 1,
      superseded: [],
      unpublished: [],
      updatedAt: AT,
    });
  });

  it("lists every kind in the order the atlas declares them", () => {
    const { home } = publishedHome();

    expect(unwrap(readBrazeSnapshot({ home })).kinds.map((kind) => kind.kind)).toEqual(EXPECTED_KINDS);
  });

  it("projects every kind to its whole view: scope, first-channel detail, ordered observations and the manifest's freshness", () => {
    const { home } = publishedHome();

    expect(unwrap(readBrazeSnapshot({ home })).kinds).toEqual(EXPECTED_KINDS.map((kind) => expectedKindView({ kind })));
  });

  it("takes an entity's detail from the first channel that holds one, not from the first channel that exists", () => {
    const { home } = publishedHome();
    const kinds = unwrap(readBrazeSnapshot({ home })).kinds;

    expect(kinds.find((kind) => kind.kind === "undocumented")!.entities[0]!.detail).toEqual({
      channel: "collection",
      kind: "undocumented",
    });
    expect(kinds.find((kind) => kind.kind === "page")!.entities[0]!.detail).toEqual({
      channel: "browser",
      kind: "page",
    });
  });

  it("derives the descriptor from this install's manifest rather than serving the static one", () => {
    const { home, manifest } = publishedHome();

    expect(unwrap(readBrazeSnapshot({ home })).descriptor).toEqual(brazeDescriptorFor({ manifest }));
  });

  it("derives a different descriptor when the manifest records no success, so the equality above is not vacuous", () => {
    const { home, manifest } = publishedHome();
    const never = brazeDescriptorFor({ manifest: initialBrazeManifest({ updatedAt: AT }) });

    expect(unwrap(readBrazeSnapshot({ home })).descriptor).not.toEqual(never);
    expect(brazeDescriptorFor({ manifest })).not.toEqual(never);
  });

  it("gives each kind its own success instant, never another kind's", () => {
    const { home } = publishedHome();

    expect(unwrap(readBrazeSnapshot({ home })).kinds.map((kind) => kind.lastSuccessAt)).toEqual([
      "2026-10-01T00:00:00.000Z",
      "2026-10-01T00:01:00.000Z",
      "2026-10-01T00:02:00.000Z",
      "2026-10-01T00:03:00.000Z",
      "2026-10-01T00:04:00.000Z",
      "2026-10-01T00:05:00.000Z",
      "2026-10-01T00:06:00.000Z",
      "2026-10-01T00:07:00.000Z",
      "2026-10-01T00:08:00.000Z",
      "2026-10-01T00:09:00.000Z",
      "2026-10-01T00:10:00.000Z",
      "2026-10-01T00:11:00.000Z",
      "2026-10-01T00:12:00.000Z",
      "2026-10-01T00:13:00.000Z",
      "2026-10-01T00:14:00.000Z",
      "2026-10-01T00:15:00.000Z",
      "2026-10-01T00:16:00.000Z",
    ]);
  });

  it("flags a failed latest attempt on the failing kind alone, without discarding its last success", () => {
    const { home } = publishedHome();
    const kinds = unwrap(readBrazeSnapshot({ home })).kinds;

    expect(kinds.filter((kind) => kind.latestAttemptFailed).map((kind) => [kind.kind, kind.lastSuccessAt])).toEqual([
      ["sms", "2026-10-01T00:11:00.000Z"],
    ]);
  });

  it("carries the permission block on the blocked kind alone", () => {
    const { home } = publishedHome();
    const kinds = unwrap(readBrazeSnapshot({ home })).kinds;

    expect(
      kinds.filter((kind) => kind.permissionBlocked !== null).map((kind) => [kind.kind, kind.permissionBlocked]),
    ).toEqual([
      [
        "scim",
        {
          at: "2026-10-10T00:00:00.000Z",
          detail: "the API key may not read SCIM resources",
          unblockedBy: "the scim.* permissions on the API key",
        },
      ],
    ]);
  });

  it("counts the entities each kind published, a different number for every kind", () => {
    const { home } = publishedHome();

    expect(unwrap(readBrazeSnapshot({ home })).kinds.map((kind) => kind.publishedCount)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
    ]);
  });
});

describe("readBrazeSnapshot over an unreadable store", () => {
  it("refuses rather than treating a corrupt manifest as an empty atlas", () => {
    const home = freshHome();
    const paths = brazeAtlasPaths({ home });
    mkdirSync(dirname(paths.manifest), { recursive: true });
    writeFileSync(paths.manifest, "{ this is not json");

    expect(unwrapErr(readBrazeSnapshot({ home }))).toEqual(
      AtlasReadErrors.storeUnreadable({
        platform: "braze",
        reasons: [
          `${paths.manifest} is not valid JSON`,
          "refusing rather than treating a corrupt atlas as an empty one",
        ],
      }),
    );
  });
});

describe("brazeObservations", () => {
  const observation = ({ channel }: { channel: BrazeChannel }) => ({
    artifacts: [],
    deepLink: null,
    deepLinkStatus: "unavailable",
    endpoint: `${channel}://operation`,
    observedAt: AT,
    state: "observed",
    surface: channel,
  });

  const record = ({ channel }: { channel: BrazeChannel }): BrazeChannelEntity =>
    channelOf({ channel, detail: null, endpoint: `${channel}://operation` });

  it("emits every populated channel in declared order, whatever order the record was assembled in", () => {
    const entity: BrazeAtlasEntity = {
      channels: {
        browser: record({ channel: "browser" }),
        api: record({ channel: "api" }),
        collection: record({ channel: "collection" }),
        docs: record({ channel: "docs" }),
      },
      id: "id-operation",
      kind: "email",
      providerId: "GET /operation",
    };

    expect(brazeObservations({ entity })).toEqual([
      observation({ channel: "docs" }),
      observation({ channel: "collection" }),
      observation({ channel: "api" }),
      observation({ channel: "browser" }),
    ]);
  });

  it("emits only the channels that have looked, skipping a channel that never did", () => {
    const entity: BrazeAtlasEntity = {
      channels: {
        api: null,
        browser: record({ channel: "browser" }),
        collection: record({ channel: "collection" }),
        docs: null,
      },
      id: "id-operation",
      kind: "email",
      providerId: "GET /operation",
    };

    expect(brazeObservations({ entity })).toEqual([
      observation({ channel: "collection" }),
      observation({ channel: "browser" }),
    ]);
  });

  it("emits nothing for an entity no channel has looked at", () => {
    const entity: BrazeAtlasEntity = {
      channels: { api: null, browser: null, collection: null, docs: null },
      id: "id-operation",
      kind: "email",
      providerId: "GET /operation",
    };

    expect(brazeObservations({ entity })).toEqual([]);
  });

  it("still yields an observation for a channel whose source is missing, falling back to the channel and its last sighting", () => {
    const sourceless: BrazeChannelEntity = { ...record({ channel: "docs" }), source: null };
    const entity: BrazeAtlasEntity = {
      channels: { api: null, browser: null, collection: null, docs: sourceless },
      id: "id-operation",
      kind: "email",
      providerId: "GET /operation",
    };

    expect(brazeObservations({ entity })).toEqual([
      {
        artifacts: [],
        deepLink: null,
        deepLinkStatus: "unverified",
        endpoint: "docs",
        observedAt: AT,
        state: "observed",
        surface: "docs",
      },
    ]);
  });
});
