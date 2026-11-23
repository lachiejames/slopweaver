/**
 * `slopweaver drive connect` — the Drive door's binding of the shared Google consent shell.
 *
 * Everything about how a consent verb behaves lives in `../google/connectShell.js`. This file is only what
 * is the Drive door's own: the OAuth client it resolves (the SAME Desktop-app client every Google door
 * uses), the grant file it writes (its own, never the mail door's), and the word it prints.
 */
import { logger } from "../../../lib/logger.js";
import { err } from "../../../lib/result.js";
import { type DriveError, DriveErrors } from "../../../live/drive/errors.js";
import { DRIVE_SCOPE_TABLE, type DriveCapability } from "../../../live/drive/scopes.js";
import { productionConsentDeps, runGoogleConsentFlow } from "../../../live/google/consent.js";
import { driveGrantStore } from "../../../secrets/driveGrant.js";
import { googleClientId, googleClientSecret } from "../../../secrets/googleClients.js";
import { defineCommand } from "../../defineCommand.js";
import { type GoogleConnectDeps, type GoogleConnectDoor, runGoogleConnect } from "../google/connectShell.js";
import { productionRevokeSeam } from "../google/revokeSeam.js";
import { parseDriveConnectArgs } from "./core.js";
import { driveErrorLines } from "./errors.js";

const VERB_ARG_OFFSET = 4;

/** The Drive door's vocabulary, as the shared connect shell reads it. */
export const DRIVE_DOOR: GoogleConnectDoor<DriveError, DriveCapability> = {
  connectVerb: "slopweaver drive connect",
  consentFailed: ({ message, cause }) => DriveErrors.consentFailed({ cause, message }),
  noun: "drive",
  scopeTable: DRIVE_SCOPE_TABLE,
};

/**
 * This door's refusal when no OAuth client is configured — one text, read by both the consent seam and the
 * revocation seam, so the two can never tell an operator different things about the same missing secret.
 *
 * @returns the door's typed credential failure
 */
function clientAbsent(): DriveError {
  return DriveErrors.credentialUnreadable({
    message:
      "no Google OAuth client is configured. Create a Desktop-app OAuth client in Google Cloud, then run " +
      "`slopweaver secrets set google-client-id` and `slopweaver secrets set google-client-secret`",
  });
}

/**
 * The production connect seams for the Drive door.
 *
 * @returns the consent, storage and output seams
 */
export function productionDriveConnectDeps(): GoogleConnectDeps<DriveError> {
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
          errors: DRIVE_DOOR,
          productName: "Google Drive",
          provider: "drive",
          writeLine: (line) => {
            logger.warn({ msg: line });
          },
        }),
        errors: DRIVE_DOOR,
        provider: "drive",
        scopes,
      });
    },
    nowIso: () => new Date().toISOString(),
    revoke: productionRevokeSeam({
      clientAbsent: clientAbsent,
      door: DRIVE_DOOR,
      productName: "Google Drive",
      provider: "drive",
      resolveClientId: ({ home }) => googleClientId({ home }),
      store: driveGrantStore,
    }),
    persist: ({ home, grant }) => driveGrantStore.write({ grant, home }),
    status: ({ home }) =>
      driveGrantStore
        .read({ home })
        .map((grant) => (grant === undefined ? undefined : driveGrantStore.status({ grant, home }))),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver drive connect`. */
export const driveConnectCommand = defineCommand({
  run: (argv) =>
    runGoogleConnect({
      deps: productionDriveConnectDeps(),
      door: DRIVE_DOOR,
      parse: ({ rest }) => parseDriveConnectArgs({ rest }).mapErr((error) => driveErrorLines({ error })),
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});
