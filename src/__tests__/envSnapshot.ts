/**
 * Capture and restore the exact environment variables one setup file owns.
 *
 * The unit lane runs NON-ISOLATED (`config/vitest/unit.ts`), so a fork is reused across test files and a setup
 * file's per-file assignments would otherwise outlive the file that made them: the next file would start with
 * `TMPDIR` or `$SLOPWEAVER_HOME` pointing at a sandbox the previous file's `afterAll` has just deleted. Each
 * setup file takes the worker's baseline of the keys it moves and restores it TWICE: at its own module scope,
 * before it moves anything, and in its `afterAll`. The first covers a previous file whose tests all skipped and so
 * never reached its `afterAll`. Only OWNED keys: restoring the whole of `process.env` would undo what Vitest and
 * Node set.
 */

/** Each owned key's value before the setup file moved it — `undefined` meaning the key was absent. */
export type EnvironmentSnapshot = ReadonlyMap<string, string | undefined>;

/**
 * Record the current value of each named variable, absence included.
 *
 * @param names the keys this setup file is about to assign or delete
 * @returns the snapshot {@link restoreEnvironment} puts back
 */
export function captureEnvironment({ names }: { names: readonly string[] }): EnvironmentSnapshot {
  return new Map(names.map((name) => [name, process.env[name]]));
}

/**
 * The worker's ORIGINAL value of each named key, captured the first time any file in this process asks for that
 * key set and returned unchanged on every later call. A per-file capture is not enough: a file whose tests are
 * all skipped runs the setup files' module scope but never their `afterAll`, so the next file would capture the
 * skipped file's leaked values as its baseline and restore THOSE. Held on `globalThis` under a registry symbol,
 * because that survives whether or not Vitest re-evaluates this module for the next file.
 *
 * @param key one stable name per setup file, so two files never share or overwrite each other's baseline
 * @param names the keys that setup file moves
 * @returns the snapshot taken when this process first ran that setup file
 */
export function workerBaseline({ key, names }: { key: string; names: readonly string[] }): EnvironmentSnapshot {
  return heldOnce({
    capture: () => [...captureEnvironment({ names })],
    names,
    slot: Symbol.for(`slopweaver.test.envBaseline.${key}`),
  });
}

/**
 * Capture once per process and hand back a fresh copy on every call. The entries are frozen and the slot is
 * non-writable and non-configurable, so no later file — careless or deliberate — can rewrite the baseline that
 * every later restore trusts.
 *
 * @param slot the registry symbol this baseline lives under
 * @param capture reads the current values; called only the first time
 * @param names the keys the held entries must carry, in order, for an existing slot to be trusted
 * @returns a new Map over the entries the first call captured
 */
function heldOnce<V>({
  capture,
  names,
  slot,
}: {
  capture: () => readonly (readonly [string, V])[];
  names: readonly string[];
  slot: symbol;
}): Map<string, V> {
  const existing = Reflect.getOwnPropertyDescriptor(globalThis, slot);
  if (existing !== undefined) {
    // Trust only the sealed shape written below, over exactly the names asked for. Anything else at the slot
    // predates the first setup file, and treating it as the baseline would make every restore put back whatever
    // that writer chose, or skip a name it left out.
    const held: unknown = existing.value;
    const sealed =
      existing.writable === false &&
      existing.configurable === false &&
      existing.enumerable === false &&
      Array.isArray(held) &&
      Object.isFrozen(held) &&
      held.length === names.length &&
      held.every(
        (entry: unknown, index) =>
          Array.isArray(entry) && Object.isFrozen(entry) && entry.length === 2 && entry[0] === names[index],
      );
    if (!sealed) {
      throw new Error(
        `${String(slot.description)} already holds a value this module did not seal, so the worker's baseline cannot be trusted — something wrote that slot before the first setup file ran`,
      );
    }
    return new Map(held as readonly (readonly [string, V])[]);
  }
  const entries = Object.freeze(capture().map((entry) => Object.freeze([...entry] as const)));
  Object.defineProperty(globalThis, slot, { configurable: false, enumerable: false, value: entries, writable: false });
  return new Map(entries);
}

/** Each owned global's own property descriptor before any file moved it — `undefined` meaning it was absent. */
export type GlobalsSnapshot = ReadonlyMap<string, PropertyDescriptor | undefined>;

/**
 * The globals a library reads to decide whether it is running in a browser. A dependency that defines one
 * leaks it into every later file in a reused fork. MEASURED on a first lap: pdf.js's worker build (loaded by
 * `pdf/text.ts`) polyfills `globalThis.self`, after which jimp's `loadFont` takes its web-worker branch and
 * `fetch`es a font PATH, failing `visualEvidence` tests with `ERR_INVALID_URL`.
 */
export const BROWSER_SNIFF_GLOBALS: readonly string[] = ["self", "window"];

/**
 * The worker's ORIGINAL descriptor of each named global, captured once per process exactly like
 * {@link workerBaseline}, so a file that skipped its `afterAll` cannot become the baseline.
 *
 * @param names the globals to hold at their worker baseline
 * @returns the descriptors as this process first saw them
 */
export function workerGlobalsBaseline({ names }: { names: readonly string[] }): GlobalsSnapshot {
  return heldOnce({
    capture: () =>
      names.map((name) => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
        const frozen = descriptor === undefined ? undefined : Object.freeze({ ...descriptor });
        return [name, frozen] as const;
      }),
    names,
    slot: Symbol.for("slopweaver.test.globalsBaseline"),
  });
}

/**
 * Put every captured global back: redefine one that existed, delete one that was absent. A global an earlier
 * file made non-configurable cannot be put back, so that THROWS naming it rather than letting the leak through.
 *
 * @param snapshot what {@link workerGlobalsBaseline} recorded
 */
export function restoreGlobals({ snapshot }: { snapshot: GlobalsSnapshot }): void {
  for (const [name, descriptor] of snapshot) {
    const restored =
      descriptor === undefined
        ? Reflect.deleteProperty(globalThis, name)
        : Reflect.defineProperty(globalThis, name, descriptor);
    if (!restored) {
      throw new Error(
        `globalThis.${name} was made non-configurable by an earlier test file in this worker, so it cannot be ` +
          `put back to the worker's baseline — find the file that defined it and make the definition configurable`,
      );
    }
    // Deleting the own property succeeds even when the name still resolves through a polluted prototype, so
    // absence is checked by resolution, not by the delete's return value.
    if (descriptor === undefined && name in globalThis) {
      throw new Error(
        `globalThis.${name} was absent at the worker's baseline but still resolves through its prototype chain, ` +
          `so an earlier test file in this worker polluted a prototype — find that file and remove what it set`,
      );
    }
  }
}

/**
 * Put every captured variable back as it was: reassign one that was set, delete one that was absent. A name
 * absent at capture that still resolves after the delete — `process.env` falls through to `Object.prototype` on a
 * miss — THROWS, exactly as {@link restoreGlobals} does, rather than letting a polluted prototype through.
 *
 * @param snapshot what {@link captureEnvironment} recorded before the setup file moved these keys
 */
export function restoreEnvironment({ snapshot }: { snapshot: EnvironmentSnapshot }): void {
  for (const [name, value] of snapshot) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, name);
      if (name in process.env) {
        throw new Error(
          `process.env.${name} was absent at the worker's baseline but still resolves through its prototype chain, ` +
            `so an earlier test file in this worker polluted a prototype — find that file and remove what it set`,
        );
      }
      continue;
    }
    process.env[name] = value;
  }
}
