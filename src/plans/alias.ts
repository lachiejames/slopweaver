/**
 * The shape of a plan alias, decided in one leaf module so the register's row decode and its removal history both
 * read it without either importing the other.
 */

/** A neutral label: lowercase letters, digits and single hyphens. An `@` or a dot cannot survive this. */
export const ALIAS_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Longest alias worth having — long enough to be descriptive, short enough to fit a sidebar row. */
export const ALIAS_MAX_LENGTH = 32;

/**
 * Whether a string is a well-formed alias: the ONE place that shape is decided.
 *
 * Exported because an alias is a FILENAME wherever per-destination state is kept — `codex-quota/<alias>.json`
 * is the first — and a cache that trusted an unchecked string would let a `../` or a separator address a file
 * nobody named. The register refuses such an alias at the door, and the cache re-asks rather than assuming
 * its caller came through the register.
 *
 * @param alias the candidate label
 * @returns whether it is lowercase letters, digits and single hyphens, within the length limit
 */
export function isPlanAlias({ alias }: { alias: string }): boolean {
  return ALIAS_PATTERN.test(alias) && alias.length <= ALIAS_MAX_LENGTH;
}
