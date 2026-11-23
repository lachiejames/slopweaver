/**
 * Codex's draft, admitted the way the original was: prepared, gated and digested over the original's destination, so a
 * pick of it is a row a release can re-prepare and an approval can bind (`../../../outbound/slack/draftComparison.ts`).
 *
 * Four differences from the original's recording, each deliberate:
 *
 * - **their voice rules refuse outright.** The original may park with a voice finding as advisory and meet the door at
 *   send; a candidate that breaks a rule they set is recorded as refused, so the card says so instead of offering it.
 * - **Nothing is written to their voice pain-point ledger.** That ledger is a record of their composer's misses; Codex's
 *   would pollute it, so the preparation is handed a recorder that records nothing, and no hatch reads the session's
 *   environment (`env: {}`).
 * - **The register and destination holds are not re-run.** The re-cut, same-thread and who-it-reaches checks judged the
 *   original's destination, which the candidate shares; the prior-ask declaration is inherited for the same reason.
 * - **A finding owes its proof.** A pick keeps the row's media and impact, so a candidate whose form raises a finding
 *   the row cannot prove is refused here (`../../../outbound/slack/candidateFindingProof.ts`).
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { candidateFindingProofMissing } from "../../../outbound/slack/candidateFindingProof.js";
import { slackDeliveryErrorLines } from "../../../outbound/slack/deliveryErrors.js";
import type { ComparisonRefusalStage, SlackDraftCandidate } from "../../../outbound/slack/draftComparison.js";
import { type ParkedSlackDraft, parkedDraftDigest } from "../../../outbound/slack/draftRegister.js";
import { findingProofRefusal } from "../../../outbound/slack/findingProof.js";
import { openingDeclaredMessage } from "./channelOpeningDeclared.js";
import type { SlackDripOptions } from "./coreTypes.js";
import { parkedMentions, placementOptions, recordedReviewer } from "./draftCompose.js";
import { earnedMessage, parkableMessage } from "./draftRecordMessage.js";
import { conversationInfoOnce, whoAmIOnce } from "./draftRecordReads.js";
import type { SlackDraftDeps } from "./draftRun.js";
import { untaggedNameHold } from "./draftUntaggedNames.js";
import { assessSlackDripSource } from "./dripSourceAssessment.js";
import { prepareDrip } from "./prepareDrip.js";
import { problemDeclaredMessage } from "./problemDeclared.js";

/** Why a candidate was not admitted: which gate, and what it said. */
export interface CandidateRefusal {
  readonly stage: ComparisonRefusalStage;
  readonly reasons: readonly string[];
}

/**
 * Admit Codex's form beside a parked original.
 *
 * @param deps the injected world — reads only, as the original's recording
 * @param draft the parked original, whose destination, identity and prior-ask the candidate shares
 * @param form Codex's drip form JSON
 * @param home the state home the original was recorded under
 * @param token their user token, for the reads the gates make
 * @returns the candidate, or which gate refused it and why
 */
export async function admitCandidate({
  deps,
  draft,
  form,
  home,
  token,
}: {
  deps: SlackDraftDeps;
  draft: ParkedSlackDraft;
  form: string;
  home: string;
  token: string;
}): Promise<Result<SlackDraftCandidate, CandidateRefusal>> {
  const config = deps.dripConfig({ home });
  if (config.isErr()) {
    return err({ reasons: [config.error.message], stage: "admission" });
  }
  const source = { json: form, kind: "form" } as const;
  const assessed = assessSlackDripSource({ allowVoiceRules: false, config: config.value, source });
  if (assessed.voiceRuleFindings.length > 0) {
    return err({ reasons: assessed.advisory, stage: "voice-rules" });
  }
  if (assessed.parsed.isErr()) {
    return err({ reasons: slackDeliveryErrorLines({ error: assessed.parsed.error }), stage: "admission" });
  }
  const readInfo = conversationInfoOnce({ channel: draft.channel, deps, token });
  const prepared = await prepareDrip({
    config: config.value,
    deps: {
      ...deps,
      conversationSurface: async () => (await readInfo()).surface,
      recordVoicePainPoints: () => {},
    },
    env: {},
    options: candidateOptions({ draft, form, home }),
    token,
  });
  const message = prepared
    .andThen((value) => parkableMessage({ prepared: value }))
    .andThen((value) => earnedMessage({ hatchIsOpen: false, message: value }))
    .andThen((value) => problemDeclaredMessage({ message: value }))
    .andThen((value) => openingDeclaredMessage({ channel: draft.channel, message: value, threadTs: draft.threadTs }));
  if (message.isErr()) {
    return err({ reasons: message.error, stage: "admission" });
  }
  const readSelf = whoAmIOnce({ deps, token });
  const untagged = await untaggedNameHold({ deps, home, message: message.value, readInfo, readSelf });
  if (untagged.length > 0) {
    return err({ reasons: untagged, stage: "admission" });
  }
  const { payload, prepared: admitted } = message.value;
  const missing = candidateFindingProofMissing({ candidate: { form: message.value.form, payload }, draft });
  if (missing.length > 0) {
    return err({ reasons: findingProofRefusal({ missing }), stage: "admission" });
  }
  const mentions = parkedMentions({ resolution: admitted.resolution });
  const { authorId, channel, groupDm, priorAsk, threadTs } = draft;
  const digest = parkedDraftDigest({ draft: { authorId, channel, groupDm, mentions, payload, priorAsk, threadTs } });
  return ok({ advisory: admitted.advisory, digest, form: message.value.form, mentions, payload });
}

/**
 * The as-me send a candidate is prepared as: the original's destination and placement, its form, no media, and the
 * reviewer its recording declared — `undeclared` when it declared none, exactly what that recording handed the gate.
 */
function candidateOptions({
  draft,
  form,
  home,
}: {
  draft: ParkedSlackDraft;
  form: string;
  home: string;
}): SlackDripOptions {
  return {
    actor: "me",
    channel: draft.channel,
    dryRun: false,
    home,
    json: false,
    media: [],
    resendUnconfirmed: false,
    reviewer: recordedReviewer({ reviewer: draft.reviewer }),
    source: { json: form, kind: "form" },
    ...placementOptions({ threadTs: draft.threadTs }),
  };
}
