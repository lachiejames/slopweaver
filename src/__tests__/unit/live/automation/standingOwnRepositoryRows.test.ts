import { describe, expect, it } from "vitest";

import type { RecipeDefinition } from "../../../../live/automation/definition.js";
import { ownRepositoryStandingRows } from "../../../../live/automation/standingOwnRepositoryRows.js";
import {
  repositoryDriftLine,
  standingRowRepositoryDrifts,
} from "../../../../live/automation/standingRowRepositoryDrift.js";
import {
  supersededStandingRowLine,
  supersededStandingRows,
} from "../../../../live/automation/standingRowSupersession.js";

/** A stored copy of a declared row with its argv replaced. */
function storedWith({
  row,
  argv,
}: {
  readonly row: RecipeDefinition;
  readonly argv: readonly string[];
}): RecipeDefinition {
  return { ...row, params: { argv } };
}

describe("ownRepositoryStandingRows", () => {
  it("supersedes each row's own exact shape on every earlier address, once each", () => {
    const [drive, fix] = ownRepositoryStandingRows({
      repository: "acme/slopweaver",
      supersededRepositories: ["old/slopweaver", "Old/Slopweaver", "older/slopweaver"],
    });
    expect(drive!.supersedes!.map((shape) => shape.params["argv"])).toEqual([
      ["github", "bump-drive", "--repo", "old/slopweaver"],
      ["github", "bump-drive", "--repo", "older/slopweaver"],
    ]);
    expect(fix!.supersedes!.map((shape) => shape.params["argv"])).toEqual([
      ["github", "bump-drive", "--repo", "old/slopweaver", "--dry-run"],
      ["github", "bump-drive", "--repo", "older/slopweaver", "--dry-run"],
    ]);
  });

  it("never lists the current address as an earlier one, whatever its case, so a current row is not rewritten forever", () => {
    const rows = ownRepositoryStandingRows({
      repository: "acme/slopweaver",
      supersededRepositories: ["acme/slopweaver", "ACME/Slopweaver"],
    });
    expect(rows.map((row) => row.supersedes)).toEqual([[], []]);
    expect(
      supersededStandingRows({
        declared: rows,
        existing: rows.map((row) => row.definition),
        files: ["bump-drive-slopweaver.json", "bump-fix-slopweaver.json"],
      }),
    ).toEqual([]);
  });

  it("reports a stored row on an earlier address as superseded, with a line naming no false cadence difference", () => {
    const rows = ownRepositoryStandingRows({
      repository: "acme/slopweaver",
      supersededRepositories: ["old/slopweaver"],
    });
    const stored = rows[0]!.supersedes![0]!;
    const superseded = supersededStandingRows({
      declared: rows,
      existing: [stored],
      files: ["bump-drive-slopweaver.json"],
    });
    expect(superseded.map((row) => row.recipeId)).toEqual(["bump-drive-slopweaver"]);
    expect(supersededStandingRowLine({ supersession: superseded[0]! })).toBe(
      "!! bump-drive-slopweaver · SUPERSEDED — the store still holds an earlier build's row, untouched, on the same " +
        "cadence, `0 */4 * * *`, in a shape this build has replaced. Bring it forward with `slopweaver automation " +
        "register-standing`",
    );
  });
});

describe("standingRowRepositoryDrifts", () => {
  const declared = ownRepositoryStandingRows({
    repository: "acme/slopweaver",
    supersededRepositories: ["old/slopweaver"],
  });
  const drive = declared[0]!.definition;

  it("says nothing of a row on the declared repository, whatever the spelling or the case", () => {
    const spellings = [
      drive,
      storedWith({ argv: ["github", "bump-drive", "--repo=acme/slopweaver"], row: drive }),
      storedWith({ argv: ["github", "bump-drive", "--repo", "Acme/Slopweaver"], row: drive }),
    ];
    expect(spellings.flatMap((stored) => standingRowRepositoryDrifts({ declared, existing: [stored] }))).toEqual([]);
  });

  it("leaves a known earlier shape to the supersession verdict", () => {
    expect(standingRowRepositoryDrifts({ declared, existing: [declared[0]!.supersedes![0]!] })).toEqual([]);
  });

  it("names a row on a repository no build wrote, and one naming none, with the line a report prints", () => {
    const drifted = standingRowRepositoryDrifts({
      declared,
      existing: [
        storedWith({ argv: ["github", "bump-drive", "--repo", "someone/slopweaver"], row: drive }),
        storedWith({ argv: ["github", "bump-drive", "--dry-run"], row: declared[1]!.definition }),
      ],
    });
    expect(drifted).toEqual([
      {
        declaredRepository: "acme/slopweaver",
        recipeId: "bump-drive-slopweaver",
        storedRepository: "someone/slopweaver",
      },
      { declaredRepository: "acme/slopweaver", recipeId: "bump-fix-slopweaver", storedRepository: undefined },
    ]);
    expect(repositoryDriftLine({ drift: drifted[0]! })).toBe(
      "!! bump-drive-slopweaver · REPOSITORY DRIFT — the store's row names `someone/slopweaver` where this install's " +
        "checkout resolves to `acme/slopweaver`, and no build wrote that shape, so `slopweaver automation " +
        "register-standing` leaves it: a wrong slug reads as zero open pull requests. Correct it with " +
        "`slopweaver automation repoint bump-drive-slopweaver`, which keeps every other field, `enabled` included",
    );
    expect(repositoryDriftLine({ drift: drifted[1]! })).toContain("the store's row names no repository where");
  });

  it("judges nothing for a row the store does not hold", () => {
    expect(standingRowRepositoryDrifts({ declared, existing: [] })).toEqual([]);
  });
});
