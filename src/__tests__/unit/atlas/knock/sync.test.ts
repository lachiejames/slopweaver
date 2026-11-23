/**
 * The Knock sync, over a throwaway home — a round trip through the real store rather than a restatement of
 * what the projection returns.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { KNOCK_BROWSER_PAGES } from "../../../../atlas/knock/browserPages.js";
import { KNOCK_ROUTES } from "../../../../atlas/knock/generated/routes.js";
import { KNOCK_SURFACES } from "../../../../atlas/knock/generated/surfaces.js";
import { KNOCK_ATLAS_KINDS } from "../../../../atlas/knock/kinds.js";
import { readKnockSnapshot } from "../../../../atlas/knock/readAdapter.js";
import { type KnockSnapshot, knockAtlasPaths, readKnockAtlas } from "../../../../atlas/knock/store.js";
import { type KnockSyncOutcome, syncKnockAtlas } from "../../../../atlas/knock/sync.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { cloneHome } from "../homeTemplate.js";

const AT = "2026-09-07T00:00:00.000Z";
const homes: string[] = [];

/** A throwaway home this file owns, removed in `afterEach`. */
function newHome(): string {
  const home = mkdtempSync(join(tmpdir(), "knock-sync-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

/**
 * One first sync, read by every case that only INSPECTS it — each case used to publish an identical
 * generation of its own, and a publish is what this file spends. The idempotence case copies it rather than
 * re-running it (`homeTemplate.ts` says why); nothing writes into this home.
 */
let sharedHome = "";
let sharedOutcome: KnockSyncOutcome;
let sharedSnapshot: KnockSnapshot;

beforeAll(() => {
  sharedHome = mkdtempSync(join(tmpdir(), "knock-sync-shared-"));
  sharedOutcome = unwrap(syncKnockAtlas({ at: AT, paths: knockAtlasPaths({ home: sharedHome }) }));
  sharedSnapshot = unwrap(readKnockAtlas({ paths: knockAtlasPaths({ home: sharedHome }) }));
});

afterAll(() => {
  rmSync(sharedHome, { force: true, recursive: true });
});

describe("syncKnockAtlas", () => {
  it("publishes every declared operation and every dashboard route", () => {
    const outcome = sharedOutcome;
    expect(outcome.methods).toBe(KNOCK_SURFACES.length);
    expect(outcome.routes).toBe(KNOCK_ROUTES.length);
    expect(outcome.unconfiguredKinds).toBe(KNOCK_ATLAS_KINDS.length - 2);
  });

  it("opens one gap per walkable page no callable operation backs, and no more", () => {
    const snapshot = sharedSnapshot;
    const routeGaps = snapshot.files["dashboard-route"]!.gaps.filter(
      (gap) => gap.condition === "dashboard-page-has-no-api",
    );
    expect(routeGaps.length).toBe(KNOCK_BROWSER_PAGES.filter((page) => !page.apiBacked).length);
    expect(routeGaps.map((gap) => gap.scope)).toContain("/[slug]/agents");
  });

  it("opens no gap for a sign-in page, which has no API behind it uninterestingly", () => {
    const snapshot = sharedSnapshot;
    const scopes = snapshot.files["dashboard-route"]!.gaps.map((gap) => gap.scope);
    expect(scopes).not.toContain("/login");
    expect(scopes).not.toContain("/auth/sso/callback");
  });

  it("says every entity kind is not-configured and names the same unblock on each", () => {
    const snapshot = sharedSnapshot;
    const account = snapshot.files["account"]!;
    expect(account.entities).toStrictEqual([]);
    expect(account.coverage.length).toBe(1);
    expect(account.coverage[0]!.state).toBe("not-configured");
    expect(account.coverage[0]!.unblockedBy).toContain("knock-service-token");
  });

  it("is idempotent — a second sync over the same generation republishes the same counts", () => {
    const home = cloneHome({ prefix: "knock-sync-", template: sharedHome });
    homes.push(home);
    const second = unwrap(syncKnockAtlas({ at: "2026-09-07T01:00:00.000Z", paths: knockAtlasPaths({ home }) }));
    expect(second.methods).toBe(KNOCK_SURFACES.length);
    expect(second.routes).toBe(KNOCK_ROUTES.length);
  });

  it("leaves the atlas answerable, with every method carrying its reference page", () => {
    const snapshot = unwrap(readKnockSnapshot({ home: sharedHome }));
    const methods = snapshot.kinds.find((kind) => kind.kind === "method")!;
    expect(methods.entities.length).toBe(KNOCK_SURFACES.length);
    const linkless = methods.entities.filter((entity) =>
      entity.observations.every((observation) => observation.deepLink === null),
    );
    expect(linkless).toStrictEqual([]);
  });

  it("refuses to read a home nothing has been published into, rather than answering zero", () => {
    const home = newHome();
    const snapshot = readKnockSnapshot({ home });
    expect(unwrapErr(snapshot).code).toBe("ATLAS_GENERATION_UNPUBLISHED");
  });
});
