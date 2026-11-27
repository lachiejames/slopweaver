/**
 * `machine free-disk`'s plan and outcome lines: an acted row names what it frees and the exact act, a kept row
 * names only what it holds (never a "frees 0.00 GB" that reads as a measurement), a Trash move reports its bytes
 * as moved rather than freed, and an app target prints as a caller would type it.
 */
import { describe, expect, it } from "vitest";

import { gbOf, outcomeLine, planLines, targetLabel } from "../../../../../live/machine/freeDisk/render.js";
import type { FreeDiskPlan } from "../../../../../live/machine/freeDisk/types.js";

const PLAN: FreeDiskPlan = {
  items: [
    {
      action: { identity: { dev: 1, ino: 11 }, kind: "remove-tree", path: "/Users/someone/Library/Caches/pip" },
      allocatedBytes: 840_000_000,
      disposition: "remove",
      expectedFreedBytes: 840_000_000,
      label: "pip",
      path: "/Users/someone/Library/Caches/pip",
      reason: "a rebuildable cache the owner ruled clearable",
    },
    {
      action: undefined,
      allocatedBytes: 7_610_000_000,
      disposition: "keep",
      expectedFreedBytes: 0,
      label: "npm",
      path: "/Users/someone/.npm",
      reason: "every worktree install reads npm's cache",
    },
  ],
  target: { kind: "package-caches" },
};

describe("gbOf", () => {
  it("prints GB to two decimals, so a small cache does not read as zero", () => {
    expect([gbOf({ bytes: 0 }), gbOf({ bytes: 3_160_000_000 }), gbOf({ bytes: 4_000_000 })]).toEqual([
      "0.00 GB",
      "3.16 GB",
      "0.00 GB",
    ]);
  });
});

describe("targetLabel", () => {
  it("prints an app target with its quoted bundle, and every other target bare", () => {
    expect([
      targetLabel({ target: { bundle: "Acme Scanner Edition.app", kind: "app" } }),
      targetLabel({ target: { kind: "docker-data" } }),
    ]).toEqual(['app --bundle "Acme Scanner Edition.app"', "docker-data"]);
  });
});

describe("planLines", () => {
  it("names what an acted row frees and its act, and a kept row only what it holds", () => {
    expect(planLines({ freeGb: 43.1, plan: PLAN })).toEqual([
      "machine free-disk package-caches — state home volume 43.1 GB free (df)",
      "  remove pip: holds 0.84 GB, frees 0.84 GB — /Users/someone/Library/Caches/pip",
      "         a rebuildable cache the owner ruled clearable",
      "         would run: rm -r /Users/someone/Library/Caches/pip",
      "  keep   npm: holds 7.61 GB — /Users/someone/.npm",
      "         every worktree install reads npm's cache",
      "  1 to act on, expected to free 0.84 GB",
    ]);
  });

  it("says the volume was unread rather than inventing a figure", () => {
    expect(planLines({ freeGb: undefined, plan: { items: [], target: { kind: "docker-data" } } })).toEqual([
      "machine free-disk docker-data — state home volume unread",
      "  0 to act on, expected to free 0.00 GB",
    ]);
  });
});

describe("outcomeLine", () => {
  it("reports a Trash move as moved, freeing nothing until the Trash is emptied", () => {
    expect(
      outcomeLine({
        outcome: {
          allocatedAfterBytes: 0,
          allocatedBeforeBytes: 530_000_000,
          detail: undefined,
          freedBasis: "none-until-trash-emptied",
          freedBytes: 0,
          label: "Acme Scanner Edition.app",
          movedBytes: 530_000_000,
          operation: "move-to-trash",
        },
      }),
    ).toBe(
      "  moved to the Trash Acme Scanner Edition.app: held 0.53 GB, now 0.00 GB, freed 0.00 GB, " +
        "moved 0.53 GB (lands once the Trash is emptied)",
    );
  });

  it("carries a trim's own printed line as its detail", () => {
    expect(
      outcomeLine({
        outcome: {
          allocatedAfterBytes: 17_000_000_000,
          allocatedBeforeBytes: 18_110_000_000,
          detail: "/var/lib: 1.1 GiB (1181116006 bytes) trimmed",
          freedBasis: "measured-after",
          freedBytes: 1_110_000_000,
          label: "Docker.raw",
          movedBytes: 0,
          operation: "docker-trim",
        },
      }),
    ).toBe(
      "  trimmed Docker.raw: held 18.11 GB, now 17.00 GB, freed 1.11 GB (measured after the act) — " +
        "/var/lib: 1.1 GiB (1181116006 bytes) trimmed",
    );
  });

  it("says a removal's freed figure was counted at the recheck, never measured", () => {
    expect(
      outcomeLine({
        outcome: {
          allocatedAfterBytes: 0,
          allocatedBeforeBytes: 840_000_000,
          detail: undefined,
          freedBasis: "counted-at-recheck",
          freedBytes: 600_000_000,
          label: "pip",
          movedBytes: 0,
          operation: "remove-tree",
        },
      }),
    ).toBe("  removed pip: held 0.84 GB, now 0.00 GB, freed 0.60 GB (its single-link files, counted at the recheck)");
  });
});
