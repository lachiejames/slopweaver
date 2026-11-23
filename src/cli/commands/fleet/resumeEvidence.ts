/**
 * What the recovery pass reads off this machine about a seat, apart from cmux: the plan register and each plan's
 * email, whether a plan's own store is signed in, a session's live process and what it booted on, whether the chair
 * has said it is caught up — and the reseat deps with the signed-out check in front of the routing gate.
 *
 * All local reads, no request. The pass itself is `./resumeRun.ts`.
 */
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { loginHintFor } from "../../../claude/accountBinding.js";
import { readAssertions } from "../../../claude/assertionStore.js";
import type { ClaudeAccount } from "../../../claude/contracts.js";
import { credentialHasAccessToken, readClaudeCredential } from "../../../claude/credentialDocument.js";
import type { ClaudeRotationError } from "../../../claude/errors.js";
import { readCredentialDocument } from "../../../claude/keychain.js";
import { readChairPlansForSessions } from "../../../claude/seatBootRead.js";
import { readSetupTokenFile } from "../../../claude/seatToken.js";
import { readSpawnAccounts } from "../../../claude/spawnAccounts.js";
import { reorientationsBySession } from "../../../fleet/journal.js";
import { isLiveSeat } from "../../../fleet/liveSeat.js";
import type { FleetPort } from "../../../fleet/port.js";
import { readProcessStarts } from "../../../fleet/processStarts.js";
import type { FleetAccountNames } from "../../../fleet/refusals.js";
import { type FleetPlanCredential, signInWhenNothingRoutes } from "../../../fleet/resumePlan.js";
import type { PlanRegisterPort } from "../../../plans/port.js";
import { scanSessions } from "../../../sessions/liveSessionStore.js";
import type { SessionRecord } from "../../../sessions/liveSessions.js";
import { ReseatErrors } from "../../../sessions/reseatErrors.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import type { ReseatDeps } from "../cmux/reseatPass.js";

/**
 * The plan register's Claude plans, an empty list ONLY when nothing Claude is configured — a pass with no plans
 * still relaunches on spawn's rules.
 *
 * A register that could not be read is an `err`, never `[]`: an empty list here would let the pass relaunch every
 * seat on spawn's unconfigured rules — the ambient credential — exactly when the plans it was meant to obey were
 * unknown, and the sign-in guard would match no routed store against no plan.
 *
 * @param home the state home whose register is read
 * @param port where the plan register is read
 * @returns every configured plan, or why the register could not be read
 */
export async function accountsOf({
  home,
  port,
}: {
  home: string;
  port: PlanRegisterPort;
}): Promise<Result<readonly ClaudeAccount[], ClaudeRotationError>> {
  const read = await readSpawnAccounts({ home, port });
  if (read.isErr()) {
    return err(read.error);
  }
  if (read.value === undefined) {
    return ok([]);
  }
  return ok(read.value);
}

/**
 * Each plan's email, for the sign-in button's label.
 *
 * @param accounts the plan register
 * @param home the state home whose sign-in assertions name the emails
 * @returns the lookup the refusal table asks
 */
export function accountNames({
  accounts,
  home,
}: {
  accounts: readonly ClaudeAccount[];
  home: string;
}): FleetAccountNames {
  const assertions = readAssertions({ home });
  return {
    emailFor: ({ alias }) => {
      const account = accounts.find((candidate) => candidate.alias === alias);
      if (account === undefined) {
        return undefined;
      }
      return loginHintFor({ account, assertions })?.address;
    },
  };
}

/** Whether a plan's own store holds a credential to present. Local, no request. */
function storeSignedIn({ account }: { account: ClaudeAccount }): boolean {
  const slice = readClaudeCredential({ document: readCredentialDocument({ storeDir: account.storeDir }) });
  return credentialHasAccessToken({ slice });
}

/** Each plan's local credential state, in the register's order. A token file that will not read still counts. */
function planCredentials({ accounts }: { accounts: readonly ClaudeAccount[] }): readonly FleetPlanCredential[] {
  return accounts.map((account) => ({
    alias: account.alias,
    hasToken: readSetupTokenFile({ storeDir: account.storeDir }).kind !== "absent",
    paused: account.paused !== undefined,
    signedIn: storeSignedIn({ account }),
  }));
}

/**
 * The live registry record carrying a session id, when its own process still runs — health's rule exactly
 * (`isLiveSeat`), so a dead session whose pid a stranger inherited is no chair here either.
 *
 * @param sessionId the Claude session to find
 * @returns its record, or `undefined` when no live process carries it or `ps` could not say
 */
export function liveRecordFor({ sessionId }: { sessionId: string }): SessionRecord | undefined {
  const read = readProcessStarts();
  if ("why" in read) {
    return undefined;
  }
  const scan = scanSessions({ sessionsDir: join(claudeHomeDir(), "sessions") });
  return scan.records.find((record) => record.sessionId === sessionId && isLiveSeat({ record, starts: read.starts }));
}

/**
 * The plan a live session booted on, when it booted on one.
 *
 * @param accounts the plan register its boot credential is matched against
 * @param sessionId the Claude session to read
 * @returns the plan's alias, or `undefined` for a dead, off-plan or unreadable session
 */
export function bootAliasOf({
  accounts,
  sessionId,
}: {
  accounts: readonly ClaudeAccount[];
  sessionId: string;
}): string | undefined {
  const record = liveRecordFor({ sessionId });
  if (record === undefined || accounts.length === 0) {
    return undefined;
  }
  const read = readChairPlansForSessions({
    accounts,
    sessions: [
      {
        pid: record.pid,
        sessionId,
        ...(record.procStart === undefined ? {} : { procStart: record.procStart }),
      },
    ],
  });
  const plan = read.sessions[0]?.plan;
  if (plan === undefined || plan.kind === "off-plan" || plan.kind === "unresolved") {
    return undefined;
  }
  return plan.alias;
}

/**
 * Whether the supervisor has said it is caught up since its current process started.
 *
 * @param fleet where the recovery journal holding its line lives
 * @param home the state home whose journal holds its line
 * @param sessionId the chair's Claude session
 * @returns true only for a reorientation dated after the live process began
 */
export async function chairReoriented({
  fleet,
  home,
  sessionId,
}: {
  fleet: FleetPort;
  home: string;
  sessionId: string;
}): Promise<boolean> {
  const record = liveRecordFor({ sessionId });
  const events = await fleet.readResumeJournal({ home });
  if (record === undefined || events.isErr()) {
    return false;
  }
  const at = reorientationsBySession({ events: events.value.events }).get(sessionId);
  return at !== undefined && Date.parse(at) >= record.startedAtMs;
}

/**
 * The reseat deps with the signed-out check in front of the routing gate's answer: a plan with no setup token
 * whose own store is signed out would relaunch straight back into the wall, so it is refused before anything stops.
 * And when routing could read no plan because no plan has a credential left at all, that is the same sign-in, named
 * on the register's first plan (`signInWhenNothingRoutes`), rather than an outage that clears by itself.
 *
 * @param base the production reseat deps
 * @param accounts the plan register a routed store is matched against
 * @param signedOut filled with each refused workspace's plan, so its refusal can name the account
 * @returns the guarded deps
 */
export function guardedDeps({
  base,
  accounts,
  signedOut,
}: {
  base: ReseatDeps;
  accounts: readonly ClaudeAccount[];
  signedOut: Map<string, string>;
}): ReseatDeps {
  return {
    ...base,
    routeCredential: async ({ plan }) => {
      const routed = await base.routeCredential({ plan });
      if (routed.isErr()) {
        const unreadable = routed.error.refusalKind === "unreadable-plan";
        const alias = unreadable ? signInWhenNothingRoutes({ plans: planCredentials({ accounts }) }) : undefined;
        if (alias === undefined) {
          return routed;
        }
        signedOut.set(plan.workspace.workspaceId, alias);
        return err(
          ReseatErrors.storeRefused({
            reason: `no plan has a setup token or a signed-in login left, so no account can be read and a relaunch would wall again — signing in ${alias} gives recovery one; nothing was stopped`,
            refusalKind: "configuration",
          }),
        );
      }
      if (routed.value.tokenPath !== undefined || routed.value.storeDir === undefined) {
        return routed;
      }
      const storeDir = routed.value.storeDir;
      const account = accounts.find((candidate) => candidate.storeDir === storeDir);
      if (account === undefined || storeSignedIn({ account })) {
        return routed;
      }
      signedOut.set(plan.workspace.workspaceId, account.alias);
      return err(
        ReseatErrors.storeRefused({
          reason: `${account.alias} has no setup token and its own login is signed out, so a relaunch on it would wall again — nothing was stopped`,
          refusalKind: "configuration",
        }),
      );
    },
  };
}
