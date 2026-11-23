/**
 * The PURE projections the lifecycle shells take over a validated artifact — who a card
 * mentions and addresses, and the one message an `--as me` edit may replace. Cut out of `lifecycleCore.ts`, which keeps the argument parsing
 * and the door request; nothing here reads a flag, and `lifecycleCore.ts` imports nothing back.
 */
import { err, ok } from "../../../lib/result.js";
import { addressedGroupsOfCard, mentionedPeopleOfCard } from "../../../outbound/artifact/runs.js";
import type { AsMeArtifact, UpdateArtifact } from "../../../outbound/artifact/types.js";
import { renderDrip } from "../../../outbound/slack/dripRender.js";
import type { ResolvedMentions } from "../../../outbound/slack/render.js";
import type { SlackDripMessagePayload } from "../../../outbound/slack/types.js";
import { type SlackLifecycle, SlackLifecycleErrors } from "./lifecycleErrors.js";

/**
 * Every distinct person the artifact mentions, in first-appearance order.
 *
 * The lifecycle verbs need this for the same reason the send lane does: `renderUpdateCard` THROWS on a
 * mention it cannot resolve, so an edit or a final card that carries `@someone` must have the roster
 * looked up before rendering. Passing an empty map would turn a legitimate mention into a crash. Pure.
 *
 * A thin projection over the shared collector rather than its own walk: this file carried a second copy
 * that read `detail` alone, so an edit adding a tag ABOVE the fold — which is exactly what re-rendering a
 * card to tag its asker does — crashed the render instead of pinging anyone.
 *
 * @param artifact the validated artifact
 * @returns the mentioned identity-map keys, in order
 */
export function mentionedPeopleOf({ artifact }: { artifact: UpdateArtifact }): readonly string[] {
  return mentionedPeopleOfCard({ detail: artifact.detail, index: artifact.index });
}

/**
 * The USER GROUPS an artifact addresses, over BOTH regions — the same projection as
 * {@link mentionedPeopleOf}, over the run type that names a team rather than a person.
 *
 * @param artifact the validated artifact
 * @returns the addressed group handles, in order
 */
export function addressedGroupsOf({ artifact }: { artifact: UpdateArtifact }): readonly string[] {
  return addressedGroupsOfCard({ detail: artifact.detail, index: artifact.index });
}

/**
 * Refuse an as-me source shaped for more than one message.
 *
 * `slack edit --as me` replaces exactly one `ts`, so a multi-message `kind: "drip"` artifact has no target
 * for messages 2..N — "which message of N do you edit?" is exactly the question `post --as me` has a real
 * answer for (send N messages) and `edit --as me` does not. The plain escape hatch is always exactly one
 * message by construction and never reaches the `messages.length` branch below. Pure.
 *
 * @param artifact the validated as-me artifact
 * @returns the same artifact, or a refusal naming how many messages it held
 */
export function requireSingleDripMessage({ artifact }: { artifact: AsMeArtifact }): SlackLifecycle<AsMeArtifact> {
  if (artifact.kind === "drip" && artifact.messages.length !== 1) {
    return err(SlackLifecycleErrors.singleMessageRequired({ count: artifact.messages.length }));
  }
  return ok(artifact);
}

/**
 * Render a validated single-message as-me artifact to the one payload `chat.update` sends.
 *
 * `renderDrip` is generic over an N-message drip and returns an array; this asserts the invariant
 * `requireSingleDripMessage` already checked — a validated single-message artifact never renders to zero
 * payloads. Pure.
 *
 * @param artifact the artifact `requireSingleDripMessage` has already approved
 * @param mentions identity-map keys already resolved to Slack user ids
 * @returns the one message payload to send with `chat.update`
 */
export function singleDripPayload({
  artifact,
  mentions,
}: {
  artifact: AsMeArtifact;
  mentions: ResolvedMentions;
}): SlackDripMessagePayload {
  const [payload] = renderDrip({ artifact, mentions });
  if (payload === undefined) {
    throw new Error("renderDrip returned no message for a single-message as-me artifact");
  }
  return payload;
}
