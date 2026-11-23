import { describe, expect, it } from "vitest";

import type { CmuxError } from "../../../cmux/errors.js";
import {
  listWorkspacesStrictOver,
  parseWindowIdsStrict,
  parseWorkspaceListStrict,
} from "../../../cmux/strictInventory.js";
import { ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";

/** A socket call that answers each method from a table and records what it was asked. */
function scripted({ replies }: { replies: Readonly<Record<string, unknown>> }): {
  asked: string[];
  call: Parameters<typeof listWorkspacesStrictOver>[0]["call"];
} {
  const asked: string[] = [];
  return {
    asked,
    call: ({ method, params }): Promise<Result<unknown, CmuxError>> => {
      const windowId = params["window_id"];
      const key = typeof windowId === "string" ? `${method} ${windowId}` : method;
      asked.push(key);
      return Promise.resolve(ok(replies[key]));
    },
  };
}

/** A well-formed `workspace.list` row. */
function wireRow({ id, ref }: { id: string; ref: string }): Record<string, unknown> {
  return { current_directory: "/repo/a-doc", description: "spawned session", id, ref };
}

describe("parseWorkspaceListStrict", () => {
  it("decodes every row with the window the reply names", () => {
    const value = { window_id: "W1", workspaces: [wireRow({ id: "A", ref: "workspace:1" })] };

    const rows = unwrap(parseWorkspaceListStrict({ value }));

    expect(rows.map((row) => [row.workspaceId, row.workspaceRef, row.windowId, row.description])).toEqual([
      ["A", "workspace:1", "W1", "spawned session"],
    ]);
  });

  it("refuses the whole reply when one row is missing its ref, where listWorkspaces would drop it", () => {
    const value = {
      window_id: "W1",
      workspaces: [wireRow({ id: "A", ref: "workspace:1" }), { current_directory: "/repo/a-doc", id: "B" }],
    };

    expect(unwrapErr(parseWorkspaceListStrict({ value })).message).toContain(
      "workspaces[1] is missing an id, a ref or a directory",
    );
  });

  it("refuses a description that is neither a string nor unset, rather than reading it as no description", () => {
    const value = { window_id: "W1", workspaces: [{ ...wireRow({ id: "A", ref: "workspace:1" }), description: 123 }] };

    expect(unwrapErr(parseWorkspaceListStrict({ value })).message).toContain(
      "workspaces[0] carries a description that is not a string",
    );
  });

  it("reads a null description as unset, the way cmux reports one", () => {
    const value = { window_id: "W1", workspaces: [{ ...wireRow({ id: "A", ref: "workspace:1" }), description: null }] };

    expect(unwrap(parseWorkspaceListStrict({ value }))[0]!.description).toBe(undefined);
  });

  it("refuses a reply that does not name its window", () => {
    const value = { workspaces: [wireRow({ id: "A", ref: "workspace:1" })] };

    expect(unwrapErr(parseWorkspaceListStrict({ value })).message).toContain('no string field "window_id"');
  });

  it("refuses a reply with no workspaces array", () => {
    expect(unwrapErr(parseWorkspaceListStrict({ value: { window_id: "W1" } })).message).toContain(
      'no array field "workspaces"',
    );
  });
});

describe("parseWindowIdsStrict", () => {
  it("refuses a window carrying no id rather than skipping it", () => {
    const value = { windows: [{ id: "W1" }, { ref: "window:2" }] };

    expect(unwrapErr(parseWindowIdsStrict({ value })).message).toContain("windows[1] carries no id");
  });
});

describe("listWorkspacesStrictOver", () => {
  it("fans out across every window and gathers every row", async () => {
    const { asked, call } = scripted({
      replies: {
        "window.list": { windows: [{ id: "W1" }, { id: "W2" }] },
        "workspace.list W1": { window_id: "W1", workspaces: [wireRow({ id: "A", ref: "workspace:1" })] },
        "workspace.list W2": { window_id: "W2", workspaces: [wireRow({ id: "B", ref: "workspace:2" })] },
      },
    });

    const rows = unwrap(await listWorkspacesStrictOver({ call })());

    expect(rows.map((row) => [row.workspaceId, row.windowId])).toEqual([
      ["A", "W1"],
      ["B", "W2"],
    ]);
    expect(asked).toEqual(["window.list", "workspace.list W1", "workspace.list W2"]);
  });

  it("stops at the first window whose reply carries an undecodable row", async () => {
    const { asked, call } = scripted({
      replies: {
        "window.list": { windows: [{ id: "W1" }, { id: "W2" }] },
        "workspace.list W1": { window_id: "W1", workspaces: [{ id: "A" }] },
      },
    });

    const failure = unwrapErr(await listWorkspacesStrictOver({ call })());

    expect(failure.message).toContain("workspaces[0] is missing an id, a ref or a directory");
    expect(asked).toEqual(["window.list", "workspace.list W1"]);
  });
});
