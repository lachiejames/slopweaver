/**
 * The two MAILBOX branches of `slopweaver connect --check` — Gmail and Outlook. Both resolve a stored,
 * user-consented GRANT out of a state home rather than a token from the environment, and both report the
 * grant's own scope breakdown, so they share a shape the token-based branches in `run.ts` do not.
 *
 * Effectful shell only: each reads the home, then hands a probe to its pure classifier in `src/connect/`.
 */
import { checkGmailConnection } from "../../../connect/gmail.js";
import { checkOutlookConnection, outlookGrantUnreadableReport, redactClientId } from "../../../connect/outlook.js";
import { makeGmailConnectProbes } from "../../../connect/probes.js";
import { type ConnectCheckReport, noTokenReport } from "../../../connect/types.js";
import { err } from "../../../lib/result.js";
import { resolveGmailClient } from "../../../live/gmail/client.js";
import { resolveOutlookClient } from "../../../live/outlook/session.js";
import { gmailGrantStore } from "../../../secrets/gmailGrant.js";
import { outlookClientId, readOutlookGrant } from "../../../secrets/outlookGrant.js";
import { resolveHome } from "../../optionParsers.js";

/**
 * The Gmail branch. The "not connected" case is answered without a network call at all, and
 * `resolveGmailClient`'s own typed refusal is what names a grant that will not build a client.
 *
 * `read` is the capability asked for, deliberately the narrowest one: a preflight must be runnable on a
 * read-only grant, and asking for more would make the check refuse the very install it is meant to report on.
 *
 * @param home the `--home` the caller named, when it named one
 * @returns the Gmail preflight report
 */
export async function gmailReport({ home }: { home: string | undefined }): Promise<ConnectCheckReport> {
  const resolvedHome = resolveHome({ named: home });
  const bound = resolveGmailClient({ capabilities: ["read"], home: resolvedHome });
  if (bound.isErr()) {
    return noTokenReport({ hint: bound.error.message, source: "gmail" });
  }
  const stored = gmailGrantStore.read({ home: resolvedHome });
  const grant = stored.isOk() ? stored.value : undefined;
  return checkGmailConnection({
    account: bound.value.account,
    grantedScopes: grant === undefined ? bound.value.scopes : grant.scopes,
    nowMs: Date.now(),
    probes: makeGmailConnectProbes({ account: bound.value.account, client: bound.value.client }),
    refreshTokenExpiresAtIso: grant === undefined ? undefined : grant.refreshTokenExpiresAtIso,
  });
}

/**
 * The Outlook branch. The stored state — client id, grant, its account and scopes — is read here so the report
 * can name which half of connecting is missing; the live `/me` goes through `resolveOutlookClient`, the same
 * locked refresh every Outlook verb uses, which re-reads the grant itself rather than trusting this read.
 * An unreadable grant file is reported as itself, never as "not connected".
 *
 * @param home the `--home` the caller named, when it named one
 * @returns the Outlook preflight report
 */
export async function outlookReport({ home }: { home: string | undefined }): Promise<ConnectCheckReport> {
  const resolvedHome = resolveHome({ named: home });
  const clientId = outlookClientId({ home: resolvedHome });
  const clientIdPresent = clientId !== undefined;
  const stored = readOutlookGrant({ home: resolvedHome });
  if (stored.isErr()) {
    return outlookGrantUnreadableReport({
      clientIdPresent,
      why: redactClientId({ clientId, message: stored.error.join("; ") }),
    });
  }
  const grant = stored.value;
  return checkOutlookConnection({
    probe: {
      account: grant === undefined ? "" : grant.account,
      clientIdPresent,
      grantPresent: grant !== undefined,
      grantedScopes: grant === undefined ? [] : grant.scopes,
    },
    probes: {
      me: async () => {
        // Microsoft's unknown-application refusal quotes the client id, so every refusal is
        // passed through `redactClientId` before it can reach a printed row.
        const bound = await resolveOutlookClient({ capabilities: ["identity"], home: resolvedHome });
        if (bound.isErr()) {
          return err({ ...bound.error, message: redactClientId({ clientId, message: bound.error.message }) });
        }
        const me = await bound.value.api.me();
        return me.mapErr((error) => ({ ...error, message: redactClientId({ clientId, message: error.message }) }));
      },
    },
  });
}
