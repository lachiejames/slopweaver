/**
 * The sidebar family's argv and reply parsing, against a recording fake `cmux` CLI.
 *
 * This family shells the binary because cmux exposes no socket method for any of it (see `cmux/sidebar.ts`),
 * so the argv it composes IS the contract, and these tests are what hold it.
 */
import { describe, expect, it } from "vitest";

import { CmuxErrors } from "../../../cmux/errors.js";
import {
  type CmuxCli,
  readCallerWorkspaceRef,
  readWorkspaceTitles,
  setStatusPill,
  setWorkspaceColour,
  setWorkspaceTitle,
} from "../../../cmux/sidebar.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";

// deleted-with-code: setTodoList, readTodoList, parseTodoItems, setWorkspaceStatus, readWorkspaceStatus, setProgress

/** One recorded invocation. */
interface Recorded {
  readonly argv: readonly string[];
}

/** A fake `cmux` binary that records every invocation and answers with one scripted stdout. */
function fakeCli({ stdout = "", fails = false }: { stdout?: string; fails?: boolean } = {}): {
  calls: Recorded[];
  cli: CmuxCli;
} {
  const calls: Recorded[] = [];
  return {
    calls,
    cli: {
      run: ({ argv }) => {
        calls.push({ argv });
        return fails
          ? err(CmuxErrors.callFailed({ cmuxCode: "cli_failed", message: "cmux exited 1", method: "cmux" }))
          : ok(stdout);
      },
    },
  };
}

describe("setStatusPill", () => {
  it("publishes a keyed pill on the caller's own workspace, with no optional flags when none are given", () => {
    const { calls, cli } = fakeCli();

    setStatusPill({ cli, key: "ws", value: "workspace:266" });

    expect(calls[0]!.argv).toEqual(["set-status", "ws", "workspace:266"]);
  });

  it("carries the icon, the priority and a named workspace, in cmux's own flag order", () => {
    const { calls, cli } = fakeCli();

    setStatusPill({ cli, icon: "number", key: "ws", priority: 100, value: "workspace:266", workspaceRef: "id-1" });

    expect(calls[0]!.argv).toEqual([
      "set-status",
      "ws",
      "workspace:266",
      "--icon",
      "number",
      "--priority",
      "100",
      "--workspace",
      "id-1",
    ]);
  });

  it("carries a zero priority rather than dropping it — 0 is cmux's default, not an absent value", () => {
    const { calls, cli } = fakeCli();

    setStatusPill({ cli, key: "build", priority: 0, value: "compiling" });

    expect(calls[0]!.argv).toEqual(["set-status", "build", "compiling", "--priority", "0"]);
  });

  it("passes the typed failure through", () => {
    const { cli } = fakeCli({ fails: true });

    expect(unwrapErr(setStatusPill({ cli, key: "ws", value: "workspace:266" })).code).toBe("CALL_FAILED");
  });
});

describe("readCallerWorkspaceRef", () => {
  it("reads the CALLER's ref, never the focused window's", () => {
    const { calls, cli } = fakeCli({
      stdout: JSON.stringify({
        caller: { surface_ref: "surface:284", workspace_ref: "workspace:266" },
        focused: { surface_ref: "surface:1", workspace_ref: "workspace:1" },
      }),
    });

    expect(unwrap(readCallerWorkspaceRef({ cli }))).toBe("workspace:266");
    expect(calls[0]!.argv).toEqual(["identify", "--json"]);
  });

  it("refuses a reply carrying no caller workspace ref", () => {
    const { cli } = fakeCli({ stdout: JSON.stringify({ focused: { workspace_ref: "workspace:1" } }) });

    expect(unwrapErr(readCallerWorkspaceRef({ cli })).code).toBe("MALFORMED_REPLY");
  });

  it("refuses an empty ref rather than publishing a pill that says nothing", () => {
    const { cli } = fakeCli({ stdout: JSON.stringify({ caller: { workspace_ref: "" } }) });

    expect(unwrapErr(readCallerWorkspaceRef({ cli })).code).toBe("MALFORMED_REPLY");
  });

  it("refuses stdout that is not JSON at all", () => {
    const { cli } = fakeCli({ stdout: "not json" });

    expect(unwrapErr(readCallerWorkspaceRef({ cli })).code).toBe("MALFORMED_REPLY");
  });
});

describe("setWorkspaceColour", () => {
  it("paints the caller's own row with a named colour", () => {
    const { calls, cli } = fakeCli();

    setWorkspaceColour({ cli, colour: "Green" });

    expect(calls[0]!.argv).toEqual(["workspace-action", "--action", "set-color", "--color", "Green"]);
  });

  it("addresses a named workspace when one is given", () => {
    const { calls, cli } = fakeCli();

    setWorkspaceColour({ cli, colour: "Olive", workspaceRef: "id-1" });

    expect(calls[0]!.argv).toEqual([
      "workspace-action",
      "--action",
      "set-color",
      "--color",
      "Olive",
      "--workspace",
      "id-1",
    ]);
  });

  it("CLEARS the colour on undefined rather than doing nothing, so a reused row keeps no stale role", () => {
    const { calls, cli } = fakeCli();

    setWorkspaceColour({ cli, colour: undefined, workspaceRef: "id-1" });

    expect(calls[0]!.argv).toEqual(["workspace-action", "--action", "clear-color", "--workspace", "id-1"]);
  });

  it("carries the CLI's typed failure through", () => {
    const { cli } = fakeCli({ fails: true });

    const result = setWorkspaceColour({ cli, colour: "Teal" });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("cmux exited 1");
  });
});

describe("readWorkspaceTitles", () => {
  it("reads the rendered title, the custom one and the row's own directory", () => {
    const { calls, cli } = fakeCli({
      stdout: JSON.stringify({
        window_ref: "window:1",
        workspaces: [
          {
            current_directory: "/repos/slopweaver/.claude/worktrees/a-slug",
            custom_title: null,
            has_custom_title: false,
            id: "id-1",
            ref: "workspace:9",
            title: "\u2733 Claude Code",
          },
        ],
      }),
    });

    const rows = unwrap(readWorkspaceTitles({ cli }));

    expect(calls[0]!.argv).toEqual(["workspace", "list", "--json"]);
    expect(rows.length).toBe(1);
    expect(rows[0]!.renderedTitle).toBe("\u2733 Claude Code");
    expect(rows[0]!.customTitle).toBe(undefined);
    expect(rows[0]!.hasCustomTitle).toBe(false);
    expect(rows[0]!.currentDirectory).toBe("/repos/slopweaver/.claude/worktrees/a-slug");
    expect(rows[0]!.ref).toBe("workspace:9");
    expect(rows[0]!.workspaceId).toBe("id-1");
  });

  it("reports a row that HAS a custom title, which is what stops the repair overruling it", () => {
    const { cli } = fakeCli({
      stdout: JSON.stringify([
        {
          custom_title: "chosen by a person",
          has_custom_title: true,
          id: "id-2",
          ref: "workspace:1",
          title: "chosen by a person",
        },
      ]),
    });

    const rows = unwrap(readWorkspaceTitles({ cli }));

    expect(rows[0]!.hasCustomTitle).toBe(true);
    expect(rows[0]!.customTitle).toBe("chosen by a person");
  });

  /** The reply is `{ window_ref, workspaces }`. Assuming a bare array made the whole repair silently inert. */
  it("reads the rows out of the object cmux actually replies with, not a bare array", () => {
    const { cli } = fakeCli({
      stdout: JSON.stringify({
        window_ref: "window:1",
        workspaces: [{ id: "id-3", ref: "workspace:4", title: "a row" }],
      }),
    });

    const rows = unwrap(readWorkspaceTitles({ cli }));

    expect(rows.length).toBe(1);
    expect(rows[0]!.ref).toBe("workspace:4");
  });

  it("still accepts a bare array, so a shape change degrades to working rather than to quietly inert", () => {
    const { cli } = fakeCli({ stdout: JSON.stringify([{ id: "id-4", ref: "workspace:5", title: "a row" }]) });

    expect(unwrap(readWorkspaceTitles({ cli })).length).toBe(1);
  });

  it("reads no rows when the reply carries no recognisable list", () => {
    const { cli } = fakeCli({ stdout: JSON.stringify({ window_ref: "window:1" }) });

    expect(unwrap(readWorkspaceTitles({ cli })).length).toBe(0);
  });

  it("carries the CLI's typed failure through", () => {
    const { cli } = fakeCli({ fails: true });

    expect(unwrapErr(readWorkspaceTitles({ cli })).message).toContain("cmux exited 1");
  });
});

describe("setWorkspaceTitle", () => {
  it("renames the named workspace, which is the one field a pane cannot overwrite", () => {
    const { calls, cli } = fakeCli();

    setWorkspaceTitle({ cli, title: "a-real-slug", workspaceRef: "id-1" });

    expect(calls[0]!.argv).toEqual([
      "workspace-action",
      "--action",
      "rename",
      "--title",
      "a-real-slug",
      "--workspace",
      "id-1",
    ]);
  });

  it("defaults to the caller's own row", () => {
    const { calls, cli } = fakeCli();

    setWorkspaceTitle({ cli, title: "a-real-slug" });

    expect(calls[0]!.argv).toEqual(["workspace-action", "--action", "rename", "--title", "a-real-slug"]);
  });
});
