/**
 * Plain fakes for the `github repo` create, visibility and Actions-policy clients: a small in-memory GitHub that
 * answers reads from its own state and applies each write to it, recording every write sent. No mock library —
 * each is an object literal over a mutable world a test builds and then inspects.
 */
import { err, errAsync, ok, okAsync } from "neverthrow";

import type { DoorLedgerPort } from "../admit/doorLedgerPort.js";
import type { GithubRepoDeps } from "../cli/commands/github/repoRun.js";
import type { IngestError } from "../lib/ingestError.js";
import type { ResultAsync } from "../lib/result.js";
import type {
  ForkApprovalPolicy,
  GithubRepoActionsPolicyApi,
  SelectedActionsPolicy,
  WorkflowTokenPolicy,
} from "../outbound/github/repoActionsPolicy.js";
import type { GithubAccount, GithubRepoLifecycleApi, RepoLifecycleState } from "../outbound/github/repoLifecycle.js";
import { manifestFake } from "./githubRepoManifestFake.js";
import type { ManifestWorld } from "./githubRepoManifestWorld.js";

/**
 * A provider failure carrying an HTTP status, as the boundary produces one.
 *
 * @param status the HTTP status GitHub answered
 * @returns the typed failure
 */
export function githubHttpError({ status }: { status: number }): IngestError {
  return { kind: "http", message: `HTTP ${String(status)}`, operation: "github.fake", provider: "github", status };
}

/**
 * A repository's lifecycle state with every field filled; override what a case is about.
 *
 * @param over the fields a case sets
 * @returns the state
 */
export function lifecycleState(over: Partial<RepoLifecycleState> = {}): RepoLifecycleState {
  return {
    archived: false,
    fullName: "acme/widget",
    htmlUrl: "https://github.com/acme/widget",
    id: 101,
    name: "widget",
    ownerLogin: "acme",
    ownerType: "User",
    private: true,
    visibility: "private",
    ...over,
  };
}

/** The in-memory world the lifecycle fake reads and writes. */
export interface LifecycleWorld {
  readonly me: GithubAccount;
  readonly accounts: Map<string, GithubAccount>;
  /** Repositories keyed by lowercased full name. */
  readonly repos: Map<string, RepoLifecycleState>;
  readonly sent: string[];
  /** The id a create answers with; the next create stores a repository under it. */
  nextId: number;
  /** When set, the next write of that kind is refused with this failure and changes nothing. */
  refuse?: { readonly write: "create" | "set-public"; readonly error: IngestError };
  /** When true, a create answers with its id but stores nothing, so the read-back finds no repository. */
  createLeavesNothing?: boolean;
  /** When true, a visibility change is accepted but changes nothing. */
  publishIgnored?: boolean;
  /** When set, a create stores the repository with this visibility rather than the one asked for. */
  createVisibility?: string;
  /** When set, every read after the first accepted write answers this instead of the stored repository. */
  readAfterWrite?: ResultAsync<RepoLifecycleState, IngestError>;
  /** Set by the fake once a write was accepted. */
  wrote?: boolean;
}

/** The visibility a create stores: the world's override, else the one the privacy flag asks for. */
function createdVisibility({ isPrivate, world }: { isPrivate: boolean; world: LifecycleWorld }): string {
  if (world.createVisibility !== undefined) {
    return world.createVisibility;
  }
  return isPrivate ? "private" : "public";
}

/**
 * A lifecycle client over one world.
 *
 * @param world the state the fake reads and writes
 * @returns the client
 */
export function lifecycleFake({ world }: { world: LifecycleWorld }): GithubRepoLifecycleApi {
  return {
    account: ({ login }) => {
      const found = world.accounts.get(login.toLowerCase());
      return found === undefined ? errAsync(githubHttpError({ status: 404 })) : okAsync(found);
    },
    authenticatedAccount: () => okAsync(world.me),
    create: ({ org, name, private: isPrivate }) => {
      let owner = world.me.login;
      if (org !== undefined) {
        owner = org;
      }
      world.sent.push(`create ${owner}/${name} private=${String(isPrivate)}`);
      if (world.refuse?.write === "create") {
        return errAsync(world.refuse.error);
      }
      const id = world.nextId;
      world.wrote = true;
      if (world.createLeavesNothing !== true) {
        const fullName = `${owner}/${name}`;
        world.repos.set(
          fullName.toLowerCase(),
          lifecycleState({
            fullName,
            htmlUrl: `https://github.com/${fullName}`,
            id,
            name,
            ownerLogin: owner,
            ownerType: org === undefined ? "User" : "Organization",
            private: isPrivate,
            visibility: createdVisibility({ isPrivate, world }),
          }),
        );
      }
      return okAsync({ id });
    },
    read: ({ owner, repo }) => {
      if (world.wrote === true && world.readAfterWrite !== undefined) {
        return world.readAfterWrite;
      }
      const found = world.repos.get(`${owner}/${repo}`.toLowerCase());
      return found === undefined ? errAsync(githubHttpError({ status: 404 })) : okAsync(found);
    },
    setPublic: ({ owner, repo }) => {
      world.sent.push(`set-public ${owner}/${repo}`);
      if (world.refuse?.write === "set-public") {
        return errAsync(world.refuse.error);
      }
      world.wrote = true;
      const key = `${owner}/${repo}`.toLowerCase();
      const found = world.repos.get(key);
      if (found !== undefined && world.publishIgnored !== true) {
        world.repos.set(key, { ...found, private: false, visibility: "public" });
      }
      return okAsync(undefined);
    },
  };
}

/**
 * `github repo` deps for a create, visibility, settings or Actions run: the worlds' fakes, and every other client
 * refusing to be built, so a run reaching the wrong client fails loudly.
 *
 * @param home the throwaway state home
 * @param door the door ledger the run records into
 * @param lifecycle the lifecycle world, when the case needs one
 * @param actions the Actions world, when the case needs one
 * @param manifest the settings world, when the case needs one
 * @param out the list stdout lines land in
 * @param diagnostic the list diagnostic lines land in
 * @returns the deps
 */
export function approvedRepoDeps({
  home,
  door,
  lifecycle,
  actions,
  manifest,
  files,
  out,
  diagnostic,
}: {
  home: string;
  door: DoorLedgerPort;
  lifecycle?: LifecycleWorld;
  actions?: ActionsWorld;
  manifest?: ManifestWorld;
  /** The apply artifacts a run may read, by path; any other path reads as missing. */
  files?: Readonly<Record<string, string>>;
  out: string[];
  diagnostic: string[];
}): GithubRepoDeps {
  return {
    doorLedger: door,
    home: () => home,
    makeActionsPolicyApi: () => actionsPolicyFake({ world: actions! }),
    makeAdministrationApi: () => {
      throw new Error("a lifecycle run must never build the administration client");
    },
    makeApi: () => {
      throw new Error("a lifecycle run must never build the description client");
    },
    makeLifecycleApi: () => lifecycleFake({ world: lifecycle! }),
    makeManifestApi: () => manifestFake({ world: manifest! }),
    out: (line) => {
      out.push(line);
    },
    readText: ({ path }) => {
      const text = files?.[path];
      return text === undefined ? err([`ENOENT: no such file, open '${path}'`]) : ok(text);
    },
    token: () => "token",
    transferWait: { attempts: 1, intervalMs: 0, sleep: async () => {} },
    writeDiagnostic: (line) => {
      diagnostic.push(line);
    },
  };
}

/** The in-memory Actions settings of one repository. */
export interface ActionsWorld {
  repository: RepoLifecycleState;
  enabled: boolean;
  allowedActions: string | undefined;
  /** What the selected-actions read answers; GitHub answers it only while `allowedActions` is `selected`. */
  selectedActions: SelectedActionsPolicy;
  workflow: WorkflowTokenPolicy;
  forkApproval: ForkApprovalPolicy;
  /** The runner count each read answers, in order; the last answer repeats. */
  runnerCounts: number[];
  readonly sent: string[];
  /** A write the fake accepts but does not apply, so its read-back shows it did not land. */
  ignored?: ActionsStepName;
  /** A write the fake refuses with HTTP 403 and does not apply. */
  refused?: ActionsStepName;
  /** Another actor changing the settings right after the named step is sent and applied, mid-run. */
  afterSend?: { readonly step: ActionsStepName; readonly change: (args: { world: ActionsWorld }) => void };
}

/** One Actions-policy write, as the fake names it. */
type ActionsStepName =
  | "switch-on"
  | "switch-off"
  | "select-actions-policy"
  | "github-owned-actions-only"
  | "read-only-token"
  | "fork-approval-for-all";

/** The operation name each Actions-policy write carries in a refusal, as the real client's would. */
const ACTIONS_STEP_OPERATION: Readonly<Record<ActionsStepName, string>> = {
  "fork-approval-for-all": "github.actions.setForkPrContributorApprovalPermissionsRepository",
  "github-owned-actions-only": "github.actions.setAllowedActionsRepository",
  "read-only-token": "github.actions.setGithubActionsDefaultWorkflowPermissionsRepository",
  "select-actions-policy": "github.actions.setGithubActionsPermissionsRepository",
  "switch-off": "github.actions.setGithubActionsPermissionsRepository",
  "switch-on": "github.actions.setGithubActionsPermissionsRepository",
};

/** Which fake step one switch write is: the mode-setting write keeps Actions off and names `selected`. */
function switchStepOf({
  enabled,
  allowedActions,
}: {
  enabled: boolean;
  allowedActions: string | undefined;
}): ActionsStepName {
  if (enabled) {
    return "switch-on";
  }
  return allowedActions === undefined ? "switch-off" : "select-actions-policy";
}

/** Record one Actions-policy write and apply it unless the world refuses or ignores it. */
function actionsWrite({
  world,
  step,
  apply,
}: {
  world: ActionsWorld;
  step: ActionsStepName;
  apply: () => void;
}): ResultAsync<void, IngestError> {
  world.sent.push(step);
  if (world.refused === step) {
    return errAsync({ ...githubHttpError({ status: 403 }), operation: ACTIONS_STEP_OPERATION[step] });
  }
  if (world.ignored !== step) {
    apply();
  }
  if (world.afterSend?.step === step) {
    world.afterSend.change({ world });
  }
  return okAsync(undefined);
}

/**
 * An Actions-policy client over one repository's settings.
 *
 * @param world the settings the fake reads and writes
 * @returns the client
 */
export function actionsPolicyFake({ world }: { world: ActionsWorld }): GithubRepoActionsPolicyApi {
  return {
    actions: () => okAsync({ allowedActions: world.allowedActions, enabled: world.enabled }),
    // GitHub answers a non-public repository's fork approval read with 422 (measured; repoActionsPolicyPlan.ts).
    forkApproval: () =>
      world.repository.visibility === "public"
        ? okAsync(world.forkApproval)
        : errAsync(githubHttpError({ status: 422 })),
    repository: () => okAsync(world.repository),
    // GitHub's selected-actions read applies only in `selected` mode; any other mode is a conflict here.
    selectedActions: () =>
      world.allowedActions === "selected" ? okAsync(world.selectedActions) : errAsync(githubHttpError({ status: 409 })),
    selfHostedRunners: () => {
      const count = world.runnerCounts.length > 1 ? world.runnerCounts.shift()! : world.runnerCounts[0]!;
      return okAsync(count);
    },
    setActionsEnabled: ({ enabled, allowedActions }) =>
      actionsWrite({
        apply: () => {
          world.enabled = enabled;
          if (allowedActions !== undefined) {
            world.allowedActions = allowedActions;
          }
        },
        step: switchStepOf({ allowedActions, enabled }),
        world,
      }),
    setGithubOwnedActionsOnly: () =>
      actionsWrite({
        apply: () => {
          world.selectedActions = { githubOwnedAllowed: true, patternsAllowed: [], verifiedAllowed: false };
        },
        step: "github-owned-actions-only",
        world,
      }),
    setForkApprovalForAllOutsiders: () =>
      actionsWrite({
        apply: () => {
          world.forkApproval = "all_external_contributors";
        },
        step: "fork-approval-for-all",
        world,
      }),
    setReadOnlyWorkflowToken: () =>
      actionsWrite({
        apply: () => {
          world.workflow = { canApprovePullRequestReviews: false, defaultWorkflowPermissions: "read" };
        },
        step: "read-only-token",
        world,
      }),
    workflowToken: () => okAsync(world.workflow),
  };
}
