/**
 * Booting a witness worker and ending one — the two ORDERING claims of the witness noun, with every effect a
 * plain seam so a test drives the real sequence against fakes.
 *
 * **Dispatch** (rule 2: a visible session only, never a headless model):
 *
 * 1. Fold the journal and refuse a witness that already has a live worker or a verdict, or while ANY other
 *    witness worker is live (the owner's one-at-a-time ruling, `witnessDispatchPermit`). A `failed` terminal
 *    is no verdict, so it passes. Refuse too in a thread the bot stood down in (`./standDown.ts`): the tap
 *    reads that row before handing a line off, but a line handed off just before it landed reaches here.
 * 2. Require exactly one visible host from `detectSupervisorSession`. Missing or ambiguous REFUSES; there is
 *    no fallback, because the only fallback available would be an invisible model process.
 * 3. Retire a `failed` attempt before a new one (`retireFailedAttempt`): refuse if a reply was ever reserved
 *    for the message, then close its old workspace or refuse. Then plan the session (`planWitnessSession`),
 *    pinning effort with `opusSpawnEffort`.
 * 4. Boot it with `launchFreshVisibleSession`. A boot failure writes NOTHING; a boot that stands writes its
 *    session-ledger row at once, in the production `launch` seam (`registerDispatchedSession`). Every close
 *    below parks through the recording harness (`./close.ts`), so that row is closed by the same act.
 * 5. Append `dispatched` BEFORE the pickup is sent, so a fast worker that settles at once finds its own row.
 *    If that append fails the workspace is closed and nothing is sent. Should the close fail too, the window
 *    left open is idle and was never handed its pickup, so it investigates nothing; `RECORD_FAILED` names it
 *    for a hand to close.
 * 6. Deliver exactly `slopweaver witness resume <id>`. An `unwitnessed` delivery stays live and is warned
 *    about; a send that never left settles `failed` and closes the workspace. A line still TYPED in the
 *    composer after its Enter budget (`strandedInComposer`) is neither: it stays LIVE with its workspace OPEN
 *    and is refused `PICKUP_STRANDED`, because the one move left is `cmux submit` on that very workspace —
 *    settling and closing it lost the worker, the submit then reading `not_found`. A
 *    line nothing saw submitted over a box read empty (`pickupSubmissionUnproven`) stays LIVE and OPEN the same
 *    way, refused `PICKUP_UNPROVEN`: only a reader of that screen can say whether a turn ran.
 *
 * Steps 1 to 5 run under ONE per-home lock (`admit/operationLock.ts`), never aged out while its holder lives and
 * taken over at once from a dead one, so
 * two dispatches at the same instant cannot both pass step 1 before either appends — a race that exists for one key and then across two under the one-at-a-time cap. A second dispatch while the
 * lock is held is refused `DISPATCH_LOCKED`, never queued.
 *
 * **Settle**, under the same lock, is `./settle.ts`.
 */
import type { Result } from "#lib/result.js";
import { err, ok } from "#lib/result.js";
import { opusSpawnEffort } from "../../cmux/modelPin.js";
import type { VisibleSessionPlan } from "../../cmux/plan.js";
import { planWitnessSession } from "../../cmux/planWitness.js";
import { type PickupDelivery, type SpawnFailureDetail, spawnFailureKeepsWorkspaceOpen } from "../../cmux/spawn.js";
import {
  detectSupervisorSession,
  supervisorSessionProblem,
  type VisibleSessionHost,
} from "../../supervisor/session.js";
import type { FreshVisibleSessionRef, VisibleSessionLaunchOutcome } from "../turn/tier.js";
import { type WitnessCloseTarget, witnessCloseTargetOf } from "./close.js";
import { type WitnessDispatchError, WitnessDispatchErrors, type WitnessJournalError } from "./errors.js";
import { foldWitnessJournal, witnessDispatchPermit } from "./journal.js";
import { standDownWhere, threadStandDown } from "./standDown.js";
import {
  type WitnessCurrent,
  type WitnessDispatchedEvent,
  type WitnessJournalEvent,
  type WitnessKey,
  type WitnessSettledEvent,
  witnessIdOf,
} from "./types.js";

/** The journal half every witness effect shares. */
export interface WitnessJournalDeps {
  readonly readJournal: () => Result<readonly WitnessJournalEvent[], WitnessJournalError>;
  readonly append: (args: { event: WitnessJournalEvent }) => Result<void, WitnessJournalError>;
  /**
   * Close one cmux workspace, parked through the recording harness so its session-ledger row closes with it
   * (`./close.ts`); the failure text, a held park included, or `undefined` once it is closed.
   */
  readonly closeWorkspace: (args: WitnessCloseTarget) => Promise<string | undefined>;
  readonly nowIso: () => string;
  /**
   * Take the home's one witness lock, which a dispatch holds from its journal read to its end and a settle
   * around its read and append — `acquireOperationLock` for real; the refusal text when it is held.
   */
  readonly lock: () => Result<{ readonly release: () => void }, string>;
}

/** Everything `dispatchWitness` touches, as plain seams. */
export interface WitnessDispatchDeps extends WitnessJournalDeps {
  /** The current checkout the worker boots into — the dispatcher's own, never a new worktree. */
  readonly checkout: () => { readonly repoRoot: string; readonly branch: string };
  /** Boot a visible session from a plan — `launchFreshVisibleSession` over `productionSpawnDeps()` for real. */
  readonly launch: (args: { plan: VisibleSessionPlan }) => Promise<VisibleSessionLaunchOutcome>;
  /** Send the plan's pickup line into the booted session — `deliverFreshSessionPickup` for real. */
  readonly deliver: (args: {
    plan: VisibleSessionPlan;
    session: FreshVisibleSessionRef;
  }) => Promise<Result<PickupDelivery, SpawnFailureDetail>>;
  /**
   * Whether a witness reply was ever reserved for this message, at ANY age — the send ledger's keyed
   * reservation under `witnessIdempotencyKey`, which outlives the door's 24-hour duplicate window.
   */
  readonly replyReserved: (args: { key: WitnessKey }) => boolean;
}

/** What a successful dispatch reports. */
export interface WitnessDispatched {
  readonly witnessId: string;
  readonly record: WitnessDispatchedEvent;
  readonly delivery: PickupDelivery;
}

/**
 * The exact line a witness worker is handed.
 *
 * @param witnessId the witness the worker owns
 * @returns `slopweaver witness resume <witnessId>`
 */
export function witnessPickupCommand({ witnessId }: { witnessId: string }): string {
  return `slopweaver witness resume ${witnessId}`;
}

/**
 * Boot one visible witness worker, in the order this module's header numbers, under the home's one
 * witness-dispatch lock — so the one-at-a-time check and the `dispatched` row it permits are atomic against
 * every other dispatch on this machine.
 *
 * @param request the witnessed message, its text, and the model the worker is pinned to
 * @param env the process environment, for the visible-host detection
 * @param deps the effects
 * @returns the dispatched record and how the pickup landed, or the refusal
 */
export async function dispatchWitness({
  request,
  env,
  deps,
}: {
  request: { readonly key: WitnessKey; readonly text: string; readonly model: string };
  env: Readonly<Record<string, string | undefined>>;
  deps: WitnessDispatchDeps;
}): Promise<Result<WitnessDispatched, WitnessDispatchError>> {
  const held = deps.lock();
  if (held.isErr()) {
    return err(WitnessDispatchErrors.locked({ reason: held.error }));
  }
  try {
    return await dispatchHeld({ deps, env, request });
  } finally {
    held.value.release();
  }
}

/** The dispatch itself, run only while the lock is held. */
async function dispatchHeld({
  request,
  env,
  deps,
}: {
  request: { readonly key: WitnessKey; readonly text: string; readonly model: string };
  env: Readonly<Record<string, string | undefined>>;
  deps: WitnessDispatchDeps;
}): Promise<Result<WitnessDispatched, WitnessDispatchError>> {
  const { key } = request;
  const events = deps.readJournal();
  if (events.isErr()) {
    return err(WitnessDispatchErrors.journal({ cause: events.error }));
  }
  const current = foldWitnessJournal({ events: events.value });
  const permit = witnessDispatchPermit({ current, key });
  if (permit.isErr()) {
    return err(permit.error);
  }
  const stoodDown = threadStandDown({ channel: key.channel, events: events.value, threadTs: key.threadTs });
  if (stoodDown !== undefined) {
    return err(WitnessDispatchErrors.threadStoodDown({ key, stoodDownAt: standDownWhere({ row: stoodDown }) }));
  }
  const visibleHost = witnessHost({ env });
  if (visibleHost.isErr()) {
    return err(visibleHost.error);
  }
  const host = visibleHost.value;
  const witnessId = witnessIdOf({ key });
  const retired = await retireFailedAttempt({ deps, failed: current.get(witnessId), key, witnessId });
  if (retired.isErr()) {
    return err(retired.error);
  }
  const plan = witnessPlan({ deps, host, request, witnessId });
  const launched = await deps.launch({ plan });
  if ("reason" in launched) {
    return err(WitnessDispatchErrors.bootFailed({ reason: launched.reason }));
  }
  const { session } = launched;
  const record = dispatchedRecord({ request, session, tsIso: deps.nowIso(), witnessId });
  const recorded = deps.append({ event: record });
  if (recorded.isErr()) {
    const closeFailure = await deps.closeWorkspace({
      sessionKey: session.sessionName,
      workspaceId: session.workspaceId,
      workspaceRef: session.workspaceRef,
    });
    return err(
      WitnessDispatchErrors.recordFailed({ cause: recorded.error, closeFailure, workspaceRef: session.workspaceRef }),
    );
  }
  const delivered = await deps.deliver({ plan, session });
  if (delivered.isErr()) {
    return err(await pickupFailure({ deps, failure: delivered.error, record }));
  }
  return ok({ delivery: delivered.value, record, witnessId });
}

/** What step 4 boots: the visible session for this witness, on the checkout the loop is standing in. */
function witnessPlan({
  deps,
  host,
  request,
  witnessId,
}: {
  deps: Pick<WitnessDispatchDeps, "checkout" | "nowIso">;
  host: VisibleSessionHost;
  request: { readonly key: WitnessKey; readonly text: string; readonly model: string };
  witnessId: string;
}): VisibleSessionPlan {
  const { key, model, text } = request;
  const { branch, repoRoot } = deps.checkout();
  const effort = opusSpawnEffort({ host, model });
  return planWitnessSession({
    branch,
    channel: key.channel,
    ...(effort === undefined ? {} : { effort }),
    host,
    messageTs: key.messageTs,
    model,
    pickupCommand: witnessPickupCommand({ witnessId }),
    repoRoot,
    spawnedAt: deps.nowIso(),
    text,
  });
}

/**
 * Step 6's failure: a pickup still TYPED in the composer, or one nothing saw submitted over a box read empty,
 * was sent and its seat is open, so the witness stays live with nothing settled or closed; any other failure
 * is a send that never left.
 */
async function pickupFailure({
  deps,
  failure,
  record,
}: {
  deps: Pick<WitnessJournalDeps, "append" | "closeWorkspace" | "nowIso">;
  failure: SpawnFailureDetail;
  record: WitnessDispatchedEvent;
}): Promise<WitnessDispatchError> {
  if (failure.strandedInComposer === true) {
    return WitnessDispatchErrors.pickupStranded({
      reason: failure.reason,
      witnessId: record.witnessId,
      workspaceRef: record.workspaceRef,
    });
  }
  if (spawnFailureKeepsWorkspaceOpen({ failure })) {
    return WitnessDispatchErrors.pickupUnproven({
      reason: failure.reason,
      witnessId: record.witnessId,
      workspaceRef: record.workspaceRef,
    });
  }
  return settlePickupUnsent({ deps, reason: failure.reason, record });
}

/** Step 5's row: the booted session's every ref, under the witnessed message's coordinates. */
function dispatchedRecord({
  request,
  session,
  tsIso,
  witnessId,
}: {
  request: { readonly key: WitnessKey; readonly text: string; readonly model: string };
  session: FreshVisibleSessionRef;
  tsIso: string;
  witnessId: string;
}): WitnessDispatchedEvent {
  const { key, model, text } = request;
  return {
    channel: key.channel,
    ...(session.cwd === undefined ? {} : { cwd: session.cwd }),
    host: session.host,
    kind: "dispatched",
    messageTs: key.messageTs,
    model,
    schemaVersion: 1,
    ...(session.sessionName === undefined ? {} : { sessionName: session.sessionName }),
    surfaceId: session.surfaceId,
    surfaceRef: session.surfaceRef,
    text,
    threadTs: key.threadTs,
    tsIso,
    witnessId,
    workspaceId: session.workspaceId,
    workspaceRef: session.workspaceRef,
  };
}

/** Step 2: exactly one visible host, or the refusal — never a fallback to an invisible model process. */
function witnessHost({
  env,
}: {
  env: Readonly<Record<string, string | undefined>>;
}): Result<VisibleSessionHost, WitnessDispatchError> {
  const detection = detectSupervisorSession({ env });
  if (detection.kind === "missing") {
    return err(WitnessDispatchErrors.hostMissing({ problem: supervisorSessionProblem({ detection }) }));
  }
  if (detection.kind === "ambiguous") {
    return err(WitnessDispatchErrors.hostAmbiguous({ problem: supervisorSessionProblem({ detection }) }));
  }
  return ok(detection.session.host === "codex" ? "codex" : "claude-code");
}

/**
 * Step 3's guard on a re-dispatch: a `failed` attempt is retired before a new one boots. A reply ever reserved
 * for the message refuses it, because the failed attempt may have posted before it ended and the door's own
 * duplicate check lapses after a day; the old workspace is then closed, already-gone counting as closed, and a
 * close that fails refuses it, because a worker left in that window would run beside the new one.
 */
async function retireFailedAttempt({
  deps,
  failed,
  key,
  witnessId,
}: {
  deps: Pick<WitnessDispatchDeps, "closeWorkspace" | "replyReserved">;
  failed: WitnessCurrent | undefined;
  key: WitnessKey;
  witnessId: string;
}): Promise<Result<void, WitnessDispatchError>> {
  if (failed?.settled?.outcome !== "failed") {
    return ok(undefined);
  }
  if (deps.replyReserved({ key })) {
    return err(WitnessDispatchErrors.replyAlreadyReserved({ witnessId }));
  }
  const previous = failed.dispatched;
  if (previous === undefined) {
    return ok(undefined);
  }
  const closeFailure = await deps.closeWorkspace(witnessCloseTargetOf({ record: previous }));
  if (closeFailure !== undefined) {
    return err(
      WitnessDispatchErrors.previousAttemptOpen({ closeFailure, witnessId, workspaceRef: previous.workspaceRef }),
    );
  }
  return ok(undefined);
}

/** Step 6's failure: a pickup that never left settles the witness `failed` and closes its workspace. */
async function settlePickupUnsent({
  record,
  reason,
  deps,
}: {
  record: WitnessDispatchedEvent;
  reason: string;
  deps: Pick<WitnessJournalDeps, "append" | "closeWorkspace" | "nowIso">;
}): Promise<WitnessDispatchError> {
  const failed: WitnessSettledEvent = {
    channel: record.channel,
    kind: "settled",
    messageTs: record.messageTs,
    outcome: "failed",
    schemaVersion: 1,
    threadTs: record.threadTs,
    tsIso: deps.nowIso(),
    why: `the pickup line could not be sent into ${record.workspaceRef}: ${reason}`,
    witnessId: record.witnessId,
  };
  const settled = deps.append({ event: failed });
  const closeFailure = await deps.closeWorkspace(witnessCloseTargetOf({ record }));
  return WitnessDispatchErrors.pickupUnsent({
    closeFailure,
    reason,
    settleFailure: settled.isErr() ? settled.error.message : undefined,
    witnessId: record.witnessId,
    workspaceRef: record.workspaceRef,
  });
}
