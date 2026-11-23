/**
 * Measuring one checkout, against a FAKE git seam — a plain function passed in, never a mock.
 *
 * The property under test is the one the module header claims and the one this whole feature exists for: a
 * git read that FAILS becomes a recorded problem, never a zero that reads as "current".
 */
import { describe, expect, it } from "vitest";

import { checkoutNeedsAttention } from "../../../checkouts/freshness.js";
import { type CheckoutInspectDeps, changedPathsBetween, inspectCheckout } from "../../../checkouts/inspect.js";

/** The git replies a healthy checkout would give, keyed by the first two argv entries. */
const HEALTHY: Readonly<Record<string, string>> = {
  "branch --show-current": "main",
  "diff --name-only": "src/a.ts\nyarn.lock",
  "rev-list --left-right": "0\t0",
  "rev-parse --abbrev-ref": "origin/main",
  "rev-parse --absolute-git-dir": "/repo/.git",
  "status --porcelain": "",
};

/** A fake git that answers from a table and returns undefined for anything absent (i.e. a failed call). */
const fakeGit =
  (table: Readonly<Record<string, string>>) =>
  ({ args }: { args: readonly string[]; cwd: string }): string | undefined =>
    table[args.slice(0, 2).join(" ")];

/** A deps object over a reply table, with every mtime fixed so the install verdict is deterministic. */
const deps = ({
  table,
  mtimes = {},
}: {
  table: Readonly<Record<string, string>>;
  mtimes?: Readonly<Record<string, number>>;
}): CheckoutInspectDeps => ({
  git: fakeGit(table),
  mtimeMs: ({ path }) => mtimes[path],
});

const INSTALLED: Readonly<Record<string, number>> = {
  "/repo/node_modules/.yarn-state.yml": 300,
  "/repo/package.json": 100,
  "/repo/yarn.lock": 200,
};

describe("inspectCheckout", () => {
  it("measures a healthy checkout with no problems", () => {
    const freshness = inspectCheckout({
      config: { path: "/repo" },
      deps: deps({ mtimes: INSTALLED, table: HEALTHY }),
      depth: "cheap",
    });
    expect(freshness.branch).toBe("main");
    expect(freshness.upstream).toBe("origin/main");
    expect(freshness.drift).toEqual({ ahead: 0, behind: 0 });
    expect(freshness.install).toBe("current");
    expect(freshness.problems).toEqual([]);
    expect(checkoutNeedsAttention({ freshness })).toBe(false);
  });

  it("records a problem and reports nothing else when the directory is not a git checkout", () => {
    const freshness = inspectCheckout({
      config: { path: "/repo" },
      deps: deps({ mtimes: INSTALLED, table: {} }),
      depth: "cheap",
    });
    expect(freshness.branch).toBeUndefined();
    expect(freshness.drift).toBeUndefined();
    expect(freshness.problems).toEqual(["/repo is not a readable git checkout"]);
    expect(checkoutNeedsAttention({ freshness })).toBe(true);
  });

  it("leaves drift unmeasured — never zero — when the count call fails", () => {
    const table = { ...HEALTHY };
    delete (table as Record<string, string>)["rev-list --left-right"];
    const freshness = inspectCheckout({
      config: { path: "/repo" },
      deps: deps({ mtimes: INSTALLED, table }),
      depth: "cheap",
    });
    expect(freshness.drift).toBeUndefined();
    expect(checkoutNeedsAttention({ freshness })).toBe(true);
  });

  it("prefers a configured upstream over the branch's own tracking ref", () => {
    const freshness = inspectCheckout({
      config: { path: "/repo", upstream: "origin/other" },
      deps: deps({ mtimes: INSTALLED, table: HEALTHY }),
      depth: "cheap",
    });
    expect(freshness.upstream).toBe("origin/other");
  });

  it("counts the dirty entries git reported", () => {
    const freshness = inspectCheckout({
      config: { path: "/repo" },
      deps: deps({ mtimes: INSTALLED, table: { ...HEALTHY, "status --porcelain": " M a.ts\n?? b.ts" } }),
      depth: "current",
    });
    expect(freshness.dirtyEntries).toBe(2);
  });

  it("skips the working-tree read on the cheap rung, reporting it unchecked rather than clean", () => {
    const freshness = inspectCheckout({
      config: { path: "/repo" },
      deps: deps({ mtimes: INSTALLED, table: { ...HEALTHY, "status --porcelain": " M a.ts" } }),
      depth: "cheap",
    });
    expect(freshness.dirtyEntries).toBeUndefined();
  });

  it("does not fetch on the cheap rung, so a missing fetch reply is not a recorded problem", () => {
    const freshness = inspectCheckout({
      config: { path: "/repo" },
      deps: deps({ mtimes: INSTALLED, table: HEALTHY }),
      depth: "cheap",
    });
    expect(freshness.problems).toEqual([]);
  });

  it("reports a fetch failure as a problem while still printing the comparison it could make", () => {
    const freshness = inspectCheckout({
      config: { path: "/repo" },
      deps: deps({ mtimes: INSTALLED, table: HEALTHY }),
      depth: "current",
    });
    expect(freshness.problems).toEqual([
      "could not fetch origin — the comparisons below are against refs already on disk",
    ]);
    expect(freshness.drift).toEqual({ ahead: 0, behind: 0 });
  });

  it("reads the fetch stamp from the resolved git directory", () => {
    const freshness = inspectCheckout({
      config: { path: "/repo" },
      deps: deps({ mtimes: { ...INSTALLED, "/repo/.git/FETCH_HEAD": 555 }, table: HEALTHY }),
      depth: "cheap",
    });
    expect(freshness.fetchedAtMs).toBe(555);
  });

  it("reports a rebase target's drift and the paths it stranded", () => {
    const freshness = inspectCheckout({
      config: { path: "/repo", rebaseOnto: "origin/trunk" },
      deps: deps({
        mtimes: INSTALLED,
        table: {
          ...HEALTHY,
          "cat-file -e": "",
          "diff --diff-filter=D": "scripts/old/run.ts",
          "grep --files-with-matches": "src/recipe.ts",
          "merge-base origin/trunk": "abc123",
          "rev-list --left-right": "4\t1",
        },
      }),
      depth: "thorough",
    });
    expect(freshness.rebaseOnto).toEqual({
      behind: 4,
      examined: 1,
      ref: "origin/trunk",
      removed: 1,
      scanned: true,
      stranded: [{ path: "scripts/old/run.ts", referencedBy: ["src/recipe.ts"] }],
    });
  });

  it("does not strand a removed path nothing references", () => {
    const freshness = inspectCheckout({
      config: { path: "/repo", rebaseOnto: "origin/trunk" },
      deps: deps({
        mtimes: INSTALLED,
        table: {
          ...HEALTHY,
          "cat-file -e": "",
          "diff --diff-filter=D": "scripts/old/run.ts",
          "merge-base origin/trunk": "abc123",
          "rev-list --left-right": "4\t1",
        },
      }),
      depth: "thorough",
    });
    expect(freshness.rebaseOnto?.stranded).toEqual([]);
    expect(freshness.rebaseOnto?.examined).toBe(1);
  });

  it("reports a rebase target as UNSCANNED below the thorough rung, never as having no stranded paths", () => {
    const freshness = inspectCheckout({
      config: { path: "/repo", rebaseOnto: "origin/trunk" },
      deps: deps({ mtimes: INSTALLED, table: { ...HEALTHY, "rev-list --left-right": "4\t1" } }),
      depth: "cheap",
    });
    expect(freshness.rebaseOnto).toEqual({
      behind: 4,
      examined: 0,
      ref: "origin/trunk",
      removed: 0,
      scanned: false,
      stranded: [],
    });
  });

  it("records a problem when the rebase target cannot be compared at all", () => {
    const table = { ...HEALTHY };
    delete (table as Record<string, string>)["rev-list --left-right"];
    const freshness = inspectCheckout({
      config: { path: "/repo", rebaseOnto: "origin/trunk" },
      deps: deps({ mtimes: INSTALLED, table }),
      depth: "cheap",
    });
    expect(freshness.rebaseOnto).toBeUndefined();
    expect(freshness.problems).toEqual(["could not compare against the rebase target origin/trunk"]);
  });
});

describe("changedPathsBetween", () => {
  it("returns the paths git listed", () => {
    expect(
      changedPathsBetween({ cwd: "/repo", deps: deps({ table: HEALTHY }), from: "HEAD", to: "origin/main" }),
    ).toEqual(["src/a.ts", "yarn.lock"]);
  });

  it("returns undefined — not an empty list — when the diff could not be taken", () => {
    expect(
      changedPathsBetween({ cwd: "/repo", deps: deps({ table: {} }), from: "HEAD", to: "origin/main" }),
    ).toBeUndefined();
  });
});
