/**
 * Canonical "turn a caught `unknown` into a string" helper. Routing every catch through one seam means
 * a future change (surfacing `error.cause`, stripping a noisy prefix) lands in one place.
 *
 * `instanceof Error` is deliberate over reading `.message` off any object: a non-Error throw (a string,
 * a number, a plain `{ code }` errno) stringifies predictably rather than yielding `undefined`.
 *
 * A value `String()` itself throws on — a null-prototype object, a hostile `toString` — gets its tag instead,
 * and one whose tag throws too gets a fixed phrase, because this runs inside a `catch` and a throw here escapes
 * the very handler reporting the first one. The Error branch is guarded the
 * same way and returns its `message` only when it really is a string: a Proxy whose `getPrototypeOf` trap throws
 * fails `instanceof` itself, and an Error whose `message` is a Symbol throws in the caller's template instead. So whatever was thrown, what comes back is a string.
 *
 * @param error the caught unknown
 * @returns a display string for it
 */
export function errorMessage({ error }: { error: unknown }): string {
  const unprintable = "a thrown value that could not be printed";
  try {
    if (error instanceof Error) {
      const message: unknown = error.message;
      return typeof message === "string" ? message : unprintable;
    }
  } catch {
    return unprintable;
  }
  try {
    return String(error);
  } catch {
    try {
      return Object.prototype.toString.call(error);
    } catch {
      return unprintable;
    }
  }
}
