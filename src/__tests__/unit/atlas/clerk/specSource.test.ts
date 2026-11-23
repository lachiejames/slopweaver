/**
 * Getting the four pinned Clerk documents onto disk — and, what these tests are about, the refusals when a
 * download is not them.
 *
 * Driven through the injected fetch seam with a plain recording function, never a mock: every refusal here
 * fires after a fetch, so the seam is the only way to reach one offline. The pins walk in order and the first
 * refusal ends the load, so each case also asserts how many addresses were asked for.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CLERK_SPEC_PINS } from "../../../../atlas/clerk/specLock.js";
import { clerkSpecCachePath, loadClerkSpecs } from "../../../../atlas/clerk/specSource.js";
import type { SpecFetchLike } from "../../../../atlas/kit/specFetch.js";
import { unwrapErr } from "../../../../lib/result.js";

describe("clerkSpecCachePath", () => {
  it("names each cached document by its pin and the last segment of its repository path", () => {
    expect(CLERK_SPEC_PINS.map((pin) => clerkSpecCachePath({ pin, root: "/atlas" }))).toStrictEqual([
      "/atlas/spec/bapi-2026-05-12.yml",
      "/atlas/spec/fapi-2026-05-12.yml",
      "/atlas/spec/platform-beta.yml",
      "/atlas/spec/webhooks-2025-04-15.yml",
    ]);
  });

  it("keeps a repository path with no directory whole", () => {
    expect(clerkSpecCachePath({ pin: { ...CLERK_SPEC_PINS[0]!, repositoryPath: "flat.yml" }, root: "/atlas" })).toBe(
      "/atlas/spec/bapi-flat.yml",
    );
  });
});

const BAPI_URL =
  "https://raw.githubusercontent.com/clerk/openapi-specs/7987d1b776258d5ddd9163e1a03d256b5ac4d64a/bapi/2026-05-12.yml";

const roots: string[] = [];

/** A throwaway atlas directory, removed in `afterEach`. */
function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "slopweaver-clerk-spec-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A fetch seam answering one status and body for every address, recording each address it was asked for. */
function answering({ status, body, calls }: { status: number; body: string; calls: string[] }): SpecFetchLike {
  return async (url) => {
    calls.push(url);
    return { ok: status === 200, status, text: async () => body };
  };
}

describe("loadClerkSpecs refuses a download that is not the pinned document", () => {
  it("names the status and the fixed address on a non-200, and asks for no later pin", async () => {
    const calls: string[] = [];
    const loaded = await loadClerkSpecs({
      fetchImpl: answering({ body: "", calls, status: 404 }),
      root: scratchRoot(),
    });
    expect(unwrapErr(loaded)).toEqual([
      "fetching the pinned Clerk bapi document returned HTTP 404",
      `the address is fixed at ${BAPI_URL} and is not configurable`,
    ]);
    expect(calls).toEqual([BAPI_URL]);
  });

  it("quotes the failure when the fetch itself throws", async () => {
    const loaded = await loadClerkSpecs({
      fetchImpl: async () => {
        throw new Error("ECONNRESET");
      },
      root: scratchRoot(),
    });
    expect(unwrapErr(loaded)).toEqual(["fetching the pinned Clerk bapi document failed: ECONNRESET"]);
  });

  it("refuses bytes that do not hash to the pin, and caches nothing", async () => {
    const root = scratchRoot();
    const loaded = await loadClerkSpecs({ fetchImpl: answering({ body: "x", calls: [], status: 200 }), root });
    expect(unwrapErr(loaded)).toEqual([
      "the pinned Clerk bapi document did not hash to its pin: got 2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881, expected 75df3a43fcb2d9fc4467a23c717714f5228aa3267b0930ba34612728365fd8f2",
      `the pin addresses an immutable commit (${BAPI_URL}), so a mismatch is a truncated or intercepted download rather than a vendor change — nothing was cached`,
    ]);
    expect(existsSync(join(root, "spec"))).toBe(false);
  });
});
