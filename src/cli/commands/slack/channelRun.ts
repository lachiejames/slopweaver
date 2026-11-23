/**
 * `slack channel` — the effectful SHELL. Every decision is delegated to `./channelCore.ts`; what lives
 * here is the ordering of irreversible steps, which is the part no unit test can make safe.
 *
 * ## The order, and why each step is where it is
 *
 *   resolve invitees → refuse → door → create → invite → purpose → topic
 *
 * 1. **Every invitee resolves BEFORE the channel exists.** A channel cannot be deleted, so a create that
 *    succeeds and then discovers it cannot resolve `@seth` has left a permanent artefact in the workspace
 *    that nobody asked for. Resolution is free and offline; the create is neither.
 * 2. **The create is INSIDE the door and everything after it is inside the same `perform`.** A door
 *    refusal must leave no channel behind, and a mid-sequence failure must still report the channel that
 *    DOES now exist — which it can only do if the id never leaves this function unreported.
 * 3. **A failure after the create is a PARTIAL SUCCESS, not a failure.** The channel is real by then. Retrying
 *    the whole verb would hit `name_taken`, so the exit is non-zero, the id is printed, and the one command
 *    that finishes the job is named. This is the poll lane's own rule, for the same reason.
 * 4. **One bad invitee does not sink the batch.** `conversations.invite` is sent with Slack's `force`, so
 *    the valid ids land and the rest are reported by id and code.
 *
 * `invite` is the create's step 4 on its own, aimed at a channel that already exists: resolve → refuse →
 * door → invite → report, through the one reporter the create uses, so the two cannot drift on what
 * "Slack refused" reads as. It is the verb the ROSTER work needs — putting a team into its own alerts
 * channel — and the invite is not retractable here, which is why the reporter's partial exit is kept.
 */
import { throughDoor } from "../../../admit/effects.js";
import type { DoorGate } from "../../../admit/types.js";
import { NO_AUTHORED_PROSE, voiceProfileGate } from "../../../admit/voiceProfileGate.js";
import { slopweaverHome } from "../../../config.js";
import type { InviteOutcome, OpenedConversation } from "../../../corpus/slack/writeApiConversations.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { channelProse } from "../../../outbound/voice/artifactProse.js";
import type { ProfileReadError } from "../../../profileStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import {
  buildChannelCreatePlan,
  buildChannelInvitePlan,
  type ChannelArchiveOptions,
  type ChannelCreateOptions,
  type ChannelCreatePlan,
  type ChannelInviteOptions,
  type ChannelInvitePlan,
  channelCreateDryRunLines,
  channelInviteDryRunLines,
  channelScopeHint,
  parseChannelArgs,
} from "./channelCore.js";
import { createdChannelLine, describeChannel } from "./channelDescribe.js";
import { channelArchiveDoorRequest, channelCreateDoorRequest, channelInviteDoorRequest } from "./channelDoor.js";
import { type ChannelDeps, liveChannelDeps } from "./channelWiring.js";
import { unreadableProfileExit } from "./voiceAdmission.js";
import { slackVoiceGateInput } from "./voiceGateRead.js";
import { argumentUsageExit, doorOutcome, usageExit } from "./workspaceShapeRun.js";
import { resolveSlackWriteToken } from "./writeToken.js";

/**
 * The create's gate list: the operator's own voice rules over the purpose and the topic.
 *
 * A create is not a send, and that is the whole reason this lane needed saying out loud — a channel's
 * purpose and topic are composed sentences that outlive every message in it, and they sit under whoever
 * minted the channel. The pain point is recorded whatever the door then decides, because the observation is
 * about how the composer writes and is not evidence for or against this particular create.
 *
 * @param deps the injected bag the rules, the hatch environment and the ledger are read through
 * @param home the state home holding the private profile
 * @param plan the fully-decided create
 * @param nowIso the instant the journalled hatch's expiry is judged against
 * @returns the ordered gate list the door runs, or why the voice rules cannot be read
 */
function channelCreateGates({
  deps,
  home,
  plan,
  nowIso,
}: {
  deps: ChannelDeps;
  home: string;
  plan: ChannelCreatePlan;
  nowIso: string;
}): Result<readonly DoorGate[], ProfileReadError> {
  return slackVoiceGateInput({
    actor: plan.actor,
    env: deps.env(),
    home,
    nowIso,
    prose: channelProse({ purpose: plan.purpose, topic: plan.topic }),
    record: true,
    recordVoicePainPoints: deps.recordVoicePainPoints,
    voiceRules: deps.voiceRules,
  }).map((voice) => [voiceProfileGate(voice)]);
}

/**
 * Say what one `conversations.invite` did — who landed, who Slack refused by name, and how many it refused
 * without naming. The ONE reporter both the create and the invite go through.
 *
 * @param deps the injected seams
 * @param outcome what the transport reduced Slack's answer to
 * @param requested how many ids the call asked for, the denominator of the landed line
 * @returns whether anybody did not land, so the caller can report a partial success
 */
function reportInviteOutcome({
  deps,
  outcome,
  requested,
}: {
  deps: ChannelDeps;
  outcome: InviteOutcome;
  requested: number;
}): boolean {
  let partial = false;
  deps.emit(`invited ${String(outcome.landed)}/${String(requested)} person(s)`);
  for (const refusal of outcome.refused) {
    // NEVER silent: an invitee who did not land is a person the author believes is in the channel.
    logger.error({ msg: `Slack refused ${refusal.userId}: ${refusal.code} — invite them by hand` });
    partial = true;
  }
  if (outcome.unattributed.length > 0) {
    // Slack named a failure without naming WHO — measured on this workspace, see `InviteOutcome`. Saying
    // "somebody did not make it, go and look" is the only honest report, and it is still far better than
    // the silence the first version of this gave.
    logger.error({
      msg:
        `Slack refused ${String(outcome.unattributed.length)} invite(s) WITHOUT saying which person ` +
        `(${outcome.unattributed.join(", ")}) — open the channel and check who is actually in it`,
    });
    partial = true;
  }
  return partial;
}

/**
 * Invite, describe and report — everything that happens AFTER the channel is real.
 *
 * Split out so the create's own error handling stays one branch, and because everything here shares one
 * property: a failure is partial, never total. The channel exists.
 *
 * @param created the channel Slack just minted
 * @param deps the injected seams
 * @param home the state home whose private-terms policy judges each write before it is sent
 * @param plan the fully-decided create
 * @param token the token the create ran on
 * @returns the process exit code
 */
async function furnishChannel({
  created,
  deps,
  home,
  plan,
  token,
}: {
  created: OpenedConversation;
  deps: ChannelDeps;
  home: string;
  plan: ChannelCreatePlan;
  token: string;
}): Promise<number> {
  deps.emit(createdChannelLine({ created, plan }));
  let partial = false;
  if (plan.inviteUserIds.length > 0) {
    const outcome = await deps.inviteToChannel({ channel: created.id, home, token, userIds: plan.inviteUserIds });
    partial = reportInviteOutcome({ deps, outcome, requested: plan.inviteUserIds.length });
  }
  partial = (await describeChannel({ created, deps, home, plan, token })) || partial;
  deps.emit("post into it with:");
  deps.emit(`  slopweaver slack post --as ${plan.actor} --channel ${created.id} --shape top-level --form -`);
  if (partial) {
    logger.error({
      msg:
        `PARTIAL SUCCESS — the channel IS created (${created.id}) and was NOT retracted. Finish the parts named ` +
        `above by hand, or archive it with: slopweaver slack channel archive --channel ${created.id}`,
    });
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

/** Run `slack channel create`. */
async function runCreate({ options, deps }: { options: ChannelCreateOptions; deps: ChannelDeps }): Promise<number> {
  const resolved = await deps.resolvePeople({ home: options.home, people: options.invite });
  if (resolved.isErr()) {
    logger.error({ msg: `${resolved.error.message}. Nothing was created.` });
    return EXIT_ERROR;
  }
  const plan = buildChannelCreatePlan({ options, resolved: resolved.value });
  if (plan.isErr()) {
    return usageExit({ errors: plan.error });
  }
  if (options.dryRun) {
    for (const line of channelCreateDryRunLines({ plan: plan.value })) {
      deps.emit(line);
    }
    return EXIT_OK;
  }
  const token = resolveSlackWriteToken({
    actor: options.actor,
    botToken: deps.botToken({ home: options.home }),
    userToken: deps.userToken({ home: options.home }),
  });
  if (token.isErr()) {
    return usageExit({ errors: [token.error.message] });
  }
  const gates = channelCreateGates({ deps, home: options.home, nowIso: new Date().toISOString(), plan: plan.value });
  if (gates.isErr()) {
    return unreadableProfileExit({ error: gates.error, nothingHappened: "nothing was created." });
  }
  const routed = await throughDoor({
    gates: gates.value,
    home: options.home,
    ledger: deps.doorLedger,
    perform: () => createChannel({ deps, home: options.home, plan: plan.value, token: token.value }),
    request: channelCreateDoorRequest({ home: options.home, plan: plan.value }),
  });
  return doorOutcome({ command: "slopweaver slack channel create", nothingHappened: "nothing was created.", routed });
}

/** Mint the channel, then furnish it. Only ever called from inside the door's `perform`. */
async function createChannel({
  deps,
  home,
  plan,
  token,
}: {
  deps: ChannelDeps;
  home: string;
  plan: ChannelCreatePlan;
  token: string;
}): Promise<number> {
  let created: OpenedConversation;
  try {
    created = await deps.createChannel({ home, isPrivate: plan.isPrivate, name: plan.name, token });
  } catch (error) {
    const message = errorMessage({ error });
    logger.error({ msg: `could not create #${plan.name}: ${message}. Nothing was created.` });
    if (message.includes("missing_scope")) {
      logger.error({ msg: channelScopeHint({ actor: plan.actor, isPrivate: plan.isPrivate }) });
    }
    if (message.includes("name_taken")) {
      logger.error({ msg: `#${plan.name} already exists in this workspace — a channel name is workspace-unique.` });
    }
    return EXIT_ERROR;
  }
  return furnishChannel({ created, deps, home, plan, token });
}

/** Run `slack channel invite`. */
async function runInvite({ options, deps }: { options: ChannelInviteOptions; deps: ChannelDeps }): Promise<number> {
  const resolved = await deps.resolvePeople({ home: options.home, people: options.invite });
  if (resolved.isErr()) {
    logger.error({ msg: `${resolved.error.message}. Nobody was invited.` });
    return EXIT_ERROR;
  }
  const plan = buildChannelInvitePlan({ options, resolved: resolved.value });
  if (plan.isErr()) {
    return usageExit({ errors: plan.error });
  }
  if (options.dryRun) {
    for (const line of channelInviteDryRunLines({ plan: plan.value })) {
      deps.emit(line);
    }
    return EXIT_OK;
  }
  const token = resolveSlackWriteToken({
    actor: options.actor,
    botToken: deps.botToken({ home: options.home }),
    userToken: deps.userToken({ home: options.home }),
  });
  if (token.isErr()) {
    return usageExit({ errors: [token.error.message] });
  }
  const routed = await throughDoor({
    // An invite moves people; it authors nothing. Stated with NO_AUTHORED_PROSE rather than an empty list,
    // so a reader sees a lane that was considered instead of one a wiring pass forgot.
    gates: [voiceProfileGate(NO_AUTHORED_PROSE)],
    home: options.home,
    ledger: deps.doorLedger,
    perform: () => inviteIntoChannel({ deps, home: options.home, plan: plan.value, token: token.value }),
    request: channelInviteDoorRequest({ home: options.home, plan: plan.value }),
  });
  return doorOutcome({ command: "slopweaver slack channel invite", nothingHappened: "nobody was invited.", routed });
}

/** Send the invite and report it. Only ever called from inside the door's `perform`. */
async function inviteIntoChannel({
  deps,
  home,
  plan,
  token,
}: {
  deps: ChannelDeps;
  home: string;
  plan: ChannelInvitePlan;
  token: string;
}): Promise<number> {
  let outcome: InviteOutcome;
  try {
    outcome = await deps.inviteToChannel({ channel: plan.channel, home, token, userIds: plan.inviteUserIds });
  } catch (error) {
    const message = errorMessage({ error });
    logger.error({ msg: `could not invite into ${plan.channel}: ${message}. Nobody was invited.` });
    if (message.includes("missing_scope")) {
      // Privacy is not known from an id alone, so the hint names the PUBLIC scope; a private channel wants
      // the groups:write pair the same hint names for a private create.
      logger.error({ msg: channelScopeHint({ actor: plan.actor, isPrivate: false }) });
    }
    return EXIT_ERROR;
  }
  const partial = reportInviteOutcome({ deps, outcome, requested: plan.inviteUserIds.length });
  if (partial) {
    logger.error({
      msg:
        `PARTIAL — the ${String(outcome.landed)} who landed ARE in ${plan.channel} and were not removed. ` +
        "Finish the rest by hand in Slack.",
    });
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

/** Run `slack channel archive`. */
async function runArchive({ options, deps }: { options: ChannelArchiveOptions; deps: ChannelDeps }): Promise<number> {
  if (options.dryRun) {
    deps.emit(`DRY RUN — nothing was archived. slopweaver would: conversations.archive ${options.channel}`);
    deps.emit("  archiving does NOT free the name: it stays taken in this workspace forever.");
    return EXIT_OK;
  }
  const token = resolveSlackWriteToken({
    actor: options.actor,
    botToken: deps.botToken({ home: options.home }),
    userToken: deps.userToken({ home: options.home }),
  });
  if (token.isErr()) {
    return usageExit({ errors: [token.error.message] });
  }
  const routed = await throughDoor({
    // An archive removes a channel from view; it authors nothing. Stated rather than omitted, for the
    // reason the invite above gives.
    gates: [voiceProfileGate(NO_AUTHORED_PROSE)],
    home: options.home,
    ledger: deps.doorLedger,
    perform: async () => {
      const archived = await deps.archiveChannel({ channel: options.channel, home: options.home, token: token.value });
      deps.emit(archived ? `archived ${options.channel}` : `could not archive ${options.channel}`);
      return archived ? EXIT_OK : EXIT_ERROR;
    },
    request: channelArchiveDoorRequest({ actor: options.actor, channel: options.channel, home: options.home }),
  });
  return doorOutcome({ command: "slopweaver slack channel archive", nothingHappened: "nothing was archived.", routed });
}

/** Where the verb's own arguments start in `process.argv`: `[node, script, noun, verb, ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Run `slack channel` against SUPPLIED dependencies.
 *
 * Exported so a test can drive the whole verb with plain fakes and assert that a refusal creates nothing.
 *
 * @param argv the full process argv
 * @param deps the injected dependencies
 * @returns the process exit code
 */
export async function runChannelWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: ChannelDeps;
}): Promise<number> {
  const options = parseChannelArgs({ defaultHome: slopweaverHome(), rest: argv.slice(VERB_ARG_OFFSET) });
  if (options.isErr()) {
    return argumentUsageExit({ error: options.error });
  }
  if (options.value.mode === "create") {
    return runCreate({ deps, options: options.value });
  }
  if (options.value.mode === "invite") {
    return runInvite({ deps, options: options.value });
  }
  return runArchive({ deps, options: options.value });
}

/** `slopweaver slack channel` — create a channel, invite into one, or archive one, through the door. */
export const slackChannelCommand = defineCommand({
  run: (argv) => runChannelWithDeps({ argv, deps: liveChannelDeps() }),
});
