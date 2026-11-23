/**
 * The `--as bot` card lane of `slopweaver slack post|reply`, split out of `./run.ts` so two callers share ONE
 * copy of it: a fresh `--as bot --form` send, and the release of a parked `--as bot` draft (`./releaseRun.ts`),
 * which is the same card through the same gates with two additions — the approval check before the send, and the
 * register row marked after it ({@link CardDraftRelease}).
 *
 * The order is `./run.ts`'s header's steps 3 to 7; each refusal is asked before the step after it costs anything.
 */
import { basename } from "node:path";
import { throughDoor } from "../../../admit/effects.js";
import type { DoorAcknowledgement, DoorGate } from "../../../admit/types.js";
import type { SlackUpload } from "../../../corpus/slack/writeTransport.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { slackDeliveryErrorLines } from "../../../outbound/slack/deliveryErrors.js";
import { prLedSendRefusals } from "../../../outbound/slack/draftPrLead.js";
import { DUPLICATE_SEND_OVERRIDE } from "../../../outbound/slack/duplicateGate.js";
import { type MentionResolution, renderableMentions } from "../../../outbound/slack/mentionIndex.js";
import type { ResendPolicy } from "../../../outbound/slack/sendReservation.js";
import type { SlackSendResult } from "../../../outbound/slack/types.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { botCardGates, cardShapeRefusals, overrideTokens, sendCard } from "./cardSend.js";
import {
  buildSlackWritePlan,
  type SlackCardOptions,
  type SlackRefusal,
  type SlackWritePlan,
  STDIN_SENTINEL,
  slackDoorRequest,
  slackDryRunLines,
  slackSendLines,
  slackWriteJson,
  slackWriteReport,
} from "./core.js";
import { findingMediaFloor, uploadsForSend } from "./findingMedia.js";
import { highStakesRefusals } from "./highStakesGate.js";
import type { SlackWriteDeps } from "./run.js";
import { type AdmittedCard, admittedCardOrRefusals, type CardAdmissionDeps, resolveAllMentions } from "./runAdmit.js";
import { unreadableProfileExit } from "./voiceAdmission.js";
import { emitLines, reportRefusal, usage } from "./writeOutput.js";

/**
 * What a parked `--as bot` draft's release adds to the ordinary card send: the check that the card rendered NOW is
 * the one the owner approved, asked after every gate and before the dry run, and what the verb exits on once it landed.
 */
export interface CardDraftRelease {
  /** Every reason the rendered card is not the approved one — empty when it is exactly those bytes. */
  readonly drift: (args: { plan: SlackWritePlan; resolution: MentionResolution }) => Promise<readonly string[]>;
  /**
   * Every reason the row moved since `drift`, re-read after the send-only reads that await — the high-stakes claim and
   * the media — and just before the door, as the as-me drip's `lastCheck` is. Empty when it may go.
   */
  readonly lastCheck: () => readonly string[];
  /** Mark the row released once the card is in Slack, answering the exit code the verb ends on. */
  readonly landed: (args: { sent: SlackSendResult }) => number;
}

/**
 * Admit a bot form, resolve every mention it names and render the card — the steps before anything reads Slack,
 * shared by a send and by `slack draft record --as bot` (`./draftRecordBotRun.ts`), so a recording parks exactly
 * the card its release will render.
 *
 * @param cardOptions the options the card is admitted and rendered under
 * @param deps the admission reads and the chrome
 * @param formJson the form text, already read from stdin where the sentinel asked for it
 * @returns the admitted card, its resolved mentions and its plan, or every refusal line
 */
export async function renderedCard({
  cardOptions,
  deps,
  formJson,
}: {
  cardOptions: SlackCardOptions;
  deps: CardAdmissionDeps & Pick<SlackWriteDeps, "chrome">;
  formJson: string;
}): Promise<
  Result<{ readonly admitted: AdmittedCard; readonly mentions: MentionResolution; readonly plan: SlackWritePlan }>
> {
  const admitted = await admittedCardOrRefusals({ cardOptions, deps, formJson });
  if (admitted.isErr()) {
    return err(slackDeliveryErrorLines({ error: admitted.error }));
  }
  const mentions = await resolveAllMentions({ artifact: admitted.value.artifact, deps, home: cardOptions.home });
  if (mentions.isErr()) {
    return err(mentions.error);
  }
  const plan = buildSlackWritePlan({
    artifact: admitted.value.artifact,
    chrome: deps.chrome({ home: cardOptions.home }),
    formKind: admitted.value.formKind,
    mentions: renderableMentions({ resolution: mentions.value }),
    options: cardOptions,
  });
  return ok({ admitted: admitted.value, mentions: mentions.value, plan });
}

/**
 * {@link renderedCard}, then its opening judged before Slack is asked anything bar the one read that proves the
 * destination the owner's own bot DM, for a fresh card and a release alike: a card bound for a teammate never opens
 * on a pull request. A dry run makes the same read, so it refuses exactly what the real send would.
 */
async function judgedCard({
  cardOptions,
  deps,
  formJson,
}: {
  cardOptions: SlackCardOptions;
  deps: SlackWriteDeps;
  formJson: string;
}): ReturnType<typeof renderedCard> {
  const rendered = await renderedCard({ cardOptions, deps, formJson });
  if (rendered.isErr()) {
    return rendered;
  }
  const { channel, payload } = rendered.value.plan;
  const verifiedOwnDm = await deps.verifiedOwnDm({ channel, home: cardOptions.home });
  const prLed = prLedSendRefusals({ channel, payload, verifiedOwnDm });
  return prLed.length > 0 ? err(prLed) : ok(rendered.value);
}

/**
 * The bot-card lane: admit the form, resolve its mentions, render it, run every gate, and send it — or, under
 * `--dry-run`, print what the send would do.
 *
 * @param cardOptions the parsed invocation, or the release's options built from its row
 * @param deps the injected world
 * @param token the bot token the card goes out under
 * @param release the approval check and the register mark, present only for a parked draft's release
 * @returns the process exit code
 */
export async function runSlackCardWrite({
  cardOptions,
  deps,
  release,
  token,
}: {
  cardOptions: SlackCardOptions;
  deps: SlackWriteDeps;
  release?: CardDraftRelease | undefined;
  token: string;
}): Promise<number> {
  const formJson = cardOptions.formJson === STDIN_SENTINEL ? await deps.readStdin() : cardOptions.formJson;
  const rendered = await judgedCard({ cardOptions, deps, formJson });
  if (rendered.isErr()) {
    return usage({ errors: rendered.error });
  }
  const { admitted, mentions, plan } = rendered.value;
  // READ before Slack is asked anything — the wall check reads the thread — so a profile that cannot be trusted
  // stops the card with no call made, and a dry run refuses exactly what the real send would.
  const nowIso = new Date().toISOString();
  const env = deps.doorEnv();
  const gates = botCardGates({ deps, env, nowIso, options: cardOptions, plan, record: !cardOptions.dryRun });
  if (gates.isErr()) {
    return unreadableProfileExit({ error: gates.error, nothingHappened: "nothing was posted." });
  }
  const { home, idempotencyKey, media } = cardOptions;
  const refusals = await cardShapeRefusals({ deps, env, formKind: admitted.formKind, home, media, plan, token });
  if (refusals.length > 0) {
    return usage({ errors: refusals });
  }
  const floor = await findingMediaFloor({ admitted, deps, env, options: { home, idempotencyKey, media } });
  if (floor.refusals.length > 0) {
    return usage({ errors: floor.refusals });
  }
  const drift = release === undefined ? [] : await release.drift({ plan, resolution: mentions });
  if (drift.length > 0) {
    return usage({ errors: drift });
  }
  const outcome = await previewOrSend({
    acknowledgements: admitted.acknowledgements,
    deps,
    env,
    formKind: admitted.formKind,
    gates: gates.value,
    lastCheck: release?.lastCheck,
    mediaFilenames: media.map((path) => basename(path)),
    mentions,
    nowIso,
    options: cardOptions,
    plan,
    preread: floor.uploads,
    token,
  });
  if (release === undefined || outcome.sent === undefined) {
    return outcome.exitCode;
  }
  return release.landed({ sent: outcome.sent });
}

/**
 * The card lane's last step: a dry run's preview, or, now that the card will really go, the high-stakes claim
 * TAKEN before the channel's day is re-read and only then the send, so a second card started at the same moment
 * is refused instead of reading the same empty day. A finding's `preread` uploads are the bytes its floor counted, so
 * they are sent as they are, never read again; a release's `lastCheck` runs once every awaited read is done.
 */
async function previewOrSend({
  formKind,
  lastCheck,
  preread,
  ...send
}: Omit<Parameters<typeof performSend>[0], "uploads"> & {
  formKind: string;
  lastCheck: (() => readonly string[]) | undefined;
  preread: readonly SlackUpload[] | undefined;
}): ReturnType<typeof performSend> {
  const { deps, env, mediaFilenames, mentions, options, plan, token } = send;
  if (options.dryRun) {
    return { exitCode: emitDryRun({ deps, mediaFilenames, mentions, options, plan }), sent: undefined };
  }
  const { channel, threadTs } = plan;
  const home = options.home;
  const claimed = await highStakesRefusals({ channel, claim: true, deps, env, formKind, home, threadTs, token });
  if (claimed.length > 0) {
    return { exitCode: usage({ errors: claimed }), sent: undefined };
  }
  const uploads = await uploadsForSend({ media: options.media, preread, readMedia: deps.readMedia });
  const moved = lastCheck === undefined ? [] : lastCheck();
  if (moved.length > 0) {
    return { exitCode: usage({ errors: moved }), sent: undefined };
  }
  return performSend({ ...send, uploads });
}

/**
 * The `--dry-run` output, in whichever format was asked for.
 *
 * `--json` emits ONE document and nothing else, which is why the two formats are exclusive rather than the
 * lines being printed alongside it.
 *
 * @param options the parsed invocation
 * @param plan the fully-decided send the real path would perform
 * @param mentions the mention resolution, for the roster report
 * @param mediaFilenames the basenames the send would attach
 * @param deps the injected world
 * @returns the OK exit code — a dry run cannot fail
 */
function emitDryRun({
  options,
  plan,
  mentions,
  mediaFilenames,
  deps,
}: {
  options: SlackCardOptions;
  plan: SlackWritePlan;
  mentions: MentionResolution;
  mediaFilenames: readonly string[];
  deps: SlackWriteDeps;
}): number {
  const args = { mediaFilenames, mentions, options, out: deps.out, plan };
  if (options.json) {
    emitJsonReport({ ...args, refusal: null, sent: null });
  } else {
    emitLines({ lines: slackDryRunLines({ mediaFilenames, mentions, plan }), out: deps.out });
  }
  return EXIT_OK;
}

/**
 * Emit the ONE `--json` document on stdout — the exact payload, the readable preview, the steps, the
 * warnings, the mentions and the outcome. Nothing else is ever written to stdout under `--json`, which is
 * what makes `slopweaver slack post --json | jq` a contract rather than a hope.
 */
function emitJsonReport({
  out,
  ...args
}: {
  out: (line: string) => void;
  plan: SlackWritePlan;
  options: SlackCardOptions;
  mediaFilenames: readonly string[];
  mentions: MentionResolution;
  sent: SlackSendResult | null;
  refusal: SlackRefusal | null;
}): void {
  out(slackWriteJson({ report: slackWriteReport(args) }));
}

/**
 * What a repeat of this send is allowed to do. Read from the SAME env the door is handed, exactly as the drip lane
 * does: a repeat the door waived under the override must actually repeat, and a disagreement here is silent and
 * posts nothing.
 */
function resendPolicyFor({
  env,
  options,
}: {
  env: Readonly<Record<string, string | undefined>>;
  options: SlackCardOptions;
}): ResendPolicy {
  return {
    landed: overrideTokens({ env }).includes(DUPLICATE_SEND_OVERRIDE),
    unconfirmed: options.resendUnconfirmed,
  };
}

/**
 * The effectful half: reserve, and route the composite send through the gates already read exactly once, with the
 * uploads already read. Answers what landed as well as the exit code, so a draft's release can mark its row with the
 * card's own `ts`.
 */
async function performSend({
  acknowledgements,
  deps,
  env,
  gates,
  mediaFilenames,
  mentions,
  nowIso,
  options,
  plan,
  token,
  uploads,
}: {
  acknowledgements: readonly DoorAcknowledgement[];
  deps: SlackWriteDeps;
  env: Readonly<Record<string, string | undefined>>;
  gates: readonly DoorGate[];
  mediaFilenames: readonly string[];
  mentions: MentionResolution;
  nowIso: string;
  options: SlackCardOptions;
  plan: SlackWritePlan;
  token: string;
  uploads: readonly SlackUpload[];
}): Promise<{ readonly exitCode: number; readonly sent: SlackSendResult | undefined }> {
  const resend = resendPolicyFor({ env, options });
  const routed = await throughDoor({
    env,
    gates,
    home: options.home,
    ledger: deps.doorLedger,
    perform: async (): Promise<SlackSendResult> =>
      sendCard({ deps, home: options.home, nowIso, plan, resend, token, uploads }),
    request: slackDoorRequest({
      acknowledgements,
      home: options.home,
      mediaCount: mediaFilenames.length,
      plan,
      resendUnconfirmed: options.resendUnconfirmed,
    }),
  });
  if (!routed.performed) {
    const refusal = reportRefusal({ through: routed });
    if (options.json) {
      emitJsonReport({ mediaFilenames, mentions, options, out: deps.out, plan, refusal, sent: null });
    }
    // A door refusal is a status; a store that could not record the decision is a fault.
    return { exitCode: routed.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY, sent: undefined };
  }
  if (options.json) {
    emitJsonReport({ mediaFilenames, mentions, options, out: deps.out, plan, refusal: null, sent: routed.result });
  } else {
    emitLines({ lines: slackSendLines({ result: routed.result }), out: deps.out });
  }
  return { exitCode: EXIT_OK, sent: routed.result };
}
