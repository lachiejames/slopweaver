/**
 * The main-checkout verdicts: parsing git's counts, deciding whether an install is stale, and rendering a
 * report that never claims to be fresher than its own evidence.
 */
import { describe, expect, it } from "vitest";

import {
  type CheckoutFreshness,
  checkoutFreshnessJson,
  checkoutNeedsAttention,
  dependencyPathsAmong,
  INSTALL_FIX_COMMAND,
  installFreshness,
  isDependencyPath,
  parseAheadBehind,
  parseNameOnly,
  renderCheckoutFreshness,
} from "../../../checkouts/freshness.js";

const NOW_MS = 1_700_000_000_000;

/** A healthy checkout, overridden per test — spread wholesale, so the call sites name only what they change. */
const checkout = (over: Partial<CheckoutFreshness> = {}): CheckoutFreshness => ({
  branch: "main",
  dirtyEntries: 0,
  drift: { ahead: 0, behind: 0 },
  fetchedAtMs: NOW_MS - 60_000,
  install: "current",
  path: "/repo",
  problems: [],
  rebaseOnto: undefined,
  upstream: "origin/main",
  ...over,
});

describe("parseAheadBehind", () => {
  it("reads the tab-separated pair git prints", () => {
    expect(parseAheadBehind({ text: "3\t7" })).toEqual({ ahead: 7, behind: 3 });
  });

  it("reads a zero pair", () => {
    expect(parseAheadBehind({ text: "0\t0" })).toEqual({ ahead: 0, behind: 0 });
  });

  it("tolerates surrounding whitespace and a trailing newline", () => {
    expect(parseAheadBehind({ text: "  2 5 \n" })).toEqual({ ahead: 5, behind: 2 });
  });

  it("refuses empty output rather than reporting zeroes", () => {
    expect(parseAheadBehind({ text: "" })).toBeUndefined();
  });

  it("refuses a single number", () => {
    expect(parseAheadBehind({ text: "4" })).toBeUndefined();
  });

  it("refuses a non-numeric field", () => {
    expect(parseAheadBehind({ text: "fatal\terror" })).toBeUndefined();
  });

  it("refuses a negative number", () => {
    expect(parseAheadBehind({ text: "-1\t2" })).toBeUndefined();
  });
});

describe("parseNameOnly", () => {
  it("returns one path per line", () => {
    expect(parseNameOnly({ text: "a.ts\nb/c.ts\n" })).toEqual(["a.ts", "b/c.ts"]);
  });

  it("returns nothing for empty output", () => {
    expect(parseNameOnly({ text: "" })).toEqual([]);
  });

  it("drops blank lines", () => {
    expect(parseNameOnly({ text: "a.ts\n\n\nb.ts" })).toEqual(["a.ts", "b.ts"]);
  });
});

describe("isDependencyPath", () => {
  it("matches the root lockfile", () => {
    expect(isDependencyPath({ path: "yarn.lock" })).toBe(true);
  });

  it("matches the root manifest", () => {
    expect(isDependencyPath({ path: "package.json" })).toBe(true);
  });

  it("matches the yarn config", () => {
    expect(isDependencyPath({ path: ".yarnrc.yml" })).toBe(true);
  });

  it("matches a nested workspace's manifest", () => {
    expect(isDependencyPath({ path: "packages/api/package.json" })).toBe(true);
  });

  it("matches a patch, which changes the installed tree without changing a manifest name", () => {
    expect(isDependencyPath({ path: ".yarn/patches/some-pkg-npm-1.0.0.patch" })).toBe(true);
  });

  it("matches a nested workspace's patch", () => {
    expect(isDependencyPath({ path: "packages/api/.yarn/patches/x.patch" })).toBe(true);
  });

  it("does not match a source file", () => {
    expect(isDependencyPath({ path: "src/index.ts" })).toBe(false);
  });

  it("does not match a file whose name merely ends in the manifest name", () => {
    expect(isDependencyPath({ path: "docs/not-package.json" })).toBe(false);
  });
});

describe("dependencyPathsAmong", () => {
  it("returns only the dependency-defining paths", () => {
    expect(dependencyPathsAmong({ changedPaths: ["src/a.ts", "yarn.lock", "README.md"] })).toEqual(["yarn.lock"]);
  });

  it("returns nothing for a pull that touched no dependency file", () => {
    expect(dependencyPathsAmong({ changedPaths: ["src/a.ts"] })).toEqual([]);
  });

  it("returns nothing for an empty pull", () => {
    expect(dependencyPathsAmong({ changedPaths: [] })).toEqual([]);
  });
});

describe("installFreshness", () => {
  it("reports never-installed when there is no install state at all", () => {
    expect(
      installFreshness({ installStateMs: undefined, lockfileMs: 10, manifestMs: 10, verifiedAtMs: undefined }),
    ).toBe("never-installed");
  });

  it("reports stale when the lockfile is newer than the install — the measured post-pull failure", () => {
    expect(installFreshness({ installStateMs: 100, lockfileMs: 200, manifestMs: 50, verifiedAtMs: undefined })).toBe(
      "stale",
    );
  });

  it("reports stale when the manifest alone is newer", () => {
    expect(installFreshness({ installStateMs: 100, lockfileMs: 50, manifestMs: 200, verifiedAtMs: undefined })).toBe(
      "stale",
    );
  });

  it("reports current when the install is newer than both sources", () => {
    expect(installFreshness({ installStateMs: 300, lockfileMs: 200, manifestMs: 100, verifiedAtMs: undefined })).toBe(
      "current",
    );
  });

  it("reports current when the install and the lockfile share a timestamp", () => {
    expect(installFreshness({ installStateMs: 200, lockfileMs: 200, manifestMs: 200, verifiedAtMs: undefined })).toBe(
      "current",
    );
  });

  it("reports unmeasurable when an install exists but neither source could be read", () => {
    expect(
      installFreshness({ installStateMs: 100, lockfileMs: undefined, manifestMs: undefined, verifiedAtMs: undefined }),
    ).toBe("unmeasurable");
  });

  it("uses the one readable source when the other is missing", () => {
    expect(
      installFreshness({ installStateMs: 100, lockfileMs: 200, manifestMs: undefined, verifiedAtMs: undefined }),
    ).toBe("stale");
  });

  it("reports current when a verified install is newer than the sources but yarn's own file is not", () => {
    expect(installFreshness({ installStateMs: 100, lockfileMs: 200, manifestMs: 150, verifiedAtMs: 300 })).toBe(
      "current",
    );
  });

  it("still reports stale when the sources moved after the last verified install", () => {
    expect(installFreshness({ installStateMs: 100, lockfileMs: 400, manifestMs: 150, verifiedAtMs: 300 })).toBe(
      "stale",
    );
  });

  it("reports never-installed on a verified mark with no yarn state beside it", () => {
    expect(installFreshness({ installStateMs: undefined, lockfileMs: 10, manifestMs: 10, verifiedAtMs: 900 })).toBe(
      "never-installed",
    );
  });
});

describe("checkoutNeedsAttention", () => {
  it("passes a current, cleanly installed checkout", () => {
    expect(checkoutNeedsAttention({ freshness: checkout() })).toBe(false);
  });

  it("flags a checkout behind its upstream", () => {
    expect(checkoutNeedsAttention({ freshness: checkout({ drift: { ahead: 0, behind: 1 } }) })).toBe(true);
  });

  it("does not flag a checkout merely ahead of its upstream", () => {
    expect(checkoutNeedsAttention({ freshness: checkout({ drift: { ahead: 3, behind: 0 } }) })).toBe(false);
  });

  it("flags a stale install", () => {
    expect(checkoutNeedsAttention({ freshness: checkout({ install: "stale" }) })).toBe(true);
  });

  it("flags an unmeasurable drift rather than treating it as current", () => {
    expect(checkoutNeedsAttention({ freshness: checkout({ drift: undefined }) })).toBe(true);
  });

  it("flags a checkout with a recorded problem", () => {
    expect(checkoutNeedsAttention({ freshness: checkout({ problems: ["could not fetch origin"] }) })).toBe(true);
  });

  it("does not flag a dirty tree on its own", () => {
    expect(checkoutNeedsAttention({ freshness: checkout({ dirtyEntries: 4 }) })).toBe(false);
  });
});

describe("checkoutFreshnessJson", () => {
  it("carries the measured behind count beside the verdict", () => {
    expect(JSON.stringify(checkoutFreshnessJson({ freshness: checkout({ drift: { ahead: 2, behind: 3 } }) }))).toBe(
      '{"behind":3,"install":"current","needsAttention":true,"path":"/repo"}',
    );
  });

  it("writes behind as null when drift could not be measured, keeping the same key order", () => {
    expect(JSON.stringify(checkoutFreshnessJson({ freshness: checkout({ drift: undefined }) }))).toBe(
      '{"behind":null,"install":"current","needsAttention":true,"path":"/repo"}',
    );
  });
});

describe("renderCheckoutFreshness", () => {
  it("names the branch and reports a current checkout", () => {
    const lines = renderCheckoutFreshness({ freshness: checkout(), nowMs: NOW_MS });
    expect(lines[0]).toBe("/repo [main]");
    expect(lines[1]).toBe("  upstream origin/main: current");
    expect(lines[2]).toBe("  last fetch: 1 min ago");
    expect(lines[3]).toBe("  node_modules: matches the lockfile (by install mtime, or a recorded verified install)");
  });

  it("names the sync command on a behind checkout, and reports the ahead count too", () => {
    const lines = renderCheckoutFreshness({ freshness: checkout({ drift: { ahead: 2, behind: 5 } }), nowMs: NOW_MS });
    expect(lines[1]).toBe("  upstream origin/main: 5 BEHIND, 2 ahead — run `slopweaver checkout sync`");
  });

  it("names the install fix command on a stale tree", () => {
    const lines = renderCheckoutFreshness({ freshness: checkout({ install: "stale" }), nowMs: NOW_MS });
    expect(lines[3]).toBe(
      `  node_modules: STALE — the lockfile or manifest changed after the last install; run \`${INSTALL_FIX_COMMAND}\``,
    );
  });

  it("admits an unknown fetch time instead of implying the comparison is fresh", () => {
    const lines = renderCheckoutFreshness({ freshness: checkout({ fetchedAtMs: undefined }), nowMs: NOW_MS });
    expect(lines[2]).toBe(
      "  last fetch: unknown — the comparison above may be against refs this checkout has never refreshed",
    );
  });

  it("says a branch tracking nothing cannot be judged current", () => {
    const lines = renderCheckoutFreshness({
      freshness: checkout({ drift: undefined, upstream: undefined }),
      nowMs: NOW_MS,
    });
    expect(lines[1]).toBe("  upstream: NONE — this branch tracks nothing, so nothing can say whether it is current");
  });

  it("reports a detached HEAD as such rather than inventing a branch name", () => {
    const lines = renderCheckoutFreshness({ freshness: checkout({ branch: undefined }), nowMs: NOW_MS });
    expect(lines[0]).toBe("/repo [detached HEAD]");
  });

  it("says an unchecked working tree was NOT checked, rather than omitting it like a clean one", () => {
    const lines = renderCheckoutFreshness({ freshness: checkout({ dirtyEntries: undefined }), nowMs: NOW_MS });
    expect(lines[4]).toBe("  working tree: not checked");
  });

  it("adds a line for a dirty working tree and omits it when clean", () => {
    const dirty = renderCheckoutFreshness({ freshness: checkout({ dirtyEntries: 3 }), nowMs: NOW_MS });
    expect(dirty[4]).toBe("  working tree: 3 uncommitted change(s)");
    expect(renderCheckoutFreshness({ freshness: checkout(), nowMs: NOW_MS })).toHaveLength(4);
  });

  it("reports a stranded path the rebase target removed and this branch still references", () => {
    const lines = renderCheckoutFreshness({
      freshness: checkout({
        rebaseOnto: {
          behind: 9,
          examined: 1,
          ref: "origin/trunk",
          removed: 1,
          scanned: true,
          stranded: [{ path: "scripts/old", referencedBy: ["src/recipe.ts"] }],
        },
      }),
      nowMs: NOW_MS,
    });
    expect(lines[4]).toBe("  rebase target origin/trunk: 9 behind");
    expect(lines[5]).toBe("    STRANDED scripts/old — removed upstream, still referenced by src/recipe.ts");
  });

  it("states what an examination cap did NOT look at, so the cap is never silent", () => {
    const lines = renderCheckoutFreshness({
      freshness: checkout({
        rebaseOnto: { behind: 2, examined: 40, ref: "origin/trunk", removed: 57, scanned: true, stranded: [] },
      }),
      nowMs: NOW_MS,
    });
    expect(lines[5]).toBe("    (examined 40 of 57 removed paths — the rest were not checked for references)");
  });

  it("says removed paths were NOT scanned, rather than implying none are stranded", () => {
    const lines = renderCheckoutFreshness({
      freshness: checkout({
        rebaseOnto: { behind: 7, examined: 0, ref: "origin/trunk", removed: 0, scanned: false, stranded: [] },
      }),
      nowMs: NOW_MS,
    });
    expect(lines[4]).toBe("  rebase target origin/trunk: 7 behind");
    expect(lines[5]).toBe("    (removed paths not scanned for references — run `slopweaver checkout status --fetch`)");
  });

  it("prints an unmeasured problem rather than dropping it", () => {
    const lines = renderCheckoutFreshness({
      freshness: checkout({ problems: ["could not fetch origin"] }),
      nowMs: NOW_MS,
    });
    expect(lines[4]).toBe("  UNMEASURED: could not fetch origin");
  });
});
