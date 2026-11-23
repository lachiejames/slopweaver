/**
 * The contract one standing row carries, apart from either roster that declares one: the generic rows every
 * install receives (`./standingRows.ts`) and the per-repository rows an install registers
 * (`./teamStandingRows.ts`). `./declaredStandingRows.ts` composes the two.
 */
import type { RecipeDefinition } from "./definition.js";

/** One row an install is required to carry, and why a reader should care that it is gone. */
export interface StandingRow {
  /** The row exactly as it should stand in the store. */
  readonly definition: RecipeDefinition;
  /**
   * Every definition an earlier build declared for this recipe id, exactly as that build wrote it.
   *
   * A stored row equal to one of these is still a build's own untouched write, so `automation register-standing`
   * brings it forward to {@link StandingRow.definition}. A row equal to none of them is somebody's edit — a
   * pause, a hold, a changed argv — and stays exactly as it is. Omitted while a declaration has never changed.
   */
  readonly supersedes?: readonly RecipeDefinition[];
  /** What stops happening when this row is absent, in the words a reader needs to judge the gap. */
  readonly why: string;
}
