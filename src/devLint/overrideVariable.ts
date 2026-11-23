/**
 * What an OVERRIDE VARIABLE's name looks like — the one criterion `escape-hatch` and `hatch-release` share.
 *
 * Both gates once matched only `SLOPWEAVER_ALLOW_<SUFFIX>` (plus the door's own list), so two real
 * break-glasses sat outside the register with nothing to say so: `ALLOW_FABLE_OVERRIDE`, the owner's own name for the
 * Fable spawn hatch, and `SLOPWEAVER_RESPONDER_ALLOW_OPEN`, which let anyone in the workspace drive the bot.
 * Neither name was wrong; the gates' criterion was narrower than the thing it claimed to police.
 *
 * **The criterion**: an upper-case, underscore-joined name of at least two components, one of which is
 * exactly `ALLOW` or `OVERRIDE`. It is a name's SHAPE, never a list, so the next override nobody declared is
 * caught the day it is written. `ALLOWED_X` and `OVERRIDES` are not components, deliberately: neither is an
 * opening, and matching a substring would refuse ordinary constants.
 */

/** An upper-case underscore-joined name, at least two components. Unambiguous on `_`, so no backtracking. */
const UPPER_SNAKE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

/** The two components that make a name an opening rather than a setting. */
const OPENING_COMPONENTS: ReadonlySet<string> = new Set(["ALLOW", "OVERRIDE"]);

/**
 * Whether a name is shaped like an override variable.
 *
 * @param name a candidate environment-variable name, exactly as written
 * @returns true when it is upper snake case and one of its components is `ALLOW` or `OVERRIDE`
 */
export function isOverrideVariableName({ name }: { name: string }): boolean {
  return UPPER_SNAKE.test(name) && name.split("_").some((component) => OPENING_COMPONENTS.has(component));
}
