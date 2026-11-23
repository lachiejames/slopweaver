import { describe, expect, it } from "vitest";

import type { VolumeReading } from "../../../../live/machine/diskFootprint.js";
import { readDiskInOrder } from "../../../../live/machine/read.js";

const VOLUME: VolumeReading = { availableKib: 54_854_000, totalKib: 971_298_980, usedPct: 95 };

describe("readDiskInOrder", () => {
  it("counts, then reads df as it always did, and only then hands the volume to the prune trigger", () => {
    const calls: string[] = [];
    const reading = readDiskInOrder({
      seams: {
        checkouts: ["/repo/a", "/repo/b"],
        countRepo: ({ repoRoot }) => {
          calls.push(`count ${repoRoot}`);
          return repoRoot === "/repo/a" ? 12 : null;
        },
        readVolume: () => {
          calls.push("df");
          return VOLUME;
        },
        requestPrune: ({ availableKib }) => {
          calls.push(`prune? ${String(availableKib)}`);
        },
      },
    });
    expect(calls).toEqual(["count /repo/a", "count /repo/b", "df", "prune? 54854000"]);
    expect(reading.volume).toEqual(VOLUME);
    expect(reading.repos).toEqual([
      { registered: 12, repoRoot: "/repo/a" },
      { registered: null, repoRoot: "/repo/b" },
    ]);
    expect(reading.registeredTotal).toBe(12);
  });

  it("asks the trigger with no reading when df could not be read, and still counts", () => {
    const calls: string[] = [];
    const reading = readDiskInOrder({
      seams: {
        checkouts: ["/repo/a"],
        countRepo: () => 3,
        readVolume: () => undefined,
        requestPrune: ({ availableKib }) => {
          calls.push(`prune? ${String(availableKib)}`);
        },
      },
    });
    expect(calls).toEqual(["prune? undefined"]);
    expect(reading.volume).toBe(undefined);
    expect(reading.registeredTotal).toBe(3);
  });
});
