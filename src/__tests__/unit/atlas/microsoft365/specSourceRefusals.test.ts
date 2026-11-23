import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SpecFetchLike } from "../../../../atlas/kit/specFetch.js";
import { readMicrosoft365Surface } from "../../../../atlas/microsoft365/specRead.js";
import { loadMicrosoft365Spec } from "../../../../atlas/microsoft365/specSource.js";
import { unwrapErr } from "../../../../lib/result.js";

const roots: string[] = [];

/** A scratch atlas root, removed in `afterEach`. */
function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "slopweaver-m365-refuse-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { force: true, recursive: true });
  }
});

/** A fetch seam that answers one fixed response. */
function answering({ body, status }: { body: string; status: number }): SpecFetchLike {
  return () => Promise.resolve({ ok: status === 200, status, text: () => Promise.resolve(body) });
}

describe("loadMicrosoft365Spec refusals, line for line", () => {
  it("names the HTTP status and the fixed address", async () => {
    const loaded = await loadMicrosoft365Spec({ fetchImpl: answering({ body: "", status: 404 }), root: scratchRoot() });
    expect(unwrapErr(loaded)).toEqual([
      "fetching the pinned Microsoft Graph specification returned HTTP 404",
      "the address is fixed at https://raw.githubusercontent.com/microsoftgraph/msgraph-metadata/de1a61e44c3794b8818cf6455b0fb089d0e5e1c9/openapi/v1.0/openapi.yaml and is not configurable",
    ]);
  });

  it("names a thrown transport failure by its own message", async () => {
    const loaded = await loadMicrosoft365Spec({
      fetchImpl: () => Promise.reject(new Error("ECONNRESET")),
      root: scratchRoot(),
    });
    expect(unwrapErr(loaded)).toEqual(["fetching the pinned Microsoft Graph specification failed: ECONNRESET"]);
  });

  it("refuses bytes that do not hash to the pin, and caches nothing", async () => {
    const root = scratchRoot();
    const loaded = await loadMicrosoft365Spec({ fetchImpl: answering({ body: "x", status: 200 }), root });
    expect(unwrapErr(loaded)).toEqual([
      "the pinned Microsoft Graph specification did not hash to its pin: got 2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881, expected 6e3a4c9bab98c7c759742769fae115e8c50241674ffc99d834d223ab93c91889",
      "the pin addresses an immutable commit (de1a61e44c3794b8818cf6455b0fb089d0e5e1c9), so a mismatch is a truncated or intercepted download rather than a vendor change — nothing was cached",
    ]);
    expect(existsSync(join(root, "spec", "graph-v1.0-de1a61e44c3794b8818cf6455b0fb089d0e5e1c9.yaml"))).toBe(false);
  });
});

describe("readMicrosoft365Surface refusals, line for line", () => {
  it("refuses a YAML document that is not a mapping", () => {
    expect(unwrapErr(readMicrosoft365Surface({ text: "- a\n" }))).toEqual([
      "the pinned Microsoft Graph specification is not a YAML mapping",
    ]);
  });

  it("refuses a mapping with no paths section", () => {
    expect(unwrapErr(readMicrosoft365Surface({ text: "a: 1\n" }))).toEqual([
      "the pinned Microsoft Graph specification declares no `paths` section",
    ]);
  });
});
