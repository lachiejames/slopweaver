/**
 * The query over the standing-row register: which required rows the store does not hold at all, and the line
 * `automation due` prints for each. The register itself — the generic rows of `./standingRows.ts` plus the
 * rows of every team repository this install registered — is resolved by `./declaredStandingRows.ts` and
 * passed in, so this stays pure.
 */
import type { RecipeDefinition } from "./definition.js";
import type { StandingRow } from "./standingRow.js";

/** One required row that is not in the store at all. */
export interface StandingRowAbsence {
  readonly recipeId: string;
  /** What stops happening while it is gone — the row's own {@link StandingRow.why}. */
  readonly why: string;
}

/**
 * Which required rows the store does not hold at all.
 *
 * ABSENCE only. A row that is present but disabled, held or hand-edited is a row a reader can already see in
 * `automation due`, and each of those states is somebody's deliberate act — pausing must stay possible, a hold
 * outranks every boolean, and an edit is not this build's to judge. Collapsing them into "missing" would
 * make the one state that is definitely a defect indistinguishable from three that are not.
 *
 * A file the definition parser REFUSED is not an absence either, and it must not be: the id is occupied by
 * something, and reporting it as missing would invite a create over somebody's half-written file — the exact
 * hole `live/resync/registrationStore.ts` closed three times. The caller passes those ids as `unreadable`.
 *
 * @param declared the rows this build requires
 * @param existing every row the store parsed
 * @param unreadable the recipe ids whose file is present and did not parse — occupied, never absent
 * @returns one entry per required row that is nowhere, ordered by recipe id
 */
export function absentStandingRows({
  declared,
  existing,
  unreadable = [],
}: {
  readonly declared: readonly StandingRow[];
  readonly existing: readonly RecipeDefinition[];
  readonly unreadable?: readonly string[];
}): readonly StandingRowAbsence[] {
  const present = new Set(existing.map((definition) => definition.recipeId));
  const occupied = new Set(unreadable);
  return declared
    .filter((row) => !present.has(row.definition.recipeId) && !occupied.has(row.definition.recipeId))
    .map((row) => ({ recipeId: row.definition.recipeId, why: row.why }))
    .toSorted((left, right) => left.recipeId.localeCompare(right.recipeId));
}

/**
 * The line `automation due` prints for one absent required row.
 *
 * It names the fix, because a report that says only that something is wrong costs the reader the lookup
 * this whole mechanism exists to remove (`.claude/rules/error-handling.md`: a refusal that says it is blocked
 * without saying why does not help the agent).
 *
 * @param absence the required row that is nowhere
 * @returns the line to print
 */
export function absentStandingRowLine({ absence }: { readonly absence: StandingRowAbsence }): string {
  return (
    `!! ${absence.recipeId} · DECLARED by this build and ABSENT from the store — ${absence.why}. ` +
    "Write it back with `slopweaver automation register-standing`"
  );
}
