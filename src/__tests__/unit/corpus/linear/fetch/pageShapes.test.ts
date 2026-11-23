/**
 * The pure page plumbing the issue and project lanes share: the variables each page query sends, and the
 * shaping of a raw page into its nodes and next cursor.
 */
import { describe, expect, it } from "vitest";

import { shapeIssuesPage, shapeProjectsPage } from "../../../../../corpus/linear/fetch.js";
import { pageQueryVariables, projectPageQueryVariables } from "../../../../../corpus/linear/pageVariables.js";
import { issueNode } from "./harness.js";

describe("pageQueryVariables (pure — shared by the issue + project lanes)", () => {
  it("builds the updatedAt>=since filter with no cursor on the first page", () => {
    expect(pageQueryVariables({ cursor: undefined, since: "2026-01-01" })).toEqual({
      filter: { updatedAt: { gte: "2026-01-01" } },
      first: 50,
    });
  });

  it("adds the `after` cursor on a subsequent page", () => {
    expect(pageQueryVariables({ cursor: "abc", since: "2026-01-01" })).toEqual({
      after: "abc",
      filter: { updatedAt: { gte: "2026-01-01" } },
      first: 50,
    });
  });
});

describe("projectPageQueryVariables (pure — the projects lane's window)", () => {
  // A status update does not move the project's own updatedAt, so the project lane's window must also catch a
  // project whose updates moved, or a posted update never re-lands its project.
  it("widens the window to a project whose status updates moved, keeping the cursor shape", () => {
    expect(projectPageQueryVariables({ cursor: "abc", pageSize: 15, since: "2026-08-29" })).toEqual({
      after: "abc",
      filter: {
        or: [{ updatedAt: { gte: "2026-08-29" } }, { projectUpdates: { some: { updatedAt: { gte: "2026-08-29" } } } }],
      },
      first: 15,
    });
  });
});

describe("shapeIssuesPage / shapeProjectsPage (pure)", () => {
  it("returns the raw nodes and surfaces the next cursor when there is another page", () => {
    const shaped = shapeIssuesPage({
      data: { issues: { nodes: [issueNode({ id: "ENG-1" })], pageInfo: { endCursor: "next", hasNextPage: true } } },
    });
    expect(shaped.nodes.length).toBe(1);
    expect(shaped.nextCursor).toBe("next");
  });

  it("omits the next cursor when there is no further page", () => {
    const shaped = shapeProjectsPage({
      data: { projects: { nodes: [{ id: "p1" }], pageInfo: { endCursor: null, hasNextPage: false } } },
    });
    expect(shaped.nodes.length).toBe(1);
    expect(shaped.nextCursor).toBeUndefined();
  });
});
