/**
 * One `cmux list` text row: ref, id and title by default, the checkout directory only under `--full`, and a
 * workspace nobody named listed as untitled rather than as a blank column.
 */
import { describe, expect, it } from "vitest";

import { cmuxWorkspaceLine } from "../../../../../cli/commands/cmux/listOutput.js";
import type { CmuxWorkspaceSummary } from "../../../../../cmux/client.js";

const WORKSPACE: CmuxWorkspaceSummary = {
  currentDirectory: "/tmp/repo/.claude/worktrees.noindex/a-doc",
  description: undefined,
  latestConversationMessage: undefined,
  latestSubmittedAtIso: undefined,
  latestSubmittedMessage: undefined,
  pinned: false,
  selected: false,
  title: "a-doc",
  windowId: "window-uuid",
  workspaceId: "workspace-uuid",
  workspaceRef: "workspace:7",
};

describe("cmuxWorkspaceLine", () => {
  it("prints the ref, id and title by default", () => {
    expect(cmuxWorkspaceLine({ full: false, workspace: WORKSPACE })).toBe("workspace:7\tworkspace-uuid\ta-doc");
  });

  it("adds the checkout directory under --full", () => {
    expect(cmuxWorkspaceLine({ full: true, workspace: WORKSPACE })).toBe(
      "workspace:7\tworkspace-uuid\ta-doc\t/tmp/repo/.claude/worktrees.noindex/a-doc",
    );
  });

  it("lists a workspace nobody named as untitled", () => {
    expect(cmuxWorkspaceLine({ full: false, workspace: { ...WORKSPACE, title: undefined } })).toBe(
      "workspace:7\tworkspace-uuid\t(untitled)",
    );
  });
});
