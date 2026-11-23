/**
 * `atlas gemini-ai-studio sync` — publish the COMPILED surface: every operation the three published Gemini
 * discovery documents declare, folded across versions, onto each kind's `compiled` channel.
 *
 * ## What this verb can and cannot claim
 *
 * It reads three public documents and reaches no project, so a `synced` cell here says the documents were
 * compiled in full and says NOTHING about what this installation may call. The `gemini-api` surface stays
 * `declared-unfilled` and every kind carries a `not-configured` cell for it, because reading a compiled
 * operation as a capability is the single most available mistake with this atlas and a coverage cell is
 * where it has to be refused.
 *
 * ## It also publishes what this atlas deliberately does not hold
 *
 * Every kind gets a second `gemini-api` cell, in the `held-elsewhere` state, naming the Google Admin atlas
 * as the holder of this organisation's own Gemini entities. That is the owner's ruling
 * (`docs/atlas-intent/06-holdings.md`) made into a row a reader can act on rather than a sentence in a design doc.
 * Because that holder is itself a surface map rather than a store, the same run raises
 * `entities-holder-is-a-surface-map` — the cell names where, and the gap says the where is a map.
 *
 * ## A moved document is published, not refused
 *
 * `specLock.ts` carries the reasoning: the discovery endpoint is live by construction, so a census that
 * disagrees with the reviewed one is Google moving rather than a corrupted download. This verb compiles what
 * arrived and raises `spec-revision-moved` with the exact deltas. The integrity check that DOES refuse is
 * the envelope parse in `specRead.ts`, which a substituted or truncated body fails.
 *
 * ## Four kinds of gap are raised on every successful run, and that is correct
 *
 * `api-credential-absent`, `entities-holder-is-a-surface-map`, one `version-shape-disagreement` per operation the
 * versions describe differently, and one `browser-page-not-attempted` per declared page. None can be closed
 * by anything this verb does, and an atlas whose gap list emptied because the only pass that could run had
 * run would be reporting completeness it does not have.
 */

import { err, ok, type Result } from "../../lib/result.js";

import { GEMINI_AI_STUDIO_BROWSER_PAGES } from "./browserPages.js";
import { GeminiAiStudioAtlasErrors, geminiAiStudioAtlasErrorLines } from "./errors.js";
import { buildKindFiles, syncManifest } from "./geminiAiStudioFiles.js";
import { censusDrift } from "./geminiAiStudioGaps.js";
import { dispositionCounts, type GeminiAiStudioSyncOutcome, type SpecRead } from "./geminiAiStudioSurfaces.js";
import { GEMINI_AI_STUDIO_KINDS } from "./model.js";
import { geminiAiStudioSpecVersions } from "./specLock.js";
import { type GeminiAiStudioOperationRow, readGeminiAiStudioSurface } from "./specRead.js";
import { loadGeminiAiStudioSpec, type SpecFetchLike } from "./specSource.js";
import { type GeminiAiStudioAtlasPaths, publishGeminiAiStudioAtlas, readGeminiAiStudioAtlas } from "./store.js";
import { foldGeminiAiStudioVersions, type GeminiAiStudioFoldOutcome } from "./versions.js";

/**
 * Compile the published discovery documents and publish them.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp
 * @param fetchImpl the HTTP seam used only when a document is not already cached
 * @returns what was published, or every reason it could not be
 */
export async function syncGeminiAiStudioCompiledSurface({
  paths,
  at,
  fetchImpl,
}: {
  paths: GeminiAiStudioAtlasPaths;
  at: string;
  fetchImpl?: SpecFetchLike;
}): Promise<Result<GeminiAiStudioSyncOutcome>> {
  const read: SpecRead[] = [];
  const rows: GeminiAiStudioOperationRow[] = [];
  for (const version of geminiAiStudioSpecVersions()) {
    const spec = await loadGeminiAiStudioSpec(
      fetchImpl === undefined ? { root: paths.directory, version } : { fetchImpl, root: paths.directory, version },
    );
    if (spec.isErr()) {
      return err(spec.error);
    }
    const surface = readGeminiAiStudioSurface({ text: spec.value.text, version });
    if (surface.isErr()) {
      return err(surface.error);
    }
    if (surface.value.unknownRoots.length > 0) {
      return err(
        geminiAiStudioAtlasErrorLines({
          error: GeminiAiStudioAtlasErrors.rootsUnknown({ unknownRoots: surface.value.unknownRoots, version }),
        }),
      );
    }
    const drift = censusDrift({ census: surface.value.census });
    read.push({
      drift,
      matchesReviewedCensus: drift.length === 0,
      origin: spec.value.origin,
      path: spec.value.path,
      revision: surface.value.census.revision,
      version,
    });
    rows.push(...surface.value.rows);
  }
  const folded = foldGeminiAiStudioVersions({ rows });
  return publishCompiled({ at, declarationCount: rows.length, folded, paths, specs: read });
}

/** Read the generation, merge the compiled channel onto it, and publish. */
function publishCompiled({
  paths,
  at,
  folded,
  declarationCount,
  specs,
}: {
  paths: GeminiAiStudioAtlasPaths;
  at: string;
  folded: GeminiAiStudioFoldOutcome;
  declarationCount: number;
  specs: readonly SpecRead[];
}): Result<GeminiAiStudioSyncOutcome> {
  const snapshot = readGeminiAiStudioAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const built = buildKindFiles({ at, folded, snapshot: snapshot.value, specs });
  if (built.isErr()) {
    return err(built.error);
  }
  const published = publishGeminiAiStudioAtlas({
    derivedFrom: snapshot.value.manifest,
    files: built.value.files,
    manifest: syncManifest({ at, counts: built.value.counts, manifest: snapshot.value.manifest }),
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok(syncOutcome({ declarationCount, folded, specs, written: published.value }));
}

/** What a run reports, assembled from what it read and what it wrote. */
function syncOutcome({
  folded,
  declarationCount,
  specs,
  written,
}: {
  folded: GeminiAiStudioFoldOutcome;
  declarationCount: number;
  specs: readonly SpecRead[];
  written: readonly string[];
}): GeminiAiStudioSyncOutcome {
  return {
    declarationCount,
    declaredPageCount: GEMINI_AI_STUDIO_BROWSER_PAGES.length,
    dispositionCounts: dispositionCounts({ operations: folded.operations }),
    kindCount: GEMINI_AI_STUDIO_KINDS.length,
    operationCount: folded.operations.length,
    specs: specs.map((spec) => ({
      matchesReviewedCensus: spec.matchesReviewedCensus,
      origin: spec.origin,
      path: spec.path,
      revision: spec.revision,
      version: spec.version,
    })),
    versionDisagreementCount: folded.disagreements.length,
    versionExclusiveCount: folded.operations.filter((operation) => operation.apiVersions.length === 1).length,
    written,
  };
}
