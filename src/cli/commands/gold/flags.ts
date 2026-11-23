/**
 * The two reads every `gold` verb makes of a parsed flag set. Pure: values in, a string or a boolean out.
 *
 * Its own module rather than a copy inside each verb, because three verbs read flags the same way and
 * `../autonomy/list.ts`'s private copy of this helper is already duplicated three times next door.
 */

/**
 * A flag's value, or undefined when it was not supplied.
 *
 * @param values the parsed flag values
 * @param name the flag's name without its dashes
 * @returns the string the caller passed, or undefined
 */
export function textFlag({
  values,
  name,
}: {
  values: Readonly<Record<string, unknown>>;
  name: string;
}): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Whether a boolean flag was supplied.
 *
 * @param values the parsed flag values
 * @param name the flag's name without its dashes
 * @returns true only when the parser recorded it as present
 */
export function boolFlag({ values, name }: { values: Readonly<Record<string, unknown>>; name: string }): boolean {
  return values[name] === true;
}

/**
 * A flag's value, or the substitute to use when the caller did not supply one.
 *
 * An `if` rather than `??`: the `no-silent-fallback` rule wants the absent case named, and here the name
 * is the `fallback` parameter — every call site says out loud what it stands in.
 *
 * @param values the parsed flag values
 * @param name the flag's name without its dashes
 * @param fallback what to use when the flag was absent
 * @returns the caller's string, or the fallback
 */
export function textFlagOr({
  values,
  name,
  fallback,
}: {
  values: Readonly<Record<string, unknown>>;
  name: string;
  fallback: string;
}): string {
  const value = textFlag({ name, values });
  if (value === undefined) {
    return fallback;
  }
  return value;
}
