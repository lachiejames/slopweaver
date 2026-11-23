/**
 * Reading fields off a verb's JSON payload, with no silent substitution anywhere.
 *
 * Every accessor here answers `undefined` for an absent or wrong-typed field, and every caller is expected
 * to branch on that rather than coalesce it. The house rule banning `??` is scoped by
 * its gate to `src/`, `eval/` and `hooks/`, so nothing here is machine-checked — and this is precisely the
 * place where breaking it would cost the most. A `?? 0` on a token count renders a confident zero for a
 * field the verb stopped emitting, which is the failure the whole console is built to make impossible.
 */

/** A JSON object, as far as anything here needs to know. */
export type Bag = Record<string, unknown>;

/**
 * Is this a plain object we can read keys off?
 *
 * @returns true for an object that is neither null nor an array
 */
export function isBag(value: unknown): value is Bag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A finite number at `key`.
 *
 * @returns the number, or `undefined` when the field is absent, not a number, or `NaN`/infinite
 */
export function num({ bag, key }: { bag: Bag; key: string }): number | undefined {
  const value = bag[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

/**
 * A string at `key`.
 *
 * @returns the string, or `undefined` when the field is absent or not a string
 */
export function str({ bag, key }: { bag: Bag; key: string }): string | undefined {
  const value = bag[key];
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

/**
 * An instant at `key`, exactly as `toISOString()` prints one. A string that does not round-trip (an impossible calendar day, which
 * `Date.parse` rolls into the next month, or no date at all) is not an instant a verb wrote.
 *
 * @returns the instant, or `undefined` when the field is absent, not a string, or not a printed instant
 */
export function instant({ bag, key }: { bag: Bag; key: string }): string | undefined {
  const value = str({ bag, key });
  if (value === undefined || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    return undefined;
  }
  return value;
}

/**
 * A nested object at `key`.
 *
 * @returns the object, or `undefined` when the field is absent or is not one
 */
export function sub({ bag, key }: { bag: Bag; key: string }): Bag | undefined {
  const value = bag[key];
  if (isBag(value)) {
    return value;
  }
  return undefined;
}

/**
 * An array of objects at `key`.
 *
 * `every` SKIPS a sparse array's holes, so `new Array(1)` passed this check and then handed every caller an
 * `undefined` where it had been promised a `Bag` — a thrown `TypeError` inside a reader, which blanks the
 * whole page rather than refusing the one document. Found by an adversarial review pass. Reading the hole as
 * an ordinary element closes it for every caller at once, which is why the fix lives here rather than in the
 * one reader that was hit.
 *
 * Two review passes then walked the same class one step further each time, and the second is why the read
 * sits inside a `try`. `Object.assign([null], { filter: null })` is an array by `Array.isArray` whose own
 * `filter` is not callable, so a `.filter`/`for…of` walk threw exactly the way the hole did — which an
 * indexed loop fixes. `Object.defineProperty([], "0", { get() { throw … } })` is an array whose INDEX
 * throws, which an indexed loop does not, and an earlier draft of this comment claimed an index was the one
 * thing an array cannot shadow. It was wrong. Nothing `JSON.parse` returns carries either shape, and the
 * point is that this function does not have to know: every unreadable list is `undefined`, never a throw
 * escaping into a reader, and a caller's guarantee that cannot be stated as a bound is not a guarantee.
 *
 * @returns the rows, or `undefined` when the field is absent, is not an array, or will not read as one
 */
export function bags({ bag, key }: { bag: Bag; key: string }): readonly Bag[] | undefined {
  const value = bag[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const rows: Bag[] = [];
  try {
    for (let index = 0; index < value.length; index += 1) {
      const row: unknown = value[index];
      if (!isBag(row)) {
        return undefined;
      }
      rows.push(row);
    }
  } catch {
    return undefined;
  }
  return rows;
}

/**
 * An array of strings at `key`, narrowed rather than asserted.
 *
 * `Array.isArray` over an `unknown` narrows to `any[]`, so a caller that checks the element types inline
 * still has to write `value as readonly string[]` to get a typed value back — an assertion oxlint
 * correctly calls unnecessary, because `any[]` already accepts the target. Building the list here returns
 * the narrow type the caller wanted, and the `any` never escapes this file.
 *
 * @returns the lines, or `undefined` when the field is absent, is not an array, or holds a non-string
 */
export function strings({ bag, key }: { bag: Bag; key: string }): readonly string[] | undefined {
  const value = bag[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: string[] = [];
  for (const line of value) {
    if (typeof line !== "string") {
      return undefined;
    }
    out.push(line);
  }
  return out;
}

/**
 * A boolean at `key`.
 *
 * @returns the flag, or `undefined` when the field is absent or not a boolean — never a coalesced `false`
 */
export function bool({ bag, key }: { bag: Bag; key: string }): boolean | undefined {
  const value = bag[key];
  if (typeof value === "boolean") {
    return value;
  }
  return undefined;
}

/**
 * Every element of a list through one reader — never a shorter list.
 *
 * @param list the elements, or `undefined` when the field was not a list of objects
 * @param read refuses an element by answering `undefined`
 * @returns every element read, or `undefined` when the list is absent or any element refuses
 */
export function every<T>({
  list,
  read,
}: {
  list: readonly Bag[] | undefined;
  read: (bag: Bag) => T | undefined;
}): T[] | undefined {
  if (list === undefined) {
    return undefined;
  }
  const out: T[] = [];
  for (const bag of list) {
    const value = read(bag);
    if (value === undefined) {
      return undefined;
    }
    out.push(value);
  }
  return out;
}

/**
 * A field that is a string or `null` — the verb's way of saying absent.
 *
 * @returns the string, `undefined` for `null`, or `false` when the field is missing or any other type
 */
export function nullableStr({ bag, key }: { bag: Bag; key: string }): string | undefined | false {
  const value = bag[key];
  if (value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  return false;
}

/**
 * A field that is a finite number or `null`.
 *
 * @returns the number, `undefined` for `null`, or `false` when the field is missing or any other type
 */
export function nullableNum({ bag, key }: { bag: Bag; key: string }): number | undefined | false {
  const value = bag[key];
  if (value === null) {
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return false;
}
