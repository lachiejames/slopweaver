/**
 * `slopweaver gmail connect` — the mail door's binding of the shared Google consent shell.
 *
 * Everything about how a consent verb behaves lives in `../google/connectShell.js`: the separate `--status`
 * path that opens no socket, the grant that records what Google ACTUALLY approved rather than what was
 * asked for, and the loud warning when the two differ. This file is only what is the mail door's own — the
 * OAuth client it resolves, the grant file it writes, and the word it prints.
 */
import { logger } from "../../../lib/logger.js";
import { err } from "../../../lib/result.js";
import { type GmailError, GmailErrors } from "../../../live/gmail/errors.js";
import { GMAIL_SCOPE_TABLE, type GmailCapability } from "../../../live/gmail/scopes.js";
import { productionConsentDeps, runGoogleConsentFlow } from "../../../live/google/consent.js";
import { gmailGrantStore } from "../../../secrets/gmailGrant.js";
import { googleClientId, googleClientSecret } from "../../../secrets/googleClients.js";
import { defineCommand } from "../../defineCommand.js";
import { type GoogleConnectDeps, type GoogleConnectDoor, runGoogleConnect } from "../google/connectShell.js";
import { productionRevokeSeam } from "../google/revokeSeam.js";
import { parseGmailConnectArgs } from "./connectCore.js";
import { gmailArgsErrorLines } from "./errors.js";

const VERB_ARG_OFFSET = 4;

/** The mail door's vocabulary, as the shared connect shell reads it. */
export const GMAIL_DOOR: GoogleConnectDoor<GmailError, GmailCapability> = {
  connectVerb: "slopweaver gmail connect",
  consentFailed: ({ message, cause }) => GmailErrors.consentFailed({ cause, message }),
  noun: "gmail",
  scopeTable: GMAIL_SCOPE_TABLE,
};

/**
 * This door's refusal when no OAuth client is configured — one text, read by both the consent seam and the
 * revocation seam, so the two can never tell an operator different things about the same missing secret.
 *
 * @returns the door's typed credential failure
 */
function clientAbsent(): GmailError {
  return GmailErrors.credentialUnreadable({
    message:
      "no Google OAuth client is configured. Create a Desktop-app OAuth client in Google Cloud, then run " +
      "`slopweaver secrets set google-client-id` and `slopweaver secrets set google-client-secret`",
  });
}

/**
 * The production connect seams for the mail door.
 *
 * @returns the consent, storage and output seams
 */
export function productionGmailConnectDeps(): GoogleConnectDeps<GmailError> {
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
          errors: GMAIL_DOOR,
          productName: "Gmail",
          provider: "gmail",
          writeLine: (line) => {
            logger.warn({ msg: line });
          },
        }),
        errors: GMAIL_DOOR,
        provider: "gmail",
        scopes,
      });
    },
    nowIso: () => new Date().toISOString(),
    revoke: productionRevokeSeam({
      clientAbsent: clientAbsent,
      door: GMAIL_DOOR,
      productName: "Gmail",
      provider: "gmail",
      resolveClientId: ({ home }) => googleClientId({ home }),
      store: gmailGrantStore,
    }),
    persist: ({ home, grant }) => gmailGrantStore.write({ grant, home }),
    status: ({ home }) =>
      gmailGrantStore
        .read({ home })
        .map((grant) => (grant === undefined ? undefined : gmailGrantStore.status({ grant, home }))),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver gmail connect`. */
export const gmailConnectCommand = defineCommand({
  run: (argv) =>
    runGoogleConnect({
      deps: productionGmailConnectDeps(),
      door: GMAIL_DOOR,
      // The shared shell prints a refusal as lines and knows no door's usage, so the usage rides as the last one.
      parse: (args) => parseGmailConnectArgs(args).mapErr((error) => [...gmailArgsErrorLines({ error }), error.usage]),
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});
