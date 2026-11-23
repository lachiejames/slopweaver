/** The injected {@link SpawnDeps} every `spawn/` test boots through, and the fleet-worktree plan it boots. */
import type { CmuxClient } from "../../../../cmux/client.js";
import type { CmuxEvent } from "../../../../cmux/events.js";
import type { SpawnPlan } from "../../../../cmux/plan.js";
import type { SpawnDeps } from "../../../../cmux/spawn.js";
import { ok } from "../../../../lib/result.js";
import type { Recorded } from "./fakeClient.js";

/** What `workspace list --json` reports for the created row: a pane title saying nothing, and no custom one. */
const BARE_ROW = {
  current_directory: "/repo/slopweaver/.claude/worktrees/a-doc",
  custom_title: null,
  has_custom_title: false,
  id: "id-workspace-1",
  ref: "workspace:1",
  title: "\u2733 Claude Code",
} as const;

// A fleet-worktree plan (`cwd` is not `repoRoot`), so every claude and codex boot line below carries
// `NX_DAEMON=false ` (`cmux/fleetEnv.ts`) — the realistic shape of a `cmux spawn`.
export const PLAN: SpawnPlan = {
  baseBranch: undefined,
  branch: "a-branch",
  cwd: "/tmp/a-doc-worktree",
  driver: "claude",
  host: "claude-code",
  model: undefined,
  pickupCommand: "/slopweaver:pickup a-doc — a pickup line long enough to clear the corroboration floor",
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

/**
 * The composer read every pre-composer test boots through: the boot witness alone decides, as it did before a `claude`
 * boot was judged on its composer — a witnessed boot stands, an unwitnessed one fails having read nothing.
 */
const WITNESS_DECIDES: SpawnDeps["witnessClaudeBoot"] = ({ bootWitnessed }) =>
  Promise.resolve(bootWitnessed ? { kind: "unwitnessed" } : { kind: "failed", reason: "never-read" });

/**
 * How many lines typed into a tab were the pickup command, and how many were anything else — the boot lines.
 *
 * @returns the count of boot lines and the count of pickup lines among the recorded sends
 */
export function bootLinesOnly({ calls }: { calls: readonly Recorded[] }): { bootLines: number; pickups: number } {
  const sends = calls.filter((call) => call.op === "sendLine");
  const pickups = sends.filter((call) => call.text === PLAN.pickupCommand).length;
  return { bootLines: sends.length - pickups, pickups };
}

/**
 * Wraps a fake client into the full injected {@link SpawnDeps}, tracking the worktree step and every sidebar write.
 *
 * @returns the deps, one entry per worktree creation, and every sidebar CLI call in order
 */
export function deps({
  client,
  events = [],
  witnessClaudeBoot = WITNESS_DECIDES,
}: {
  client: CmuxClient;
  events?: readonly CmuxEvent[];
  witnessClaudeBoot?: SpawnDeps["witnessClaudeBoot"];
}): {
  deps: SpawnDeps;
  ensureWorktreeCalls: number[];
  sidebarCalls: (readonly string[])[];
} {
  const ensureWorktreeCalls: number[] = [];
  const sidebarCalls: (readonly string[])[] = [];
  return {
    deps: {
      client,
      close: () => undefined,
      ensureWorktree: () => {
        ensureWorktreeCalls.push(1);
      },
      // The credential gate is not this suite's subject: it passes every plan through unchanged, so a boot
      // here reads exactly as one whose account had headroom.
      gateCredentialStore: ({ plan }) => Promise.resolve(ok(plan)),
      // Nor is the Codex browser door: every seat passes it, as one on a home with no browser surface would.
      gateCodexBrowserSurface: () => ok(undefined),
      // Nor is the create lock (`workspaceCreateRecovery.test.ts` is): every create here holds it unopposed.
      holdWorkspaceCreate: () => ok({ claimed: new Set<string>(), release: () => undefined }),
      observedEvents: () => events,
      resolvePluginDir: () => "/repo/slopweaver",
      sidebarCli: {
        run: ({ argv }) => {
          sidebarCalls.push(argv);
          return ok(
            argv[0] === "workspace" && argv[1] === "list"
              ? JSON.stringify({ window_ref: "window:1", workspaces: [BARE_ROW] })
              : "",
          );
        },
      },
      wait: () => Promise.resolve(),
      witnessClaudeBoot,
    },
    ensureWorktreeCalls,
    sidebarCalls,
  };
}
