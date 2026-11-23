/**
 * `slopweaver turn block` — the turn has got as far as it can, and one step needs the owner.
 *
 * The worked case: someone asks the bot to deploy a Datadog monitor, the deploy needs a local Google Cloud
 * sign-in, and only the owner can do that sign-in — a chore they do about once a day. Two triggers are the
 * whole trigger set: signing in, and approving something risky. The second is a standing principle on its
 * own: if it is risky, tag the owner first and do not proceed until the owner gives the go ahead.
 *
 * ## What one call does, and the order it does it in
 *
 * 1. **The durable event first**, so the ask is recorded NOT DONE even if everything after this dies. That
 *    ordering is the point of the whole feature: an ask that stopped short and is not on the log as stopped
 *    short is one a later sweep reads as a live dispatch, expires the lease of, and re-admits as stranded —
 *    which is the turn being silently re-run rather than resumed.
 * 2. **The card**, edited in place so the last step wears the hourglass and nothing on it says failed.
 * 3. **The in-thread tag**, so the asker and anyone watching can see what the hold-up actually is.
 * 4. **A second `blocked-on-human` event carrying the tag's own `ts`**, appended only once the tag is
 *    standing. Two events for one block, deliberately, and the same intended-then-confirmed shape
 *    `../../../live/ask/lifecycle.ts` already uses for `triage-cleanup-intended`/`triaged-no-response`: the
 *    fold takes the last, so the confirmed one wins, and a crash between them leaves the ask correctly
 *    blocked with no tag recorded rather than correctly tagged with no block recorded.
 * 5. **On a browser sign-in (`--sign-in-url`), the `turn-signed-out` monitor fires at once** — a floating note and a
 *    top-of-queue card saying to log into that origin, opened in the owner's work Chrome. The aim is that
 *    anything useful is reachable before the bot answers, so the card says to log into the origin right now. Through the monitor lane rather than
 *    `hand post`, because only the chair posts a note by hand and this verb runs in a bot seat.
 *
 * ## What it does NOT do
 *
 * It never settles a lifecycle reaction. The tagged message keeps the capture `:eyes:`, because the turn is
 * genuinely still being worked — the eyes are replaced with a tick when
 * the answer finally posts, and swapping it to a warning halfway would be the failure look the card is
 * carefully avoiding, printed on the message everyone scrolls past.
 *
 * It never REFUSES for want of a Slack token, either, and that is the same reasoning one layer down: the
 * durable half of this state is the fact that the ask is not done, and declining to record that because
 * Slack is unreachable would turn a bad connection into a turn that silently reads as finished. With no
 * token the event is written and both Slack halves are REPORTED as not attempted — which is also what makes
 * this verb's whole ordering provable offline.
 *
 * It never keeps the session alive waiting. Entering this state ends the dispatch, so the worker finishes
 * and gives back its lease, its burst slot and the single bot listener token this machine runs one of — a
 * turn sitting blocked for a week while holding that token would put every other ask behind a sign-in the owner has
 * not done yet.
 */

import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { slackBotToken } from "../../../config.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import type { BlockedNeed, BlockedOnHumanEvent } from "../../../live/ask/lifecycle.js";
import { appendAskLifecycleEvent } from "../../../live/ask/store.js";
import { askerDisplayNames } from "../../../live/turn/askerNames.js";
import { turnBlockedForm } from "../../../live/turn/blockedForm.js";
import { blockedCardDetail, blockedStepText } from "../../../live/turn/blockedOnHuman.js";
import { liveChecklistAdvancer, liveNoticePoster, ownerTag } from "../../../live/turn/poster.js";
import { progressChecklistSteps } from "../../../live/turn/progressCard.js";
import {
  appendProgressLogEvent,
  type ProgressStageEvent,
  type ProgressTimelineEvent,
  readProgressLog,
} from "../../../live/turn/progressLog.js";
import { slackUserIdsIn } from "../../../live/turn/quotedQuestion.js";
import { turnTaskLabel } from "../../../live/turn/taskLabel.js";
import { type IdentityRosterPort, identityRosterPort } from "../../../silver/identityRoster.js";
import type { SupervisorSession } from "../../../supervisor/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { productionMonitorDeps } from "../monitor/deps.js";
import { chromeFromProfile, turnChromeFrom } from "../slack/wiring.js";
import { type BlockInputs, turnBlockInputs } from "./blockInputs.js";
import { TURN_BLOCK_USAGE } from "./blockUsage.js";
import { cardAuthorLabel, cardEditContext, cardEditSupervisor, recordCardWrite, refuseWith } from "./cardGates.js";
import { str, TURN_BLOCK_FLAG_SPEC } from "./core.js";
import { turnCommandErrorLines } from "./errors.js";
import { fireTurnSignedOut } from "./signInCard.js";
import { attemptChecklistAdvance, type LiveChecklistUpdatePlan } from "./sweepCard.js";

/** Where this verb's own arguments start in `process.argv`: `[node, cli, turn, block, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/**
 * Parse the verb's argv tail. Pure — no filesystem, no network, so a bad flag is refused before any effect.
 *
 * @param rest the argv tail after `turn block`
 * @returns the parsed flags, or the rejections
 */
export function parseTurnBlockArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({
    args: rest,
    spec: { boolean: [...TURN_BLOCK_FLAG_SPEC.boolean], string: [...TURN_BLOCK_FLAG_SPEC.string] },
  });
}

/**
 * The exact checklist frame a block writes: the whole trail, with the last step wearing the hourglass. Pure.
 *
 * @param askIdentity the exact ask whose checklist this advances
 * @param need which of the two shapes this block is
 * @param question the ask's own question, from its brief
 * @param started the capture-time checklist's own `turnId`/`workingTs`
 * @param timeline every stage, plan and review round so far, INCLUDING the blocked stage this call just appended
 * @returns the exact `advanceWorking` call to make
 */
export function turnBlockPlan({
  askIdentity,
  need,
  question,
  started,
  timeline,
}: {
  askIdentity: { readonly channel: string };
  need: BlockedNeed;
  question: string;
  started: { readonly workingTs: string };
  timeline: readonly ProgressTimelineEvent[];
}): LiveChecklistUpdatePlan {
  return {
    posted: { channel: askIdentity.channel, ts: started.workingTs },
    steps: progressChecklistSteps({
      blocked: { detail: blockedCardDetail({ need }) },
      finished: false,
      nowDetail: undefined,
      question,
      timeline,
    }),
    task: turnTaskLabel({ question }),
  };
}

/** Everything one block needs once every gate has passed. */
interface ReadyBlock {
  readonly askIdentity: AskIdentity;
  readonly home: string;
  readonly inputs: BlockInputs;
  readonly modelId: string;
  readonly plan: LiveChecklistUpdatePlan;
  readonly question: string;
  readonly stage: ProgressStageEvent;
  /** How many stages stand behind the card this block writes, the blocked one included. */
  readonly stageCount: number;
  readonly supervisor: SupervisorSession;
  readonly started: { readonly turnId: string; readonly workingTs: string };
  /** The bot token, when one is configured. Absent means the two Slack halves are reported, never attempted. */
  readonly token: string | undefined;
}

/**
 * Every gate this verb must pass before it may touch Slack, folded into one flat step — the same five
 * `./status.ts` passes, from the same `./cardGates.ts`.
 *
 * @param inputs the need and the sentence, already validated
 * @param values the parsed flag values
 * @returns everything needed to actually block, or the exact exit code a refusal already reported
 */
function readyBlock({
  inputs,
  values,
}: {
  inputs: BlockInputs;
  values: Readonly<Record<string, string | boolean>>;
}): ReadyBlock | { readonly code: number } {
  const gated = cardEditContext({ usage: TURN_BLOCK_USAGE, values, verb: "turn block" });
  if ("code" in gated) {
    return gated;
  }
  const { brief, home, started } = gated;
  const resolved = cardEditSupervisor({ values, verb: "turn block" });
  if (resolved.isErr()) {
    return { code: refuseWith({ code: EXIT_USAGE, errors: turnCommandErrorLines({ error: resolved.error }) }) };
  }
  const supervisor = resolved.value;
  const askIdentity = gated.askIdentity;
  const token = slackBotToken({ home });
  const stage: ProgressStageEvent = {
    kind: "stage",
    text: blockedStepText({ what: inputs.what }),
    tsIso: new Date().toISOString(),
    worker: supervisor.id,
  };
  const timeline = [...readProgressLog({ askIdentity, home }).timeline, stage];
  return {
    askIdentity,
    home,
    inputs,
    modelId: cardAuthorLabel({
      askIdentity,
      home,
      modelOverride: str({ key: "model", values }),
      supervisor,
    }),
    plan: turnBlockPlan({ askIdentity, need: inputs.need, question: brief.question, started, timeline }),
    question: brief.question,
    stage,
    stageCount: timeline.filter((event) => event.kind === "stage").length,
    started,
    supervisor,
    token,
  };
}

/**
 * Run the block verb.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export async function runTurnBlock(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TURN_BLOCK_USAGE });
    return EXIT_OK;
  }
  const parsed = parseTurnBlockArgs({ rest });
  if (parsed.isErr()) {
    return refuseWith({ code: EXIT_USAGE, errors: parsed.error, usage: TURN_BLOCK_USAGE });
  }
  const values = parsed.value.values;
  const read = turnBlockInputs({ values });
  if (read.kind === "invalid") {
    return refuseWith({ code: EXIT_USAGE, errors: read.problems, usage: TURN_BLOCK_USAGE });
  }
  return blockTurn({ inputs: read.inputs, values });
}

/**
 * Block a turn on the owner from inputs already read — the one effect path `turn block` and `turn reach` share,
 * so a block entered because a reachability check found a page signed out is the same four steps in the same order.
 *
 * @param inputs the need, the sentence and, on a browser sign-in, its origin
 * @param values the caller's parsed flags — `--brief`, `--home`, `--model`, `--session-url`, `--dry-run`
 * @returns the process exit code
 */
export async function blockTurn({
  inputs,
  values,
}: {
  inputs: BlockInputs;
  values: Readonly<Record<string, string | boolean>>;
}): Promise<number> {
  const ready = readyBlock({ inputs, values });
  if ("code" in ready) {
    return ready.code;
  }
  if (values["dry-run"] === true) {
    logger.out({ line: JSON.stringify(ready.plan, null, 2) });
    logger.out({
      line: `dry run — nothing was sent, nothing was recorded. would block ${ready.askIdentity.channel}/${ready.askIdentity.messageTs} on the owner [need=${ready.inputs.need}]`,
    });
    return EXIT_OK;
  }
  return block({ ready });
}

/**
 * The summary line's tag clause: the in-thread tag's own ts, or that the tag was not posted.
 *
 * @param tagTs the posted tag's ts, `undefined` when it did not post
 * @returns the clause, `tag=` and what became of the tag
 */
function tagClause({ tagTs }: { tagTs: string | undefined }): string {
  if (tagTs === undefined) {
    return "tag=not posted";
  }
  return `tag=${tagTs}`;
}

/**
 * Record the block, show it, and tag the owner — in that order, for the reason this file's header states.
 *
 * @param ready everything the gates resolved
 * @returns the process exit code
 */
async function block({ ready }: { ready: ReadyBlock }): Promise<number> {
  const { askIdentity, home, inputs, started } = ready;
  const event: BlockedOnHumanEvent = {
    ...askIdentity,
    kind: "blocked-on-human",
    need: inputs.need,
    stepText: ready.stage.text,
    tsIso: ready.stage.tsIso,
    what: inputs.what,
    ...(inputs.signInOrigin === undefined ? {} : { signInOrigin: inputs.signInOrigin }),
  };
  appendAskLifecycleEvent({ event, home });
  const advanced = await showBlockedCard({ ready });
  const tagTs = await tagOwner({ ready });
  if (tagTs !== undefined) {
    appendAskLifecycleEvent({ event: { ...event, tagTs, tsIso: new Date().toISOString() }, home });
  }
  if (inputs.signInOrigin !== undefined) {
    // Last, and never able to undo what is above: the block is recorded and shown whether or not the card posts.
    await fireTurnSignedOut({
      bySession: ready.supervisor.id,
      deps: productionMonitorDeps(),
      home,
      verb: "turn block",
    });
  }
  logger.out({
    line:
      `turn block: ${askIdentity.channel}/${askIdentity.messageTs} is waiting on the owner — ` +
      `${inputs.what} [need=${inputs.need}, card=${advanced ? "hourglass shown" : "NOT advanced"}, ` +
      `${tagClause({ tagTs })}]`,
  });
  logger.out({
    line:
      `when the owner has done it: slopweaver turn unblock --channel ${askIdentity.channel} ` +
      `--message-ts ${askIdentity.messageTs} --note "<what the owner did>"`,
  });
  logger.out({ line: `the card this resumes is ${askIdentity.channel} ts ${started.workingTs} — it stays standing` });
  return EXIT_OK;
}

/**
 * Put the hourglass on the card, and record the stage only once the edit has actually landed.
 *
 * A stage written ahead of a failed `chat.update` would put a line on the trail the reader never saw — the
 * same ordering `./status.ts` keeps, and for the same reason.
 *
 * @param ready everything the gates resolved
 * @returns whether the card now shows the block
 */
async function showBlockedCard({ ready }: { ready: ReadyBlock }): Promise<boolean> {
  const token = ready.token;
  if (token === undefined) {
    logger.error({ msg: "turn block: the card was not advanced — no Slack bot token is configured" });
    return false;
  }
  const advancer = liveChecklistAdvancer({
    askIdentity: ready.askIdentity,
    doorLedger: doorLedgerPort(),
    home: ready.home,
    provenance: { modelId: ready.modelId, supervisor: ready.supervisor },
    transport: makeSlackWriteTransport({ home: ready.home, token }),
    turnChrome: turnChromeFrom({ chrome: chromeFromProfile({ home: ready.home }) }),
    turnId: ready.started.turnId,
  });
  const outcome = await attemptChecklistAdvance({
    advanceWorking: (plan) => advancer.advanceWorking(plan),
    plan: ready.plan,
  });
  if (outcome.kind === "failed") {
    logger.error({ msg: `turn block: the card could not be advanced — ${outcome.reason}` });
    return false;
  }
  appendProgressLogEvent({ askIdentity: ready.askIdentity, event: ready.stage, home: ready.home });
  recordCardWrite({
    askIdentity: ready.askIdentity,
    detail: blockedCardDetail({ need: ready.inputs.need }),
    home: ready.home,
    stageCount: ready.stageCount,
  });
  return true;
}

/**
 * The names the blocked card's quoted question reads its asker ids as, over one read of the store's roster.
 *
 * A store that cannot be read is REPORTED and the card names nobody, so each id renders as itself — the
 * honest answer `questionForPlainField` already gives an id the door cannot place. That is this path's
 * standing contract rather than a fallback: the tag is the courtesy on top of a block that still stands.
 *
 * @param identityRoster the door the store's roster is read through, built by {@link tagOwner} beside its other ports
 * @param ready everything the gates resolved; its question carries the ids
 * @returns the display name per id that resolved
 */
async function blockedCardNames({
  identityRoster,
  ready,
}: {
  identityRoster: IdentityRosterPort;
  ready: ReadyBlock;
}): Promise<Readonly<Record<string, string>>> {
  const slackIds = slackUserIdsIn({ question: ready.question });
  if (slackIds.length === 0) {
    return {};
  }
  const roster = await identityRoster.read({ home: ready.home });
  if (roster.isErr()) {
    logger.error({ msg: `turn block: the card names no asker — ${roster.error.message}` });
    return {};
  }
  return askerDisplayNames({
    askedAtIso: new Date().toISOString(),
    home: ready.home,
    identityRoster: roster.value,
    slackIds,
  });
}

/**
 * Post the in-thread tag, and never throw over it.
 *
 * A failed tag is REPORTED and the block still stands, because the durable event and the card are the two
 * things the ask's honesty depends on and the tag is the courtesy on top. The inverse — abandoning a
 * recorded block because Slack refused one message — would leave the turn recorded as waiting with nothing
 * on the surface saying so, which is the silent stall rule 6 names as the most expensive failure here.
 *
 * @param ready everything the gates resolved
 * @returns the tag message's own `ts`, or `undefined` when nothing was posted
 */
async function tagOwner({ ready }: { ready: ReadyBlock }): Promise<string | undefined> {
  const token = ready.token;
  if (token === undefined) {
    logger.error({ msg: "turn block: the in-thread tag was not posted — no Slack bot token is configured" });
    return undefined;
  }
  const { key, mentions } = ownerTag({ home: ready.home });
  const poster = liveNoticePoster({
    askIdentity: ready.askIdentity,
    chrome: chromeFromProfile({ home: ready.home }),
    doorLedger: doorLedgerPort(),
    home: ready.home,
    mentions,
    transport: makeSlackWriteTransport({ home: ready.home, token }),
    turnId: ready.started.turnId,
  });
  const card = turnBlockedForm({
    modelId: ready.modelId,
    // Straight to the door rather than through a poster seam: this verb already holds the state home, and
    // the card's `tldr` quotes the question, which the gate refuses raw — `live/turn/quotedQuestion.ts`.
    names: await blockedCardNames({ identityRoster: identityRosterPort(), ready }),
    need: ready.inputs.need,
    question: ready.question,
    what: ready.inputs.what,
    ...(key === undefined ? {} : { ownerMention: key }),
  });
  try {
    const posted = await poster.postNotice({ card });
    return posted.ts;
  } catch (error) {
    logger.error({
      msg: `turn block: the in-thread tag was not posted — ${error instanceof Error ? error.message : String(error)}`,
    });
    return undefined;
  }
}

export const turnBlockCommand = defineCommand({ run: runTurnBlock });
