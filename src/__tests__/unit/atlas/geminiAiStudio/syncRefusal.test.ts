/**
 * The one refusal the Gemini compiled sync authors itself: a discovery document declaring a resource root
 * this build has no kind for.
 *
 * It fires per version in order, before any later version is fetched and before anything is published — so
 * the case asserts the exact lines the CLI prints, the addresses asked for, and that no generation exists.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { geminiAiStudioAtlasPaths, readGeminiAiStudioAtlas } from "../../../../atlas/geminiAiStudio/store.js";
import { syncGeminiAiStudioCompiledSurface } from "../../../../atlas/geminiAiStudio/sync.js";
import type { SpecFetchLike } from "../../../../atlas/kit/specFetch.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

import { discoveryFixture } from "./discoveryFixture.js";

const homes: string[] = [];

/** A throwaway home, removed in `afterEach`. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-gemini-refusal-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A fetch seam serving the fixture for every version, with one unknown root added to `v1` only. */
function servesUnknownRootOnV1({ calls }: { calls: string[] }): SpecFetchLike {
  return async (url) => {
    calls.push(url);
    const version = url.slice(url.indexOf("version=") + "version=".length);
    const document = discoveryFixture({ version });
    if (version === "v1") {
      const resources = document["resources"] as Record<string, unknown>;
      resources["quantumPrompts"] = {
        methods: {
          list: { httpMethod: "GET", id: "generativelanguage.quantumPrompts.list", path: "v1/quantumPrompts" },
        },
      };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(document) };
  };
}

describe("syncGeminiAiStudioCompiledSurface refuses a resource root this build does not know", () => {
  it("prints the unknown root and the correction, asks for no later version, and publishes nothing", async () => {
    const calls: string[] = [];
    const paths = geminiAiStudioAtlasPaths({ home: scratchHome() });
    const synced = await syncGeminiAiStudioCompiledSurface({
      at: "2026-09-05T10:00:00.000Z",
      fetchImpl: servesUnknownRootOnV1({ calls }),
      paths,
    });
    expect(unwrapErr(synced)).toEqual([
      "the Gemini v1 discovery document declares 1 resource root(s) this build does not: quantumPrompts",
      "nothing was published — a new root is Google adding a product area, which is exactly the unknown unknown this atlas exists to surface. Add it to GEMINI_AI_STUDIO_KINDS and to atlasHome.ts, then run again",
    ]);
    expect(calls).toEqual(["https://generativelanguage.googleapis.com/$discovery/rest?version=v1"]);
    expect(unwrap(readGeminiAiStudioAtlas({ paths })).manifest).toBe(null);
  });
});
