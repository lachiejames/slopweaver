import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { GEMINI_AI_STUDIO_BROWSER_PAGES } from "../../../../atlas/geminiAiStudio/browserPages.js";
import { censusDrift } from "../../../../atlas/geminiAiStudio/geminiAiStudioGaps.js";
import {
  GEMINI_AI_STUDIO_API_SURFACE,
  GEMINI_AI_STUDIO_ENTITIES_HOLDER,
  GEMINI_AI_STUDIO_ENTITIES_SCOPE,
  GEMINI_AI_STUDIO_PAGE_SURFACE,
  GEMINI_AI_STUDIO_SPEC_SURFACE,
  type GeminiAiStudioSyncOutcome,
} from "../../../../atlas/geminiAiStudio/geminiAiStudioSurfaces.js";
import { GEMINI_AI_STUDIO_KINDS } from "../../../../atlas/geminiAiStudio/model.js";
import { readGeminiAiStudioSnapshot } from "../../../../atlas/geminiAiStudio/readAdapter.js";
import { resetGeminiAiStudioAtlas } from "../../../../atlas/geminiAiStudio/reset.js";
import type { GeminiAiStudioSpecCensus } from "../../../../atlas/geminiAiStudio/specRead.js";
import {
  type GeminiAiStudioAtlasPaths,
  geminiAiStudioAtlasPaths,
  readGeminiAiStudioAtlas,
} from "../../../../atlas/geminiAiStudio/store.js";
import { syncGeminiAiStudioCompiledSurface } from "../../../../atlas/geminiAiStudio/sync.js";
import type { SpecFetchLike } from "../../../../atlas/kit/specFetch.js";
import { unwrap } from "../../../../lib/result.js";
import { cloneHome } from "../homeTemplate.js";

import { discoveryFixtureText } from "./discoveryFixture.js";

const homes: string[] = [];

function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-gemini-sync-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

/** A fetch seam answering the fixture for whichever version was asked for. */
const servesFixture: SpecFetchLike = async (url) => {
  const version = url.slice(url.indexOf("version=") + "version=".length);
  return { ok: true, status: 200, text: async () => discoveryFixtureText({ version }) };
};

/**
 * The fixture synced ONCE into a home every inspecting case reads. Each case used to publish an identical
 * generation of its own, and a publish is what this file spends; the reset case, which writes, takes a copy
 * (`homeTemplate.ts` says why). Nothing writes into this home.
 */
let shared: {
  outcome: GeminiAiStudioSyncOutcome;
  paths: GeminiAiStudioAtlasPaths;
};

beforeAll(async () => {
  const paths = geminiAiStudioAtlasPaths({ home: mkdtempSync(join(tmpdir(), "slopweaver-gemini-sync-shared-")) });
  const outcome = unwrap(
    await syncGeminiAiStudioCompiledSurface({ at: "2026-09-05T10:00:00.000Z", fetchImpl: servesFixture, paths }),
  );
  shared = { outcome, paths };
});

afterAll(() => {
  rmSync(shared.paths.home, { force: true, recursive: true });
});

describe("syncGeminiAiStudioCompiledSurface", () => {
  it("publishes one entity per operation, folded across the three published versions", () => {
    const { outcome } = shared;
    expect(outcome.operationCount).toBe(6);
    expect(outcome.declarationCount).toBe(18);
    expect(outcome.specs.map((spec) => spec.version)).toEqual(["v1", "v1alpha", "v1beta"]);
    expect(outcome.kindCount).toBe(GEMINI_AI_STUDIO_KINDS.length);
  });

  it("counts each disposition, so a reader sees how much of the surface is off limits", () => {
    const { outcome } = shared;
    // The fixture's six: `files.list` and `models.list` reachable; `generatedFiles.list` and
    // `models.operations.list` voluminous; `media.download` and `models.generateContent` excluded.
    expect(outcome.dispositionCounts).toEqual({ excluded: 2, reachable: 2, voluminous: 2 });
  });

  it("writes a file for every declared kind, including the ones the fixture has no operation for", () => {
    const { paths } = shared;
    const snapshot = unwrap(readGeminiAiStudioAtlas({ paths }));
    expect(Object.keys(snapshot.files).toSorted()).toEqual([...GEMINI_AI_STUDIO_KINDS]);
    expect(snapshot.missing).toEqual([]);
    expect(snapshot.mismatched).toEqual([]);
  });

  it("gives every operation kind a synced compiled cell and a not-configured live cell", () => {
    const { paths } = shared;
    const models = unwrap(readGeminiAiStudioAtlas({ paths })).files["models"]!;
    const compiled = models.coverage.find((cell) => cell.surface === GEMINI_AI_STUDIO_SPEC_SURFACE)!;
    const live = models.coverage.find(
      (cell) => cell.surface === GEMINI_AI_STUDIO_API_SURFACE && cell.scope === "project-resources",
    )!;
    expect(compiled.state).toBe("synced");
    expect(compiled.visibilityScope).toBe("compiled-published-discovery");
    expect(live.state).toBe("not-configured");
    expect(live.reason).toContain("no Gemini API key is configured");
  });

  it("names the holder of this organisation's entities on a held-elsewhere cell, on every operation kind", () => {
    const { paths } = shared;
    const snapshot = unwrap(readGeminiAiStudioAtlas({ paths }));
    for (const kind of GEMINI_AI_STUDIO_KINDS.filter((one) => one !== "page")) {
      const cell = snapshot.files[kind]!.coverage.find((one) => one.scope === GEMINI_AI_STUDIO_ENTITIES_SCOPE)!;
      expect(cell.state).toBe("held-elsewhere");
      expect(cell.role).toBe("discovery");
      expect(cell.reason).toContain(GEMINI_AI_STUDIO_ENTITIES_HOLDER);
    }
  });

  it("says out loud that the named holder has not been built, so the claim stays falsifiable", () => {
    const { paths } = shared;
    const models = unwrap(readGeminiAiStudioAtlas({ paths })).files["models"]!;
    const gap = models.gaps.find((one) => one.condition === "entities-holder-is-a-surface-map")!;
    expect(gap.status).toBe("open");
    expect(gap.reason).toContain(GEMINI_AI_STUDIO_ENTITIES_HOLDER);
  });

  it("carries one open gap per declared browser page, and publishes no page entity", () => {
    const { paths, outcome } = shared;
    const page = unwrap(readGeminiAiStudioAtlas({ paths })).files["page"]!;
    const attempts = page.gaps.filter((gap) => gap.condition === "browser-page-not-attempted");
    expect(attempts.length).toBe(GEMINI_AI_STUDIO_BROWSER_PAGES.length);
    expect(page.entities).toEqual([]);
    expect(outcome.declaredPageCount).toBe(GEMINI_AI_STUDIO_BROWSER_PAGES.length);
    const cell = page.coverage.find((one) => one.surface === GEMINI_AI_STUDIO_PAGE_SURFACE)!;
    expect(cell.state).toBe("deferred");
  });

  it("raises spec-revision-moved for every version whose census is not the reviewed one", () => {
    const { paths } = shared;
    const models = unwrap(readGeminiAiStudioAtlas({ paths })).files["models"]!;
    const moved = models.gaps.filter((gap) => gap.condition === "spec-revision-moved");
    expect(moved.map((gap) => gap.scope).toSorted()).toEqual(["v1", "v1alpha", "v1beta"]);
  });

  it("keeps firstSeenAt across a second sync, so a long-mapped operation does not claim to be new", async () => {
    const paths = geminiAiStudioAtlasPaths({ home: scratchHome() });
    unwrap(
      await syncGeminiAiStudioCompiledSurface({
        at: "2026-09-01T00:00:00.000Z",
        fetchImpl: servesFixture,
        paths,
      }),
    );
    unwrap(
      await syncGeminiAiStudioCompiledSurface({
        at: "2026-09-05T00:00:00.000Z",
        fetchImpl: servesFixture,
        paths,
      }),
    );
    const models = unwrap(readGeminiAiStudioAtlas({ paths })).files["models"]!;
    const listed = models.entities.find((entity) => entity.providerId === "models.list")!;
    expect(listed.channels.compiled!.firstSeenAt).toBe("2026-09-01T00:00:00.000Z");
    expect(listed.channels.compiled!.lastSeenAt).toBe("2026-09-05T00:00:00.000Z");
  });

  it("leaves the api and browser channels null, because neither has ever looked", () => {
    const { paths } = shared;
    const models = unwrap(readGeminiAiStudioAtlas({ paths })).files["models"]!;
    const listed = models.entities.find((entity) => entity.providerId === "models.list")!;
    expect(listed.channels.api).toBe(null);
    expect(listed.channels.browser).toBe(null);
  });
});

describe("readGeminiAiStudioSnapshot", () => {
  it("refuses an unpublished generation rather than reporting an empty platform", () => {
    const result = readGeminiAiStudioSnapshot({ home: scratchHome() });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("gemini-ai-studio");
  });

  it("reports the compiled surface filled once every applicable kind carries a success", () => {
    const { paths } = shared;
    const snapshot = unwrap(readGeminiAiStudioSnapshot({ home: paths.home }));
    const compiled = snapshot.descriptor.surfaces.find((surface) => surface.acquisition === "compiled")!;
    const browser = snapshot.descriptor.surfaces.find((surface) => surface.acquisition === "driven-browser")!;
    expect(compiled.status).toBe("filled");
    expect(browser.status).toBe("declared-unfilled");
  });

  it("projects one observation per channel that has actually looked, and no more", () => {
    const { paths } = shared;
    const snapshot = unwrap(readGeminiAiStudioSnapshot({ home: paths.home }));
    const models = snapshot.kinds.find((kind) => kind.kind === "models")!;
    const listed = models.entities.find((entity) => entity.providerId === "models.list")!;
    expect(listed.observations.length).toBe(1);
    expect(listed.observations[0]!.surface).toBe("compiled");
  });

  it("reads a kind status that records no permission block as null, never a substituted block", () => {
    const { paths } = shared;
    const snapshot = unwrap(readGeminiAiStudioSnapshot({ home: paths.home }));
    expect(snapshot.kinds.map((kind) => kind.permissionBlocked)).toEqual(GEMINI_AI_STUDIO_KINDS.map(() => null));
  });
});

describe("censusDrift", () => {
  it("names every number that moved, so a reader knows what to re-review", () => {
    const census: GeminiAiStudioSpecCensus = {
      methodCounts: { delete: 6, get: 22, patch: 3, post: 21 },
      operationCount: 53,
      revision: "20260905",
      rootCount: 11,
      schemaCount: 138,
      version: "v1",
    };
    expect(censusDrift({ census })).toEqual([
      "revision: read 20260905, reviewed 20260904",
      "operations: read 53, reviewed 52",
    ]);
  });

  it("is empty for the reviewed census, so a matching document raises no gap", () => {
    const census: GeminiAiStudioSpecCensus = {
      methodCounts: { delete: 6, get: 22, patch: 3, post: 21 },
      operationCount: 52,
      revision: "20260904",
      rootCount: 11,
      schemaCount: 138,
      version: "v1",
    };
    expect(censusDrift({ census })).toEqual([]);
  });

  it("says so when there is no reviewed census for a version at all", () => {
    const census: GeminiAiStudioSpecCensus = {
      methodCounts: {},
      operationCount: 0,
      revision: "20260904",
      rootCount: 0,
      schemaCount: 0,
      version: "v2",
    };
    expect(censusDrift({ census })).toEqual(["no reviewed census exists for version v2"]);
  });
});

describe("resetGeminiAiStudioAtlas", () => {
  it("archives the published generation and installs a complete empty one", () => {
    const home = cloneHome({ prefix: "slopweaver-gemini-sync-", template: shared.paths.home });
    homes.push(home);
    const paths = geminiAiStudioAtlasPaths({ home });
    const outcome = unwrap(resetGeminiAiStudioAtlas({ at: "2026-09-06T00:00:00.000Z", paths }));
    expect(outcome.archivedTo).toContain(join("_superseded", "gemini-ai-studio"));
    const snapshot = unwrap(readGeminiAiStudioAtlas({ paths }));
    expect(Object.keys(snapshot.files).toSorted()).toEqual([...GEMINI_AI_STUDIO_KINDS]);
    expect(snapshot.files["models"]!.entities).toEqual([]);
    expect(snapshot.manifest!.kinds["models"].lastSuccessAt).toBe(null);
  });
});
