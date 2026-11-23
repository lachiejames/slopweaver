/**
 * The store, the reset, and the surface-fill rule that decides what this install's descriptor may claim.
 *
 * `clerkSurfaceFill` is the one worth the most here: both fillable surfaces are graded on a CHANNEL of a
 * stored row rather than on a manifest timestamp, because the walk writes the `operation` kind too — so a
 * timestamp rule would report the published-API surface filled after a run that compiled nothing.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CLERK_ATLAS_KINDS,
  type ClerkAtlasEntity,
  type ClerkAtlasKindFile,
  type ClerkChannelEntity,
  emptyClerkKindFile,
  initialClerkManifest,
} from "../../../../atlas/clerk/model.js";
import { resetClerkAtlas } from "../../../../atlas/clerk/reset.js";
import {
  clerkAtlasPaths,
  publishClerkAtlas,
  readClerkAtlas,
  readClerkManifest,
} from "../../../../atlas/clerk/store.js";
import { clerkDescriptorFor, clerkSurfaceFill } from "../../../../atlas/clerk/surfaceFill.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-05T11:00:00.000Z";

const homes: string[] = [];

/** A throwaway state home, removed in `afterEach` so a long-lived dev machine does not accumulate them. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-clerk-store-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** One entity carrying whichever channels a case needs. */
function entity({
  providerId,
  kind,
  compiled,
  browser,
  artifacts = 0,
}: {
  providerId: string;
  kind: ClerkAtlasEntity["kind"];
  compiled: boolean;
  browser: boolean;
  artifacts?: number;
}): ClerkAtlasEntity {
  const shot = {
    byteLength: 1,
    kind: "page-png" as const,
    mediaType: "image/png",
    relativePath: "artifacts/pages/x.png",
    sha256: "a".repeat(64),
  };
  const channel = ({ name }: { name: "compiled" | "browser" }): ClerkChannelEntity => ({
    channel: name,
    detail: null,
    firstSeenAt: AT,
    lastSeenAt: AT,
    source: {
      artifacts: Array.from({ length: artifacts }, () => shot),
      channel: name,
      deepLink: null,
      deepLinkStatus: "unavailable",
      endpoint: providerId,
      observedAt: AT,
    },
    state: "observed",
  });
  return {
    channels: {
      api: null,
      browser: browser ? { ...channel({ name: "browser" }), channel: "browser" } : null,
      compiled: compiled ? channel({ name: "compiled" }) : null,
    },
    id: providerId,
    kind,
    providerId,
  };
}

/** Publish an empty generation, which is what a reset needs to have something to archive. */
function seedGeneration({ paths }: { paths: ReturnType<typeof clerkAtlasPaths> }): void {
  unwrap(
    publishClerkAtlas({
      derivedFrom: null,
      files: Object.fromEntries(CLERK_ATLAS_KINDS.map((kind) => [kind, emptyClerkKindFile({ kind, updatedAt: AT })])),
      manifest: initialClerkManifest({ updatedAt: AT }),
      paths,
    }),
  );
}

/** One kind file holding the entities a case needs. */
function fileWith({
  kind,
  entities,
}: {
  kind: ClerkAtlasEntity["kind"];
  entities: readonly ClerkAtlasEntity[];
}): ClerkAtlasKindFile {
  return { ...emptyClerkKindFile({ kind, updatedAt: AT }), entities: [...entities] };
}

describe("publishClerkAtlas then readClerkAtlas", () => {
  it("round-trips a generation through the strict schemas", () => {
    const paths = clerkAtlasPaths({ home: scratchHome() });
    unwrap(
      publishClerkAtlas({
        derivedFrom: null,
        files: {
          operation: fileWith({
            entities: [entity({ browser: false, compiled: true, kind: "operation", providerId: "GET bapi:/v1/users" })],
            kind: "operation",
          }),
        },
        manifest: initialClerkManifest({ updatedAt: AT }),
        paths,
      }),
    );
    const snapshot = unwrap(readClerkAtlas({ paths }));
    expect(snapshot.files.operation?.entities.length).toBe(1);
    expect(snapshot.manifest?.platform).toBe("clerk");
  });

  it("leaves a kind it was not handed exactly as it was, which is what keeps two writers apart", () => {
    const paths = clerkAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });
    unwrap(
      publishClerkAtlas({
        derivedFrom: unwrap(readClerkManifest({ paths })),
        files: {
          page: fileWith({
            entities: [entity({ browser: true, compiled: false, kind: "page", providerId: "instance-domains" })],
            kind: "page",
          }),
        },
        manifest: initialClerkManifest({ updatedAt: AT }),
        paths,
      }),
    );
    const snapshot = unwrap(readClerkAtlas({ paths }));
    expect(snapshot.files.page?.entities.length).toBe(1);
    expect(snapshot.files.operation?.entities).toEqual([]);
  });
});

describe("resetClerkAtlas", () => {
  it("has at least one entry in CLERK_ATLAS_KINDS, so the guards below are not vacuously green", () => {
    expect(CLERK_ATLAS_KINDS.length).toBeGreaterThan(0);
  });

  it("installs an empty file for every declared kind, so the generation is complete rather than partial", () => {
    const paths = clerkAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });
    unwrap(resetClerkAtlas({ at: AT, paths }));
    const snapshot = unwrap(readClerkAtlas({ paths }));
    expect(CLERK_ATLAS_KINDS.filter((kind) => snapshot.files[kind] === null)).toEqual([]);
  });

  it("archives rather than deletes, naming where the prior generation went", () => {
    const paths = clerkAtlasPaths({ home: scratchHome() });
    seedGeneration({ paths });
    const outcome = unwrap(resetClerkAtlas({ at: "2026-09-05T12:00:00.000Z", paths }));
    expect(outcome.archivedTo.length).toBeGreaterThan(0);
  });

  it("refuses when there is no generation to archive, rather than reporting an empty success", () => {
    const paths = clerkAtlasPaths({ home: scratchHome() });
    const reset = resetClerkAtlas({ at: AT, paths });
    expect(unwrapErr(reset)).toEqual([`no current clerk atlas at ${paths.directory} — nothing to reset`]);
  });
});

describe("clerkSurfaceFill", () => {
  it("does not fill the published-API surface from operations alone, without the webhook catalogue", () => {
    const fill = clerkSurfaceFill({
      files: {
        operation: fileWith({
          entities: [entity({ browser: false, compiled: true, kind: "operation", providerId: "a" })],
          kind: "operation",
        }),
      },
    });
    expect(fill.specFilled).toBe(false);
  });

  it("fills the published-API surface once both compiled kinds carry rows", () => {
    const fill = clerkSurfaceFill({
      files: {
        operation: fileWith({
          entities: [entity({ browser: false, compiled: true, kind: "operation", providerId: "a" })],
          kind: "operation",
        }),
        "webhook-event": fileWith({
          entities: [entity({ browser: false, compiled: true, kind: "webhook-event", providerId: "user.created" })],
          kind: "webhook-event",
        }),
      },
    });
    expect(fill.specFilled).toBe(true);
  });

  it("does NOT fill the published-API surface from a walk's own browser rows on the shared kind", () => {
    const fill = clerkSurfaceFill({
      files: {
        operation: fileWith({
          entities: [entity({ browser: true, compiled: false, kind: "operation", providerId: "a" })],
          kind: "operation",
        }),
      },
    });
    expect(fill.specFilled).toBe(false);
    expect(fill.observedOperations).toBe(1);
  });

  it("does not count a page row whose browser channel carries no source as photographed", () => {
    const held = entity({ artifacts: 1, browser: true, compiled: false, kind: "page", providerId: "instance-domains" });
    const sourceless: ClerkAtlasEntity = {
      ...held,
      channels: { ...held.channels, browser: { ...held.channels.browser!, source: null } },
    };
    const fill = clerkSurfaceFill({ files: { page: fileWith({ entities: [sourceless], kind: "page" }) } });
    expect(fill.dashboardFilled).toBe(false);
    expect(fill.photographedPages).toBe(0);
  });

  it("does not fill the dashboard surface from a page row carrying no screenshot", () => {
    const fill = clerkSurfaceFill({
      files: {
        page: fileWith({
          entities: [
            entity({ artifacts: 0, browser: true, compiled: false, kind: "page", providerId: "instance-domains" }),
          ],
          kind: "page",
        }),
      },
    });
    expect(fill.dashboardFilled).toBe(false);
    expect(fill.photographedPages).toBe(0);
  });

  it("fills the dashboard surface once a page carries a screenshot", () => {
    const fill = clerkSurfaceFill({
      files: {
        page: fileWith({
          entities: [
            entity({ artifacts: 1, browser: true, compiled: false, kind: "page", providerId: "instance-domains" }),
          ],
          kind: "page",
        }),
      },
    });
    expect(fill.dashboardFilled).toBe(true);
    expect(fill.photographedPages).toBe(1);
  });
});

describe("clerkDescriptorFor", () => {
  it("reports both fillable surfaces unfilled on an install where nothing has run", () => {
    const descriptor = clerkDescriptorFor({ files: {} });
    expect(descriptor.surfaces.filter((surface) => surface.status === "filled")).toEqual([]);
  });

  it("flips only the surface the store actually evidences", () => {
    const descriptor = clerkDescriptorFor({
      files: {
        operation: fileWith({
          entities: [entity({ browser: false, compiled: true, kind: "operation", providerId: "a" })],
          kind: "operation",
        }),
        "webhook-event": fileWith({
          entities: [entity({ browser: false, compiled: true, kind: "webhook-event", providerId: "user.created" })],
          kind: "webhook-event",
        }),
      },
    });
    expect(descriptor.surfaces.filter((surface) => surface.status === "filled").map((surface) => surface.name)).toEqual(
      ["published-api"],
    );
  });

  it("never flips the live API surface, which no code path here can evidence", () => {
    const descriptor = clerkDescriptorFor({
      files: {
        operation: fileWith({
          entities: [entity({ browser: true, compiled: true, kind: "operation", providerId: "a" })],
          kind: "operation",
        }),
        page: fileWith({
          entities: [entity({ artifacts: 1, browser: true, compiled: false, kind: "page", providerId: "p" })],
          kind: "page",
        }),
        "webhook-event": fileWith({
          entities: [entity({ browser: false, compiled: true, kind: "webhook-event", providerId: "user.created" })],
          kind: "webhook-event",
        }),
      },
    });
    expect(descriptor.surfaces.find((surface) => surface.name === "instance-api")?.status).toBe("declared-unfilled");
  });
});
