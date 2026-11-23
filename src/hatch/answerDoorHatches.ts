/**
 * The escape-hatch rows for the OUTBOUND ANSWER DOOR — every `warn` an agent may waive on its way to
 * posting, plus the two ambient variables guarding the same surface.
 *
 * ## Why these are a file and not a section
 *
 * `./registry.ts` composes its register from one category file per surface, and this is the first of
 * them: what the bot may SAY. `ESCAPE_HATCHES` spreads this array in, so there is exactly ONE register, and
 * `src/devLint/escapeHatch.ts` reads that array rather than any file's text.
 *
 * Add a row for a new outbound-door warn HERE, and one for any other surface in that surface's category
 * file. Nearing the 300-code-line cap, this file splits again along its own surfaces.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on the outbound answer door, in register order. */
export const ANSWER_DOOR_HATCHES = [
  {
    caught:
      "the answer-quality gate on the outbound door judged this reply thin for what was asked — a claim with no evidence behind it, or a question left unanswered",
    command: "posting a bot answer to Slack",
    exceptions: [
      "the ask genuinely has a one-line answer and the gate is counting shape rather than substance",
      "the evidence is a screenshot or a link the gate cannot read as prose",
    ],
    id: "answer-quality",
    key: { kind: "door-token", token: "answer.quality:v1" },
    lane: "journalled",
    reader: "src/admit/answerQualityGate.ts",
    standing: "ruled",
  },
  {
    caught:
      "the reviewer's verdict does not cover every picture this reply attaches — one with no observation at all, two observations of one picture, or an observation naming bytes or a path the send does not carry",
    command: "posting a bot answer to Slack",
    exceptions: [
      "a picture the reviewer legitimately could not open, where the answer already says so and the reader loses nothing",
      "a re-send of an answer whose pictures were reviewed under an earlier path that has since moved",
    ],
    id: "answer-image-observations",
    key: { kind: "door-token", token: "answer.image-observations:v1" },
    lane: "journalled",
    reader: "src/admit/imageObservationCoverage.ts",
    standing: "ruled",
  },
  {
    caught: "the reply does not tag the person who asked, so it lands in nobody's activity feed",
    command: "posting a bot answer to Slack",
    exceptions: [
      "the asker is the only other participant in a DM, where a mention adds nothing",
      "the answer is a follow-up inside a thread the asker is already actively in",
    ],
    id: "asker-tag",
    key: { kind: "door-token", token: "answer.tag-asker:v1" },
    lane: "journalled",
    reader: "src/admit/askerTagGate.ts",
    standing: "ruled",
  },
  {
    caught:
      "the reply goes to a channel and names a path under the state home's pages directory — a file that resolves on the machine the bot runs on and nowhere else",
    command: "posting a bot answer to Slack",
    exceptions: [
      "the question was literally where a file was written, and the path IS the answer",
      "the reply names the path only to say the deliverable could not be attached, and says why",
    ],
    id: "local-page-path",
    key: { kind: "door-token", token: "answer.local-page-path:v1" },
    lane: "journalled",
    reader: "src/admit/documentDeliverableGate.ts",
    standing: "ruled",
  },
  {
    caught: "the reply attaches html with no markdown beside it, or lists its html before its markdown",
    command: "posting a bot answer to Slack",
    exceptions: [
      "the deliverable genuinely has no markdown form — a rendered export whose source is not text",
      "the markdown was already posted upthread and this reply attaches only the rendered half",
    ],
    id: "markdown-first",
    key: { kind: "door-token", token: "answer.markdown-first:v1" },
    lane: "journalled",
    reader: "src/admit/documentDeliverableGate.ts",
    standing: "ruled",
  },
  {
    caught: "the reply does not carry the deliverable the ask actually requested — the core thing, not a summary of it",
    command: "posting a bot answer to Slack",
    exceptions: [
      "the deliverable was already posted upthread and this reply points at it",
      "the ask turned out to be unanswerable and the reply says so with the reason",
    ],
    id: "core-deliverable",
    key: { kind: "door-token", token: "answer.deliverable:v1" },
    lane: "journalled",
    reader: "src/admit/coreDeliverableGate.ts",
    standing: "ruled",
  },
  {
    caught:
      "the composed message breaks one of the operator's own voice rules on the lane it is going out on — a banned word or phrase, an em-dash, or a claim carrying none of the hedge markers the owner measurably writes with",
    command: "posting to Slack as the operator or as the bot",
    exceptions: [
      "the offending text is a quoted ticket title, monitor name or article line the message is reporting verbatim",
      "the message is a deliberate one-off whose shape the owner asked for in their own words",
    ],
    id: "voice-profile",
    key: { kind: "door-token", token: "voice.profile:v1" },
    lane: "journalled",
    reader: "src/admit/voiceProfileGate.ts",
    standing: "ruled",
  },
  {
    caught: "the reply describes a chart, screenshot or diagram that nothing in the run actually produced",
    command: "posting a bot answer carrying a visual",
    exceptions: [
      "the visual is a provider-hosted image the run linked rather than rendered",
      "the reply names the visual only to say it could NOT be produced",
    ],
    id: "invented-visual",
    key: { kind: "door-token", token: "visual.invented:v1" },
    lane: "journalled",
    reader: "src/admit/inventedVisualGate.ts",
    standing: "ruled",
  },
  {
    caught:
      "the attachment is an animated GIF, which autoplays and loops in a pull request with no scrubber, no duration and no pause — a reader cannot scroll back through a recording such as a VHS cassette",
    command: "slopweaver github attach upload",
    exceptions: [
      "the loop IS the claim — a spinner or a fold opening a few frames long, where a player would add nothing",
      "the GIF is a colleague's or a provider's own artifact being re-attached verbatim",
    ],
    id: "animated-gif",
    key: { kind: "door-token", token: "visual.animated-gif:v1" },
    lane: "journalled",
    reader: "src/admit/animatedGifGate.ts",
    standing: "proposed",
  },
  {
    caught:
      "an image on this message has no recorded read-back, so nothing has established that anybody looked at it before it went out — two full-page Datadog screenshots were posted and one was photographed before the panel had rendered",
    command: "attaching an image to an outbound Slack message",
    exceptions: [
      "the image is a diagram or drawing a person made by hand, so there is no capture to read back",
      "the image came from a source no verb in this install can photograph, and the message says so",
      "the image is a photograph of something physical rather than a screen",
    ],
    id: "unread-image",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/visualEvidence/prepareUploads.ts",
    standing: "proposed",
  },
  {
    caught: "the reply cites an artifact URL that this run did not publish and cannot prove is reachable",
    command: "posting a bot answer citing an artifact",
    exceptions: [
      "the artifact was published by an earlier turn in the same thread and its URL was read back then",
      "the link is to a page the owner supplied in the ask",
    ],
    id: "real-artifact",
    key: { kind: "door-token", token: "answer.real-artifact:v1" },
    lane: "journalled",
    reader: "src/admit/realArtifactGate.ts",
    standing: "ruled",
  },
  {
    caught: "no skill was loaded for an ask a skill in this install covers, so the answer was composed from memory",
    command: "posting a bot answer to Slack",
    exceptions: [
      "you read every candidate skill and none of them owns this ask",
      "the ask is a pure lookup with no procedure attached to it",
    ],
    id: "skill-load",
    key: { kind: "door-token", token: "answer.skill-load:v1" },
    lane: "journalled",
    reader: "src/admit/skillLoadGate.ts",
    standing: "ruled",
  },
  {
    caught:
      "a blind spot says an atlas could not be seen while that atlas is published and grades ANSWERABLE on this install — a local read away",
    command: "posting a bot answer to Slack",
    exceptions: [
      "you read the atlas and the particular KIND this ask needs has never synced, and the sentence is about the atlas as a whole because naming the kind would mislead",
      "the atlas holds this organisation's records for a different estate from the one the ask is about",
    ],
    id: "declined-atlas",
    key: { kind: "door-token", token: "answer.declined-atlas:v1" },
    lane: "journalled",
    reader: "src/admit/declinedAtlasGate.ts",
    standing: "ruled",
  },
  {
    caught:
      "a Datadog citation opens a reader on something other than the claim's evidence — an unfrozen or wrongly frozen window, or a metric explorer link with neither exp_scope nor exp_group, which blends every reporting instance in the org into one line",
    command: "posting a bot answer to Slack",
    exceptions: [
      "the claim really is about the whole estate and one blended line IS the number — reach for exp_group first, which discharges this without a token and shows the reader the breakdown",
      "the console genuinely honours a different freeze for this view and you have measured it in a browser — fix the table in src/datadog/ddLink.ts rather than riding this token twice",
    ],
    id: "datadog-citation",
    key: { kind: "door-token", token: "answer.datadogCitation:v1" },
    lane: "journalled",
    reader: "src/admit/datadogCitationGate.ts",
    standing: "ruled",
  },
  // A finding reply with no media is not evidence: at least three photos back a claim like this. The floor
  // lives in the answer form rather than the admit door, so its reader is `../outbound/assistant/graphFindingFloor.ts`; `graphFindings.ts` beside it carries the criterion.
  {
    caught:
      "a measured finding links a Datadog graph view, or a bot finding card cites any system-of-record view, but carries fewer than three distinct screenshots — or any message, card or parked draft cites a Datadog console page with no picture at all — so the reader gets numbers without the pages they came from",
    command: "composing an assistant answer",
    exceptions: [
      "the Datadog address is a monitor or dashboard view with no graph supporting the claim on it",
      "the Datadog console is unreachable this turn and the answer names that blind spot",
      "the finding's evidence console renders no attachable picture this turn, and the card says so beside the citation",
    ],
    id: "unshown-graphs",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/outbound/assistant/graphFindingFloor.ts",
    standing: "ruled",
  },
  {
    caught:
      "the turn decided to withhold its reply, and the door holds a withheld reply rather than sending it quietly",
    command: "posting a bot answer to Slack",
    exceptions: [
      "the withholding was a false positive on content the owner asked for verbatim",
      "the thread is the bot's own DM, where a withheld draft is the expected test traffic",
    ],
    id: "withhold-reply",
    key: { kind: "door-token", token: "withhold.reply:v1" },
    lane: "journalled",
    reader: "src/admit/withhold.ts",
    standing: "ruled",
  },
  {
    caught: "the stub gate flagged it — this is the demonstration verb, and the finding is not about anything real",
    command: "slopweaver dev door --simulate warn",
    exceptions: ["you are demonstrating what an override looks like, which is the verb's whole purpose"],
    id: "door-demo",
    key: { kind: "door-token", token: "stub.warn:v1" },
    lane: "journalled",
    reader: "src/cli/commands/dev/door.ts",
    standing: "ruled",
  },
  {
    caught:
      "the same message content was already sent to this target inside the reservation window, so this is a duplicate send",
    command: "slopweaver slack post",
    exceptions: [
      "the first send failed at the provider and left nothing visible in the channel",
      "the repeat IS the point — a scheduled reminder whose text does not change",
    ],
    id: "slack-duplicate-send",
    key: { kind: "door-token", token: "slack.duplicate-send:v1" },
    lane: "journalled",
    reader: "src/outbound/slack/duplicateGate.ts",
    standing: "ruled",
  },
  // A dead app.-prefixed regional Datadog link is banned from going out on any integration's writes. It guards every
  // provider write transport, not only the answer door — it sits in this file because this is the outbound group.
  {
    caught:
      "the write carries an app.-prefixed regional Datadog console host, which no Datadog site serves as a console, so every link on it is dead",
    command: "an outbound provider write",
    exceptions: [
      "a bug report, incident note or pull request that quotes the dead host as the subject it is fixing",
      "a reply explaining to a person why the link they were sent does not open",
    ],
    id: "invalid-datadog-console-host",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/outbound/invalidDatadogHost.ts",
    standing: "proposed",
  },
  // A double post is structurally impossible to repeat. Every post and reply reads its place first; it sits
  // here because this is the outbound group.
  {
    caught:
      "the same identity already said this in this channel or thread within 7 days — the same words, or the same first line — or the place could not be read to check",
    command: "a Slack post or reply",
    exceptions: [
      "a deliberate re-post the owner asked for, after the earlier copy was deleted and Slack's history has not caught up",
      "a recurring message whose first line is fixed by design and whose body changes, where the recurrence is the point",
    ],
    id: "repeat-send",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/corpus/slack/writeGuardRepeat.ts",
    standing: "proposed",
  },
  // Rewording a reply several times per review thread under the owner's name is refused. A thread reply reads
  // its thread first; it sits here because this is the outbound group.
  {
    caught:
      "this identity already replied in this review thread since anybody else last commented, so the next word is the reviewer's — or the thread could not be read to check",
    command: "slopweaver github thread reply",
    exceptions: [
      "a correction to this identity's own last reply that cannot be an edit, after that reply was deleted",
      "the reviewer answered somewhere else (a top-level comment, Slack) and asked for the reply to land in the thread",
    ],
    id: "repeat-thread-reply",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/cli/commands/github/threadRepeatGuard.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
