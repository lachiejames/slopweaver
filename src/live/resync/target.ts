/**
 * What a scheduled resync is ABOUT — one atlas, or one corpus source — and the recipe id that names it.
 *
 * A briefing card never asks the owner whether an atlas should be re-synced: scheduled resyncs cover every
 * atlas and corpus, so a stale one is fixed rather than asked about. So the unit of scheduling is a TARGET, one per atlas and one per corpus source, and a card never asks.
 *
 * ## Why the id is derived here rather than written anywhere
 *
 * A definition file lives outside the repository (`live/automation/definitionStore.ts`), so nothing gates what
 * lands in that directory and a hand-written id is a hand-maintained roster. Deriving the id from the
 * target is what lets a registrar reconcile: the same atlas always resolves to the same row, so a second
 * registration updates rather than duplicates, and an atlas that landed in the repository since the last
 * pass appears as a MISSING row rather than as silence.
 *
 * The two prefixes are distinct on purpose. `github` is both an atlas and a corpus source and they resync
 * by different verbs on different clocks, so one id for the pair would collapse two schedules into one.
 */
import { type CorpusSource } from "../../corpus/types.js";
import { ALL_CORPUS_SOURCES } from "../../integrations/corpusSources.js";

/** The prefix every atlas row's id carries. */
const ATLAS_ID_PREFIX = "resync-atlas-";

/** The prefix every corpus row's id carries. */
const CORPUS_ID_PREFIX = "resync-corpus-";

/** One thing a scheduled resync brings current. */
export type ResyncTarget =
  { readonly kind: "atlas"; readonly platform: string } | { readonly kind: "corpus"; readonly source: CorpusSource };

/**
 * The recipe id one target's row is registered under.
 *
 * @param target the atlas or corpus source being scheduled
 * @returns the stable id, the same for a given target on every pass
 */
export function resyncRecipeId({ target }: { readonly target: ResyncTarget }): string {
  if (target.kind === "atlas") {
    return `${ATLAS_ID_PREFIX}${target.platform}`;
  }
  return `${CORPUS_ID_PREFIX}${target.source}`;
}

/**
 * Whether a recipe id is one this registrar owns, so an unrelated row on the same install is left alone.
 *
 * @param recipeId the id read off a definition file
 * @returns true when the id carries one of the two managed prefixes
 */
export function isManagedResyncId({ recipeId }: { readonly recipeId: string }): boolean {
  return recipeId.startsWith(ATLAS_ID_PREFIX) || recipeId.startsWith(CORPUS_ID_PREFIX);
}

/**
 * Whether a recipe id is a CORPUS resync row's — the rows every queue card and the pull-requests page read from.
 *
 * An exact match against the ids this build derives, never the prefix alone: a definition file is written
 * outside the repository, and a hand-written `resync-corpus-<free text>` would otherwise carry free text onto the
 * stopped-sync card, where the posting form refuses the uncited reference and no card lands.
 *
 * @param recipeId the id read off a definition file or a silent row
 * @returns true when the id is one corpus source's resync row
 */
export function isCorpusResyncId({ recipeId }: { readonly recipeId: string }): boolean {
  return ALL_CORPUS_SOURCES.some((source) => recipeId === `${CORPUS_ID_PREFIX}${source}`);
}

/**
 * How a target reads in a line a person sees.
 *
 * @param target the atlas or corpus source
 * @returns `atlas trelica` or `corpus notion`
 */
export function resyncTargetLabel({ target }: { readonly target: ResyncTarget }): string {
  if (target.kind === "atlas") {
    return `atlas ${target.platform}`;
  }
  return `corpus ${target.source}`;
}
