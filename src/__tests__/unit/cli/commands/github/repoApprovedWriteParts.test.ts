/**
 * The parts of the approval-gated `github repo` writes, each tested at its own module rather than only through
 * `runGithubRepo`: the flag reader, the door request a write is admitted on, the create plan's refusals before
 * anything is sent, and the Actions policy's state read refusing a repository before any Actions setting is read.
 */
import { describe, expect, it } from "vitest";

import { readActionsPolicyState } from "../../../../../cli/commands/github/repoActionsPolicyRead.js";
import { repoApprovedWriteDoorRequest } from "../../../../../cli/commands/github/repoApprovedWrite.js";
import { planRepoCreate } from "../../../../../cli/commands/github/repoCreateRun.js";
import { approvedWritesOf } from "../../../../../cli/commands/github/repoWriteArgs.js";
import { errAsync, unwrap, unwrapErr } from "../../../../../lib/result.js";
import {
  type ActionsWorld,
  actionsPolicyFake,
  githubHttpError,
  type LifecycleWorld,
  lifecycleFake,
  lifecycleState,
} from "../../../../githubRepoWriteFakes.js";

/** A lifecycle world where the token is `acme`'s own account and nothing else exists unless a case adds it. */
function lifecycleWorld(over: Partial<LifecycleWorld> = {}): LifecycleWorld {
  return {
    accounts: new Map(),
    me: { id: 7, login: "acme", type: "User" },
    nextId: 202,
    repos: new Map(),
    sent: [],
    ...over,
  };
}

/** An Actions world over a public repository the token's own account owns, already compliant but switched off. */
function actionsWorld(over: Partial<ActionsWorld> = {}): ActionsWorld {
  return {
    allowedActions: undefined,
    enabled: false,
    forkApproval: "all_external_contributors",
    repository: lifecycleState({ private: false, visibility: "public" }),
    runnerCounts: [0],
    // Answered only once the mode is `selected`; this world starts with no mode, so it is never read until then.
    selectedActions: { githubOwnedAllowed: true, patternsAllowed: [], verifiedAllowed: false },
    sent: [],
    workflow: { canApprovePullRequestReviews: false, defaultWorkflowPermissions: "read" },
    ...over,
  };
}

describe("approvedWritesOf", () => {
  it("names every approved write the flags carry, in the fixed order", () => {
    const errors: string[] = [];
    const writes = approvedWritesOf({
      errors,
      values: { create: true, "enable-actions": true, "set-public": true },
    });
    expect(writes).toEqual(["create", "set-public", "enable-actions"]);
    expect(errors).toEqual([]);
  });

  it("names nothing when no approved-write flag is set", () => {
    const errors: string[] = [];
    expect(approvedWritesOf({ errors, values: { description: "x" } })).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("refuses --public anywhere but on a create", () => {
    const errors: string[] = [];
    expect(approvedWritesOf({ errors, values: { public: true, "set-public": true } })).toEqual(["set-public"]);
    expect(errors).toEqual(["--public only qualifies --create; --set-public makes an existing repository public"]);
  });
});

describe("repoApprovedWriteDoorRequest", () => {
  it("records the exact view and digest as an approval-required external write naming the kind", () => {
    const request = repoApprovedWriteDoorRequest({
      digest: "ghrepo-abc",
      home: "/home/fixture",
      kind: "set-public",
      view: { action: "set-public", target: "acme/widget" },
    });
    expect(request).toEqual({
      action: { kind: "verb", noun: "github", verb: "repo set-public" },
      artifact: { action: "set-public", digest: "ghrepo-abc", target: "acme/widget" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/home/fixture", requiresApproval: true },
    });
  });
});

describe("planRepoCreate", () => {
  it("previews a private create on the token's own account and sends nothing while planning", async () => {
    const world = lifecycleWorld();
    const planned = unwrap(
      await planRepoCreate({
        api: lifecycleFake({ world }),
        request: { owner: "acme", private: true, repo: "fresh" },
      }),
    );
    expect(planned.change).toBe("create acme/fresh as a private repository owned by the token's own account acme");
    expect(planned.consequences).toEqual([]);
    expect(planned.previewCommand).toBe("slopweaver github repo --repo acme/fresh --create");
    expect(world.sent).toEqual([]);
  });

  it("names the public consequence and carries --public in the preview command", async () => {
    const planned = unwrap(
      await planRepoCreate({
        api: lifecycleFake({ world: lifecycleWorld() }),
        request: { owner: "acme", private: false, repo: "fresh" },
      }),
    );
    expect(planned.consequences).toEqual(["the new repository is readable by anyone from the moment it exists"]);
    expect(planned.previewCommand).toBe("slopweaver github repo --repo acme/fresh --create --public");
  });

  it("previews a create at a renamed repository's old address and binds the 301 that witnessed it free", async () => {
    const world = lifecycleWorld();
    const api = { ...lifecycleFake({ world }), read: () => errAsync(githubHttpError({ status: 301 })) };
    const at301 = unwrap(await planRepoCreate({ api, request: { owner: "acme", private: true, repo: "widget" } }));
    const at404 = unwrap(
      await planRepoCreate({
        api: lifecycleFake({ world }),
        request: { owner: "acme", private: true, repo: "widget" },
      }),
    );
    expect(at301.view["precondition"]).toEqual({ repository: "absent", status: 301 });
    expect(at404.view["precondition"]).toEqual({ repository: "absent", status: 404 });
    expect(world.sent).toEqual([]);
  });

  it("refuses an address that already holds a repository", async () => {
    const world = lifecycleWorld({ repos: new Map([["acme/widget", lifecycleState()]]) });
    const error = unwrapErr(
      await planRepoCreate({
        api: lifecycleFake({ world }),
        request: { owner: "acme", private: true, repo: "widget" },
      }),
    );
    expect(error.code).toBe("FACT_REFUSED");
    expect(error.message).toContain("acme/widget already holds a repository (id 101)");
    expect(world.sent).toEqual([]);
  });

  it("refuses a personal account that is not the token's own", async () => {
    const world = lifecycleWorld({ accounts: new Map([["someone", { id: 9, login: "someone", type: "User" }]]) });
    const error = unwrapErr(
      await planRepoCreate({
        api: lifecycleFake({ world }),
        request: { owner: "someone", private: true, repo: "fresh" },
      }),
    );
    expect(error.code).toBe("AUTHORIZATION_FAILED");
    expect(error.message).toContain("someone is neither the token's own account (acme) nor an organisation");
  });
});

describe("readActionsPolicyState", () => {
  it("reads every input of a public repository the token's own account owns", async () => {
    const state = unwrap(
      await readActionsPolicyState({
        address: { owner: "acme", repo: "widget" },
        api: actionsPolicyFake({ world: actionsWorld({ runnerCounts: [2] }) }),
      }),
    );
    expect(state.enabled).toBe(false);
    expect(state.forkApproval).toBe("all_external_contributors");
    expect(state.selfHostedRunners).toBe(2);
    expect(state.workflow).toEqual({ canApprovePullRequestReviews: false, defaultWorkflowPermissions: "read" });
  });

  it("refuses a private repository on the repository read, before the fork approval read GitHub answers 422", async () => {
    const error = unwrapErr(
      await readActionsPolicyState({
        address: { owner: "acme", repo: "widget" },
        api: actionsPolicyFake({ world: actionsWorld({ repository: lifecycleState() }) }),
      }),
    );
    expect(error.code).toBe("FACT_REFUSED");
    expect(error.message).toContain("acme/widget is private");
  });

  it("refuses an organisation's repository, whose runner groups a repository read cannot see", async () => {
    const repository = lifecycleState({ ownerType: "Organization", private: false, visibility: "public" });
    const error = unwrapErr(
      await readActionsPolicyState({
        address: { owner: "acme", repo: "widget" },
        api: actionsPolicyFake({ world: actionsWorld({ repository }) }),
      }),
    );
    expect(error.code).toBe("FACT_REFUSED");
    expect(error.message).toContain("acme/widget is owned by an Organization");
  });
});
