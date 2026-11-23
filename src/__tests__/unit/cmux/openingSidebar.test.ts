/**
 * {@link publishOpeningSidebar} — the row a spawn publishes for a freshly-opened workspace, driven directly over a
 * recording fake `CmuxCli`. `spawn/bootCmuxWorkspace.test.ts` covers the same writes through `bootCmuxWorkspace`;
 * this pins the module's own contract: every write addressed by workspace id, a title set only over a bare row, no
 * checklist or status lane ever, and a failure never thrown.
 */
import { describe, expect, it } from "vitest";

import { CmuxErrors } from "../../../cmux/errors.js";
import { publishOpeningSidebar } from "../../../cmux/openingSidebar.js";
import type { CmuxCli } from "../../../cmux/sidebar.js";
import { err, ok } from "../../../lib/result.js";

const WORKSPACE = { workspaceId: "id-workspace-1", workspaceRef: "workspace:1" } as const;

/** The `set-status` call publishing the ref pill, addressed by id and carrying the ref verbatim. */
const REF_PILL = [
  "set-status",
  "ws",
  WORKSPACE.workspaceRef,
  "--icon",
  "number",
  "--priority",
  "100",
  "--workspace",
  WORKSPACE.workspaceId,
];

/** A `workspace list --json` row for the opened workspace, its title fields as given. */
function listing({ customTitle, title }: { customTitle: string | null; title: string }): string {
  return JSON.stringify({
    window_ref: "window:1",
    workspaces: [
      {
        current_directory: "/repo/slopweaver/.claude/worktrees/a-doc",
        custom_title: customTitle,
        has_custom_title: customTitle !== null,
        id: WORKSPACE.workspaceId,
        ref: WORKSPACE.workspaceRef,
        title,
      },
    ],
  });
}

/** A fake CLI that answers the title listing with `listed` and records every call. */
function recordingCli({ listed }: { listed: string }): { calls: (readonly string[])[]; cli: CmuxCli } {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    cli: {
      run: ({ argv }) => {
        calls.push(argv);
        return ok(argv[0] === "workspace" && argv[1] === "list" ? listed : "");
      },
    },
  };
}

describe("publishOpeningSidebar", () => {
  it("renames a bare row, then publishes the colour and the ref pill, all by workspace id — never a checklist", () => {
    const { calls, cli } = recordingCli({ listed: listing({ customTitle: null, title: "✳ Claude Code" }) });

    publishOpeningSidebar({ cli, fallbackTitle: "a-doc", role: "session", workspace: WORKSPACE });

    expect(calls).toEqual([
      ["workspace", "list", "--json"],
      ["workspace-action", "--action", "rename", "--title", "a-doc", "--workspace", WORKSPACE.workspaceId],
      ["workspace-action", "--action", "clear-color", "--workspace", WORKSPACE.workspaceId],
      REF_PILL,
    ]);
  });

  it("never renames over a title somebody chose", () => {
    const { calls, cli } = recordingCli({ listed: listing({ customTitle: "a chosen name", title: "a chosen name" }) });

    publishOpeningSidebar({ cli, fallbackTitle: "a-doc", role: "session", workspace: WORKSPACE });

    expect(calls).toEqual([
      ["workspace", "list", "--json"],
      ["workspace-action", "--action", "clear-color", "--workspace", WORKSPACE.workspaceId],
      REF_PILL,
    ]);
  });

  it("attempts every remaining write and throws nothing when each one fails", () => {
    const calls: (readonly string[])[] = [];
    const failing: CmuxCli = {
      run: ({ argv }) => {
        calls.push(argv);
        return err(CmuxErrors.callFailed({ cmuxCode: "cli_failed", message: "cmux exited 1", method: "cmux" }));
      },
    };

    publishOpeningSidebar({ cli: failing, fallbackTitle: "a-doc", role: "session", workspace: WORKSPACE });

    // The title read failed, so no rename is attempted; the colour and the pill each still are.
    expect(calls.map((argv) => argv[0])).toEqual(["workspace", "workspace-action", "set-status"]);
  });

  it.each<{ failing: string; isFailing: (argv: readonly string[]) => boolean }>([
    { failing: "the rename", isFailing: (argv) => argv.includes("rename") },
    { failing: "the colour", isFailing: (argv) => argv.includes("clear-color") },
    { failing: "the ref pill", isFailing: (argv) => argv[0] === "set-status" },
  ])("attempts every write when only $failing fails after the title read succeeded", ({ isFailing }) => {
    const calls: (readonly string[])[] = [];
    const oneFails: CmuxCli = {
      run: ({ argv }) => {
        calls.push(argv);
        if (isFailing(argv)) {
          return err(CmuxErrors.callFailed({ cmuxCode: "cli_failed", message: "cmux exited 1", method: "cmux" }));
        }
        return ok(argv[0] === "workspace" ? listing({ customTitle: null, title: "✳ Claude Code" }) : "");
      },
    };

    publishOpeningSidebar({ cli: oneFails, fallbackTitle: "a-doc", role: "session", workspace: WORKSPACE });

    expect(calls).toEqual([
      ["workspace", "list", "--json"],
      ["workspace-action", "--action", "rename", "--title", "a-doc", "--workspace", WORKSPACE.workspaceId],
      ["workspace-action", "--action", "clear-color", "--workspace", WORKSPACE.workspaceId],
      REF_PILL,
    ]);
  });
});
