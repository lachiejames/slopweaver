/**
 * The effects the two Microsoft consent verbs compose (`connectRun.ts`), and their production implementation: the
 * app registration's client id from the home, the loopback + MSAL consent, and one product's owner-only grant file
 * under that grant's own lock. Split from the runner so the runner stays the modes and what each one prints, and a
 * test hands it plain fakes of exactly this shape.
 */
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { chooseOutlookCalendarGrant } from "../../../live/outlook/calendarGrantChoice.js";
import type { OutlookConsentOutcome } from "../../../live/outlook/consent.js";
import { productionOutlookConsentDeps, runOutlookConsent } from "../../../live/outlook/consent.js";
import type { OutlookError } from "../../../live/outlook/errors.js";
import type { OutlookProduct } from "../../../live/outlook/scopes.js";
import { requireOutlookClientId, withOutlookGrantLock } from "../../../live/outlook/session.js";
import {
  type OutlookGrant,
  type OutlookGrantStore,
  outlookCalendarGrantStore,
  outlookMailGrantStore,
} from "../../../secrets/outlookGrant.js";

/** What a replacement displaced: the path written, and the grant that stood there before, if any. */
interface OutlookGrantReplacement {
  readonly path: string;
  readonly previous: OutlookGrant | undefined;
}

/** The effects a connect composes, production or fake — every grant act aimed at the running door's own grant. */
export interface OutlookConnectDeps {
  readonly consent: (args: {
    home: string;
    scopes: readonly string[];
  }) => Promise<Result<OutlookConsentOutcome, OutlookError>>;
  readonly read: (args: { home: string }) => Result<OutlookGrant | undefined>;
  /** Replace the grant, answering what stood before; production holds the grant lock across both. */
  readonly replace: (args: { home: string; grant: OutlookGrant }) => Promise<Result<OutlookGrantReplacement>>;
  /** Delete the grant; production holds the grant lock, so a refresh in flight cannot write it back. */
  readonly remove: (args: { home: string }) => Promise<Result<string>>;
  /** Whether the calendar's own grant is stored — read only by the mail door's narrowing warning. */
  readonly calendarGrantStored: (args: { home: string }) => boolean;
  /**
   * The account of a mail grant the calendar would read over with no grant of its own — the calendar's grant
   * choice run over the stored mail grant alone, no token and no socket — or `undefined` when there is none.
   * Read only by the calendar door's status and disconnect.
   */
  readonly mailGrantCoveringCalendar: (args: { home: string }) => string | undefined;
  /** Where a grant of the running door lives, for the token-free status. */
  readonly path: (args: { home: string }) => string;
  readonly nowIso: () => string;
  readonly out: (line: string) => void;
  readonly warn: (line: string) => void;
}

/** The store each product's consent writes. */
function storeOf({ product }: { product: OutlookProduct }): OutlookGrantStore {
  return product === "calendar" ? outlookCalendarGrantStore : outlookMailGrantStore;
}

/**
 * The production effects for one product: the app registration's client id from the home, the loopback + MSAL
 * consent, and that product's owner-only grant file under its own lock.
 *
 * @param product which product's grant every effect acts on
 * @returns the effects `runOutlookConnect` composes
 */
export function productionOutlookConnectDeps({ product }: { product: OutlookProduct }): OutlookConnectDeps {
  const store = storeOf({ product });
  const warn: OutlookConnectDeps["warn"] = (line) => {
    logger.warn({ msg: line });
  };
  return {
    calendarGrantStored: ({ home }) => {
      const calendar = outlookCalendarGrantStore.read({ home });
      // An unreadable calendar file is still a file the owner has: it is not the calendar reading over mail.
      return calendar.isErr() || calendar.value !== undefined;
    },
    consent: async ({ home, scopes }) => {
      const clientId = requireOutlookClientId({ home });
      if (clientId.isErr()) {
        return err(clientId.error);
      }
      return runOutlookConsent({
        deps: productionOutlookConsentDeps({ clientId: clientId.value, product, writeLine: warn }),
        scopes,
      });
    },
    mailGrantCoveringCalendar: ({ home }) => {
      const mail = outlookMailGrantStore.read({ home });
      if (mail.isErr()) {
        return undefined;
      }
      const chosen = chooseOutlookCalendarGrant({ calendarGrant: undefined, mailGrant: mail.value });
      return chosen.isOk() ? chosen.value.grant.account : undefined;
    },
    nowIso: () => new Date().toISOString(),
    out: (line) => {
      logger.out({ line });
    },
    path: ({ home }) => store.path({ home }),
    read: ({ home }) => store.read({ home }),
    remove: ({ home }) => underGrantLock({ act: () => store.remove({ home }), home, store }),
    replace: ({ home, grant }) =>
      underGrantLock({
        act: () => {
          // Read under the lock, so `previous` is the grant this write actually displaces, not a snapshot taken
          // before a concurrent consent landed. An unreadable one displaced nothing the calendar could read over.
          const before = store.read({ home });
          const previous = before.isOk() ? before.value : undefined;
          return store.write({ grant, home }).map((path) => ({ path, previous }));
        },
        home,
        store,
      }),
    warn,
  };
}

/** One grant-file act under its grant's lock, the lock's refusal folded into the same lines the act answers. */
async function underGrantLock<T>({
  home,
  store,
  act,
}: {
  home: string;
  store: OutlookGrantStore;
  act: () => Result<T>;
}): Promise<Result<T>> {
  const locked = await withOutlookGrantLock({ act: () => Promise.resolve(ok(act())), home, store });
  if (locked.isErr()) {
    return err([locked.error.message]);
  }
  return locked.value;
}
