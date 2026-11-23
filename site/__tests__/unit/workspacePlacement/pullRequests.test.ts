import { describe, expect, it } from "vitest";

import { prPlacement } from "../../../lib/registerPlacementDirect";
import { shownInContext } from "../../../lib/workspacePlacementContext";
import { ACME_PLACER } from "../../organisationFixture";
import { ACME_ADMIN_PR, SLOPWEAVER_PR } from "./fixtures";

describe("pull requests", () => {
  it("places each by its repository, its slug and its link naming it once", () => {
    expect(prPlacement({ placer: ACME_PLACER, row: { repoSlug: "acme/acme-admin", url: ACME_ADMIN_PR } }).kind).toBe(
      "placed",
    );
    expect(prPlacement({ placer: ACME_PLACER, row: { repoSlug: "octo-self/slopweaver", url: SLOPWEAVER_PR } })).toEqual(
      {
        by: [{ source: "repository", value: "octo-self/slopweaver", workspace: "self" }],
        kind: "placed",
        workspace: "self",
      },
    );
  });

  it("is a conflict, drawn in self by the default rule, when its slug and its link name different repositories", () => {
    const placement = prPlacement({
      placer: ACME_PLACER,
      row: { repoSlug: "octo-self/slopweaver", url: ACME_ADMIN_PR },
    });
    expect(placement).toEqual({
      evidence: [
        { source: "repository", value: "octo-self/slopweaver", workspace: "self" },
        { source: "repository", value: "acme/acme-admin", workspace: "team" },
      ],
      kind: "conflict",
    });
    expect([
      shownInContext({ context: "slopweaver", placement }),
      shownInContext({ context: "work", placement }),
    ]).toEqual([true, false]);
  });

  it("leaves a repository outside the organisation unplaced", () => {
    expect(
      prPlacement({
        placer: ACME_PLACER,
        row: { repoSlug: "vercel/next.js", url: "https://github.com/vercel/next.js/pull/1" },
      }),
    ).toEqual({
      kind: "unplaced",
      why: "vercel/next.js is not a repository of the organisation",
    });
  });

  it("is a finding, drawn in self by the default rule, when its link would not read, never placed by its slug alone", () => {
    const placement = prPlacement({
      placer: ACME_PLACER,
      row: { repoSlug: "octo-self/slopweaver", url: "github.com/acme/acme-admin/pull/7" },
    });
    expect(placement).toEqual({
      kind: "unplaced",
      why: 'its url "github.com/acme/acme-admin/pull/7" would not read as a GitHub repository (NOT MEASURED)',
    });
    expect([
      shownInContext({ context: "slopweaver", placement }),
      shownInContext({ context: "work", placement }),
    ]).toEqual([true, false]);
    expect(prPlacement({ placer: ACME_PLACER, row: { repoSlug: "slopweaver", url: SLOPWEAVER_PR } })).toEqual({
      kind: "unplaced",
      why: 'its repoSlug "slopweaver" would not read as a GitHub repository (NOT MEASURED)',
    });
  });

  it("is a finding, drawn in self by the default rule, when its slug and link name two repositories of one side", () => {
    const outside = prPlacement({ placer: ACME_PLACER, row: { repoSlug: "other/acme", url: ACME_ADMIN_PR } });
    expect(outside).toEqual({
      kind: "unplaced",
      why: "its repoSlug other/acme and url acme/acme-admin name two different repositories",
    });
    expect([
      shownInContext({ context: "slopweaver", placement: outside }),
      shownInContext({ context: "work", placement: outside }),
    ]).toEqual([true, false]);
    expect(prPlacement({ placer: ACME_PLACER, row: { repoSlug: "acme/infra", url: ACME_ADMIN_PR } })).toEqual({
      kind: "unplaced",
      why: "its repoSlug acme/infra and url acme/acme-admin name two different repositories",
    });
    expect(prPlacement({ placer: ACME_PLACER, row: { repoSlug: "Acme/acme-admin", url: ACME_ADMIN_PR } }).kind).toBe(
      "placed",
    );
  });
});
