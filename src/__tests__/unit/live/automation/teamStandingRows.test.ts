// The supersedes cases went out with the predecessor shapes they held.
// deleted-with-code: EARLIER_HOLD_REASON
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { standingRowsFor } from "../../../../live/automation/declaredStandingRows.js";
import { parseRecipeDefinition } from "../../../../live/automation/definition.js";
import { runShapeForKind } from "../../../../live/automation/definitionShape.js";
import { ERROR_TRACKING_BATCH_KIND } from "../../../../live/automation/kinds.js";
import type { OwnRepositoryDeclaration } from "../../../../live/automation/ownRepository.js";
import { standingErrorTrackingRow } from "../../../../live/automation/standingErrorTrackingRows.js";
import { GENERIC_STANDING_ROWS } from "../../../../live/automation/standingRows.js";
import { teamRepositoryName, teamStandingRows } from "../../../../live/automation/teamStandingRows.js";
import { CheckoutNameErrors } from "../../../../live/checkout/checkoutForRepo.js";

const ACME = { repository: "acme/acme-admin" } as const;

/** The Error Tracking argv with its query left open. */
const errorsArgv = ({ query }: { query: string }): readonly string[] => [
  "datadog",
  "errors",
  "--query",
  query,
  "--from",
  "7d",
  "--state",
  "for-review",
  "--order",
  "count",
  "--limit",
  "20",
];

describe("teamStandingRows", () => {
  it("declares the two rows an install's existing ids carry, in a fixed order, keyed on the repository name", () => {
    const ids = teamStandingRows(ACME).map((row) => row.definition.recipeId);
    expect(ids).toEqual(["bump-drive-acme-admin", "error-tracking-batch-acme-admin"]);
  });

  it("declares each row on its own cadence", () => {
    const cadences = teamStandingRows(ACME).map((row) => row.definition.cadence);
    expect(cadences).toEqual(["30 */4 * * *", "0 9 * * 1"]);
  });

  it("declares no vulnerability-fix top-up, whose cadence and flags are an installation's own definition", () => {
    const argvs = teamStandingRows(ACME).map((row) => row.definition.params["argv"]);
    expect(argvs).toEqual([
      ["github", "bump-drive", "--repo", "acme/acme-admin"],
      errorsArgv({ query: "env:(prod OR production)" }),
    ]);
  });

  it("declares only rows this build's own reader accepts, every id once", () => {
    const rows = teamStandingRows(ACME);
    const refused = rows.filter((row) => parseRecipeDefinition({ value: row.definition }).isErr());
    expect(refused.map((row) => row.definition.recipeId)).toEqual([]);
    expect(new Set(rows.map((row) => row.definition.recipeId)).size).toBe(2);
  });

  it("declares the error-tracking batch seated and held until the owner's yes, never cleared by the declaration", () => {
    const batch = teamStandingRows(ACME)[1]!;
    expect(batch.definition.kind).toBe(ERROR_TRACKING_BATCH_KIND);
    expect(runShapeForKind({ kind: ERROR_TRACKING_BATCH_KIND })).toBe("spawn");
    expect(batch.definition.hold!.clearedBy).toBe(null);
  });

  it("declares no earlier shape to supersede", () => {
    expect(teamStandingRows(ACME)[1]!.supersedes).toBe(undefined);
  });
});

describe("standingErrorTrackingRow", () => {
  it("keys the batch on the repository name and is exactly the row the template declares for it", () => {
    const row = standingErrorTrackingRow({ repositoryName: "widgets" });
    expect(row.definition.recipeId).toBe("error-tracking-batch-widgets");
    expect(row).toEqual(teamStandingRows({ repository: "acme/widgets" })[1]);
  });
});

describe("teamRepositoryName", () => {
  it("is the lower-case segment after the slash, never the owner", () => {
    expect(teamRepositoryName({ repository: "Acme/Acme-Admin" })).toBe("acme-admin");
  });
});

/** A home that resolved no own repository: no declared checkout carries the name. */
const UNRESOLVED: OwnRepositoryDeclaration = {
  error: CheckoutNameErrors.undeclared({ declared: [], name: "slopweaver" }),
  kind: "unresolved",
};

/** A home whose declared checkout resolved, with the compiled-in address still to bring forward. */
const RESOLVED: OwnRepositoryDeclaration = {
  kind: "resolved",
  repository: "acme/slopweaver",
  supersededRepositories: ["old/slopweaver"],
};

describe("standingRowsFor", () => {
  it("declares exactly the generic rows, and neither own-repository row, when none resolved", () => {
    const declared = unwrap(standingRowsFor({ ownRepository: UNRESOLVED, teamRepositories: [] }));
    expect(declared.rows).toEqual(GENERIC_STANDING_ROWS);
    expect(declared.ownRepositoryRows).toEqual([]);
    expect(declared.teamRepositoryCount).toBe(0);
  });

  it("adds both own-repository rows on the resolved address, carrying the earlier address as an earlier shape", () => {
    const declared = unwrap(standingRowsFor({ ownRepository: RESOLVED, teamRepositories: [] }));
    expect(declared.rows.slice(GENERIC_STANDING_ROWS.length).map((row) => row.definition.params["argv"])).toEqual([
      ["github", "bump-drive", "--repo", "acme/slopweaver"],
      ["github", "bump-drive", "--repo", "acme/slopweaver", "--dry-run"],
    ]);
    expect(declared.ownRepositoryRows.flatMap((row) => row.supersedes!.map((shape) => shape.params["argv"]))).toEqual([
      ["github", "bump-drive", "--repo", "old/slopweaver"],
      ["github", "bump-drive", "--repo", "old/slopweaver", "--dry-run"],
    ]);
  });

  it("subtracts a retired own-repository row from what it declares and judges, never from the universe", () => {
    const declared = unwrap(
      standingRowsFor({
        ownRepository: RESOLVED,
        retiredIds: new Set(["bump-fix-slopweaver"]),
        teamRepositories: [],
      }),
    );
    expect(declared.rows.map((row) => row.definition.recipeId)).not.toContain("bump-fix-slopweaver");
    expect(declared.ownRepositoryRows.map((row) => row.definition.recipeId)).toEqual(["bump-drive-slopweaver"]);
    expect(declared.universe.map((row) => row.definition.recipeId)).toContain("bump-fix-slopweaver");
  });

  it("appends each registered repository's rows after the generic ones, sorted by repository", () => {
    const declared = unwrap(
      standingRowsFor({ ownRepository: UNRESOLVED, teamRepositories: [ACME, { repository: "acme/widgets" }] }),
    );
    const teamIds = declared.rows.slice(GENERIC_STANDING_ROWS.length).map((row) => row.definition.recipeId);
    expect(teamIds).toEqual([
      "bump-drive-acme-admin",
      "error-tracking-batch-acme-admin",
      "bump-drive-widgets",
      "error-tracking-batch-widgets",
    ]);
    expect(declared.teamRepositoryCount).toBe(2);
  });

  it("subtracts a retired row from what it declares, while the universe still holds every row", () => {
    const declared = unwrap(
      standingRowsFor({ ownRepository: UNRESOLVED, retiredIds: new Set(["worktree-prune"]), teamRepositories: [ACME] }),
    );
    const ids = declared.rows.map((row) => row.definition.recipeId);
    expect(ids).not.toContain("worktree-prune");
    expect(declared.universe.map((row) => row.definition.recipeId)).toContain("worktree-prune");
    expect(declared.rows.length).toBe(declared.universe.length - 1);
  });

  it("refuses a collision even when the colliding row is retired", () => {
    const declared = standingRowsFor({
      ownRepository: RESOLVED,
      retiredIds: new Set(["bump-drive-slopweaver"]),
      teamRepositories: [{ repository: "acme/slopweaver" }],
    });
    expect(declared._unsafeUnwrapErr().code).toBe("TEAM_REPOSITORY_ID_COLLISION");
  });

  it("refuses a repository whose rows would take an own-repository row's id", () => {
    const declared = standingRowsFor({
      ownRepository: RESOLVED,
      teamRepositories: [{ repository: "acme/slopweaver" }],
    });
    expect(declared._unsafeUnwrapErr().code).toBe("TEAM_REPOSITORY_ID_COLLISION");
    expect(declared._unsafeUnwrapErr().message).toBe(
      "the generic standing rows and acme/slopweaver share the name `slopweaver`, which keys every one of their " +
        "recipe ids — only one of them can be registered",
    );
  });

  it("refuses that repository on an unresolved home too, so the team template never declares an own row's id", () => {
    const declared = standingRowsFor({
      ownRepository: UNRESOLVED,
      teamRepositories: [{ repository: "acme/slopweaver" }],
    });
    expect(declared._unsafeUnwrapErr().code).toBe("TEAM_REPOSITORY_ID_COLLISION");
  });
});
