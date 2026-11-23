/**
 * The two flag reads every moded `profile` verb shares — `standing` and `steers` each refuse a flag another of its
 * modes owns, and each reads a string flag as typed or absent. Each keeps its own error union: only the reads are
 * shared.
 */

/** A parsed flag bag, as `parseFlags` hands it back. */
export type ModeFlagValues = Readonly<Record<string, unknown>>;

/**
 * A string flag's value, or `undefined` when it was not typed.
 *
 * @returns the typed value, never a default
 */
export function stringFlag({ values, name }: { values: ModeFlagValues; name: string }): string | undefined {
  const value = values[name];
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

/**
 * Every typed flag a mode does not take. `--home` and `--now` belong to every mode.
 *
 * @param allowed the flags this mode owns, without their `--`
 * @returns the foreign flags in the order typed, empty when the mode owns them all
 */
export function foreignFlagsOf({
  values,
  allowed,
}: {
  values: ModeFlagValues;
  allowed: readonly string[];
}): readonly string[] {
  const own = new Set([...allowed, "home", "now"]);
  return Object.keys(values).filter((name) => values[name] !== undefined && !own.has(name));
}
