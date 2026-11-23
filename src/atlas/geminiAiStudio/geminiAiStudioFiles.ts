/*
 * One kind's next file, built from what this run compiled and what the store already holds, and the
 * manifest stamped from the same counts.
 *
 * This is the layer that reaches across: it imports the cells for a kind's coverage and the gaps for what
 * that kind still cannot claim, which is exactly why the two of them cannot import each other.
 */

import { err, ok, type Result } from "../../lib/result.js";

import { GEMINI_AI_STUDIO_BROWSER_PAGES, geminiAiStudioPageUrl } from "./browserPages.js";
import { failedGeminiAiStudioCoverageCell } from "./coverage.js";
import { openGeminiAiStudioGap, reconcileGeminiAiStudioGaps } from "./gaps.js";
import { operationCoverage, previousCell } from "./geminiAiStudioCells.js";
import { crossKindGaps, operationGaps } from "./geminiAiStudioGaps.js";
import { GEMINI_AI_STUDIO_PAGE_SURFACE, type SpecRead } from "./geminiAiStudioSurfaces.js";
import { mergeGeminiAiStudioChannel } from "./merge.js";
import {
  emptyGeminiAiStudioKindFile,
  GEMINI_AI_STUDIO_KINDS,
  GEMINI_AI_STUDIO_PAGE_KIND,
  type GeminiAiStudioAtlasGap,
  type GeminiAiStudioAtlasKindFile,
  type GeminiAiStudioAtlasManifest,
  type GeminiAiStudioKind,
  initialGeminiAiStudioManifest,
} from "./model.js";
import { projectGeminiAiStudioOperations } from "./projection.js";
import { type GeminiAiStudioAtlasSnapshot } from "./store.js";
import {
  type GeminiAiStudioFoldedOperation,
  type GeminiAiStudioFoldOutcome,
  type GeminiAiStudioVersionDisagreement,
} from "./versions.js";

/**
 * This kind's stored file, or a fresh empty one when the store has never published it.
 *
 * `== null` rather than `=== undefined` on purpose: a generation the store has never written carries a
 * literal `null` for that kind, and the nullish coalesce this replaced caught both. A strict undefined check
 * here read that `null` as a file and threw on its `entities`.
 */
function storedKindFile({
  snapshot,
  kind,
  at,
}: {
  snapshot: GeminiAiStudioAtlasSnapshot;
  kind: GeminiAiStudioKind;
  at: string;
}): GeminiAiStudioAtlasKindFile {
  const held = snapshot.files[kind];
  if (held == null) {
    return emptyGeminiAiStudioKindFile({ kind, updatedAt: at });
  }
  return held;
}

/** The operations this run gave one kind, which is none when the compile produced nothing for it. */
function operationsOfKind({
  byKind,
  kind,
}: {
  byKind: Map<GeminiAiStudioKind, GeminiAiStudioFoldedOperation[]>;
  kind: GeminiAiStudioKind;
}): readonly GeminiAiStudioFoldedOperation[] {
  const held = byKind.get(kind);
  if (held === undefined) {
    return [];
  }
  return held;
}

/** The manifest this run stamps onto, which is a fresh one the first time the atlas is published. */
function manifestBase({
  manifest,
  at,
}: {
  manifest: GeminiAiStudioAtlasManifest | null;
  at: string;
}): GeminiAiStudioAtlasManifest {
  if (manifest == null) {
    return initialGeminiAiStudioManifest({ updatedAt: at });
  }
  return manifest;
}

/**
 * Build every kind's next file from what this run compiled and what the store already holds.
 *
 * Split out of {@link publishCompiled} because the two are different jobs: this one is pure over the
 * snapshot it is handed, and that one is the read-check-write shell around it.
 *
 * @returns every kind's next file and its entity count, or the first failure a merge or a reconcile gave
 */
export function buildKindFiles({
  folded,
  snapshot,
  specs,
  at,
}: {
  folded: GeminiAiStudioFoldOutcome;
  snapshot: GeminiAiStudioAtlasSnapshot;
  specs: readonly SpecRead[];
  at: string;
}): Result<{
  files: Partial<Record<GeminiAiStudioKind, GeminiAiStudioAtlasKindFile>>;
  counts: Readonly<Record<GeminiAiStudioKind, number>>;
}> {
  const byKind = groupByKind({ operations: folded.operations });
  const files: Partial<Record<GeminiAiStudioKind, GeminiAiStudioAtlasKindFile>> = {};
  const counts: Partial<Record<GeminiAiStudioKind, number>> = {};
  const crossKind = crossKindGaps({ at, folded, specs });
  for (const kind of GEMINI_AI_STUDIO_KINDS) {
    const stored = storedKindFile({ at, kind, snapshot });
    const next =
      kind === GEMINI_AI_STUDIO_PAGE_KIND
        ? declaredPagesFile({ at, stored })
        : operationKindFile({
            at,
            crossKind,
            disagreements: folded.disagreements.filter((one) => one.kind === kind),
            kind,
            operations: operationsOfKind({ byKind, kind }),
            stored,
          });
    if (next.isErr()) {
      return err(next.error);
    }
    files[kind] = next.value;
    counts[kind] = next.value.entities.length;
  }
  // `as`: every kind was just visited, so the partial is complete. Same convention as `cloudflare/reset.ts`.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return ok({ counts: counts as Record<GeminiAiStudioKind, number>, files });
}

/** One operation kind's next file: the compiled channel merged on, its three coverage cells, and its gaps. */
function operationKindFile({
  kind,
  operations,
  disagreements,
  crossKind,
  stored,
  at,
}: {
  kind: GeminiAiStudioKind;
  operations: readonly GeminiAiStudioFoldedOperation[];
  disagreements: readonly GeminiAiStudioVersionDisagreement[];
  crossKind: readonly GeminiAiStudioAtlasGap[];
  stored: GeminiAiStudioAtlasKindFile;
  at: string;
}): Result<GeminiAiStudioAtlasKindFile> {
  const merged = mergeGeminiAiStudioChannel({
    at,
    channel: "compiled",
    observed: projectGeminiAiStudioOperations({ at, operations }),
    stored: stored.entities,
  });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const gaps = reconcileGeminiAiStudioGaps({
    at,
    observed: [...operationGaps({ at, disagreements, kind }), ...crossKind],
    rechecks: [
      { condition: "spec-unreachable", resolved: true, scope: kind },
      { condition: "spec-root-undeclared", resolved: true, scope: kind },
      // `entities-holder-unbuilt` was this gap's condition until the Google Admin atlas landed and turned
      // out to be a surface map rather than a store. A gap's id is `stableGapId({condition, scope})`, so
      // renaming the condition MINTS a new one, and `reconcileGaps` closes a stored gap only when a recheck
      // names its exact pair — without this line every already-published generation would keep the old row
      // open forever, carrying a condition string no code emits any more. This closes it on the next sync,
      // which is accumulate-never-replace rather than a silent orphan.
      { condition: "entities-holder-unbuilt", resolved: true, scope: kind },
    ],
    runFailed: false,
    stored: stored.gaps,
  });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  return ok({
    ...stored,
    coverage: operationCoverage({ at, operations, stored }),
    entities: [...merged.value],
    gaps: [...gaps.value],
    updatedAt: at,
  });
}

/** This run's operations, indexed by the kind whose file they belong in. */
function groupByKind({
  operations,
}: {
  operations: readonly GeminiAiStudioFoldedOperation[];
}): Map<GeminiAiStudioKind, GeminiAiStudioFoldedOperation[]> {
  const byKind = new Map<GeminiAiStudioKind, GeminiAiStudioFoldedOperation[]>();
  for (const operation of operations) {
    const held = byKind.get(operation.kind);
    if (held === undefined) {
      byKind.set(operation.kind, [operation]);
      continue;
    }
    held.push(operation);
  }
  return byKind;
}

/**
 * The `page` kind after a sync: no entity, one `deferred` coverage cell, and one gap per declared page.
 *
 * A declared-but-unvisited page is deliberately NOT published as an entity. `kit/read.ts` requires an
 * entity's observations to be non-empty, and a page no channel has seen has none — so publishing one would
 * make an empty row look like a reached page, which is the exact failure the browser surface's whole design
 * is aimed at. A gap per page is the honest carrier: it names the route, it survives until a walk closes it,
 * and `coverage --open-only` lists all of them.
 */
function declaredPagesFile({
  stored,
  at,
}: {
  stored: GeminiAiStudioAtlasKindFile;
  at: string;
}): Result<GeminiAiStudioAtlasKindFile> {
  const observed = GEMINI_AI_STUDIO_BROWSER_PAGES.map((page) =>
    openGeminiAiStudioGap({
      at,
      condition: "browser-page-not-attempted",
      fields: [],
      kind: GEMINI_AI_STUDIO_PAGE_KIND,
      reason: `declared and never visited: ${page.description} (${geminiAiStudioPageUrl({ page })})`,
      scope: page.surface,
      surfaces: ["browser"],
    }),
  );
  const gaps = reconcileGeminiAiStudioGaps({ at, observed, rechecks: [], runFailed: false, stored: stored.gaps });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  const kept = stored.coverage.filter((cell) => cell.surface !== GEMINI_AI_STUDIO_PAGE_SURFACE);
  const previous = previousCell({
    coverage: stored.coverage,
    matches: (cell) => cell.surface === GEMINI_AI_STUDIO_PAGE_SURFACE,
  });
  return ok({
    ...stored,
    coverage: [
      ...kept,
      failedGeminiAiStudioCoverageCell({
        channel: "browser",
        previous,
        reason:
          `${String(GEMINI_AI_STUDIO_BROWSER_PAGES.length)} page(s) declared across AI Studio and the Gemini ` +
          "app and 0 visited — no walk verb ships in this commit. The list never shrinks: an unreachable " +
          "route becomes a gap against the page, never a deletion from the declaration",
        role: "corroborating",
        scope: "studio-and-app-pages",
        state: "deferred",
        surface: GEMINI_AI_STUDIO_PAGE_SURFACE,
        unblockedBy:
          "a walk of the declared pages in the owner's own Chrome through the Playwright extension relay " +
          "(`atlas/kit/walkTransport.ts`), with both products signed in",
      }),
    ],
    gaps: [...gaps.value],
    updatedAt: at,
  });
}

/**
 * Stamp every kind's status from what this run actually published.
 *
 * @returns the manifest to publish, every kind stamped with this run's instant and count
 */
export function syncManifest({
  manifest,
  counts,
  at,
}: {
  manifest: GeminiAiStudioAtlasManifest | null;
  counts: Readonly<Record<GeminiAiStudioKind, number>>;
  at: string;
}): GeminiAiStudioAtlasManifest {
  const base = manifestBase({ at, manifest });
  const kinds: GeminiAiStudioAtlasManifest["kinds"] = { ...base.kinds };
  for (const kind of GEMINI_AI_STUDIO_KINDS) {
    kinds[kind] = {
      digest: null,
      entityCount: counts[kind],
      lastAttempt: { at, outcome: "ok", reasons: [] },
      lastSuccessAt: at,
    };
  }
  return { ...base, kinds, updatedAt: at };
}
