/**
 * The field readers the seats reader and the capacity reader share: a key the verb leaves off a row reads as absent,
 * and a present one that will not read is a shape that moved. A sibling of `./readNow.ts`, under every rule its
 * module doc states.
 */

import { type Bag, bool, instant, num, str } from "../../lib/bag";

/**
 * A field the verb leaves off a row when it has nothing to say: a missing key is `undefined`, a string is itself, and
 * any other value is `false`, a shape that moved.
 *
 * @returns the string, `undefined`, or `false`
 */
export function optionalStr({ bag, key }: { bag: Bag; key: string }): string | undefined | false {
  if (!Object.hasOwn(bag, key)) {
    return undefined;
  }
  const value = str({ bag, key });
  if (value === undefined) {
    return false;
  }
  return value;
}

/**
 * An instant the verb leaves off a row when it has none: a missing key is `undefined`, an exact instant is itself, and
 * any other value is `false`, a shape that moved.
 *
 * @returns the instant, `undefined`, or `false`
 */
export function optionalInstant({ bag, key }: { bag: Bag; key: string }): string | undefined | false {
  if (!Object.hasOwn(bag, key)) {
    return undefined;
  }
  const value = instant({ bag, key });
  if (value === undefined) {
    return false;
  }
  return value;
}

/**
 * A flag the verb leaves off a row when it does not know it: a missing key is `undefined`, a boolean is itself, and
 * any other value is `"moved"`, a shape that moved — not `false`, which is a reading here.
 *
 * @returns the flag, `undefined`, or `"moved"`
 */
export function optionalBool({ bag, key }: { bag: Bag; key: string }): boolean | undefined | "moved" {
  if (!Object.hasOwn(bag, key)) {
    return undefined;
  }
  const value = bool({ bag, key });
  if (value === undefined) {
    return "moved";
  }
  return value;
}

/**
 * A whole minute or a count the verb printed (`watchRowSlice`'s `int().nonnegative()`): a fraction or a negative is a
 * shape that moved, not a figure.
 *
 * @returns the count, or `undefined`
 */
export function count({ bag, key }: { bag: Bag; key: string }): number | undefined {
  const value = num({ bag, key });
  if (value === undefined || value < 0 || !Number.isInteger(value)) {
    return undefined;
  }
  return value;
}
