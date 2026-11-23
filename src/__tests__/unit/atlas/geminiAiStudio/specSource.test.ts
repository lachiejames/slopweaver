import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  GEMINI_AI_STUDIO_SPEC_PINS,
  type GeminiAiStudioSpecVersion,
  geminiAiStudioDiscoveryUrl,
  geminiAiStudioSpecPin,
  geminiAiStudioSpecVersions,
  isGeminiAiStudioSpecVersion,
} from "../../../../atlas/geminiAiStudio/specLock.js";
import {
  canonicaliseGeminiSpec,
  geminiAiStudioSpecCachePath,
  loadGeminiAiStudioSpec,
} from "../../../../atlas/geminiAiStudio/specSource.js";
import type { SpecFetchLike } from "../../../../atlas/kit/specFetch.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

import { discoveryFixture, discoveryFixtureText } from "./discoveryFixture.js";

const roots: string[] = [];

function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "slopweaver-gemini-spec-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { force: true, recursive: true });
  }
});

/** A fetch seam that answers one body and counts how often it was asked. */
function fetchServing({ body, calls }: { body: string; calls: string[] }): SpecFetchLike {
  return async (url) => {
    calls.push(url);
    return { ok: true, status: 200, text: async () => body };
  };
}

describe("canonicaliseGeminiSpec", () => {
  it("gives two orderings of the same document the same text", () => {
    const one = canonicaliseGeminiSpec({ text: JSON.stringify({ a: 1, b: { y: 2, z: 3 } }), version: "v1beta" });
    const other = canonicaliseGeminiSpec({ text: JSON.stringify({ b: { z: 3, y: 2 }, a: 1 }), version: "v1beta" });
    expect(unwrap(one)).toBe(unwrap(other));
  });

  it("keeps array order, because an array's order is data rather than serialisation", () => {
    expect(unwrap(canonicaliseGeminiSpec({ text: JSON.stringify({ scopes: ["b", "a"] }), version: "v1" }))).toBe(
      '{"scopes":["b","a"]}',
    );
  });

  it("refuses bytes that are not JSON", () => {
    const result = canonicaliseGeminiSpec({ text: "<html>", version: "v1" });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain("not parseable JSON");
  });
});

describe("loadGeminiAiStudioSpec", () => {
  it("fetches the one computed address and caches the canonical form under its digest", async () => {
    const root = scratchRoot();
    const calls: string[] = [];
    const loaded = unwrap(
      await loadGeminiAiStudioSpec({
        fetchImpl: fetchServing({ body: discoveryFixtureText({ version: "v1beta" }), calls }),
        root,
        version: "v1beta",
      }),
    );
    expect(calls).toEqual([geminiAiStudioDiscoveryUrl({ version: "v1beta" })]);
    expect(loaded.origin).toBe("fetch");
    expect(loaded.path).toBe(geminiAiStudioSpecCachePath({ root, sha256: loaded.sha256, version: "v1beta" }));
    expect(readFileSync(loaded.path, "utf8")).toBe(loaded.text);
  });

  it("gives the same digest to two different orderings of one document, which is what makes the cache hit", async () => {
    const root = scratchRoot();
    const document = discoveryFixture({ version: "v1beta" });
    const reordered = Object.fromEntries(Object.entries(document).toReversed());
    const first = unwrap(
      await loadGeminiAiStudioSpec({
        fetchImpl: fetchServing({ body: JSON.stringify(document), calls: [] }),
        root,
        version: "v1beta",
      }),
    );
    const second = unwrap(
      await loadGeminiAiStudioSpec({
        fetchImpl: fetchServing({ body: JSON.stringify(reordered), calls: [] }),
        root: scratchRoot(),
        version: "v1beta",
      }),
    );
    expect(second.sha256).toBe(first.sha256);
  });

  it("discards a cache whose bytes are not the reviewed document, rather than trusting its name", async () => {
    const root = scratchRoot();
    const pin = geminiAiStudioSpecPin({ version: "v1beta" });
    const poisoned = geminiAiStudioSpecCachePath({ root, sha256: pin.sha256, version: "v1beta" });
    mkdirSync(dirname(poisoned), { recursive: true });
    writeFileSync(poisoned, JSON.stringify({ kind: "discovery#restDescription", name: "not-the-document" }), "utf8");
    const calls: string[] = [];
    const loaded = unwrap(
      await loadGeminiAiStudioSpec({
        fetchImpl: fetchServing({ body: discoveryFixtureText({ version: "v1beta" }), calls }),
        root,
        version: "v1beta",
      }),
    );
    expect(calls.length).toBe(1);
    expect(loaded.origin).toBe("fetch");
    expect(loaded.matchesPin).toBe(false);
    expect(loaded.sha256).not.toBe(pin.sha256);
  });

  it("reports a non-200 with the address it could not read, which is not configurable", async () => {
    const result = await loadGeminiAiStudioSpec({
      fetchImpl: async () => ({ ok: false, status: 503, text: async () => "" }),
      root: scratchRoot(),
      version: "v1beta",
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain("returned HTTP 503");
    expect(result._unsafeUnwrapErr()[1]).toContain(geminiAiStudioDiscoveryUrl({ version: "v1beta" }));
  });

  it("refuses a version this build does not compile, rather than inventing an address for it", async () => {
    const result = await loadGeminiAiStudioSpec({
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => "{}" }),
      root: scratchRoot(),
      version: "v2",
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain("compiles no Gemini discovery document for version v2");
  });
});

describe("geminiAiStudioSpecPin", () => {
  it("resolves every compiled version to the pin that declares it", () => {
    expect(GEMINI_AI_STUDIO_SPEC_PINS.length).toBeGreaterThan(0);
    const strays = GEMINI_AI_STUDIO_SPEC_PINS.filter((pin) => geminiAiStudioSpecPin({ version: pin.version }) !== pin);
    expect(strays.map((pin) => pin.version)).toEqual([]);
  });

  // Before: an unpinned version answered null at run time; the version is now closed, so it cannot be asked.
  it("refuses an unpinned version at compile time, and the guard refuses it at run time", () => {
    // @ts-expect-error -- "v2" is not a version this build compiles
    const unknown: GeminiAiStudioSpecVersion = "v2";
    expect(isGeminiAiStudioSpecVersion(unknown)).toBe(false);
    expect(isGeminiAiStudioSpecVersion("constructor")).toBe(false);
  });

  it("admits exactly the versions this atlas compiles", () => {
    expect(geminiAiStudioSpecVersions().filter((version) => !isGeminiAiStudioSpecVersion(version))).toEqual([]);
    expect(geminiAiStudioSpecVersions()).toEqual(["v1", "v1alpha", "v1beta"]);
  });
});

describe("loadGeminiAiStudioSpec's refusals, each line exactly as the CLI prints it", () => {
  it("names the status and the computed address on a non-200", async () => {
    const result = await loadGeminiAiStudioSpec({
      fetchImpl: async () => ({ ok: false, status: 503, text: async () => "" }),
      root: scratchRoot(),
      version: "v1beta",
    });
    expect(unwrapErr(result)).toEqual([
      "fetching the Gemini v1beta discovery document returned HTTP 503",
      "the address is computed from a constant origin and is not configurable: https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta",
    ]);
  });

  it("quotes the failure when the fetch itself throws", async () => {
    const result = await loadGeminiAiStudioSpec({
      fetchImpl: async () => {
        throw new Error("ECONNRESET");
      },
      root: scratchRoot(),
      version: "v1beta",
    });
    expect(unwrapErr(result)).toEqual(["fetching the Gemini v1beta discovery document failed: ECONNRESET"]);
  });

  it("refuses an uncompiled version before asking for any address", async () => {
    const calls: string[] = [];
    const result = await loadGeminiAiStudioSpec({
      fetchImpl: fetchServing({ body: "{}", calls }),
      root: scratchRoot(),
      version: "v2",
    });
    expect(unwrapErr(result)).toEqual(["this build compiles no Gemini discovery document for version v2"]);
    expect(calls).toEqual([]);
  });
});
