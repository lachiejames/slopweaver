/**
 * What a successful `cmux spawn` prints: one receipt line for a witnessed pickup by default, the old detail line
 * under `--full`, and the detail line whatever the flag says when the pickup was resubmitted or never witnessed.
 */
import { describe, expect, it } from "vitest";

import { spawnSuccessLines, spawnWorktreeLine } from "../../../../../cli/commands/cmux/spawnOutput.js";
import type { SpawnPlan } from "../../../../../cmux/plan.js";
import type { PickupDelivery, SpawnedSession } from "../../../../../cmux/spawn.js";

const PLAN: SpawnPlan = {
  baseBranch: undefined,
  branch: "a-branch",
  cwd: "/tmp/repo/.claude/worktrees.noindex/a-doc",
  driver: "claude",
  host: "claude-code",
  model: undefined,
  pickupCommand: "/slopweaver:pickup a-doc",
  repoRoot: "/tmp/repo",
  respondingToHandle: undefined,
  sessionName: undefined,
  slug: "a-doc",
  spawnedAt: "2026-08-17T00:00:00.000Z",
  template: "code",
  workspaceName: "a-doc",
  workspaceTitle: "a-doc",
  worktreeExists: true,
};

/** A spawn that opened `workspace:7`, its pickup delivered as given. */
function spawned({ delivery }: { delivery: PickupDelivery }): SpawnedSession {
  return {
    bootWitness: { by: "event", confirmed: true },
    delivery,
    pickupCommand: "/slopweaver:pickup a-doc",
    surfaceId: "surface-uuid",
    surfaceRef: "surface:9",
    workspaceId: "workspace-uuid",
    workspaceRef: "workspace:7",
  };
}

const WITNESSED: PickupDelivery = { kind: "witnessed", witness: { by: "submitted-message", confirmed: true } };
const RESUBMITTED: PickupDelivery = { kind: "resubmitted", witness: { by: "composer", confirmed: true } };
const DETAIL_PREFIX =
  'cmux spawn: workspace:7 booted claude in /tmp/repo/.claude/worktrees.noindex/a-doc and sent "/slopweaver:pickup a-doc" ' +
  "(boot witnessed by event, pickup ";

describe("spawnSuccessLines", () => {
  it("prints one receipt line for a witnessed pickup by default", () => {
    expect(spawnSuccessLines({ full: false, plan: PLAN, spawned: spawned({ delivery: WITNESSED }) })).toEqual([
      "cmux spawn: a-doc -> workspace:7 (workspace-uuid)",
    ]);
  });

  it("prints the boot and pickup detail line for a witnessed pickup under --full", () => {
    expect(spawnSuccessLines({ full: true, plan: PLAN, spawned: spawned({ delivery: WITNESSED }) })).toEqual([
      `${DETAIL_PREFIX}witnessed by submitted-message)`,
    ]);
  });

  it("keeps the detail line for a resubmitted pickup by default", () => {
    expect(spawnSuccessLines({ full: false, plan: PLAN, spawned: spawned({ delivery: RESUBMITTED }) })).toEqual([
      `${DETAIL_PREFIX}witnessed by composer, after its composer was submitted again — the line was typed once)`,
    ]);
  });

  it("keeps the detail line for an unwitnessed pickup by default", () => {
    expect(
      spawnSuccessLines({ full: false, plan: PLAN, spawned: spawned({ delivery: { kind: "unwitnessed" } }) }),
    ).toEqual([
      `${DETAIL_PREFIX}UNWITNESSED — typed once, its composer submitted again, and never re-typed; it may be queued ` +
        "in that session's input, so read the workspace rather than sending it again)",
    ]);
  });
});

describe("spawnWorktreeLine", () => {
  it("names a worktree it reuses with its branch", () => {
    expect(spawnWorktreeLine({ plan: PLAN })).toBe(
      "cmux spawn: reusing worktree at /tmp/repo/.claude/worktrees.noindex/a-doc (on a-branch)",
    );
  });

  it("names a worktree it creates", () => {
    expect(spawnWorktreeLine({ plan: { ...PLAN, worktreeExists: false } })).toBe(
      "cmux spawn: creating worktree at /tmp/repo/.claude/worktrees.noindex/a-doc",
    );
  });
});
