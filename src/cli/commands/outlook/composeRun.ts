/**
 * The effectful shells for the two `outlook` verbs that produce outbound mail — `draft` and `send` — kept two
 * verbs for the reason Gmail's are (`gmail/composeRun.ts`): a send is always a send of something already written
 * down, read back from the server and printed in full.
 *
 * `draft` routes its create through the door as an ordinary external write with no gate; it changes only the
 * owner's own mailbox. `send` routes through the door carrying the shared mail approval gate, which HOLDS unless
 * `--approve` carries the digest of the draft as Outlook holds it now. A hold is not waivable by
 * `$SLOPWEAVER_DOOR_OVERRIDE`, and a refused send is still a ledger row: an attempt to reach another person is a
 * fact worth keeping.
 */
import { err, ok, type Result } from "#lib/result.js";
import { DEFAULT_GATES } from "../../../admit/door.js";
import { type NotPerformed, notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import type { DraftPayload } from "../../../live/outlook/apiCore.js";
import { draftPayload, readOutlookSendPlan, storeOutlookDraft } from "../../../live/outlook/drafts.js";
import {
  renderOutlookDraftOutcomeText,
  renderOutlookSendPlanText,
  renderOutlookSentText,
} from "../../../live/outlook/render.js";
import { mailSendApprovalGate } from "../../../outbound/mail/approvalGate.js";
import { type MailComposeForm, parseMailComposeForm } from "../../../outbound/mail/form.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { jsonOut, type OutlookShellDeps, productionOutlookShellDeps, refuseUsage, shellHome } from "./shell.js";
import { OUTLOOK_STDIN_SENTINEL, parseOutlookDraftArgs, parseOutlookSendArgs } from "./writeCore.js";

const VERB_ARG_OFFSET = 4;

/** The door's finding code for an Outlook send that carries no matching approval. */
export const OUTLOOK_SEND_UNAPPROVED_CODE = "outlook.send-unapproved";

/** Print a door refusal in the one shape every refusal here carries. */
function reportRefusal({
  command,
  deps,
  through,
}: {
  command: string;
  deps: OutlookShellDeps;
  through: NotPerformed;
}): number {
  for (const line of notPerformedLines({ command, through })) {
    deps.warn(line);
  }
  return EXIT_ERROR;
}

/** Read the compose form from its flag or stdin, and validate it into the payload Graph takes. */
async function readDraftForm({
  deps,
  formSource,
}: {
  deps: OutlookShellDeps;
  formSource: string;
}): Promise<Result<{ form: MailComposeForm; payload: DraftPayload }>> {
  const json = formSource === OUTLOOK_STDIN_SENTINEL ? await deps.readStdin() : formSource;
  const form = parseMailComposeForm({ json });
  if (form.isErr()) {
    return err(form.error);
  }
  const payload = draftPayload({ form: form.value });
  if (payload.isErr()) {
    return err([payload.error.message]);
  }
  return ok({ form: form.value, payload: payload.value });
}

/**
 * Run `outlook draft`: read and validate the form, stop on `--dry-run`, else store it through the door.
 *
 * @param rest argv after `outlook draft`
 * @returns the process exit code
 */
export async function runOutlookDraft({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: OutlookShellDeps;
}): Promise<number> {
  const parsed = parseOutlookDraftArgs({ rest });
  if (parsed.isErr()) {
    return refuseUsage({ deps, error: parsed.error });
  }
  const args = parsed.value;
  const composed = await readDraftForm({ deps, formSource: args.formSource });
  if (composed.isErr()) {
    for (const line of composed.error) {
      deps.warn(line);
    }
    return EXIT_ERROR;
  }
  const { form, payload } = composed.value;
  const counts = { bcc: form.bcc.length, cc: form.cc.length, to: form.to.length };
  if (args.dryRun) {
    const text = `DRY RUN — the form is valid; nothing was stored (${String(counts.to)} to, ${String(counts.cc)} cc, ${String(counts.bcc)} bcc)`;
    deps.out(args.json ? jsonOut({ value: { ...counts, isReply: args.replyTo !== undefined, stored: false } }) : text);
    return EXIT_OK;
  }
  const home = shellHome({ deps, named: args.home });
  const session = await deps.session({ home, verb: "draft" });
  if (session.isErr()) {
    deps.warn(session.error.message);
    return EXIT_ERROR;
  }
  const { api } = session.value;
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => storeOutlookDraft({ api, payload, replyTo: args.replyTo }),
    request: {
      action: { kind: "verb", noun: "outlook", verb: "draft" },
      artifact: { ...counts, isReply: args.replyTo !== undefined, subjectLength: form.subject.length },
      meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
    },
  });
  if (!routed.performed) {
    return reportRefusal({ command: "slopweaver outlook draft", deps, through: routed });
  }
  if (routed.result.isErr()) {
    deps.warn(routed.result.error.message);
    return EXIT_ERROR;
  }
  const outcome = routed.result.value;
  deps.out(args.json ? jsonOut({ value: { outcome, stored: true } }) : renderOutlookDraftOutcomeText({ outcome }));
  return EXIT_OK;
}

/**
 * Run `outlook send`. The preview prints BEFORE the door decides and on every path: a caller about to be refused
 * needs to see what they would have sent at least as much as one about to succeed.
 *
 * @param rest argv after `outlook send`
 * @returns the process exit code
 */
export async function runOutlookSend({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: OutlookShellDeps;
}): Promise<number> {
  const parsed = parseOutlookSendArgs({ rest });
  if (parsed.isErr()) {
    return refuseUsage({ deps, error: parsed.error });
  }
  const args = parsed.value;
  const home = shellHome({ deps, named: args.home });
  const session = await deps.session({ home, verb: "send" });
  if (session.isErr()) {
    deps.warn(session.error.message);
    return EXIT_ERROR;
  }
  const { api, account } = session.value;
  const planned = await readOutlookSendPlan({ account, api, id: args.draftId });
  if (planned.isErr()) {
    deps.warn(planned.error.message);
    return EXIT_ERROR;
  }
  const plan = planned.value;
  if (!args.json) {
    deps.out(renderOutlookSendPlanText({ plan }));
  }
  const routed = await throughDoor({
    gates: [
      mailSendApprovalGate({ code: OUTLOOK_SEND_UNAPPROVED_CODE, expected: plan.digest, supplied: args.approve }),
    ],
    home,
    ledger: deps.doorLedger,
    perform: () => api.sendDraft({ id: plan.draftId }),
    request: {
      action: { kind: "verb", noun: "outlook", verb: "send" },
      artifact: { bcc: plan.bcc.length, cc: plan.cc.length, digest: plan.digest, to: plan.to.length },
      meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: true },
    },
  });
  if (!routed.performed) {
    if (args.json) {
      // A recording refusal is not a policy verdict (the door may even have said `pass`), so the store's own
      // message rides beside the decision rather than the refusal being relabelled as a hold.
      const recording = routed.kind === "recording-refused" ? { error: routed.error.message } : {};
      deps.out(jsonOut({ value: { decision: routed.decision, ...recording, plan, sent: false } }));
    }
    return reportRefusal({ command: "slopweaver outlook send", deps, through: routed });
  }
  if (routed.result.isErr()) {
    deps.warn(routed.result.error.message);
    return EXIT_ERROR;
  }
  deps.out(args.json ? jsonOut({ value: { plan, sent: true } }) : renderOutlookSentText({ plan }));
  return EXIT_OK;
}

/** `slopweaver outlook draft`. */
export const outlookDraftCommand = defineCommand({
  run: (argv) => runOutlookDraft({ deps: productionOutlookShellDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver outlook send`. */
export const outlookSendCommand = defineCommand({
  run: (argv) => runOutlookSend({ deps: productionOutlookShellDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
