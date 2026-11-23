/**
 * The narrow set of steps only the owner's hands can take — the ONE list every refusal and usage text names.
 *
 * `skills/hand/SKILL.md` widens the set to carry an access ask to its holder (at Acme the fleet has admin on the slopweaver repository and read on the rest, so a fact behind
 * a permission wall is reached by asking whoever holds the access). The refusal in `./errors.ts` and `hand post
 * --help` still listed the three kinds before it, because each spelled the set out by hand. Both now render it from
 * here, and `src/__tests__/unit/hand/handKinds.test.ts` holds the skill's sentence to the same list.
 *
 * Pure: constants and one join.
 */

/** Each kind of step only the owner's hands can take, in the order every surface names them. */
export const HAND_STEP_KINDS = [
  "a sign-in",
  "an approval",
  "a code-owner pick",
  "asking an access holder for named access",
] as const;

/**
 * The set as one phrase, comma-separated, for a refusal or a usage line.
 *
 * @returns every kind joined by commas, in order
 */
export function handStepKindsPhrase(): string {
  return HAND_STEP_KINDS.join(", ");
}
