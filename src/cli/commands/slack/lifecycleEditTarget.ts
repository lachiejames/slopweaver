/**
 * Why the TARGET of a `slack edit --as bot` may not take the re-render, judged on the read-back before any write.
 * Split out of `./lifecycleRunEdit.ts` to keep that file under this repo's line cap; the edit shell asks these
 * and acts on nothing else.
 */
import type { AnswerFormAnswer } from "../../../outbound/assistant/answerForm.js";
import {
  answerShownToReader,
  datadogScreenshotFloorRefusals,
  graphFindingFloorRefusals,
} from "../../../outbound/assistant/graphFindingFloor.js";
import type { ReadSlackMessage } from "../../../outbound/slack/lifecycleGuards.js";
import { NO_FOLD_RENDERER } from "../../../outbound/slack/noFold.js";
import { highStakesEditRefusals } from "./highStakesGate.js";
import type { EditCardOptions } from "./lifecycleCore.js";
import type { LifecycleDeps } from "./lifecycleRunTypes.js";

/** The slice of the lifecycle dependencies a target check reads: the profile's channels and the hatches' env. */
type TargetDeps = Pick<LifecycleDeps, "doorEnv" | "highStakes">;

/**
 * Why an EXISTING no-fold message may not be edited, checked on the TARGET rather than on the form.
 *
 * `cardFromForm` already refuses a `no-fold` FORM, and that check alone leaves the hole this one closes: a
 * perfectly valid `update` form aimed at a no-fold message's own timestamp. `chat.update` sends
 * `attachments`, so that edit would wrap a message whose entire contract is that it carries no wrapper —
 * silently, and past every other check, because ownership legitimately RESOLVES. It resolves because the
 * no-fold renderer is registered as ours, which is exactly what lets `slack delete` remove one; the two are
 * the same fact read for two different purposes. Found by a Codex review pass over the form-level fix.
 *
 * @param existing what the read-back says the target message is
 * @param options the parsed invocation, for the channel and ts the refusal names
 * @returns the refusal lines, or empty when the target is not a no-fold message
 */
function noFoldTargetRefusal({
  existing,
  options,
}: {
  existing: ReadSlackMessage;
  options: EditCardOptions;
}): readonly string[] {
  if (existing.renderer !== NO_FOLD_RENDERER) {
    return [];
  }
  return [
    `${options.channel}/${options.ts} is a no-fold message, and this verb re-renders its form as a CARD — ` +
      "which sits in the attachment wrapper that was measured to make a Slack message fold. Editing it " +
      "would republish it as the very thing it exists not to be. Nothing was changed.",
    "post a replacement with `slopweaver slack post --as bot --form -` and remove this one with " +
      "`slopweaver slack delete` — which DOES accept it. A replacement cannot keep this permalink or ts.",
  ];
}

/**
 * Why the TARGET of a bot edit may not take this re-render: a no-fold message, then a top-level message in a
 * high-stakes channel (`./highStakesGate.ts`), which an edit would turn into a card that gate refuses as a post.
 *
 * @param deps the profile's high-stakes channels and the environment the hatch is read from
 * @param existing what the read-back says the target message is
 * @param formKind the kind of card the edit re-renders it as
 * @param options the parsed invocation, for the channel and ts
 * @returns the refusal lines, or empty when the target may be edited
 */
export function cardEditTargetRefusals({
  deps,
  existing,
  formKind,
  options,
}: {
  deps: TargetDeps;
  existing: ReadSlackMessage;
  formKind: string;
  options: EditCardOptions;
}): readonly string[] {
  const noFold = noFoldTargetRefusal({ existing, options });
  if (noFold.length > 0) {
    return noFold;
  }
  return highStakesEditRefusals({
    channel: options.channel,
    deps,
    env: deps.doorEnv(),
    existing,
    formKind,
    home: options.home,
  });
}

/**
 * The graph-finding floor as the edit door applies it. An edit re-sends the message's EXISTING files and can
 * attach none, so the floor counts those — the IMAGES among them only, since documents share the list, and an
 * unclassified read-back counts as none.
 *
 * @param existing the read-back of the message being edited, whose image files are counted
 * @returns the refusal lines, ending in the supersede route, or none when the floor is met or waived
 */
function editGraphFloorRefusals({
  answer,
  deps,
  existing,
  home,
}: {
  answer: AnswerFormAnswer;
  deps: TargetDeps;
  existing: ReadSlackMessage;
  home: string;
}): readonly string[] {
  const { imageFileIds = [] } = existing;
  const env = deps.doorEnv();
  const graphs = graphFindingFloorRefusals({ answer, env, home, images: imageFileIds });
  // Owed, the graph floor is the stricter one; otherwise a Datadog citation still owes the one picture the
  // message being edited already carries.
  const refusals = graphs.owed
    ? graphs.refusals
    : datadogScreenshotFloorRefusals({
        env,
        home,
        pictureCount: new Set(imageFileIds).size,
        remedy: "attach it to a corrected answer",
        value: answerShownToReader({ answer }),
      });
  if (refusals.length === 0) {
    return [];
  }
  return [
    ...refusals,
    "An edit keeps the message's own media and cannot add any: post a corrected answer whose form names " +
      "this one in `supersedes` instead. Nothing was changed.",
  ];
}

/**
 * Why an answer-card edit may not proceed: its target, then the graph-finding floor.
 *
 * @param answer the validated answer form
 * @param deps the profile's high-stakes channels and the environment the hatches are read from
 * @param existing the read-back of the message being edited
 * @param options the parsed invocation
 * @returns the refusal lines, or empty when the edit may proceed
 */
export function answerEditRefusals({
  answer,
  deps,
  existing,
  options,
}: {
  answer: AnswerFormAnswer;
  deps: TargetDeps;
  existing: ReadSlackMessage;
  options: EditCardOptions;
}): readonly string[] {
  const target = cardEditTargetRefusals({ deps, existing, formKind: "answer", options });
  return target.length > 0 ? target : editGraphFloorRefusals({ answer, deps, existing, home: options.home });
}
