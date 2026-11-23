/**
 * Naming an ABSENT value, and the one spelling for absence BY DESIGN.
 *
 * A value that must exist is read directly, or its absence is refused with a typed error at the read naming
 * what that absence likely means, and a malformed value gets a DIFFERENT error; no `null` is carried on
 * (failing loudly and early is always desirable). An invariant is an honest `x!`.
 *
 * A field its record declares optional or nullable is absent by design, and {@link unsetFieldAsNull} reads it:
 * its key must be one the record's own type declares optional or nullable, so a REQUIRED key does not
 * compile, and a required value cannot hide behind it.
 *
 * `absentAsNull`, `absentAs`, `absentAsNumber` and `absentAsEmpty` are pass-through fallback helpers, so
 * `no-silent-fallback` counts every call to one as a `fallback-helper` site on its debt list, exactly like
 * the `??` it replaced. Never add a call. They stand only until the standing calls are paid down, one domain
 * at a time, each read on its own merits: typed error, honest `x!`, or `unsetFieldAsNull`.
 */

/**
 * An optional provider field, carried forward as `null` when the provider omitted it.
 *
 * @param value the field as the response schema left it
 * @returns the value, or `null` when it was absent — never a substituted one
 */
export function absentAsNull<T>({ value }: { value: T | undefined }): T | null {
  if (value === undefined) {
    return null;
  }
  return value;
}

/**
 * An absent or null field rendered for a human, or a stated default the caller names at the call, with the
 * word the caller chose for "there is none".
 *
 * The word is the caller's because it is the only honest part: "never", "none" and "?" mean different things
 * about a last-published date, a workflow status and a start time, and one shared default would be wrong
 * about at least two of them.
 *
 * @param value the field as the response schema left it
 * @param whenAbsent the word to print instead — say what the absence MEANS, never a blank
 * @returns the value, or the caller's word
 */
export function absentAs({ value, whenAbsent }: { value: string | null | undefined; whenAbsent: string }): string {
  if (value === null || value === undefined) {
    return whenAbsent;
  }
  return value;
}

/**
 * An absent or null number, with the number the caller chose for "there is none" — {@link absentAs}'s twin.
 *
 * The number is the caller's for the same reason the word is there: a missing count reads as `0`, a missing
 * page budget as `1` and a missing window as `7`, and one shared default would be wrong about two of them.
 *
 * @param value the number as its source left it
 * @param whenAbsent the number to use instead — say what the absence MEANS
 * @returns the value, or the caller's number — a present `0` is kept, never substituted
 */
export function absentAsNumber({
  value,
  whenAbsent,
}: {
  value: number | null | undefined;
  whenAbsent: number;
}): number {
  if (value === null || value === undefined) {
    return whenAbsent;
  }
  return value;
}

/**
 * An optional list, carried forward as an empty list when its source omitted it or sent null.
 *
 * @param value the list as its source left it
 * @returns the list itself, or a fresh empty one — never a shared instance
 */
export function absentAsEmpty<T>({ value }: { value: readonly T[] | null | undefined }): readonly T[] {
  if (value === null || value === undefined) {
    return [];
  }
  return value;
}

/** A key `R` declares optional or nullable; a REQUIRED key resolves to a type whose one property names the refusal. */
type UnsetKey<R, K extends keyof R> = K extends unknown ? UnsetOne<R, K> : never;

/** One key: optional (its own `Partial` satisfies it), or typed to admit `undefined`/`null` but never `unknown`. */
type UnsetOne<R, K extends keyof R> =
  Partial<Pick<R, K>> extends Pick<R, K>
    ? K
    : unknown extends R[K]
      ? Refused<K>
      : undefined extends R[K]
        ? K
        : null extends R[K]
          ? K
          : Refused<K>;

/** The type a REQUIRED key resolves to, whose one property is the refusal a compile error prints. */
type Refused<K> = { readonly "declared REQUIRED: read it directly, or refuse its absence with a typed error": K };

/**
 * A field its record's own type declares optional or nullable, carried forward as `null` when unset — the one
 * spelling for absence BY DESIGN. A required key does not compile: a value that must exist is read directly, or
 * its absence is refused with a typed error at the read.
 *
 * @param record the record, or nothing when the record itself is absent by design
 * @param key a key the record's type declares optional or nullable
 * @returns the field, or `null` when the record or the field is unset — never a substituted value
 */
export function unsetFieldAsNull<R extends object, K extends keyof R>({
  record,
  key,
}: {
  record: R | null | undefined;
  key: K & UnsetKey<R, K>;
}): NonNullable<R[K]> | null {
  if (record === null || record === undefined) {
    return null;
  }
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  return value;
}
