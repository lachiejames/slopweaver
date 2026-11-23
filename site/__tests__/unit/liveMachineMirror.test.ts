/*
 * The Fleet page's live machine reading and the supervisor's machine verbs agree on every threshold the page
 * restates. `site/` never imports `src/`, so `site/lib/liveMachineParse.ts` and `liveMachineView.ts` carry copies;
 * this file, in the lane that reaches both roots, binds each copy to its original — a threshold changed in one alone
 * would let the page say "room" while the supervisor holds, or the reverse. It imports only `src/` modules that import
 * no package, because the site build type-checks what this file reaches and cannot resolve `src/`'s dependencies; the
 * memory sum, whose original returns a neverthrow Result, is bound from the src lane instead
 * (`src/__tests__/unit/live/machine/vmStatMirror.test.ts`).
 */

import { describe, expect, it } from "vitest";
import { countSwapfiles as verbCountSwapfiles } from "../../../src/live/machine/capacityParse";
import { DEFAULT_SEGMENTS_HOLD_PCT, DEFAULT_SWAPFILE_HOLD_COUNT } from "../../../src/live/machine/capacityThresholds";
import { loadHoldFor } from "../../../src/live/machine/cpuLoadHold";
import { countSwapfiles as siteCountSwapfiles } from "../../lib/liveMachineParse";
import { loadHoldAt, SEGMENTS_HOLD_PCT, SWAPFILE_HOLD_COUNT } from "../../lib/liveMachineView";

describe("the live machine's copies match the supervisor's verbs", () => {
  it("counts swapfiles exactly as `machine capacity` does", () => {
    const entries = ["swapfile0", "swapfile1", "swapfile12", "sleepimage", "swapfile", "swapfileX"];
    const prefix = "/System/Volumes/VM/swapfile\n";
    expect(siteCountSwapfiles({ entries, prefix })).toBe(verbCountSwapfiles({ entries, prefix }));
    expect(siteCountSwapfiles({ entries, prefix })).toBe(3);
  });

  it("holds load at the verb's line for every core count it would meet", () => {
    for (const cores of [1, 4, 8, 10, 12, 15, 16, 24]) {
      expect(loadHoldAt({ cores })).toBe(loadHoldFor({ cores }));
    }
    expect(loadHoldAt({ cores: 15 })).toBe(45);
  });

  it("holds memory at the verb's own lines", () => {
    expect(SEGMENTS_HOLD_PCT).toBe(DEFAULT_SEGMENTS_HOLD_PCT);
    expect(SWAPFILE_HOLD_COUNT).toBe(DEFAULT_SWAPFILE_HOLD_COUNT);
  });
});
