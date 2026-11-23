/*
 * Releasing a held draft that parses as the new answer form.
 *
 * Mentions and uploads are resolved against what is live NOW rather than against what the draft recorded,
 * because a roster moves between the hold and the release. Rendering goes through the accent-only answer
 * wrapper; the operator card renderer is not imported here and must not be.
 *
 * It reaches the door through `./queueReleaseDoor.ts` and cannot append a queue event itself.
 */
import { type QueueItem, recordedAskIdentityForHeld } from "../../../admit/queue.js";
import { loadSlackUploads } from "../../../corpus/slack/uploadFiles.js";
import type { SlackUpload } from "../../../corpus/slack/writeTransport.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type HeldUpload } from "../../../live/turn/heldUploads.js";
import { addressedGroupsOfCard, mentionedPeopleOfCard } from "../../../outbound/artifact/runs.js";
import { type AnswerFormAnswer } from "../../../outbound/assistant/answerForm.js";
import { renderAssistantAnswer } from "../../../outbound/assistant/answerMessage.js";
import {
  answerShownToReader,
  datadogScreenshotFloorRefusals,
  graphFindingFloorRefusals,
} from "../../../outbound/assistant/graphFindingFloor.js";
import { groupRefusals, renderableMentions, staleRosterRefusals } from "../../../outbound/slack/mentionIndex.js";
import { mentionsFromIdentity } from "../../../outbound/slack/mentionWiring.js";
import { type ResolvedMentions } from "../../../outbound/slack/render.js";
import { identityRosterPort } from "../../../silver/identityRoster.js";
import { documentsAmongUploads } from "../../../visualEvidence/prepareUploads.js";
import { misplacedDocumentLine } from "../../../visualEvidence/refusals.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import { imageDigestsOf } from "../slack/findingMedia.js";
import { chromeFromProfile } from "../slack/wiring.js";
import { decodeHeldUploads } from "./queueHeldDraft.js";
import { postReleasedPayload } from "./queueReleaseDoor.js";

/**
 * Resolve an answer's mentioned people, refusing the release rather than sending an un-pinged reply.
 *
 * The fresh-turn path treats an unresolved mention as fatal before anything posts; a release parsing the
 * SAME answer form must hold to the same standard, or a held answer that would have rendered successfully
 * as a fresh turn becomes permanently unreleasable through the queue for a different, silent reason.
 */
async function resolveReleaseMentions({
  answer,
  home,
}: {
  answer: AnswerFormAnswer;
  home: string;
}): Promise<Result<ResolvedMentions>> {
  const people = mentionedPeopleOfCard({ detail: answer.body, index: answer.index });
  const groups = addressedGroupsOfCard({ detail: answer.body, index: answer.index });
  // The composition root for the roster port: a release is a CLI shell, so the store row is read here.
  const resolved = await mentionsFromIdentity({
    askedAtIso: new Date().toISOString(),
    groups,
    home,
    identityRoster: identityRosterPort(),
    people,
  });
  if (resolved.isErr()) {
    return err([resolved.error.message]);
  }
  const resolution = resolved.value;
  const missing = people.filter((person) => !resolution.resolved.has(person));
  if (missing.length > 0) {
    return err([`the held answer mentions ${missing.join(", ")}, which do not resolve in the identity map`]);
  }
  const groupsRefused = groupRefusals({ resolution });
  if (groupsRefused.length > 0) {
    return err(groupsRefused);
  }
  const stale = staleRosterRefusals({ people, resolution });
  if (stale.length > 0) {
    return err(stale);
  }
  return ok(renderableMentions({ resolution }));
}

/**
 * The attachments a release sends: the locked held bytes, or — for a `--form` replacement, which has no
 * locked bytes to decode — the replacement's own paths read fresh off disk.
 *
 * Both lanes together, because a release is one send: an answer whose images decoded and whose documents
 * did not would post the picture and silently drop the deliverable, which is this whole change's subject.
 */
async function resolveReleaseUploads({
  answer,
  heldUploads,
  heldDocuments,
  home,
  replacement,
}: {
  answer: AnswerFormAnswer;
  heldUploads: readonly HeldUpload[];
  home: string;
  heldDocuments: readonly HeldUpload[];
  replacement: Readonly<Record<string, unknown>> | undefined;
}): Promise<{ readonly uploads: readonly SlackUpload[]; readonly documents: readonly SlackUpload[] } | undefined> {
  const resolved = await readReleaseUploads({ answer, heldDocuments, heldUploads, replacement });
  if (resolved === undefined) {
    return undefined;
  }
  // The answer form's own lane check, for `documentsAmongUploads`'s reason: image admission carries a
  // document now, so a deliverable left in `images` would slip through as a waivable coverage gap.
  const misplaced = await documentsAmongUploads({ uploads: resolved.uploads });
  if (misplaced.length > 0) {
    logger.error({ msg: misplacedDocumentLine({ filenames: misplaced }) });
    return undefined;
  }
  // The graph-finding floor over what this release really sends: a replacement form is never parsed through
  // `parseAnswerArm`, and a held answer's pictures are the locked bytes rather than its stored paths.
  const graphs = graphFindingFloorRefusals({
    answer,
    env: process.env,
    home,
    images: resolved.uploads.map((upload) => upload.filename),
  });
  // Owed, the graph floor is the stricter one; otherwise a Datadog citation still owes one picture among the
  // bytes this release attaches.
  const refusals = graphs.owed
    ? graphs.refusals
    : datadogScreenshotFloorRefusals({
        env: process.env,
        home,
        pictureCount: new Set(await imageDigestsOf({ uploads: resolved.uploads })).size,
        remedy: "list it in `images` and re-hold the answer",
        value: answerShownToReader({ answer }),
      });
  if (refusals.length > 0) {
    for (const refusal of refusals) {
      logger.error({ msg: refusal });
    }
    return undefined;
  }
  return resolved;
}

/**
 * Read both lanes' bytes, from the held copies or from the replacement's own paths.
 *
 * Split from {@link resolveReleaseUploads} so reading the world and judging what was read stay apart — the
 * lane check that follows it is a decision, and this function has no opinion about what it found.
 *
 * @param answer the form being released
 * @param heldUploads the held images, used when nothing replaced them
 * @param heldDocuments the held deliverables, same
 * @param replacement present when the operator supplied a fresh form, whose paths are read off disk
 * @returns both lanes' bytes, or undefined when a path could not be read
 */
async function readReleaseUploads({
  answer,
  heldUploads,
  heldDocuments,
  replacement,
}: {
  answer: AnswerFormAnswer;
  heldUploads: readonly HeldUpload[];
  heldDocuments: readonly HeldUpload[];
  replacement: Readonly<Record<string, unknown>> | undefined;
}): Promise<{ readonly uploads: readonly SlackUpload[]; readonly documents: readonly SlackUpload[] } | undefined> {
  if (replacement === undefined) {
    return {
      documents: decodeHeldUploads({ heldUploads: heldDocuments }),
      uploads: decodeHeldUploads({ heldUploads }),
    };
  }
  try {
    return {
      documents: await loadSlackUploads({ paths: answer.documents, what: "document" }),
      uploads: await loadSlackUploads({ paths: answer.images, what: "image" }),
    };
  } catch (error) {
    logger.error({ msg: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

/**
 * Release a held ANSWER FORM through the composite sender — the same rendering and media path a fresh turn
 * uses, so a released reply is indistinguishable from one that went out first try.
 *
 * @returns the verb's exit code
 */
export async function sendAnswerRelease({
  answer,
  dryRun,
  heldDocuments,
  heldUploads,
  home,
  item,
  note,
  replacement,
}: {
  answer: AnswerFormAnswer;
  dryRun: boolean;
  heldDocuments: readonly HeldUpload[];
  heldUploads: readonly HeldUpload[];
  home: string;
  item: QueueItem;
  note: string;
  replacement: Readonly<Record<string, unknown>> | undefined;
}): Promise<number> {
  const mentions = await resolveReleaseMentions({ answer, home });
  if (mentions.isErr()) {
    for (const error of mentions.error) {
      logger.error({ msg: error });
    }
    return EXIT_ERROR;
  }
  const attachments = await resolveReleaseUploads({ answer, heldDocuments, heldUploads, home, replacement });
  if (attachments === undefined) {
    return EXIT_ERROR;
  }
  return finishAnswerRelease({
    answer,
    documents: attachments.documents,
    dryRun,
    home,
    item,
    mentions: mentions.value,
    note,
    replacement,
    uploads: attachments.uploads,
  });
}

/** Render the answer, then either preview or send it. */
// max-lines-exempt: one render-then-send sequence over 9 named-object-params fields, one line per field
async function finishAnswerRelease({
  answer,
  documents,
  dryRun,
  home,
  item,
  mentions,
  note,
  replacement,
  uploads,
}: {
  answer: AnswerFormAnswer;
  documents: readonly SlackUpload[];
  dryRun: boolean;
  home: string;
  item: QueueItem;
  mentions: ResolvedMentions;
  note: string;
  replacement: Readonly<Record<string, unknown>> | undefined;
  uploads: readonly SlackUpload[];
}): Promise<number> {
  const payload = renderAssistantAnswer({
    answer,
    askIdentity: recordedAskIdentityForHeld({ held: item.held }),
    chrome: chromeFromProfile({ home }),
    mentions,
  });
  return postReleasedPayload({
    documents,
    dryRun,
    home,
    item,
    note,
    payload,
    replacement,
    uploads,
  });
}
