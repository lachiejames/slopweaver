/**
 * cmux's launch half (`./launch.ts`): `open` and `resume` both run the existing `spawnCmuxSession` unchanged — the
 * credential gate, worktree, browser door, boot witness, one retry, pickup delivery and banner watch all stay in
 * `../cmux/spawn.ts` — and differ only in the act the ledger records. What this file adds is the translation both
 * ways, so a verb still rendering cmux's shapes (`cmux spawn`'s output lines, its left-open report) reads
 * byte-identical output through the seam, the way `./cmuxSession.ts` does for `cmux list --json`.
 *
 * The translations are pure and exact: a plan whose `driver` agrees with its `host` (every constructor in
 * `../cmux/plan.ts` keeps them agreeing) survives the round trip, and so does every spawn outcome.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { VisibleSessionPlan } from "../cmux/plan.js";
import {
  type SpawnDeps,
  type SpawnedSession,
  type SpawnFailure,
  type SpawnOutcome,
  spawnCmuxSession,
} from "../cmux/spawn.js";
import {
  type HarnessLaunchAddress,
  type HarnessLaunchOperation,
  SessionHarnessErrors,
  type SessionLaunchFailedError,
} from "./errors.js";
import type { HarnessLaunchSpec, HarnessOpenedSession, InitialMessageResolver, SessionLauncher } from "./launch.js";

/**
 * A visible-session plan as the harness's launch spec.
 *
 * @param plan the plan the planners built
 * @param ledgerKey the ledger's label for the session
 * @param slug the handover slug, when the session is for one
 * @returns the same decision in the session's vocabulary
 */
export function launchSpecFromPlan({
  plan,
  ledgerKey,
  slug,
}: {
  plan: VisibleSessionPlan;
  ledgerKey: string;
  slug?: string | undefined;
}): HarnessLaunchSpec {
  return {
    baseBranch: plan.baseBranch,
    branch: plan.branch,
    directory: plan.cwd,
    directoryExists: plan.worktreeExists,
    host: plan.host,
    initialMessage: plan.pickupCommand,
    launchKey: plan.workspaceName,
    ledgerKey,
    model: plan.model,
    openedAtIso: plan.spawnedAt,
    registeredName: plan.sessionName,
    repoRoot: plan.repoRoot,
    respondingToHandle: plan.respondingToHandle,
    template: plan.template,
    title: plan.workspaceTitle,
    ...(slug === undefined ? {} : { slug }),
    ...(plan.credentialStoreDir === undefined ? {} : { credentialStoreDir: plan.credentialStoreDir }),
    ...(plan.credentialTokenPath === undefined ? {} : { credentialTokenPath: plan.credentialTokenPath }),
    ...(plan.codexHome === undefined ? {} : { codexHome: plan.codexHome }),
    ...(plan.effort === undefined ? {} : { effort: plan.effort }),
    ...(plan.role === undefined ? {} : { role: plan.role }),
  };
}

/**
 * A launch spec back as the visible-session plan `spawnCmuxSession` takes; the driver is the host's, as every
 * planner derives it.
 *
 * @param spec the launch spec
 * @returns the plan cmux spawns from
 */
export function planFromLaunchSpec({ spec }: { spec: HarnessLaunchSpec }): VisibleSessionPlan {
  let driver: VisibleSessionPlan["driver"] = "claude";
  if (spec.host === "codex") {
    driver = "codex";
  }
  return {
    baseBranch: spec.baseBranch,
    branch: spec.branch,
    cwd: spec.directory,
    driver,
    host: spec.host,
    model: spec.model,
    pickupCommand: spec.initialMessage,
    repoRoot: spec.repoRoot,
    respondingToHandle: spec.respondingToHandle,
    sessionName: spec.registeredName,
    spawnedAt: spec.openedAtIso,
    template: spec.template,
    workspaceName: spec.launchKey,
    workspaceTitle: spec.title,
    worktreeExists: spec.directoryExists,
    ...(spec.credentialStoreDir === undefined ? {} : { credentialStoreDir: spec.credentialStoreDir }),
    ...(spec.credentialTokenPath === undefined ? {} : { credentialTokenPath: spec.credentialTokenPath }),
    ...(spec.codexHome === undefined ? {} : { codexHome: spec.codexHome }),
    ...(spec.effort === undefined ? {} : { effort: spec.effort }),
    ...(spec.role === undefined ? {} : { role: spec.role }),
  };
}

/**
 * A spawned cmux session as the opened session the launcher reports.
 *
 * @param spawned what `spawnCmuxSession` answered
 * @returns the same session in the harness's vocabulary
 */
export function openedFromSpawned({ spawned }: { spawned: SpawnedSession }): HarnessOpenedSession {
  return {
    bootEvidence: spawned.bootWitness,
    delivery: spawned.delivery,
    endpointHandle: spawned.surfaceRef,
    endpointId: spawned.surfaceId,
    handle: spawned.workspaceRef,
    initialMessage: spawned.pickupCommand,
    sessionId: spawned.workspaceId,
  };
}

/**
 * An opened session back as cmux's spawned shape, for the verb's output lines.
 *
 * @param opened the opened session
 * @returns the spawned shape `cmux spawn` renders and records
 */
export function spawnedFromOpened({ opened }: { opened: HarnessOpenedSession }): SpawnedSession {
  return {
    bootWitness: opened.bootEvidence,
    delivery: opened.delivery,
    pickupCommand: opened.initialMessage,
    surfaceId: opened.endpointId,
    surfaceRef: opened.endpointHandle,
    workspaceId: opened.sessionId,
    workspaceRef: opened.handle,
  };
}

/**
 * A spawn failure as the launcher's typed failure, carrying the address it left whenever cmux named any of it.
 *
 * @param failure what `spawnCmuxSession` answered
 * @param operation the launch act it failed
 * @returns the typed failure
 */
export function launchFailureFromSpawn({
  failure,
  operation,
}: {
  failure: SpawnFailure;
  operation: HarnessLaunchOperation;
}): SessionLaunchFailedError {
  const named = failure.workspaceRef.length > 0 || failure.surfaceRef.length > 0 || failure.workspaceId !== undefined;
  let opened: HarnessLaunchAddress | undefined;
  if (named) {
    opened = {
      endpointHandle: failure.surfaceRef,
      handle: failure.workspaceRef,
      ...(failure.workspaceId === undefined ? {} : { sessionId: failure.workspaceId }),
    };
  }
  return SessionHarnessErrors.launchFailed({
    initialMessageStranded: failure.strandedInComposer,
    initialMessageUnproven: failure.pickupSubmissionUnproven,
    message: failure.reason,
    opened,
    operation,
    quotaKind: failure.quotaKind,
  });
}

/**
 * A launch failure back as cmux's spawn failure, for the verb's report and its left-open record.
 *
 * @param failure the typed failure
 * @returns the spawn failure `cmux spawn` reports
 */
export function spawnFailureFromLaunch({ failure }: { failure: SessionLaunchFailedError }): SpawnFailure {
  let address: Pick<SpawnFailure, "surfaceRef" | "workspaceId" | "workspaceRef"> = {
    surfaceRef: "",
    workspaceRef: "",
  };
  if (failure.opened !== undefined) {
    address = {
      surfaceRef: failure.opened.endpointHandle,
      workspaceRef: failure.opened.handle,
      ...(failure.opened.sessionId === undefined ? {} : { workspaceId: failure.opened.sessionId }),
    };
  }
  return {
    ...address,
    reason: failure.message,
    ...(failure.quotaKind === undefined ? {} : { quotaKind: failure.quotaKind }),
    ...(failure.initialMessageStranded === undefined ? {} : { strandedInComposer: failure.initialMessageStranded }),
    ...(failure.initialMessageUnproven === undefined
      ? {}
      : { pickupSubmissionUnproven: failure.initialMessageUnproven }),
  };
}

/**
 * One spawn outcome in the launcher's vocabulary.
 *
 * @param outcome what `spawnCmuxSession` answered
 * @param operation the launch act it was
 * @returns the opened session, or the typed failure
 */
function launchOutcomeOf({
  outcome,
  operation,
}: {
  outcome: SpawnOutcome;
  operation: HarnessLaunchOperation;
}): Result<HarnessOpenedSession, SessionLaunchFailedError> {
  if (outcome.isErr()) {
    return err(launchFailureFromSpawn({ failure: outcome.error, operation }));
  }
  return ok(openedFromSpawned({ spawned: outcome.value }));
}

/**
 * Build cmux's launcher over the spawn effects a verb already assembled — the caller owns them and closes them.
 *
 * @param deps the spawn effects, holding the cmux connection
 * @returns the launcher
 */
export function cmuxSessionLauncherOver({ deps }: { deps: SpawnDeps }): SessionLauncher {
  const launch = async ({
    spec,
    resolveInitialMessage,
    operation,
  }: {
    spec: HarnessLaunchSpec;
    resolveInitialMessage: InitialMessageResolver | undefined;
    operation: HarnessLaunchOperation;
  }): Promise<Result<HarnessOpenedSession, SessionLaunchFailedError>> => {
    const outcome = await spawnCmuxSession({
      deps,
      plan: planFromLaunchSpec({ spec }),
      ...(resolveInitialMessage === undefined
        ? {}
        : { resolvePickup: () => resolveInitialMessage().map((resolved) => resolved.text) }),
    });
    return launchOutcomeOf({ operation, outcome });
  };
  return {
    open: async ({ spec, resolveInitialMessage }) => launch({ operation: "open", resolveInitialMessage, spec }),
    resume: async ({ spec, resolveInitialMessage }) => launch({ operation: "resume", resolveInitialMessage, spec }),
  };
}
