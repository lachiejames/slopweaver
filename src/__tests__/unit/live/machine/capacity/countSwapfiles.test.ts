import { describe, expect, it } from "vitest";
import { countSwapfiles } from "../../../../../live/machine/capacityParse.js";

describe("countSwapfiles", () => {
  it("counts only <stem><digits> entries under the prefix's basename, never the sleepimage beside them", () => {
    expect(
      countSwapfiles({
        entries: ["sleepimage", "swapfile0", "swapfile1", "swapfile2", "swapfile", "swapfile1.bak"],
        prefix: "/System/Volumes/VM/swapfile\n",
      }),
    ).toBe(3);
  });

  it("counts zero in an empty directory", () => {
    expect(countSwapfiles({ entries: [], prefix: "/System/Volumes/VM/swapfile" })).toBe(0);
  });
});
