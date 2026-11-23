/**
 * The Calendar SDK client, bound to a stored grant.
 *
 * The transport, the refresh and the two-copies-of-`OAuth2Client` trap are all handled once in
 * `src/live/google/authClient.ts`; read that file's header before changing anything about how this
 * authenticates, because every one of those decisions was measured rather than assumed. What is this file's
 * own is the narrow part: resolve the CALENDAR grant, check it against the capabilities the calling verb
 * needs, and hand back a `calendar_v3` surface.
 */
import { calendar, type calendar_v3 } from "@googleapis/calendar";
import type { OAuth2Client } from "googleapis-common";

import { err, ok, type Result } from "../../lib/result.js";
import { calendarGrantStore } from "../../secrets/calendarGrant.js";
import { googleClientId, googleClientSecret } from "../../secrets/googleClients.js";
import { makeGoogleAuthClient } from "../google/authClient.js";
import { missingScopes } from "../google/scopes.js";
import { type CalendarError, CalendarErrors } from "./errors.js";
import { CALENDAR_SCOPE_TABLE, type CalendarCapability } from "./scopes.js";

/**
 * A Calendar client bound to one grant, plus the facts a caller needs about that grant.
 *
 * @internal — the declared shape of `resolveCalendarClient`'s success value; callers destructure it.
 */
export interface BoundCalendarClient {
  /** The `@googleapis/calendar` surface. Named `client` on purpose: the boundary-residue gate watches it. */
  readonly client: calendar_v3.Calendar;
  /** The account the grant bound to. */
  readonly account: string;
  /** The scopes the grant actually carries. */
  readonly scopes: readonly string[];
  /** The OAuth client itself, so a caller can build a SECOND Google surface on the same grant. */
  readonly auth: OAuth2Client;
}

/**
 * Resolve the stored grant, check it against the capabilities a verb needs, and build a bound client.
 *
 * @param home the state home whose grant and client credentials are used
 * @param capabilities every capability the calling verb needs
 * @returns the bound client, or the typed reason one could not be built
 */
export function resolveCalendarClient({
  home,
  capabilities,
}: {
  home: string;
  capabilities: readonly CalendarCapability[];
}): Result<BoundCalendarClient, CalendarError> {
  const stored = calendarGrantStore.read({ home });
  if (stored.isErr()) {
    return err(CalendarErrors.credentialUnreadable({ message: stored.error.join("; ") }));
  }
  const grant = stored.value;
  if (grant === undefined) {
    return err(CalendarErrors.notConnected());
  }
  const missing = missingScopes({ capabilities, granted: grant.scopes, table: CALENDAR_SCOPE_TABLE });
  if (missing.length > 0) {
    return err(CalendarErrors.scopeMissing({ missing }));
  }
  const clientId = googleClientId({ home });
  const clientSecret = googleClientSecret({ home });
  if (clientId === undefined || clientSecret === undefined) {
    return err(
      CalendarErrors.credentialUnreadable({
        message:
          "the Google OAuth client id/secret are not configured — run `slopweaver secrets set google-client-id` " +
          "and `slopweaver secrets set google-client-secret`",
      }),
    );
  }
  const auth = makeGoogleAuthClient({
    clientId,
    clientSecret,
    grant,
    persist: ({ grant: refreshed }) => calendarGrantStore.write({ grant: refreshed, home }),
  });
  return ok({ account: grant.account, auth, client: calendar({ auth, version: "v3" }), scopes: grant.scopes });
}
