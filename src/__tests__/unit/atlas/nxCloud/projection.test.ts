import { describe, expect, it } from "vitest";

import {
  projectOrganization,
  projectOrganizationRoster,
  projectWorkspace,
  projectWorkspaceRoster,
} from "../../../../atlas/nxCloud/projection.js";

/**
 * One organisation loader block in the exact shape Nx Cloud's own client receives, including the fields
 * this atlas deliberately does not keep.
 */
const ORG_BLOCK = {
  contributorsCount: 38,
  currentUsagePercentage: 100,
  isAdmin: false,
  organization: {
    enabled: true,
    memberships: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
    name: "Example Org",
    plan: "TEAM",
    vcsConfiguration: { provider: "github", vcsOrganizationId: "12345", vcsOrganizationName: "example" },
  },
};

const WORKSPACE_BLOCK = {
  workspace: {
    defaultBranch: "main",
    idAccessLevel: "READ_ONLY",
    name: "example-monorepo",
    orgId: "org-1",
    patAccessLevel: "READ_ONLY",
    vcsConfiguration: {
      provider: "github",
      repositoryFullName: "example/example-monorepo",
      repositoryVisibility: "private",
    },
  },
};

describe("projectOrganization", () => {
  it("reads the plan off the organisation record", () => {
    expect(projectOrganization({ data: ORG_BLOCK })!.plan).toBe("TEAM");
  });

  it("counts memberships rather than holding the people on them", () => {
    expect(projectOrganization({ data: ORG_BLOCK })!.membershipCount).toBe(3);
  });

  it("keeps the usage percentage, which is how a reader learns CI is throttled", () => {
    expect(projectOrganization({ data: ORG_BLOCK })!.currentUsagePercentage).toBe(100);
  });

  it("keeps whether the signed-in session is an admin, which is why a settings page refuses", () => {
    expect(projectOrganization({ data: ORG_BLOCK })!.isAdmin).toBe(false);
  });

  it("keeps only the VCS provider and never the account it names", () => {
    const detail = projectOrganization({ data: ORG_BLOCK })!;
    expect(detail.vcsProvider).toBe("github");
    expect(Object.keys(detail).toSorted()).toEqual([
      "contributorCount",
      "currentUsagePercentage",
      "enabled",
      "isAdmin",
      "membershipCount",
      "name",
      "plan",
      "vcsProvider",
    ]);
  });

  it("drops a credential the client's own payload carries beside the organisation", () => {
    const withEnv = { ...ORG_BLOCK, ENV: { rollbar: { accessToken: "secret-value" } } };
    // Both halves, per `.claude/rules/testing.md`'s falsifiable-witness rule.
    expect(JSON.stringify(withEnv)).toContain("secret-value");
    expect(JSON.stringify(projectOrganization({ data: withEnv }))).not.toContain("secret-value");
  });

  it("answers null for a block with no organisation in it, which is what a 403 decodes to", () => {
    expect(projectOrganization({ data: { organization: {} } })).toBe(null);
  });

  it("answers null for a payload that is not a record at all", () => {
    expect(projectOrganization({ data: null })).toBe(null);
  });

  it("records an absent optional as null rather than refusing the whole read", () => {
    expect(projectOrganization({ data: { organization: { name: "Example Org" } } })!.plan).toBe(null);
  });
});

describe("projectWorkspace", () => {
  it("reads the workspace name", () => {
    expect(projectWorkspace({ data: WORKSPACE_BLOCK })!.name).toBe("example-monorepo");
  });

  it("keeps the repository the workspace maps, which is the join to the world model", () => {
    expect(projectWorkspace({ data: WORKSPACE_BLOCK })!.vcsRepositoryFullName).toBe("example/example-monorepo");
  });

  it("keeps the default branch, which decides what a comparison is measured against", () => {
    expect(projectWorkspace({ data: WORKSPACE_BLOCK })!.defaultBranch).toBe("main");
  });

  it("keeps what a personal access token may do", () => {
    expect(projectWorkspace({ data: WORKSPACE_BLOCK })!.patAccessLevel).toBe("READ_ONLY");
  });

  it("answers null when the block names no organisation, so an entity is never stored half-identified", () => {
    expect(projectWorkspace({ data: { workspace: { name: "x" } } })).toBe(null);
  });
});

describe("projectWorkspaceRoster", () => {
  it("projects every workspace the roster describes", () => {
    const rows = projectWorkspaceRoster({
      data: {
        workspaces: [
          { defaultBranch: "main", id: "w1", name: "one" },
          { id: "w2", name: "two" },
        ],
      },
      organizationId: "org-1",
    });
    expect(rows.map((row) => row.id)).toEqual(["w1", "w2"]);
  });

  it("carries the organisation onto each row, because a roster row does not name its own", () => {
    const rows = projectWorkspaceRoster({ data: { workspaces: [{ id: "w1", name: "one" }] }, organizationId: "org-1" });
    expect(rows[0]!.detail.organizationId).toBe("org-1");
  });

  it("drops a row with no name rather than storing an unnamed workspace", () => {
    const rows = projectWorkspaceRoster({ data: { workspaces: [{ id: "w1" }] }, organizationId: "org-1" });
    expect(rows).toEqual([]);
  });

  it("answers an empty list when the payload carries no roster", () => {
    expect(projectWorkspaceRoster({ data: {}, organizationId: "org-1" })).toEqual([]);
  });
});

describe("projectOrganizationRoster", () => {
  it("projects every organisation the list names", () => {
    const rows = projectOrganizationRoster({ data: { organizations: [{ id: "o1", name: "One" }] } });
    expect(rows).toEqual([{ id: "o1", name: "One" }]);
  });

  it("answers an empty list for the measured case of an account that lists none", () => {
    expect(projectOrganizationRoster({ data: { organizations: [] } })).toEqual([]);
  });
});
