import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  GEMINI_AI_STUDIO_BROWSER_PAGES,
  GEMINI_AI_STUDIO_PRODUCT_ORIGINS,
  geminiAiStudioPageUrl,
} from "../../../../atlas/geminiAiStudio/browserPages.js";
import { GEMINI_AI_STUDIO_ATLAS_DESCRIPTOR } from "../../../../atlas/geminiAiStudio/descriptor.js";
import { GEMINI_AI_STUDIO_KINDS } from "../../../../atlas/geminiAiStudio/model.js";
import { geminiAiStudioConsoleLinkFor } from "../../../../atlas/geminiAiStudio/projection.js";
import {
  GEMINI_AI_STUDIO_REVIEWED_OPERATION_TOTAL,
  geminiAiStudioDiscoveryUrl,
  geminiAiStudioSpecVersions,
} from "../../../../atlas/geminiAiStudio/specLock.js";
import { geminiAiStudioSpecCachePath } from "../../../../atlas/geminiAiStudio/specSource.js";
import { atlasPlatforms, findAtlasPlatform } from "../../../../atlas/registry.js";
import { stateHomePaths } from "../../../../stateHome.js";

const homes: string[] = [];

function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-gemini-paths-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

describe("the gemini-ai-studio atlas's home paths", () => {
  it("declares a file for exactly the kinds the model does", () => {
    const paths = stateHomePaths({ home: scratchHome() }).atlas.geminiAiStudio;
    expect(Object.keys(paths.kinds).toSorted()).toEqual([...GEMINI_AI_STUDIO_KINDS]);
  });

  it("uses the platform name a reader types, not the camel-case module directory", () => {
    const home = scratchHome();
    const paths = stateHomePaths({ home }).atlas.geminiAiStudio;
    expect(paths.root).toBe(join(home, "atlas", "gemini-ai-studio"));
    expect(paths.manifest).toBe(join(home, "atlas", "gemini-ai-studio", "manifest.json"));
    expect(paths.kinds["models"]).toBe(join(home, "atlas", "gemini-ai-studio", "models.jsonl"));
    expect(paths.superseded).toBe(join(home, "atlas", "_superseded", "gemini-ai-studio"));
  });

  it("names a cached document by its version and canonical digest", () => {
    const root = join(scratchHome(), "atlas", "gemini-ai-studio");
    expect(geminiAiStudioSpecCachePath({ root, sha256: "abcdef0123456789".repeat(4), version: "v1beta" })).toBe(
      join(root, "spec", "generativelanguage-v1beta-abcdef012345.json"),
    );
  });
});

describe("the gemini-ai-studio registration", () => {
  it("is in the catalogue exactly once, under the platform name the CLI takes", () => {
    expect(atlasPlatforms().filter((platform) => platform === "gemini-ai-studio").length).toBe(1);
    expect(findAtlasPlatform({ platform: "gemini-ai-studio" })!.platform).toBe("gemini-ai-studio");
  });

  it("lists the platforms alphabetically, so an unknown-platform message is predictable", () => {
    expect(atlasPlatforms()).toEqual([...atlasPlatforms()].toSorted());
  });
});

describe("the gemini-ai-studio descriptor", () => {
  it("declares all three surfaces, so an unlooked-at one is a state rather than a silence", () => {
    expect(GEMINI_AI_STUDIO_ATLAS_DESCRIPTOR.surfaces.map((surface) => surface.name)).toEqual([
      "discovery-specification",
      "gemini-api",
      "studio-and-app-pages",
    ]);
  });

  it("declares a browser surface at all, which is the half a design pass drops", () => {
    expect(
      GEMINI_AI_STUDIO_ATLAS_DESCRIPTOR.surfaces.filter((surface) => surface.acquisition === "driven-browser").length,
    ).toBe(1);
  });

  it("gives every unfilled surface a reason, so nobody has to guess why", () => {
    for (const surface of GEMINI_AI_STUDIO_ATLAS_DESCRIPTOR.surfaces) {
      expect(surface.status === "filled" ? "" : surface.unfilledBecause).not.toBe(null);
    }
  });

  it("writes down that it holds no entity, and who does instead", () => {
    expect(GEMINI_AI_STUDIO_ATLAS_DESCRIPTOR.excludes[0]!.because).toContain("Google Admin atlas");
    expect(GEMINI_AI_STUDIO_ATLAS_DESCRIPTOR.question).toContain("which store holds this organisation's own");
  });

  it("names the one command that brings it current", () => {
    expect(GEMINI_AI_STUDIO_ATLAS_DESCRIPTOR.resyncCommand).toBe("slopweaver atlas gemini-ai-studio sync");
  });
});

describe("the declared browser pages", () => {
  it("has at least one entry in GEMINI_AI_STUDIO_BROWSER_PAGES, so the guards below are not vacuously green", () => {
    expect(GEMINI_AI_STUDIO_BROWSER_PAGES.length).toBeGreaterThan(0);
  });

  it("declares pages under both products, because neither alone is the platform", () => {
    const products = new Set(GEMINI_AI_STUDIO_BROWSER_PAGES.map((page) => page.product));
    expect([...products].toSorted()).toEqual(["ai-studio", "gemini-app"]);
  });

  it("names each page once, so a gap per page cannot collide with another's", () => {
    const surfaces = GEMINI_AI_STUDIO_BROWSER_PAGES.map((page) => page.surface);
    expect(new Set(surfaces).size).toBe(surfaces.length);
  });

  it("addresses every page at its product's own origin, and nowhere else", () => {
    for (const page of GEMINI_AI_STUDIO_BROWSER_PAGES) {
      expect(geminiAiStudioPageUrl({ page }).startsWith(GEMINI_AI_STUDIO_PRODUCT_ORIGINS[page.product])).toBe(true);
    }
  });

  it("declares the API keys page, which is what the unfilled live surface is waiting on", () => {
    const keys = GEMINI_AI_STUDIO_BROWSER_PAGES.find((page) => page.surface === "studio-api-keys")!;
    expect(geminiAiStudioPageUrl({ page: keys })).toBe("https://aistudio.google.com/apikey");
  });
});

describe("the per-kind console link", () => {
  it("hands back a real AI Studio address for a kind the product publishes a page for", () => {
    expect(geminiAiStudioConsoleLinkFor({ kind: "tunedModels" })).toBe("https://aistudio.google.com/tune");
  });

  it("hands back null rather than an invented address for a kind with no page", () => {
    expect(geminiAiStudioConsoleLinkFor({ kind: "corpora" })).toBe(null);
  });
});

describe("the reviewed discovery pins", () => {
  it("compiles all three published versions, because an operation may exist in only one", () => {
    expect(geminiAiStudioSpecVersions()).toEqual(["v1", "v1alpha", "v1beta"]);
  });

  it("addresses each version at the one constant origin", () => {
    expect(geminiAiStudioDiscoveryUrl({ version: "v1beta" })).toBe(
      "https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta",
    );
  });

  it("totals the reviewed declarations across the three documents", () => {
    expect(GEMINI_AI_STUDIO_REVIEWED_OPERATION_TOTAL).toBe(222);
  });
});
