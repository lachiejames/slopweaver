import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { planRepoEnableActions } from "../../../../../cli/commands/github/repoActionsPolicyRun.js";
import { runGithubRepo } from "../../../../../cli/commands/github/repoRun.js";
import { unwrap } from "../../../../../lib/result.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import {
  type ActionsWorld,
  actionsPolicyFake,
  approvedRepoDeps,
  lifecycleState,
} from "../../../../githubRepoWriteFakes.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

const REST = ["--repo", "acme/widget", "--enable-actions"];

const GITHUB_OWNED_ONLY = { githubOwnedAllowed: true, patternsAllowed: [], verifiedAllowed: false };

/** The labels of the two steps that restrict which actions may run, as a stop names them. */
const SELECT_LABEL = "restrict Actions to selected actions, keeping it off";
const OWNED_LABEL = "allow GitHub-owned actions only, with no verified publisher and no pattern";

/**
 * A public personal repository with Actions off and every action allowed, a writable token and first-time-only
 * fork approval. Its selected-actions policy allows verified publishers too, which GitHub answers only once the
 * mode is `selected`.
 */
function world(over: Partial<ActionsWorld> = {}): ActionsWorld {
  return {
    allowedActions: "all",
    enabled: false,
    forkApproval: "first_time_contributors",
    repository: lifecycleState({ private: false, visibility: "public" }),
    runnerCounts: [0],
    selectedActions: { ...GITHUB_OWNED_ONLY, verifiedAllowed: true },
    sent: [],
    workflow: { canApprovePullRequestReviews: true, defaultWorkflowPermissions: "write" },
    ...over,
  };
}

/** Every property of the policy already in place, Actions off. */
const COMPLIANT: Partial<ActionsWorld> = {
  allowedActions: "selected",
  forkApproval: "all_external_contributors",
  selectedActions: GITHUB_OWNED_ONLY,
  workflow: { canApprovePullRequestReviews: false, defaultWorkflowPermissions: "read" },
};

/** Run one `github repo` invocation over a world. */
async function run({
  rest,
  actions,
  door = memoryDoorLedger().port,
}: {
  rest: readonly string[];
  actions: ActionsWorld;
  door?: DoorLedgerPort;
}): Promise<{ code: number; out: string[]; diagnostic: string[] }> {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-repo-actions-"));
  homes.push(home);
  const out: string[] = [];
  const diagnostic: string[] = [];
  const code = await runGithubRepo({ deps: approvedRepoDeps({ actions, diagnostic, door, home, out }), rest });
  return { code, diagnostic, out };
}

/** The digest a `--json` preview prints. */
async function previewDigest({ actions }: { actions: ActionsWorld }): Promise<string> {
  const preview = await run({ actions, rest: [...REST, "--json"] });
  return (JSON.parse(preview.out[0]!) as { digest: string }).digest;
}

describe("github repo --enable-actions preview", () => {
  it("names each step and the runner-minute cost, and sends nothing", async () => {
    const actions = world();
    const result = await run({ actions, rest: REST });

    expect(result.code).toBe(0);
    expect(actions.sent).toEqual([]);
    expect(result.out.slice(0, 2)).toEqual([
      `preview: enable Actions on acme/widget (id 101) under the stated policy: ${SELECT_LABEL}; ${OWNED_LABEL}; ` +
        "make the workflow token read-only and unable to approve pull requests; require approval for every " +
        "outside contributor's fork pull request; switch Actions on",
      "  approving this also accepts: every push and pull request runs the repository's workflows on GitHub-hosted " +
        "runners, spending runner minutes",
    ]);
  });

  it("never asks for the selected-actions policy while every action is allowed", async () => {
    const actions = world();
    const preview = await run({ actions, rest: [...REST, "--json"] });

    expect(preview.code).toBe(0);
    expect((JSON.parse(preview.out[0]!) as { current: { selectedActions: unknown } }).current.selectedActions).toEqual({
      kind: "unavailable-until-selected",
    });
  });

  it("reports a repository already on under the policy as done", async () => {
    const actions = world({ ...COMPLIANT, enabled: true });
    const result = await run({ actions, rest: REST });

    expect(result.code).toBe(0);
    expect(result.out[0]).toMatch(/^already done: enable Actions on acme\/widget/);
  });

  it("refuses an organisation's repository and a self-hosted runner before anything is sent", async () => {
    const org = world({
      repository: lifecycleState({ ownerType: "Organization", private: false, visibility: "public" }),
    });
    const runner = world({ runnerCounts: [1] });
    const orgResult = await run({ actions: org, rest: REST });
    const runnerResult = await run({ actions: runner, rest: REST });

    expect(orgResult.code).toBe(1);
    expect(orgResult.diagnostic.join("\n")).toContain("owned by an Organization");
    expect(runnerResult.code).toBe(1);
    expect(runnerResult.diagnostic.join("\n")).toContain("has 1 self-hosted runner(s) registered");
    expect([...org.sent, ...runner.sent]).toEqual([]);
  });

  it("refuses a private repository before reading its fork approval, routing to --set-public", async () => {
    const actions = world({ repository: lifecycleState() });
    const result = await run({ actions, rest: REST });

    expect(result.code).toBe(1);
    expect(actions.sent).toEqual([]);
    expect(result.diagnostic.join("\n")).toContain(
      "acme/widget is private, and the policy's fork pull request approval is GitHub's setting for a public " +
        "repository (a private one's fork workflows are a different setting), so it cannot be established here; " +
        "publish it first with --set-public, then preview --enable-actions again",
    );
  });
});

describe("github repo --enable-actions apply", () => {
  it("applies the policy in order on the preview's digest and confirms the whole of it", async () => {
    const actions = world();
    const door = memoryDoorLedger();
    const approve = await previewDigest({ actions });
    const result = await run({ actions, door: door.port, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(0);
    expect(actions.sent).toEqual([
      "select-actions-policy",
      "github-owned-actions-only",
      "read-only-token",
      "fork-approval-for-all",
      "switch-on",
    ]);
    expect(actions.allowedActions).toBe("selected");
    expect(actions.selectedActions).toEqual(GITHUB_OWNED_ONLY);
    expect(result.out).toEqual(["confirmed: Actions is on for acme/widget under the stated policy"]);
    expect(door.records().length).toBe(1);
  });

  it("switches a running repository off before changing its policy", async () => {
    const actions = world({ enabled: true });
    const approve = await previewDigest({ actions });
    const result = await run({ actions, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(0);
    expect(actions.sent).toEqual([
      "switch-off",
      "select-actions-policy",
      "github-owned-actions-only",
      "read-only-token",
      "fork-approval-for-all",
      "switch-on",
    ]);
  });

  it("holds the approval when a policy field changed after the preview", async () => {
    const actions = world();
    const door = memoryDoorLedger();
    const approve = await previewDigest({ actions });
    actions.forkApproval = "first_time_contributors_new_to_github";
    const result = await run({ actions, door: door.port, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(actions.sent).toEqual([]);
    expect(door.text()).toContain("github.repo-write-unapproved");
  });

  it("stops with Actions off when a self-hosted runner appears before the switch, naming what landed", async () => {
    const actions = world({
      ...COMPLIANT,
      runnerCounts: [0, 0, 1],
      workflow: { canApprovePullRequestReviews: true, defaultWorkflowPermissions: "write" },
    });
    const approve = await previewDigest({ actions });
    const result = await run({ actions, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(actions.sent).toEqual(["read-only-token"]);
    expect(actions.enabled).toBe(false);
    expect(result.diagnostic.join("\n")).toContain(
      "has 1 self-hosted runner(s) registered, so Actions stays off: the policy is GitHub-hosted runners only. " +
        "Remove the runner(s), then preview again (already confirmed before this was found: make the workflow " +
        "token read-only and unable to approve pull requests)",
    );
  });

  it("stops at the first step its read-back does not show, never switching Actions on", async () => {
    const actions = world({ enabled: true, ignored: "github-owned-actions-only" });
    const approve = await previewDigest({ actions });
    const result = await run({ actions, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(actions.sent).toEqual(["switch-off", "select-actions-policy", "github-owned-actions-only"]);
    expect(actions.enabled).toBe(false);
    expect(result.diagnostic.join("\n")).toContain(
      `the Actions policy on acme/widget stopped at "${OWNED_LABEL}" (confirmed: switch Actions off while the ` +
        `policy is applied, ${SELECT_LABEL}; Actions is OFF)`,
    );
  });

  it("stops when the mode write does not show selected actions, with Actions still off", async () => {
    const actions = world({ ignored: "select-actions-policy" });
    const approve = await previewDigest({ actions });
    const result = await run({ actions, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(actions.sent).toEqual(["select-actions-policy"]);
    expect(result.diagnostic.join("\n")).toContain(
      `stopped at "${SELECT_LABEL}" (nothing was confirmed; Actions is OFF)`,
    );
  });

  it("carries a refused step's operation and status into the stop it reports", async () => {
    const actions = world({
      ...COMPLIANT,
      refused: "read-only-token",
      workflow: { canApprovePullRequestReviews: true, defaultWorkflowPermissions: "write" },
    });
    const approve = await previewDigest({ actions });
    const result = await run({ actions, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(actions.sent).toEqual(["read-only-token"]);
    expect(result.diagnostic.join("\n")).toContain(
      "GitHub said: send: github github.actions.setGithubActionsDefaultWorkflowPermissionsRepository HTTP 403",
    );
  });

  it("reports Actions off when the switch itself does not land", async () => {
    const actions = world({ ...COMPLIANT, ignored: "switch-on" });
    const approve = await previewDigest({ actions });
    const result = await run({ actions, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(actions.sent).toEqual(["switch-on"]);
    expect(result.diagnostic.join("\n")).toContain('stopped at "switch Actions on"');
    expect(result.diagnostic.join("\n")).toContain("Actions is OFF");
  });

  it("never switches on when the selected-actions policy changed after its own step was confirmed", async () => {
    const actions = world({
      afterSend: {
        change: ({ world: live }) => {
          live.selectedActions = { ...GITHUB_OWNED_ONLY, verifiedAllowed: true };
        },
        step: "fork-approval-for-all",
      },
    });
    const approve = await previewDigest({ actions });
    const result = await run({ actions, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(actions.sent).toEqual([
      "select-actions-policy",
      "github-owned-actions-only",
      "read-only-token",
      "fork-approval-for-all",
    ]);
    expect(actions.enabled).toBe(false);
    expect(result.diagnostic.join("\n")).toContain(
      "changed since its own step was confirmed: the selected-actions policy",
    );
  });

  it("never reads the selected-actions policy once the mode left selected mid-run", async () => {
    const actions = world({
      afterSend: {
        change: ({ world: live }) => {
          live.allowedActions = "all";
        },
        step: "github-owned-actions-only",
      },
    });
    const approve = await previewDigest({ actions });
    const result = await run({ actions, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(actions.sent).toEqual(["select-actions-policy", "github-owned-actions-only"]);
    expect(result.diagnostic.join("\n")).toContain(`stopped at "${OWNED_LABEL}"`);
    expect(result.diagnostic.join("\n")).toContain("Actions is OFF");
    expect(result.diagnostic.join("\n")).not.toContain("409");
  });

  it("switches Actions back off when the policy changed between the switch and the final read-back", async () => {
    const actions = world({
      afterSend: {
        change: ({ world: live }) => {
          live.selectedActions = { ...GITHUB_OWNED_ONLY, verifiedAllowed: true };
        },
        step: "switch-on",
      },
    });
    const approve = await previewDigest({ actions });
    const result = await run({ actions, rest: [...REST, "--approve", approve] });

    expect(result.code).toBe(1);
    expect(actions.sent.slice(-2)).toEqual(["switch-on", "switch-off"]);
    expect(actions.enabled).toBe(false);
    expect(result.diagnostic.join("\n")).toContain(
      "out of policy: the selected-actions policy; switched Actions back off",
    );
    expect(result.diagnostic.join("\n")).toContain("Actions is OFF");
  });
});

describe("planRepoEnableActions", () => {
  it("plans every step for a repository with none of the policy, sending nothing", async () => {
    const actions = world();

    const write = unwrap(
      await planRepoEnableActions({ api: actionsPolicyFake({ world: actions }), owner: "acme", repo: "widget" }),
    );

    expect(write.kind).toBe("enable-actions");
    expect(write.alreadyDone).toBe(false);
    expect(write.previewCommand).toBe("slopweaver github repo --repo acme/widget --enable-actions");
    expect(write.change).toContain(`under the stated policy: ${SELECT_LABEL}; ${OWNED_LABEL}`);
    expect(actions.sent).toEqual([]);
  });

  it("plans only the switch for a repository already under the policy with Actions off", async () => {
    const actions = world(COMPLIANT);

    const write = unwrap(
      await planRepoEnableActions({ api: actionsPolicyFake({ world: actions }), owner: "acme", repo: "widget" }),
    );

    expect(write.change).toBe(
      `enable Actions on acme/widget (id ${String(actions.repository.id)}) under the stated policy: switch Actions on`,
    );
  });
});
