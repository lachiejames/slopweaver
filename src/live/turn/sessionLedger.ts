/**
 * Registering a DISPATCHED session — an ask worker or the reviewer of its answer — in the supervisor's own
 * session ledger (`../../sessions/session.ts`), and closing that entry when the ask is done.
 *
 * ## Why these two spawns need registering at all, when `cmux spawn` was enough before
 *
 * Every other visible session this repository opens gets its own worktree, so the harness's cwd-derived
 * display name is already one-per-session and the ledger's `sessionKey` (the handover slug) happens to match
 * it. A worker and a reviewer deliberately reuse the CURRENT checkout — that is `planAskSession`'s own
 * design, not an oversight — so neither of those two facts held: measured, six live sessions (one
 * listener, two workers, three reviewers) all answered to the same checkout-derived name, and none of the
 * five spawned ones appeared in the ledger at all.
 *
 * The key is therefore `plan.sessionName`, which is ALSO what `claude --name` registers the session under —
 * one string, so a ledger row and a `ListAgents` row name the same session with nothing to correlate by hand.
 *
 * ## Never fatal
 *
 * A dispatch that landed and an answer that posted are the real outcomes; a ledger append that fails is an
 * observability loss, so every entry point here reports the failure loudly and returns. A `turn answer` that
 * exited non-zero AFTER Slack accepted the answer, because a JSONL line could not be written, would be the
 * worse bug by a distance.
 */
import type { VisibleSessionPlan } from "../../cmux/plan.js";
import { logger } from "../../lib/logger.js";
import { launchSpecFromPlan } from "../../sessionHarness/cmuxLaunch.js";
import { recordBootedSession } from "../../sessionHarness/recordingHarness.js";
import { sessionLedgerDeps } from "../../sessionHarness/sessionLedger.js";
import { appendSessionEvent } from "../../sessions/sessionStore.js";

/**
 * Register one dispatched session as `spawned`, keyed by the same name the harness registers it under.
 *
 * A plan with no {@link VisibleSessionPlan.sessionName} is not registered: without that name there is no key
 * this ledger could offer that `workspaceRef` does not already carry, and inventing one would be the fuzzy
 * identity-matching `sessions/session.ts` refuses.
 *
 * @param home the state home the ledger lives under
 * @param plan the already-decided plan the session was booted from
 * The row is written by the session harness's own recorder (`../../sessionHarness/recordingHarness.ts`'s
 * `recordBootedSession`), the one writer every launch's row goes through, so it carries the same `harness`,
 * `openedBy` and `sessionId` fields a `cmux spawn` row does. The boot and the pickup are two calls here
 * (`./freshSession.ts`), which is why no launcher records it on the way past.
 *
 * @param home the state home the ledger lives under
 * @param plan the already-decided plan the session was booted from
 * @param surfaceRef the booted session's cmux surface ref
 * @param workspaceRef the booted session's cmux workspace ref
 * @param workspaceId the booted session's cmux workspace id, the row's lifelong key
 */
export function registerDispatchedSession({
  home,
  plan,
  surfaceRef,
  workspaceRef,
  workspaceId,
}: {
  home: string;
  plan: VisibleSessionPlan;
  surfaceRef: string;
  workspaceRef: string;
  workspaceId: string;
}): void {
  const sessionKey = plan.sessionName;
  if (sessionKey === undefined) {
    return;
  }
  recordBootedSession({
    address: { endpointHandle: surfaceRef, handle: workspaceRef, sessionId: workspaceId },
    implementation: "cmux",
    ledger: sessionLedgerDeps({ home }),
    spec: launchSpecFromPlan({ ledgerKey: sessionKey, plan }),
  });
}

/**
 * Mark one dispatched session's ledger entry closed — the ONE workspace the caller actually closed, never
 * every row sharing its key.
 *
 * Called where the session itself is closed, so the ledger stops listing a workspace nobody can reach. An
 * entry for a session that was never registered is harmless — `foldSessions` creates one from a `closed`
 * event alone, which reads as "known, and done", and that is exactly true of a worker spawned by a build
 * that predates this registration.
 *
 * ## Why the ref is REQUIRED here, when a `closed` event may generally omit it
 *
 * One session key covers every ROUND of an ask's review, because `dispatchSessionName` keys on the ask and
 * the role and nothing else — so a four-round review spawns four workspaces under one key, and only the
 * LAST round's is ever released (`../../cli/commands/turn/reviewReap.ts` closes `record.reviewer`, and
 * `reviewStore.ts` overwrote the earlier rounds' records long before). A ref-less `closed` event makes
 * `../../sessions/session.ts`'s `applyClosed` retire every open row under the key, so the three superseded
 * workspaces vanished from the ledger while still running — and `session close-done`, which reads open rows,
 * could then never see them. MEASURED on the live fleet: 5 of 28 live workspaces were leaked
 * that way, three of them under `review-C0SYN000008-1789046247.801199` alone. Reproduce the shape with
 * `grep '"review-C0SYN000008-1789046247.801199"' ~/.slopweaver/sessions/sessions.jsonl`.
 *
 * A general `closed` event still may omit the ref — `session close` deliberately retires a whole key by
 * hand, and events written before the field existed have none. This caller always knows exactly which
 * workspace it tore down, so it always says.
 *
 * @param home the state home the ledger lives under
 * @param sessionKey the session's key — its `plan.sessionName`
 * @param tsIso the already-captured wall-clock time of the close, ISO 8601
 * @param workspaceRef the one workspace this close tore down, so its siblings under the same key survive
 */
export function closeDispatchedSession({
  home,
  sessionKey,
  tsIso,
  workspaceRef,
}: {
  home: string;
  sessionKey: string;
  tsIso: string;
  workspaceRef: string;
}): void {
  try {
    appendSessionEvent({ event: { kind: "closed", sessionKey, tsIso, workspaceRef }, home });
  } catch (error) {
    logger.error({
      msg: `the workspace closed, but ${sessionKey}'s session-ledger entry could not be closed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
