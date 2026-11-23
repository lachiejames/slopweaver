import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  handBack,
  holdSignals,
  lateListenerDropper,
  signalListeners,
} from "../../../../../cli/commands/desktop/e2eCallSignals.js";

/** The worker's own SIGTERM listeners, handed back after each case: the dropper removes every one but the kept. */
let before: ReturnType<typeof process.listeners>;

beforeEach(() => {
  before = process.rawListeners("SIGTERM");
});

afterEach(() => {
  process.removeAllListeners("SIGTERM");
  before.forEach((listener) => process.on("SIGTERM", listener));
});

/**
 * Let the dropper's queued microtask run.
 *
 * @returns once it has
 */
async function microtask(): Promise<void> {
  await Promise.resolve();
}

describe("lateListenerDropper", () => {
  it("drops a SIGTERM listener added while the guard holds, keeping the guard's own", async () => {
    const keep = (): void => undefined;
    const playwrights = (): void => undefined;
    process.on("SIGTERM", keep);
    process.on("SIGTERM", playwrights);
    lateListenerDropper({ keep }).hook("SIGTERM", playwrights);
    await microtask();
    expect(process.listeners("SIGTERM")).toEqual([keep]);
  });

  it("keeps one copy of the guard's own listener, so one signal is never read as two", async () => {
    const keep = (): void => undefined;
    process.removeAllListeners("SIGTERM");
    process.on("SIGTERM", keep);
    process.on("SIGTERM", keep);
    lateListenerDropper({ keep }).hook("SIGTERM", keep);
    await microtask();
    expect(process.listeners("SIGTERM")).toEqual([keep]);
  });

  it("leaves the signals alone when another event gains a listener", async () => {
    const keep = (): void => undefined;
    const other = (): void => undefined;
    process.on("SIGTERM", keep);
    process.on("SIGTERM", other);
    lateListenerDropper({ keep }).hook("beforeExit", other);
    await microtask();
    expect(process.listeners("SIGTERM").slice(-2)).toEqual([keep, other]);
  });

  it("drops nothing once released, so a drop queued as the drive settled spares the handed-back listeners", async () => {
    const keep = (): void => undefined;
    const handedBack = (): void => undefined;
    const dropper = lateListenerDropper({ keep });
    dropper.hook("SIGTERM", handedBack);
    dropper.release();
    process.on("SIGTERM", handedBack);
    await microtask();
    expect(process.listeners("SIGTERM").at(-1)).toBe(handedBack);
  });
});

describe("holdSignals", () => {
  it("drops a listener another newListener hook adds while the guard installs its own", async () => {
    const beforeLaunch = signalListeners();
    const keep = (): void => undefined;
    const rogue = (): void => undefined;
    const adder = (...args: unknown[]): void => {
      const [event, listener] = args;
      if (event === "SIGINT" && listener === keep) {
        process.off("newListener", adder);
        process.on("SIGINT", rogue);
      }
    };
    process.on("newListener", adder);
    const dropper = holdSignals({ keep });
    await microtask();
    const held = process.listeners("SIGINT");
    handBack({ beforeLaunch, dropper });
    expect(held).toEqual([keep]);
    expect(process.listeners("SIGINT")).toEqual(beforeLaunch[0]!.listeners);
  });
});

describe("handBack", () => {
  it("leaves SIGTERM holding exactly its pre-launch listeners when one was added in the drive's last microtask", async () => {
    const beforeLaunch = signalListeners();
    const keep = (): void => undefined;
    const late = (): void => undefined;
    const dropper = lateListenerDropper({ keep });
    process.on("newListener", dropper.hook);
    process.on("SIGTERM", keep);
    process.on("SIGTERM", late);
    handBack({ beforeLaunch, dropper });
    await microtask();
    expect(process.listeners("SIGTERM")).toEqual(beforeLaunch[1]!.listeners);
    expect(process.listeners("newListener")).not.toContain(dropper.hook);
  });
});

describe("signalListeners", () => {
  it("hands a once listener back still one-shot, as its own wrapper", () => {
    const oneShot = (): void => undefined;
    process.once("SIGTERM", oneShot);
    const beforeLaunch = signalListeners();
    handBack({ beforeLaunch, dropper: holdSignals({ keep: () => undefined }) });
    const restored = process.rawListeners("SIGTERM").at(-1) as { listener?: unknown };
    expect(restored).not.toBe(oneShot);
    expect(restored.listener).toBe(oneShot);
  });

  it("reads SIGINT then SIGTERM, each with the listeners it holds now", () => {
    const added = (): void => undefined;
    process.on("SIGTERM", added);
    const read = signalListeners();
    expect(read.map(({ signal }) => signal)).toEqual(["SIGINT", "SIGTERM"]);
    expect(read[1]!.listeners.at(-1)).toBe(added);
  });
});
