/**
 * `slack edit --as bot` over a turn CHECKLIST — re-render the working card from a `kind: "checklist"` form.
 *
 * Its own path for the reason the answer edit is (`./lifecycleRunEdit.ts`'s `runEditAnswerCard`): a checklist
 * is not a card. It is rendered by `turnFrame` (`../../../live/turn/posterFrame.ts`), the ONE renderer every
 * post, advance and finalise of the card goes through, and sent with `updateTurn`, whose high-stakes guard
 * refuses to rewrite a top-level message in a high-stakes channel as a turn frame. Routing it through the card
 * renderer would replace the checklist with a different message shape under the same `ts`.
 *
 * **The turn id is INHERITED, never supplied.** It correlates the message with its turn, so a re-render reads it
 * back off the message's own metadata; a caller-supplied one would re-point the card at another turn, and the
 * next `turn status` of the real turn would no longer recognise its own checklist.
 */
import { throughDoor } from "../../../admit/effects.js";
import type { VoiceGateInput } from "../../../admit/voiceProfileGate.js";
import type { PostedMessage, SlackWriteTransport } from "../../../corpus/slack/writeTransport.js";
import { turnFrame } from "../../../live/turn/posterFrame.js";
import {
  CHECKLIST_EDIT_KIND,
  type ChecklistEditForm,
  checklistProse,
} from "../../../outbound/assistant/checklistEditForm.js";
import { SLACK_TURN_RENDERER } from "../../../outbound/assistant/turnMessage.js";
import type { SlackTurnPayload } from "../../../outbound/slack/types.js";
import { EXIT_OK } from "../../exitCodes.js";
import { type EditCardOptions, lifecycleDoorRequest } from "./lifecycleCore.js";
import { SlackEditTargetErrors } from "./lifecycleEditErrors.js";
import { cardEditTargetRefusals } from "./lifecycleEditTarget.js";
import { requireEditTarget } from "./lifecycleEventTypes.js";
import { editVoice, gatesFor, reportNotPerformed, usage } from "./lifecycleRunShared.js";
import type { LifecycleDeps } from "./lifecycleRunTypes.js";
import { unreadableProfileExit } from "./voiceAdmission.js";
import { turnChromeFrom } from "./wiring.js";

/**
 * Re-render a turn checklist in place from a validated `kind: "checklist"` form.
 *
 * @param form the validated checklist form
 * @param options the parsed invocation
 * @param deps the injected world
 * @returns the process exit code
 */
export async function runEditChecklist({
  form,
  options,
  deps,
}: {
  form: ChecklistEditForm;
  options: EditCardOptions;
  deps: LifecycleDeps;
}): Promise<number> {
  const token = deps.botToken({ home: options.home });
  if (token === undefined) {
    return usage({ errors: ["slack edit needs a Slack bot token: run `slopweaver secrets set slack-bot-token`"] });
  }
  const voice = editVoice({ deps, home: options.home, prose: checklistProse({ form }) });
  if (voice.isErr()) {
    return unreadableProfileExit({ error: voice.error, nothingHappened: "nothing was changed." });
  }
  const transport = deps.makeTransport({ home: options.home, token });
  const posted: PostedMessage = { channel: options.channel, ts: options.ts };
  const target = await requireEditTarget({ deps, formKind: "checklist", home: options.home, posted, transport });
  if ("exit" in target) {
    return target.exit;
  }
  const existing = target.message;
  const { turnId } = existing;
  if (existing.renderer !== SLACK_TURN_RENDERER || turnId === undefined) {
    const at = `${options.channel}/${options.ts}`;
    return usage({
      errors: [SlackEditTargetErrors.inheritedIdMissing({ at, field: "turnId", owner: "turn" }).message],
    });
  }
  // `updateTurn`'s own guard refuses a high-stakes rewrite too; asked here as well so a dry run reports it.
  const targetRefusals = cardEditTargetRefusals({ deps, existing, formKind: CHECKLIST_EDIT_KIND, options });
  if (targetRefusals.length > 0) {
    return usage({ errors: targetRefusals });
  }
  const payload = turnFrame({
    names: deps.cardNames({ home: options.home }),
    now: deps.nowMs,
    provenance: { modelId: form.modelId },
    steps: form.steps,
    task: form.task,
    turnChrome: turnChromeFrom({ chrome: deps.cardChrome({ home: options.home }) }),
    turnId,
  });
  if (options.dryRun) {
    for (const line of [
      `dry run — nothing was changed. would chat.update ${options.channel}/${options.ts} as a CHECKLIST`,
      `  steps: ${String(form.steps.length)}, turn id inherited: ${turnId}`,
    ]) {
      deps.out(line);
    }
    return EXIT_OK;
  }
  return performChecklistEdit({ deps, options, payload, posted, transport, voice: voice.value });
}

/** Put the re-rendered checklist through the door and report what happened. */
async function performChecklistEdit({
  deps,
  options,
  payload,
  posted,
  transport,
  voice,
}: {
  deps: LifecycleDeps;
  options: EditCardOptions;
  payload: SlackTurnPayload;
  posted: PostedMessage;
  transport: SlackWriteTransport;
  voice: VoiceGateInput;
}): Promise<number> {
  const routed = await throughDoor({
    gates: gatesFor({ voice }),
    ledger: deps.doorLedger,
    perform: async () => transport.updateTurn({ payload, posted }),
    request: lifecycleDoorRequest({
      blockCount: payload.attachments[0].blocks.length,
      options,
      targetTs: options.ts,
    }),
  });
  if (!routed.performed) {
    return reportNotPerformed({ through: routed });
  }
  deps.out(`edited — channel=${options.channel} ts=${options.ts} as a checklist`);
  return EXIT_OK;
}
