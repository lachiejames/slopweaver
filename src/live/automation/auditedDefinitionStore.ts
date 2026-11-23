/**
 * The AUDITED view of the recipe definitions — the view a REPORT takes (`automation due`, `automation status`),
 * never one that fires, claims or seats a row.
 *
 * It is the lifted view (`./definitionStore.ts`) with every standing owner hold's `placedByState` derived
 * (`./ownerHoldPlacedBy.ts`). A separate module so the scheduler's store never imports the owner-words reader:
 * resolving an anchor can parse a whole transcript, and whether a hold stands does not depend on it.
 */
import { resolveRawWords } from "../../handover/hisWordsResolve.js";
import { claudeProjectsDir } from "../../transcripts/source.js";
import { loadLiftedRecipeDefinitions, type RecipeDefinitionRoster } from "./definitionStore.js";
import { type ResolveOwnerWords, withOwnerHoldPlacedByState } from "./ownerHoldPlacedBy.js";

/**
 * Load one home's definitions in the audited view. Each distinct anchor is read once per roster.
 *
 * @param home the state home whose definitions, board and talk records are read
 * @param resolveOwnerWords reads the owner's record at one anchor; `resolveRawWords` over this home when not passed
 * @returns the lifted roster, each standing owner hold carrying whether the owner's naming words are on it
 */
export function loadAuditedRecipeDefinitions({
  home,
  resolveOwnerWords,
}: {
  readonly home: string;
  readonly resolveOwnerWords?: ResolveOwnerWords | undefined;
}): RecipeDefinitionRoster {
  const roster = loadLiftedRecipeDefinitions({ home });
  let resolve: ResolveOwnerWords = ({ anchor }) => resolveRawWords({ anchor, home, projectsDir: claudeProjectsDir() });
  if (resolveOwnerWords !== undefined) {
    resolve = resolveOwnerWords;
  }
  const read = new Map<string, ReturnType<ResolveOwnerWords>>();
  const memoised: ResolveOwnerWords = ({ anchor }) => {
    const seen = read.get(anchor);
    if (seen !== undefined) {
      return seen;
    }
    const fresh = resolve({ anchor });
    read.set(anchor, fresh);
    return fresh;
  };
  return {
    ...roster,
    definitions: roster.definitions.map((definition) =>
      withOwnerHoldPlacedByState({ definition, resolveOwnerWords: memoised }),
    ),
  };
}
