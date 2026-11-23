import { describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { readProjectTeams } from "../../../../live/linear/projectTeams.js";

describe("readProjectTeams", () => {
  it("sends no request for an issue or document, which carry no teams", async () => {
    const sent: string[] = [];
    const result = await readProjectTeams({
      id: "RRRR-610",
      kind: "issue",
      request: ({ query }) => {
        sent.push(query);
        return Promise.resolve(ok({}));
      },
    });
    expect(unwrap(result)).toEqual({});
    expect(sent).toEqual([]);
  });

  it("reads a project's teams at Linear's page maximum, archived teams included", async () => {
    const teams = { nodes: [{ id: "t-sops" }], pageInfo: { hasNextPage: false } };
    const variables: Readonly<Record<string, unknown>>[] = [];
    const result = await readProjectTeams({
      id: "p-1",
      kind: "project",
      request: (args) => {
        variables.push(args.variables);
        return Promise.resolve(ok({ project: { teams } }));
      },
    });
    expect(unwrap(result)).toEqual({ teams });
    expect(variables).toEqual([{ first: 250, id: "p-1", includeArchived: true }]);
  });

  it("refuses a teams connection that does not say it is the last page", async () => {
    const result = await readProjectTeams({
      id: "p-1",
      kind: "project",
      request: () => Promise.resolve(ok({ project: { teams: { nodes: [], pageInfo: {} } } })),
    });
    expect(unwrapErr(result).message).toBe(
      "Linear did not return every team of project p-1 in one page; refused rather than shown short",
    );
  });
});
