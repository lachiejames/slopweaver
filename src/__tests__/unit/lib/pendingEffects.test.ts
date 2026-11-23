/**
 * The process shell's wait on effects a synchronous caller started (`../../../lib/pendingEffects.ts`): every one
 * settles before `settlePendingEffects` returns, an effect started by another is waited on too, and a rejection is
 * held rather than thrown.
 */
import { describe, expect, it } from "vitest";

import { settlePendingEffects, trackEffect } from "../../../lib/pendingEffects.js";

/** A promise that settles on the next macrotask, so nothing is done until something waits. */
function later({ act }: { act: () => void }): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(() => {
      act();
      resolve();
    });
  });
}

describe("settlePendingEffects", () => {
  it("returns only once every tracked effect, and every effect one of them started, has settled", async () => {
    const done: string[] = [];
    trackEffect({
      effect: later({
        act: () => {
          done.push("first");
          trackEffect({ effect: later({ act: () => done.push("started by first") }) });
        },
      }),
    });
    trackEffect({ effect: later({ act: () => done.push("second") }) });
    await settlePendingEffects();
    expect(done).toEqual(["first", "second", "started by first"]);
  });

  it("holds a rejected effect instead of throwing it into the exit", async () => {
    const done: string[] = [];
    trackEffect({ effect: Promise.reject(new Error("the store refused")) });
    trackEffect({ effect: later({ act: () => done.push("after the rejection") }) });
    await expect(settlePendingEffects()).resolves.toBeUndefined();
    expect(done).toEqual(["after the rejection"]);
  });

  it("returns at once when nothing is pending", async () => {
    await expect(settlePendingEffects()).resolves.toBeUndefined();
  });
});
