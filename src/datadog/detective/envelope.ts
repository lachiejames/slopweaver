/**
 * Unwrapping the SDK's optional envelope fields, with the absence named. Pure.
 *
 * ## Why this is a function and not a destructured default
 *
 * Every list and every attribute bag on a Datadog response is typed OPTIONAL by the SDK — `data?`,
 * `dashboards?`, `indexes?`, `attributes?` — so each one has to be answered before it can be read. Under
 * `no-silent-fallback` (`.claude/rules/typescript-patterns.md`) the operator that used to answer them is
 * refused, and the obvious replacement is a destructured default: `const { data = [] } = response`.
 *
 * **That replacement is not equivalent, and the difference is a crash.** A destructured default fires only
 * on `undefined`. `??` also answered `null`. The SDK's TYPE says these fields are optional rather than
 * nullable, so a `null` off the wire is a type the compiler already believes cannot happen — which is
 * exactly the shape that reaches production unnoticed, because nothing between the JSON and the `.map` call
 * checks. A `null` `data` destructures to `null` and `null.map` throws.
 *
 * So the substitution is a named call that answers BOTH absences, which is what the ruling asked for: the
 * line of code says a substitution is happening, and it happens for the same inputs the operator covered.
 */

/**
 * The value, or the stated stand-in when the response carried none.
 *
 * Answers `null` and `undefined` alike, deliberately — see this module's own header for why the narrower
 * destructured default is a crash rather than a style choice.
 *
 * @param value what the response carried, absent when the endpoint sent no such field
 * @param absent what to read instead, which the caller names at the call site
 * @returns the value, or `absent`
 */
export function presentOr<T>({ value, absent }: { value: T | null | undefined; absent: T }): T {
  if (value == null) {
    return absent;
  }
  return value;
}
