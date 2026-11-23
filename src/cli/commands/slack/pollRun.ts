/**
 * `slack poll` — the effectful SHELL. Every decision it makes is delegated to `./pollCore.ts` and
 * `./pollResultReport.ts`; what lives here is the ordering of irreversible steps, which is the part that cannot
 * be unit-tested into safety.
 *
 * ## The write order, and why each step is where it is
 *
 *   peek → door → CLAIM THE STORE → reserve → post → confirm
 *
 * 1. **The store record is claimed BEFORE Slack, and a failure REFUSES the send.** A poll carries no Slack
 *    metadata (the transport cannot attach any), so the local record is the ONLY place the ballot exists. A
 *    poll posted without one is permanently uncountable, and quietly degrading to "a message a human can
 *    read" is a different operation from the one that was asked for. `slack post` is the verb for that.
 * 2. **The reservation's verdict is OBEYED.** The card lane calls `reserveSend` and discards what it returns,
 *    so its "two concurrent sends cannot both proceed" comment does not hold at that call site. Here a
 *    `duplicate` verdict stops the send, which is the only thing that makes the atomic claim worth taking.
 * 3. **A confirmation failure after a successful post is a PARTIAL SUCCESS, not a failure.** Slack has the
 *    poll and returned its `ts`; only the local back-reference is missing. Retrying would double-post and
 *    deleting could fail too, replacing a known repairable state with an unknown one. So it exits non-zero,
 *    prints the `ts` and the `poll-id`, keeps the record, and names the one command that repairs it.
 */

import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { type PainPointLane, recordExactVoicePainPoints } from "../../../admit/painPoint.js";
import { slackBotToken, slopweaverHome } from "../../../config.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { logger } from "../../../lib/logger.js";
import { readStdin } from "../../../lib/readStdin.js";
import type { Result } from "../../../lib/result.js";
import { slackDeliveryErrorLines } from "../../../outbound/slack/deliveryErrors.js";
import { type ReactionCount, tallyPoll } from "../../../outbound/slack/pollResults.js";
import { confirmPollRecord } from "../../../outbound/slack/pollStore.js";
import {
  confirmSend,
  DUPLICATE_WINDOW_HOURS,
  reserveSend,
  settleFailedSend,
} from "../../../outbound/slack/sendReservation.js";
import type { ConversationSurface, SlackCardChrome } from "../../../outbound/slack/types.js";
import { pollProse } from "../../../outbound/voice/artifactProse.js";
import type { ExactVoiceRule, ExactVoiceRuleFinding } from "../../../outbound/voice/exactRules.js";
import { type ProfileReadError, readExactVoiceRules } from "../../../profileStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import type { HighStakesDeps } from "./highStakesGate.js";
import { liveHighStakesDeps } from "./highStakesRead.js";
import { reportPosted, seedBallot } from "./pollBallot.js";
import {
  type PollOptions,
  type PollPlan,
  type PollPostOptions,
  type PollResultsOptions,
  parsePollArgs,
} from "./pollCore.js";
import { pollDoorRequest, pollGates, pollSurfaceOrRefusal } from "./pollDoor.js";
import { loadPollForm } from "./pollFormSource.js";
import { type PollPingDeps, resolvePollPings } from "./pollPings.js";
import { composeAndProve, composePollPlan, emitPollDryRun } from "./pollPreview.js";
import { claimOrRefuse, locateRecord } from "./pollRecordSteps.js";
import { type PollResultOutcome, pollResultExit, pollResultLines } from "./pollResultReport.js";
import { liveVerifiedOwnDm, type VerifyOwnDm } from "./verifiedOwnDm.js";
import { unreadableProfileExit } from "./voiceAdmission.js";
import { slackVoiceGateInput } from "./voiceGateRead.js";
import { chromeFromProfile, freshSlackIdsNow, pollEventTypeFromProfile } from "./wiring.js";

/** The injected seams. Each one touches something real, so each is replaceable in a test without a mock. */
export interface PollDeps extends HighStakesDeps, PollPingDeps {
  readonly botToken: (args: { home: string }) => string | undefined;
  /** The door ledger the poll post's decision is recorded through before anything is performed. */
  readonly doorLedger: DoorLedgerPort;
  readonly postPoll: (args: {
    home: string;
    token: string;
    channel: string;
    plan: PollPlan;
  }) => Promise<{ channel: string; ts: string }>;
  /** Seed ONE ballot chip. Returns whether it landed, so a partial seed is recorded rather than assumed. */
  readonly seedReaction: (args: {
    home: string;
    token: string;
    channel: string;
    ts: string;
    name: string;
  }) => Promise<boolean>;
  /** slopweaver's own Slack user id, excluded from every vote count. */
  readonly selfUserId: (args: { token: string }) => Promise<string | undefined>;
  /**
   * What kind of surface the target is, so the footer can state truthfully who sees a vote. `undefined`
   * when Slack could not answer — the send is refused rather than guessed at.
   */
  readonly conversationSurface: (args: { token: string; channel: string }) => Promise<ConversationSurface | undefined>;
  /** The full bot chrome, from the operator's profile. */
  readonly cardChrome: (args: { home: string }) => SlackCardChrome;
  /** The poll's `metadata.event_type`, from the operator's profile chrome. */
  readonly pollEventType: (args: { home: string }) => string;
  /** The LIVE vote read. `undefined` when Slack has no message at that channel/ts. */
  readonly readReactions: (args: {
    token: string;
    channel: string;
    ts: string;
  }) => Promise<readonly ReactionCount[] | undefined>;
  readonly readStdin: () => Promise<string>;
  readonly emit: (line: string) => void;
  readonly nowIso: () => string;
  /** The operator's exact voice rules, for the question, the reason and every option label. */
  readonly voiceRules: (args: { home: string }) => Result<readonly ExactVoiceRule[], ProfileReadError>;
  /** Record exact-rule matches as bounded future-turn guidance; this observation never decides the send. */
  readonly recordVoicePainPoints: (args: {
    home: string;
    findings: readonly ExactVoiceRuleFinding[];
    lane: PainPointLane;
  }) => void;
  /** The environment the voice hatch is read from, injected so the shell resolves it rather than the gate. */
  readonly env: () => Readonly<Record<string, string | undefined>>;
  /** The destination when proven their own bot DM, the one place a PR-led question is not judged. */
  readonly verifiedOwnDm: VerifyOwnDm;
}

/** A transport for a poll WRITE, under the verb's own home: its privacy policy judges every write. */
const pollTransport = ({ home, token }: { home: string; token: string }) => makeSlackWriteTransport({ home, token });

/** A transport for a poll READ, which never consults the write policy, so the ambient home serves. */
const pollReads = ({ token }: { token: string }) => pollTransport({ home: slopweaverHome(), token });

/**
 * The production wiring.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function livePollDeps(): PollDeps {
  return {
    ...liveHighStakesDeps(),
    botToken: ({ home }) => slackBotToken({ home }),
    cardChrome: ({ home }) => chromeFromProfile({ home }),
    conversationSurface: async ({ token, channel }) =>
      (await pollReads({ token }).conversationInfo({ channel })).surface,
    doorLedger: doorLedgerPort(),
    emit: (line) => {
      logger.out({ line: line });
    },
    env: () => process.env,
    nowIso: () => new Date().toISOString(),
    pollEventType: ({ home }) => pollEventTypeFromProfile({ home }),
    postPoll: async ({ home, token, channel, plan }) => {
      const posted = await pollTransport({ home, token }).postPoll({ channel, payload: plan.payload });
      return { channel: posted.channel, ts: posted.ts };
    },
    readReactions: ({ token, channel, ts }) => pollReads({ token }).readReactions({ posted: { channel, ts } }),
    readStdin,
    recordVoicePainPoints: ({ findings, home, lane }) => {
      recordExactVoicePainPoints({ findings, home, lane, tsIso: new Date().toISOString() });
    },
    // The renderer only needs the id; a stale-roster id is left out, so the ping refuses as unresolved.
    resolvePeople: freshSlackIdsNow,
    seedReaction: async ({ home, token, channel, ts, name }) =>
      pollTransport({ home, token }).addReaction({ name, posted: { channel, ts } }),
    selfUserId: async ({ token }) => (await pollReads({ token }).whoAmI()).userId,
    userGroupIds: async ({ token }) => pollReads({ token }).userGroupIds(),
    verifiedOwnDm: liveVerifiedOwnDm,
    voiceRules: ({ home }) => readExactVoiceRules({ home }),
  };
}

/** Print a list of usage errors and return the usage exit code. */
function usage({ errors }: { errors: readonly string[] }): number {
  for (const error of errors) {
    logger.error({ msg: error });
  }
  return EXIT_USAGE;
}

/**
 * Post the poll, settling its reservation if the post THROWS: Slack answering `ok: false` means nothing
 * landed and the reservation is released, while an unread failure keeps it. The error still propagates.
 */
async function postPollSettled({
  deps,
  home,
  plan,
  token,
}: {
  deps: PollDeps;
  home: string;
  plan: PollPlan;
  token: string;
}): Promise<Awaited<ReturnType<PollDeps["postPoll"]>>> {
  try {
    return await deps.postPoll({ channel: plan.channel, home, plan, token });
  } catch (error) {
    settleFailedSend({ duplicateKey: plan.pollId, error, home, nowIso: deps.nowIso() });
    throw error;
  }
}

/** Post the poll, then attach its `ts`. Only ever called from inside the door's `perform`. */
async function sendPoll({
  deps,
  home,
  plan,
  token,
}: {
  deps: PollDeps;
  home: string;
  plan: PollPlan;
  token: string;
}): Promise<number> {
  // The store claim lives INSIDE the door's `perform`, not before it. Claiming earlier looked harmless and was
  // not: a door refusal (a duplicate warn, say) left an unconfirmed record behind, and the NEXT attempt then
  // reported "a previous attempt never confirmed a post, so whether it reached Slack is UNKNOWN" — a scary,
  // wrong message about a send that was correctly refused and never happened. Claiming here keeps "the record
  // exists before Slack does" true while making it conditional on the door actually passing.
  const claimed = claimOrRefuse({ home, nowIso: deps.nowIso(), plan });
  if (claimed !== EXIT_OK) {
    return claimed;
  }
  const reservation = reserveSend({
    duplicateKey: plan.pollId,
    home,
    nowIso: deps.nowIso(),
    windowHours: DUPLICATE_WINDOW_HOURS,
  });
  if (reservation.kind === "duplicate") {
    // OBEYED, unlike the card lane's identical call — an atomic claim that nobody branches on prevents nothing.
    logger.error({
      msg:
        `an identical poll was already reserved at ${reservation.firstSentIso}` +
        `${reservation.sentTs === undefined ? " and its outcome is unknown" : ` and landed as ts ${reservation.sentTs}`}` +
        ". Nothing was sent.",
    });
    return EXIT_EXPECTED_EMPTY;
  }
  const posted = await postPollSettled({ deps, home, plan, token });
  confirmSend({ duplicateKey: plan.pollId, home, nowIso: deps.nowIso(), sentTs: posted.ts });
  const seedReaction: Parameters<typeof seedBallot>[0]["seedReaction"] = (args) => deps.seedReaction({ ...args, home });
  const { seededEmoji, failedEmoji } = await seedBallot({ plan, posted, seedReaction, token });
  const confirmed = confirmPollRecord({
    home,
    nowIso: deps.nowIso(),
    pollId: plan.pollId,
    seededEmoji,
    ts: posted.ts,
  });
  if (confirmed.kind === "failed") {
    logger.error({
      msg:
        `PARTIAL SUCCESS — the poll IS posted (channel ${posted.channel}, ts ${posted.ts}) but its local record ` +
        `could not be updated (${confirmed.reason}). It was NOT resent and NOT deleted. Repair it with: ` +
        `slopweaver slack poll results --channel ${posted.channel} --ts ${posted.ts} --poll-id ${plan.pollId}`,
    });
    return EXIT_ERROR;
  }
  reportPosted({ ballotSize: plan.ballot.length, emit: deps.emit, failedEmoji, posted, seededEmoji });
  return EXIT_OK;
}

/** Run `slack poll` (the post path). */
async function runPost({ options, deps }: { options: PollPostOptions; deps: PollDeps }): Promise<number> {
  const form = await loadPollForm({ readStdin: deps.readStdin, source: options.formSource });
  if (form.isErr()) {
    return usage({ errors: slackDeliveryErrorLines({ error: form.error }) });
  }
  // READ before Slack is asked a group ping's id or the conversation's kind; a dry run refuses the same.
  const nowIso = deps.nowIso();
  const voice = slackVoiceGateInput({
    actor: "bot",
    env: deps.env(),
    home: options.home,
    nowIso,
    prose: pollProse({ artifact: form.value }),
    record: !options.dryRun,
    recordVoicePainPoints: deps.recordVoicePainPoints,
    voiceRules: deps.voiceRules,
  });
  if (voice.isErr()) {
    return unreadableProfileExit({ error: voice.error, nothingHappened: "nothing was posted." });
  }
  const token = deps.botToken({ home: options.home });
  const resolved = await resolvePollPings({ artifact: form.value, deps, home: options.home, token });
  if ("errors" in resolved) {
    return usage({ errors: resolved.errors });
  }
  const pings = resolved.tokens;
  const preview = await composeAndProve({ artifact: form.value, deps, options, pings });
  const verifiedOwnDm = preview.verifiedOwnDm;
  if (options.dryRun) {
    return emitPollDryRun({ ...preview, emit: deps.emit, options });
  }
  if (token?.startsWith("xoxb-") !== true) {
    return usage({ errors: ["`slack poll` needs a Slack BOT token (xoxb-…): run `slopweaver connect slack`"] });
  }
  const surface = await pollSurfaceOrRefusal({ deps, options, token });
  if (surface.isErr()) {
    return usage({ errors: surface.error });
  }
  const plan = composePollPlan({ artifact: form.value, deps, options, pings, surface: surface.value });
  const routed = await throughDoor({
    gates: pollGates({ home: options.home, nowIso, plan, verifiedOwnDm, voice: voice.value }),
    home: options.home,
    ledger: deps.doorLedger,
    perform: () => sendPoll({ deps, home: options.home, plan, token }),
    request: pollDoorRequest({ home: options.home, plan }),
  });
  if (!routed.performed) {
    for (const line of notPerformedLines({ command: "slopweaver slack poll", through: routed })) {
      logger.error({ msg: line });
    }
    logger.error({ msg: "nothing was posted." });
    // A door refusal is a status; a store that could not record the decision is a fault.
    return routed.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY;
  }
  return routed.result;
}

/** Run `slack poll results` (the read path — no network, no writes to Slack). */
async function runResults({ options, deps }: { options: PollResultsOptions; deps: PollDeps }): Promise<number> {
  const located = locateRecord({ options });
  const record = located.record;
  if (record === undefined) {
    const outcome: PollResultOutcome = { kind: "unknown-poll", unreadable: located.unreadable };
    for (const line of pollResultLines({ ...options, outcome, question: undefined, warnings: [] })) {
      deps.emit(line);
    }
    return pollResultExit({ outcome });
  }
  // The repair: re-attach the confirmed ts when a prior run posted but failed to record it. Idempotent.
  if (record.ts === undefined && options.pollId !== undefined) {
    confirmPollRecord({ home: options.home, nowIso: deps.nowIso(), pollId: record.pollId, ts: options.ts });
  }
  const token = deps.botToken({ home: options.home });
  if (token?.startsWith("xoxb-") !== true) {
    return usage({ errors: ["`slack poll results` needs a Slack BOT token (xoxb-…): run `slopweaver connect slack`"] });
  }
  const live = await deps.readReactions({ channel: options.channel, token, ts: options.ts });
  const selfUserId = await deps.selfUserId({ token });
  if (selfUserId === undefined) {
    // Without knowing who WE are, our own seeded chips would be counted as votes. Refusing beats over-counting.
    return usage({ errors: ["cannot determine slopweaver's own Slack user id, so votes cannot be counted"] });
  }
  const outcome: PollResultOutcome =
    live === undefined
      ? { kind: "gone" }
      : {
          kind: "counted",
          tally: tallyPoll({
            emojiNames: record.emojiNames,
            options: record.options,
            reactions: live,
            selfUserId,
          }),
        };
  for (const line of pollResultLines({ ...options, outcome, question: record.question, warnings: [] })) {
    deps.emit(line);
  }
  return pollResultExit({ outcome });
}

/**
 * Where the verb's own arguments start in `process.argv`: `node`, the entry script, the noun, the verb.
 *
 * Not a detail — the router hands the WHOLE argv to a verb, so a handler that reads it from index 0 sees
 * `node` as its first flag. That is the shape of the argv-index defect that passed seventy unit tests in an
 * earlier PR because the fixture disagreed with the real router, and was caught only by running the binary.
 */
const VERB_ARG_OFFSET = 4;

/**
 * Run `slack poll` against SUPPLIED dependencies.
 *
 * Exported so a test can drive the whole verb with plain fakes and assert that a refusal performs no
 * effect. Without this seam the only entry point closes over the live Slack transport, so the module had
 * no test at all — and it is one of the two door-routed external-write modules.
 *
 * @param argv the full process argv
 * @param deps the injected dependencies
 * @returns the process exit code
 */
export async function runPollWithDeps({ argv, deps }: { argv: readonly string[]; deps: PollDeps }): Promise<number> {
  const options: ReturnType<typeof parsePollArgs> = parsePollArgs({
    defaultHome: slopweaverHome(),
    rest: argv.slice(VERB_ARG_OFFSET),
  });
  if (options.isErr()) {
    return usage({ errors: options.error });
  }
  const parsed: PollOptions = options.value;
  return parsed.mode === "post" ? runPost({ deps, options: parsed }) : runResults({ deps, options: parsed });
}

/** `slopweaver slack poll` — post a reaction poll, or read its votes back out of the corpus. */
export const slackPollCommand = defineCommand({ run: (argv) => runPollWithDeps({ argv, deps: livePollDeps() }) });
