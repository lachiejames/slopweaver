/**
 * `slack draft record --media` — admit the files exactly as `slack post --media` would, then keep the very
 * bytes admitted, so a release months later sends what the owner approved rather than whatever sits at the path.
 *
 * Split out of `./draftRun.ts` as the one step a recording gains, and deliberately narrow: the two edges it
 * declares are an ADMISSION (a read plus the visual-evidence judgement) and a private STORE write. Neither
 * reaches Slack, so the recorder still holds no send edge — `./draftWiring.ts`'s header and its key-list
 * test keep saying so.
 */
import type { SlackUpload } from "../../../corpus/slack/writeTransport.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { SlackBotArtifact } from "../../../outbound/artifact/types.js";
import type { SlackDraftError } from "../../../outbound/slack/draftErrors.js";
import { draftFidelityProblems } from "../../../outbound/slack/draftFidelity.js";
import type { ParkedSlackDraftMedia } from "../../../outbound/slack/draftRegister.js";
import {
  type DraftMediaEvidence,
  firstMessageProofRefusal,
  firstMessageProofVerdict,
} from "../../../outbound/slack/firstMessageProof.js";
import type { SlackDripMessagePayload } from "../../../outbound/slack/types.js";
import { ImageAdmissionRefused } from "../../../visualEvidence/admitUploads.js";
import type { ImageAdmissionError } from "../../../visualEvidence/errors.js";
import type { PreparedImageBatch } from "../../../visualEvidence/prepareUploads.js";
import { admittedDatadogMediaRefusals } from "./datadogMediaFloor.js";
import { admittedMediaEvidence } from "./draftMediaEvidence.js";
import type { RecordingDestination } from "./draftRecordProof.js";
import { findingMediaFloor } from "./findingMedia.js";

/** What a refused admission is reported as — the command the owner would have typed. */
const RECORD_COMMAND = "slopweaver slack draft record";

/** The two edges a recording with media adds. Neither can post. */
export interface DraftMediaDeps {
  /**
   * Read every path once and run `slack post --media`'s own admission over the bytes read — a picture
   * against the visual-evidence store, a document or video identified from its bytes.
   */
  readonly prepareMedia: (args: {
    paths: readonly string[];
    home: string;
    env: Readonly<Record<string, string | undefined>>;
    nowIso: string;
  }) => Promise<Result<PreparedImageBatch, ImageAdmissionError>>;
  /** Keep the admitted bytes in the private content store, answering the row entries that name them. */
  readonly storeMedia: (args: {
    home: string;
    uploads: readonly SlackUpload[];
  }) => Result<readonly ParkedSlackDraftMedia[], SlackDraftError>;
}

/** What every refusal here ends on: the fact the caller has to report. */
export const NOTHING_PARKED = "NOTHING was parked and nothing was sent.";

/**
 * Nothing when a first message's admitted files carry its proof, or the refusal — judged on the bytes admission read
 * and the records it resolved, before anything is stored. A row that is not a first message in a channel owes nothing
 * (`../../../outbound/slack/firstMessageProof.ts`).
 *
 * @param destination where the row lands and what it says (`./draftRecordProof.ts` `recordingDestination`)
 * @param media what each admitted file is (`./draftMediaEvidence.ts` `admittedMediaEvidence`)
 * @returns ok, or the refusal lines
 */
function admittedFirstMessageProof({
  destination,
  media,
}: {
  destination: RecordingDestination;
  media: readonly DraftMediaEvidence[];
}): Result<void> {
  const { missing } = firstMessageProofVerdict({ draft: destination, media });
  if (missing.length === 0) {
    return ok(undefined);
  }
  return err([...firstMessageProofRefusal({ missing }), NOTHING_PARKED]);
}

/**
 * The lines refusing a draft the queue card could not draw as Slack will (`../../../outbound/slack/draftFidelity.ts`),
 * or `undefined` when it can.
 */
function unfaithfulLines({
  payload,
  uploads,
}: {
  payload: SlackDripMessagePayload;
  uploads: readonly SlackUpload[];
}): readonly string[] | undefined {
  const problems = draftFidelityProblems({ payload, uploads });
  if (problems.length === 0) {
    return undefined;
  }
  return [
    `${RECORD_COMMAND}: the queue card would not show this draft as Slack will —`,
    ...problems.map((problem) => `  ${problem.message}`),
    NOTHING_PARKED,
  ];
}

/**
 * Admit the whole batch, check the card can draw the message and every picture as Slack will, hold a first message
 * in a channel to its annotated screenshot ({@link admittedFirstMessageProof}) and a message citing Datadog to its
 * screenshot (`./datadogMediaFloor.ts`), then store it — in that order, so nothing is stored for a batch that is
 * refused, and nothing is parked unless every blob is in place.
 *
 * No `--media` costs no edge: neither is called, and the row carries no media field at all. The text is still
 * checked, because a bare citation needs no attachment to mislead the owner, and a Datadog citation with no picture
 * is refused here rather than at the release the owner already approved.
 *
 * @param artifact the linkified as-me form the row will carry, read for a Datadog citation
 * @param deps the admission and store edges, plus where the missing-record hatch and the clock are read
 * @param destination where the row lands, for the first-message proof
 * @param options the recording's state home and the files it named, in attach order
 * @param payload the message the draft would post
 * @returns the row entries in attach order, or the lines saying why nothing may be parked
 */
export async function admitAndStoreDraftMedia({
  artifact,
  deps,
  destination,
  options,
  payload,
}: {
  artifact: unknown;
  deps: DraftMediaDeps & {
    readonly doorEnv: () => Readonly<Record<string, string | undefined>>;
    readonly nowIso: () => string;
  };
  destination: RecordingDestination;
  options: { readonly home: string; readonly media: readonly string[] };
  payload: SlackDripMessagePayload;
}): Promise<Result<readonly ParkedSlackDraftMedia[]>> {
  const { home, media: paths } = options;
  const env = deps.doorEnv();
  if (paths.length === 0) {
    const refused = unfaithfulLines({ payload, uploads: [] });
    if (refused !== undefined) {
      return err(refused);
    }
    const first = admittedFirstMessageProof({ destination, media: [] });
    if (first.isErr()) {
      return err(first.error);
    }
    const unshown = await admittedDatadogMediaRefusals({ artifact, env, home, uploads: [] });
    return unshown.length === 0 ? ok([]) : err([...unshown, NOTHING_PARKED]);
  }
  const admitted = await deps.prepareMedia({ env, home, nowIso: deps.nowIso(), paths });
  if (admitted.isErr()) {
    return err([
      ...new ImageAdmissionRefused({ command: RECORD_COMMAND, error: admitted.error }).lines,
      NOTHING_PARKED,
    ]);
  }
  const refused = unfaithfulLines({ payload, uploads: admitted.value.uploads });
  if (refused !== undefined) {
    return err(refused);
  }
  const first = admittedFirstMessageProof({
    destination,
    media: admittedMediaEvidence({ evidence: admitted.value.evidence, uploads: admitted.value.uploads }),
  });
  if (first.isErr()) {
    return err(first.error);
  }
  const unshown = await admittedDatadogMediaRefusals({ artifact, env, home, uploads: admitted.value.uploads });
  if (unshown.length > 0) {
    return err([...unshown, NOTHING_PARKED]);
  }
  const stored = deps.storeMedia({ home, uploads: admitted.value.uploads });
  if (stored.isErr()) {
    return err([stored.error.message, NOTHING_PARKED]);
  }
  return ok(stored.value);
}

/**
 * Admit, count and store a `--as bot` recording's `--media`: the send's own admission over the bytes read once, a
 * first message's annotated screenshot and the finding screenshot floor over those same bytes, then the private
 * store — in that order, so a refused batch stores nothing.
 *
 * @param admitted the admitted card and the bot form kind that produced it, which the finding floor counts against
 * @param deps the admission and store edges, the clock and where the hatches are read
 * @param destination where the row lands and what it says, for the first-message proof
 * @param options the recording's state home and the files it named, in attach order
 * @returns the row entries in attach order, or the lines saying why nothing may be parked
 */
export async function admitAndStoreBotDraftMedia({
  admitted,
  deps,
  destination,
  options,
}: {
  admitted: { artifact: SlackBotArtifact; formKind: string };
  deps: DraftMediaDeps & {
    readonly doorEnv: () => Readonly<Record<string, string | undefined>>;
    readonly nowIso: () => string;
  };
  destination: RecordingDestination;
  options: { readonly home: string; readonly media: readonly string[] };
}): Promise<Result<readonly ParkedSlackDraftMedia[]>> {
  const { home, media: paths } = options;
  const env = deps.doorEnv();
  const read = await admittedBotUploads({ deps, env, home, paths });
  if (read.isErr()) {
    return err(read.error);
  }
  const { evidence, uploads } = read.value;
  const first = admittedFirstMessageProof({ destination, media: admittedMediaEvidence({ evidence, uploads }) });
  if (first.isErr()) {
    return err(first.error);
  }
  const floor = await findingMediaFloor({
    admitted,
    deps: { readMedia: async ({ path }) => uploadAt({ path, paths, uploads }) },
    env,
    options: { home, idempotencyKey: undefined, media: paths },
  });
  if (floor.refusals.length > 0) {
    return err([...floor.refusals, NOTHING_PARKED]);
  }
  if (uploads.length === 0) {
    return ok([]);
  }
  const stored = deps.storeMedia({ home, uploads });
  if (stored.isErr()) {
    return err([stored.error.message, NOTHING_PARKED]);
  }
  return ok(stored.value);
}

/**
 * Every `--media` file a bot recording names, admitted exactly as `slack post --media` would and read once — nothing
 * for a recording that named none.
 *
 * @returns the admitted uploads in attach order and the records admission resolved per picture, or the admission's own
 *   refusal lines
 */
async function admittedBotUploads({
  deps,
  env,
  home,
  paths,
}: {
  deps: Pick<DraftMediaDeps, "prepareMedia"> & { readonly nowIso: () => string };
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  paths: readonly string[];
}): Promise<Result<Pick<PreparedImageBatch, "evidence" | "uploads">>> {
  if (paths.length === 0) {
    return ok({ evidence: [], uploads: [] });
  }
  const admitted = await deps.prepareMedia({ env, home, nowIso: deps.nowIso(), paths });
  if (admitted.isErr()) {
    const refused = new ImageAdmissionRefused({ command: `${RECORD_COMMAND} --as bot`, error: admitted.error });
    return err([...refused.lines, NOTHING_PARKED]);
  }
  return ok({ evidence: admitted.value.evidence, uploads: admitted.value.uploads });
}

/**
 * The admitted upload a `--media` path names, so the floor counts the bytes admission read rather than reopening
 * the path.
 *
 * @returns the upload at that path's position
 */
function uploadAt({
  path,
  paths,
  uploads,
}: {
  path: string;
  paths: readonly string[];
  uploads: readonly SlackUpload[];
}): SlackUpload {
  const upload = uploads[paths.indexOf(path)];
  if (upload === undefined) {
    throw new Error(`${path} was not one of this recording's admitted --media files — nothing was parked`);
  }
  return upload;
}
