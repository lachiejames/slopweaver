/**
 * Which landing repositories a sweep tick drives dependency bumps on itself: absent or between-firings drive rows
 * leave it to the tick, a due or switched-off row keeps the tick's hands off (nine bumps unpressed).
 */
import { describe, expect, it } from "vitest";

import {
  bumpDriveCovers,
  bumpDriveReposOf,
  type StoredBumpDrive,
} from "../../../../supervisor/scratch/bumpDriveCover.js";

/** A stored drive row for one repository, judged as stated. */
function stored({
  repo,
  due = false,
  offReason,
}: {
  repo: string;
  due?: boolean;
  offReason?: "disabled" | "held";
}): StoredBumpDrive {
  return { repo, verdict: { due, offReason, recipeId: `bump-drive-${repo.split("/")[1]!}` } };
}

/** The repositories a `verb-run` row with this argv drives. */
function reposOf({ argv }: { argv: unknown }): readonly string[] {
  return bumpDriveReposOf({ definition: { kind: "verb-run", params: { argv } } });
}

describe("bumpDriveReposOf", () => {
  it("reads the repository off exactly the argv a standing drive row declares", () => {
    expect(reposOf({ argv: ["github", "bump-drive", "--repo", "acme/widgets"] })).toEqual(["acme/widgets"]);
  });

  it("reads the repository off every spelling a hand-registered drive row may carry, so none is invisible", () => {
    const argvs: readonly unknown[] = [
      ["github", "bump-drive", "--repo=acme/widgets"],
      ["github", "bump-drive", "--repo", "acme/widgets", "--json"],
      ["github", "bump-drive", "--json", "--repo=acme/widgets"],
    ];
    expect(argvs.map((argv) => reposOf({ argv }))).toEqual([["acme/widgets"], ["acme/widgets"], ["acme/widgets"]]);
  });

  it("reads every repository off a comma-separated `--repo`, as the verb's usage allows", () => {
    expect(reposOf({ argv: ["github", "bump-drive", "--repo", "acme/widgets,acme/gadgets"] })).toEqual([
      "acme/widgets",
      "acme/gadgets",
    ]);
  });

  it("is not a drive for the seated bump-fix worklist, whose argv adds `--dry-run`", () => {
    const definition = {
      kind: "bump-fix",
      params: { argv: ["github", "bump-drive", "--repo", "acme/widgets", "--dry-run"] },
    };
    expect(bumpDriveReposOf({ definition })).toEqual([]);
  });

  it("is not a drive for a verb-run with `--dry-run`, another verb, a bare repo name, no `--repo`, or no argv", () => {
    const argvs: readonly unknown[] = [
      ["github", "bump-drive", "--repo", "acme/widgets", "--dry-run"],
      ["github", "landing", "--repo", "acme/widgets"],
      ["github", "bump-drive", "--repo", "widgets"],
      ["github", "bump-drive", "--repo=acme/widgets", "--dry-run"],
      ["github", "bump-drive", "--repo=widgets"],
      ["github", "bump-drive", "--json"],
      undefined,
    ];
    expect(argvs.map((argv) => reposOf({ argv }))).toEqual([[], [], [], [], [], [], []]);
  });
});

describe("bumpDriveCovers", () => {
  it("drives a repository no drive row is stored for — the measured defect", () => {
    expect(bumpDriveCovers({ landingRepos: ["acme/widgets"], stored: [] })).toEqual([
      { drive: true, repo: "acme/widgets", why: "no bump-drive row is stored for it" },
    ]);
  });

  it("drives a repository whose row is between firings", () => {
    expect(bumpDriveCovers({ landingRepos: ["acme/widgets"], stored: [stored({ repo: "acme/widgets" })] })).toEqual([
      { drive: true, repo: "acme/widgets", why: "bump-drive-widgets is between firings" },
    ]);
  });

  it("leaves a DUE row to the automation pass, and respects a held or disabled one", () => {
    const covers = bumpDriveCovers({
      landingRepos: ["acme/widgets", "acme/gadgets", "acme/gizmos"],
      stored: [
        stored({ due: true, repo: "acme/widgets" }),
        stored({ offReason: "held", repo: "acme/gadgets" }),
        stored({ offReason: "disabled", repo: "acme/gizmos" }),
      ],
    });

    expect(covers).toEqual([
      { drive: false, repo: "acme/widgets", why: "bump-drive-widgets is due, so the automation pass fires it" },
      { drive: false, repo: "acme/gadgets", why: "bump-drive-gadgets is held" },
      { drive: false, repo: "acme/gizmos", why: "bump-drive-gizmos is disabled" },
    ]);
  });

  it("drives a repository whose row's cadence was refused, saying it never fires rather than between firings", () => {
    const broken = { ...stored({ repo: "acme/widgets" }), cadenceError: "Invalid cron expression" };

    expect(bumpDriveCovers({ landingRepos: ["acme/widgets"], stored: [broken] })).toEqual([
      {
        drive: true,
        repo: "acme/widgets",
        why: "bump-drive-widgets's cadence was refused (Invalid cron expression), so it never fires",
      },
    ]);
  });

  it("matches a slug without regard to case, so a disabled row is not read as absent under another spelling", () => {
    expect(
      bumpDriveCovers({
        landingRepos: ["Acme/Widgets"],
        stored: [stored({ offReason: "disabled", repo: "acme/widgets" })],
      }),
    ).toEqual([{ drive: false, repo: "Acme/Widgets", why: "bump-drive-widgets is disabled" }]);
  });

  it("keeps the seat's order, and a row for another repository suppresses nothing", () => {
    const covers = bumpDriveCovers({
      landingRepos: ["acme/gadgets", "acme/widgets"],
      stored: [stored({ due: true, repo: "acme/other" })],
    });

    expect(covers.map((cover) => [cover.repo, cover.drive])).toEqual([
      ["acme/gadgets", true],
      ["acme/widgets", true],
    ]);
  });

  it("covers nothing when the seat lands no repository", () => {
    expect(bumpDriveCovers({ landingRepos: [], stored: [stored({ repo: "acme/widgets" })] })).toEqual([]);
  });
});
