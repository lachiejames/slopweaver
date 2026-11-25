/**
 * The app harness's launch half (`./launch.ts`): open a Codex or Claude session in the desktop app in three acts, so the
 * initial message is resolved only once the session is really up —
 *
 * 1. `launch.prepare` — the app opens the session's card on screen, THEN starts its worker, and answers once the
 *    vendor session is open (or refuses, naming why);
 * 2. the initial message is resolved, exactly as cmux resolves its pickup line after a boot;
 * 3. `launch.deliver` sends it — or `launch.abort` closes the prepared session when the resolve failed, so a launch
 *    that could not say what to do never leaves a session waiting on nothing.
 *
 * The worktree comes from the same spawn effects cmux's launch uses (`SpawnDeps.ensureWorktree`), so a session in
 * either harness runs in the same directory a plan names, and so does the browser door (`cmux/spawnDeps.ts`'s
 * `codexBrowserDoorFor`), read once that directory exists and before a card opens — through the Codex binary the
 * app names in its `pong`, the one its sessions run — so rule 3 holds for an app seat exactly as for a cmux one. A
 * Claude seat passes the same credential gate a cmux one does, FIRST, judged against the scrubbed environment the
 * app's worker presents (`appCredentialContext.ts`), and its spec carries the routed login by path only
 * (`appLaunchSpec.ts`). Boot and delivery evidence is the app's own report (a `ready` from the worker, a delivered
 * answer), recorded under the witness source `event`.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { VisibleSessionPlan } from "../cmux/plan.js";
import type { SpawnDeps } from "../cmux/spawn.js";
import type { Witness } from "../cmux/witness.js";
import { appLaunchSpecOf } from "./appLaunchSpec.js";
import type { AppHarnessRequest, AppLaunchSpec, AppSessionSnapshot } from "./appProtocol.js";
import type { AppTransport } from "./appSocketTransport.js";
import { planFromLaunchSpec } from "./cmuxLaunch.js";
import { type HarnessLaunchOperation, SessionHarnessErrors, type SessionLaunchFailedError } from "./errors.js";
import type { HarnessLaunchSpec, HarnessOpenedSession, InitialMessageResolver, SessionLauncher } from "./launch.js";

/** A prepare waits on a card, a worker, the adapter and the vendor's session: the app bounds that at 120s. */
const PREPARE_TIMEOUT_MS = 180_000;

/** A deliver or an abort is one instruction to a running worker, or one process group ended. */
const SETTLE_TIMEOUT_MS = 60_000;

/** The app's own report is the witness: the worker said ready, the control plane said delivered. */
const APP_WITNESS: Witness = { by: "event", confirmed: true };

function failed({
  operation,
  message,
  opened,
  prepareUnanswered,
}: {
  operation: HarnessLaunchOperation;
  message: string;
  opened?: { handle: string; sessionId: string };
  prepareUnanswered?: true;
}): SessionLaunchFailedError {
  return SessionHarnessErrors.launchFailed({
    message: `app harness: ${message}`,
    opened:
      opened === undefined
        ? undefined
        : { endpointHandle: opened.handle, handle: opened.handle, sessionId: opened.sessionId },
    operation,
    prepareUnanswered,
  });
}

/**
 * The spawn effects the app's launch uses: the worktree a new session needs; the browser door on it, built for the
 * Codex binary the app says its sessions run (`cmux/spawnDeps.ts`'s `codexBrowserDoorFor`); the Claude credential
 * gate, judged against the environment the app's Claude worker will actually present
 * (`appCredentialContext.ts`); and the plugin directory a Claude seat loads.
 */
export type AppLaunchDeps = Pick<SpawnDeps, "ensureWorktree" | "resolvePluginDir"> & {
  readonly codexBrowserDoorAt: (options: { readonly codexPath: string }) => SpawnDeps["gateCodexBrowserSurface"];
  readonly gateClaudeCredential: (options: {
    readonly plan: VisibleSessionPlan;
  }) => Promise<Result<VisibleSessionPlan, string>>;
};

/**
 * The Codex binary the app's sessions run, as the app itself names it — the one binary the door may judge — and the
 * run of the app that named it, which the launch names back so no other run spends the judgment.
 */
async function judgedApp({
  transport,
  operation,
}: {
  transport: AppTransport;
  operation: HarnessLaunchOperation;
}): Promise<Result<{ codexPath: string; instanceId: string }, SessionLaunchFailedError>> {
  const pinged = await transport({ request: { kind: "ping" }, timeoutMs: SETTLE_TIMEOUT_MS });
  if (pinged.isErr()) {
    return err(failed({ message: pinged.error.message, operation }));
  }
  const pong = pinged.value;
  if (pong.kind !== "pong" || pong.codexPath === undefined || pong.instanceId === undefined) {
    return err(
      failed({
        message:
          "the app did not name the Codex binary its sessions run, so the browser door cannot judge it — " +
          "reinstall the app with `slopweaver desktop install`",
        operation,
      }),
    );
  }
  return ok({ codexPath: pong.codexPath, instanceId: pong.instanceId });
}

/**
 * Place the session: a worktree the plan names but which is not there yet is created from the spawn's own effects,
 * then, for a Codex seat, the browser door reads that directory as the seat will run in it — its own branch's trusted
 * `.codex/config.toml` included, through the app's own Codex binary — before the app opens a card.
 */
function placeSession({
  plan,
  deps,
  codexPath,
  operation,
}: {
  plan: VisibleSessionPlan;
  deps: AppLaunchDeps;
  codexPath: string | undefined;
  operation: HarnessLaunchOperation;
}): Result<void, SessionLaunchFailedError> {
  if (!plan.worktreeExists) {
    try {
      deps.ensureWorktree({ plan });
    } catch (error: unknown) {
      const why = error instanceof Error ? error.message : String(error);
      return err(failed({ message: `could not create ${plan.cwd}: ${why}`, operation }));
    }
  }
  if (codexPath === undefined) {
    return ok(undefined);
  }
  const gated = deps.codexBrowserDoorAt({ codexPath })({ plan });
  if (gated.isErr()) {
    return err(failed({ message: gated.error, operation }));
  }
  return ok(undefined);
}

/**
 * Everything decided before the app is asked for a card, in the order that leaves nothing behind on a refusal: the
 * Claude credential gate before any directory exists, then the spec, then (for Codex) the app's binary named and
 * judged, then the worktree and the browser door.
 */
async function decidedSpec({
  spec,
  deps,
  transport,
  operation,
  ledgerHome,
}: {
  spec: HarnessLaunchSpec;
  deps: AppLaunchDeps;
  transport: AppTransport;
  operation: HarnessLaunchOperation;
  ledgerHome: string | undefined;
}): Promise<Result<AppLaunchSpec, SessionLaunchFailedError>> {
  let gated = planFromLaunchSpec({ spec });
  let pluginDir: string | undefined;
  if (spec.host === "claude-code") {
    const allowed = await deps.gateClaudeCredential({ plan: gated });
    if (allowed.isErr()) {
      return err(failed({ message: allowed.error, operation }));
    }
    gated = allowed.value;
    pluginDir = deps.resolvePluginDir({ plan: gated });
  }
  const draft = appLaunchSpecOf({ gated, ledgerHome, operation, pluginDir, spec });
  if (draft.isErr()) {
    return err(draft.error);
  }
  const decided = draft.value;
  if (decided.vendor === "claude") {
    const claude: AppLaunchSpec = decided;
    const placed = placeSession({ codexPath: undefined, deps, operation, plan: gated });
    return placed.map(() => claude);
  }
  const codex = decided;
  const app = await judgedApp({ operation, transport });
  if (app.isErr()) {
    return err(app.error);
  }
  const placed = placeSession({ codexPath: app.value.codexPath, deps, operation, plan: gated });
  // The launch names the run of the app whose binary the door judged: another run that took the socket since the
  // ping refuses it (`desktop/src/judgedApp.ts`).
  return placed.map(() => ({ ...codex, judgedInstanceId: app.value.instanceId }));
}

/**
 * Act one: the app opens the card, then the worker, and answers with the token the other two acts present — a new
 * session, or the one `continuing` names on its own recorded transcript, which the app refuses rather than replace.
 */
async function prepareSession({
  transport,
  appSpec,
  operation,
  continuing,
}: {
  transport: AppTransport;
  appSpec: AppLaunchSpec;
  operation: HarnessLaunchOperation;
  continuing: string | undefined;
}): Promise<Result<{ launchToken: string; session: AppSessionSnapshot }, SessionLaunchFailedError>> {
  const request: AppHarnessRequest =
    continuing === undefined
      ? { kind: "launch.prepare", spec: appSpec }
      : { kind: "launch.resume", sessionId: continuing, spec: appSpec };
  const prepared = await transport({ request, timeoutMs: PREPARE_TIMEOUT_MS });
  if (prepared.isErr()) {
    // Only the app's own refusal settles it. With no readable answer the app may still be preparing, and open the
    // card after this caller gave up.
    const which = continuing === undefined ? "" : ` (resuming app session ${continuing})`;
    const message = `${prepared.error.message}${which}`;
    if (prepared.error.kind === "refused") {
      return err(failed({ message, operation }));
    }
    return err(failed({ message, operation, prepareUnanswered: true }));
  }
  if (prepared.value.kind !== "prepared") {
    return err(failed({ message: `the app answered ${request.kind} with ${prepared.value.kind}`, operation }));
  }
  const { launchToken, session } = prepared.value;
  if (continuing !== undefined && session.sessionId !== continuing) {
    // Never a resume recorded under a session the app did not continue: abort it, whatever the abort answers.
    await transport({ request: { kind: "launch.abort", launchToken }, timeoutMs: PREPARE_TIMEOUT_MS });
    return err(
      failed({
        message: `the app answered launch.resume for ${continuing} with session ${session.sessionId}, which was aborted`,
        operation,
      }),
    );
  }
  return ok({ launchToken, session });
}

/** Act two: resolve the message now the session is up, or abort the prepared session when it cannot be resolved. */
async function initialMessageOrAbort({
  transport,
  launchToken,
  spec,
  resolveInitialMessage,
  operation,
}: {
  transport: AppTransport;
  launchToken: string;
  spec: HarnessLaunchSpec;
  resolveInitialMessage: InitialMessageResolver | undefined;
  operation: HarnessLaunchOperation;
}): Promise<Result<string, SessionLaunchFailedError>> {
  if (resolveInitialMessage === undefined) {
    return ok(spec.initialMessage);
  }
  const resolved = resolveInitialMessage();
  if (resolved.isOk()) {
    return ok(resolved.value.text);
  }
  const aborted = await transport({ request: { kind: "launch.abort", launchToken }, timeoutMs: SETTLE_TIMEOUT_MS });
  // A lost abort still ends the session: the app ends any launch nothing settles within its own deadline.
  const closedHow = aborted.isOk()
    ? "so the session was closed"
    : `and the abort did not reach the app (${aborted.error.message}), so the app ends the session at its unsettled-launch deadline`;
  return err(
    failed({ message: `the initial message could not be resolved, ${closedHow}: ${resolved.error}`, operation }),
  );
}

/** Act three: deliver the message, and say exactly what is known about the session when that is not confirmed. */
async function deliverInitialMessage({
  transport,
  launchToken,
  initialMessage,
  session,
  operation,
}: {
  transport: AppTransport;
  launchToken: string;
  initialMessage: string;
  session: AppSessionSnapshot;
  operation: HarnessLaunchOperation;
}): Promise<Result<HarnessOpenedSession, SessionLaunchFailedError>> {
  const delivered = await transport({
    request: { kind: "launch.deliver", launchToken, text: initialMessage },
    timeoutMs: SETTLE_TIMEOUT_MS,
  });
  if (delivered.isErr() && delivered.error.kind === "refused" && delivered.error.code === "SESSION_NOT_FOUND") {
    // The app spends a session's token when it ends, so this refusal PROVES the session gone before it held
    // anything — closed from its card mid-launch, say. Recording it opened would leave a row no close can reach.
    return err(
      failed({ message: `the session ended before its initial message: ${delivered.error.message}`, operation }),
    );
  }
  if (delivered.isErr() || delivered.value.kind !== "delivered") {
    // The session is up and may hold the message: a caller must neither close it nor launch beside it.
    const opened = { handle: session.handle, sessionId: session.sessionId };
    return err({
      ...failed({ message: "the initial message's delivery was not confirmed", opened, operation }),
      initialMessageUnproven: true,
    });
  }
  return ok({
    bootEvidence: APP_WITNESS,
    delivery: { kind: "witnessed", witness: APP_WITNESS },
    endpointHandle: session.handle,
    endpointId: session.sessionId,
    handle: session.handle,
    initialMessage,
    sessionId: session.sessionId,
  });
}

/**
 * Build the app's launcher.
 *
 * @param transport the request channel to the app
 * @param deps the spawn effects: the worktree a new session's directory needs, and the browser door read on it
 *   through the app's own Codex binary
 * @param ledgerHome the state home the spawn records under, when it named one, so the card's Stop closes there too
 * @param continuing the app session a `resume` continues: the id the run's open app ledger row records, when one does
 * @returns the launcher
 */
export function appSessionLauncherOver({
  transport,
  deps,
  ledgerHome,
  continuing,
}: {
  transport: AppTransport;
  deps: AppLaunchDeps;
  ledgerHome: string | undefined;
  continuing?: string | undefined;
}): SessionLauncher {
  const launch = async ({
    spec,
    resolveInitialMessage,
    operation,
  }: {
    spec: HarnessLaunchSpec;
    resolveInitialMessage: InitialMessageResolver | undefined;
    operation: HarnessLaunchOperation;
  }): Promise<Result<HarnessOpenedSession, SessionLaunchFailedError>> => {
    const appSpec = await decidedSpec({ deps, ledgerHome, operation, spec, transport });
    if (appSpec.isErr()) {
      return err(appSpec.error);
    }
    // Only a resume continues a recorded session; an open is always a new one.
    const resumes = operation === "resume" ? continuing : undefined;
    const prepared = await prepareSession({ appSpec: appSpec.value, continuing: resumes, operation, transport });
    if (prepared.isErr()) {
      return err(prepared.error);
    }
    const { launchToken, session } = prepared.value;
    const message = await initialMessageOrAbort({ launchToken, operation, resolveInitialMessage, spec, transport });
    if (message.isErr()) {
      return err(message.error);
    }
    const delivered = await deliverInitialMessage({
      initialMessage: message.value,
      launchToken,
      operation,
      session,
      transport,
    });
    if (resumes === undefined) {
      return delivered;
    }
    // A resumed session left standing with its delivery unproven is still the recorded one, so its row moves too.
    return delivered
      .map((opened) => ({ ...opened, resumed: true as const }))
      .mapErr((failure) => (failure.opened === undefined ? failure : { ...failure, resumed: true as const }));
  };
  return {
    open: async ({ spec, resolveInitialMessage }) => launch({ operation: "open", resolveInitialMessage, spec }),
    resume: async ({ spec, resolveInitialMessage }) => launch({ operation: "resume", resolveInitialMessage, spec }),
  };
}
