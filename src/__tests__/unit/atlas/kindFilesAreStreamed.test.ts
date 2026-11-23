/**
 * Every atlas's kind files are `.jsonl` and every manifest is `.json`, asserted over the ONE resolver that
 * hands them out — and over the normaliser that is why the first half cannot drift.
 *
 * MEASURED, which is why the extension is derived rather than declared: SIX atlases landed on the
 * base branch while this format was being changed, every one of them spelling `.json` in its own file map,
 * every one of them rebasing in CLEANLY, and every one of them writing a whole-document artifact until a red
 * CI run said so. Nothing a conflict-free rebase can see catches that, so `kindFileName` takes the decision
 * away from the map. `atlas/atlasFile.ts`'s header carries what the format is and why.
 */
import { describe, expect, it } from "vitest";

import { kindFileName } from "../../../atlasHomeShared.js";
import type { AtlasPlatformPaths } from "../../../stateHome.js";
import { stateHomePaths } from "../../../stateHome.js";

const HOME = "/tmp/a-home-that-is-never-written";

/**
 * The atlas sub-tree carries its own `root` string beside one entry per platform, so this keeps the
 * platforms. Positional because TS1230 forbids destructuring the subject of a type predicate —
 * `typescript-patterns.md` names that exact exemption.
 */
function isPlatform(value: string | AtlasPlatformPaths): value is AtlasPlatformPaths {
  return typeof value !== "string";
}

describe("kindFileName", () => {
  it("gives a bare name this build's extension", () => {
    expect(kindFileName({ file: "pages-project" })).toBe("pages-project.jsonl");
  });

  it("REWRITES a `.json` a platform declared, which is the whole reason it exists", () => {
    expect(kindFileName({ file: "pages-project.json" })).toBe("pages-project.jsonl");
  });

  it("leaves a name that already carries the extension alone rather than doubling it", () => {
    expect(kindFileName({ file: "pages-project.jsonl" })).toBe("pages-project.jsonl");
  });

  it("keeps a dot that is part of the name rather than treating it as an extension", () => {
    expect(kindFileName({ file: "v1.beta" })).toBe("v1.beta.jsonl");
  });
});

describe("every atlas's on-disk layout", () => {
  const platforms = Object.entries(stateHomePaths({ home: HOME }).atlas).flatMap(([platform, paths]) =>
    isPlatform(paths) ? [[platform, paths] as const] : [],
  );

  it("resolves at least twenty platforms, so an empty sub-tree cannot pass this vacuously", () => {
    expect(platforms.length).toBeGreaterThan(20);
  });

  it("gives every kind a .jsonl, because a kind file's size is the tenant's rather than this code's", () => {
    const offenders = platforms.flatMap(([platform, paths]) =>
      Object.entries(paths.kinds)
        .filter(([, file]) => !file.endsWith(".jsonl"))
        .map(([kind, file]) => `${platform}.${kind} -> ${file}`),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps every manifest a whole .json, because one status cell per kind is bounded by the code", () => {
    const offenders = platforms
      .filter(([, paths]) => !paths.manifest.endsWith("manifest.json"))
      .map(([platform, paths]) => `${platform} -> ${paths.manifest}`);
    expect(offenders).toEqual([]);
  });
});
