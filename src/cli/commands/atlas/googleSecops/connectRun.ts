/**
 * `slopweaver atlas google-secops connect` — the Google SecOps door's binding of the shared Google consent
 * shell.
 *
 * Everything about how a consent verb behaves lives in `../../google/connectShell.js`. This file is only what
 * is this door's own: the THIRD OAuth client it resolves (never the mail or admin client, and refused when its
 * id equals either), the grant file it writes, and the word it prints. `readOnly: true` makes the shell refuse
 * to store a landed grant carrying any scope that is not provably read-only.
 *
 * `chronicle.readonly` only, on a new client of its own — least privilege on the
 * fleet's own setup. Why a client of its own rather than a scope added to the admin one: `src/secrets/googleClients.ts`.
 */
import { logger } from "../../../../lib/logger.js";
import { err, type Result } from "../../../../lib/result.js";
import { productionConsentDeps, runGoogleConsentFlow } from "../../../../live/google/consent.js";
import { secopsClientAbsent, secopsClientPairIn } from "../../../../live/googleSecops/client.js";
import { type GoogleSecopsDoorError, GoogleSecopsDoorErrors } from "../../../../live/googleSecops/errors.js";
import {
  GOOGLE_SECOPS_SCOPE_TABLE,
  type GoogleSecopsCapability,
  secopsScopesOutsideTable,
} from "../../../../live/googleSecops/scopes.js";
import { googleSecopsClientId } from "../../../../secrets/googleClients.js";
import type { GoogleGrant } from "../../../../secrets/googleGrant.js";
import { googleSecopsGrantStore } from "../../../../secrets/googleSecopsGrant.js";
import { defineCommand } from "../../../defineCommand.js";
import { verbTail } from "../../../optionParsers.js";
import { type GoogleConnectDeps, type GoogleConnectDoor, runGoogleConnect } from "../../google/connectShell.js";
import { productionRevokeSeam } from "../../google/revokeSeam.js";

import { parseGoogleSecopsConnectArgs } from "./connectCore.js";

/** Where a verb sits: past the runtime, the script, the `atlas` noun and the `google-secops` platform. */
const GOOGLE_SECOPS_VERB_INDEX = 4;

/** How the door names itself on the consent screen's console lines and in every refusal. */
const PRODUCT_NAME = "Google Security Operations";

/** The Google SecOps door's vocabulary, as the shared connect shell reads it. */
export const GOOGLE_SECOPS_DOOR: GoogleConnectDoor<GoogleSecopsDoorError, GoogleSecopsCapability> = {
  connectVerb: "slopweaver atlas google-secops connect",
  consentFailed: ({ message, cause }) => GoogleSecopsDoorErrors.consentFailed({ cause, message }),
  noun: "google-secops",
  readOnly: true,
  scopeTable: GOOGLE_SECOPS_SCOPE_TABLE,
};

/**
 * Store a landed grant only when it carries nothing this door did not ask for. The shell's `readOnly` already
 * refuses a write scope; this refuses a wider READ scope too.
 *
 * @param home the state home the grant is written into
 * @param grant the grant Google returned, not yet on disk
 * @returns the stored file's path, or why it was refused
 */
function persistSecopsGrant({ home, grant }: { home: string; grant: GoogleGrant }): Result<string> {
  const outside = secopsScopesOutsideTable({ scopes: grant.scopes });
  if (outside.length > 0) {
    return err([
      `google-secops: refused to store the grant — Google returned ${outside.join(", ")}, which this door never asks for`,
    ]);
  }
  return googleSecopsGrantStore.write({ grant, home });
}

/**
 * The production connect seams for the Google SecOps door.
 *
 * @returns the consent, storage and output seams
 */
function productionGoogleSecopsConnectDeps(): GoogleConnectDeps<GoogleSecopsDoorError> {
  const revokeThroughSecopsClient = productionRevokeSeam({
    clientAbsent: secopsClientAbsent,
    door: GOOGLE_SECOPS_DOOR,
    productName: PRODUCT_NAME,
    provider: "google-secops",
    resolveClientId: ({ home }) => googleSecopsClientId({ home }),
    store: googleSecopsGrantStore,
  });
  return {
    consent: async ({ home, scopes }) => {
      const pair = secopsClientPairIn({ home });
      if (pair.isErr()) {
        return err(pair.error);
      }
      const { clientId, clientSecret } = pair.value;
      return runGoogleConsentFlow({
        clientId,
        clientSecret,
        deps: productionConsentDeps({
          clientId,
          errors: GOOGLE_SECOPS_DOOR,
          productName: PRODUCT_NAME,
          provider: "google-secops",
          writeLine: (line) => {
            logger.warn({ msg: line });
          },
        }),
        errors: GOOGLE_SECOPS_DOOR,
        provider: "google-secops",
        scopes,
      });
    },
    nowIso: () => new Date().toISOString(),
    // Google revokes the whole (client, account) grant from the token alone, so a revoke through a shared
    // client would disconnect that client's other doors — refused on the same pair check.
    revoke: async ({ home }) => {
      const pair = secopsClientPairIn({ home });
      if (pair.isErr()) {
        return err(pair.error);
      }
      return revokeThroughSecopsClient({ home });
    },
    persist: persistSecopsGrant,
    status: ({ home }) =>
      googleSecopsGrantStore
        .read({ home })
        .map((grant) => (grant === undefined ? undefined : googleSecopsGrantStore.status({ grant, home }))),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * Run the `atlas google-secops connect` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 * @internal
 */
export async function runGoogleSecopsConnect(argv: readonly string[]): Promise<number> {
  return runGoogleConnect({
    deps: productionGoogleSecopsConnectDeps(),
    door: GOOGLE_SECOPS_DOOR,
    parse: (args) => parseGoogleSecopsConnectArgs(args),
    rest: verbTail({ argv, at: GOOGLE_SECOPS_VERB_INDEX, verbs: ["connect"] }),
  });
}

/** `slopweaver atlas google-secops connect`. */
export const googleSecopsConnectCommand = defineCommand({ run: runGoogleSecopsConnect });
