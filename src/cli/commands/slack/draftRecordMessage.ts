/**
 * The one message an as-me `slack draft record` parks, and the row it composes into — split out of
 * `./draftRecordRun.ts`, which keeps the reads and holds in between. Both halves are the recording's pure edges: what
 * the preparation produced is checked to be ONE typed message before any Slack read, and the row is assembled only
 * once every hold has passed.
 *
 * `parkableMessage` and `composeRecorded` are exported from here only, and `./draftRecordRun.ts` imports both. This
 * module imports one thing back from it: the `RecordedInputs` type.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { AsMeArtifact } from "../../../outbound/artifact/types.js";
import { earnsItsPlaceAdvisory, earnsItsPlaceRefusal } from "../../../outbound/slack/draftEarnsItsPlace.js";
import type { ParkedSlackDraft } from "../../../outbound/slack/draftRegister.js";
import type { SlackDripMessagePayload } from "../../../outbound/slack/types.js";
import { type ExactVoiceRuleFinding, VOICE_RULES_ESCAPE, voiceRuleLabel } from "../../../outbound/voice/exactRules.js";
import type { DripSource } from "./coreTypes.js";
import { composeParkedDraft } from "./draftCompose.js";
import type { DraftRecordOptions } from "./draftCore.js";
import { NOTHING_PARKED } from "./draftMedia.js";
import type { ConversationAnswer, SelfIdentity } from "./draftRecordReads.js";
import type { RecordedInputs } from "./draftRecordRun.js";
import type { SlackDraftDeps } from "./draftRun.js";
import { type ParkableMessageError, ParkableMessageErrors, parkableMessageLines } from "./parkableMessageErrors.js";
import type { PreparedDrip } from "./prepareDrip.js";

/**
 * The preparation, once its words keep their exact voice rules — or why it cannot park. A parked draft is a Queue card
 * they read as their own words, so a rule the send door would refuse is refused HERE, before the card exists, rather
 * than left for their eye, because a rule violation they would catch on sight is one the session catches first.
 * Under the open journalled `voice-rules` hatch it parks unchanged, and the send door still records the override.
 * A `--as bot` draft is not their words: the findings are their `me`-lane rules, so it parks as it always did.
 *
 * @param actor whose words the draft is: only their are held to their rules here
 * @param prepared what the ordinary preparation produced, carrying every finding and whether the hatch is open
 * @returns the preparation unchanged, or one line per broken rule and then that nothing parked
 */
export function recordableVoice<
  P extends { readonly allowVoiceRules: boolean; readonly voiceRuleFindings: readonly ExactVoiceRuleFinding[] },
>({ actor, prepared }: { actor: DraftRecordOptions["actor"]; prepared: P }): Result<P> {
  if (actor !== "me" || prepared.allowVoiceRules || prepared.voiceRuleFindings.length === 0) {
    return ok(prepared);
  }
  return err([
    ...prepared.voiceRuleFindings.map(
      ({ path, rule }) =>
        `${path} ${voiceRuleLabel({ rule })}. Rewrite the authored prose, or for one deliberate exception run ` +
        `${VOICE_RULES_ESCAPE}; the grant parks the original content unchanged.`,
    ),
    NOTHING_PARKED,
  ]);
}

/**
 * What {@link parkableMessageOf} reads: the plan's messages and the source they came from.
 *
 * @internal — the declared bound of both parsers' type parameter; no caller names it.
 */
export interface ParkablePreparation {
  readonly plan: { readonly messages: readonly { readonly payload: SlackDripMessagePayload }[] };
  readonly source: DripSource;
}

/**
 * The one message a draft parks, the form it was built from, and the preparation carried through.
 *
 * @internal — the declared shape of both parsers' success value; no caller names it.
 */
export interface ParkableMessage<P> {
  readonly form: string;
  readonly payload: SlackDripMessagePayload;
  readonly prepared: P;
}

/**
 * The one message a draft parks and the form it was built from — or why this preparation cannot park: a raw
 * `--body`, or a drip of more than one message. It reads only the plan's messages and the source, and carries the
 * preparation through unchanged.
 *
 * @param prepared what the ordinary preparation produced
 * @returns the form, the one message's payload and the preparation it came from, or the typed refusal
 */
export function parkableMessageOf<P extends ParkablePreparation>({
  prepared,
}: {
  prepared: P;
}): Result<ParkableMessage<P>, ParkableMessageError> {
  const { plan, source } = prepared;
  if (source.kind !== "form") {
    return err(ParkableMessageErrors.rawBody());
  }
  const first = plan.messages[0];
  if (plan.messages.length !== 1 || first === undefined) {
    return err(ParkableMessageErrors.notOneMessage({ messages: plan.messages.length }));
  }
  return ok({ form: source.json, payload: first.payload, prepared });
}

/**
 * {@link parkableMessageOf} for a refusal chain of lines — the shape both draft paths' `andThen` chains carry.
 *
 * @param prepared what the ordinary preparation produced
 * @returns the parkable message, or the refusal as the lines it prints
 */
export function parkableMessage<P extends ParkablePreparation>({
  prepared,
}: {
  prepared: P;
}): Result<ParkableMessage<P>> {
  return parkableMessageOf({ prepared }).mapErr((error) => parkableMessageLines({ error }));
}

/**
 * The one message, once it earns every word (`../../../outbound/slack/draftEarnsItsPlace.ts`) — or why it cannot park
 * as written. Under the open `earns-its-place` hatch it parks anyway, carrying one advisory line naming what it broke,
 * so their card says it went past the gate.
 *
 * @param hatchIsOpen whether the `earns-its-place` hatch is open for this recording
 * @param message the one message the draft would post and its preparation
 * @returns the message, its advisory extended when it parked past the gate, or the refusal lines
 */
export function earnedMessage<
  M extends {
    readonly prepared: { readonly advisory: readonly string[]; readonly plan: { readonly artifact: AsMeArtifact } };
  },
>({ hatchIsOpen, message }: { hatchIsOpen: boolean; message: M }): Result<M> {
  const { artifact } = message.prepared.plan;
  const refusal = earnsItsPlaceRefusal({ artifact, enabled: !hatchIsOpen });
  if (refusal.length > 0) {
    return err([...refusal, NOTHING_PARKED]);
  }
  const advisory = hatchIsOpen ? earnsItsPlaceAdvisory({ artifact }) : [];
  if (advisory.length === 0) {
    return ok(message);
  }
  return ok({ ...message, prepared: { ...message.prepared, advisory: [...message.prepared.advisory, ...advisory] } });
}

/**
 * Compose the row once every hold has passed, from the one message, the reads already memoised and what the
 * recording stored — the id and the instant minted here, at the moment it parks.
 *
 * @param botCannotPost why an as-me top-level finding in a channel may carry their name, when it may
 * @param deps the injected world, for the row's id and instant
 * @param inputs the thread root and read-through, the stored media and the re-ask declaration
 * @param message the one message the draft posts, the form it came from and its preparation
 * @param readInfo `conversations.info`, memoised — for the channel's name
 * @param readSelf `auth.test`, memoised — for the author id and workspace URL the row binds
 * @returns the row, ready to append
 */
export async function composeRecorded({
  botCannotPost,
  deps,
  inputs,
  message,
  options,
  readInfo,
  readSelf,
}: {
  botCannotPost: Parameters<typeof composeParkedDraft>[0]["botCannotPost"];
  deps: Pick<SlackDraftDeps, "mintId" | "nowIso">;
  inputs: RecordedInputs;
  message: {
    readonly form: string;
    readonly payload: SlackDripMessagePayload;
    readonly prepared: Pick<PreparedDrip, "advisory" | "resolution">;
  };
  options: DraftRecordOptions;
  readInfo: () => Promise<ConversationAnswer>;
  readSelf: () => Promise<SelfIdentity>;
}): Promise<ParkedSlackDraft> {
  const self = await readSelf();
  const info = await readInfo();
  return composeParkedDraft({
    advisory: message.prepared.advisory,
    authorId: self.userId,
    botCannotPost,
    channelName: info.name,
    form: message.form,
    groupDm: info.groupDm,
    id: deps.mintId(),
    kind: options.kind,
    media: inputs.media,
    options,
    payload: message.payload,
    priorAsk: inputs.priorAsk,
    readThrough: inputs.thread?.readThrough,
    receipts: inputs.receipts,
    resolution: message.prepared.resolution,
    threadParent: inputs.thread?.parent,
    tsIso: deps.nowIso(),
    workspaceUrl: self.workspaceUrl,
  });
}
