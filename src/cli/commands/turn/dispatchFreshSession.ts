/**
 * `turn dispatch`'s `fresh-visible-session` tier: resolve a durable permalink, launch a real watched cmux
 * workspace, deliver its pickup command, and prove the recorded workspace actually holds a session before
 * this verb reports success — split out of `./dispatch.ts` (Codex code-quality ratchet, item 2) purely to
 * keep that file under the file-size cap; no behaviour here changed in the split.
 *
 * `recordDispatchNeverLanded` is exported because it is also the seam the sweep's own phantom branch shares
 * (`./sweptRecords.ts`'s `recordPhantomDispatch`) and because the regression test that drives the recording half
 * against a real temp home imports it directly — see that test for why.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { realWorkspaceLivenessCheck } from "../../../cmux/liveness.js";
import type { VisibleSessionPlan } from "../../../cmux/plan.js";
import { type PickupDelivery, spawnFailureKeepsWorkspaceOpen } from "../../../cmux/spawn.js";
import { slackBotToken, slackUserToken } from "../../../config.js";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import { resolveSlackReadToken } from "../../../corpus/slack/fetch.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { StartedChecklist } from "../../../live/ask/checklist.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import type { AskLifecycleEvent } from "../../../live/ask/lifecycle.js";
import { appendAskLifecycleEvent } from "../../../live/ask/store.js";
import { slackAskPermalink } from "../../../live/slack/permalink.js";
import { askSessionPlan } from "../../../live/turn/askSessionPlan.js";
import { dispatchIdOf, sameSlackWorkspace } from "../../../live/turn/dispatch.js";
import { deliverFreshSessionPickup, launchFreshVisibleSession } from "../../../live/turn/freshSession.js";
import type { RoutingJudgementInput } from "../../../live/turn/judgement.js";
import {
  executeTier,
  type FreshVisibleSessionRef,
  type RespondDecision,
  type TierDeps,
} from "../../../live/turn/tier.js";
import type { SlackSelfIdentity } from "../../../outbound/slack/lifecycleGuards.js";
import { productionSpawnDeps } from "../../../sessionHarness/recordedSpawn.js";
import { identityRosterPort } from "../../../silver/identityRoster.js";
import type { IdentityRosterError } from "../../../silver/identityRosterErrors.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { refuse } from "./core.js";
import {
  phantomReasonFor,
  recordDispatchNeverLanded,
  recordDispatchUnwitnessed,
  recordFreshDispatch,
} from "./dispatchFreshRecords.js";
import { type TurnCommandError, TurnCommandErrors, turnCommandErrorLines } from "./errors.js";

/**
 * A `TierDeps.subagent`/`.launchVisibleSession` that must never actually be called from a given path.
 *
 * @param what which `TierDeps` field this is standing in for, named in the rejection if it's ever invoked
 * @returns a function that always rejects, for a `TierDeps` field this dispatch path never exercises
 */
export function neverCalled({ what }: { what: string }): () => Promise<never> {
  return () => Promise.reject(new Error(`${what} should never be called from this dispatch path`));
}

/**
 * One side of a workspace mismatch as the refusal names it. `auth.test` may answer without a team id, and the
 * refusal still has to say which side that was.
 *
 * @param identity what `auth.test` reported for one token
 * @returns the team id, or `unknown` when Slack named none
 */
function mismatchTeam({ identity }: { identity: SlackSelfIdentity }): string {
  const teamId = unsetFieldAsNull({ key: "teamId", record: identity });
  if (teamId === null) {
    return "unknown";
  }
  return teamId;
}

/**
 * Resolve the durable permalink a fresh session's dispatch record will carry — real network calls, hardwired
 * rather than injected, matching this exact lane's own established precedent for `productionSpawnDeps()`/
 * `readScreen` (see `./dispatch.ts`'s own header note and `AGENTS.md`'s doctrine on it). Refuses loudly rather
 * than launching a workspace this dispatch could not honestly hand a trustworthy thread pointer to:
 *
 * 1. No bot token configured ⇒ refuse (the bot token is the ask's own captured workspace, the comparison target).
 * 2. No Slack read token configured (user or bot) ⇒ refuse.
 * 3. The read token's workspace and the bot token's workspace disagree ⇒ refuse (P3's cross-workspace finding).
 * 4. `auth.test` cannot resolve a workspace URL for the read token ⇒ refuse.
 *
 * @param askIdentity the exact ask this dispatch is for
 * @param home the resolved state home
 * @returns the built permalink, or every reason it could not be resolved
 */
async function resolveAskPermalinkOrRefuse({
  askIdentity,
  home,
}: {
  askIdentity: AskIdentity;
  home: string;
}): Promise<Result<string, TurnCommandError>> {
  const botToken = slackBotToken({ home });
  if (botToken === undefined) {
    return err(TurnCommandErrors.slackCredentialMissing({ credential: "bot" }));
  }
  const { token: readToken } = resolveSlackReadToken({ botToken, userToken: slackUserToken({ home }) });
  if (readToken === undefined) {
    return err(TurnCommandErrors.slackCredentialMissing({ credential: "read" }));
  }
  const botIdentity = await makeSlackWriteTransport({ home, token: botToken }).whoAmI();
  const readIdentity = await makeSlackWriteTransport({ home, token: readToken }).whoAmI();
  if (!sameSlackWorkspace({ botIdentity, readIdentity })) {
    return err(
      TurnCommandErrors.slackWorkspaceMismatch({
        botTeam: mismatchTeam({ identity: botIdentity }),
        readTeam: mismatchTeam({ identity: readIdentity }),
      }),
    );
  }
  const workspaceUrl = await makeSlackApi({ token: readToken }).workspaceUrl();
  if (workspaceUrl === undefined) {
    return err(TurnCommandErrors.slackWorkspaceUnresolved());
  }
  return ok(slackAskPermalink({ askIdentity, workspaceUrl }));
}

/** Launch the fresh session and interpret `executeTier`'s result, or the one reason it failed. */
async function launchAndInterpret({
  askIdentity,
  briefPath,
  home,
  leaseExpiresAt,
  plan,
}: {
  askIdentity: AskIdentity;
  briefPath: string;
  home: string;
  leaseExpiresAt: string;
  plan: VisibleSessionPlan;
}): Promise<Result<FreshVisibleSessionRef, TurnCommandError>> {
  const deps: TierDeps = {
    // Opened and closed around the one launch. `productionSpawnDeps()` now holds a live socket AND an event
    // subscription, both of which keep the Node event loop alive — a verb that forgets to close them prints
    // its answer and then hangs forever.
    launchVisibleSession: async () => {
      const spawnDeps = productionSpawnDeps();
      try {
        return await launchFreshVisibleSession({ deps: spawnDeps, plan });
      } finally {
        spawnDeps.close();
      }
    },
    nowIso: () => new Date().toISOString(),
    subagent: neverCalled({ what: "subagent" }),
  };
  const result = await executeTier({
    deps,
    request: { ask: askIdentity, briefPath, kind: "fresh-visible-session", leaseExpiresAt },
  });
  if (result.kind === "lease-expired") {
    return err(TurnCommandErrors.dispatchInvariantBroken({ kind: "expired-lease" }));
  }
  if (result.kind === "failed") {
    const failed: AskLifecycleEvent = {
      ...askIdentity,
      kind: "failed",
      reason: result.reason,
      tsIso: new Date().toISOString(),
    };
    appendAskLifecycleEvent({ event: failed, home });
    return err(TurnCommandErrors.upstreamRefused({ reasons: [result.reason] }));
  }
  if (result.kind !== "dispatched") {
    return err(TurnCommandErrors.dispatchInvariantBroken({ kind: "wrong-tier" }));
  }
  return ok(result.session);
}

/**
 * Deliver a booted workspace's pickup command, translating a refused SEND — or a line still typed in the
 * composer after its Enter budget (`cmux/pickupComposerConfirm.ts`'s `confirmPickupLeftComposer`) — into the
 * errors a caller can refuse with; pulled out of {@link handleFreshVisibleSession} to keep it a thin shell.
 *
 * The `unwitnessed` delivery is deliberately NOT an error here and is passed through: the line was accepted
 * by the client, so a worker may well be reading it right now, and calling that a failure is what orphaned
 * one (`../../../live/ask/lifecycle.ts`'s `DispatchUnwitnessedEvent`). The old advice this used to print —
 * "resend the pickup line by hand if needed" — is now the wrong instruction as well as the wrong verdict:
 * a hand-resend on a landed line is the same duplicate the automatic retry was removed for.
 *
 * A line still in the composer, or one nothing saw submitted over a box read empty, was SENT into a live seat
 * (`cmux/spawn.ts`'s `spawnFailureKeepsWorkspaceOpen`), so it is refused with `keepsWorkspaceOpen` and the
 * caller tracks it rather than ending the dispatch.
 *
 * @param plan the plan naming the pickup text to send
 * @param session the already-booted workspace to deliver into
 * @returns how delivery ended, or the refusal and whether the seat it was sent into stays open
 */
async function deliverPickupOrRefuse({
  plan,
  session,
}: {
  plan: VisibleSessionPlan;
  session: FreshVisibleSessionRef;
}): Promise<Result<PickupDelivery, { readonly error: TurnCommandError; readonly keepsWorkspaceOpen: boolean }>> {
  const spawnDeps = productionSpawnDeps();
  const delivered = await (async () => {
    try {
      return await deliverFreshSessionPickup({ deps: spawnDeps, plan, session });
    } finally {
      spawnDeps.close();
    }
  })();
  if (delivered.isErr()) {
    return err({
      error: TurnCommandErrors.workerPickupUnsent({ cause: delivered.error.reason }),
      keepsWorkspaceOpen: spawnFailureKeepsWorkspaceOpen({ failure: delivered.error }),
    });
  }
  return ok(delivered.value);
}

/**
 * Deliver the pickup command and prove the recorded workspace actually holds a session, before this verb
 * prints a green line about either.
 *
 * The dispatch half of the phantom fix. Both refusals record `dispatch-failed`, because the durable record
 * and the `dispatched` lifecycle event are ALREADY written by the time this runs (the boot-vs-delivery race
 * forces that order) — so a refusal that only printed to stderr would leave the ledger claiming a dispatch
 * that never landed, which is the exact lie this change exists to remove.
 *
 * A delivery that was SENT but unwitnessed is neither of those refusals and does not fail the verb: the
 * liveness check has already found a session in the workspace, so the only unproven thing is the pickup's
 * arrival. It is recorded as `dispatch-unwitnessed` and the verb reports success — see
 * {@link recordDispatchUnwitnessed} for the three things that recording deliberately does not do.
 *
 * @param askIdentity the ask being dispatched
 * @param card the live progress card the worker is told to drive, so it never has to find one
 * @param dispatchId the already-minted dispatch id, for the lines this prints on success
 * @param home the resolved state home
 * @param plan the plan naming the pickup text to send
 * @param session the booted, already-recorded session locator
 * @returns the process exit code
 */
async function confirmDispatchLanded({
  askIdentity,
  card,
  dispatchId,
  home,
  plan,
  session,
}: {
  askIdentity: AskIdentity;
  card: StartedChecklist;
  dispatchId: string;
  home: string;
  plan: VisibleSessionPlan;
  session: FreshVisibleSessionRef;
}): Promise<number> {
  const delivered = await deliverPickupOrRefuse({ plan, session });
  if (delivered.isErr() && delivered.error.keepsWorkspaceOpen) {
    // The line WAS sent into a live seat and only its submission is unproven: ending the dispatch here would
    // free the ask for a second worker beside one that may be running it, so it is tracked as unwitnessed.
    recordDispatchUnwitnessed({ askIdentity, home, session });
    return refuse({ code: EXIT_ERROR, errors: turnCommandErrorLines({ error: delivered.error.error }) });
  }
  if (delivered.isErr()) {
    await recordDispatchNeverLanded({
      askIdentity,
      home,
      reason: `the pickup command was not delivered into workspace ${session.workspaceRef}`,
    });
    return refuse({ code: EXIT_ERROR, errors: turnCommandErrorLines({ error: delivered.error.error }) });
  }
  const phantom = await phantomReasonFor({ checkLiveness: realWorkspaceLivenessCheck(), session });
  if (phantom !== undefined) {
    await recordDispatchNeverLanded({ askIdentity, home, reason: phantom });
    return refuse({ code: EXIT_ERROR, errors: [`the dispatch did not land: ${phantom}`] });
  }
  // The liveness check above already ran and found a session, so an unwitnessed delivery here is exactly the
  // ambiguous case: something IS in that workspace, and only the pickup's arrival is unproven.
  if (delivered.value.kind === "unwitnessed") {
    recordDispatchUnwitnessed({ askIdentity, home, session });
    logger.error({
      msg:
        `turn dispatch: nothing witnessed the pickup command arriving in ${session.workspaceRef}, its ` +
        `composer was submitted again, and it was NOT re-typed — recorded dispatch-unwitnessed. The sweep ` +
        `tracks this ask like a running worker and reconciles it against cmux's own delivery record; do not ` +
        `resend the line by hand.`,
    });
  }
  logger.out({ line: `dispatched to a fresh visible session — dispatch id ${dispatchId}` });
  logger.out({
    line: `its live progress card is ${askIdentity.channel}/${card.workingTs} — the worker drives it with turn status`,
  });
  logger.out({ line: `poll it with: slopweaver turn dispatch --poll ${dispatchId} --home ${home}` });
  return EXIT_OK;
}

/**
 * The fresh session's plan. The composition root for the roster port: one read, before anything is launched,
 * so a store outage refuses the dispatch rather than naming the asker off a roster the store no longer holds.
 */
async function freshSessionPlan({
  askIdentity,
  decision,
  dispatchId,
  home,
  question,
  routingInput,
  userId,
}: {
  askIdentity: AskIdentity;
  decision: RespondDecision;
  dispatchId: string;
  home: string;
  question: string;
  routingInput: RoutingJudgementInput;
  userId: string;
}): Promise<Result<VisibleSessionPlan, IdentityRosterError>> {
  const identityRoster = await identityRosterPort().read({ home });
  return identityRoster.map((snapshot) =>
    askSessionPlan({
      askIdentity,
      askQuestion: question,
      decision,
      dispatchId,
      home,
      identityRoster: snapshot,
      routingInput,
      spawnedAt: new Date().toISOString(),
      userId,
    }),
  );
}

/**
 * Handle the `fresh-visible-session` tier: open a real, watched cmux workspace and return immediately.
 *
 * @param askIdentity the ask being dispatched
 * @param briefPath the brief file path the launched session will be pointed back at
 * @param card the live progress card this ask already has standing, proved before this function is reachable
 * @param decision the parsed `respond` decision this tier is honouring
 * @param home the resolved state home
 * @param leaseExpiresAt the freshly minted lease this dispatch is recorded under
 * @param question the ask's own question text, for the session's pickup instructions
 * @param routingInput the brief's routing input, carried into the durable dispatch record
 * @param userId the asking user's id, for the session's pickup instructions
 * @returns the process exit code
 */
export async function handleFreshVisibleSession({
  askIdentity,
  briefPath,
  card,
  decision,
  home,
  leaseExpiresAt,
  question,
  routingInput,
  userId,
}: {
  askIdentity: AskIdentity;
  briefPath: string;
  card: StartedChecklist;
  decision: RespondDecision;
  home: string;
  leaseExpiresAt: string;
  question: string;
  routingInput: RoutingJudgementInput;
  userId: string;
}): Promise<number> {
  const askPermalink = await resolveAskPermalinkOrRefuse({ askIdentity, home });
  if (askPermalink.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: turnCommandErrorLines({ error: askPermalink.error }) });
  }
  const dispatchId = dispatchIdOf({ askIdentity });
  const planned = await freshSessionPlan({ askIdentity, decision, dispatchId, home, question, routingInput, userId });
  if (planned.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: [planned.error.message] });
  }
  const plan = planned.value;
  const session = await launchAndInterpret({ askIdentity, briefPath, home, leaseExpiresAt, plan });
  if (session.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: turnCommandErrorLines({ error: session.error }) });
  }
  // Write the durable record BEFORE sending the pickup command — a fast fresh agent may otherwise act on a
  // verified pickup prompt before its own dispatch record exists (P3's boot-vs-delivery race). Boot and
  // delivery are two separate calls precisely so this ordering is possible.
  recordFreshDispatch({
    askIdentity,
    askPermalink: askPermalink.value,
    briefPath,
    decision,
    dispatchId,
    home,
    leaseExpiresAt,
    plan,
    routingInput,
    session: session.value,
  });
  return confirmDispatchLanded({ askIdentity, card, dispatchId, home, plan, session: session.value });
}
