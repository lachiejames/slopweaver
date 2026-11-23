/**
 * The PRODUCTION {@link SpawnDeps} — the one place a real socket client, a real worktree provision, a real
 * boot delay, the live event witness and the two spawn hatches are wired together. Cut out of `spawn.ts`,
 * which keeps every step of a spawn effect-free against these deps: `spawn.ts` never imports this file, so
 * a test can hand `spawnCmuxSession` a fake without this module's real effects ever loading.
 *
 * The socket client is handed IN, never opened here: a cmux connection is opened only inside
 * `src/sessionHarness/` (`../sessionHarness/recordedSpawn.ts`'s `productionSpawnDeps`), which the
 * `session-harness-lifecycle` gate holds.
 */
import { basename } from "node:path";

import { logger } from "#lib/logger.js";
import type { Result } from "#lib/result.js";

import { acquireOperationLockDetailed } from "../admit/operationLock.js";
import { resolveAmbientCredential } from "../claude/ambientCredentialRead.js";
import { type ClaudePlanProbesPort, claudePlanProbesPort } from "../claude/planProbes.js";
import { bootCredentialForStore, SETUP_TOKEN_FD } from "../claude/seatToken.js";
import { gateSpawnStore, spentPlanHatchOpen, unreadablePlanHatchOpen } from "../claude/spawnStore.js";
import { ALLOW_SPENT_PLAN_ENV, ALLOW_UNREADABLE_PLAN_ENV } from "../claude/spawnStoreRefusals.js";
import { applyCodexBrowserDoor } from "../codex/browserDoor.js";
import { slopweaverHome } from "../homeDir.js";
import { err, ok } from "../lib/result.js";
import { type PlanRegisterPort, planRegisterPort } from "../plans/port.js";
import { DEFAULT_DEPS_MODE, type DepsMode } from "../worktree/deps.js";
import { renderDevBuildOutcome } from "../worktree/devBuild.js";
import { productionProvisionDeps, provisionWorktree } from "../worktree/provision.js";
import { awaitClaudeComposer } from "./claudeBootComposer.js";
import type { CmuxClient } from "./client.js";
import type { VisibleSessionPlan } from "./plan.js";
import { pluginDirForSpawnTarget } from "./pluginDir.js";
import { realCmuxCli } from "./sidebar.js";
import type { SpawnDeps } from "./spawn.js";
import { BOOT_POLL_INTERVAL_MS } from "./spawnPolling.js";
import { openSpawnEventWitness } from "./spawnWitness.js";
import { readWorkspaceCreateClaims, recordWorkspaceCreateClaim } from "./workspaceCreateClaims.js";
import { type HoldWorkspaceCreate, workspaceCreateLockKey } from "./workspaceCreateRecovery.js";

/** The spawn options `cmux spawn`'s flags carry, every one defaulted to what the verb defaults to. */
export interface ProductionSpawnOptions {
  readonly install?: boolean;
  readonly deps?: DepsMode;
  readonly build?: boolean;
  readonly devBuild?: boolean;
  readonly allowSpentPlan?: boolean;
  readonly home?: string;
  readonly namedPin?: boolean;
}

/**
 * The create lock under `home`, never stale while its holder lives: a create still reconciling a lost reply is still
 * working, so a wall-clock threshold would let a second create under its fingerprint overlap it. Its claims are read
 * once the lock is held and the workspace this create made is recorded before it is released. A claim that fails to
 * write is said on stderr rather than failing a spawn whose workspace already opened.
 *
 * @param home the state home the operation lock lives under
 * @returns the hold `createOrAdoptWorkspace` takes before its snapshot
 */
function holdWorkspaceCreateIn({ home }: { home: string }): HoldWorkspaceCreate {
  return ({ fingerprint }) => {
    const key = workspaceCreateLockKey({ fingerprint });
    const lock = acquireOperationLockDetailed({
      home,
      key,
      nowIso: new Date().toISOString(),
      staleAfterMs: Number.POSITIVE_INFINITY,
    });
    if (lock.isErr()) {
      const why = lock.error.code === "LOCK_CONTENDED" ? "another spawn is creating it" : "its create lock failed";
      return err(`${why} (${lock.error.message})`);
    }
    const claims = readWorkspaceCreateClaims({ home, key });
    if (claims.isErr()) {
      lock.value.release();
      return err(`the workspaces earlier creates made could not be read (${claims.error.message})`);
    }
    return ok({
      claimed: new Set(claims.value),
      release: ({ made }) => {
        if (made !== undefined) {
          const recorded = recordWorkspaceCreateClaim({ claims: claims.value, home, key, workspaceId: made });
          if (recorded.isErr()) {
            logger.error({
              msg: `cmux spawn: ${made} was opened, but its create claim was not kept: ${recorded.error.message}`,
            });
          }
        }
        lock.value.release();
      },
    });
  };
}

/**
 * How the seat authenticates on the plan the gate chose — a second question after WHICH plan.
 *
 * A plan holding a setup token boots the seat on that token over a descriptor, against an unbound store of its
 * own; a plan without one boots on its store as before; a token file that will not read refuses the spawn.
 * `claude/seatToken.ts` carries why.
 *
 * @param home the state home the store gate read
 * @param plan the plan the gate allowed
 * @param storeDir the store the gate chose
 * @returns the plan carrying its credential, or the refusal
 */
function seatPlan({
  home,
  plan,
  storeDir,
}: {
  home: string;
  plan: VisibleSessionPlan;
  storeDir: string;
}): Result<VisibleSessionPlan, string> {
  const credential = bootCredentialForStore({ home, seat: basename(plan.cwd), storeDir });
  if (credential.isErr()) {
    return err(credential.error);
  }
  const { storeDir: credentialStoreDir, tokenPath } = credential.value;
  if (tokenPath === undefined) {
    return ok({ ...plan, credentialStoreDir });
  }
  logger.error({
    msg: `claude credential: ${basename(storeDir)} boots this seat on its setup token over fd ${String(SETUP_TOKEN_FD)}, against the unbound store ${credentialStoreDir}`,
  });
  return ok({ ...plan, credentialStoreDir, credentialTokenPath: tokenPath });
}

/**
 * Provision this spawn's worktree, and SAY what happened to its built CLI.
 *
 * The emit is non-fatal inside `provisionWorktree`, so this is the only place a spawn can learn it did not
 * happen: a report thrown away here would leave the seat running every verb from source with nothing having
 * said so. A provisioning FAILURE still throws, because the session cannot open without a worktree.
 */
function provisionForSpawn({
  plan,
  install,
  depsMode,
  build,
  devBuild,
}: {
  plan: VisibleSessionPlan;
  install: boolean;
  depsMode: DepsMode;
  build: boolean;
  devBuild: boolean;
}): void {
  const provisioned = provisionWorktree({
    deps: productionProvisionDeps(),
    request: {
      baseBranch: plan.baseBranch,
      branch: plan.branch,
      build,
      deps: depsMode,
      devBuild,
      install,
      path: plan.cwd,
      repoRoot: plan.repoRoot,
      slug: basename(plan.cwd),
    },
  });
  if (provisioned.isErr()) {
    throw new Error(provisioned.error.message, { cause: provisioned.error });
  }
  logger.out({
    line: `cmux spawn: ${renderDevBuildOutcome({ outcome: provisioned.value.devBuild, path: provisioned.value.path })}`,
  });
}

/**
 * The browser door for a Codex seat run by one Codex binary; a Claude seat passes straight through.
 *
 * The door probes the binary the seat will RUN, in the worktree it runs in (provisioned by now), so its trusted
 * `.codex/config.toml` is in the list read: `codex` on PATH for a cmux seat, whose boot line `cmux/seatRoute.ts`
 * types, and the app's own packaged binary for an app seat, which the app names (`sessionHarness/appLaunch.ts`).
 * Two binaries can read two different server lists, so judging one and running the other is no door at all.
 *
 * @param codexPath the Codex binary the seat runs
 * @param launch the verb the refusal names
 * @returns the gate
 */
export function codexBrowserDoorFor({
  codexPath,
  launch,
}: {
  codexPath: string;
  launch: string;
}): SpawnDeps["gateCodexBrowserSurface"] {
  return ({ plan }) => gateSeatBrowserSurface({ codexPath, launch, plan });
}

function gateSeatBrowserSurface({
  plan,
  codexPath,
  launch,
}: {
  plan: VisibleSessionPlan;
  codexPath: string;
  launch: string;
}): Result<void, string> {
  if (plan.host !== "codex") {
    return ok(undefined);
  }
  const door = applyCodexBrowserDoor({
    cli: { path: codexPath, pathDirs: [] },
    codexHome: plan.codexHome,
    cwd: plan.cwd,
    launch,
  });
  if (door.kind === "refuse") {
    return err(door.refusal);
  }
  if (door.notice !== undefined) {
    logger.error({ msg: door.notice });
  }
  return ok(undefined);
}

/**
 * The pre-spawn credential gate, judged against one plan register, then the plan re-seated on the store it allowed.
 *
 * @param home the state home whose plan register the gate and the boot credential both read
 * @param namedPin whether `--plan` named the pinned store
 * @param port where the plan register is read
 * @param probesPort where the gate files each plan's probe for the owner's sign-in note
 * @param spentPlanHatch whether the spent-plan hatch is open, flag and variable already OR'd
 * @param unreadableHatch whether the unreadable-plan hatch is open — for a readable register with no readable gauge
 *   only; an unreadable register refuses with or without it
 * @returns the gate a spawn's deps run before any workspace exists
 */
function credentialGateFor({
  home,
  namedPin,
  port,
  probesPort,
  spentPlanHatch,
  unreadableHatch,
}: {
  home: string;
  namedPin: boolean;
  port: PlanRegisterPort;
  probesPort: ClaudePlanProbesPort;
  spentPlanHatch: boolean;
  unreadableHatch: boolean;
}): SpawnDeps["gateCredentialStore"] {
  /** The credential the session will present: the launcher's own verdict when it decides the environment. */
  function presentedAmbient({
    ambient,
  }: {
    ambient: ReturnType<typeof resolveAmbientCredential> | undefined;
  }): ReturnType<typeof resolveAmbientCredential> {
    if (ambient !== undefined) {
      return ambient;
    }
    return resolveAmbientCredential();
  }
  return async ({ plan, ambient }) => {
    // The ambient classification is what this machine would ACTUALLY present: an API key outranks every
    // credential store, so the gate must not refuse on unreadable plan gauges when no store decides
    // anything at all — `claude/spawnStore.ts` § unreadableUnderApiKey. A launcher that decides the session's own
    // environment (the app harness) says what that environment presents; any other spawn inherits this shell's.
    const presented = presentedAmbient({ ambient });
    const gated = await gateSpawnStore({
      // A supervisor handoff seats the chair, routed under the chair's own Fable-week bar (`loadBalance.ts`).
      chair: plan.role === "supervisor",
      context: { ambient: presented, home, namedPin, port, probesPort, unreadableHatchOpen: unreadableHatch },
      force: spentPlanHatch,
      model: plan.model,
      pinnedStoreDir: plan.credentialStoreDir,
    });
    if (gated.refusal !== undefined) {
      return err(gated.refusal);
    }
    return gated.storeDir === undefined ? ok(plan) : seatPlan({ home, plan, storeDir: gated.storeDir });
  };
}

/**
 * Which of a spawn's two plan hatches are open, from the variables {@link productionSpawnDepsOver} read at
 * invocation and the caller's own flag.
 *
 * The spent-plan hatch is the flag OR its variable, so a caller's `false` never closes what the variable
 * opened. The unreadable-plan hatch is its variable alone: it takes no caller flag, so there is nothing for an
 * explicit argument to skip and nothing to read in a parameter default. `spawnStore.ts` carries why it is not
 * folded into `--force`.
 *
 * @param allowSpentPlan a caller's OWN escape (`cmux spawn --force`), which only ever adds to the variable
 * @param spentPlanEnv the value of {@link ALLOW_SPENT_PLAN_ENV} as read, absent when unset
 * @param unreadablePlanEnv the value of {@link ALLOW_UNREADABLE_PLAN_ENV} as read, absent when unset
 * @returns whether each hatch is open
 * @internal
 */
export function spawnHatches({
  allowSpentPlan,
  spentPlanEnv,
  unreadablePlanEnv,
}: {
  allowSpentPlan: boolean;
  spentPlanEnv: string | undefined;
  unreadablePlanEnv: string | undefined;
}): { readonly spentPlan: boolean; readonly unreadablePlan: boolean } {
  return {
    spentPlan: spentPlanHatchOpen({ env: spentPlanEnv, flag: allowSpentPlan }),
    unreadablePlan: unreadablePlanHatchOpen({ env: unreadablePlanEnv }),
  };
}

/**
 * The real dependencies: a live socket client, a real worktree PROVISION, a real boot delay, and a live event
 * subscription for the witness chain.
 *
 * "Provision" rather than "create": a spawn's worktree goes through the same
 * `worktree/provision.ts` the `worktree create` verb does, so a freshly spawned session gets its own
 * installed `node_modules` instead of the shared symlink `bin/slopweaver` used to plant. The four options
 * are `cmux spawn`'s own `--no-install` / `--build` / `--deps` / `--no-dev-build` pass-throughs and default
 * to the same rule the verb defaults to.
 *
 * The caller MUST {@link SpawnDeps.close} these. Both the socket and the subscription hold open handles, so a
 * verb that forgets prints its answer and then hangs — which is exactly the failure the explicit close makes
 * impossible to overlook.
 *
 * ## The spent-plan hatch is OR'd here, never defaulted
 *
 * {@link ALLOW_SPENT_PLAN_ENV} is read here, at invocation, and combined with `allowSpentPlan` by
 * {@link spawnHatches} through {@link spentPlanHatchOpen}, rather than being that parameter's default initialiser. It was the default
 * initialiser once, and a default is skipped whenever a caller passes the argument at all —
 * `cmux spawn` always passes one — so the variable the refusal NAMED released nothing on the one verb that
 * printed it. That module carries the measurement; `src/devLint/hatchRelease.ts` is what keeps the shape
 * from coming back.
 *
 * @param install whether a newly created worktree has its dependencies installed at all
 * @param deps where those dependencies come from — a per-worktree tree, or the shared one
 * @param build whether `yarn build` runs once the install has finished
 * @param devBuild whether the worktree's built CLI is emitted once the install has finished — ON by
 * default, and the one option here whose default is not "do less"
 * @param allowSpentPlan a caller's OWN escape (`cmux spawn --force`), which only ever ADDS to the ambient
 * variable — passing `false` cannot close the hatch
 * @param home a `--home` the caller was given, so the store gate and the boot credential read the same plan
 * register a `--plan` was resolved against; absent, both read the ambient home
 * @param namedPin whether `--plan` named the pinned store, so a register that stops carrying it before the
 * gate runs refuses that store instead of booting it unmeasured
 * @param client the live connection, opened by the session harness's launch opener
 * (`../sessionHarness/cmuxLaunch.ts`) and owned by these deps from here: {@link SpawnDeps.close} closes it
 * @returns the production {@link SpawnDeps}
 */
export function productionSpawnDepsOver({
  client,
  install = true,
  deps: depsMode = DEFAULT_DEPS_MODE,
  build = false,
  devBuild = true,
  allowSpentPlan = false,
  home,
  namedPin = false,
}: ProductionSpawnOptions & { client: CmuxClient }): SpawnDeps {
  let registerHome = slopweaverHome();
  if (home !== undefined) {
    registerHome = home;
  }
  const hatches = spawnHatches({
    allowSpentPlan,
    spentPlanEnv: process.env[ALLOW_SPENT_PLAN_ENV],
    unreadablePlanEnv: process.env[ALLOW_UNREADABLE_PLAN_ENV],
  });
  const spentPlanHatch = hatches.spentPlan;
  const unreadableHatch = hatches.unreadablePlan;
  const witness = openSpawnEventWitness();
  const wait = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, BOOT_POLL_INTERVAL_MS));
  return {
    client,
    close: () => {
      witness.close();
      client.close();
    },
    ensureWorktree: ({ plan }) => {
      provisionForSpawn({ build, depsMode, devBuild, install, plan });
    },
    gateCredentialStore: credentialGateFor({
      home: registerHome,
      namedPin,
      port: planRegisterPort(),
      probesPort: claudePlanProbesPort(),
      spentPlanHatch,
      unreadableHatch,
    }),
    gateCodexBrowserSurface: codexBrowserDoorFor({ codexPath: "codex", launch: "cmux spawn" }),
    holdWorkspaceCreate: holdWorkspaceCreateIn({ home: registerHome }),
    observedEvents: witness.observedEvents,
    resolvePluginDir: ({ plan }) => pluginDirForSpawnTarget({ cwd: plan.cwd, repoRoot: plan.repoRoot }),
    sidebarCli: realCmuxCli(),
    wait,
    witnessClaudeBoot: ({ workspace, bootWitnessed, before }) =>
      awaitClaudeComposer({ before, bootWitnessed, client, wait, workspace }),
  };
}
