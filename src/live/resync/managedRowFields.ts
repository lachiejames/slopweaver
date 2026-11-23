/**
 * Whose each part of a stored managed resync row is: which kinds the registrar may write over, and which
 * fields only the operator writes, so an update carries them rather than deriving them.
 *
 * Split out of `./registrationPlan.ts`, which decides what to do with a row; this file decides what of the
 * stored row survives the decision. Pure: rows in, a verdict or a row out.
 */
import type { RecipeDefinition } from "../automation/definition.js";
import { RESYNC_KIND } from "../automation/kinds.js";
import { VERB_RUN_KIND } from "../automation/verbRun.js";

/** The two kinds a managed resync row may be written on — see `./registrationPlan.ts#resyncDefinitionFor`. */
const MANAGED_KINDS: ReadonlySet<string> = new Set([RESYNC_KIND, VERB_RUN_KIND]);

/**
 * Whether a row's `kind` is somebody's hand edit rather than a kind this registrar may write over.
 *
 * A row is written on {@link RESYNC_KIND} or {@link VERB_RUN_KIND} by target, and a row a build predating
 * the seat cutover wrote carries `verb-run` whatever its target, so those two are the kinds a managed row
 * may legitimately be found on, in either direction — which is what lets a pass SELF-HEAL a reverted row
 * into an update rather than reporting it as somebody's edit, and move a compile-only atlas's seated row
 * onto the tick (or back, when a descriptor starts walking a provider). Anything else is an edit no pass
 * made — the definition parser accepts `investigate` on a `resync-*` row, and `automation run-due` then reports
 * it as "not mine" and never dispatches it while the freshness page still reads current (a review found
 * exactly that). That row is reported, never rewritten.
 *
 * @param current the row already in the store
 * @param wanted the row this build would write
 * @returns true when the stored kind is neither managed kind
 */
export function driftedKind({
  current,
  wanted,
}: {
  readonly current: RecipeDefinition;
  readonly wanted: RecipeDefinition;
}): boolean {
  return current.kind !== wanted.kind && !MANAGED_KINDS.has(current.kind);
}

/**
 * The derived row with every field only the operator writes carried over from the stored one: `enabled`,
 * `hold`, `channelApprovals` and `names`. An absent optional stays absent, so an unheld row writes no `hold` key.
 *
 * Writing the derived row over them lifted a failing row's hold on the next cadence change, the one thing a
 * hold exists to prevent.
 *
 * @param current the row already in the store, whose operator fields are kept
 * @param wanted the row this build derives
 * @returns the row an update writes
 */
export function withOperatorFields({
  current,
  wanted,
}: {
  readonly current: RecipeDefinition;
  readonly wanted: RecipeDefinition;
}): RecipeDefinition {
  const carried: RecipeDefinition = { ...wanted, enabled: current.enabled };
  if (current.hold !== undefined) {
    return withChannelApprovals({ current, definition: { ...carried, hold: current.hold } });
  }
  return withChannelApprovals({ current, definition: carried });
}

/** One definition with the stored row's channel approvals and names, each only when it has any. */
function withChannelApprovals({
  current,
  definition,
}: {
  readonly current: RecipeDefinition;
  readonly definition: RecipeDefinition;
}): RecipeDefinition {
  let carried = definition;
  if (current.channelApprovals !== undefined) {
    carried = { ...carried, channelApprovals: current.channelApprovals };
  }
  if (current.names !== undefined) {
    carried = { ...carried, names: current.names };
  }
  return carried;
}
