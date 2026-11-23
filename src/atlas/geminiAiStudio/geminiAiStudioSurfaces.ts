/*
 * The vocabulary the whole `atlas gemini-ai-studio sync` family reads: the surface and scope names a
 * coverage cell is reported under, the holder this atlas deliberately points at instead of itself, one
 * document as a run obtained it, and what `--json` prints.
 *
 * It imports nothing of its own family, which is what makes the rest of the family a one-way graph: the
 * cells, the gaps, the kind files and the sync shell all reach DOWN to this and never sideways.
 */

import { type GeminiAiStudioDisposition } from "./model.js";
import { type GeminiAiStudioFoldedOperation } from "./versions.js";

/** One document as this run obtained it, plus how far its own census is from the reviewed one. */
export interface SpecRead {
  readonly version: string;
  readonly revision: string;
  readonly origin: "cache" | "fetch";
  readonly path: string;
  readonly matchesReviewedCensus: boolean;
  readonly drift: readonly string[];
}

/**
 * The surface name the compiled channel's coverage is reported under. Matches the descriptor's own.
 *
 * @internal
 */
export const GEMINI_AI_STUDIO_SPEC_SURFACE = "discovery-specification";

/**
 * The surface name the live channel's coverage is reported under, filled or not.
 *
 * @internal
 */
export const GEMINI_AI_STUDIO_API_SURFACE = "gemini-api";

/**
 * The surface name the browser walk's coverage is reported under.
 *
 * @internal
 */
export const GEMINI_AI_STUDIO_PAGE_SURFACE = "studio-and-app-pages";

/**
 * The scope of the cell that names who holds this organisation's Gemini entities instead of this atlas.
 *
 * @internal
 */
export const GEMINI_AI_STUDIO_ENTITIES_SCOPE = "organisation-gemini-entities";

/**
 * The holder this atlas names, in the form a reader can actually follow TODAY.
 *
 * `kit/contract.ts` requires a `held-elsewhere` cell to name WHERE, and a name a reader cannot follow is the
 * unfalsifiable claim the state exists to avoid. It used to name the BOARD ROW rather than a verb, because
 * the verb did not exist yet.
 *
 * **The verb exists now, and the answer it gives is not the one this constant anticipated.** The Google
 * Admin atlas landed as a SURFACE MAP on the same §6 test that made this one a surface map, so it does not
 * hold this organisation's Gemini entities either. What it holds is where they live: the licence
 * assignments, the Chrome and Workspace policy schemas and the usage reports are all methods it maps, with
 * the administrator scope each one needs, and its own `admin-api` surface is declared-unfilled because this
 * installation's Google grant carries no administrator scope.
 *
 * So the holder is that verb, the claim it backs is narrower than "it holds them", and
 * `entities-holder-unbuilt` was replaced by `entities-holder-is-a-surface-map` — a gap that says the truth
 * rather than one that quietly went stale the day the row was built. The fold the board row invited does
 * not happen: two surface maps do not fold into each other.
 *
 * @internal
 */
export const GEMINI_AI_STUDIO_ENTITIES_HOLDER = "the Google Admin atlas (`slopweaver atlas google-admin read`)";

/** What a sync did, which is what `--json` prints. */
export interface GeminiAiStudioSyncOutcome {
  /** One entry per published version, in the order they were read. */
  readonly specs: readonly {
    readonly version: string;
    readonly revision: string;
    readonly origin: "cache" | "fetch";
    readonly path: string;
    readonly matchesReviewedCensus: boolean;
  }[];
  /** Operations after the three versions are folded together. */
  readonly operationCount: number;
  /** Operation declarations read across the three documents, before folding. */
  readonly declarationCount: number;
  readonly dispositionCounts: Readonly<Record<GeminiAiStudioDisposition, number>>;
  readonly versionDisagreementCount: number;
  /**
   * Operations exactly ONE published version declares.
   *
   * Worth a number of its own rather than only a field on each row, because it is the shape of finding this
   * atlas exists for: MEASURED, four of them are `v1`-only — the whole `operations` root plus
   * `media.download` and `tunedModels.operations.cancel` — so a reader who knows only `v1beta` would
   * conclude the Gemini API offers no way to list a long-running operation, and it does.
   */
  readonly versionExclusiveCount: number;
  readonly kindCount: number;
  readonly declaredPageCount: number;
  readonly written: readonly string[];
}

/**
 * How many operations this run gave each disposition.
 *
 * @returns one count per disposition, every disposition present even at zero
 */
export function dispositionCounts({
  operations,
}: {
  operations: readonly GeminiAiStudioFoldedOperation[];
}): Readonly<Record<GeminiAiStudioDisposition, number>> {
  const counts = { excluded: 0, reachable: 0, voluminous: 0 };
  for (const operation of operations) {
    counts[operation.disposition] += 1;
  }
  return counts;
}
