/**
 * The disposition manifest for the 90 history files, and the four disagreements it refuses on.
 *
 * The case that matters most is the LAST one below — a file under a covered directory that no entry
 * judges. Without it a manifest could claim to have decided the fate of the whole tree while silently
 * covering half of it, and "90 files dispositioned" would be a number nobody could falsify. The hash
 * mismatch is the second: a disposition recorded against one version of a file is not a disposition
 * against a version nobody read.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  type HarvestManifest,
  harvestedPaths,
  harvestPlanLines,
  parseHarvestManifest,
  validateHarvestManifest,
} from "../../../../store/profile/harvest.js";

/** A sha256-shaped literal, so a case can change exactly one character and see the mismatch fire. */
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

/** A manifest judging two files under one covered directory. */
const MANIFEST: HarvestManifest = {
  covers: ["projects"],
  entries: [
    {
      disposition: "harvest",
      path: "projects/keep.md",
      reason: "carries the rationale for the cycle plan",
      replacedBy: "",
      sha256: HASH_A,
    },
    {
      disposition: "drop",
      path: "projects/entrance.md",
      reason: "an execution entrance whose instructions contradict current doctrine",
      replacedBy: "projects/keep.md",
      sha256: HASH_B,
    },
  ],
  root: "/archive/profile",
  schemaVersion: 1,
};

/** What the tree looks like when it agrees with {@link MANIFEST}. */
const AGREEING = [
  { path: "projects/keep.md", sha256: HASH_A },
  { path: "projects/entrance.md", sha256: HASH_B },
];

describe("parseHarvestManifest", () => {
  it("refuses an entry with no reason, on both dispositions", () => {
    const issues = unwrapErr(
      parseHarvestManifest({
        value: {
          covers: ["projects"],
          entries: [{ disposition: "harvest", path: "a.md", reason: "", sha256: HASH_A }],
          root: "/archive",
          schemaVersion: 1,
        },
      }),
    );
    expect(issues.join(" ")).toContain("every entry needs a reason");
  });

  it("refuses a hash that is not 64 lowercase hex characters", () => {
    const issues = unwrapErr(
      parseHarvestManifest({
        value: {
          covers: ["projects"],
          entries: [{ disposition: "drop", path: "a.md", reason: "r", sha256: "ABC" }],
          root: "/archive",
          schemaVersion: 1,
        },
      }),
    );
    expect(issues.join(" ")).toContain("64 lowercase hex");
  });
});

describe("validateHarvestManifest", () => {
  it("splits an agreeing manifest into its two dispositions", () => {
    const plan = unwrap(validateHarvestManifest({ manifest: MANIFEST, measured: AGREEING }));
    expect(plan.harvest.map((entry) => entry.path)).toStrictEqual(["projects/keep.md"]);
    expect(plan.drop.map((entry) => entry.path)).toStrictEqual(["projects/entrance.md"]);
  });

  it("refuses a file whose content moved since it was judged", () => {
    const moved = [{ path: "projects/keep.md", sha256: HASH_B }, AGREEING[1]!];
    expect(unwrapErr(validateHarvestManifest({ manifest: MANIFEST, measured: moved })).join(" ")).toContain(
      "has changed since it was judged",
    );
  });

  it("refuses an entry naming a file that is not there", () => {
    expect(unwrapErr(validateHarvestManifest({ manifest: MANIFEST, measured: [AGREEING[0]!] })).join(" ")).toContain(
      "is in the manifest and not under /archive/profile",
    );
  });

  it("refuses a covered file no entry judges, which is what stops a partial manifest claiming the tree", () => {
    const extra = [...AGREEING, { path: "projects/unjudged.md", sha256: HASH_A }];
    expect(unwrapErr(validateHarvestManifest({ manifest: MANIFEST, measured: extra })).join(" ")).toContain(
      "projects/unjudged.md is under a covered directory and no entry judges it",
    );
  });

  it("refuses one file judged twice", () => {
    const twice: HarvestManifest = {
      ...MANIFEST,
      entries: [MANIFEST.entries[0]!, { ...MANIFEST.entries[0]!, disposition: "drop" }],
    };
    expect(unwrapErr(validateHarvestManifest({ manifest: twice, measured: AGREEING })).join(" ")).toContain(
      "is judged twice",
    );
  });

  it("reports every disagreement at once rather than the first", () => {
    const wrong = [
      { path: "projects/keep.md", sha256: HASH_B },
      { path: "projects/other.md", sha256: HASH_A },
    ];
    expect(unwrapErr(validateHarvestManifest({ manifest: MANIFEST, measured: wrong })).length).toBe(3);
  });
});

describe("harvestPlanLines", () => {
  it("names every drop and counts the keeps, because a drop is the reviewable half", () => {
    const plan = unwrap(validateHarvestManifest({ manifest: MANIFEST, measured: AGREEING }));
    expect(harvestPlanLines({ plan })).toStrictEqual([
      "harvest plan over /archive/profile",
      "  harvest: 1 file(s)",
      "  drop:    1 file(s)",
      "    - projects/entrance.md: an execution entrance whose instructions contradict current doctrine (replaced by projects/keep.md)",
    ]);
  });
});

describe("harvestedPaths", () => {
  it("builds the absolute paths that select records out of the self bronze lane", () => {
    const plan = unwrap(validateHarvestManifest({ manifest: MANIFEST, measured: AGREEING }));
    expect([...harvestedPaths({ plan })]).toStrictEqual(["/archive/profile/projects/keep.md"]);
  });
});
