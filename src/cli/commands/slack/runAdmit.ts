/**
 * ADMISSION for `slopweaver slack post|reply --as bot` — everything a message must survive before a plan
 * becomes a send, and nothing about performing one.
 *
 * Split out of `./run.ts` when that file crossed `file-size-ratchet`'s 600-code-line cap, and the seam is a
 * real one rather than a place to cut: every function here answers "may this go out, and in what shape",
 * while everything left in `./run.ts` is the shell that performs it — argv, the door, the wire, the report.
 * A reviewer asking "what can stop a bot send" now has one file to read.
 *
 * The four checks, in the order a send meets them: parse the form and resolve a digest's owner ping
 * ({@link artifactFromForm}); judge the prose against the operator's own voice rules and refuse a bare
 * reference the door cannot resolve ({@link admitArtifact}); refuse a no-fold message that carries media or
 * whose RENDERED payload could fold ({@link noFoldRefusals}); and resolve every mention or refuse the whole
 * send ({@link resolveAllMentions}).
 */
import type { DoorAcknowledgement } from "../../../admit/types.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import {
  authoredCells,
  noFoldAboveFoldCells,
  updateArtifactAboveFoldCells,
  updateArtifactBelowFoldCells,
} from "../../../outbound/artifact/aboveFold.js";
import { linkifyNoFold } from "../../../outbound/artifact/bareRefRuns.js";
import {
  addressedGroupsOfCard,
  mentionedPeopleOfCard,
  mentionedPeopleOfNoFold,
} from "../../../outbound/artifact/runs.js";
import type { SlackBotArtifact } from "../../../outbound/artifact/types.js";
import { automationPromptChannelRefusal } from "../../../outbound/slack/automationPromptChannel.js";
import { type SlackDelivery, SlackDeliveryErrors } from "../../../outbound/slack/deliveryErrors.js";
import { ownerDmPurposeRefusal } from "../../../outbound/slack/dmPurpose.js";
import { findingDestinationRefusal } from "../../../outbound/slack/findingDestination.js";
import type { MentionResolution } from "../../../outbound/slack/mentionIndex.js";
import { noFoldPayloadIssues } from "../../../outbound/slack/noFold.js";
import { ownerDmAskRefusal } from "../../../outbound/slack/ownerDmAsk.js";
import { scheduledPostChannelRefusal } from "../../../outbound/slack/scheduledPostChannel.js";
import { aboveFoldVerdictFor } from "../../aboveFoldDoor.js";
import { bareRefVerdictFor } from "../../bareRefDoor.js";
import { cardPictureAcknowledgements } from "../../cardPictureDoor.js";
import { linkedCardOrRefusals } from "../../citedControlsDoor.js";
import { type SlackWritePlan, unresolvedOwnerRefusal, unresolvedOwnerWarnings } from "./core.js";
import { admittedMentions, knownPeopleVia, type ParsedFormOfKind, parseSlackFormKnowingOwners } from "./coreForm.js";
import type { SlackCardOptions } from "./coreTypes.js";
import type { SlackWriteDeps } from "./run.js";
import { voiceRefusalsOrWarned } from "./voiceAdmission.js";

/**
 * The reads admission makes — every one a roster, a profile field or the environment, none of them a send edge,
 * so `slack draft record --as bot` admits a card exactly as `slack post --as bot` does while holding none.
 */
export type CardAdmissionDeps = Pick<
  SlackWriteDeps,
  | "approvedScheduledChannels"
  | "bareRefContext"
  | "doorEnv"
  | "doorLedger"
  | "ownerUserId"
  | "promptChannel"
  | "resolveMentions"
>;

/**
 * An admitted send: the card that goes out, and which declared shape produced it.
 *
 * The kind is carried past admission because one door check needs it and the artifact cannot supply it — a
 * `automation-prompt` derives an ordinary no-fold message, so nothing in the bytes says they are the
 * bot's own instructions. See `../../../outbound/slack/automationPromptChannel.ts`.
 */
type AdmittedForm = { readonly artifact: SlackBotArtifact; readonly formKind: ParsedFormOfKind["formKind"] };

/**
 * An admitted card, plus what its send's door-ledger row records about the picture question, and the kind that
 * produced it — which the run lane's screenshot floor for a `finding` reads.
 */
export type AdmittedCard = {
  readonly artifact: SlackBotArtifact;
  readonly acknowledgements: readonly DoorAcknowledgement[];
  readonly formKind: ParsedFormOfKind["formKind"];
};

/**
 * Parse the form into a card, resolving a digest's owner ping first and warning about any that degraded.
 *
 * The owner is resolved BEFORE derivation because whether the person resolves decides whether the derivation
 * emits a mention run or visible plain text — it cannot be fixed up afterwards. Every OTHER mention is still
 * checked after this, by the caller's own pre-check, and still refuses the send.
 *
 * @param json the raw form text
 * @param home the state home holding the rosters
 * @param resolveMentions the injected roster lookup
 * @param bareRefContext what this write's bare references can resolve against
 * @param dryRun whether this invocation stops before every effect, so a refusal it prints leaves no ledger row
 * @param ledger the door ledger a voice refusal's row is recorded through
 * @returns the card and the form kind that produced it, or every violation
 */
async function artifactFromForm({
  json,
  home,
  allowUnresolvedOwner,
  resolveMentions,
  doorEnv,
  bareRefContext,
  dryRun,
  ledger,
}: {
  json: string;
  home: string;
  allowUnresolvedOwner: boolean;
  resolveMentions: SlackWriteDeps["resolveMentions"];
  doorEnv: SlackWriteDeps["doorEnv"];
  bareRefContext: SlackWriteDeps["bareRefContext"];
  dryRun: boolean;
  ledger: SlackWriteDeps["doorLedger"];
}): Promise<SlackDelivery<AdmittedForm>> {
  const parsed = await parseSlackFormKnowingOwners({
    json,
    knownPeople: ({ people }) => knownPeopleVia({ home, people, resolveMentions }),
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  // REFUSE by default: a degraded ping used to leave only a stderr warning and exit 0, so a card shipped
  // reading "<name> (unresolved)" while the person named was never notified. The break-glass keeps the old
  // behaviour available, but as a decision rather than a discovery.
  if (!allowUnresolvedOwner) {
    const refusal = unresolvedOwnerRefusal({ unresolvedOwners: parsed.value.unresolvedOwners });
    if (refusal.length > 0) {
      return err(SlackDeliveryErrors.upstreamRefused({ reasons: refusal }));
    }
  }
  for (const warning of unresolvedOwnerWarnings({ unresolvedOwners: parsed.value.unresolvedOwners })) {
    logger.warn({ msg: warning });
  }
  const admitted = await admitArtifact({
    artifact: parsed.value.artifact,
    bareRefContext,
    doorEnv,
    dryRun,
    home,
    ledger,
  });
  return admitted
    .map((artifact) => ({ artifact, formKind: parsed.value.formKind }))
    .mapErr((reasons) => SlackDeliveryErrors.upstreamRefused({ reasons }));
}

/**
 * The two door checks every bot artifact passes, applied to whichever form it is.
 *
 * Split out of {@link artifactFromForm} to keep that function under the line cap, and the seam is a real
 * one: everything above it is about the FORM (parse it, resolve its owner ping), and everything here is
 * about the two RULES an outbound message is judged by — the operator's own voice rules over the prose a
 * reader meets, and the ban on a bare reference reaching a surface unresolved.
 *
 * @param artifact the parsed bot artifact
 * @param home the state home holding the voice rules and the roster
 * @param doorEnv the injected environment the door itself reads
 * @param bareRefContext what this write's bare references can resolve against
 * @param dryRun whether this invocation stops before every effect
 * @param ledger the door ledger a voice refusal's row is recorded through
 * @returns the linkified artifact, or every refusal
 */
async function admitArtifact({
  artifact,
  home,
  doorEnv,
  bareRefContext,
  dryRun,
  ledger,
}: {
  artifact: SlackBotArtifact;
  home: string;
  doorEnv: SlackWriteDeps["doorEnv"];
  bareRefContext: SlackWriteDeps["bareRefContext"];
  dryRun: boolean;
  ledger: SlackWriteDeps["doorLedger"];
}): Promise<Result<SlackBotArtifact>> {
  const env = ({ name }: { name: string }): string | undefined => doorEnv()[name];
  if (artifact.kind === "no-fold") {
    // EVERY cell goes to the above-the-fold rules, because every cell IS above the fold. There is no
    // below-fold half to pass: `belowFoldCells` is empty by construction here, not by omission.
    const voice = aboveFoldVerdictFor({
      belowFoldCells: [],
      cells: noFoldAboveFoldCells({ artifact }),
      env,
      home,
      // A bot card is posted to a CHANNEL. The register also carries a `slack-dm` cohort measured on a
      // much shorter population, and judging a channel card against it would warn on almost every card.
      surface: "slack",
    });
    const voiceRefused = await voiceRefusalsOrWarned({ dryRun, home, ledger, read: voice });
    if (voiceRefused !== undefined) {
      return err(voiceRefused);
    }
    const linkedNoFold = linkifyNoFold({ artifact, context: bareRefContext({ home }) });
    const noFoldRefs = bareRefVerdictFor({ env, home, issues: linkedNoFold.issues });
    return noFoldRefs.refusals.length > 0 ? err(noFoldRefs.refusals) : ok(linkedNoFold.artifact);
  }
  const aboveFold = aboveFoldVerdictFor({
    belowFoldCells: updateArtifactBelowFoldCells({ artifact }),
    cells: updateArtifactAboveFoldCells({ artifact }),
    env,
    home,
    surface: "slack",
  });
  const voiceRefused = await voiceRefusalsOrWarned({ dryRun, home, ledger, read: aboveFold });
  if (voiceRefused !== undefined) {
    return err(voiceRefused);
  }
  // Both reference rules, in the one order that makes sense: resolve every #<n>/owner/repo#<n>/SUP-123 into
  // a real link, refuse whatever still can't resolve, then judge the LINKIFIED card's control mentions. See
  // ../../citedControlsDoor.ts.
  return linkedCardOrRefusals({
    artifact,
    context: bareRefContext({ home }),
    env: doorEnv(),
    home,
    nowIso: new Date().toISOString(),
  });
}

/**
 * Everything that disqualifies a NO-FOLD send, checked before a byte is uploaded or a reservation exists.
 *
 * Two checks, different in kind. The MEDIA one is about the invocation: media rides on a card through a
 * COMPOSITE send — post, then `chat.update` re-sending the `attachments` array with `file_ids` — and that
 * array is exactly the wrapper a no-fold message must never have. There is no field on
 * `SlackNoFoldPayload` to carry one and no `uploads` parameter on `sendNoFold`, so this is what the types
 * already say, said early enough to cost nothing.
 *
 * The PAYLOAD one runs the fold predicate over the RENDERED message rather than over the form, because the
 * form is not what Slack sees. On the ordinary path it finds nothing, and that IS the intended reading: the
 * payload type already makes both failures unrepresentable, so this is the runtime witness that the type is
 * still telling the truth on a tree that has moved since it was written. Both run before the door, so a
 * payload that could fold never reaches a reservation, let alone the wire.
 *
 * @param plan the fully-decided send
 * @param media the media paths the invocation asked for
 * @returns the refusal lines, or empty when there is nothing to refuse
 */
export function noFoldRefusals({ plan, media }: { plan: SlackWritePlan; media: readonly string[] }): readonly string[] {
  if (plan.kind !== "no-fold") {
    return [];
  }
  if (media.length > 0) {
    return [
      "a no-fold message cannot carry media: attaching a file re-sends the message with an `attachments` " +
        "wrapper, which is the one thing measured to make a Slack message fold. Nothing was uploaded.",
      'post the picture as its own `{"kind":"update"}` card, or link it from the no-fold message.',
    ];
  }
  const issues = noFoldPayloadIssues({ payload: plan.payload });
  return issues.length === 0 ? [] : [...issues, "nothing was sent."];
}

/**
 * Resolve every mentioned person, or refuse the whole send.
 *
 * An unresolvable person is FATAL rather than a dropped ping: a message that silently fails to notify
 * someone reads as delivered. Exact match only, so this never guesses at who was meant.
 *
 * @param artifact the validated bot artifact, of either form
 * @param deps the injected world, for the roster lookup
 * @param home the state home the rosters live under
 * @returns how every mention resolved, or every refusal — an unresolved person, a refused group, a roster
 *   too stale to trust, a store that could not say who anybody is
 */
export async function resolveAllMentions({
  artifact,
  deps,
  home,
}: {
  artifact: SlackBotArtifact;
  deps: CardAdmissionDeps;
  home: string;
}): Promise<Result<MentionResolution>> {
  // A no-fold message has no group run in its vocabulary at all, so `groups` is empty BY CONSTRUCTION here
  // rather than by this function forgetting to look — see `NoFoldInlineRun`.
  const people =
    artifact.kind === "no-fold"
      ? mentionedPeopleOfNoFold({ artifact })
      : mentionedPeopleOfCard({ detail: artifact.detail, index: artifact.index });
  const groups =
    artifact.kind === "no-fold" ? [] : addressedGroupsOfCard({ detail: artifact.detail, index: artifact.index });
  return admittedMentions({ groups, home, people, resolveMentions: deps.resolveMentions });
}

/**
 * The five destination refusals, in order: the first that refuses is the answer, and an empty list means all
 * five let the send through. So a send one of the scheduled-post holds refuses never reaches the DM-purpose one,
 * a finding is told where findings go before it is told what their DM carries, and a post to their DM that declares
 * no purpose is told that before it is told it asked them something.
 */
function firstDestinationRefusal({
  artifact,
  cardOptions,
  deps,
  formKind,
}: {
  artifact: SlackBotArtifact;
  cardOptions: SlackCardOptions;
  deps: CardAdmissionDeps;
  formKind: ParsedFormOfKind["formKind"];
}): readonly string[] {
  const { channel, home } = cardOptions;
  const promptChannel = deps.promptChannel({ home });
  const promptChannelErrors = automationPromptChannelRefusal({ channel, formKind, promptChannel });
  if (promptChannelErrors.length > 0) {
    return promptChannelErrors;
  }
  const scheduledPostErrors = scheduledPostChannelRefusal({
    approvedChannels: deps.approvedScheduledChannels({ home }),
    channel,
    idempotencyKey: cardOptions.idempotencyKey,
    promptChannel,
  });
  if (scheduledPostErrors.length > 0) {
    return scheduledPostErrors;
  }
  const ownerUserId = deps.ownerUserId({ home });
  // Owner rule: a finding goes to the channel and thread they approved on its card, never a DM.
  const findingErrors = findingDestinationRefusal({
    approvedDraft: cardOptions.approvedDraft === true,
    channel,
    formKind,
  });
  if (findingErrors.length > 0) {
    return findingErrors;
  }
  // Owner rule: their DM carries a finding, a dogfood case or a message they asked for, and nothing else.
  const purposeErrors = ownerDmPurposeRefusal({
    channel,
    dmPurpose: cardOptions.dmPurpose,
    ownerUserId,
    promptChannel,
  });
  if (purposeErrors.length > 0) {
    return purposeErrors;
  }
  // Owner rule: a question to them goes on the queue, never in that DM, whatever purpose it declared.
  return ownerDmAskRefusal({ cells: authoredCells({ artifact }), channel, formKind, ownerUserId, promptChannel });
}

/**
 * Admit the form, then refuse a send aimed somewhere owner ruling puts off limits for it.
 *
 * FIVE refusals, asked in the order the rulings landed, and all BEFORE mentions, the wall and the wire —
 * because each is decided on where the message is GOING, or on what it asks of the person it is going to.
 * None sits behind a caller-side `if`, because that is the branch that gets forgotten: each answers empty for
 * every send outside its own criterion, and the first that refuses ends the admission.
 *
 * - **the PROMPT**: an automation's question is the bot's own instructions, so it goes only to
 *   the configured private conversation.
 * - **the CARD**: a send carrying a recipe slot's delivery key came from a clock rather than from a
 *   person, so it goes to that same conversation unless they have approved the channel: the bot DM is where such a send lands, and sharing into a public
 *   channel is their call.
 * - **the FINDING**: a `finding` card is an approved top-level post in the owning team's channel,
 *   never a DM, one per issue (`../../../outbound/slack/findingDestination.ts`). Asked before the purpose hold,
 *   because it is the narrower of the two. The destination is whichever team channel is relevant.
 * - **the PURPOSE**: their DM carries a finding, a dogfood case or a message they asked for, so a
 *   send aimed at it declares which (`../../../outbound/slack/dmPurpose.ts`). A DM message that
 *   carries none of those is worth nothing to them.
 * - **the ASK**: a post to their DM whose own words ask them something is refused whatever purpose
 *   it declared, and pointed at the queue (`../../../outbound/slack/ownerDmAsk.ts`). A question
 *   to them belongs on the queue.
 *
 * None has a hatch, and every refusal says so.
 *
 * Then the picture question (`../../cardPictureDoor.ts`), last because it is about what
 * the card SHOWS rather than where it goes, and because its answer is recorded on the send's ledger row.
 *
 * @param formJson the raw form text, already read from stdin where the sentinel asked for it
 * @returns the admitted card and the acknowledgements its send records, or every violation to print
 */
export async function admittedCardOrRefusals({
  cardOptions,
  deps,
  formJson,
}: {
  cardOptions: SlackCardOptions;
  deps: CardAdmissionDeps;
  formJson: string;
}): Promise<SlackDelivery<AdmittedCard>> {
  const parsed = await artifactFromForm({
    allowUnresolvedOwner: cardOptions.allowUnresolvedOwner,
    bareRefContext: deps.bareRefContext,
    doorEnv: deps.doorEnv,
    dryRun: cardOptions.dryRun,
    home: cardOptions.home,
    json: formJson,
    ledger: deps.doorLedger,
    resolveMentions: deps.resolveMentions,
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { artifact, formKind } = parsed.value;
  const destinationErrors = firstDestinationRefusal({ artifact, cardOptions, deps, formKind });
  if (destinationErrors.length > 0) {
    return err(SlackDeliveryErrors.upstreamRefused({ reasons: destinationErrors }));
  }
  if (artifact.kind === "no-fold") {
    // A no-fold message carries no media by construction, so the picture question has nothing to ask about.
    return cardOptions.noPictureBecause === undefined
      ? ok({ acknowledgements: [], artifact, formKind })
      : err(SlackDeliveryErrors.noFoldPictureReasonRefused());
  }
  return cardPictureAcknowledgements({
    artifact,
    context: deps.bareRefContext({ home: cardOptions.home }),
    formKind,
    mediaCount: cardOptions.media.length,
    noPictureBecause: cardOptions.noPictureBecause,
    scheduled: cardOptions.idempotencyKey !== undefined,
  })
    .map((acknowledgements) => ({ acknowledgements, artifact, formKind }))
    .mapErr((reasons) => SlackDeliveryErrors.upstreamRefused({ reasons }));
}
