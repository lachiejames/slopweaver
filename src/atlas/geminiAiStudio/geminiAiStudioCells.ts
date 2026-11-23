/*
 * The coverage cells one operation kind carries, and the refusal that is the point of them: a compiled
 * operation is a DECLARATION, never a capability, so the `gemini-api` surface stays `not-configured` on
 * every kind no matter how complete the compile was.
 *
 * Imports the vocabulary and nothing else of this family, so it cannot see the gaps or the kind files.
 */

import { failedGeminiAiStudioCoverageCell, succeededGeminiAiStudioCoverageCell } from "./coverage.js";
import {
  dispositionCounts,
  GEMINI_AI_STUDIO_API_SURFACE,
  GEMINI_AI_STUDIO_ENTITIES_HOLDER,
  GEMINI_AI_STUDIO_ENTITIES_SCOPE,
  GEMINI_AI_STUDIO_SPEC_SURFACE,
} from "./geminiAiStudioSurfaces.js";
import { type GeminiAiStudioAtlasKindFile, type GeminiAiStudioCoverageCell } from "./model.js";
import { type GeminiAiStudioFoldedOperation } from "./versions.js";

/**
 * The stored cell a fresh one supersedes, found by the caller's own predicate.
 *
 * Both callers share this rather than each coalescing a missing `find` past a nullish default, which is
 * the substitution `no-silent-fallback` refuses. A surface that has never been published is a real state the cell builders
 * act on, so it is returned as one rather than defaulted past.
 *
 * @returns the first stored cell the predicate accepts, or `null` when this surface has never been published
 */
export function previousCell({
  coverage,
  matches,
}: {
  coverage: readonly GeminiAiStudioCoverageCell[];
  matches: (cell: GeminiAiStudioCoverageCell) => boolean;
}): GeminiAiStudioCoverageCell | null {
  for (const cell of coverage) {
    if (matches(cell)) {
      return cell;
    }
  }
  return null;
}

/**
 * The three coverage cells every operation kind carries: what was compiled, what has never been called, and
 * who holds this organisation's own entities instead.
 *
 * @returns this kind's whole coverage list: every cell on another surface kept as it stood, plus the three
 */
export function operationCoverage({
  operations,
  stored,
  at,
}: {
  operations: readonly GeminiAiStudioFoldedOperation[];
  stored: GeminiAiStudioAtlasKindFile;
  at: string;
}): GeminiAiStudioAtlasKindFile["coverage"] {
  const kept = stored.coverage.filter(
    (cell) => cell.surface !== GEMINI_AI_STUDIO_SPEC_SURFACE && cell.surface !== GEMINI_AI_STUDIO_API_SURFACE,
  );
  const previousApi = previousCell({
    coverage: stored.coverage,
    matches: (cell) => cell.surface === GEMINI_AI_STUDIO_API_SURFACE && cell.scope === "project-resources",
  });
  return [
    ...kept,
    compiledCell({ at, operations }),
    uncalledCell({ previous: previousApi }),
    heldElsewhereCell({ at }),
  ];
}

/** What the published documents said, and the refusal to read that as a capability. */
function compiledCell({
  operations,
  at,
}: {
  operations: readonly GeminiAiStudioFoldedOperation[];
  at: string;
}): GeminiAiStudioCoverageCell {
  const counts = dispositionCounts({ operations });
  return succeededGeminiAiStudioCoverageCell({
    artifacts: [],
    at,
    channel: "compiled",
    reason:
      `${String(operations.length)} operation(s) compiled from Google's published discovery documents, ` +
      `folded across the versions that declare each: ${String(counts.reachable)} reachable, ` +
      `${String(counts.voluminous)} voluminous (enumerated and declared, never stored whole), ` +
      `${String(counts.excluded)} excluded. This says the documents were read in full and nothing about ` +
      "what this installation may call",
    role: "authoritative",
    scope: "gemini-api-operations",
    state: "synced",
    surface: GEMINI_AI_STUDIO_SPEC_SURFACE,
  });
}

/** The live surface, which has never been reached because no key exists to reach it with. */
function uncalledCell({ previous }: { previous: GeminiAiStudioCoverageCell | null }): GeminiAiStudioCoverageCell {
  return failedGeminiAiStudioCoverageCell({
    channel: "api",
    previous,
    reason:
      "no Gemini API key is configured on this installation, so the platform has never been called and no " +
      "project-scoped resource has been read. Every operation above is a declaration, not a capability",
    role: "authoritative",
    scope: "project-resources",
    state: "not-configured",
    surface: GEMINI_AI_STUDIO_API_SURFACE,
    unblockedBy:
      "a Gemini API key held in the secrets store, which is new credentialled access and new spend " +
      "against a Google project — the owner's to grant rather than a piece of work",
  });
}

/** Who holds this organisation's Gemini entities, since this atlas deliberately does not. */
function heldElsewhereCell({ at }: { at: string }): GeminiAiStudioCoverageCell {
  return succeededGeminiAiStudioCoverageCell({
    artifacts: [],
    at,
    channel: "api",
    reason:
      "this organisation's own Gemini entities — who is licensed, which admin policies govern the app, " +
      `what the console reports as usage — are reached through \`${GEMINI_AI_STUDIO_ENTITIES_HOLDER}\`, ` +
      "not through this atlas. That is the owner's ruling (`docs/atlas-intent/06-holdings.md`) and the " +
      "reason this row is a surface map. The named holder is itself a surface map, so it says WHERE each " +
      "of those lives and which administrator scope reaches it rather than holding the records, which the " +
      "`entities-holder-is-a-surface-map` gap says on this same kind — read that before citing this cell",
    role: "discovery",
    scope: GEMINI_AI_STUDIO_ENTITIES_SCOPE,
    state: "held-elsewhere",
    surface: GEMINI_AI_STUDIO_API_SURFACE,
  });
}
