import { describe, expect, it } from "vitest";

import { PRUNE_PROGRESS_PREFIX, pruneProgressLine, scanWasComplete } from "../../../worktree/pruneProgress.js";

describe("pruneProgressLine", () => {
  it("prints one greppable line with the keys in a fixed order", () => {
    expect(pruneProgressLine({ progress: { candidates: 213, owedAfter: 196, removed: 17, scanComplete: true } })).toBe(
      'prune-progress {"candidates":213,"owedAfter":196,"removed":17,"scanComplete":true}',
    );
  });

  it("prints zero owed once a complete scan finds nothing left", () => {
    expect(pruneProgressLine({ progress: { candidates: 0, owedAfter: 0, removed: 0, scanComplete: true } })).toBe(
      'prune-progress {"candidates":0,"owedAfter":0,"removed":0,"scanComplete":true}',
    );
  });

  it("opens on the prefix the proof greps for", () => {
    expect(
      pruneProgressLine({ progress: { candidates: 1, owedAfter: 1, removed: 0, scanComplete: false } }).startsWith(
        `${PRUNE_PROGRESS_PREFIX} `,
      ),
    ).toBe(true);
  });
});

describe("scanWasComplete", () => {
  it("is complete when every repository asked was read and none left a tree unreached", () => {
    expect(scanWasComplete({ asked: 2, read: 2, unreached: [0, 0] })).toBe(true);
  });

  it("is incomplete when a repository could not be read, so a zero there proves nothing", () => {
    expect(scanWasComplete({ asked: 2, read: 1, unreached: [0] })).toBe(false);
  });

  it("is incomplete when a scan ran out of time before reaching every tree", () => {
    expect(scanWasComplete({ asked: 2, read: 2, unreached: [0, 4] })).toBe(false);
  });

  it("is complete for no repositories at all, asked none and read none", () => {
    expect(scanWasComplete({ asked: 0, read: 0, unreached: [] })).toBe(true);
  });
});
