import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { HEX_PROBE_CENSUS } from "../../../../atlas/hex/apiProbe.js";
import { HEX_CLIENT_SURFACE } from "../../../../atlas/hex/generated/clientSurface.js";
import { HEX_ATLAS_KINDS, HEX_ENTITY_UNBLOCKED_BY } from "../../../../atlas/hex/model.js";
import { readHexSnapshot } from "../../../../atlas/hex/readAdapter.js";
import { resetHexAtlas } from "../../../../atlas/hex/reset.js";
import { hexAtlasPaths, readHexAtlas } from "../../../../atlas/hex/store.js";
import { hexDescriptorFor } from "../../../../atlas/hex/surfaceFill.js";
import { HEX_WEB_APP_SURFACE } from "../../../../atlas/hex/sync.js";
import { syncHexApiSurface } from "../../../../atlas/hex/syncPublish.js";
import { unwrap } from "../../../../lib/result.js";

import { fixtureTransport } from "./fixture.js";

const AT = "2026-09-07T02:00:00.000Z";
const LATER = "2026-09-08T02:00:00.000Z";

const homes: string[] = [];

/** A throwaway state home. Every write in this file is scoped to one, per `.claude/rules/testing.md`. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-hex-sync-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

describe("publishing the Hex api surface", () => {
  it("publishes one row per operation from all three evidence bodies", async () => {
    const outcome = unwrap(
      await syncHexApiSurface({ at: AT, paths: hexAtlasPaths({ home: scratchHome() }), transport: fixtureTransport }),
    );

    expect(outcome.operationCount).toBe(5);
    expect(outcome.mountedNouns).toBe(HEX_PROBE_CENSUS.filter((row) => row.evidence === "mounted-401").length);
    expect(outcome.graphqlCount).toBe(HEX_CLIENT_SURFACE.graphqlOperations.length);
    expect(outcome.methodCount).toBe(5 + outcome.mountedNouns + outcome.graphqlCount);
    expect(outcome.apiCount).toBe(3);
  });

  it("counts the withheld and shape-indexed operations rather than leaving a reader to grep", async () => {
    const outcome = unwrap(
      await syncHexApiSurface({ at: AT, paths: hexAtlasPaths({ home: scratchHome() }), transport: fixtureTransport }),
    );

    expect(outcome.withheldCount).toBe(3);
    expect(outcome.shapeIndexedCount).toBe(1);
  });

  it("writes a file for every kind, so a fresh generation is complete rather than partial", async () => {
    const paths = hexAtlasPaths({ home: scratchHome() });

    unwrap(await syncHexApiSurface({ at: AT, paths, transport: fixtureTransport }));
    const snapshot = unwrap(readHexAtlas({ paths }));

    expect(snapshot.missing).toEqual([]);
    expect(snapshot.mismatched).toEqual([]);
    expect(Object.keys(snapshot.files).toSorted()).toEqual([...HEX_ATLAS_KINDS].toSorted());
  });

  // A kind with no file reads as a kind that does not exist. A `not-configured` cell is the atlas saying,
  // about itself, that it is supposed to hold this and does not.
  it("gives the two entity kinds a not-configured cell naming exactly what would fill them", async () => {
    const paths = hexAtlasPaths({ home: scratchHome() });

    unwrap(await syncHexApiSurface({ at: AT, paths, transport: fixtureTransport }));
    const snapshot = unwrap(readHexAtlas({ paths }));
    const cell = snapshot.files.project!.coverage.find((held) => held.surface === "workspace-api")!;

    expect(cell.state).toBe("not-configured");
    expect(cell.unblockedBy).toBe(HEX_ENTITY_UNBLOCKED_BY);
    expect(cell.reason).toContain("would still hold no result set");
  });

  it("gives the page kind a deferred cell before any walk has run", async () => {
    const paths = hexAtlasPaths({ home: scratchHome() });

    unwrap(await syncHexApiSurface({ at: AT, paths, transport: fixtureTransport }));
    const snapshot = unwrap(readHexAtlas({ paths }));
    const cell = snapshot.files.page!.coverage.find((held) => held.surface === HEX_WEB_APP_SURFACE)!;

    expect(cell.state).toBe("deferred");
    expect(snapshot.manifest!.kinds.page.lastSuccessAt).toBe(null);
  });

  // The withholding is not a shortfall, so its gap is permanently open. An atlas whose gap list went quiet
  // about a body it can name and will never hold would leave the reader to infer the policy from silence.
  it("raises a standing gap about its own withholding, and re-raises it on every sync", async () => {
    const paths = hexAtlasPaths({ home: scratchHome() });

    unwrap(await syncHexApiSurface({ at: AT, paths, transport: fixtureTransport }));
    unwrap(await syncHexApiSurface({ at: LATER, paths, transport: fixtureTransport }));
    const snapshot = unwrap(readHexAtlas({ paths }));
    const raised = snapshot.files.method!.gaps.filter((gap) => gap.condition === "result-data-withheld");

    expect(raised.length).toBe(1);
    expect(raised[0]!.reason).toContain("3 operation(s) are mapped in full and never called for their body");
  });

  it("records a moved document as a gap and compiles it anyway", async () => {
    const paths = hexAtlasPaths({ home: scratchHome() });

    const outcome = unwrap(await syncHexApiSurface({ at: AT, paths, transport: fixtureTransport }));
    const snapshot = unwrap(readHexAtlas({ paths }));

    expect(outcome.specsDrifted).toEqual(["hex-public-api"]);
    expect(outcome.specsCompiled).toBe(1);
    expect(snapshot.files.method!.gaps.some((gap) => gap.condition === "spec-moved")).toBe(true);
  });

  it("reads back through the registry's own adapter", async () => {
    const home = scratchHome();

    unwrap(await syncHexApiSurface({ at: AT, paths: hexAtlasPaths({ home }), transport: fixtureTransport }));
    const view = unwrap(readHexSnapshot({ home }));

    expect(view.generation.platform).toBe("hex");
    expect(view.kinds.find((kind) => kind.kind === "method")!.publishedCount).toBeGreaterThan(0);
  });
});

describe("deriving the descriptor from this install's own store", () => {
  it("says declared-unfilled on a store nothing has been published to", () => {
    const descriptor = hexDescriptorFor({ manifest: null });

    expect(descriptor.surfaces.every((surface) => surface.status === "declared-unfilled")).toBe(true);
  });

  // A surface is filled by evidence actually published, never by a literal in source.
  it("flips the three compiled surfaces once both compiled kinds carry a success, and no others", async () => {
    const paths = hexAtlasPaths({ home: scratchHome() });

    unwrap(await syncHexApiSurface({ at: AT, paths, transport: fixtureTransport }));
    const descriptor = hexDescriptorFor({ manifest: unwrap(readHexAtlas({ paths })).manifest });

    expect(descriptor.surfaces.filter((surface) => surface.status === "filled").map((surface) => surface.name)).toEqual(
      ["spec-declared", "unauthenticated-probe", "client-bundle"],
    );
    expect(descriptor.surfaces.find((surface) => surface.name === "web-app")!.status).toBe("declared-unfilled");
    expect(descriptor.surfaces.find((surface) => surface.name === "workspace-api")!.status).toBe("declared-unfilled");
  });

  it("declares refuse-every-write, because Hex is in no write register", () => {
    expect(hexDescriptorFor({ manifest: null }).writePolicy).toBe("refuse-every-write");
  });
});

describe("resetting the atlas", () => {
  it("archives the generation and installs a complete empty one", async () => {
    const paths = hexAtlasPaths({ home: scratchHome() });

    unwrap(await syncHexApiSurface({ at: AT, paths, transport: fixtureTransport }));
    unwrap(resetHexAtlas({ at: LATER, paths }));
    const snapshot = unwrap(readHexAtlas({ paths }));

    expect(snapshot.missing).toEqual([]);
    expect(snapshot.files.method!.entities).toEqual([]);
  });
});
