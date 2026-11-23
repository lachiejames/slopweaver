import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AIRTABLE_BROWSER_PAGES, airtableConfirmedRoutes } from "../../../../atlas/airtable/browserPages.js";
import { AIRTABLE_SURFACES } from "../../../../atlas/airtable/generated/surfaces.js";
import { AIRTABLE_ATLAS_KINDS } from "../../../../atlas/airtable/kinds.js";
import { AIRTABLE_ROUTE_SURFACE, AIRTABLE_SPEC_SURFACE } from "../../../../atlas/airtable/projection.js";
import { readAirtableSnapshot } from "../../../../atlas/airtable/readAdapter.js";
import { type AirtableAtlasSnapshot, airtableAtlasPaths, readAirtableAtlas } from "../../../../atlas/airtable/store.js";
import {
  AIRTABLE_ENTITY_SURFACE,
  type AirtableSyncOutcome,
  syncAirtableSurfaces,
} from "../../../../atlas/airtable/sync.js";
import { unwrap } from "../../../../lib/result.js";
import { cloneHome } from "../homeTemplate.js";

const AT = "2026-09-05T02:00:00.000Z";

const homes: string[] = [];

/**
 * A throwaway COPY of the shared home, removed after its case. Every write in this file is scoped to a home
 * of its own, per `.claude/rules/testing.md`.
 */
function scratchCopy(): string {
  const home = cloneHome({ prefix: "slopweaver-airtable-sync-", template: sharedHome });
  homes.push(home);
  return home;
}

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/**
 * One first publish, read by every case that only INSPECTS it — each case used to publish an identical
 * generation of its own, and a publish is what this file spends. The idempotence case copies it rather than
 * re-running it (`homeTemplate.ts` says why); nothing writes into this home.
 */
let sharedHome = "";
let sharedOutcome: AirtableSyncOutcome;
let sharedSnapshot: AirtableAtlasSnapshot;

beforeAll(() => {
  sharedHome = mkdtempSync(join(tmpdir(), "slopweaver-airtable-sync-shared-"));
  const paths = airtableAtlasPaths({ home: sharedHome });
  sharedOutcome = unwrap(syncAirtableSurfaces({ at: AT, paths }));
  sharedSnapshot = unwrap(readAirtableAtlas({ paths }));
});

afterAll(() => {
  rmSync(sharedHome, { force: true, recursive: true });
});

describe("publishing the Airtable surface maps", () => {
  it("publishes every operation and every route, and says how many routes are confirmed", () => {
    const outcome = sharedOutcome;

    expect(outcome.operationCount).toBe(AIRTABLE_SURFACES.length);
    expect(outcome.routeCount).toBe(AIRTABLE_BROWSER_PAGES.length);
    expect(outcome.confirmedRouteCount).toBe(airtableConfirmedRoutes().length);
    expect(outcome.unreachableKindCount).toBe(AIRTABLE_ATLAS_KINDS.length - 2);
  });

  it("writes a file for every kind, so a fresh generation is complete rather than partial", () => {
    const snapshot = sharedSnapshot;

    expect(snapshot.missing).toEqual([]);
    expect(snapshot.mismatched).toEqual([]);
  });

  it("reads back the whole surface map through the registry's own adapter", () => {
    const snapshot = readAirtableSnapshot({ home: sharedHome });

    expect(snapshot.isOk()).toBe(true);
    const methods = unwrap(snapshot).kinds.find((kind) => kind.kind === "method")!;
    const pages = unwrap(snapshot).kinds.find((kind) => kind.kind === "page")!;
    expect(methods.entities.length).toBe(AIRTABLE_SURFACES.length);
    expect(pages.entities.length).toBe(AIRTABLE_BROWSER_PAGES.length);
  });

  // A kind that is empty for want of an invite and a kind that is empty because the organisation holds
  // nothing are the same file with opposite meanings. This is the field that tells them apart.
  it("gives every unreachable entity kind a not-configured cell naming the invite", () => {
    const snapshot = sharedSnapshot;
    const bases = snapshot.files.base!;
    const cell = bases.coverage.find((entry) => entry.surface === AIRTABLE_ENTITY_SURFACE)!;

    expect(cell.state).toBe("not-configured");
    expect(cell.latestAttemptFailed).toBe(true);
    expect(cell.unblockedBy).toContain("invite to the organisation's Airtable enterprise account");
    expect(bases.entities).toEqual([]);
  });

  it("claims the declared surface was read in full and claims nothing about what a token may call", () => {
    const cell = sharedSnapshot.files.method!.coverage.find((entry) => entry.surface === AIRTABLE_SPEC_SURFACE)!;

    expect(cell.state).toBe("synced");
    expect(cell.reason).toContain("no credential was presented");
  });

  it("records the route inventory as discovery, because route existence is not a reached page", () => {
    const cell = sharedSnapshot.files.page!.coverage.find((entry) => entry.surface === AIRTABLE_ROUTE_SURFACE)!;

    expect(cell.role).toBe("discovery");
    expect(cell.reason).toContain("no page has been opened, photographed or read");
  });

  it("opens the automations gap, which nothing this atlas does can ever close", () => {
    const gaps = sharedSnapshot.files.method!.gaps;

    expect(gaps.map((gap) => gap.scope)).toEqual(["tag:workflow"]);
    expect(gaps.map((gap) => gap.status)).toEqual(["open"]);
    expect(gaps.map((gap) => gap.condition)).toEqual(["provider-declares-tag-with-no-operation"]);
  });

  // Running twice must not duplicate an entity or re-open a gap under a second id, and must carry the
  // first run's discovery stamp forward rather than claiming everything was found today.
  it("is idempotent, and keeps the first run's first-seen stamp", () => {
    const paths = airtableAtlasPaths({ home: scratchCopy() });
    const later = "2026-09-06T02:00:00.000Z";

    unwrap(syncAirtableSurfaces({ at: later, paths }));
    const snapshot = unwrap(readAirtableAtlas({ paths }));
    const methods = snapshot.files.method!;
    const first = methods.entities[0]!;

    expect(methods.entities.length).toBe(AIRTABLE_SURFACES.length);
    expect(methods.gaps.length).toBe(1);
    expect(first.channels.api!.firstSeenAt).toBe(AT);
    expect(first.channels.api!.lastSeenAt).toBe(later);
  });
});
