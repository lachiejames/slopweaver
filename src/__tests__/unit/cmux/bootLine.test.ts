/**
 * {@link bootLine} — the exact text one spawn sends to boot its host, asserted byte for byte.
 *
 * Byte-for-byte because `src/devLint/noHeadless.ts` recognises this repo's own spawn by EXACT equality on
 * the template's source text: a suffix added here without that set moving in the same change stops the gate
 * recognising a legitimate visible launch. These cases are the runtime half of that pairing.
 */
import { describe, expect, it } from "vitest";

import { bootLine } from "../../../cmux/bootLine.js";
import { NX_DAEMON_OFF_PREFIX } from "../../../cmux/fleetEnv.js";
import type { SpawnPlan } from "../../../cmux/plan.js";
import { codexBrowserOffFlags } from "../../../codex/browserSurface.js";
import { CODEX_MODEL } from "../../../codex/profiles.js";

/** The one seam `bootLine` reads, as a plain function — the marketplace route, which is the default. */
const MARKETPLACE = { resolvePluginDir: () => undefined };

/**
 * A plan pinning nothing at all, so each case below names only the field it is about — booting in its checkout
 * itself (`cwd` IS `repoRoot`, as every ask and dispatch plan does), so no placement prefix appears either.
 */
const PLAN: SpawnPlan = {
  baseBranch: undefined,
  branch: "a-branch",
  cwd: "/tmp/repo",
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

describe("bootLine", () => {
  it("sends the bare launch when the plan pins neither a model nor an effort", () => {
    expect(bootLine({ deps: MARKETPLACE, plan: PLAN })).toBe("claude");
  });

  it("appends --effort after --model, so the two model-shaped levers read together", () => {
    const plan: SpawnPlan = { ...PLAN, effort: "xhigh", model: "opus" };

    expect(bootLine({ deps: MARKETPLACE, plan })).toBe("claude --model opus --effort xhigh");
  });

  it("sits between the model and the name, which is the position noHeadless.ts's literal declares", () => {
    const plan: SpawnPlan = { ...PLAN, effort: "low", model: "sonnet", sessionName: "a-seat" };

    expect(bootLine({ deps: MARKETPLACE, plan })).toBe("claude --model sonnet --effort low --name a-seat");
  });

  it("pins an effort with no model at all, because the two are independent levers", () => {
    const plan: SpawnPlan = { ...PLAN, effort: "max" };

    expect(bootLine({ deps: MARKETPLACE, plan })).toBe("claude --effort max");
  });

  it("leaves a plan with no effort byte-identical to the line this repo sent before the flag existed", () => {
    const plan: SpawnPlan = { ...PLAN, model: "opus", sessionName: "a-seat" };

    expect(bootLine({ deps: MARKETPLACE, plan })).toBe("claude --model opus --name a-seat");
  });

  it("ignores an effort on a codex plan, which is why cmux spawn refuses one at the door instead", () => {
    const plan: SpawnPlan = { ...PLAN, effort: "max", host: "codex" };

    expect(bootLine({ deps: MARKETPLACE, plan })).toBe(
      `codex --no-alt-screen --model ${CODEX_MODEL}${codexBrowserOffFlags()}`,
    );
  });

  it("appends a non-code template's --settings last, after --name, which is where noHeadless.ts's literal puts it", () => {
    const plan: SpawnPlan = { ...PLAN, model: "sonnet", sessionName: "a-seat", template: "research" };
    const settings =
      '{\\"claudeMdExcludes\\":[\\"$PWD/.claude/rules/typescript-patterns.md\\",' +
      '\\"$PWD/.claude/rules/testing.md\\",\\"$PWD/.claude/rules/error-handling.md\\"]}';

    expect(bootLine({ deps: MARKETPLACE, plan })).toBe(`claude --model sonnet --name a-seat --settings "${settings}"`);
  });

  it("leaves a template off a codex boot line, because codex expands no @ import to exclude", () => {
    const plan: SpawnPlan = { ...PLAN, host: "codex", template: "bot" };

    expect(bootLine({ deps: MARKETPLACE, plan })).toBe(
      `codex --no-alt-screen --model ${CODEX_MODEL}${codexBrowserOffFlags()}`,
    );
  });

  // A detached nx daemon outlives the seat that started it, so a fleet worktree boots with it off.
  it("prefixes a fleet-worktree seat with NX_DAEMON=false, leaving the rest of the line as it was", () => {
    const plan: SpawnPlan = { ...PLAN, cwd: "/tmp/repo/.claude/worktrees/a-doc", model: "opus" };

    expect(bootLine({ deps: MARKETPLACE, plan })).toBe("NX_DAEMON=false claude --model opus");
  });

  it("puts the placement prefix ahead of a pinned seat's credential store, inside the one prefix", () => {
    const plan: SpawnPlan = { ...PLAN, credentialStoreDir: "/tmp/store", cwd: "/tmp/repo/.claude/worktrees/a-doc" };

    expect(bootLine({ deps: MARKETPLACE, plan })).toBe(
      "NX_DAEMON=false CLAUDE_SECURESTORAGE_CONFIG_DIR=/tmp/store claude",
    );
  });

  it("prefixes a fleet-worktree codex seat the same way", () => {
    const plan: SpawnPlan = { ...PLAN, cwd: "/tmp/repo/.claude/worktrees/a-doc", host: "codex" };

    expect(bootLine({ deps: MARKETPLACE, plan })).toBe(
      `${NX_DAEMON_OFF_PREFIX}codex --no-alt-screen --model ${CODEX_MODEL}${codexBrowserOffFlags()}`,
    );
  });

  it("reads the checkout through its /private spelling as the checkout, not as a worktree", () => {
    const plan: SpawnPlan = { ...PLAN, cwd: "/private/tmp/repo" };

    expect(bootLine({ deps: MARKETPLACE, plan })).toBe("claude");
  });
});
