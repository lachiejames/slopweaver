/*
 * `atlas clerk sync`'s publish shell — `src/atlas/clerk/sync.ts`.
 *
 * Driven offline through the injected fetch seam with a plain recording function, never a mock. A document
 * that cannot be obtained ends the run before anything is compiled, so nothing is published and the reason
 * is the loader's own.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { clerkAtlasPaths } from "../../../../atlas/clerk/store.js";
import { syncClerkCompiledSurface } from "../../../../atlas/clerk/sync.js";
import type { SpecFetchLike } from "../../../../atlas/kit/specFetch.js";
import { unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-05T11:00:00.000Z";

const BAPI_URL =
  "https://raw.githubusercontent.com/clerk/openapi-specs/7987d1b776258d5ddd9163e1a03d256b5ac4d64a/bapi/2026-05-12.yml";

const homes: string[] = [];

/** A throwaway state home, removed in `afterEach`. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-clerk-sync-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("syncClerkCompiledSurface", () => {
  it("publishes nothing when a pinned document cannot be fetched, and says which one", async () => {
    const calls: string[] = [];
    const fetchImpl: SpecFetchLike = async (url) => {
      calls.push(url);
      return { ok: false, status: 404, text: async () => "" };
    };
    const paths = clerkAtlasPaths({ home: scratchHome() });
    const outcome = await syncClerkCompiledSurface({ at: AT, fetchImpl, paths });
    expect(unwrapErr(outcome)).toEqual([
      "fetching the pinned Clerk bapi document returned HTTP 404",
      `the address is fixed at ${BAPI_URL} and is not configurable`,
    ]);
    expect(calls).toEqual([BAPI_URL]);
    expect(existsSync(paths.manifest)).toBe(false);
  });
});
