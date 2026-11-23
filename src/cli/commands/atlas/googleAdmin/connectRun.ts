/**
 * `slopweaver atlas google-admin connect` — the Google Admin door's binding of the shared Google consent
 * shell.
 *
 * Everything about how a consent verb behaves lives in `../../google/connectShell.js`. This file is only
 * what is this door's own: the OAuth client it resolves, the grant file it writes (its own, never the mail
 * or Drive door's), and the word it prints.
 *
 * ## The client it resolves is NOT the one every other Google door uses, and that is the rail
 *
 * The rule: write capabilities on the owner's own Gmail, Drive, Docs and calendar, but readonly on
 * all the Google admin surfaces and no writes to Google admin. A rule in this repository cannot
 * carry that, because Google's incremental authorisation merges granted scopes over the
 * `(client, account)` pair — a readonly consent through a client that once held write scopes lands a grant
 * carrying those writes, none of them on the screen.
 *
 * So this door consents through a SECOND Desktop-app OAuth client (`google-admin-client-id`), in the same
 * Cloud project, that has never been shown a write scope and therefore cannot be issued a token carrying
 * one. There is deliberately NO fallback to `google-client-id`: falling back would silently re-create the
 * defect under a name claiming it was fixed.
 *
 * Naming two secrets is not having two clients: a `google-admin-client-id` holding the user-data client's id
 * with a second secret holds the split in code and not on disk, and the stored grant would still carry the
 * Gmail writes. Two rails hold it on disk: `adminClientPair` refuses an admin id
 * equal to the user-data one, for consent AND for `--revoke` (Google withdraws the whole (client, account)
 * grant from the token alone, so a shared-client revoke would disconnect mail, Drive and calendar), and the
 * door's `readOnly` refuses to store a landed grant carrying any scope not provably read-only.
 *
 * ## Why it sits under `atlas google-admin` rather than a noun of its own
 *
 * The platform is the THIRD WORD, and this grant has exactly one consumer: the
 * `google-admin` atlas's `admin-api` channel. A top-level `google-admin` noun would put a credential verb
 * somewhere no reader of the atlas would look for it, and would claim a product surface this repository
 * does not have. `sync` stays credential-free, which is why the platform's manifest row stays where it is.
 */
import { logger } from "../../../../lib/logger.js";
import { err } from "../../../../lib/result.js";
import { productionConsentDeps, runGoogleConsentFlow } from "../../../../live/google/consent.js";
import { type GoogleAdminDoorError, GoogleAdminDoorErrors } from "../../../../live/googleAdmin/errors.js";
import { GOOGLE_ADMIN_SCOPE_TABLE, type GoogleAdminCapability } from "../../../../live/googleAdmin/scopes.js";
import { googleAdminGrantStore } from "../../../../secrets/googleAdminGrant.js";
import {
  googleAdminClientId,
  googleAdminClientSecret,
  googleAdminClientSharesUserDataClient,
} from "../../../../secrets/googleClients.js";
import { defineCommand } from "../../../defineCommand.js";
import { verbTail } from "../../../optionParsers.js";
import { type GoogleConnectDeps, type GoogleConnectDoor, runGoogleConnect } from "../../google/connectShell.js";
import { productionRevokeSeam } from "../../google/revokeSeam.js";

import { adminClientAbsent, adminClientPair, parseGoogleAdminConnectArgs } from "./connectCore.js";
import { googleAdminConnectErrorLines } from "./errors.js";

/** Where a verb sits: past the runtime, the script, the `atlas` noun and the `google-admin` platform. */
const GOOGLE_ADMIN_VERB_INDEX = 4;

/** The Google Admin door's vocabulary, as the shared connect shell reads it. */
export const GOOGLE_ADMIN_DOOR: GoogleConnectDoor<GoogleAdminDoorError, GoogleAdminCapability> = {
  connectVerb: "slopweaver atlas google-admin connect",
  consentFailed: ({ message, cause }) => GoogleAdminDoorErrors.consentFailed({ cause, message }),
  noun: "google-admin",
  readOnly: true,
  scopeTable: GOOGLE_ADMIN_SCOPE_TABLE,
};

/**
 * The admin client pair out of one home, compared against that home's user-data client.
 *
 * @param home the state home whose client secrets are read
 * @returns the admin pair, or the refusal `adminClientPair` names
 */
function adminPairIn({ home }: { home: string }): ReturnType<typeof adminClientPair> {
  return adminClientPair({
    adminClientId: googleAdminClientId({ home }),
    adminClientSecret: googleAdminClientSecret({ home }),
    sharesUserDataClient: googleAdminClientSharesUserDataClient({ home }),
  });
}

/**
 * The production connect seams for the Google Admin door.
 *
 * @returns the consent, storage and output seams
 */
function productionGoogleAdminConnectDeps(): GoogleConnectDeps<GoogleAdminDoorError> {
  const revokeThroughAdminClient = productionRevokeSeam({
    clientAbsent: adminClientAbsent,
    door: GOOGLE_ADMIN_DOOR,
    productName: "Google Workspace Admin",
    provider: "google-admin",
    resolveClientId: ({ home }) => googleAdminClientId({ home }),
    store: googleAdminGrantStore,
  });
  return {
    consent: async ({ home, scopes }) => {
      const pair = adminPairIn({ home });
      if (pair.isErr()) {
        return err(pair.error);
      }
      const { clientId, clientSecret } = pair.value;
      return runGoogleConsentFlow({
        clientId,
        clientSecret,
        deps: productionConsentDeps({
          clientId,
          errors: GOOGLE_ADMIN_DOOR,
          productName: "Google Workspace Admin",
          provider: "google-admin",
          writeLine: (line) => {
            logger.warn({ msg: line });
          },
        }),
        errors: GOOGLE_ADMIN_DOOR,
        provider: "google-admin",
        scopes,
      });
    },
    nowIso: () => new Date().toISOString(),
    // Google revokes the whole (client, account) grant from the token alone, so a revoke through a client
    // shared with the user-data doors would disconnect all three of them — refused on the same pair check.
    revoke: async ({ home }) => {
      const pair = adminPairIn({ home });
      if (pair.isErr()) {
        return err(pair.error);
      }
      return revokeThroughAdminClient({ home });
    },
    persist: ({ home, grant }) => googleAdminGrantStore.write({ grant, home }),
    status: ({ home }) =>
      googleAdminGrantStore
        .read({ home })
        .map((grant) => (grant === undefined ? undefined : googleAdminGrantStore.status({ grant, home }))),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * Run the `atlas google-admin connect` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 * @internal
 */
export async function runGoogleAdminConnect(argv: readonly string[]): Promise<number> {
  // No `--help` branch, deliberately: the manifest layer answers `--help` for every verb under a platform
  // row before dispatch reaches here — `slopweaver atlas google-admin connect --help` prints the row's own
  // usage, which advertises this verb's flags. A second copy here would be unreachable, and the day it
  // stopped being unreachable it would be a second help text to keep in step with the first.
  return runGoogleConnect({
    deps: productionGoogleAdminConnectDeps(),
    door: GOOGLE_ADMIN_DOOR,
    // The shared shell prints a refusal as lines and knows no door's usage, so the usage rides as the last one.
    parse: (args) =>
      parseGoogleAdminConnectArgs(args).mapErr((error) => [...googleAdminConnectErrorLines({ error }), error.usage]),
    rest: verbTail({ argv, at: GOOGLE_ADMIN_VERB_INDEX, verbs: ["connect"] }),
  });
}

/** `slopweaver atlas google-admin connect`. */
export const googleAdminConnectCommand = defineCommand({ run: runGoogleAdminConnect });
