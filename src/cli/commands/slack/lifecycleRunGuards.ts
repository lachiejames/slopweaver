/**
 * The ownership and form-parsing guards shared across the BOT-CARD lane's verbs — `slack edit` and `slack
 * delete` (`./lifecycleRunEdit.ts`, `./lifecycleRunDelete.ts`) both mutate or replace a card, and both have
 * to answer the same two questions first: "does this form parse into a postable artifact" and "did
 * slopweaver actually post the message being touched". Split into its own leaf so those verb files can share
 * the answers without importing EACH OTHER.
 */
import { randomUUID } from "node:crypto";

import { recordPreDoorRefusal } from "../../../admit/ledger.js";
import type { PostedMessage, SlackWriteTransport } from "../../../corpus/slack/writeTransport.js";
import { logger } from "../../../lib/logger.js";
import { err, type Result } from "../../../lib/result.js";
import { updateArtifactAboveFoldCells, updateArtifactBelowFoldCells } from "../../../outbound/artifact/aboveFold.js";
import { FINDING_KIND } from "../../../outbound/artifact/finding.js";
import { addressedGroupsOfCard, mentionedPeopleOfCard } from "../../../outbound/artifact/runs.js";
import type { UpdateArtifact } from "../../../outbound/artifact/types.js";
import type { AnswerFormAnswer } from "../../../outbound/assistant/answerForm.js";
import { slackDeliveryErrorLines } from "../../../outbound/slack/deliveryErrors.js";
import { messageOwnership, ownershipRefusal, type ReadSlackMessage } from "../../../outbound/slack/lifecycleGuards.js";
import type { MentionResolution } from "../../../outbound/slack/mentionIndex.js";
import type { SlackCardChrome } from "../../../outbound/slack/types.js";
import { DEFAULT_CARD_METADATA_EVENT_TYPE } from "../../../profile.js";
import { aboveFoldRefusalRow, aboveFoldVerdictFor, voiceWarningLines } from "../../aboveFoldDoor.js";
import { linkedCardOrRefusals } from "../../citedControlsDoor.js";
import { unresolvedOwnerRefusal, unresolvedOwnerWarnings } from "./core.js";
import { admittedMentions, knownPeopleVia, parseSlackFormKnowingOwners } from "./coreForm.js";
import { addressedGroupsOf, mentionedPeopleOf } from "./lifecycleArtifacts.js";
import { cardEventTypes } from "./lifecycleCore.js";
import { type SlackLifecycle, SlackLifecycleErrors } from "./lifecycleErrors.js";
import type { LifecycleDeps } from "./lifecycleRunTypes.js";

/**
 * The card metadata event types an edit or delete accepts. See `lifecycleCore.cardEventTypes`.
 *
 * @param chrome the operator's configured card chrome
 * @returns the accepted event types
 */
export function acceptedCardEventTypes({ chrome }: { chrome: SlackCardChrome }): readonly string[] {
  return cardEventTypes({
    configuredEventType: chrome.metadataEventType,
    stockEventType: DEFAULT_CARD_METADATA_EVENT_TYPE,
  });
}

/**
 * Run the voice gate over one card, report its advisory half, and return whatever it refuses.
 *
 * Split out to keep {@link cardFromForm} under the line cap, and the seam is real: everything here is the
 * voice judgement, and its two halves have different consequences. The warnings go to `logger.warn`, the
 * SAME channel the unresolved-owner warnings use — this lane returns a `Result` rather than printing, so
 * reading only `refusals` sent every voice warning on the bot's own card lane to nobody. Measured
 * 2026, and the reason `voiceWarningLines` is exported at all.
 *
 * @param card the card about to be republished
 * @param deps the injected world, for the door's own environment
 * @param home the state home holding the operator's private voice rules
 * @param dryRun whether this invocation stops before every effect, so a refusal it reports leaves no ledger row
 * @returns every refusal, or none
 */
async function voiceRefusals({
  card,
  deps,
  home,
  dryRun,
}: {
  card: UpdateArtifact;
  deps: LifecycleDeps;
  home: string;
  dryRun: boolean;
}): Promise<readonly string[]> {
  const read = aboveFoldVerdictFor({
    belowFoldCells: updateArtifactBelowFoldCells({ artifact: card }),
    cells: updateArtifactAboveFoldCells({ artifact: card }),
    env: ({ name }) => deps.doorEnv()[name],
    home,
    // A bot card is posted to a CHANNEL; the register's `slack-dm` cohort is a much shorter population.
    surface: "slack",
  });
  if (read.isErr()) {
    // A corrupt profile is a fact about the install, not a rule that fired, so it leaves no refusal row.
    return [read.error.message];
  }
  const verdict = read.value;
  for (const warning of voiceWarningLines({ verdict })) {
    logger.warn({ msg: warning });
  }
  // This lane returns rather than prints, so it cannot reach `printedAboveFoldRefusals` — the one seam that
  // writes the door ledger's refusal row for every surface that DOES print. It and `./runAdmit.ts` are the
  // only two such sites; `src/admit/ledger.ts` carries why the row exists. A dry run writes nothing: this
  // gate runs before each caller's own `--dry-run` branch, and a dry run never tried to send.
  if (!dryRun) {
    const row = aboveFoldRefusalRow({ runId: randomUUID(), tsIso: new Date().toISOString(), verdict });
    if (row !== undefined) {
      await recordPreDoorRefusal({ home, ledger: deps.doorLedger, refusal: row });
    }
  }
  return verdict.refusals;
}

/** Why `edit` and `progress finish` refuse a `finding` form, and the post-then-delete route that replaces it. */
const FINDING_EDIT_REFUSAL =
  "a `finding` form is posted, never edited in: its screenshot floor and its place in the owning team's channel " +
  "are checked at `slack post`, and an edit can add no media. Park the corrected finding with `slopweaver slack " +
  'draft record --as bot --channel <owning team channel> --form - --why "<…>" --media a,b,c`, and once they ' +
  "approves it and it lands, remove the old one with `slopweaver slack delete`.";

/**
 * Parse a form into a card, resolving a digest's owner ping first and warning about any that degraded.
 *
 * Shared by `edit` and `progress finish` because both accept the same `--form`, and a digest edited through one
 * must degrade its owner ping exactly as a digest posted through the other does. Two copies of this drifted
 * within one change, which is the argument for it being a function.
 *
 * **A `no-fold` form is REFUSED here, and the refusal is the honest answer rather than a gap left open.**
 * Both callers re-render into the CARD shape — the attachment wrapper included — so accepting one would
 * take a message whose whole contract is that it cannot fold and republish it wrapped in the one thing
 * measured to make a message fold, silently. Editing a no-fold message is a real thing to want and it needs
 * its own path through `chat.update` with no wrapper; until that exists, this says so.
 *
 * @param json the raw form text
 * @param home the state home holding the rosters
 * @param allowUnresolvedOwner post anyway when an owner ping cannot resolve
 * @param deps the injected world
 * @param dryRun whether this invocation stops before every effect
 * @returns the card, or every violation
 */
export async function cardFromForm({
  json,
  home,
  allowUnresolvedOwner,
  deps,
  dryRun,
}: {
  json: string;
  home: string;
  allowUnresolvedOwner: boolean;
  deps: LifecycleDeps;
  dryRun: boolean;
}): Promise<SlackLifecycle<UpdateArtifact>> {
  const parsed = await parseSlackFormKnowingOwners({
    json,
    knownPeople: ({ people }) => knownPeopleVia({ home, people, resolveMentions: deps.resolveMentions }),
  });
  if (parsed.isErr()) {
    return err(SlackLifecycleErrors.upstreamRefused({ reasons: slackDeliveryErrorLines({ error: parsed.error }) }));
  }
  if (parsed.value.artifact.kind === "no-fold") {
    return err(SlackLifecycleErrors.noFoldEditRefused());
  }
  // A finding's three screenshots and its top-level place in a team channel are checked at `slack post`, and an edit
  // can re-check neither: it cannot add media, and a progress card is not a finding. So it is re-posted instead.
  if (parsed.value.formKind === FINDING_KIND) {
    return err(SlackLifecycleErrors.upstreamRefused({ reasons: [FINDING_EDIT_REFUSAL] }));
  }
  // Same refusal as the post path — an edit that silently drops a ping is the same defect, re-rendered.
  if (!allowUnresolvedOwner) {
    const refusal = unresolvedOwnerRefusal({ unresolvedOwners: parsed.value.unresolvedOwners });
    if (refusal.length > 0) {
      return err(SlackLifecycleErrors.upstreamRefused({ reasons: refusal }));
    }
  }
  for (const warning of unresolvedOwnerWarnings({ unresolvedOwners: parsed.value.unresolvedOwners })) {
    logger.warn({ msg: warning });
  }
  const card = parsed.value.artifact;
  const voice = await voiceRefusals({ card, deps, dryRun, home });
  if (voice.length > 0) {
    return err(SlackLifecycleErrors.upstreamRefused({ reasons: voice }));
  }
  // Both reference rules, exactly as the post path runs them — for the same reason an unresolved-owner
  // refusal is repeated here: a card EDITED into a bare ref or an uncited control reaches the reader exactly
  // as one posted that way does. See ../../citedControlsDoor.ts.
  return linkedCardOrRefusals({
    artifact: card,
    context: deps.bareRefContext({ home }),
    env: deps.doorEnv(),
    home,
    nowIso: new Date().toISOString(),
  }).mapErr((reasons) => SlackLifecycleErrors.upstreamRefused({ reasons }));
}

/**
 * Resolve every person the artifact mentions, or refuse the whole operation.
 *
 * `renderUpdateCard` throws `UnresolvedMentionError` on a mention it cannot resolve, so this runs BEFORE
 * rendering and turns that crash into a usage error naming exactly who could not be found. Exact match
 * only, as everywhere else — mentioning the wrong colleague is worse than refusing.
 *
 * @param artifact the card about to be posted or re-rendered
 * @param deps the injected world
 * @param home the state home holding the rosters
 * @returns every mention resolved, or every refusal — the roster store's own among them
 */
export async function resolveArtifactMentions({
  artifact,
  deps,
  home,
}: {
  artifact: UpdateArtifact;
  deps: LifecycleDeps;
  home: string;
}): Promise<Result<MentionResolution>> {
  return admittedMentions({
    groups: addressedGroupsOf({ artifact }),
    home,
    people: mentionedPeopleOf({ artifact }),
    resolveMentions: deps.resolveMentions,
  });
}

/**
 * Read a message back and refuse unless slopweaver posted it.
 *
 * @param transport the write transport to read the message back through
 * @param posted the channel/ts the caller intends to mutate
 * @param expectedEventTypes the metadata event types this verb accepts as "ours"
 * @returns the message, if slopweaver owns it — `undefined` otherwise, having already logged why
 */
export async function requireOwnership({
  transport,
  posted,
  expectedEventTypes,
}: {
  transport: SlackWriteTransport;
  posted: PostedMessage;
  expectedEventTypes: readonly string[];
}): Promise<ReadSlackMessage | undefined> {
  const message = await transport.readMessage({ posted });
  if (message === undefined) {
    logger.error({
      msg:
        `no message at ${posted.ts} in ${posted.channel} — refusing to act on a target that is not there. ` +
        "A history read anchored at a missing ts returns the NEAREST message, so this is checked rather than assumed",
    });
    return undefined;
  }
  const verdict = messageOwnership({ expectedEventTypes, message, self: await transport.whoAmI() });
  if (verdict.kind !== "owned") {
    logger.error({ msg: ownershipRefusal({ ts: posted.ts, verdict }) });
    return undefined;
  }
  return message;
}

/**
 * Resolve every person and group an ANSWER form's two regions address, or refuse the whole operation.
 *
 * The same contract as {@link resolveArtifactMentions}, over the answer form's field names rather than the
 * update card's: an answer keeps its below-fold blocks in `body` where a card keeps them in `detail`, and
 * the run shapes inside both are identical. It is a second entry point rather than a widened first one
 * because the two artifacts are different types, and coercing one into the other at a call site is how a
 * field that is genuinely absent starts reading as an empty one.
 *
 * @param answer the answer form about to be re-rendered
 * @param deps the injected world
 * @param home the state home holding the rosters
 * @returns every mention resolved, or every refusal — the roster store's own among them
 */
export async function resolveAnswerMentions({
  answer,
  deps,
  home,
}: {
  answer: AnswerFormAnswer;
  deps: LifecycleDeps;
  home: string;
}): Promise<Result<MentionResolution>> {
  return admittedMentions({
    groups: addressedGroupsOfCard({ detail: answer.body, index: answer.index }),
    home,
    people: mentionedPeopleOfCard({ detail: answer.body, index: answer.index }),
    resolveMentions: deps.resolveMentions,
  });
}
