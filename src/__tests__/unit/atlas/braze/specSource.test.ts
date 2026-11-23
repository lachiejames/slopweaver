import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BRAZE_SITEMAP_URL } from "../../../../atlas/braze/specLock.js";
import { type BrazeFetchLike, loadBrazeDocsSurface } from "../../../../atlas/braze/specSource.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const SERVED = "https://www.braze.com/docs/api/endpoints/export/campaigns/get_campaign_analytics";
/** A page the sitemap declared and Braze answered with a 308 to its family index. */
const UNSERVED = "https://www.braze.com/docs/api/endpoints/user_data/get_users_track_status";
const FAMILY_INDEX = "https://www.braze.com/docs/api/endpoints/user_data";

/** A sitemap declaring each address once, all carrying the same `lastmod`. */
function sitemap({ urls }: { urls: readonly string[] }): string {
  const blocks = urls.map((url) => `<url><loc>${url}</loc><lastmod>2026-10-07T19:44:44+00:00</lastmod></url>`);
  return `<urlset>${blocks.join("")}</urlset>`;
}

/** An operation page carrying Braze's own declaration block. */
function operationPage({ path }: { path: string }): string {
  return `<h1>Op</h1><div class="api_type"><div class="method get ">get</div> <p>${path}</p></div>`;
}

/**
 * A fake fetch over a fixed table: each address answers its body and where it settled. Every request is
 * recorded so a test can count fetches without a mock.
 */
function tableFetch({
  table,
  requested,
}: {
  table: ReadonlyMap<string, { body: string; settledAt: string }>;
  requested: string[];
}): BrazeFetchLike {
  return async (url) => {
    requested.push(url);
    const entry = table.get(url);
    if (entry === undefined) {
      return { ok: false, status: 404, text: async () => "", url };
    }
    return { ok: true, status: 200, text: async () => entry.body, url: entry.settledAt };
  };
}

const roots: string[] = [];

/** A fresh atlas root, removed after the test. */
function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "braze-spec-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("loadBrazeDocsSurface — a declared page Braze does not serve", () => {
  const table = new Map([
    [BRAZE_SITEMAP_URL, { body: sitemap({ urls: [SERVED, UNSERVED] }), settledAt: BRAZE_SITEMAP_URL }],
    [SERVED, { body: operationPage({ path: "/campaigns/data_series" }), settledAt: SERVED }],
    [UNSERVED, { body: "<h1>User Data Endpoints</h1>", settledAt: FAMILY_INDEX }],
  ]);

  it("reports the redirect to a family index as unserved and reads every served page", async () => {
    const requested: string[] = [];
    const surface = unwrap(
      await loadBrazeDocsSurface({ fetchImpl: tableFetch({ requested, table }), root: freshRoot() }),
    );
    expect(surface.declaredPages).toBe(2);
    expect(surface.servedPages).toBe(1);
    expect(surface.rows.map((row) => row.providerId)).toEqual(["GET /campaigns/data_series"]);
    expect(surface.unservedPages).toEqual([{ servedAs: FAMILY_INDEX, url: UNSERVED }]);
  });

  it("never caches an unserved page, so the next run asks for it again", async () => {
    const root = freshRoot();
    const requested: string[] = [];
    unwrap(await loadBrazeDocsSurface({ fetchImpl: tableFetch({ requested, table }), root }));
    const second = unwrap(await loadBrazeDocsSurface({ fetchImpl: tableFetch({ requested, table }), root }));
    expect(requested.filter((url) => url === UNSERVED).length).toBe(2);
    expect(requested.filter((url) => url === SERVED).length).toBe(1);
    expect(second.fromCache).toBe(1);
    expect(second.unservedPages).toEqual([{ servedAs: FAMILY_INDEX, url: UNSERVED }]);
  });

  it("caches no occurrence of an address declared twice when any fetch of it came back unserved", async () => {
    const root = freshRoot();
    let answered = 0;
    const flaky: BrazeFetchLike = async (url) => {
      if (url === BRAZE_SITEMAP_URL) {
        return { ok: true, status: 200, text: async () => sitemap({ urls: [UNSERVED, UNSERVED] }), url };
      }
      answered += 1;
      const settled = answered === 1 ? FAMILY_INDEX : UNSERVED;
      return { ok: true, status: 200, text: async () => operationPage({ path: "/users/track/status" }), url: settled };
    };
    unwrap(await loadBrazeDocsSurface({ fetchImpl: flaky, root }));
    const requested: string[] = [];
    const again = new Map([
      [BRAZE_SITEMAP_URL, { body: sitemap({ urls: [UNSERVED] }), settledAt: BRAZE_SITEMAP_URL }],
      [UNSERVED, { body: "<h1>User Data Endpoints</h1>", settledAt: FAMILY_INDEX }],
    ]);
    const second = unwrap(await loadBrazeDocsSurface({ fetchImpl: tableFetch({ requested, table: again }), root }));
    expect(second.fromCache).toBe(0);
    expect(requested.filter((url) => url === UNSERVED).length).toBe(1);
  });

  it("still records an unknown family when its declared page redirects to the family index, and reports it unserved", async () => {
    const declared = "https://www.braze.com/docs/api/endpoints/new_family/get_x";
    const familyIndex = "https://www.braze.com/docs/api/endpoints/new_family";
    const newFamily = new Map([
      [BRAZE_SITEMAP_URL, { body: sitemap({ urls: [declared] }), settledAt: BRAZE_SITEMAP_URL }],
      [declared, { body: "<h1>New family</h1>", settledAt: familyIndex }],
    ]);
    const surface = unwrap(
      await loadBrazeDocsSurface({ fetchImpl: tableFetch({ requested: [], table: newFamily }), root: freshRoot() }),
    );
    expect(surface.unknownFamilies).toEqual(["new_family"]);
    expect(surface.unservedPages).toEqual([{ servedAs: familyIndex, url: declared }]);
    expect(surface.servedPages).toBe(0);
  });

  it("reports a redirect off the docs tree altogether as unserved", async () => {
    const offTree = new Map([
      [BRAZE_SITEMAP_URL, { body: sitemap({ urls: [UNSERVED] }), settledAt: BRAZE_SITEMAP_URL }],
      [UNSERVED, { body: "<h1>Elsewhere</h1>", settledAt: "https://example.test/landing" }],
    ]);
    const surface = unwrap(
      await loadBrazeDocsSurface({ fetchImpl: tableFetch({ requested: [], table: offTree }), root: freshRoot() }),
    );
    expect(surface.servedPages).toBe(0);
    expect(surface.unservedPages).toEqual([{ servedAs: "https://example.test/landing", url: UNSERVED }]);
  });

  it("reports an off-host redirect as unserved even when its path and body look like an operation", async () => {
    const impostor = "https://example.test/docs/api/endpoints/user_data/get_impostor";
    const offHost = new Map([
      [BRAZE_SITEMAP_URL, { body: sitemap({ urls: [UNSERVED] }), settledAt: BRAZE_SITEMAP_URL }],
      [UNSERVED, { body: operationPage({ path: "/users/track/status" }), settledAt: impostor }],
    ]);
    const surface = unwrap(
      await loadBrazeDocsSurface({ fetchImpl: tableFetch({ requested: [], table: offHost }), root: freshRoot() }),
    );
    expect(surface.rows).toEqual([]);
    expect(surface.unservedPages).toEqual([{ servedAs: impostor, url: UNSERVED }]);
  });
});

describe("loadBrazeDocsSurface — what still refuses, and what still reads", () => {
  it("refuses a page served AT its own address without the declaration block", async () => {
    const table = new Map([
      [BRAZE_SITEMAP_URL, { body: sitemap({ urls: [UNSERVED] }), settledAt: BRAZE_SITEMAP_URL }],
      [UNSERVED, { body: "<h1>No block</h1>", settledAt: UNSERVED }],
    ]);
    const refusal = unwrapErr(
      await loadBrazeDocsSurface({ fetchImpl: tableFetch({ requested: [], table }), root: freshRoot() }),
    );
    expect(refusal[0]).toBe(
      `${UNSERVED} carries no <div class="api_type"> block, so this build cannot read the method and address Braze declares for it`,
    );
  });

  it("reads a redirect to another operation page under the address the sitemap declared", async () => {
    const renamed = "https://www.braze.com/docs/api/endpoints/user_data/get_users_track_state";
    const table = new Map([
      [BRAZE_SITEMAP_URL, { body: sitemap({ urls: [UNSERVED] }), settledAt: BRAZE_SITEMAP_URL }],
      [UNSERVED, { body: operationPage({ path: "/users/track/status" }), settledAt: renamed }],
    ]);
    const surface = unwrap(
      await loadBrazeDocsSurface({ fetchImpl: tableFetch({ requested: [], table }), root: freshRoot() }),
    );
    expect(surface.servedPages).toBe(1);
    expect(surface.unservedPages).toEqual([]);
    expect(surface.rows.map((row) => [row.url, row.kind, row.providerId])).toEqual([
      [UNSERVED, "user_data", "GET /users/track/status"],
    ]);
  });
});
