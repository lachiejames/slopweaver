import { describe, expect, it } from "vitest";
import {
  projectLinearCycle,
  projectLinearOrg,
  projectLinearState,
  projectLinearTeam,
  structuresFromTeamsPage,
  teamMembersFromMemberships,
} from "../../../../corpus/linear/structureRows.js";
import { fetchLinearStructures } from "../../../../corpus/linear/structures.js";
import type { LinearRequest } from "../../../../corpus/linear/transport.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-07-20T00:00:00.000Z";

// The shape `@linear/sdk`'s `Team` fragment returns: scalars and `{ id }` references, no connections at
// all. Members arrive from the ROOT `teamMemberships` walk instead and are joined on by id.
const TEAM_NODE = {
  description: "owns the platform",
  id: "team1",
  key: "PLAT",
  name: "Platform",
  private: false,
  visibility: "public",
};

const MEMBERSHIP_NODES = [
  { id: "tm1", team: { id: "team1" }, user: { id: "user1" } },
  { id: "tm2", team: { id: "team1" }, user: { id: "user2" } },
];

describe("projectLinearOrg", () => {
  it("projects the organization row", () => {
    const row = projectLinearOrg({
      fetchedAtIso: AT,
      raw: { id: "org1", name: "Acme", samlEnabled: true, urlKey: "acme", userCount: 30 },
    })!;
    expect(row.sourceId).toBe("org1");
    expect(row.attrs).toEqual({ samlEnabled: true, userCount: 30 });
  });
});

describe("teamMembersFromMemberships", () => {
  it("indexes the ROOT membership edges by team, which is the join the SDK's fragments force", () => {
    const index = teamMembersFromMemberships({
      nodes: [...MEMBERSHIP_NODES, { id: "tm3", team: { id: "team2" }, user: { id: "user3" } }],
    });

    expect(index.get("team1")).toEqual(["user1", "user2"]);
    expect(index.get("team2")).toEqual(["user3"]);
  });

  it("SKIPS an edge missing either endpoint rather than filing half a membership", () => {
    const index = teamMembersFromMemberships({
      nodes: [{ id: "tm4", team: { id: "team1" } }, { id: "tm5", user: { id: "user9" } }, "not a node"],
    });

    expect(index.size).toBe(0);
  });
});

describe("projectLinearTeam", () => {
  it("projects a team with the member relations the root walk joined to it", () => {
    const row = projectLinearTeam({ fetchedAtIso: AT, memberIds: ["user1", "user2"], node: TEAM_NODE })!;
    expect(row.identity.slug).toBe("PLAT");
    expect(row.relations).toEqual([
      { targetId: "linear:user1", targetKind: "person", targetSource: "person", type: "member" },
      { targetId: "linear:user2", targetKind: "person", targetSource: "person", type: "member" },
    ]);
  });

  it("projects a team with NO memberships as a row with no relations", () => {
    expect(projectLinearTeam({ fetchedAtIso: AT, memberIds: [], node: TEAM_NODE })!.relations).toEqual([]);
  });
});

describe("projectLinearState / projectLinearCycle (ROOT nodes)", () => {
  it("binds a state to its team from the node's OWN team field", () => {
    // States are fetched at the root now, not nested under a team: `teams(50)` with `states(250)` and
    // `cycles(250)` cost 81,430 complexity points against a 10,000 per-query ceiling.
    const row = projectLinearState({
      fetchedAtIso: AT,
      node: { id: "st1", name: "In Progress", position: 1, team: { id: "team1" }, type: "started" },
    })!;
    expect(row.kind).toBe("workflow_state");
    expect(row.attrs).toEqual({ position: 1, type: "started" });
    expect(row.relations).toEqual([
      { targetId: "team1", targetKind: "team", targetSource: "linear", type: "state_for" },
    ]);
    expect(row.provenance).toEqual(["linear.workflowStates"]);
  });

  it("binds a cycle to its team and keeps its window", () => {
    const row = projectLinearCycle({
      fetchedAtIso: AT,
      node: {
        endsAt: "2026-05-15T00:00:00.000Z",
        id: "cyc1",
        number: 12,
        progress: 0.5,
        startsAt: "2026-05-01T00:00:00.000Z",
        team: { id: "team1" },
      },
    })!;
    expect(row.sourceId).toBe("cyc1");
    expect(row.attrs).toEqual({
      endsAt: "2026-05-15T00:00:00.000Z",
      number: 12,
      progress: 0.5,
      startsAt: "2026-05-01T00:00:00.000Z",
    });
    expect(row.relations).toEqual([
      { targetId: "team1", targetKind: "team", targetSource: "linear", type: "cycle_for" },
    ]);
  });

  it("emits a row with NO relation rather than dropping a team-less state or cycle", () => {
    expect(projectLinearState({ fetchedAtIso: AT, node: { id: "st2", name: "Backlog" } })!.relations).toEqual([]);
    expect(projectLinearCycle({ fetchedAtIso: AT, node: { id: "cyc2" } })!.relations).toEqual([]);
  });

  it("drops a node with no id", () => {
    expect(projectLinearState({ fetchedAtIso: AT, node: { name: "no id" } })).toBeUndefined();
    expect(projectLinearCycle({ fetchedAtIso: AT, node: { number: 1 } })).toBeUndefined();
  });
});

describe("structuresFromTeamsPage", () => {
  it("emits the TEAM rows only, and skips a malformed node", () => {
    const page = structuresFromTeamsPage({
      data: { teams: { nodes: [TEAM_NODE, { key: "no-id" }] } },
      fetchedAtIso: AT,
      membersByTeam: teamMembersFromMemberships({ nodes: MEMBERSHIP_NODES }),
    });
    expect(page.rows.map((r) => r.kind)).toEqual(["team"]);
  });

  it("joins each team's members off the root index rather than off the team node", () => {
    const page = structuresFromTeamsPage({
      data: { teams: { nodes: [TEAM_NODE] } },
      fetchedAtIso: AT,
      membersByTeam: teamMembersFromMemberships({ nodes: MEMBERSHIP_NODES }),
    });

    expect(page.rows[0]!.relations.map((relation) => relation.targetId)).toEqual(["linear:user1", "linear:user2"]);
  });
});

/** A fake transport routing each root query by content — org, teams, and the four root structure lanes. */
function fakeRequest(): LinearRequest {
  return async ({ query }) => {
    if (query.includes("organization {")) {
      return { organization: { id: "org1", name: "Acme", urlKey: "acme" } };
    }
    if (query.includes("query teamMemberships")) {
      return { teamMemberships: { nodes: MEMBERSHIP_NODES, pageInfo: { hasNextPage: false } } };
    }
    if (query.includes("query teams")) {
      return { teams: { nodes: [TEAM_NODE], pageInfo: { hasNextPage: false } } };
    }
    if (query.includes("query workflowStates")) {
      return {
        workflowStates: {
          nodes: [{ id: "st1", name: "In Progress", position: 1, team: { id: "team1" }, type: "started" }],
          pageInfo: { hasNextPage: false },
        },
      };
    }
    if (query.includes("query cycles")) {
      return {
        cycles: { nodes: [{ id: "cyc1", number: 12, team: { id: "team1" } }], pageInfo: { hasNextPage: false } },
      };
    }
    // The two best-effort vocabulary lanes: empty, so this test stays about org/team/state/cycle.
    return { customViews: { nodes: [], pageInfo: {} }, issueLabels: { nodes: [], pageInfo: {} } };
  };
}

describe("fetchLinearStructures", () => {
  it("hydrates org + team + states + cycles deterministically", async () => {
    const result = unwrap(await fetchLinearStructures({ fetchedAtIso: AT, request: fakeRequest() }));
    expect(result.rows.map((r) => r.kind).toSorted()).toEqual(["cycle", "org", "team", "workflow_state"]);
  });

  it("carries the root memberships onto the team row, which is the whole point of the join", async () => {
    const result = unwrap(await fetchLinearStructures({ fetchedAtIso: AT, request: fakeRequest() }));
    const team = result.rows.find((row) => row.kind === "team")!;

    expect(team.relations.map((relation) => relation.targetId)).toEqual(["linear:user1", "linear:user2"]);
  });
});
