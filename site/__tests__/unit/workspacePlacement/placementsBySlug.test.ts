import { describe, expect, it } from "vitest";

import { type Board, readBoard } from "../../../components/live/read";
import { placementsBySlug } from "../../../lib/workstreamsContext";
import { ACME_PLACER } from "../../organisationFixture";
import { ACME_ADMIN_PR, BOARD_ROW, SLOPWEAVER_PR } from "./fixtures";

describe("placementsBySlug — a ranked id joins every board row carrying its slug", () => {
  const twice = ({ first, second }: { first: string; second: string }): Board =>
    readBoard({
      rows: [
        { ...BOARD_ROW, prUrls: [first], slug: "shared" },
        { ...BOARD_ROW, prUrls: [second], slug: "shared" },
      ],
      unresolved: 0,
    })!;

  it("joins a slug two rows carry with different workspaces as a conflict, whichever order they come in", () => {
    const evidence = [
      { source: "repository", value: "acme/acme-admin", workspace: "team" },
      { source: "repository", value: "octo-self/slopweaver", workspace: "self" },
    ];
    expect(
      placementsBySlug({ board: twice({ first: ACME_ADMIN_PR, second: SLOPWEAVER_PR }), placer: ACME_PLACER }).get(
        "shared",
      ),
    ).toEqual({
      evidence,
      kind: "conflict",
    });
    expect(
      placementsBySlug({ board: twice({ first: SLOPWEAVER_PR, second: ACME_ADMIN_PR }), placer: ACME_PLACER }).get(
        "shared",
      ),
    ).toEqual({
      evidence: evidence.toReversed(),
      kind: "conflict",
    });
  });
});
