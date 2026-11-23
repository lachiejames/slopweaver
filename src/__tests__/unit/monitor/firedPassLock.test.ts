import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { holdFiredPassLock } from "../../../monitor/firedPassLock.js";

const NOW = "2026-11-04T01:00:00.000Z";

let home = "";
let waits: number[] = [];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fired-pass-lock-"));
  waits = [];
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Try the lock `attempts` times at `at`, recording each wait instead of sleeping. */
function hold({ at = NOW, attempts }: { at?: string; attempts: number }): ReturnType<typeof holdFiredPassLock> {
  return holdFiredPassLock({
    attempts,
    home,
    intervalMs: 7,
    now: () => at,
    wait: async ({ ms }) => {
      waits.push(ms);
    },
  });
}

describe("holdFiredPassLock", () => {
  it("holds the lock on an idle home, without waiting", async () => {
    unwrap(await hold({ attempts: 3 })).release();
    expect(waits).toEqual([]);
  });

  it("waits on a held lock through every attempt, then refuses rather than posting beside the holder", async () => {
    const first = unwrap(await hold({ attempts: 1 }));
    const second = await hold({ attempts: 3 });
    first.release();
    expect([second._unsafeUnwrapErr().startsWith("another fired monitor pass held the lock"), waits]).toEqual([
      true,
      [7, 7, 7],
    ]);
  });

  it("takes a live holder's lease over once it is past five minutes, and FENCES the overtaken pass", async () => {
    const slow = unwrap(await hold({ attempts: 1 }));
    const within = await hold({ at: "2026-11-04T01:04:59.000Z", attempts: 1 });
    const newer = unwrap(await hold({ at: "2026-11-04T01:05:01.000Z", attempts: 1 }));
    expect([within.isErr(), slow.stillHeld(), newer.stillHeld()]).toEqual([true, false, true]);
    slow.release();
    expect(newer.stillHeld()).toBe(true);
    newer.release();
    expect(newer.stillHeld()).toBe(false);
  });

  it("is free again once the holder releases it", async () => {
    unwrap(await hold({ attempts: 1 })).release();
    const again = await hold({ attempts: 1 });
    expect(again.isOk()).toBe(true);
    unwrap(again).release();
  });
});
