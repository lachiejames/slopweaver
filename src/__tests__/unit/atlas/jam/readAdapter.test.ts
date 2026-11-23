/**
 * `readJamSnapshot` and `jamObservations`, over a real published generation.
 *
 * The published case goes through `publishJamAtlas` rather than a hand-written store, so digest stamping,
 * the manifest clock and the schemas are exercised exactly as a sync exercises them.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  emptyJamChannels,
  emptyJamKindFile,
  initialJamManifest,
  JAM_ATLAS_KINDS,
  type JamAtlasChannel,
  type JamAtlasEntity,
  type JamAtlasKind,
  type JamAtlasKindFile,
  type JamAtlasManifest,
  type JamChannelEntity,
} from "../../../../atlas/jam/model.js";
import { jamObservations, readJamSnapshot } from "../../../../atlas/jam/readAdapter.js";
import { jamAtlasPaths, publishJamAtlas } from "../../../../atlas/jam/store.js";
import { jamDescriptorFor } from "../../../../atlas/jam/surfaceFill.js";
import { type AtlasEntityView, type AtlasKindView, AtlasReadErrors } from "../../../../atlas/kit/read.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-10-12T00:00:00.000Z";

/** Jam's declared kinds, written out so a reordering of the constant is a visible change here. */
const EXPECTED_KINDS: readonly JamAtlasKind[] = ["integration", "operation", "page", "route", "scope"];

/**
 * A distinct success instant per kind, from the kind's place in the declared list, so a read of the wrong
 * kind's status shows as the wrong instant. No clock is read.
 */
function successAtOf({ kind }: { kind: JamAtlasKind }): string {
  return `2026-10-0${String(EXPECTED_KINDS.indexOf(kind) + 1)}T00:00:00.000Z`;
}

/** The one kind whose latest attempt failed, after it had already succeeded once. */
const FAILED_KIND: JamAtlasKind = "route";

/** When that failed attempt ran. */
const FAILED_ATTEMPT_AT = "2026-10-11T00:00:00.000Z";

/** The one kind the manifest records as permission-blocked. */
const BLOCKED_KIND: JamAtlasKind = "scope";

/** The permission boundary stamped on {@link BLOCKED_KIND}. */
const PERMISSION_BLOCK = {
  at: "2026-10-10T00:00:00.000Z",
  detail: "the workspace session may not read access scopes",
  unblockedBy: "a workspace admin role",
};

/**
 * How many entities the fixture publishes for one kind: one more than its place in the declared list, so
 * every kind's published count differs from every other kind's.
 */
function entityCountOf({ kind }: { kind: JamAtlasKind }): number {
  return EXPECTED_KINDS.indexOf(kind) + 1;
}

/** The ordinals of the entities the fixture publishes for one kind, starting at one. */
function ordinalsOf({ kind }: { kind: JamAtlasKind }): readonly number[] {
  return Array.from({ length: entityCountOf({ kind }) }, (_, index) => index + 1);
}

const homes: string[] = [];

/** A throwaway state home, so nothing here ever touches the ambient one. */
const freshHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "jam-read-"));
  homes.push(home);
  return home;
};

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

/** The endpoint a channel records for an entity of one kind. */
function endpointOf({ channel, kind }: { channel: JamAtlasChannel; kind: JamAtlasKind }): string {
  return `${channel}://${kind}`;
}

/** The detail a channel stores for an entity of one kind. */
function detailOf({ channel, kind }: { channel: JamAtlasChannel; kind: JamAtlasKind }): {
  channel: string;
  kind: string;
} {
  return { channel, kind };
}

/** One channel's stored record, with a source that names its own endpoint. */
function channelOf({
  channel,
  detail,
  endpoint,
}: {
  channel: JamAtlasChannel;
  detail: unknown;
  endpoint: string;
}): JamChannelEntity {
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
function channelNamesOf({ kind }: { kind: JamAtlasKind }): readonly JamAtlasChannel[] {
  if (kind === "operation") {
    return ["compiled", "browser"];
  }
  if (kind === "page") {
    return ["browser"];
  }
  return ["compiled"];
}

/** One stored entity of one kind, filled in only the channels that kind is observed through. */
function entityOf({ kind, ordinal }: { kind: JamAtlasKind; ordinal: number }): JamAtlasEntity {
  const channels = emptyJamChannels();
  for (const channel of channelNamesOf({ kind })) {
    channels[channel] = channelOf({
      channel,
      detail: detailOf({ channel, kind }),
      endpoint: endpointOf({ channel, kind }),
    });
  }
  return { channels, id: `id-${kind}-${String(ordinal)}`, kind, providerId: `provider-${kind}-${String(ordinal)}` };
}

/** The view an entity of one kind must project to. */
function expectedEntityView({ kind, ordinal }: { kind: JamAtlasKind; ordinal: number }): AtlasEntityView {
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
    providerId: `provider-${kind}-${String(ordinal)}`,
    scope: "jam",
  };
}

/**
 * The coverage cell one kind's file carries, its reason naming the kind, so a view that reads another
 * kind's coverage shows the wrong reason.
 */
function coverageOf({ kind }: { kind: JamAtlasKind }): JamAtlasKindFile["coverage"][number] {
  return {
    artifacts: [],
    channel: "compiled",
    lastSuccessAt: AT,
    latestAttemptFailed: false,
    reason: `the ${kind} description was compiled`,
    role: "authoritative",
    scope: kind,
    state: "synced",
    surface: "published-api",
    unblockedBy: null,
    visibilityScope: "compiled-published-documents",
  };
}

/** The gap one kind's file carries, its id and reason naming the kind for the same reason. */
function gapOf({ kind }: { kind: JamAtlasKind }): JamAtlasKindFile["gaps"][number] {
  return {
    condition: "undeclared-resource-host",
    fields: [],
    firstDetectedAt: AT,
    id: `gap-${kind}-1`,
    kind,
    lastCheckedAt: AT,
    lastDetectedAt: AT,
    reason: `a ${kind} names a host the description does not declare`,
    scope: kind,
    status: "open",
    surfaces: ["compiled"],
  };
}

/** The kind file for one kind: its entities, its own coverage cell and its own gap. */
function fileOf({ kind }: { kind: JamAtlasKind }): JamAtlasKindFile {
  const empty = emptyJamKindFile({ kind, updatedAt: AT });
  const entities = ordinalsOf({ kind }).map((ordinal) => entityOf({ kind, ordinal }));
  return { ...empty, coverage: [coverageOf({ kind })], entities, gaps: [gapOf({ kind })] };
}

/** The latest attempt the fixture records for one kind: a success at its own instant, or the one failure. */
function attemptOf({ kind }: { kind: JamAtlasKind }): { at: string; outcome: "ok" | "failed"; reasons: string[] } {
  if (kind === FAILED_KIND) {
    return { at: FAILED_ATTEMPT_AT, outcome: "failed", reasons: ["HTTP 503"] };
  }
  return { at: successAtOf({ kind }), outcome: "ok", reasons: [] };
}

/**
 * A manifest giving every kind its own history: a success at a distinct instant, one kind whose latest
 * attempt failed after succeeding, and one kind blocked by permission.
 */
function succeededManifest(): JamAtlasManifest {
  const initial = initialJamManifest({ updatedAt: AT });
  const kinds = { ...initial.kinds };
  for (const kind of JAM_ATLAS_KINDS) {
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
function publishedHome(): { home: string; manifest: JamAtlasManifest } {
  const home = freshHome();
  const manifest = succeededManifest();
  const files: Partial<Record<JamAtlasKind, JamAtlasKindFile>> = {};
  for (const kind of JAM_ATLAS_KINDS) {
    files[kind] = fileOf({ kind });
  }
  unwrap(publishJamAtlas({ derivedFrom: null, files, manifest, paths: jamAtlasPaths({ home }) }));
  return { home, manifest };
}

/** The permission block the view must carry for one kind: the fixture's one block, or none. */
function expectedPermissionBlockOf({ kind }: { kind: JamAtlasKind }): typeof PERMISSION_BLOCK | null {
  if (kind === BLOCKED_KIND) {
    return PERMISSION_BLOCK;
  }
  return null;
}

/** The whole view the adapter must give for one kind of the published fixture. */
function expectedKindView({ kind }: { kind: JamAtlasKind }): AtlasKindView {
  return {
    coverage: [
      {
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason: `the ${kind} description was compiled`,
        scope: kind,
        state: "synced",
        surface: "published-api",
        unblockedBy: null,
      },
    ],
    entities: ordinalsOf({ kind }).map((ordinal) => expectedEntityView({ kind, ordinal })),
    gaps: [
      {
        condition: "undeclared-resource-host",
        id: `gap-${kind}-1`,
        lastDetectedAt: AT,
        reason: `a ${kind} names a host the description does not declare`,
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

describe("readJamSnapshot with nothing published", () => {
  it("refuses with the exact unpublished error and Jam's own remedy", () => {
    const error = unwrapErr(readJamSnapshot({ home: freshHome() }));

    expect(error).toEqual(
      AtlasReadErrors.generationUnpublished({
        platform: "jam",
        remedy:
          "run: slopweaver atlas jam sync — it publishes the compiled tables and needs no credential and no request",
      }),
    );
  });
});

describe("readJamSnapshot over a published generation", () => {
  it("reports the generation whole: nothing missing, mismatched, superseded or unpublished", () => {
    const { home } = publishedHome();

    expect(unwrap(readJamSnapshot({ home })).generation).toEqual({
      mismatched: [],
      missing: [],
      platform: "jam",
      schemaVersion: 1,
      superseded: [],
      unpublished: [],
      updatedAt: AT,
    });
  });

  it("lists every kind in the order the atlas declares them", () => {
    const { home } = publishedHome();

    expect(unwrap(readJamSnapshot({ home })).kinds.map((kind) => kind.kind)).toEqual(EXPECTED_KINDS);
  });

  it("projects every kind to its whole view: scope, first-channel detail, ordered observations and the manifest's freshness", () => {
    const { home } = publishedHome();

    expect(unwrap(readJamSnapshot({ home })).kinds).toEqual(EXPECTED_KINDS.map((kind) => expectedKindView({ kind })));
  });

  it("gives each kind its own success instant, never another kind's", () => {
    const { home } = publishedHome();

    expect(unwrap(readJamSnapshot({ home })).kinds.map((kind) => kind.lastSuccessAt)).toEqual([
      "2026-10-01T00:00:00.000Z",
      "2026-10-02T00:00:00.000Z",
      "2026-10-03T00:00:00.000Z",
      "2026-10-04T00:00:00.000Z",
      "2026-10-05T00:00:00.000Z",
    ]);
  });

  it("flags a failed latest attempt on the failing kind alone, keeping the success it had", () => {
    const { home } = publishedHome();
    const kinds = unwrap(readJamSnapshot({ home })).kinds;

    expect(kinds.map((kind) => kind.latestAttemptFailed)).toEqual([false, false, false, true, false]);
    expect(kinds.find((kind) => kind.kind === "route")!.lastSuccessAt).toBe("2026-10-04T00:00:00.000Z");
  });

  it("carries the permission block on the blocked kind alone", () => {
    const { home } = publishedHome();

    expect(unwrap(readJamSnapshot({ home })).kinds.map((kind) => kind.permissionBlocked)).toEqual([
      null,
      null,
      null,
      null,
      {
        at: "2026-10-10T00:00:00.000Z",
        detail: "the workspace session may not read access scopes",
        unblockedBy: "a workspace admin role",
      },
    ]);
  });

  it("counts the entities each kind published, a different number for every kind", () => {
    const { home } = publishedHome();

    expect(unwrap(readJamSnapshot({ home })).kinds.map((kind) => kind.publishedCount)).toEqual([1, 2, 3, 4, 5]);
  });

  it("takes the page's detail from the browser channel, because no earlier channel holds one", () => {
    const { home } = publishedHome();
    const page = unwrap(readJamSnapshot({ home })).kinds.find((kind) => kind.kind === "page")!;

    expect(page.entities[0]!.detail).toEqual({ channel: "browser", kind: "page" });
  });

  it("derives the descriptor from this install's manifest rather than serving the static one", () => {
    const { home, manifest } = publishedHome();

    expect(unwrap(readJamSnapshot({ home })).descriptor).toEqual(jamDescriptorFor({ manifest }));
  });

  it("derives a different descriptor when the manifest records no success, so the equality above is not vacuous", () => {
    const { home } = publishedHome();
    const never = jamDescriptorFor({ manifest: initialJamManifest({ updatedAt: AT }) });

    expect(unwrap(readJamSnapshot({ home })).descriptor).not.toEqual(never);
  });
});

describe("readJamSnapshot over an unreadable store", () => {
  it("refuses rather than treating a corrupt manifest as an empty atlas", () => {
    const home = freshHome();
    const paths = jamAtlasPaths({ home });
    mkdirSync(dirname(paths.manifest), { recursive: true });
    writeFileSync(paths.manifest, "{ this is not json");

    expect(unwrapErr(readJamSnapshot({ home }))).toEqual(
      AtlasReadErrors.storeUnreadable({
        platform: "jam",
        reasons: [
          `${paths.manifest} is not valid JSON`,
          "refusing rather than treating a corrupt atlas as an empty one",
        ],
      }),
    );
  });
});

describe("jamObservations", () => {
  const observation = ({ channel }: { channel: JamAtlasChannel }) => ({
    artifacts: [],
    deepLink: null,
    deepLinkStatus: "unavailable",
    endpoint: `${channel}://operation`,
    observedAt: AT,
    state: "observed",
    surface: channel,
  });

  const record = ({ channel }: { channel: JamAtlasChannel }): JamChannelEntity =>
    channelOf({ channel, detail: null, endpoint: `${channel}://operation` });

  it("emits every populated channel in declared order, whatever order the record was assembled in", () => {
    const entity: JamAtlasEntity = {
      channels: {
        browser: record({ channel: "browser" }),
        api: record({ channel: "api" }),
        compiled: record({ channel: "compiled" }),
      },
      id: "id-operation",
      kind: "operation",
      providerId: "provider-operation",
    };

    expect(jamObservations({ entity })).toEqual([
      observation({ channel: "compiled" }),
      observation({ channel: "api" }),
      observation({ channel: "browser" }),
    ]);
  });

  it("emits only the channels that have looked, skipping a channel that never did", () => {
    const entity: JamAtlasEntity = {
      channels: { api: null, browser: record({ channel: "browser" }), compiled: record({ channel: "compiled" }) },
      id: "id-operation",
      kind: "operation",
      providerId: "provider-operation",
    };

    expect(jamObservations({ entity })).toEqual([
      observation({ channel: "compiled" }),
      observation({ channel: "browser" }),
    ]);
  });

  it("emits nothing for an entity no channel has looked at", () => {
    const entity: JamAtlasEntity = {
      channels: emptyJamChannels(),
      id: "id-operation",
      kind: "operation",
      providerId: "provider-operation",
    };

    expect(jamObservations({ entity })).toEqual([]);
  });

  it("still yields an observation for a channel whose source is missing, falling back to the channel and its last sighting", () => {
    const sourceless: JamChannelEntity = { ...record({ channel: "api" }), source: null };
    const entity: JamAtlasEntity = {
      channels: { api: sourceless, browser: null, compiled: null },
      id: "id-operation",
      kind: "operation",
      providerId: "provider-operation",
    };

    expect(jamObservations({ entity })).toEqual([
      {
        artifacts: [],
        deepLink: null,
        deepLinkStatus: "unverified",
        endpoint: "api",
        observedAt: AT,
        state: "observed",
        surface: "api",
      },
    ]);
  });
});
