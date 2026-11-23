/**
 * `readClerkSnapshot` and `clerkObservations`, over a real published generation.
 *
 * The published case goes through `publishClerkAtlas` rather than a hand-written store, so digest stamping,
 * the manifest clock and the schemas are exercised exactly as a sync exercises them.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CLERK_ATLAS_KINDS,
  type ClerkArtifactRef,
  type ClerkAtlasEntity,
  type ClerkAtlasKind,
  type ClerkAtlasKindFile,
  type ClerkAtlasManifest,
  type ClerkChannel,
  type ClerkChannelEntity,
  emptyClerkKindFile,
  initialClerkManifest,
} from "../../../../atlas/clerk/model.js";
import { clerkObservations, readClerkSnapshot } from "../../../../atlas/clerk/readAdapter.js";
import { clerkAtlasPaths, publishClerkAtlas } from "../../../../atlas/clerk/store.js";
import { clerkDescriptorFor } from "../../../../atlas/clerk/surfaceFill.js";
import { type AtlasEntityView, type AtlasKindView, AtlasReadErrors } from "../../../../atlas/kit/read.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-10-12T00:00:00.000Z";

/** Clerk's declared kinds, written out so a reordering of the constant is a visible change here. */
const EXPECTED_KINDS: readonly ClerkAtlasKind[] = ["operation", "page", "webhook-event"];

/**
 * A distinct success instant per kind, from the kind's place in the declared list, so a read of the wrong
 * kind's status shows as the wrong instant. No clock is read.
 */
function successAtOf({ kind }: { kind: ClerkAtlasKind }): string {
  return `2026-10-0${String(EXPECTED_KINDS.indexOf(kind) + 1)}T00:00:00.000Z`;
}

/** The one kind whose latest attempt failed, after it had already succeeded once. */
const FAILED_KIND: ClerkAtlasKind = "page";

/** When that failed attempt ran. */
const FAILED_ATTEMPT_AT = "2026-10-11T00:00:00.000Z";

/** The one kind the manifest records as permission-blocked. */
const BLOCKED_KIND: ClerkAtlasKind = "webhook-event";

/** The permission boundary stamped on {@link BLOCKED_KIND}. */
const PERMISSION_BLOCK = {
  at: "2026-10-10T00:00:00.000Z",
  detail: "the dashboard session may not read webhook deliveries",
  unblockedBy: "an organisation admin role on the dashboard",
};

/**
 * How many entities the fixture publishes for one kind: one more than its place in the declared list, so
 * every kind's published count differs from every other kind's.
 */
function entityCountOf({ kind }: { kind: ClerkAtlasKind }): number {
  return EXPECTED_KINDS.indexOf(kind) + 1;
}

/** The ordinals of the entities the fixture publishes for one kind, starting at one. */
function ordinalsOf({ kind }: { kind: ClerkAtlasKind }): readonly number[] {
  return Array.from({ length: entityCountOf({ kind }) }, (_, index) => index + 1);
}

/** The proof screenshot a photographed dashboard page carries. */
const SHOT: ClerkArtifactRef = {
  byteLength: 1,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "artifacts/pages/x.png",
  sha256: "a".repeat(64),
};

const homes: string[] = [];

/** A throwaway state home, so nothing here ever touches the ambient one. */
const freshHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "clerk-read-"));
  homes.push(home);
  return home;
};

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

/** The endpoint a channel records for an entity of one kind. */
function endpointOf({ channel, kind }: { channel: ClerkChannel; kind: ClerkAtlasKind }): string {
  return `${channel}://${kind}`;
}

/** The detail a channel stores for an entity of one kind. */
function detailOf({ channel, kind }: { channel: ClerkChannel; kind: ClerkAtlasKind }): {
  channel: string;
  kind: string;
} {
  return { channel, kind };
}

/** The artifacts a channel's source keeps: only the dashboard page is photographed. */
function artifactsOf({ channel, kind }: { channel: ClerkChannel; kind: ClerkAtlasKind }): readonly ClerkArtifactRef[] {
  if (kind === "page" && channel === "browser") {
    return [SHOT];
  }
  return [];
}

/** One channel's stored record, with a source that names its own endpoint. */
function channelOf({
  artifacts,
  channel,
  detail,
  endpoint,
}: {
  artifacts: readonly ClerkArtifactRef[];
  channel: ClerkChannel;
  detail: unknown;
  endpoint: string;
}): ClerkChannelEntity {
  return {
    channel,
    detail,
    firstSeenAt: AT,
    lastSeenAt: AT,
    source: {
      artifacts: [...artifacts],
      channel,
      deepLink: null,
      deepLinkStatus: "unavailable",
      endpoint,
      observedAt: AT,
    },
    state: "observed",
  };
}

/** Which channels have looked at an entity of this kind, in declared channel order. */
function channelNamesOf({ kind }: { kind: ClerkAtlasKind }): readonly ClerkChannel[] {
  if (kind === "operation") {
    return ["compiled", "browser"];
  }
  if (kind === "page") {
    return ["browser"];
  }
  return ["compiled"];
}

/** One stored entity of one kind, filled in only the channels that kind is observed through. */
function entityOf({ kind, ordinal }: { kind: ClerkAtlasKind; ordinal: number }): ClerkAtlasEntity {
  const channels: ClerkAtlasEntity["channels"] = { api: null, browser: null, compiled: null };
  for (const channel of channelNamesOf({ kind })) {
    channels[channel] = channelOf({
      artifacts: artifactsOf({ channel, kind }),
      channel,
      detail: detailOf({ channel, kind }),
      endpoint: endpointOf({ channel, kind }),
    });
  }
  return { channels, id: `id-${kind}-${String(ordinal)}`, kind, providerId: `provider-${kind}-${String(ordinal)}` };
}

/** The view an entity of one kind must project to. */
function expectedEntityView({ kind, ordinal }: { kind: ClerkAtlasKind; ordinal: number }): AtlasEntityView {
  const names = channelNamesOf({ kind });
  return {
    detail: detailOf({ channel: names[0]!, kind }),
    id: `id-${kind}-${String(ordinal)}`,
    kind,
    observations: names.map((channel) => ({
      artifacts: artifactsOf({ channel, kind }),
      deepLink: null,
      deepLinkStatus: "unavailable",
      endpoint: endpointOf({ channel, kind }),
      observedAt: AT,
      state: "observed",
      surface: channel,
    })),
    providerId: `provider-${kind}-${String(ordinal)}`,
    scope: "clerk",
  };
}

/**
 * The coverage cell one kind's file carries, its reason naming the kind, so a view that reads another
 * kind's coverage shows the wrong reason.
 */
function coverageOf({ kind }: { kind: ClerkAtlasKind }): ClerkAtlasKindFile["coverage"][number] {
  return {
    artifacts: [],
    channel: "compiled",
    lastSuccessAt: AT,
    latestAttemptFailed: false,
    reason: `the ${kind} documents were compiled`,
    role: "authoritative",
    scope: kind,
    state: "synced",
    surface: "published-api",
    unblockedBy: null,
    visibilityScope: "compiled-published-specifications",
  };
}

/** The gap one kind's file carries, its id and reason naming the kind for the same reason. */
function gapOf({ kind }: { kind: ClerkAtlasKind }): ClerkAtlasKindFile["gaps"][number] {
  return {
    condition: "operation-never-seen-by-the-dashboard",
    fields: [],
    firstDetectedAt: AT,
    id: `gap-${kind}-1`,
    kind,
    lastCheckedAt: AT,
    lastDetectedAt: AT,
    reason: `no dashboard page called this ${kind}`,
    scope: kind,
    status: "open",
    surfaces: ["compiled"],
  };
}

/** The kind file for one kind: its entities, its own coverage cell and its own gap. */
function fileOf({ kind }: { kind: ClerkAtlasKind }): ClerkAtlasKindFile {
  const empty = emptyClerkKindFile({ kind, updatedAt: AT });
  const entities = ordinalsOf({ kind }).map((ordinal) => entityOf({ kind, ordinal }));
  return { ...empty, coverage: [coverageOf({ kind })], entities, gaps: [gapOf({ kind })] };
}

/** The kind files of the published fixture, keyed by kind. */
function publishedFiles(): Partial<Record<ClerkAtlasKind, ClerkAtlasKindFile>> {
  const files: Partial<Record<ClerkAtlasKind, ClerkAtlasKindFile>> = {};
  for (const kind of CLERK_ATLAS_KINDS) {
    files[kind] = fileOf({ kind });
  }
  return files;
}

/** The latest attempt the fixture records for one kind: a success at its own instant, or the one failure. */
function attemptOf({ kind }: { kind: ClerkAtlasKind }): { at: string; outcome: "ok" | "failed"; reasons: string[] } {
  if (kind === FAILED_KIND) {
    return { at: FAILED_ATTEMPT_AT, outcome: "failed", reasons: ["the dashboard walk lost its session"] };
  }
  return { at: successAtOf({ kind }), outcome: "ok", reasons: [] };
}

/**
 * A manifest giving every kind its own history: a success at a distinct instant, one kind whose latest
 * attempt failed after succeeding, and one kind blocked by permission.
 */
function succeededManifest(): ClerkAtlasManifest {
  const initial = initialClerkManifest({ updatedAt: AT });
  const kinds = { ...initial.kinds };
  for (const kind of CLERK_ATLAS_KINDS) {
    kinds[kind] = {
      ...initial.kinds[kind],
      lastAttempt: attemptOf({ kind }),
      lastSuccessAt: successAtOf({ kind }),
    };
  }
  kinds[BLOCKED_KIND] = { ...kinds[BLOCKED_KIND], permissionBlocked: PERMISSION_BLOCK };
  return { ...initial, kinds };
}

/** Publish one entity per kind into a fresh home through the atlas's own publisher. */
function publishedHome(): string {
  const home = freshHome();
  unwrap(
    publishClerkAtlas({
      derivedFrom: null,
      files: publishedFiles(),
      manifest: succeededManifest(),
      paths: clerkAtlasPaths({ home }),
    }),
  );
  return home;
}

/** The permission block the view must carry for one kind: the fixture's one block, or none. */
function expectedPermissionBlockOf({ kind }: { kind: ClerkAtlasKind }): typeof PERMISSION_BLOCK | null {
  if (kind === BLOCKED_KIND) {
    return PERMISSION_BLOCK;
  }
  return null;
}

/** The whole view the adapter must give for one kind of the published fixture. */
function expectedKindView({ kind }: { kind: ClerkAtlasKind }): AtlasKindView {
  return {
    coverage: [
      {
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason: `the ${kind} documents were compiled`,
        scope: kind,
        state: "synced",
        surface: "published-api",
        unblockedBy: null,
      },
    ],
    entities: ordinalsOf({ kind }).map((ordinal) => expectedEntityView({ kind, ordinal })),
    gaps: [
      {
        condition: "operation-never-seen-by-the-dashboard",
        id: `gap-${kind}-1`,
        lastDetectedAt: AT,
        reason: `no dashboard page called this ${kind}`,
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

describe("readClerkSnapshot with nothing published", () => {
  it("refuses with the exact unpublished error and Clerk's own remedy", () => {
    const error = unwrapErr(readClerkSnapshot({ home: freshHome() }));

    expect(error).toEqual(
      AtlasReadErrors.generationUnpublished({
        platform: "clerk",
        remedy:
          "run: slopweaver atlas clerk sync — it compiles the four pinned Clerk documents and needs no credential; then slopweaver atlas clerk walk fills the dashboard surface in your own Chrome",
      }),
    );
  });
});

describe("readClerkSnapshot over a published generation", () => {
  it("reports the generation whole: nothing missing, mismatched, superseded or unpublished", () => {
    const home = publishedHome();

    expect(unwrap(readClerkSnapshot({ home })).generation).toEqual({
      mismatched: [],
      missing: [],
      platform: "clerk",
      schemaVersion: 1,
      superseded: [],
      unpublished: [],
      updatedAt: AT,
    });
  });

  it("lists every kind in the order the atlas declares them", () => {
    const home = publishedHome();

    expect(unwrap(readClerkSnapshot({ home })).kinds.map((kind) => kind.kind)).toEqual(EXPECTED_KINDS);
  });

  it("projects every kind to its whole view: scope, first-channel detail, ordered observations and the manifest's freshness", () => {
    const home = publishedHome();

    expect(unwrap(readClerkSnapshot({ home })).kinds).toEqual(EXPECTED_KINDS.map((kind) => expectedKindView({ kind })));
  });

  it("gives each kind its own success instant, never another kind's", () => {
    const home = publishedHome();

    expect(unwrap(readClerkSnapshot({ home })).kinds.map((kind) => kind.lastSuccessAt)).toEqual([
      "2026-10-01T00:00:00.000Z",
      "2026-10-02T00:00:00.000Z",
      "2026-10-03T00:00:00.000Z",
    ]);
  });

  it("flags a failed latest attempt on the failing kind alone, keeping the success it had", () => {
    const home = publishedHome();
    const kinds = unwrap(readClerkSnapshot({ home })).kinds;

    expect(kinds.map((kind) => kind.latestAttemptFailed)).toEqual([false, true, false]);
    expect(kinds.find((kind) => kind.kind === "page")!.lastSuccessAt).toBe("2026-10-02T00:00:00.000Z");
  });

  it("carries the permission block on the blocked kind alone", () => {
    const home = publishedHome();

    expect(unwrap(readClerkSnapshot({ home })).kinds.map((kind) => kind.permissionBlocked)).toEqual([
      null,
      null,
      {
        at: "2026-10-10T00:00:00.000Z",
        detail: "the dashboard session may not read webhook deliveries",
        unblockedBy: "an organisation admin role on the dashboard",
      },
    ]);
  });

  it("counts the entities each kind published, a different number for every kind", () => {
    const home = publishedHome();

    expect(unwrap(readClerkSnapshot({ home })).kinds.map((kind) => kind.publishedCount)).toEqual([1, 2, 3]);
  });

  it("keeps the proof screenshot on the page's browser observation", () => {
    const home = publishedHome();
    const page = unwrap(readClerkSnapshot({ home })).kinds.find((kind) => kind.kind === "page")!;

    expect(page.entities[0]!.observations.map((observation) => observation.artifacts)).toEqual([[SHOT]]);
  });

  it("derives the descriptor from the rows this install holds rather than serving the static one", () => {
    const home = publishedHome();

    expect(unwrap(readClerkSnapshot({ home })).descriptor).toEqual(clerkDescriptorFor({ files: publishedFiles() }));
  });

  it("derives a different descriptor when no row backs a surface, so the equality above is not vacuous", () => {
    const home = publishedHome();

    expect(unwrap(readClerkSnapshot({ home })).descriptor).not.toEqual(clerkDescriptorFor({ files: {} }));
  });
});

describe("readClerkSnapshot over an unreadable store", () => {
  it("refuses rather than treating a corrupt manifest as an empty atlas", () => {
    const home = freshHome();
    const paths = clerkAtlasPaths({ home });
    mkdirSync(dirname(paths.manifest), { recursive: true });
    writeFileSync(paths.manifest, "{ this is not json");

    expect(unwrapErr(readClerkSnapshot({ home }))).toEqual(
      AtlasReadErrors.storeUnreadable({
        platform: "clerk",
        reasons: [
          `${paths.manifest} is not valid JSON`,
          "refusing rather than treating a corrupt atlas as an empty one",
        ],
      }),
    );
  });
});

describe("clerkObservations", () => {
  const observation = ({ channel }: { channel: ClerkChannel }) => ({
    artifacts: [],
    deepLink: null,
    deepLinkStatus: "unavailable",
    endpoint: `${channel}://operation`,
    observedAt: AT,
    state: "observed",
    surface: channel,
  });

  const record = ({ channel }: { channel: ClerkChannel }): ClerkChannelEntity =>
    channelOf({ artifacts: [], channel, detail: null, endpoint: `${channel}://operation` });

  it("emits every populated channel in declared order, whatever order the record was assembled in", () => {
    const entity: ClerkAtlasEntity = {
      channels: {
        browser: record({ channel: "browser" }),
        api: record({ channel: "api" }),
        compiled: record({ channel: "compiled" }),
      },
      id: "id-operation",
      kind: "operation",
      providerId: "provider-operation",
    };

    expect(clerkObservations({ entity })).toEqual([
      observation({ channel: "compiled" }),
      observation({ channel: "api" }),
      observation({ channel: "browser" }),
    ]);
  });

  it("emits only the channels that have looked, skipping a channel that never did", () => {
    const entity: ClerkAtlasEntity = {
      channels: { api: null, browser: record({ channel: "browser" }), compiled: record({ channel: "compiled" }) },
      id: "id-operation",
      kind: "operation",
      providerId: "provider-operation",
    };

    expect(clerkObservations({ entity })).toEqual([
      observation({ channel: "compiled" }),
      observation({ channel: "browser" }),
    ]);
  });

  it("emits nothing for an entity no channel has looked at", () => {
    const entity: ClerkAtlasEntity = {
      channels: { api: null, browser: null, compiled: null },
      id: "id-operation",
      kind: "operation",
      providerId: "provider-operation",
    };

    expect(clerkObservations({ entity })).toEqual([]);
  });

  it("still yields an observation for a channel whose source is missing, falling back to the channel and its last sighting", () => {
    const sourceless: ClerkChannelEntity = { ...record({ channel: "api" }), source: null };
    const entity: ClerkAtlasEntity = {
      channels: { api: sourceless, browser: null, compiled: null },
      id: "id-operation",
      kind: "operation",
      providerId: "provider-operation",
    };

    expect(clerkObservations({ entity })).toEqual([
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
