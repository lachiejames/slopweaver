/**
 * The production edges behind `gmail draft` and `gmail send`: the grant-aware plan and apply calls, the
 * form's parse-and-validate gauntlet, stdin and the output sinks. The shells that drive them are
 * `./composeRun.ts`; this file is only the wiring they are handed.
 */
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { hatchOpen } from "../../../hatch/open.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { readStdin } from "../../../lib/readStdin.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type GmailApi, makeGmailApi } from "../../../live/gmail/api.js";
import { resolveGmailClient } from "../../../live/gmail/client.js";
import { type GmailComposeForm, validateComposeForm } from "../../../live/gmail/compose.js";
import { type GmailError, GmailErrors } from "../../../live/gmail/errors.js";
import { applyGmailDraft, applyGmailSend, planGmailDraft, planGmailSend } from "../../../live/gmail/outbox.js";
import type { GmailCapability } from "../../../live/gmail/scopes.js";
import { pidAlive } from "../../../live/listen/supervise/currentLiveness.js";
import { parseGmailComposeForm } from "../../../outbound/gmail/form.js";

import type { GmailComposeDeps } from "./composeRun.js";

/**
 * The production compose seams.
 *
 * `planDraft` needs `compose`, and so does `applyDraft` — writing a draft is what that scope is for.
 * `planSend` needs only `compose` to READ the draft back, while `applySend` is the one call that asks for
 * `send`. That split is not a technicality: a `--grant full` install that has not yet decided to trust the
 * send path can still compose, review and digest a message, and the credential itself is what stops the
 * last step rather than a code path anyone could edit.
 *
 * @returns the grant-aware plan/apply edges, the stdin reader and the output sinks
 */
export function productionGmailComposeDeps(): GmailComposeDeps {
  return {
    applyDraft: async ({ home, plan, once }) => {
      const bound = boundApi({ capability: "compose", home });
      return bound.isErr() ? err(bound.error) : applyGmailDraft({ api: bound.value.api, once, plan });
    },
    applySend: async ({ home, plan }) => {
      const bound = boundApi({ capability: "send", home });
      return bound.isErr() ? err(bound.error) : applyGmailSend({ api: bound.value.api, plan });
    },
    doorLedger: doorLedgerPort(),
    home: slopweaverHome,
    pidAlive,
    planDraft: async ({ home, formJson, replyToId }) => {
      const form = readComposeForm({ json: formJson });
      if (form.isErr()) {
        return err(form.error);
      }
      const bound = boundApi({ capability: "compose", home });
      if (bound.isErr()) {
        return err(bound.error);
      }
      // The `redundant-quote` hatch: a journalled grant this session took with `slopweaver hatch open`.
      // Read only for a reply, the one draft the gate judges, so a new draft touches no grant journal at all.
      const allowRedundantQuote =
        replyToId !== undefined &&
        hatchOpen({
          env: process.env,
          id: "redundant-quote",
          home,
          nowIso: new Date().toISOString(),
        });
      return planGmailDraft({ ...bound.value, allowRedundantQuote, form: form.value, replyToId });
    },
    planSend: async ({ home, draftId }) => {
      const bound = boundApi({ capability: "compose", home });
      return bound.isErr() ? err(bound.error) : planGmailSend({ ...bound.value, draftId });
    },
    readStdin,
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * Parse and validate a compose form, folding both refusals into the one typed error the seam returns.
 *
 * Pure, and the whole of the form's gauntlet: the JSON shape check that refuses an unrecognised key, then
 * the semantic check that refuses an undeliverable address, a header-injecting subject or a body hard-wrapped
 * inside a paragraph. Extracted from
 * the seam it serves so the seam stays a wiring function and this stays testable without a mailbox.
 *
 * @param json the form text, exactly as it arrived on stdin or in the flag
 * @returns the validated form, or the typed reason it was refused
 */
export function readComposeForm({ json }: { json: string }): Result<GmailComposeForm, GmailError> {
  const parsed = parseGmailComposeForm({ json });
  if (parsed.isErr()) {
    return err(GmailErrors.composeFormRefused({ problems: parsed.error }));
  }
  const validated = validateComposeForm({ form: parsed.value });
  return validated.isErr() ? err(GmailErrors.composeFormRefused({ problems: validated.error })) : ok(validated.value);
}

/** The Gmail seam bound to this home's grant for one capability, with the account the grant belongs to. */
function boundApi({
  home,
  capability,
}: {
  home: string;
  capability: GmailCapability;
}): Result<{ account: string; api: GmailApi }, GmailError> {
  return resolveGmailClient({ capabilities: [capability], home }).map((bound) => ({
    account: bound.account,
    api: makeGmailApi({ account: bound.account, client: bound.client }),
  }));
}
