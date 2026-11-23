/**
 * `slopweaver calendar connect` — the Calendar door's binding of the shared Google consent shell.
 *
 * Everything about how a consent verb behaves lives in `../google/connectShell.js`. This file is only what
 * is the Calendar door's own: the OAuth client it resolves (the SAME Desktop-app client every Google door
 * uses), the grant file it writes (its own, never another door's), and the word it prints.
 */
import { logger } from "../../../lib/logger.js";
import { err } from "../../../lib/result.js";
import { type CalendarError, CalendarErrors } from "../../../live/calendar/errors.js";
import { CALENDAR_SCOPE_TABLE, type CalendarCapability } from "../../../live/calendar/scopes.js";
import { productionConsentDeps, runGoogleConsentFlow } from "../../../live/google/consent.js";
import { calendarGrantStore } from "../../../secrets/calendarGrant.js";
import { googleClientId, googleClientSecret } from "../../../secrets/googleClients.js";
import { defineCommand } from "../../defineCommand.js";
import { type GoogleConnectDeps, type GoogleConnectDoor, runGoogleConnect } from "../google/connectShell.js";
import { productionRevokeSeam } from "../google/revokeSeam.js";
import { parseCalendarConnectArgs } from "./core.js";
import { calendarErrorLines } from "./errors.js";

const VERB_ARG_OFFSET = 4;

/** The Calendar door's vocabulary, as the shared connect shell reads it. */
export const CALENDAR_DOOR: GoogleConnectDoor<CalendarError, CalendarCapability> = {
  connectVerb: "slopweaver calendar connect",
  consentFailed: ({ message, cause }) => CalendarErrors.consentFailed({ cause, message }),
  noun: "calendar",
  scopeTable: CALENDAR_SCOPE_TABLE,
};

/**
 * This door's refusal when no OAuth client is configured — one text, read by both the consent seam and the
 * revocation seam, so the two can never tell an operator different things about the same missing secret.
 *
 * @returns the door's typed credential failure
 */
function clientAbsent(): CalendarError {
  return CalendarErrors.credentialUnreadable({
    message:
      "no Google OAuth client is configured. Create a Desktop-app OAuth client in Google Cloud with the " +
      "Calendar API enabled, then run `slopweaver secrets set google-client-id` and " +
      "`slopweaver secrets set google-client-secret`",
  });
}

/**
 * The production connect seams for the Calendar door.
 *
 * @returns the consent, storage and output seams
 */
export function productionCalendarConnectDeps(): GoogleConnectDeps<CalendarError> {
  return {
    consent: async ({ home, scopes }) => {
      const clientId = googleClientId({ home });
      const clientSecret = googleClientSecret({ home });
      if (clientId === undefined || clientSecret === undefined) {
        return err(clientAbsent());
      }
      return runGoogleConsentFlow({
        clientId,
        clientSecret,
        deps: productionConsentDeps({
          clientId,
          errors: CALENDAR_DOOR,
          productName: "Google Calendar",
          provider: "calendar",
          writeLine: (line) => {
            logger.warn({ msg: line });
          },
        }),
        errors: CALENDAR_DOOR,
        provider: "calendar",
        scopes,
      });
    },
    nowIso: () => new Date().toISOString(),
    revoke: productionRevokeSeam({
      clientAbsent: clientAbsent,
      door: CALENDAR_DOOR,
      productName: "Google Calendar",
      provider: "calendar",
      resolveClientId: ({ home }) => googleClientId({ home }),
      store: calendarGrantStore,
    }),
    persist: ({ home, grant }) => calendarGrantStore.write({ grant, home }),
    status: ({ home }) =>
      calendarGrantStore
        .read({ home })
        .map((grant) => (grant === undefined ? undefined : calendarGrantStore.status({ grant, home }))),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver calendar connect`. */
export const calendarConnectCommand = defineCommand({
  run: (argv) =>
    runGoogleConnect({
      deps: productionCalendarConnectDeps(),
      door: CALENDAR_DOOR,
      // The shared shell prints a string list, so the typed refusal becomes its lines at this one boundary.
      parse: ({ rest }) => parseCalendarConnectArgs({ rest }).mapErr((error) => calendarErrorLines({ error })),
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});
