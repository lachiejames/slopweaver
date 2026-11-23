/**
 * Whether a value is PLAIN JSON DATA — exactly what `JSON.stringify` writes and `JSON.parse` gives back, so a row
 * event holding it cannot lose a field between memory and the journal.
 *
 * The write path's read-back (`./rowEvent.ts`) compares the event with what decoded off disk, but both sides of
 * that comparison are serialised, so anything serialisation drops vanishes from both and the check passes over
 * a lost field. Four such shapes were found one at a time on the `tagged` event — an extra pair field, an extra
 * top-level field, a named array property, a symbol-keyed field — and each is a case of one class: a value that is not plain data. So the class is refused before
 * the schema runs, for every event kind, rather than each shape being patched where it was found.
 *
 * An `undefined` object property is allowed: it is how an absent optional field is spelt in memory, and it is
 * absent on disk too, so there is no value to lose. Refusing it would refuse every writer that spreads an optional
 * field it did not have, for a difference (`"k" in event`) no reader of the journal asks about.
 *
 * Pure: a walk over one value. No filesystem, no clock.
 */

/**
 * Every place a value stops being plain JSON data, each named by its path.
 *
 * @param value the value to walk
 * @param path where it sits, for the message
 * @returns one message per place serialisation would lose or change something; empty when it is plain data
 */
export function plainDataProblems({ value, path }: { value: unknown; path: string }): readonly string[] {
  return problemsWithin({ ancestors: new Set(), path, value });
}

/**
 * {@link plainDataProblems}, carrying the objects above this one: a value that contains itself is refused by name
 * rather than walked until the stack overflows, which would throw past the write path's `Result`. Ancestors, not every object seen — one object reached twice by two paths is plain data.
 */
function problemsWithin({
  value,
  path,
  ancestors,
}: {
  value: unknown;
  path: string;
  ancestors: ReadonlySet<object>;
}): readonly string[] {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return [];
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? [] : [`${path} is ${String(value)}, which JSON writes as null`];
  }
  if (typeof value !== "object") {
    return [`${path} is a ${typeof value}, which JSON cannot carry`];
  }
  if (ancestors.has(value)) {
    return [`${path} contains itself, which JSON cannot write`];
  }
  const within = new Set([...ancestors, value]);
  if (Array.isArray(value)) {
    // A subclass can inherit a `toJSON` that rewrites its members on the way to disk.
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      return [`${path} is an Array subclass, not a plain array`];
    }
    return arrayProblems({ ancestors: within, path, value });
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return [`${path} is a class instance, not a plain object`];
  }
  return Reflect.ownKeys(value).flatMap((key) => ownFieldProblems({ ancestors: within, key, owner: value, path }));
}

/** The problems of one array: a hole, a named property, or a member that is not plain data. */
function arrayProblems({
  value,
  path,
  ancestors,
}: {
  value: readonly unknown[];
  path: string;
  ancestors: ReadonlySet<object>;
}): readonly string[] {
  const indices = new Set(Array.from({ length: value.length }, (_, index) => String(index)));
  const problems: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (key !== "length" && !(typeof key === "string" && indices.has(key))) {
      problems.push(`${path} carries ${describeKey({ key })}, which JSON drops from an array`);
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      problems.push(`${path}[${String(index)}] is a hole, which JSON writes as null`);
      continue;
    }
    problems.push(...problemsWithin({ ancestors, path: `${path}[${String(index)}]`, value: value[index] }));
  }
  return problems;
}

/** The problems of one own field of a plain object. */
function ownFieldProblems({
  key,
  owner,
  path,
  ancestors,
}: {
  key: string | symbol;
  owner: object;
  path: string;
  ancestors: ReadonlySet<object>;
}): readonly string[] {
  if (typeof key === "symbol") {
    return [`${path} carries ${describeKey({ key })}, which JSON drops`];
  }
  const field = `${path}.${key}`;
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  if (!descriptor?.enumerable) {
    return [`${field} is not enumerable, so JSON drops it`];
  }
  if (!("value" in descriptor)) {
    return [`${field} is an accessor, not a value`];
  }
  const held: unknown = descriptor.value;
  if (held === undefined) {
    return [];
  }
  return problemsWithin({ ancestors, path: field, value: held });
}

/** A key as a message names it. */
function describeKey({ key }: { key: string | symbol }): string {
  if (typeof key === "symbol") {
    return `the symbol key ${key.toString()}`;
  }
  return `the named key "${key}"`;
}
