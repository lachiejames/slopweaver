/**
 * The Datadog screenshot floor on the AS-ME lane (`../../../outbound/artifact/datadogCitation.ts` holds the rule
 * and the owner's words): a drip, one-card or one-list citing a Datadog console page carries a picture, whether it
 * is sent fresh, released from a parked row, or parked by `slack draft record`.
 *
 * Two entry points because the two lanes hold their bytes differently. A send reads `--media` (a release reads its
 * stored, digest-verified bytes through the same `readMedia` seam), so {@link asMeDatadogMediaFloor} reads once and
 * hands the very bytes it counted on to the send. A recording has already admitted its batch, so
 * {@link admittedDatadogMediaRefusals} counts what admission returned, before anything is stored.
 */
import type { SlackUpload } from "../../../corpus/slack/writeTransport.js";
import { datadogScreenshotAssessment } from "../../../outbound/artifact/datadogCitation.js";
import { datadogScreenshotFloorRefusals } from "../../../outbound/assistant/graphFindingFloor.js";
import { imageDigestsOf } from "./findingMedia.js";

/** How an as-me composer attaches a picture, as the refusal spells it. */
const AS_ME_REMEDY = "pass it as `--media`";

/**
 * Run the floor for one as-me send: when the message cites Datadog, read every `--media` path once, count the
 * pictures among them, and return those bytes for the send to attach. A message citing nothing reads nothing and
 * leaves `uploads` absent, so the send reads its own media exactly as before.
 *
 * @param artifact the linkified as-me form the plan will send
 * @param paths the `--media` paths, in attach order
 * @param readMedia the injected reader, one file at a time
 * @param env where the floor's ambient hatch variable is read
 * @param home the state home a journalled grant is read from
 * @returns the refusal lines, and the bytes already read, keyed by path, when the floor applied
 */
export async function asMeDatadogMediaFloor({
  artifact,
  paths,
  readMedia,
  env,
  home,
}: {
  artifact: unknown;
  paths: readonly string[];
  readMedia: (args: { path: string }) => Promise<SlackUpload>;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}): Promise<{ readonly refusals: readonly string[]; readonly uploads: ReadonlyMap<string, SlackUpload> | undefined }> {
  if (datadogScreenshotAssessment({ pictureCount: 0, value: artifact }).kind === "not-cited") {
    return { refusals: [], uploads: undefined };
  }
  const uploads = new Map<string, SlackUpload>();
  for (const path of paths) {
    uploads.set(path, await readMedia({ path }));
  }
  const pictureCount = (await imageDigestsOf({ uploads: [...uploads.values()] })).length;
  const refusals = datadogScreenshotFloorRefusals({ env, home, pictureCount, remedy: AS_ME_REMEDY, value: artifact });
  return { refusals, uploads };
}

/**
 * The floor for one `slack draft record`, over the batch admission already read — the bytes that will be stored.
 *
 * @param artifact the linkified as-me form the row will carry
 * @param uploads the admitted uploads, empty when the recording named no `--media`
 * @param env where the floor's ambient hatch variable is read
 * @param home the state home a journalled grant is read from
 * @returns the refusal lines, empty when the row may park
 */
export async function admittedDatadogMediaRefusals({
  artifact,
  uploads,
  env,
  home,
}: {
  artifact: unknown;
  uploads: readonly SlackUpload[];
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}): Promise<readonly string[]> {
  if (datadogScreenshotAssessment({ pictureCount: 0, value: artifact }).kind === "not-cited") {
    return [];
  }
  const pictureCount = (await imageDigestsOf({ uploads })).length;
  return datadogScreenshotFloorRefusals({ env, home, pictureCount, remedy: AS_ME_REMEDY, value: artifact });
}
