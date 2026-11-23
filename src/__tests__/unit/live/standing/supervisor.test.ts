import { describe, expect, it } from "vitest";

import type { CmuxWorkspaceSummary } from "../../../../cmux/client.js";
import { gradeStandingTree, STANDING_SENSITIVE_PATHS } from "../../../../live/standing/freshness.js";
import {
  resolveSupervisorBinCheckout,
  resolveSupervisorWorkspace,
  SUPERVISOR_CHAIN_PATHS,
  SUPERVISOR_CLI_RELATIVE_PATH,
  SUPERVISOR_WORKSPACE_TITLE,
} from "../../../../live/standing/supervisor.js";

/** One `workspace.list` row, overridable per test. */
function workspace(over: Partial<CmuxWorkspaceSummary> = {}): CmuxWorkspaceSummary {
  return {
    currentDirectory: "/wt/ordinary",
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned: false,
    selected: false,
    title: "some-other-run",
    windowId: "w1",
    workspaceId: "ws-1",
    workspaceRef: "ref-1",
    ...over,
  };
}

/** The pinned supervisor row this repository's own fleet produces. */
function supervisorWorkspace(over: Partial<CmuxWorkspaceSummary> = {}): CmuxWorkspaceSummary {
  return workspace({
    currentDirectory: "/repo/.claude/worktrees.noindex/fresh-supervisor-handoff-9126",
    pinned: true,
    title: SUPERVISOR_WORKSPACE_TITLE,
    workspaceId: "ws-sup",
    ...over,
  });
}

describe("resolveSupervisorWorkspace", () => {
  it("resolves the one workspace that is both pinned and titled for the supervisor", () => {
    const result = resolveSupervisorWorkspace({
      workspaces: [workspace(), supervisorWorkspace(), workspace({ workspaceId: "ws-2" })],
    });

    expect(result.value?.workspaceId).toBe("ws-sup");
    expect(result.problems).toEqual([]);
  });

  it("does NOT resolve a supervisor-titled workspace that is unpinned", () => {
    const result = resolveSupervisorWorkspace({ workspaces: [supervisorWorkspace({ pinned: false })] });

    expect(result.value).toBeUndefined();
    expect(result.problems).toHaveLength(1);
  });

  it("does NOT resolve a pinned workspace whose title merely contains the supervisor's", () => {
    const result = resolveSupervisorWorkspace({
      workspaces: [supervisorWorkspace({ title: `${SUPERVISOR_WORKSPACE_TITLE}-respawn` })],
    });

    expect(result.value).toBeUndefined();
  });

  it("refuses to pick between TWO pinned supervisor workspaces, and names both", () => {
    const result = resolveSupervisorWorkspace({
      workspaces: [
        supervisorWorkspace({ currentDirectory: "/wt/a", workspaceId: "ws-a" }),
        supervisorWorkspace({ currentDirectory: "/wt/b", workspaceId: "ws-b" }),
      ],
    });

    expect(result.value).toBeUndefined();
    expect(result.problems[0]).toContain("/wt/a, /wt/b");
  });

  it("says nothing is open — not that something is wrong — when no workspace matches", () => {
    const result = resolveSupervisorWorkspace({ workspaces: [workspace()] });

    expect(result.value).toBeUndefined();
    expect(result.problems[0]).toContain("rather than a fault");
  });

  it("resolves nothing at all from an empty listing", () => {
    expect(resolveSupervisorWorkspace({ workspaces: [] }).value).toBeUndefined();
  });
});

describe("resolveSupervisorBinCheckout", () => {
  /** A predicate seam standing in for the filesystem — a plain fake, never a mock. */
  const carriesCliAt =
    ({ paths }: { readonly paths: readonly string[] }) =>
    ({ path }: { readonly path: string }): boolean =>
      paths.includes(path);

  it("picks the declared checkout that carries the CLI, out of several", () => {
    const result = resolveSupervisorBinCheckout({
      carriesCli: carriesCliAt({ paths: ["/dev/slopweaver"] }),
      checkoutPaths: ["/dev/slopweaver", "/dev/some-app"],
    });

    expect(result.value).toBe("/dev/slopweaver");
    expect(result.problems).toEqual([]);
  });

  it("names the missing declaration when no main checkouts are declared at all", () => {
    const result = resolveSupervisorBinCheckout({
      carriesCli: carriesCliAt({ paths: [] }),
      checkoutPaths: [],
    });

    expect(result.value).toBeUndefined();
    expect(result.problems[0]).toContain("no main checkouts are declared");
  });

  it("reports UNMEASURED when declared checkouts exist but none carries the CLI", () => {
    const result = resolveSupervisorBinCheckout({
      carriesCli: carriesCliAt({ paths: [] }),
      checkoutPaths: ["/dev/some-app"],
    });

    expect(result.value).toBeUndefined();
    expect(result.problems[0]).toContain(SUPERVISOR_CLI_RELATIVE_PATH);
    expect(result.problems[0]).toContain("UNMEASURED");
  });

  it("refuses to guess between two checkouts that both carry the CLI", () => {
    const result = resolveSupervisorBinCheckout({
      carriesCli: carriesCliAt({ paths: ["/dev/a", "/dev/b"] }),
      checkoutPaths: ["/dev/a", "/dev/b"],
    });

    expect(result.value).toBeUndefined();
    expect(result.problems[0]).toContain("/dev/a, /dev/b");
  });
});

describe("SUPERVISOR_CHAIN_PATHS", () => {
  it("grades the very commit this finding is about as STALE — the witness that this check can fire", () => {
    const graded = gradeStandingTree({
      reading: {
        behind: 14,
        changedPaths: ["src/cli/commands/session/closeDone.ts"],
        head: "03b7c123",
        path: "/dev/slopweaver",
      },
      role: "bin",
      sensitivePaths: SUPERVISOR_CHAIN_PATHS,
    });

    expect(graded.grade).toBe("stale");
    expect(graded.touched).toEqual(["src/cli/commands/session/closeDone.ts"]);
  });

  it("is why the loop's list could not be reused — that same commit grades merely BEHIND against it", () => {
    const graded = gradeStandingTree({
      reading: {
        behind: 14,
        changedPaths: ["src/cli/commands/session/closeDone.ts"],
        head: "03b7c123",
        path: "/dev/slopweaver",
      },
      role: "bin",
      sensitivePaths: STANDING_SENSITIVE_PATHS,
    });

    expect(graded.grade).toBe("behind");
    expect(graded.touched).toEqual([]);
  });

  it("grades a supervisor's own skill prose as stale", () => {
    expect(
      gradeStandingTree({
        reading: { behind: 3, changedPaths: ["skills/supervisor/SKILL.md"], head: "aaa", path: "/wt/sup" },
        role: "plugin-dir",
        sensitivePaths: SUPERVISOR_CHAIN_PATHS,
      }).grade,
    ).toBe("stale");
  });

  it("leaves a docs-only drift merely behind — docs are read on demand, never followed", () => {
    expect(
      gradeStandingTree({
        reading: { behind: 2, changedPaths: ["docs/architecture.md"], head: "aaa", path: "/dev/slopweaver" },
        role: "bin",
        sensitivePaths: SUPERVISOR_CHAIN_PATHS,
      }).grade,
    ).toBe("behind");
  });
});
