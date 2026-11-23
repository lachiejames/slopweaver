/**
 * The per-team documents walk — the join that restores `Document.team`, which the SDK fragment never selects.
 *
 * A fallback review over the migrated tree found the field gone: `parseDocumentNode` read `node.team.key`,
 * the old hand-written document selected it, and `@linear/sdk`'s `Document` fragment carries no `team` at
 * all. These cases pin the shape of the walk that puts it back: one `documents` request per team, filtered
 * by that team's id, paged to exhaustion, folded to document id → team id.
 */
import { describe, expect, it } from "vitest";
import { documentTeamsFor } from "../../../../corpus/linear/fetchJoins.js";
import type { LinearRequest } from "../../../../corpus/linear/transport.js";

/** One `documents` page, in the shape the SDK document returns it. */
function page({ ids, hasNext = false }: { ids: readonly string[]; hasNext?: boolean }): Record<string, unknown> {
  return {
    documents: {
      nodes: ids.map((id) => ({ id, title: `doc ${id}` })),
      pageInfo: { endCursor: hasNext ? "next" : null, hasNextPage: hasNext },
    },
  };
}

/** A fake transport that records every variables object it was sent and answers per team from a script. */
function fakeCall({
  sent,
  replies,
}: {
  sent: Record<string, unknown>[];
  replies: Readonly<Record<string, readonly Record<string, unknown>[]>>;
}): LinearRequest {
  const served = new Map<string, number>(Object.keys(replies).map((teamId) => [teamId, 0]));
  return async ({ query, variables }) => {
    sent.push({ query, ...variables });
    const teamId = JSON.stringify(variables["filter"]).replace(/^.*"eq":"([^"]+)".*$/u, "$1");
    const index = served.get(teamId)!;
    served.set(teamId, index + 1);
    return replies[teamId]![index]!;
  };
}

describe("documentTeamsFor", () => {
  it("sends one filtered `documents` request per team and folds document id → team id", async () => {
    const sent: Record<string, unknown>[] = [];
    const call = fakeCall({
      replies: {
        "t-eng": [page({ ids: ["d-1", "d-2"] })],
        "t-ops": [page({ ids: [] })],
      },
      sent,
    });
    const warnings: string[] = [];
    const teams = await documentTeamsFor({ call, teamIds: ["t-eng", "t-ops"], warnings });
    expect([...teams.entries()]).toEqual([
      ["d-1", "t-eng"],
      ["d-2", "t-eng"],
    ]);
    expect(sent.map((request) => request["filter"])).toEqual([
      { team: { id: { eq: "t-eng" } } },
      { team: { id: { eq: "t-ops" } } },
    ]);
    expect(sent.every((request) => String(request["query"]).includes("query documents("))).toBe(true);
    expect(sent.every((request) => request["includeArchived"] === true)).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("pages one team to exhaustion, following the cursor", async () => {
    const sent: Record<string, unknown>[] = [];
    const call = fakeCall({
      replies: { "t-eng": [page({ hasNext: true, ids: ["d-1"] }), page({ ids: ["d-2"] })] },
      sent,
    });
    const teams = await documentTeamsFor({ call, teamIds: ["t-eng"], warnings: [] });
    expect([...teams.keys()]).toEqual(["d-1", "d-2"]);
    expect(sent.map((request) => request["after"])).toEqual([undefined, "next"]);
  });

  it("sends nothing at all for no teams", async () => {
    const sent: Record<string, unknown>[] = [];
    const teams = await documentTeamsFor({ call: fakeCall({ replies: {}, sent }), teamIds: [], warnings: [] });
    expect(teams.size).toBe(0);
    expect(sent).toEqual([]);
  });
});
