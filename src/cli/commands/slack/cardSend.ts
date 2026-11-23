/**
 * The as-bot CARD send, from the door's duplicate gate to the confirmed reservation — the half of
 * `slopweaver slack post|reply --as bot` that touches the reservation store and the wire.
 *
 * Split out of `./run.ts` so the shell stays a shell. Everything here is reached from inside `throughDoor`'s
 * `perform` (or builds the gates that decide whether `perform` runs), which is what makes "nothing reaches
 * Slack unless the door passed" true by construction.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import type { DoorGate } from "../../../admit/types.js";
import { type VoiceGateInput, voiceProfileGate } from "../../../admit/voiceProfileGate.js";
import type { SlackUpload } from "../../../corpus/slack/writeTransport.js";
import type { Result } from "../../../lib/result.js";
import {
  DUPLICATE_SEND_OVERRIDE,
  destinationLabel,
  duplicateSendGate,
  priorSendFrom,
  RESEND_UNCONFIRMED_REMEDY,
} from "../../../outbound/slack/duplicateGate.js";
import {
  claimSend,
  confirmSend,
  DUPLICATE_WINDOW_HOURS,
  peekSend,
  type ResendPolicy,
  type SendClaim,
  type SendReservation,
  settleFailedSend,
} from "../../../outbound/slack/sendReservation.js";
import type { SlackSendResult } from "../../../outbound/slack/types.js";
import { botArtifactProse } from "../../../outbound/voice/artifactProse.js";
import type { ProfileReadError } from "../../../profileStore.js";
import type { SlackCardOptions, SlackWritePlan } from "./core.js";
import { highStakesRefusals } from "./highStakesGate.js";
import type { SlackWriteDeps } from "./run.js";
import { noFoldRefusals } from "./runAdmit.js";
import { slackVoiceGateInput } from "./voiceGateRead.js";
import { wallRefusalFor } from "./wallCheck.js";

/**
 * What the duplicate gate is told about the prior send, given what the operator has vouched for.
 *
 * `--resend-unconfirmed` IS the answer to the unconfirmed warning — "I read the target, it is not there" — so
 * with it set an unconfirmed prior is not warned about again; the drip lane has always treated a half-sent
 * sequence the same way. It vouches for nothing about a prior that LANDED: that one still warns and still needs
 * the override, because the flag never meant "repeat it".
 */
function priorForGate({
  reservation,
  resendUnconfirmed,
}: {
  reservation: SendReservation;
  resendUnconfirmed: boolean;
}): SendReservation {
  const vouchedFor = resendUnconfirmed && reservation.kind === "duplicate" && reservation.sentTs === undefined;
  return vouchedFor ? { kind: "fresh" } : reservation;
}

/**
 * The gate list for one send.
 *
 * The duplicate gate is built PER SEND from a PEEK, never from a reservation: peeking leaves no trace,
 * so a dry run or a warned-and-abandoned send cannot poison the next attempt. `DEFAULT_GATES` stays
 * empty by design — this gate is parameterised by its snapshot, so it could never be a module constant.
 *
 * @param resendUnconfirmed whether the operator vouched that an unconfirmed prior attempt did not land
 * @param voice the operator's rules, this card's authored prose and whether the named hatch is open
 * @returns the door gates this send is judged by
 */
function gatesFor({
  home,
  nowIso,
  plan,
  resendUnconfirmed,
  voice,
}: {
  home: string;
  nowIso: string;
  plan: SlackWritePlan;
  resendUnconfirmed: boolean;
  voice: VoiceGateInput;
}): readonly DoorGate[] {
  const prior = peekSend({
    duplicateKey: plan.duplicateKey,
    home,
    nowIso,
    windowHours: DUPLICATE_WINDOW_HOURS,
  });
  return [
    ...DEFAULT_GATES,
    voiceProfileGate(voice),
    duplicateSendGate({
      keyed: plan.idempotencyKeyed,
      prior: priorSendFrom({
        destination: destinationLabel({ channel: plan.channel, threadTs: plan.threadTs }),
        duplicateKey: plan.duplicateKey,
        reservation: priorForGate({ reservation: prior, resendUnconfirmed }),
      }),
      unconfirmedRemedy: RESEND_UNCONFIRMED_REMEDY,
      windowHours: DUPLICATE_WINDOW_HOURS,
    }),
  ];
}

/**
 * Raised when the atomic claim was lost — another run holds the reservation for this exact message and the
 * operator has not vouched for sending it again.
 *
 * A thrown error rather than a quiet return, because this is reached from inside `throughDoor`'s `perform`,
 * where the return type is the send RESULT. Fabricating a result would be reporting a send that did not happen.
 */
class DuplicateSendError extends Error {
  constructor({ claim }: { claim: Exclude<SendClaim, { kind: "send" }> }) {
    super(
      claim.kind === "unconfirmed"
        ? `an identical message was already reserved at ${claim.reservedIso} and its outcome is unknown — read ` +
            `the target; if it is not there, ${RESEND_UNCONFIRMED_REMEDY}. Nothing was sent.`
        : `an identical message already landed as ts ${claim.ts} — if the repeat is deliberate, re-run with ` +
            `SLOPWEAVER_DOOR_OVERRIDE=${DUPLICATE_SEND_OVERRIDE}. Nothing was sent.`,
    );
    this.name = "DuplicateSendError";
  }
}

/**
 * The admitted card send itself: claim, post, confirm. Only ever called from inside `throughDoor`'s
 * `perform`, which is what makes "nothing reaches Slack unless the door passed" true by construction.
 *
 * @param resend which prior outcomes the operator has explicitly allowed to be sent again
 * @param clockIso read once AFTER the Slack attempt, to date the reservation's settlement or confirmation
 * @returns Slack's confirmation of the posted card
 */
export async function sendCard({
  clockIso = () => new Date().toISOString(),
  deps,
  home,
  nowIso,
  plan,
  resend,
  token,
  uploads,
}: {
  clockIso?: () => string;
  deps: Pick<SlackWriteDeps, "makeApi">;
  home: string;
  nowIso: string;
  plan: SlackWritePlan;
  resend: ResendPolicy;
  token: string;
  uploads: readonly SlackUpload[];
}): Promise<SlackSendResult> {
  // The ATOMIC claim: an O_EXCL create, so two concurrent identical sends cannot both proceed.
  //
  // The verdict is OBEYED, and it is the SHARED verdict. It used to be discarded, which made the sentence above
  // false at this very line: the reservation file was created, nothing read the answer, and two simultaneous
  // identical `slack post` runs both posted. The fix then refused EVERY duplicate here — including the one the
  // door had just admitted under the override, and the one `--resend-unconfirmed` vouched for — so "post it
  // again, I mean it" was admitted at the door and refused one line later. `claimSend` is what the drip lane
  // decides with, so the two lanes cannot disagree about what the operator's flags permit.
  const claim = claimSend({
    duplicateKey: plan.duplicateKey,
    home,
    nowIso,
    resend,
    windowHours: DUPLICATE_WINDOW_HOURS,
  });
  if (claim.kind !== "send") {
    throw new DuplicateSendError({ claim });
  }
  let result: SlackSendResult;
  try {
    result = await postByForm({ deps, home, plan, token, uploads });
  } catch (error) {
    // Slack answered `ok: false` (`channel_not_found`, say) ⇒ nothing landed, and the reservation is released
    // rather than left to block every retry for a day. An unread failure keeps it, unconfirmed — honest.
    settleFailedSend({ duplicateKey: plan.duplicateKey, error, home, nowIso: clockIso() });
    throw error;
  }
  // Measure the window from the last REAL send, not the first attempt, and record the `ts` so a later run
  // can tell a CONFIRMED send from a reservation whose outcome nobody ever learned.
  confirmSend({ duplicateKey: plan.duplicateKey, home, nowIso: clockIso(), sentTs: result.ts });
  return result;
}

/**
 * Post one plan through the call its FORM takes, dispatched on the plan's own discriminant.
 *
 * The two calls are genuinely different wire shapes — the card sends an attachment wrapper and can attach
 * media through a follow-up `chat.update`, the no-fold message sends top-level blocks and must never grow a
 * wrapper — and the correlated plan union is what stops a no-fold artifact reaching the card call by
 * accident. `uploads` is ignored on the no-fold arm because `slack post` refuses `--media` on that form
 * before anything is read from disk, so a non-empty array cannot reach here.
 *
 * @param plan the fully-decided send
 * @param deps the injected world
 * @param token the Slack bot token
 * @param uploads the files to attach, card lane only
 * @returns Slack's confirmation of the posted message
 */
async function postByForm({
  plan,
  deps,
  token,
  home,
  uploads,
}: {
  plan: SlackWritePlan;
  deps: Pick<SlackWriteDeps, "makeApi">;
  token: string;
  home: string;
  uploads: readonly SlackUpload[];
}): Promise<SlackSendResult> {
  const api = deps.makeApi({ home, token });
  const threadArg = plan.threadTs !== undefined ? { threadTs: plan.threadTs } : {};
  if (plan.kind === "no-fold") {
    return api.sendNoFold({ channel: plan.channel, payload: plan.payload, recurrence: plan.recurrence, ...threadArg });
  }
  return api.sendComposite({ channel: plan.channel, payload: plan.payload, uploads: [...uploads], ...threadArg });
}

/**
 * The override tokens in force, parsed the same way the door parses them.
 *
 * Read from the SAME env object the door is handed, so the two can never disagree about whether a repeat
 * was authorised — a disagreement here is silent and posts nothing.
 *
 * @param env the environment the door itself reads
 * @returns the override tokens in force, possibly none
 */
export function overrideTokens({ env }: { env: Readonly<Record<string, string | undefined>> }): readonly string[] {
  const raw = env["SLOPWEAVER_DOOR_OVERRIDE"];
  return raw === undefined ? [] : raw.split(",").map((token) => token.trim());
}

/**
 * The refusals a card earns from where it lands and what it carries, before the door: a top-level post into a
 * high-stakes channel (`./highStakesGate.ts`), the wall of bot messages a reply would
 * extend, then a no-fold message's media and folding payload. The first that refuses is the one reported, so
 * a reply over the wall never reaches the no-fold check.
 *
 * @param env the same environment the door is handed, for the hatches
 * @param formKind the bot form that produced the card, which the high-stakes gate admits only as a finding
 * @param home the Slopweaver home, for the high-stakes list and its journalled hatch grants
 * @param media the media paths the invocation asked for
 * @param plan the rendered card this send would post
 * @param token the bot token the wall's thread read is made with
 * @returns the refusal lines, or empty when the card may go on to the door
 */
export async function cardShapeRefusals({
  deps,
  env,
  formKind,
  home,
  media,
  plan,
  token,
}: {
  deps: SlackWriteDeps;
  env: Readonly<Record<string, string | undefined>>;
  formKind: string;
  home: string;
  media: readonly string[];
  plan: SlackWritePlan;
  token: string;
}): Promise<readonly string[]> {
  const { channel, threadTs } = plan;
  const highStakes = await highStakesRefusals({ channel, claim: false, deps, env, formKind, home, threadTs, token });
  if (highStakes.length > 0) {
    return highStakes;
  }
  const wall = await wallRefusalFor({
    actor: "bot",
    channel: plan.channel,
    deps,
    env,
    home,
    newMessageCount: 1,
    threadTs: plan.threadTs,
    token,
  });
  return wall.length > 0 ? wall : noFoldRefusals({ media, plan });
}

/**
 * The bot card lane's gate list, and the voice pain points it records on the way.
 *
 * The pain point is recorded whether the door then admits the send or not — that advisory-record /
 * blocking-decision split is the as-me lane's own pattern, extended, and it is what feeds
 * `painPointGuidanceLines` back into the brief that composes the next card.
 *
 * @param deps the injected world, for the operator's rules and the pain-point ledger
 * @param env the same environment the door is handed, so the hatch cannot be read from two places
 * @param nowIso the instant this send is judged at
 * @param options the parsed invocation
 * @param plan the rendered card this send would post
 * @param record whether to write rule matches down; a dry run passes `false` and writes nothing
 * @returns the door gates this card is judged by, or why the profile holding the voice rules cannot be trusted
 */
export function botCardGates({
  deps,
  env,
  nowIso,
  options,
  plan,
  record,
}: {
  deps: SlackWriteDeps;
  env: Readonly<Record<string, string | undefined>>;
  nowIso: string;
  options: SlackCardOptions;
  plan: SlackWritePlan;
  record: boolean;
}): Result<readonly DoorGate[], ProfileReadError> {
  return slackVoiceGateInput({
    actor: "bot",
    env,
    home: options.home,
    nowIso,
    prose: botArtifactProse({ artifact: plan.artifact }),
    record,
    recordVoicePainPoints: deps.recordVoicePainPoints,
    voiceRules: deps.voiceRules,
  }).map((voice) =>
    gatesFor({ home: options.home, nowIso, plan, resendUnconfirmed: options.resendUnconfirmed, voice }),
  );
}
