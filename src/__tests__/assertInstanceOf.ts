/**
 * Assert a caught value is an instance of a specific class, narrowing it for TypeScript rather than only for
 * vitest.
 *
 * `expect(x).toBeInstanceOf(Ctor)` reports the right failure but narrows nothing, so every field read after
 * it needed its own `(x as Ctor).field` cast. This throws the SAME way that matcher does (so the test's
 * failure message is unchanged) and additionally narrows `value` for everything that follows.
 *
 * Two positional parameters, not an options object: `asserts value is T` requires `value` to be a plain
 * parameter TypeScript can name, the same TS1230 constraint `isOneOf` in `src/lib/parsers.ts` is exempt for.
 */
import { expect } from "vitest";

/**
 * Assert `value` is an instance of `ctor`, throwing vitest's own assertion failure otherwise.
 *
 * @param value the caught value to check
 * @param ctor the class it must be an instance of
 * @returns nothing on success; narrows `value` to `T` for the caller's subsequent statements
 */
export function assertInstanceOf<T>(value: unknown, ctor: new (...args: never[]) => T): asserts value is T {
  expect(value).toBeInstanceOf(ctor);
}
