import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FIGMA_BROWSER_PAGES, figmaAbsentRoutes, figmaConfirmedRoutes } from "../../../../atlas/figma/browserPages.js";
import { FIGMA_SURFACES } from "../../../../atlas/figma/generated/surfaces.js";
import { FIGMA_ATLAS_KINDS } from "../../../../atlas/figma/kinds.js";
import { FIGMA_ROUTE_SURFACE, FIGMA_SPEC_SURFACE } from "../../../../atlas/figma/projection.js";
import { readFigmaSnapshot } from "../../../../atlas/figma/readAdapter.js";
import { figmaAtlasPaths, readFigmaAtlas } from "../../../../atlas/figma/store.js";
import { FIGMA_ENTITY_SURFACE, syncFigmaSurfaces } from "../../../../atlas/figma/sync.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-06T02:00:00.000Z";

const homes: string[] = [];

/** A throwaway state home. Every write in this file is scoped to one, per `.claude/rules/testing.md`. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-figma-sync-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

describe("publishing the Figma surface maps", () => {
  it("publishes every operation and every route, and says how many are confirmed and absent", () => {
    const home = scratchHome();

    const outcome = unwrap(syncFigmaSurfaces({ at: AT, paths: figmaAtlasPaths({ home }) }));

    expect(outcome.operationCount).toBe(FIGMA_SURFACES.length);
    expect(outcome.routeCount).toBe(FIGMA_BROWSER_PAGES.length);
    expect(outcome.confirmedRouteCount).toBe(figmaConfirmedRoutes().length);
    expect(outcome.absentRouteCount).toBe(figmaAbsentRoutes().length);
    expect(outcome.unreachableKindCount).toBe(FIGMA_ATLAS_KINDS.length - 2);
  });

  it("writes a file for every kind, so a fresh generation is complete rather than partial", () => {
    const home = scratchHome();
    const paths = figmaAtlasPaths({ home });

    unwrap(syncFigmaSurfaces({ at: AT, paths }));
    const snapshot = unwrap(readFigmaAtlas({ paths }));

    expect(snapshot.missing).toEqual([]);
    expect(snapshot.mismatched).toEqual([]);
  });

  it("reads back the whole surface map through the registry's own adapter", () => {
    const home = scratchHome();

    unwrap(syncFigmaSurfaces({ at: AT, paths: figmaAtlasPaths({ home }) }));
    const snapshot = readFigmaSnapshot({ home });

    expect(snapshot.isOk()).toBe(true);
    const methods = unwrap(snapshot).kinds.find((kind) => kind.kind === "method")!;
    const pages = unwrap(snapshot).kinds.find((kind) => kind.kind === "page")!;
    expect(methods.entities.length).toBe(FIGMA_SURFACES.length);
    expect(pages.entities.length).toBe(FIGMA_BROWSER_PAGES.length);
  });

  // A kind that is empty for want of a token and a kind that is empty because the organisation holds
  // nothing are the same file with opposite meanings. This is the field that tells them apart.
  it("gives every unreachable entity kind a not-configured cell naming the token", () => {
    const home = scratchHome();
    const paths = figmaAtlasPaths({ home });

    unwrap(syncFigmaSurfaces({ at: AT, paths }));
    const files = unwrap(readFigmaAtlas({ paths })).files.file!;
    const cell = files.coverage.find((entry) => entry.surface === FIGMA_ENTITY_SURFACE)!;

    expect(cell.state).toBe("not-configured");
    expect(cell.latestAttemptFailed).toBe(true);
    expect(cell.unblockedBy).toContain("slopweaver secrets set figma-token");
    expect(files.entities).toEqual([]);
  });

  // The claim is about what this INSTALLATION was given, never about Figma or about the owner's account.
  it("blames the credential rather than Figma for the empty kinds", () => {
    const home = scratchHome();
    const paths = figmaAtlasPaths({ home });

    unwrap(syncFigmaSurfaces({ at: AT, paths }));
    const cell = unwrap(readFigmaAtlas({ paths })).files.team!.coverage.find(
      (entry) => entry.surface === FIGMA_ENTITY_SURFACE,
    )!;

    expect(cell.reason).toContain("never about what Figma holds");
  });

  it("claims the declared surface was read in full and claims nothing about what a token may call", () => {
    const home = scratchHome();
    const paths = figmaAtlasPaths({ home });

    unwrap(syncFigmaSurfaces({ at: AT, paths }));
    const cell = unwrap(readFigmaAtlas({ paths })).files.method!.coverage.find(
      (entry) => entry.surface === FIGMA_SPEC_SURFACE,
    )!;

    expect(cell.state).toBe("synced");
    expect(cell.reason).toContain("no credential was presented");
  });

  it("records the route inventory as discovery, because route existence is not a reached page", () => {
    const home = scratchHome();
    const paths = figmaAtlasPaths({ home });

    unwrap(syncFigmaSurfaces({ at: AT, paths }));
    const cell = unwrap(readFigmaAtlas({ paths })).files.page!.coverage.find(
      (entry) => entry.surface === FIGMA_ROUTE_SURFACE,
    )!;

    expect(cell.role).toBe("discovery");
    expect(cell.reason).toContain("no page has been opened, photographed or read");
  });

  // Three findings nothing this atlas does can close, and only Figma publishing an endpoint can.
  it("opens one gap per document-level finding, all of them open by construction", () => {
    const home = scratchHome();
    const paths = figmaAtlasPaths({ home });

    unwrap(syncFigmaSurfaces({ at: AT, paths }));
    const gaps = unwrap(readFigmaAtlas({ paths })).files.method!.gaps;

    expect(gaps.map((gap) => gap.scope).toSorted()).toEqual([
      "api:root-enumeration",
      "endpoint:GET https://www.figma.com/oauth",
      "endpoint:POST https://api.figma.com/v1/oauth/refresh",
      "endpoint:POST https://api.figma.com/v1/oauth/token",
      "tag:Projects",
    ]);
    expect(new Set(gaps.map((gap) => gap.status))).toEqual(new Set(["open"]));
  });

  // Unlike the method gaps these ARE closable, and by a walk this repository can run.
  it("opens one gap per route whose own existence the probe could not establish", () => {
    const home = scratchHome();
    const paths = figmaAtlasPaths({ home });

    unwrap(syncFigmaSurfaces({ at: AT, paths }));
    const gaps = unwrap(readFigmaAtlas({ paths })).files.page!.gaps;
    const prefixOnly = FIGMA_BROWSER_PAGES.filter((page) => page.evidence === "auth-gated-prefix");

    expect(gaps.length).toBe(prefixOnly.length);
    expect(gaps.map((gap) => gap.condition)).toEqual(gaps.map(() => "browser-page-existence-unconfirmed"));
    expect(gaps.map((gap) => gap.scope).toSorted()).toEqual(prefixOnly.map((page) => `route:${page.route}`).toSorted());
  });

  // Forty-one "nobody opened this page" rows would restate, once per route, what the page kind's own
  // coverage cell already says. A gap list is a deliverable and one nobody can read is not one.
  it("opens no gap for a route whose existence the probe DID establish", () => {
    const home = scratchHome();
    const paths = figmaAtlasPaths({ home });

    unwrap(syncFigmaSurfaces({ at: AT, paths }));
    const scopes = new Set(unwrap(readFigmaAtlas({ paths })).files.page!.gaps.map((gap) => gap.scope));

    expect(scopes.has("route:/login")).toBe(false);
    expect(scopes.has("route:/design/{fileKey}")).toBe(false);
    expect(scopes.has("route:/admin")).toBe(false);
    expect(scopes.has("route:/settings/organization")).toBe(true);
  });

  // Running twice must not duplicate an entity or re-open a gap under a second id, and must carry the
  // first run's discovery stamp forward rather than claiming everything was found today.
  it("is idempotent, and keeps the first run's first-seen stamp", () => {
    const home = scratchHome();
    const paths = figmaAtlasPaths({ home });
    const later = "2026-09-07T02:00:00.000Z";

    const first = unwrap(syncFigmaSurfaces({ at: AT, paths }));
    unwrap(syncFigmaSurfaces({ at: later, paths }));
    const snapshot = unwrap(readFigmaAtlas({ paths }));
    const methods = snapshot.files.method!;
    const entity = methods.entities[0]!;

    expect(methods.entities.length).toBe(FIGMA_SURFACES.length);
    expect(methods.gaps.length).toBe(first.openGapCount - snapshot.files.page!.gaps.length);
    expect(entity.channels.api!.firstSeenAt).toBe(AT);
    expect(entity.channels.api!.lastSeenAt).toBe(later);
  });
});
