/**
 * The as-me lane of `slopweaver slack post|reply`: prepare, then preview or send through the door once.
 *
 * Split out of `./run.ts` along the seam a draft release needs: `./releaseRun.ts` re-prepares a parked
 * row's words and then sends through {@link sendPreparedDrip} exactly as a fresh send does, so the two share
 * every gate rather than a copy of them.
 */
import { type NotPerformed, notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { type VoiceGateInput } from "../../../admit/voiceProfileGate.js";
import type { SlackUpload } from "../../../corpus/slack/writeTransport.js";
import { prLedSendRefusals } from "../../../outbound/slack/draftPrLead.js";
import { DUPLICATE_SEND_OVERRIDE } from "../../../outbound/slack/duplicateGate.js";
import type { MentionResolution } from "../../../outbound/slack/mentionIndex.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { voiceProseOf } from "./asMeForm.js";
import { overrideTokens } from "./cardSend.js";
import type { SlackDripOptions } from "./coreTypes.js";
import { asMeDatadogMediaFloor } from "./datadogMediaFloor.js";
import {
  type DripOutcome,
  dripFullyLanded,
  type SlackDripPlan,
  type SlackDripReport,
  slackDripDoorRequest,
  slackDripDryRunLines,
  slackDripReport,
} from "./dripCore.js";
import { type DripLastCheck, dripPerform } from "./dripPerform.js";
import { dripGatesFor } from "./dripRun.js";
import { slackDripSendLines } from "./dripSendLines.js";
import { sendOnlyDripRefusals } from "./dripSendPlan.js";
import { claimDripHighStakes } from "./highStakesGate.js";
import { type PreparedDrip, prepareDrip } from "./prepareDrip.js";
import type { SlackWriteDeps } from "./run.js";
import { journalSendFailure, journalUnsentDrip, UNPREPARED_SEND_ERROR } from "./sendFailureJournalling.js";
import { unreadableProfileExit } from "./voiceAdmission.js";
import { emitLines, reportRefusal, usage } from "./writeOutput.js";

/**
 * Run one as-me drip: prepare, then either preview or send.
 *
 * Every step up to and including the plan is `./prepareDrip.ts`'s, shared verbatim with the draft recorder;
 * what this function adds is the two refusals that need a send edge and the send itself. The one structural
 * difference from the card path is at the end: a drip's result is a LIST of outcomes rather than a single
 * send, so a partial send exits non-zero with every message's fate on stdout instead of throwing.
 *
 * @returns the process exit code
 */
export async function runSlackDrip({
  deps,
  options,
  token,
}: {
  deps: SlackWriteDeps;
  options: SlackDripOptions;
  token: string;
}): Promise<number> {
  // READ before stdin or Slack: these bounds and rules decide what may be sent, so an untrustworthy profile stops it.
  const config = deps.dripConfig({ home: options.home });
  const { channel, threadTs } = options;
  if (config.isErr()) {
    journalSendFailure({ channel, errors: [config.error.message], options, threadTs });
    return unreadableProfileExit({ error: config.error, nothingHappened: "nothing was sent." });
  }
  const env = deps.doorEnv();
  let prepared: Awaited<ReturnType<typeof prepareDrip>>;
  try {
    prepared = await prepareDrip({ config: config.value, deps, env, options, token });
  } catch (cause: unknown) {
    // A throw here can carry the form's words, as a parser's does, so it is journalled as the fixed sentence.
    journalSendFailure({ channel, errors: [UNPREPARED_SEND_ERROR], options, threadTs });
    throw cause;
  }
  if (prepared.isErr()) {
    journalSendFailure({ channel, errors: [UNPREPARED_SEND_ERROR], options, threadTs });
    return usage({ errors: prepared.error });
  }
  return (await sendPreparedDrip({ deps, env, options, prepared: prepared.value, token })).exitCode;
}

/**
 * The send half of an as-me drip, from a preparation that already passed: the two refusals that need a send
 * edge, then the preview or the send. Shared by a fresh send and a draft release, so a release runs exactly
 * the gates a fresh send does — and a throw anywhere in it is journalled for both, since the voice must not read
 * a send that did not finish as "not sent yet".
 *
 * @param lastCheck a release's re-read of its row, run after every live gate and again inside the door just before
 *   the drip, so a comparison or a pick that landed while the gates awaited refuses the send
 * @returns the exit code, and every message's fate when the send ran
 */
export async function sendPreparedDrip({
  deps,
  env,
  lastCheck,
  options,
  prepared,
  token,
}: {
  deps: SlackWriteDeps;
  env: Readonly<Record<string, string | undefined>>;
  lastCheck?: DripLastCheck;
  options: SlackDripOptions;
  prepared: PreparedDrip;
  token: string;
}): Promise<{ readonly exitCode: number; readonly outcomes: readonly DripOutcome[] | undefined }> {
  try {
    return await sendPreparedDripUnguarded({ deps, env, lastCheck, options, prepared, token });
  } catch (cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause);
    journalSendFailure({
      channel: prepared.plan.channel,
      errors: [`the send stopped on an error: ${why}`],
      options,
      threadTs: prepared.plan.threadTs,
    });
    throw cause;
  }
}

/**
 * The drip's opening judged first, before the render proof posts anything: the bytes judged are this send's own, so a
 * fresh send, a release and a release's thanks line are each held to the lead rule on what they would actually post.
 * The owner's own bot DM is exempt only once a bot-token read proves it theirs, a read a dry run makes too, so a preview
 * refuses exactly what the send would.
 */
async function dripPrLedRefusals({
  deps,
  options,
  plan,
}: {
  deps: SlackWriteDeps;
  options: SlackDripOptions;
  plan: PreparedDrip["plan"];
}): Promise<readonly string[]> {
  const verifiedOwnDm = await deps.verifiedOwnDm({ channel: plan.channel, home: options.home });
  return prLedSendRefusals({ channel: plan.channel, payload: plan.messages[0]?.payload, verifiedOwnDm });
}

/** {@link sendPreparedDrip} without its throw guard. */
async function sendPreparedDripUnguarded({
  deps,
  env,
  lastCheck,
  options,
  prepared,
  token,
}: {
  deps: SlackWriteDeps;
  env: Readonly<Record<string, string | undefined>>;
  lastCheck: DripLastCheck;
  options: SlackDripOptions;
  prepared: PreparedDrip;
  token: string;
}): Promise<{ readonly exitCode: number; readonly outcomes: readonly DripOutcome[] | undefined }> {
  const { advisory, allowVoiceRules, config, plan, resolution } = prepared;
  const prLed = await dripPrLedRefusals({ deps, options, plan });
  if (prLed.length > 0) {
    return refusedSend({ errors: prLed, options, plan });
  }
  const sendErrors = await sendOnlyDripRefusals({ config, deps, env, options, plan, token });
  if (sendErrors.length > 0) {
    return refusedSend({ errors: sendErrors, options, plan });
  }
  // Before the dry-run branch, so a preview refuses what the send would; the bytes counted are the bytes sent.
  const floor = await asMeDatadogMediaFloor({
    artifact: plan.artifact,
    env,
    home: options.home,
    paths: plan.media,
    readMedia: deps.readMedia,
  });
  if (floor.refusals.length > 0) {
    return refusedSend({ errors: floor.refusals, options, plan });
  }
  if (options.dryRun) {
    emitDripDryRun({ advisory, deps, options, plan, resolution });
    return { exitCode: EXIT_OK, outcomes: undefined };
  }
  // Asked again now that the drip will really go, TAKING a high-stakes channel's claim before its day is re-read.
  const claimed = await claimDripHighStakes({ deps, env, home: options.home, plan, token });
  if (claimed.length > 0) {
    return refusedSend({ errors: claimed, options, plan });
  }
  const moved = lastCheck === undefined ? undefined : lastCheck();
  if (moved !== undefined) {
    return refusedSend({ errors: [moved.message], options, plan });
  }
  // Built from the PLAN's artifact rather than the parsed one: linkification and mention resolution both
  // rewrite runs, and what the door judges has to be the words that actually go out.
  const voice: VoiceGateInput = {
    allowVoiceRules,
    prose: voiceProseOf({ artifact: plan.artifact }),
    rules: config.exactVoiceRules,
  };
  return performDrip({ deps, env, lastCheck, options, plan, preread: floor.uploads, resolution, token, voice });
}

/** A send refused before anything went out: journalled against its destination, ending on the usage exit. */
function refusedSend({
  errors,
  options,
  plan,
}: {
  errors: readonly string[];
  options: SlackDripOptions;
  plan: SlackDripPlan;
}): { readonly exitCode: number; readonly outcomes: undefined } {
  journalSendFailure({ channel: plan.channel, errors, options, threadTs: plan.threadTs });
  return { exitCode: usage({ errors }), outcomes: undefined };
}

/**
 * Preview the drip without sending it, voice findings first.
 *
 * The findings ride ABOVE the preview and are advisory here alone: a dry run performs nothing, so there is
 * no send for the door to refuse, and printing them is the only way a composer learns what the real
 * invocation is about to warn on.
 */
function emitDripDryRun({
  advisory,
  deps,
  options,
  plan,
  resolution,
}: {
  advisory: readonly string[];
  deps: SlackWriteDeps;
  options: SlackDripOptions;
  plan: SlackDripPlan;
  resolution: MentionResolution;
}): void {
  emitDrip({
    json: options.json,
    lines: [...advisory, ...slackDripDryRunLines({ mentions: resolution, plan })],
    out: deps.out,
    report: () => slackDripReport({ mentions: resolution, options, outcomes: null, plan, refusal: null }),
  });
}

/** Print either the readable lines or the one JSON document, never both. */
function emitDrip({
  json,
  lines,
  out,
  report,
}: {
  json: boolean;
  lines: readonly string[];
  out: (line: string) => void;
  report: () => SlackDripReport;
}): void {
  if (json) {
    out(JSON.stringify(report(), null, 2));
    return;
  }
  emitLines({ lines, out });
}

/**
 * Read every media path the plan names, keyed by the path the caller typed.
 *
 * BEFORE the door and before the first `chat.postMessage`, exactly as the card lane loads its own: a path
 * that cannot be read must fail with NOTHING published, never partway through a drip that is already half
 * out under the owner's name. Sequential, so the first unreadable path is the one named in the failure. The Datadog
 * floor's `preread` bytes, when it read any, are the ones sent — never a second read of a path it counted.
 */
async function loadDripMedia({
  deps,
  plan,
  preread,
}: {
  deps: SlackWriteDeps;
  plan: SlackDripPlan;
  preread: ReadonlyMap<string, SlackUpload> | undefined;
}): Promise<ReadonlyMap<string, SlackUpload>> {
  if (preread !== undefined) {
    return preread;
  }
  const uploads = new Map<string, SlackUpload>();
  for (const path of plan.media) {
    uploads.set(path, await deps.readMedia({ path }));
  }
  return uploads;
}

/**
 * Print the door's refusal, and the one JSON document beside it when the caller asked for one, and journal it as a
 * send that did not go out.
 */
function reportDripRefusal({
  deps,
  options,
  plan,
  resolution,
  through,
}: {
  deps: SlackWriteDeps;
  options: SlackDripOptions;
  plan: SlackDripPlan;
  resolution: MentionResolution;
  through: NotPerformed;
}): void {
  journalSendFailure({
    channel: plan.channel,
    errors: notPerformedLines({ command: "slopweaver slack post", through }),
    options,
    threadTs: plan.threadTs,
  });
  const refusal = reportRefusal({ through });
  if (!options.json) {
    return;
  }
  deps.out(JSON.stringify(slackDripReport({ mentions: resolution, options, outcomes: null, plan, refusal }), null, 2));
}

/** The effectful half: gate, route the whole sequence through the door once, then drip. */
async function performDrip({
  deps,
  env,
  lastCheck,
  options,
  plan,
  preread,
  resolution,
  token,
  voice,
}: {
  deps: SlackWriteDeps;
  env: Readonly<Record<string, string | undefined>>;
  lastCheck: DripLastCheck;
  options: SlackDripOptions;
  plan: SlackDripPlan;
  preread: ReadonlyMap<string, SlackUpload> | undefined;
  resolution: MentionResolution;
  token: string;
  voice: VoiceGateInput;
}): Promise<{ readonly exitCode: number; readonly outcomes: readonly DripOutcome[] | undefined }> {
  const nowIso = new Date().toISOString();
  // A deliberate repeat, waived at the door with the override token, must actually REPEAT. Without this
  // the resume logic would recognise every message as already sent and post nothing at all — the exact
  // opposite of what "post it again, I mean it" asks for.
  const deliberateRepeat = overrideTokens({ env }).includes(DUPLICATE_SEND_OVERRIDE);
  const uploads = await loadDripMedia({ deps, plan, preread });
  const api = deps.makeApi({ home: options.home, token });
  const routed = await throughDoor({
    env,
    gates: dripGatesFor({ home: options.home, nowIso, plan, voice }),
    home: options.home,
    ledger: deps.doorLedger,
    perform: dripPerform({ api, deliberateRepeat, lastCheck, options, plan, uploads }),
    request: slackDripDoorRequest({ home: options.home, plan }),
  });
  if (!routed.performed) {
    reportDripRefusal({ deps, options, plan, resolution, through: routed });
    // A door refusal is a status; a store that could not record the decision is a fault.
    return { exitCode: routed.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY, outcomes: undefined };
  }
  if ("moved" in routed.result) {
    const errors = [routed.result.moved];
    journalSendFailure({ channel: plan.channel, errors, options, threadTs: plan.threadTs });
    return { exitCode: usage({ errors }), outcomes: undefined };
  }
  const { outcomes } = routed.result;
  journalUnsentDrip({ channel: plan.channel, options, outcomes, threadTs: plan.threadTs });
  emitDrip({
    json: options.json,
    lines: slackDripSendLines({ channel: plan.channel, outcomes }),
    out: deps.out,
    report: () => slackDripReport({ mentions: resolution, options, outcomes, plan, refusal: null }),
  });
  // A partial drip is a genuine fault, not an "expected empty": something the operator asked for is not
  // in Slack, and a caller scripting this must be able to tell that from a clean run.
  return { exitCode: dripFullyLanded({ outcomes }) ? EXIT_OK : EXIT_ERROR, outcomes };
}
