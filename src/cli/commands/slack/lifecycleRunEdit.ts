/**
 * `slack edit` — split out of `./lifecycleRun.ts` purely to keep that file under this repo's line cap. The
 * two-lane dispatch (`runEdit`) stays here, chosen once and never crossed: `--as bot` re-renders one of this
 * bot's own messages in place from a new form, each kind by its own renderer (`./lifecycleEditForms.ts` picks
 * which); `--as me` (`./lifecycleRunAsMe.ts`) shares none of its machinery — a different token, no ownership
 * guard, and a different message shape.
 */
import { throughDoor } from "../../../admit/effects.js";
import { type VoiceGateInput } from "../../../admit/voiceProfileGate.js";
import type { PostedMessage, SlackWriteTransport } from "../../../corpus/slack/writeTransport.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { parseRecordedAskIdentity } from "../../../live/ask/identity.js";
import type { AnswerFormAnswer } from "../../../outbound/assistant/answerForm.js";
import { renderAssistantAnswer } from "../../../outbound/assistant/answerMessage.js";
import { prLedSendRefusals } from "../../../outbound/slack/draftPrLead.js";
import { artifactFingerprint } from "../../../outbound/slack/fingerprint.js";
import type { ReadSlackMessage } from "../../../outbound/slack/lifecycleGuards.js";
import { renderableMentions } from "../../../outbound/slack/mentionIndex.js";
import { renderUpdateCard } from "../../../outbound/slack/render.js";
import type { SlackAssistantAnswerPayloadV2, SlackCardPayload } from "../../../outbound/slack/types.js";
import { answerProse, botArtifactProse } from "../../../outbound/voice/artifactProse.js";
import { readExactVoiceRules } from "../../../profileStore.js";
import { EXIT_OK } from "../../exitCodes.js";
import { type EditCardOptions, type EditOptions, lifecycleDoorRequest, STDIN_SENTINEL } from "./lifecycleCore.js";
import { routeEditForm } from "./lifecycleEditForms.js";
import { answerEditRefusals, cardEditTargetRefusals } from "./lifecycleEditTarget.js";
import { slackLifecycleErrorLines } from "./lifecycleErrors.js";
import { requireEditTarget } from "./lifecycleEventTypes.js";
import { runEditAsMe } from "./lifecycleRunAsMe.js";
import { runEditChecklist } from "./lifecycleRunEditChecklist.js";
import { runEditPoll } from "./lifecycleRunEditPoll.js";
import { cardFromForm, resolveAnswerMentions, resolveArtifactMentions } from "./lifecycleRunGuards.js";
import { editVoice, gatesFor, reportNotPerformed, usage } from "./lifecycleRunShared.js";
import type { LifecycleDeps } from "./lifecycleRunTypes.js";
import { unreadableProfileExit } from "./voiceAdmission.js";

/**
 * `slack edit` — the two lanes' separate code path, chosen once and never crossed.
 *
 * Bot-card edit keeps its exact prior behaviour, unchanged. The human lane below shares none of its
 * machinery: a different token, no ownership guard, and a different message shape.
 *
 * @param options the parsed `edit` invocation
 * @param deps the injected world
 * @returns the process exit code
 */
export async function runEdit({ options, deps }: { options: EditOptions; deps: LifecycleDeps }): Promise<number> {
  if (options.actor === "me") {
    return runEditAsMe({ deps, options });
  }
  // READ before the token, stdin or Slack: the form's admission judges the card against these rules, and a
  // corrupt profile is a fact about the install rather than a refused form, so it exits 1 here instead of 2.
  const rules = readExactVoiceRules({ home: options.home });
  return rules.isErr()
    ? unreadableProfileExit({ error: rules.error, nothingHappened: "nothing was changed." })
    : runEditAsBot({ deps, options });
}

/**
 * A card edit's new payload, rendered with its mentions resolved, then its opening judged: an edit replaces the
 * opening a teammate reads, so a card is held to the rule its post was. An ANSWER edit is not judged,
 * exactly as an answer is not: it replies to the question a person tagged the bot with. Their own bot DM is
 * exempt only once `verifiedOwnDm` proves it their; a message already sitting there proves nothing. Asked on a dry run
 * too, since an edit's dry run reads Slack for its target anyway and refuses what the edit would.
 */
async function judgedCardEdit({
  artifact,
  chrome,
  deps,
  options,
}: {
  artifact: Parameters<typeof renderUpdateCard>[0]["artifact"];
  chrome: Parameters<typeof renderUpdateCard>[0]["chrome"];
  deps: LifecycleDeps;
  options: EditCardOptions;
}): Promise<Result<SlackCardPayload>> {
  const mentions = await resolveArtifactMentions({ artifact, deps, home: options.home });
  if (mentions.isErr()) {
    return err(mentions.error);
  }
  const payload = renderUpdateCard({
    artifact,
    artifactFingerprint: artifactFingerprint({ artifact }),
    chrome,
    mentions: renderableMentions({ resolution: mentions.value }),
  });
  const { channel, home } = options;
  const verifiedOwnDm = await deps.verifiedOwnDm({ channel, home });
  const prLed = prLedSendRefusals({ channel, payload, verifiedOwnDm });
  return prLed.length > 0 ? err(prLed) : ok(payload);
}

/** `slack edit --as bot` (or no `--as`) — route a new form to the re-render for its kind. */
async function runEditAsBot({ options, deps }: { options: EditCardOptions; deps: LifecycleDeps }): Promise<number> {
  const token = deps.botToken({ home: options.home });
  if (token === undefined) {
    return usage({
      errors: ["slack edit needs a Slack bot token: run `slopweaver secrets set slack-bot-token`"],
    });
  }
  const formJson = options.formJson === STDIN_SENTINEL ? await deps.readStdin() : options.formJson;
  const route = routeEditForm({ json: formJson });
  switch (route.kind) {
    case "answer":
      return runEditAnswerCard({ answer: route.form, deps, options });
    case "checklist":
      return route.form.isErr()
        ? usage({ errors: route.form.error })
        : runEditChecklist({ deps, form: route.form.value, options });
    case "poll":
      return route.form.isErr()
        ? usage({ errors: route.form.error })
        : runEditPoll({ deps, form: route.form.value, options });
    case "card":
      return runEditCard({ deps, formJson, options, token });
  }
}

/**
 * Re-render an update CARD in place from a new card form: the path `slack edit` always had, split out of
 * {@link runEditAsBot} once that became the router over every kind's form.
 *
 * @param formJson the card form text, already read off stdin when the flag asked for it
 * @param token the bot token the caller already proved present
 * @param options the parsed invocation
 * @param deps the injected world
 * @returns the process exit code
 */
async function runEditCard({
  formJson,
  token,
  options,
  deps,
}: {
  formJson: string;
  token: string;
  options: EditCardOptions;
  deps: LifecycleDeps;
}): Promise<number> {
  const { allowUnresolvedOwner, home } = options;
  const parsedForm = await cardFromForm({ allowUnresolvedOwner, deps, dryRun: options.dryRun, home, json: formJson });
  if (parsedForm.isErr()) {
    return usage({ errors: slackLifecycleErrorLines({ error: parsedForm.error }) });
  }
  const artifact = parsedForm.value;
  const voice = editVoice({ deps, home: options.home, prose: botArtifactProse({ artifact }) });
  if (voice.isErr()) {
    return unreadableProfileExit({ error: voice.error, nothingHappened: "nothing was changed." });
  }
  const chrome = deps.cardChrome({ home: options.home });
  const judged = await judgedCardEdit({ artifact, chrome, deps, options });
  if (judged.isErr()) {
    return usage({ errors: judged.error });
  }
  const payload = judged.value;
  const posted: PostedMessage = { channel: options.channel, ts: options.ts };
  const transport = deps.makeTransport({ home: options.home, token });
  const target = await requireEditTarget({ deps, formKind: "card", home: options.home, posted, transport });
  if ("exit" in target) {
    return target.exit;
  }
  const existing = target.message;
  const targetRefusals = cardEditTargetRefusals({ deps, existing, formKind: "update", options });
  if (targetRefusals.length > 0) {
    return usage({ errors: targetRefusals });
  }
  if (options.dryRun) {
    for (const line of [
      `dry run — nothing was changed. would chat.update ${options.channel}/${options.ts}`,
      `  blocks: ${String(payload.attachments[0].blocks.length)} in 1 wrapper`,
      `  media preserved: ${String(existing.fileIds.length)} file(s)`,
    ]) {
      deps.out(line);
    }
    return EXIT_OK;
  }
  return performCardEdit({ deps, existing, options, payload, posted, transport, voice: voice.value });
}

/**
 * Put the re-rendered card through the door and report what happened.
 *
 * Split out of {@link runEditAsBot} under the line cap, and the seam is the one that file already has: the
 * caller decides WHETHER this edit may happen, and this performs it.
 *
 * @param payload the re-rendered card
 * @param existing the read-back, for the file ids an edit must re-send
 * @param posted the message being edited
 * @param transport the Slack write seam
 * @param options the parsed invocation
 * @param deps the injected world
 * @param voice the voice input the door judges, read before any Slack call was made
 * @returns the process exit code
 */
async function performCardEdit({
  payload,
  existing,
  posted,
  transport,
  options,
  deps,
  voice,
}: {
  payload: SlackCardPayload | SlackAssistantAnswerPayloadV2;
  existing: ReadSlackMessage;
  posted: PostedMessage;
  transport: SlackWriteTransport;
  options: EditCardOptions;
  deps: LifecycleDeps;
  voice: VoiceGateInput;
}): Promise<number> {
  const routed = await throughDoor({
    gates: gatesFor({ voice }),
    ledger: deps.doorLedger,
    // The existing file ids are re-sent: `chat.update` without them DETACHES the media, so an edit of a
    // card carrying a screenshot would silently drop the screenshot.
    perform: async () => transport.updateCard({ fileIds: existing.fileIds, payload, posted }),
    request: lifecycleDoorRequest({
      blockCount: payload.attachments[0].blocks.length,
      options,
      targetTs: options.ts,
    }),
  });
  if (!routed.performed) {
    return reportNotPerformed({ through: routed });
  }
  deps.out(`edited — channel=${options.channel} ts=${options.ts} media preserved=${String(existing.fileIds.length)}`);
  return EXIT_OK;
}

/**
 * Re-render an ANSWER card in place, from a new `kind: "answer"` form.
 *
 * ## Why this is its own path rather than a widened `update` edit
 *
 * `turn answer` posts a different artifact from `slack post`: an answer form carries `lead`, `index`, `body`
 * AND a `grounding` block, and its renderer appends the evidence trail and provenance footer that the
 * update card has no field for. Routing one through `renderUpdateCard` would not be an edit of the card, it
 * would be a REPLACEMENT of it with a smaller shape — the four evidence sections and the footer would
 * silently vanish from a message people had already read.
 *
 * Before this existed the verb simply refused, on the event type, with a line that named the type and no
 * route: `slack delete` had been widened to accept `slopweaver_assistant_answer_v2` and the edit path never
 * was, so the bot could retract its own answer and could not correct one. MEASURED, on a public
 * answer in `proj-launch-room` that said the bot could not read JumpCloud when it could: the fix for
 * the CLAIM was one verb away and the fix for the MESSAGE was unreachable.
 *
 * ## The ask identity is INHERITED, never minted
 *
 * An answer card records which ask it answers. A re-render is still the answer to that same question, so
 * the identity is read back off the message being edited rather than supplied by the caller — a fresh one
 * would detach the message from the ask ledger that records what has been answered, and a caller-supplied
 * one would be a way to re-point an existing answer at a different question entirely.
 *
 * @param answer the answer form to re-render, or why it failed validation
 * @param options the parsed invocation
 * @param deps the injected world
 * @returns the process exit code
 */
async function runEditAnswerCard({
  answer: answerForm,
  options,
  deps,
}: {
  answer: Result<AnswerFormAnswer>;
  options: EditCardOptions;
  deps: LifecycleDeps;
}): Promise<number> {
  if (answerForm.isErr()) {
    return usage({ errors: answerForm.error });
  }
  const answer = answerForm.value;
  const token = deps.botToken({ home: options.home });
  if (token === undefined) {
    return usage({ errors: ["slack edit needs a Slack bot token: run `slopweaver secrets set slack-bot-token`"] });
  }
  const voice = editVoice({ deps, home: options.home, prose: answerProse({ answer }) });
  if (voice.isErr()) {
    return unreadableProfileExit({ error: voice.error, nothingHappened: "nothing was changed." });
  }
  const transport = deps.makeTransport({ home: options.home, token });
  const posted: PostedMessage = { channel: options.channel, ts: options.ts };
  const target = await requireEditTarget({ deps, formKind: "answer", home: options.home, posted, transport });
  if ("exit" in target) {
    return target.exit;
  }
  const existing = target.message;
  const askIdentity = parseRecordedAskIdentity({ value: existing.askIdentity });
  if (askIdentity === undefined) {
    return usage({
      errors: [
        `refusing to re-render ${options.channel}/${options.ts}: it carries no readable askIdentity, so this ` +
          "edit cannot inherit which ask it answers, and minting a fresh one would detach the message from " +
          "the ask ledger. Nothing was changed.",
      ],
    });
  }
  const graphs = answerEditRefusals({ answer, deps, existing, options });
  if (graphs.length > 0) {
    return usage({ errors: graphs });
  }
  const mentions = await resolveAnswerMentions({ answer, deps, home: options.home });
  if (mentions.isErr()) {
    return usage({ errors: mentions.error });
  }
  const payload = renderAssistantAnswer({
    answer,
    askIdentity,
    chrome: deps.cardChrome({ home: options.home }),
    mentions: renderableMentions({ resolution: mentions.value }),
  });
  if (options.dryRun) {
    return answerEditDryRun({ blockCount: payload.attachments[0].blocks.length, deps, existing, options, askIdentity });
  }
  return performCardEdit({ deps, existing, options, payload, posted, transport, voice: voice.value });
}

/**
 * Print what an answer-card edit WOULD do, and change nothing.
 *
 * @param blockCount how many blocks the re-rendered wrapper carries
 * @param askIdentity the identity inherited off the message, printed so a reader can check it was not minted
 * @returns the success exit code
 */
function answerEditDryRun({
  askIdentity,
  blockCount,
  deps,
  existing,
  options,
}: {
  askIdentity: { quality: string; threadTs: string };
  blockCount: number;
  deps: LifecycleDeps;
  existing: ReadSlackMessage;
  options: EditCardOptions;
}): number {
  for (const line of [
    `dry run — nothing was changed. would chat.update ${options.channel}/${options.ts} as an ANSWER card`,
    `  blocks: ${String(blockCount)} in 1 wrapper`,
    `  ask identity inherited: quality=${askIdentity.quality} thread=${askIdentity.threadTs}`,
    `  media preserved: ${String(existing.fileIds.length)} file(s)`,
  ]) {
    deps.out(line);
  }
  return EXIT_OK;
}
