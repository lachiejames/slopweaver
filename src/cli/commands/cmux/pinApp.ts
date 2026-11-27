/**
 * `cmux pin` run from inside a session the desktop app hosts: record THIS session as the supervisor.
 *
 * Nothing is pinned in cmux and nothing is launched, renamed or closed. The app must first vouch that the app session
 * id in this process's environment is this process's own (`verifyAppSessionOrigin`), and the collision rule
 * (`../../../supervisor/appPin.ts`) must pass against cmux's live pin and the strict pin record. Then the record is
 * written and the chain extended, exactly as a cmux pin writes its own.
 *
 * All of it runs under the supervisor-pin lock (`../../../supervisor/pinLock.ts`), taken before the app is asked and
 * released on every path, so a cmux pin or a takeover cannot pass its own checks between this one's read and write.
 *
 * Every effect is a seam, so a test drives the whole path with plain fakes and no socket.
 */
import { err, ok, type Result } from "#lib/result.js";
import { type AppSessionClaim, verifyAppSessionOrigin } from "../../../sessionHarness/appSessionOrigin.js";
import type { AppTransport } from "../../../sessionHarness/appSocketTransport.js";
import type { SupervisorPinDisposition } from "../../../sessions/supervisorPinStore.js";
import { type AppPinPlan, appPinLabel, appPinPlan } from "../../../supervisor/appPin.js";
import type { HoldSupervisorPinLock } from "../../../supervisor/pinLock.js";

/** The effects an app pin takes, each injected. */
export interface AppPinDeps {
  /** Takes the supervisor-pin lock, before anything else. */
  readonly holdPinLock: HoldSupervisorPinLock;
  /** The refs of every cmux workspace cmux reports pinned, or why cmux could not be read. */
  readonly pinnedWorkspaceRefs: () => Promise<Result<readonly string[], { readonly message: string }>>;
  /** The request channel to the app's control plane. */
  readonly transport: AppTransport;
  /** The pin record, read strictly. */
  readonly readDisposition: () => SupervisorPinDisposition;
  /** Writes the app pin record and extends the chain; false when the record would not write. */
  readonly record: (options: { appSessionId: string; session: AppSessionClaim["session"]; nowIso: string }) => boolean;
  readonly nowIso: () => string;
}

/** What an app pin came to. */
export interface AppPinOutcome {
  readonly label: string;
  readonly plan: AppPinPlan;
  /** Whether the record was written this run; false for an idempotent re-pin. */
  readonly wrote: boolean;
}

/**
 * Record the caller's own app session as the supervisor, refusing anything the collision rule refuses.
 *
 * cmux is read before anything is written, and a cmux that cannot be read refuses: with no answer, a pinned cmux
 * workspace cannot be ruled out, and one supervisor is the rule. A held supervisor-pin lock refuses before any of it.
 *
 * @param claim the app session this process claims, read from its environment
 * @param deps the injected effects
 * @returns the label and what was done, or the one line saying why nothing was
 */
export async function pinAppSession({
  claim,
  deps,
}: {
  claim: AppSessionClaim;
  deps: AppPinDeps;
}): Promise<Result<AppPinOutcome, { readonly message: string }>> {
  const lock = deps.holdPinLock();
  if (lock.isErr()) {
    return err({ message: lock.error.message });
  }
  try {
    return await pinAppSessionHeld({ claim, deps });
  } finally {
    lock.value.release();
  }
}

/**
 * {@link pinAppSession}'s body, run only while the supervisor-pin lock is held.
 *
 * @returns the label and what was done, or the one line saying why nothing was
 */
async function pinAppSessionHeld({
  claim,
  deps,
}: {
  claim: AppSessionClaim;
  deps: AppPinDeps;
}): Promise<Result<AppPinOutcome, { readonly message: string }>> {
  const vouched = await verifyAppSessionOrigin({ claim, transport: deps.transport });
  if (vouched.isErr()) {
    return err({ message: `the desktop app did not vouch for this session: ${vouched.error.message}` });
  }
  const pinned = await deps.pinnedWorkspaceRefs();
  if (pinned.isErr()) {
    return err({
      message: `cmux could not be read, so a pinned cmux supervisor cannot be ruled out: ${pinned.error.message}`,
    });
  }
  const plan = appPinPlan({
    appSessionId: claim.appSessionId,
    disposition: deps.readDisposition(),
    pinnedWorkspaceRefs: pinned.value,
  });
  if (plan.isErr()) {
    return err({ message: plan.error.message });
  }
  const label = appPinLabel({ appSessionId: claim.appSessionId });
  if (plan.value === "already-recorded") {
    return ok({ label, plan: plan.value, wrote: false });
  }
  const wrote = deps.record({ appSessionId: claim.appSessionId, nowIso: deps.nowIso(), session: claim.session });
  if (!wrote) {
    return err({ message: `the supervisor pin record for ${label} would not write` });
  }
  return ok({ label, plan: plan.value, wrote });
}
