/**
 * A Graph client bound to a stored Microsoft grant — the one path from a verb to a bearer.
 *
 * Take the grant's refresh lock, resolve the grant, check it against what the verb needs, buy a token silently
 * from the grant's MSAL cache, write the cache back, release the lock, and only THEN hand out a client. The
 * write-back comes first because the silent call may have rotated the refresh token, and a verb that acted on a
 * token it then failed to persist would hide that the stored grant is now behind Microsoft (`client.ts` header).
 *
 * The lock is what makes two verbs at once safe: without it both read the same cache, both rotate, and the
 * last write leaves a refresh token Microsoft has already replaced. Under it the second verb reads the first
 * one's written-back cache. Each product's `connect` takes the same lock to replace or delete its grant, so a
 * refresh in flight never writes an old grant back over a new consent or a disconnect. A grant file is
 * replaced atomically (`grantFile.ts`), so a reader never sees half of one. What the ordering still does NOT
 * buy: a rotation Microsoft performed is not undone by a failed write-back, so that one case can still leave
 * the stored grant stale, surfacing on a later run as `INTERACTION_REQUIRED`, which names the connect verb.
 *
 * ## Two grants, two locks, one order
 *
 * Mail and calendar are separate integrations with separate grant files and separate locks
 * (`secrets/outlookGrant.ts`). A calendar verb reads its OWN grant first and, with none stored, a mail grant
 * that already covers the calendar (`calendarGrantChoice.ts`). That fallback holds the calendar lock while it
 * takes the mail lock, so a calendar consent cannot land between "no calendar grant" and binding the mail one,
 * and it re-reads the mail grant only once the mail lock is held, so a mail re-consent cannot be overwritten
 * by the older cache it replaced. The refresh is written back to the file it was read from — the choice's
 * `source` picks the store, never a default. The ONLY nested order is calendar, then mail: nothing takes the
 * calendar lock while holding the mail one, so the two cannot deadlock.
 */
import { err, ok, type Result } from "#lib/result.js";
import { acquireOperationLockWaiting } from "../../admit/operationLockWait.js";
import { logger } from "../../lib/logger.js";
import {
  type OutlookGrant,
  type OutlookGrantStore,
  outlookCalendarGrantStore,
  outlookClientId,
  outlookMailGrantStore,
} from "../../secrets/outlookGrant.js";
import { realWaitClock } from "../../wait/loop.js";
import { makeOutlookApi } from "./api.js";
import type { OutlookApi } from "./apiCore.js";
import { chooseOutlookCalendarGrant } from "./calendarGrantChoice.js";
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

/** The bare Graph client bound to a grant, for a Microsoft seam other than the mail one (`outlookCalendar/`). */
export interface BoundOutlookGraph {
  /** The request-scoped Graph client; callers name it `graph`, which is what `boundary-residue` watches. */
  readonly graph: GraphClient;
  /** The account the grant bound to, which is also the 429 block's scope key. */
  readonly account: string;
  /** The scopes the grant carries. */
  readonly scopes: readonly string[];
}

/** What a missing client id tells the owner to do. */
const CLIENT_ID_MISSING = `the Outlook app registration's client id is not configured — ${OUTLOOK_REGISTRATION_STEPS}`;

/** How long a verb waits for another verb's refresh before it refuses. A refresh is one token call. */
const GRANT_LOCK_WAIT_SECONDS = 60;

/**
 * Run one act on a stored grant while holding that grant's lock — a refresh and write-back, a consent's
 * replacement, a disconnect's delete — so no two of them interleave and none writes back a grant another has
 * replaced.
 *
 * The lease never goes stale while its holder lives: a holder is taken over only once the kernel says it is
 * gone. An age threshold would let a clock jump or a sleeping laptop hand a live refresh's lock to a second
 * verb, which then presents the very refresh token the first is rotating. A wedged holder costs a refusal.
 *
 * @param home the state home whose grant is acted on
 * @param store which product's grant, and so which lock
 * @param act what to do once the lock is held
 * @returns the act's own answer, or `GRANT_BUSY` having run nothing
 */
export async function withOutlookGrantLock<T>({
  home,
  store,
  act,
}: {
  home: string;
  store: OutlookGrantStore;
  act: () => Promise<Result<T, OutlookError>>;
}): Promise<Result<T, OutlookError>> {
  const lock = await acquireOperationLockWaiting({
    clock: realWaitClock(),
    emit: (line) => {
      logger.warn({ msg: line });
    },
    home,
    key: store.lockKey,
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
 * Resolve the stored MAIL grant, check it against a mail verb's capabilities, refresh silently and persist,
 * then bind — all under the mail grant's lock, so two verbs at once never rotate the same refresh token.
 *
 * @param home the state home whose grant and client id are used
 * @param capabilities every capability the calling verb needs
 * @param acquire the token purchase; production's MSAL call unless a test passes its own seam
 * @returns the bound client, or the typed reason one could not be built
 */
export async function resolveOutlookClient({
  home,
  capabilities,
  acquire = acquireOutlookToken,
}: {
  home: string;
  capabilities: readonly OutlookCapability[];
  acquire?: OutlookTokenAcquire;
}): Promise<Result<BoundOutlookClient, OutlookError>> {
  const store = outlookMailGrantStore;
  const bound = await withOutlookGrantLock({
    act: async () => {
      const stored = readStored({ home, store });
      if (stored.isErr()) {
        return err(stored.error);
      }
      if (stored.value === undefined) {
        return err(OutlookErrors.notConnected({ product: "mail" }));
      }
      const missing = missingOutlookScopes({ capabilities, granted: stored.value.scopes });
      if (missing.length > 0) {
        return err(OutlookErrors.scopeMissing({ granted: stored.value.scopes, missing, product: "mail" }));
      }
      return refreshAndBind({ acquire, grant: stored.value, home, remedy: store, store });
    },
    home,
    store,
  });
  return bound.map(({ account, graph, scopes }) => ({
    account,
    api: makeOutlookApi({ graph, rateScopeKey: account }),
    scopes,
  }));
}

/** How a token is bought from a grant's MSAL cache — Microsoft in production, a plain fake in a test. */
export type OutlookTokenAcquire = typeof acquireOutlookToken;

/**
 * Bind a Graph client for a CALENDAR verb: the calendar's own grant under its lock, else — with none stored — a
 * mail grant that already covers the calendar, under the mail lock taken inside the calendar one. The token is
 * bought and written back through the store the chosen grant was read from.
 *
 * @param home the state home whose grants and client id are used
 * @param acquire the token purchase; production's MSAL call unless a test passes its own seam
 * @returns the bound Graph client, or the typed reason one could not be built, naming `outlook-calendar connect`
 */
export async function resolveOutlookCalendarGraph({
  home,
  acquire = acquireOutlookToken,
}: {
  home: string;
  acquire?: OutlookTokenAcquire;
}): Promise<Result<BoundOutlookGraph, OutlookError>> {
  return withOutlookGrantLock({
    act: async () => {
      const own = readStored({ home, store: outlookCalendarGrantStore });
      if (own.isErr()) {
        return err(own.error);
      }
      if (own.value !== undefined) {
        const chosen = chooseOutlookCalendarGrant({ calendarGrant: own.value, mailGrant: undefined });
        if (chosen.isErr()) {
          return err(chosen.error);
        }
        return refreshAndBind({
          acquire,
          grant: chosen.value.grant,
          home,
          remedy: outlookCalendarGrantStore,
          store: outlookCalendarGrantStore,
        });
      }
      return withOutlookGrantLock({
        act: () => bindOverMailGrant({ acquire, home }),
        home,
        store: outlookMailGrantStore,
      });
    },
    home,
    store: outlookCalendarGrantStore,
  });
}

/**
 * The fallback, under both locks: re-read the mail grant now that its lock is held, and bind it if it covers. The
 * refresh writes back to the mail file it read, but every refusal on the way names `outlook-calendar connect`:
 * `outlook connect` no longer grants the calendar, so naming it would not restore the read just asked for.
 */
async function bindOverMailGrant({
  home,
  acquire,
}: {
  home: string;
  acquire: OutlookTokenAcquire;
}): Promise<Result<BoundOutlookGraph, OutlookError>> {
  const mail = readStored({ home, store: outlookMailGrantStore });
  if (mail.isErr()) {
    return err(mail.error);
  }
  const chosen = chooseOutlookCalendarGrant({ calendarGrant: undefined, mailGrant: mail.value });
  if (chosen.isErr()) {
    return err(chosen.error);
  }
  const store = chosen.value.source === "calendar" ? outlookCalendarGrantStore : outlookMailGrantStore;
  return refreshAndBind({ acquire, grant: chosen.value.grant, home, remedy: outlookCalendarGrantStore, store });
}

/** Read one store's grant, its unreadable-file refusal mapped into the door's own error. */
function readStored({
  home,
  store,
}: {
  home: string;
  store: OutlookGrantStore;
}): Result<OutlookGrant | undefined, OutlookError> {
  const stored = store.read({ home });
  if (stored.isErr()) {
    return err(OutlookErrors.credentialUnreadable({ message: stored.error.join("; ") }));
  }
  return ok(stored.value);
}

/**
 * The locked half: refresh the grant read from `store`, write it back to the SAME store, bind. `remedy` is the
 * product whose connect verb every refusal names — the store's own, bar the calendar's fallback over mail — while a
 * refusal of the grant itself names `store`'s product, the grant actually read.
 */
async function refreshAndBind({
  home,
  store,
  remedy,
  grant,
  acquire,
}: {
  home: string;
  store: OutlookGrantStore;
  remedy: OutlookGrantStore;
  grant: OutlookGrant;
  acquire: OutlookTokenAcquire;
}): Promise<Result<BoundOutlookGraph, OutlookError>> {
  const clientId = requireOutlookClientId({ home });
  if (clientId.isErr()) {
    return err(clientId.error);
  }
  const token = await acquire({
    cacheGrant: store.product,
    clientId: clientId.value,
    homeAccountId: grant.homeAccountId,
    msalCache: grant.msalCache,
    product: remedy.product,
    scopes: grant.scopes,
  });
  if (token.isErr()) {
    return err(token.error);
  }
  const { expiryMs, msalCache } = token.value;
  const persisted = store.write({
    grant: { ...grant, msalCache, ...(expiryMs !== undefined ? { expiryMs } : {}) },
    home,
  });
  if (persisted.isErr()) {
    return err(
      OutlookErrors.credentialUnreadable({
        message:
          `the refreshed ${store.productName} grant could not be written back, so nothing was done with it, and ` +
          `the stored grant may now be stale — if the next run is refused, run \`${remedy.connectVerb}\`: ${persisted.error.join("; ")}`,
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
 * The client id, or the refusal naming the one command that sets it — shared by both connects and the session.
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
