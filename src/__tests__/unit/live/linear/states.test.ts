import { describe, expect, it } from "vitest";

import { ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { LinearLiveError } from "../../../../live/linear/errors.js";
import { readLinearStates, renderLinearStatesJson, renderLinearStatesText } from "../../../../live/linear/states.js";

const NOW = "2026-08-26T12:00:00.000Z";

/**
 * A transport routing this verb's FOUR requests, in the order it sends them: the team lookup, the root
 * workflow-state page, the team's members page and the workspace the token reaches.
 *
 * Three team reads rather than one because `@linear/sdk`'s `Team` fragment carries no connections at all — the
 * states and members that used to be nested in the team node now come from their own documents.
 */
function teamTransport({
  states,
  members,
  urlKey = "acme",
}: {
  states: readonly Record<string, unknown>[];
  members: readonly Record<string, unknown>[];
  urlKey?: string | null;
}): ({ query }: { query: string }) => Promise<Result<unknown, LinearLiveError>> {
  return ({ query }) => {
    if (query.includes("query LinearOrganization")) {
      return Promise.resolve(ok({ organization: { id: "org-1", urlKey } }));
    }
    if (query.includes("query workflowStates")) {
      return Promise.resolve(ok({ workflowStates: { nodes: states, pageInfo: { hasNextPage: false } } }));
    }
    if (query.includes("query team_members")) {
      return Promise.resolve(ok({ team: { members: { nodes: members } } }));
    }
    return Promise.resolve(ok({ teams: { nodes: [{ id: "team-uuid", key: "ENG", name: "Engineering" }] } }));
  };
}

describe("readLinearStates", () => {
  it("addresses the team by KEY and returns its states sorted by position", async () => {
    const seen: Record<string, unknown>[] = [];
    const result = await readLinearStates({
      limit: 100,
      nowIso: () => NOW,
      request: ({ query, variables }) => {
        seen.push({ ...variables });
        return teamTransport({
          members: [],
          states: [
            { id: "s-done", name: "Done", position: 3, type: "completed" },
            { id: "s-todo", name: "Todo", position: 1, type: "unstarted" },
            { id: "s-doing", name: "In Progress", position: 2, type: "started" },
          ],
        })({ query });
      },
      teamKey: "ENG",
    });

    // The team is addressed by KEY on both of the two lookups that can be, and by the UUID the first one
    // returned on the members page — which is the only address Linear offers for that connection.
    expect(seen).toEqual([
      { filter: { key: { eq: "ENG" } }, first: 2, includeArchived: true },
      { filter: { team: { key: { eq: "ENG" } } }, first: 100 },
      { first: 100, id: "team-uuid" },
      {},
    ]);
    expect(unwrap(result).workspace).toBe("acme");
    expect(unwrap(result).states).toEqual([
      { id: "s-todo", name: "Todo", position: 1, type: "unstarted" },
      { id: "s-doing", name: "In Progress", position: 2, type: "started" },
      { id: "s-done", name: "Done", position: 3, type: "completed" },
    ]);
    expect(unwrap(result).team).toEqual({ id: "team-uuid", key: "ENG", name: "Engineering" });
    expect(unwrap(result).readAtIso).toBe(NOW);
  });

  it("keeps a member's email and active flag, and falls back to name when displayName is absent", async () => {
    const result = await readLinearStates({
      limit: 100,
      nowIso: () => NOW,
      request: teamTransport({
        members: [
          { active: true, displayName: "ada", email: "ada@example.test", id: "u1", name: "Ada Lovelace" },
          { active: false, id: "u2", name: "Grace Hopper" },
        ],
        states: [],
      }),
      teamKey: "ENG",
    });

    expect(unwrap(result).members).toEqual([
      { active: true, displayName: "ada", email: "ada@example.test", id: "u1", name: "Ada Lovelace" },
      { active: false, displayName: "Grace Hopper", email: undefined, id: "u2", name: "Grace Hopper" },
    ]);
  });

  it("REFUSES a state node missing its id rather than reading the set as one state short", async () => {
    const result = await readLinearStates({
      limit: 100,
      nowIso: () => NOW,
      request: teamTransport({
        members: [],
        states: [
          { name: "Todo", position: 1, type: "unstarted" },
          { id: "s1", name: "Todo", position: 2, type: "unstarted" },
        ],
      }),
      teamKey: "ENG",
    });

    expect(unwrapErr(result).message).toBe("Linear returned 1 workflow state(s) for ENG with no id, name or type");
  });

  it("REFUSES a state page Linear says another follows, rather than reading part of the set", async () => {
    const result = await readLinearStates({
      limit: 1,
      nowIso: () => NOW,
      request: ({ query }) => {
        if (query.includes("query workflowStates")) {
          return Promise.resolve(
            ok({
              workflowStates: {
                nodes: [{ id: "s1", name: "Todo", position: 1, type: "unstarted" }],
                pageInfo: { endCursor: "c1", hasNextPage: true },
              },
            }),
          );
        }
        return teamTransport({ members: [], states: [] })({ query });
      },
      teamKey: "ENG",
    });

    expect(unwrapErr(result).message).toBe(
      "Linear did not say ENG's workflow states fit one page; raise the limit rather than read part of the set",
    );
  });

  it("REFUSES a state page with no pageInfo, rather than reading it as the whole set", async () => {
    const result = await readLinearStates({
      limit: 100,
      nowIso: () => NOW,
      request: ({ query }) => {
        if (query.includes("query workflowStates")) {
          return Promise.resolve(
            ok({ workflowStates: { nodes: [{ id: "s1", name: "Todo", position: 1, type: "unstarted" }] } }),
          );
        }
        return teamTransport({ members: [], states: [] })({ query });
      },
      teamKey: "ENG",
    });

    expect(unwrapErr(result).message).toBe(
      "Linear did not say ENG's workflow states fit one page; raise the limit rather than read part of the set",
    );
  });

  it("REFUSES when Linear names no workspace, rather than recording a catalog it cannot attribute", async () => {
    const result = await readLinearStates({
      limit: 100,
      nowIso: () => NOW,
      request: teamTransport({ members: [], states: [], urlKey: null }),
      teamKey: "ENG",
    });

    expect(unwrapErr(result).message).toBe("Linear returned no workspace URL key for this token");
  });

  it("REFUSES when the key matched no team", async () => {
    const result = await readLinearStates({
      limit: 100,
      nowIso: () => NOW,
      request: () => Promise.resolve(ok({ teams: { nodes: [] } })),
      teamKey: "NOPE",
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("NOT_FOUND");
    expect(unwrapErr(result).message).toContain("team with that key");
  });

  it("REFUSES two matching teams rather than resolving the first one", async () => {
    const result = await readLinearStates({
      limit: 100,
      nowIso: () => NOW,
      request: () =>
        Promise.resolve(
          ok({
            teams: {
              nodes: [
                { id: "a", key: "ENG", members: { nodes: [] }, name: "One", states: { nodes: [] } },
                { id: "b", key: "ENG", members: { nodes: [] }, name: "Two", states: { nodes: [] } },
              ],
            },
          }),
        ),
      teamKey: "ENG",
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("AMBIGUOUS_ADDRESS");
    expect(unwrapErr(result).message).toContain("2 teams match");
  });
});

describe("renderLinearStatesText", () => {
  it("prints every state id in full, because copying one into a form is the whole point", () => {
    const text = renderLinearStatesText({
      document: {
        members: [
          {
            active: true,
            displayName: "ada",
            email: undefined,
            id: "9c5f8e21-1111-4222-8333-123456789012",
            name: "Ada",
          },
        ],
        readAtIso: NOW,
        source: "linear",
        states: [{ id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", name: "Todo", position: 1, type: "unstarted" }],
        team: { id: "team-uuid", key: "ENG", name: "Engineering" },
        workspace: "acme",
      },
    });

    expect(text).toContain("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
    expect(text).toContain("9c5f8e21-1111-4222-8333-123456789012");
    expect(text).toContain("linear states: ENG — Engineering (team-uuid)");
  });
});

describe("renderLinearStatesJson", () => {
  it("round-trips the document", () => {
    const document = {
      members: [],
      readAtIso: NOW,
      source: "linear" as const,
      states: [{ id: "s1", name: "Todo", position: 1, type: "unstarted" }],
      team: { id: "t", key: "ENG", name: "Engineering" },
      workspace: "acme",
    };

    expect(JSON.parse(renderLinearStatesJson({ document }))).toEqual(document);
  });
});
