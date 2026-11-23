/**
 * A Graph client bound to the stored Outlook grant — the one path from a verb to a bearer.
 *
 * Take the grant's refresh lock, resolve the grant, check it against the capabilities the verb needs, buy a
 * token silently from the grant's MSAL cache, write the cache back, release the lock, and only THEN hand out a
 * client. The write-back comes first because the silent call may have rotated the refresh token, and a verb
 * that acted on a token it then failed to persist would hide that the stored grant is now behind Microsoft
 * (`client.ts` header).
 *
 * The lock is what makes two verbs at once safe: without it both read the same cache, both rotate, and the
 * last write leaves a refresh token Microsoft has already replaced. Under it the second verb reads the first
 * one's written-back cache. `outlook connect` takes the same lock to replace or delete the grant, so a refresh
 * in flight never writes an old grant back over a new consent or a disconnect. The grant file itself is
 * replaced atomically (`grantFile.ts`), so a reader never
 * sees half of one. What the ordering still does NOT buy: a rotation Microsoft performed is not undone by a
 * failed write-back, so that one case can still leave the stored grant stale, surfacing on a later run as
 * `INTERACTION_REQUIRED`, which names `outlook connect`.
 */
import { err, ok, type Result } from "#lib/result.js";
import { acquireOperationLockWaiting } from "../../admit/operationLockWait.js";
import { logger } from "../../lib/logger.js";
import { outlookClientId, readOutlookGrant, writeOutlookGrant } from "../../secrets/outlookGrant.js";
import { realWaitClock } from "../../wait/loop.js";
import { makeOutlookApi } from "./api.js";
import type { OutlookApi } from "./apiCore.js";
import { acquireOutlookToken, type GraphClient, makeGraphClient } from "./client.js";
import { type OutlookError, OutlookErrors } from "./errors.js";
import { missingOutlookScopes, OUTLOOK_REGISTRATION_STEPS, type OutlookCapability } from "./scopes.js";

/** The Graph seam bound to one grant, plus the facts a caller needs about that grant. */
export interface BoundOutlookClient {
  /** Every Graph call a verb makes, through the door. */
  readonly api: OutlookApi;
  /** The mailbox the grant bound to. */
  readonly account: string;
  /** The scopes the grant carries. */
  readonly scopes: readonly string[];
}

/** What a missing client id tells the owner to do. */
const CLIENT_ID_MISSING = `the Outlook app registration's client id is not configured — ${OUTLOOK_REGISTRATION_STEPS}`;

/** The operation-lock key every Outlook refresh takes; one grant per home, so one key. */
const OUTLOOK_GRANT_LOCK_KEY = "outlook-grant-refresh";

/** How long a verb waits for another verb's refresh before it refuses. A refresh is one token call. */
const GRANT_LOCK_WAIT_SECONDS = 60;

/**
 * Run one act on the stored grant while holding its lock — a refresh and write-back, a consent's replacement,
 * a disconnect's delete — so no two of them interleave and none writes back a grant another has replaced.
 *
 * The lease never goes stale while its holder lives: a holder is taken over only once the kernel says it is
 * gone. An age threshold would let a clock jump or a sleeping laptop hand a live refresh's lock to a second
 * verb, which then presents the very refresh token the first is rotating. A wedged holder costs a refusal.
 *
 * @param home the state home whose grant is acted on
 * @param act what to do once the lock is held
 * @returns the act's own answer, or `GRANT_BUSY` having run nothing
 */
export async function withOutlookGrantLock<T>({
  home,
  act,
}: {
  home: string;
  act: () => Promise<Result<T, OutlookError>>;
}): Promise<Result<T, OutlookError>> {
  const lock = await acquireOperationLockWaiting({
    clock: realWaitClock(),
    emit: (line) => {
      logger.warn({ msg: line });
    },
    home,
    key: OUTLOOK_GRANT_LOCK_KEY,
    nowIso: () => new Date().toISOString(),
    staleAfterMs: Number.POSITIVE_INFINITY,
    timeoutSeconds: GRANT_LOCK_WAIT_SECONDS,
  });
  if (lock.isErr()) {
    return err(OutlookErrors.grantBusy({ holder: lock.error }));
  }
  try {
    return await act();
  } finally {
    lock.value.release();
  }
}

/**
 * Resolve the stored grant, check it against a verb's capabilities, refresh silently and persist, then bind —
 * all under the grant's lock, so two verbs at once never rotate the same refresh token.
 *
 * @param home the state home whose grant and client id are used
 * @param capabilities every capability the calling verb needs
 * @returns the bound client, or the typed reason one could not be built
 */
export async function resolveOutlookClient({
  home,
  capabilities,
}: {
  home: string;
  capabilities: readonly OutlookCapability[];
}): Promise<Result<BoundOutlookClient, OutlookError>> {
  const bound = await resolveOutlookGraph({ capabilities, home });
  return bound.map(({ account, graph, scopes }) => ({
    account,
    api: makeOutlookApi({ graph, rateScopeKey: account }),
    scopes,
  }));
}

/** The bare Graph client bound to the grant, for a Microsoft seam other than the mail one (`outlookCalendar/`). */
export interface BoundOutlookGraph {
  /** The request-scoped Graph client; callers name it `graph`, which is what `boundary-residue` watches. */
  readonly graph: GraphClient;
  /** The account the grant bound to, which is also the 429 block's scope key. */
  readonly account: string;
  /** The scopes the grant carries. */
  readonly scopes: readonly string[];
}

/**
 * The same lock, check, refresh and write-back as {@link resolveOutlookClient}, handing back the Graph client
 * itself, so the calendar seam is built over the ONE token path rather than a second one.
 *
 * @param home the state home whose grant and client id are used
 * @param capabilities every capability the calling verb needs
 * @returns the bound Graph client, or the typed reason one could not be built
 */
export async function resolveOutlookGraph({
  home,
  capabilities,
}: {
  home: string;
  capabilities: readonly OutlookCapability[];
}): Promise<Result<BoundOutlookGraph, OutlookError>> {
  return withOutlookGrantLock({ act: () => refreshAndBind({ capabilities, home }), home });
}

/** The locked half: read the grant as the last refresh left it, refresh, write back, bind. */
async function refreshAndBind({
  home,
  capabilities,
}: {
  home: string;
  capabilities: readonly OutlookCapability[];
}): Promise<Result<BoundOutlookGraph, OutlookError>> {
  const stored = readOutlookGrant({ home });
  if (stored.isErr()) {
    return err(OutlookErrors.credentialUnreadable({ message: stored.error.join("; ") }));
  }
  const grant = stored.value;
  if (grant === undefined) {
    return err(OutlookErrors.notConnected());
  }
  const missing = missingOutlookScopes({ capabilities, granted: grant.scopes });
  if (missing.length > 0) {
    return err(OutlookErrors.scopeMissing({ granted: grant.scopes, missing }));
  }
  const clientId = requireOutlookClientId({ home });
  if (clientId.isErr()) {
    return err(clientId.error);
  }
  const token = await acquireOutlookToken({
    clientId: clientId.value,
    homeAccountId: grant.homeAccountId,
    msalCache: grant.msalCache,
    scopes: grant.scopes,
  });
  if (token.isErr()) {
    return err(token.error);
  }
  const { expiryMs, msalCache } = token.value;
  const persisted = writeOutlookGrant({
    grant: { ...grant, msalCache, ...(expiryMs !== undefined ? { expiryMs } : {}) },
    home,
  });
  if (persisted.isErr()) {
    return err(
      OutlookErrors.credentialUnreadable({
        message:
          `the refreshed Outlook grant could not be written back, so nothing was done with it, and the stored ` +
          `grant may now be stale — if the next run is refused, run \`slopweaver outlook connect\`: ${persisted.error.join("; ")}`,
      }),
    );
  }
  return ok({
    account: grant.account,
    graph: makeGraphClient({ accessToken: token.value.accessToken }),
    scopes: grant.scopes,
  });
}

/**
 * The client id, or the refusal naming the one command that sets it — shared by `connect` and the session.
 *
 * @returns the configured client id, or `CREDENTIAL_UNREADABLE` naming `secrets set outlook-client-id`
 */
export function requireOutlookClientId({ home }: { home: string }): Result<string, OutlookError> {
  const clientId = outlookClientId({ home });
  if (clientId === undefined) {
    return err(OutlookErrors.credentialUnreadable({ message: CLIENT_ID_MISSING }));
  }
  return ok(clientId);
}
