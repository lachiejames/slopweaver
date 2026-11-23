import { afterEach, describe, expect, it } from "vitest";
import {
  BROWSER_SNIFF_GLOBALS,
  captureEnvironment,
  type GlobalsSnapshot,
  restoreEnvironment,
  restoreGlobals,
  workerBaseline,
  workerGlobalsBaseline,
} from "../envSnapshot.js";

/** Two keys no other code reads, so moving them cannot disturb a neighbour in a reused fork. */
const SET_KEY = "SLOPWEAVER_TEST_ENV_SNAPSHOT_SET";
const ABSENT_KEY = "SLOPWEAVER_TEST_ENV_SNAPSHOT_ABSENT";

afterEach(() => {
  Reflect.deleteProperty(process.env, SET_KEY);
  Reflect.deleteProperty(process.env, ABSENT_KEY);
});

describe("captureEnvironment / restoreEnvironment", () => {
  it("puts a set key back to its captured value after it was moved", () => {
    process.env[SET_KEY] = "before";
    const snapshot = captureEnvironment({ names: [SET_KEY] });
    process.env[SET_KEY] = "moved";

    restoreEnvironment({ snapshot });

    expect(process.env[SET_KEY]).toBe("before");
  });

  it("deletes a key that was absent at capture, rather than leaving the moved value or an empty string", () => {
    const snapshot = captureEnvironment({ names: [ABSENT_KEY] });
    process.env[ABSENT_KEY] = "moved";

    restoreEnvironment({ snapshot });

    expect(Object.hasOwn(process.env, ABSENT_KEY)).toBe(false);
  });

  it("throws on a key absent at capture that still resolves through a polluted prototype", () => {
    const snapshot = captureEnvironment({ names: [ABSENT_KEY] });
    Reflect.set(Object.prototype, ABSENT_KEY, "from an earlier file");

    const restore = (): void => restoreEnvironment({ snapshot });

    expect(restore).toThrow(`process.env.${ABSENT_KEY} was absent at the worker's baseline but still resolves`);
    Reflect.deleteProperty(Object.prototype, ABSENT_KEY);
  });

  it("records absence as undefined and presence as the value", () => {
    process.env[SET_KEY] = "here";

    const snapshot = captureEnvironment({ names: [SET_KEY, ABSENT_KEY] });

    expect([...snapshot]).toEqual([
      [SET_KEY, "here"],
      [ABSENT_KEY, undefined],
    ]);
  });

  it("keeps the worker's first baseline, so a later file that saw a leaked value cannot replace it", () => {
    // A key unique to this case, so a baseline another file in the same worker took cannot answer for it.
    const key = `envSnapshot-test-${String(process.hrtime.bigint())}`;
    process.env[SET_KEY] = "pristine";
    const first = workerBaseline({ key, names: [SET_KEY] });
    process.env[SET_KEY] = "leaked by a skipped file";

    const second = workerBaseline({ key, names: [SET_KEY] });

    expect([...second]).toEqual([...first]);
    expect(second.get(SET_KEY)).toBe("pristine");
  });

  it("hands back a copy, so a file that rewrites its baseline or the slot cannot poison the next read", () => {
    const key = `envSnapshot-test-${String(process.hrtime.bigint())}`;
    process.env[SET_KEY] = "pristine";
    const first = workerBaseline({ key, names: [SET_KEY] });
    const slot = Symbol.for(`slopweaver.test.envBaseline.${key}`);

    Reflect.apply(Map.prototype.set, first, [SET_KEY, "poisoned"]);
    const overwritten = Reflect.set(globalThis, slot, [[SET_KEY, "poisoned"]]);

    expect(overwritten).toBe(false);
    expect(workerBaseline({ key, names: [SET_KEY] }).get(SET_KEY)).toBe("pristine");
  });

  it("throws on a slot something else wrote before the first capture, rather than adopting it as the baseline", () => {
    const key = `envSnapshot-test-${String(process.hrtime.bigint())}`;
    const slot = Symbol.for(`slopweaver.test.envBaseline.${key}`);
    Reflect.set(globalThis, slot, []);

    const read = (): unknown => workerBaseline({ key, names: [SET_KEY] });

    expect(read).toThrow(`slopweaver.test.envBaseline.${key} already holds a value this module did not seal`);
    Reflect.deleteProperty(globalThis, slot);
  });

  it("throws on a sealed-looking slot whose entries are unfrozen or miss a name it was asked for", () => {
    const key = `envSnapshot-test-${String(process.hrtime.bigint())}`;
    const slot = Symbol.for(`slopweaver.test.envBaseline.${key}`);
    // Outer array frozen and the slot locked, as the real one is, but one entry unfrozen and the second name absent.
    const counterfeit = Object.freeze([[SET_KEY, "/forged"]]);
    Object.defineProperty(globalThis, slot, { configurable: false, value: counterfeit, writable: false });

    const read = (): unknown => workerBaseline({ key, names: [SET_KEY, ABSENT_KEY] });

    expect(read).toThrow(`slopweaver.test.envBaseline.${key} already holds a value this module did not seal`);
  });

  it("deletes a global that was absent at the baseline, so a polyfilled `self` does not reach the next file", () => {
    const name = `slopweaverEnvSnapshotGlobal${String(process.hrtime.bigint())}`;
    const snapshot: GlobalsSnapshot = new Map([[name, undefined]]);
    Object.defineProperty(globalThis, name, { configurable: true, enumerable: true, get: () => globalThis });

    restoreGlobals({ snapshot });

    expect(Object.hasOwn(globalThis, name)).toBe(false);
  });

  it("redefines a global that existed at the baseline with its original value", () => {
    const name = `slopweaverEnvSnapshotGlobal${String(process.hrtime.bigint())}`;
    Reflect.set(globalThis, name, "original");
    const snapshot: GlobalsSnapshot = new Map([[name, Object.getOwnPropertyDescriptor(globalThis, name)]]);
    Reflect.set(globalThis, name, "moved");

    restoreGlobals({ snapshot });

    expect(Reflect.get(globalThis, name)).toBe("original");
    Reflect.deleteProperty(globalThis, name);
  });

  it("throws naming a global an earlier file made non-configurable, rather than letting it through", () => {
    const name = `slopweaverEnvSnapshotGlobal${String(process.hrtime.bigint())}`;
    const snapshot: GlobalsSnapshot = new Map([[name, undefined]]);
    Object.defineProperty(globalThis, name, { configurable: false, value: "from an earlier file" });

    expect(() => restoreGlobals({ snapshot })).toThrow(`globalThis.${name} was made non-configurable`);
  });

  it("throws on a global absent at the baseline that still resolves through a polluted prototype", () => {
    const name = `slopweaverEnvSnapshotGlobal${String(process.hrtime.bigint())}`;
    const snapshot: GlobalsSnapshot = new Map([[name, undefined]]);
    Reflect.set(Object.prototype, name, "from an earlier file");

    const restore = (): void => restoreGlobals({ snapshot });

    expect(restore).toThrow(`globalThis.${name} was absent at the worker's baseline but still resolves`);
    Reflect.deleteProperty(Object.prototype, name);
  });

  it("holds `self` and `window` absent at this worker's baseline, the state jimp's font loader needs", () => {
    const baseline = workerGlobalsBaseline({ names: BROWSER_SNIFF_GLOBALS });

    expect([...baseline]).toEqual([
      ["self", undefined],
      ["window", undefined],
    ]);
  });

  it("touches no key it was not given", () => {
    process.env[SET_KEY] = "untouched";
    const snapshot = captureEnvironment({ names: [ABSENT_KEY] });

    restoreEnvironment({ snapshot });

    expect(process.env[SET_KEY]).toBe("untouched");
  });
});
