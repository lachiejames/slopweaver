/**
 * The screenshot floor for a bot `finding` card at `slack post`: read the `--media` bytes ONCE, count the
 * distinct pictures among them, and hand the same bytes on to the send.
 *
 * The same read serves the wider Datadog screenshot floor: a composed card citing a Datadog
 * console page carries at least one picture, counted from the same bytes.
 *
 * Asked before the dry-run branch, so a preview refuses exactly what the real send would. The bytes counted
 * are the bytes sent: `./run.ts` passes these uploads to the send rather than reopening the paths, because a
 * count over one read and a send over another is a floor a swapped file walks past.
 */
import type { SlackUpload } from "../../../corpus/slack/writeTransport.js";
import { datadogScreenshotAssessment } from "../../../outbound/artifact/datadogCitation.js";
import { FINDING_KIND } from "../../../outbound/artifact/finding.js";
import type { SlackBotArtifact } from "../../../outbound/artifact/types.js";
import {
  datadogScreenshotFloorRefusals,
  findingImageFloorRefusals,
} from "../../../outbound/assistant/graphFindingFloor.js";
import { isScheduledDelivery } from "../../../outbound/slack/scheduledPostChannel.js";
import { identifyImageBytes } from "../../../visualEvidence/imageIo.js";

/**
 * The digest of every upload that decodes as an image, in upload order. A document or anything undecodable
 * contributes nothing, so it cannot count toward a picture floor.
 *
 * @param uploads the bytes the send would attach
 * @returns one digest per decodable image, duplicates kept
 */
export async function imageDigestsOf({ uploads }: { uploads: readonly SlackUpload[] }): Promise<readonly string[]> {
  const digests: string[] = [];
  for (const upload of uploads) {
    const identified = await identifyImageBytes({ bytes: upload.bytes });
    if (identified.isOk()) {
      digests.push(identified.value.digest);
    }
  }
  return digests;
}

/**
 * The floor's refusal for one send, or nothing when it is not a finding or it carries three distinct pictures.
 *
 * @param formKind the bot form kind that produced the card
 * @param artifact the admitted card, whose first citation is the finding's graph view
 * @param uploads the bytes the send would attach, already read
 * @param env where the floor's ambient hatch variable is read
 * @param home the state home a journalled grant is read from
 * @returns the refusal lines, empty when the send may proceed
 */
export async function findingMediaRefusals({
  formKind,
  artifact,
  uploads,
  env,
  home,
}: {
  formKind: string;
  artifact: SlackBotArtifact;
  uploads: readonly SlackUpload[];
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}): Promise<readonly string[]> {
  if (formKind !== FINDING_KIND || artifact.kind !== "update") {
    return [];
  }
  const [citation] = artifact.citations;
  if (citation === undefined) {
    throw new Error("a finding card always derives one citation — findingToUpdate changed shape");
  }
  const imageDigests = await imageDigestsOf({ uploads });
  return findingImageFloorRefusals({ citationUrl: citation.url, env, home, imageDigests });
}

/** Read every `--media` file, in the order given, so a card's screenshots keep the order they were named in. */
async function readMediaUploads({
  media,
  readMedia,
}: {
  media: readonly string[];
  readMedia: (args: { path: string }) => Promise<SlackUpload>;
}): Promise<SlackUpload[]> {
  const uploads: SlackUpload[] = [];
  for (const path of media) {
    uploads.push(await readMedia({ path }));
  }
  return uploads;
}

/**
 * The bot form kinds a SESSION composes, which owe the Datadog screenshot floor. A derived kind (a digest, an
 * alert summary) is a scheduled job's card with nobody there to take a picture, exactly as
 * `../../cardPictureDoor.ts` measured for its own question, so it is the floor's stated residue.
 */
const DATADOG_FLOOR_KINDS: ReadonlySet<string> = new Set(["update", "no-fold"]);

/**
 * Run the floors for one bot card, posted or parked: a finding's `--media` is read once and counted against its
 * three-picture floor, and a composed card citing a Datadog console page is counted against the one-picture floor
 * (`../../../outbound/artifact/datadogCitation.ts`). The bytes read are what the send later attaches. A card no
 * floor applies to reads nothing here and leaves `uploads` absent, so the send reads its own media as before.
 *
 * @param admitted the admitted card and the bot form kind that produced it
 * @param options the send's `--media` paths, the state home a journalled grant is read from, and the delivery id
 *   it was sent under — only a recipe slot's own id marks a scheduled firing, which no session is watching
 * @param deps the injected reader, one file at a time
 * @param env where the floor's ambient hatch variable is read
 * @returns the refusal lines, and the bytes already read when a floor applied
 */
export async function findingMediaFloor({
  admitted,
  options,
  deps,
  env,
}: {
  admitted: { artifact: SlackBotArtifact; formKind: string };
  options: { home: string; idempotencyKey: string | undefined; media: readonly string[] };
  deps: { readMedia: (args: { path: string }) => Promise<SlackUpload> };
  env: Readonly<Record<string, string | undefined>>;
}): Promise<{ refusals: readonly string[]; uploads: readonly SlackUpload[] | undefined }> {
  const { artifact, formKind } = admitted;
  if (formKind === FINDING_KIND) {
    const uploads = await readMediaUploads({ media: options.media, readMedia: deps.readMedia });
    const refusals = await findingMediaRefusals({ artifact, env, formKind, home: options.home, uploads });
    return { refusals, uploads };
  }
  const owesScreenshot =
    DATADOG_FLOOR_KINDS.has(formKind) &&
    !isScheduledDelivery({ idempotencyKey: options.idempotencyKey }) &&
    datadogScreenshotAssessment({ pictureCount: 0, value: artifact }).kind !== "not-cited";
  if (!owesScreenshot) {
    return { refusals: [], uploads: undefined };
  }
  const uploads = await readMediaUploads({ media: options.media, readMedia: deps.readMedia });
  const remedy =
    artifact.kind === "no-fold"
      ? "post it as an `update` card with `--media`, since a no-fold message carries no media"
      : "pass it as `--media`";
  const refusals = datadogScreenshotFloorRefusals({
    env,
    home: options.home,
    pictureCount: (await imageDigestsOf({ uploads })).length,
    remedy,
    value: artifact,
  });
  return { refusals, uploads };
}

/**
 * The bytes a send attaches: the ones {@link findingMediaFloor} already read and counted when there are any, so
 * the floor and the send see one read, else a fresh read of `--media`.
 *
 * @param preread the uploads the floor read, absent when no floor applied
 * @param media the paths `--media` named
 * @param readMedia the injected reader, one file at a time
 * @returns the uploads to attach, in `--media` order
 */
export async function uploadsForSend({
  preread,
  media,
  readMedia,
}: {
  preread: readonly SlackUpload[] | undefined;
  media: readonly string[];
  readMedia: (args: { path: string }) => Promise<SlackUpload>;
}): Promise<readonly SlackUpload[]> {
  if (preread !== undefined) {
    return preread;
  }
  return readMediaUploads({ media, readMedia });
}
