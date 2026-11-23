/**
 * What a LINT gate must declare before it may refuse — the vocabulary behind the four lines every
 * `dev lint` refusal ends in.
 *
 * ## Why this is a second type rather than an `EscapeHatch`
 *
 * A lint gate's refusal carries the same four lines as every other, with line three saying honestly that
 * there is no override and naming what a fix looks like instead.
 *
 * That is a different shape from `../../hatch/types.ts`'s `EscapeHatch`, and the difference is load-bearing.
 * A `HatchKey` describes a mechanism that can actually be OPENED, and `hatchIncantation` promises to spell
 * one; a lint gate has nothing to spell. Adding a `"none"` key would make `key`, `reader`, `lane` and
 * `hatchIncantation` dishonest all at once for the sake of one shared table. The existing precedent for a
 * refusal with no way through is the door's `hold`, which names the correction instead of going quiet
 * (`../../admit/doorRefusal.ts`) — this is that idea, typed for the lint surface.
 *
 * ## "No RUN-TIME override" is the exact claim, and the word matters
 *
 * Six gates already carry a reason-bearing SOURCE marker — `named-object-params-exempt`,
 * `max-lines-exempt`, `max-file-lines-exempt` (effective only with a signed row in the file-size tradeoff
 * register), `home-safety-exempt`, `sync-child-timeout-exempt` and
 * `scheduler-bypass`'s `devlint: sdk-factory`. A refusal that said flatly "there is no override" would be false in front of an
 * operator who is looking at one. So line three refuses a RUN-TIME override and points at the source, and a
 * gate with a marker names it in {@link LintGateDeclaration.correction}.
 */

/**
 * One lint gate's standing refusal copy. Every field is required, so a gate cannot ship a refusal that
 * leaves a reader without the exceptions or without a fix.
 */
export interface LintGateDeclaration {
  /** The gate's own name as `dev lint` prints it — `epoch-arithmetic`, `whole-file-json`. */
  readonly gate: string;
  /**
   * What it caught and WHY, in one clause that reads after "because the `<gate>` gate". Never the gate's own
   * name again: a refusal that only restates its label is the defect this whole shape exists to close.
   */
  readonly caught: string;
  /**
   * The shapes that are legitimately outside this gate's criterion, or the reviewed source marker that
   * exempts one. Non-empty by TYPE — a criterion whose author could name no legitimate neighbour is one
   * nobody can weigh.
   */
  readonly exceptions: readonly [string, ...(readonly string[])];
  /**
   * What a fix actually looks like, concretely enough to act on. A required field rather than prose scraped
   * off the end of a gate: most gates carried none, and the ones that did put it in different places and
   * sometimes varied it by finding, so scraping could never make the promise structural.
   */
  readonly correction: string;
}
