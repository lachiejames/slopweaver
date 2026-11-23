/**
 * `slopweaver turn status` — the session doing the work pushes its own live checklist update, self-reported
 * rather than screen-scraped. Every tier, the worker's own hand.
 *
 * ## The gap this closes
 *
 * `turn dispatch --sweep` keeps a `fresh-visible-session` turn's checklist current from the OUTSIDE: it
 * reads the dispatched workspace's own screen and edits the in-flight step to show the last informative
 * line (`../../../live/turn/liveStatus.js`'s `liveStatusFromScreen`). An INLINE turn — the session answering
 * directly, no separate workspace — has no screen to scrape, because it IS the session doing the reasoning.
 * Before this verb existed, that meant zero live status at all: the checklist sat on its capture-time frame
 * for the whole span between `turn brief` and `turn answer`, however long the investigation ran.
 *
 * ## Why `fresh-visible-session` is accepted here too, having once been refused by name
 *
 * The sweep is the DISPATCHER's view of a worker, and it stops the instant the dispatcher stops believing in
 * that worker. Measured on one real ask (`~/.slopweaver/live/slack/asks.jsonl`): the
 * pickup witness returned a false negative, `turn dispatch` appended `dispatch-failed` (`~/.slopweaver/live/slack/asks.jsonl`),
 * and settled the card to "✗ Investigate in a fresh visible session — this turn was abandoned".
 * `dispatch-failed` is one of the kinds `../../../live/ask/lifecycle.js`'s `supersedesDispatch` treats as
 * ENDING a dispatch, so `AskLifecycle.activeDispatch` went undefined and `./dispatchSweep.ts`'s `sweepOne`
 * skipped the ask on every subsequent tick. The worker was alive and investigating for another 40 minutes,
 * and had no entry point of its own, because this verb refused its tier by name. The card stayed frozen on a
 * lie until the owner posted a status update into the thread BY HAND.
 *
 * So the tier gate was protecting a mechanism that is not always there. The rule that replaces it: the SESSION
 * DOING THE WORK may always describe its own progress, and the sweep is a courtesy layered on top for a
 * worker that has not spoken. Both write the same `completed: 1` frame through the same `advanceWorking`
 * primitive, so when both run the later `chat.update` simply wins — and the worker's self-report is the
 * better of the two, being what the session knows rather than what its screen happened to show.
 *
 * The fix is not a new render path — `../../../live/turn/poster.js`'s `liveChecklistAdvancer` already
 * exposes exactly the primitive the sweep uses (`advanceWorking`, over the SAME `chat.update` `turnFrame`
 * renderer `postWorking` used to post the message in the first place). What was missing was an ENTRY POINT: no
 * CLI verb let the model call it directly from its own tool loop, mid-turn. This is that entry point.
 *
 * ## Why it reads the brief rather than taking flags for the ask's identity
 *
 * `--brief` is the same file `turn dispatch`/`turn answer` already read — the session already has its path in
 * scope from the `turn brief` call that started this turn. `TurnRoutingBrief` extends `AskIdentity` and
 * already carries `started` (the capture-time checklist's `turnId`/`workingTs`, reconciled against the
 * ask-lifecycle log at brief-write time — see `./briefCardFlags.ts`'s `resolvedStarted`). Reusing it here means this
 * verb has no second, independently-resolved notion of which checklist message to edit; there is exactly one
 * source of truth, and it is the same one `turn answer` reads.
 *
 * ## Why the responder/ignore gates apply here too
 *
 * A brief file carries no signature — the same reasoning `./run.ts`'s `responderRefused`/ignore check states
 * for `turn answer` applies unchanged here: a hand-edited or replayed brief could name an ask this process has
 * no business posting into, and this verb reaches a real Slack write with no other check standing between
 * the file and the channel.
 */
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import { clampVisible } from "../../../live/turn/answer.js";
import { checkpointCardLine } from "../../../live/turn/checkpointStore.js";
import { liveChecklistAdvancer } from "../../../live/turn/poster.js";
import {
  activityWindowStart,
  CARD_LINE_CAP,
  nowLine,
  progressChecklistSteps,
  stillWorkingLead,
} from "../../../live/turn/progressCard.js";
import { appendProgressLogEvent, type ProgressTimelineEvent, readProgressLog } from "../../../live/turn/progressLog.js";
import { turnTaskLabel } from "../../../live/turn/taskLabel.js";
import type { ExecutionTier } from "../../../live/turn/tier.js";
import { turnErrorLines } from "../../../live/turn/turnErrors.js";
import { latestWorkerActivity } from "../../../live/turn/workerLog.js";
import { announceThisSession } from "../../../live/turn/workerSessionStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { chromeFromProfile, turnChromeFrom } from "../slack/wiring.js";
import {
  botTokenOrRefusal,
  cardAuthorLabel,
  cardEditContext,
  cardEditSupervisor,
  recordCardWrite,
  refuseWith,
} from "./cardGates.js";
import { str, TURN_STATUS_FLAG_SPEC } from "./core.js";
import { budgetWarned, workerBudgetLines } from "./dispatchBudget.js";
import { turnCommandErrorLines } from "./errors.js";
import {
  declarationSummary,
  type StatusDeclaration,
  statusDeclaration,
  statusPushEvents,
  writtenDetail,
} from "./statusDeclaration.js";
import { attemptChecklistAdvance, type LiveChecklistUpdatePlan } from "./sweepCard.js";
import { TURN_STATUS_USAGE } from "./usage.js";

/** Where this verb's own arguments start in `process.argv`: `[node, cli, turn, status, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/** The tiers `turn status` may advance a checklist for — every tier, since every tier has a session in it. */
export type TurnStatusTier = ExecutionTier;

/**
 * Parse the verb's argv tail. Pure — no filesystem, no network, so a bad flag is refused before any effect.
 *
 * @param rest the argv tail after `turn status`
 * @returns the parsed flags, or the rejections
 */
export function parseTurnStatusArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({
    args: rest,
    spec: { boolean: [...TURN_STATUS_FLAG_SPEC.boolean], string: [...TURN_STATUS_FLAG_SPEC.string] },
  });
}

/**
 * Validate the `--tier` flag. Defaults to `inline` — the common case, an inline turn pushing its own update.
 *
 * @param raw the flag's raw string value, or `undefined` when it was not given
 * @returns the accepted tier, or the exact reason an unrecognised or unsupported value was refused
 */
export function turnStatusTierFromFlag({
  raw,
}: {
  raw: string | undefined;
}): { readonly tier: TurnStatusTier } | { readonly error: string } {
  if (raw === undefined) {
    return { tier: "inline" };
  }
  if (raw === "inline" || raw === "read-only-subagent" || raw === "fresh-visible-session") {
    return { tier: raw };
  }
  return {
    error: `--tier must be \`inline\`, \`read-only-subagent\` or \`fresh-visible-session\`, but got \`${raw}\``,
  };
}

/**
 * The exact checklist advance one self-reported status push makes. Pure and total — given the same inputs
 * this emits the same frame forever, which is what makes it assertable without a Slack transport anywhere
 * near it.
 *
 * Renders the WHOLE loop, not one replaced line: the meter, the question, the declared plan with only the
 * live step expanded, and every phase below the fold (`progressChecklistSteps`). Every finding stays on the
 * card, so one told "thread read (47 msgs, 12 PRs named)" three minutes earlier still shows it.
 *
 * `tier` does not pick a step LIST — the plan and stages come from the worker rather than from a fixed
 * per-tier vocabulary. It is still taken and still validated because it is the flag a
 * dispatched worker passes to say which lane it is in, and silently ignoring a flag a caller typed is worse
 * than reading it.
 *
 * @param askIdentity the exact ask whose checklist this advances
 * @param nowDetail the mechanical `now:` line for the running step, when one could be derived
 * @param question the ask's own question, from its brief — what {@link turnTaskLabel} labels the task with
 * @param timeline every stage, plan and review round so far, in order, INCLUDING what this push declares
 * @param started the capture-time checklist's own `turnId`/`workingTs`
 * @param resuming the checkpoint sentence, when this turn is picking up an earlier generation's work
 * @param warned whether the loop's sweep has raised a budget warn on this dispatch
 * @returns the exact `advanceWorking` call to make
 */
export function turnStatusPlan({
  askIdentity,
  nowDetail,
  question,
  resuming,
  started,
  timeline,
  warned = false,
}: {
  askIdentity: { readonly channel: string };
  nowDetail: string | undefined;
  question: string;
  resuming?: string | undefined;
  started: { readonly workingTs: string };
  timeline: readonly ProgressTimelineEvent[];
  warned?: boolean;
}): LiveChecklistUpdatePlan {
  return {
    posted: { channel: askIdentity.channel, ts: started.workingTs },
    steps: progressChecklistSteps({ finished: false, nowDetail, question, resuming, timeline, warned }),
    task: turnTaskLabel({ question }),
  };
}

/**
 * What the worker is doing this minute, counted from the SAME window `turn watch` and the sweep read — the
 * first stage, else the ask's own instant (`activityWindowStart`). A plan is not that start: counting from it
 * here while the ticker counts from the first stage made one card's tool-call count jump between writers.
 *
 * A worker session's transcript is append-only from boot, so counting from the session instead would fold in
 * whatever it did before this ask arrived.
 *
 * @param askTs the asking message's Slack timestamp, the window when no stage has been declared
 * @param nowIso the push's instant
 * @param sessionId this process's own visible-session id — `turn status` runs INSIDE the worker, so its own
 *   session names the command log to read; the dispatch record cannot supply it, holding cmux locators only
 * @param timeline the turn's timeline, including this push
 * @returns the worker's current activity
 */
function pushActivity({
  askTs,
  nowIso,
  sessionId,
  timeline,
}: {
  askTs: string;
  nowIso: string;
  sessionId: string;
  timeline: readonly ProgressTimelineEvent[];
}): ReturnType<typeof latestWorkerActivity> {
  const firstStageIso = timeline.find((event) => event.kind === "stage")?.tsIso;
  const sinceIso = activityWindowStart({ askTs, firstStageIso, nowIso });
  return latestWorkerActivity({ cwd: process.cwd(), sessionId, sinceIso });
}

/**
 * Print the worker's own budget readback for this dispatch, one line each.
 *
 * @param askIdentity the ask whose dispatch budget is read
 * @param home the resolved state home
 */
function printBudgetReadback({ askIdentity, home }: { askIdentity: AskIdentity; home: string }): void {
  for (const line of workerBudgetLines({ askIdentity, home, nowIso: new Date().toISOString() })) {
    logger.out({ line });
  }
}

/** Everything a status push needs to reach Slack, once every gate has passed. */
interface ReadyPush {
  readonly advancer: Pick<ReturnType<typeof liveChecklistAdvancer>, "advanceWorking">;
  readonly plan: LiveChecklistUpdatePlan;
  readonly askIdentity: AskIdentity;
  readonly home: string;
  /** What this push declares — appended to the log only once the Slack edit has actually landed. */
  readonly events: readonly ProgressTimelineEvent[];
  /** How many stages stand behind the card once this push lands. */
  readonly stageCount: number;
  readonly started: { readonly turnId: string; readonly workingTs: string };
}

/**
 * The card writer this push edits through, provenance and all — split out of {@link readyPush} so that
 * function stays under this repo's line cap, and split HERE because the author label is its own decision:
 * `cardAuthorLabel` resolves whether this card is signed by the supervisor or by a dispatched worker.
 *
 * @param askIdentity the ask whose card this edits
 * @param home the resolved state home
 * @param supervisor the visible session making this push
 * @param token the Slack bot token
 * @param turnId the id correlating this edit with its turn
 * @param values the parsed flag values, which may carry an explicit `--model` label
 * @returns the advancer
 */
function statusAdvancer({
  askIdentity,
  home,
  supervisor,
  token,
  turnId,
  values,
}: {
  askIdentity: AskIdentity;
  home: string;
  supervisor: Parameters<typeof cardAuthorLabel>[0]["supervisor"];
  token: string;
  turnId: string;
  values: Readonly<Record<string, string | boolean>>;
}): ReturnType<typeof liveChecklistAdvancer> {
  return liveChecklistAdvancer({
    askIdentity,
    doorLedger: doorLedgerPort(),
    home,
    provenance: {
      modelId: cardAuthorLabel({ askIdentity, home, modelOverride: str({ key: "model", values }), supervisor }),
      supervisor,
    },
    transport: makeSlackWriteTransport({ home, token }),
    turnChrome: turnChromeFrom({ chrome: chromeFromProfile({ home }) }),
    turnId,
  });
}

/**
 * Every gate this verb must pass before it may touch Slack — the brief, the responder/ignore checks, the
 * capture-time checklist ref, the bot token and the visible supervisor — folded into one flat step so
 * {@link runTurnStatus} stays a simple sequence of refusals rather than re-growing the same nested branching
 * this file's own `postAnswer` sibling in `./run.ts` was split apart to avoid.
 *
 * @param declaration the plan, status and step this push declares, already validated as non-empty
 * @param values the parsed flag values
 * @returns everything needed to actually push, or the exact exit code a refusal already reported
 */
function readyPush({
  declaration,
  values,
}: {
  declaration: StatusDeclaration;
  values: Readonly<Record<string, string | boolean>>;
}): ReadyPush | { readonly code: number } {
  const gated = cardEditContext({ usage: TURN_STATUS_USAGE, values, verb: "turn status" });
  if ("code" in gated) {
    return gated;
  }
  const { askIdentity, brief, home, started } = gated;
  // Before anything that needs Slack: the worker's budget readback must survive a card edit that cannot land.
  printBudgetReadback({ askIdentity, home });
  const token = botTokenOrRefusal({ home });
  if (typeof token !== "string") {
    return token;
  }
  const resolved = cardEditSupervisor({ values, verb: "turn status" });
  if (resolved.isErr()) {
    return { code: refuseWith({ code: EXIT_USAGE, errors: turnCommandErrorLines({ error: resolved.error }) }) };
  }
  const supervisor = resolved.value;
  // Re-announced on EVERY push, not only at pickup: a re-seated session would otherwise leave the sweep
  // reading a transcript that stopped growing. Cheap, idempotent, a no-op on an inline turn.
  announceThisSession({ askIdentity, home });
  const nowIso = new Date().toISOString();
  const log = readProgressLog({ askIdentity, home });
  const events = statusPushEvents({ declaration, log, nowIso, worker: supervisor.id });
  if (events.isErr()) {
    return { code: refuseWith({ code: EXIT_USAGE, errors: turnErrorLines({ error: events.error }) }) };
  }
  const timeline = [...log.timeline, ...events.value];
  const activity = pushActivity({ askTs: askIdentity.messageTs, nowIso, sessionId: supervisor.id, timeline });
  return {
    advancer: statusAdvancer({ askIdentity, home, supervisor, token, turnId: started.turnId, values }),
    askIdentity,
    events: events.value,
    home,
    plan: turnStatusPlan({
      askIdentity,
      nowDetail: nowLine({
        callsSoFar: activity.callsSoFar,
        latest: activity.latest,
        nowIso,
        turnClock: stillWorkingLead({ askTs: askIdentity.messageTs, nowIso }),
      }),
      question: brief.question,
      // Asked here rather than once at dispatch, for the same reason the warn is: this verb runs many times
      // across one turn, and a session that inherited a dead one's draft must say so on every write.
      resuming: checkpointCardLine({ askIdentity, home }),
      started,
      timeline,
      warned: budgetWarned({ askIdentity, home, nowIso }),
    }),
    stageCount: timeline.filter((event) => event.kind === "stage").length,
    started,
  };
}

/**
 * Run the status verb.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export async function runTurnStatus(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TURN_STATUS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseTurnStatusArgs({ rest });
  if (parsed.isErr()) {
    return refuseWith({ code: EXIT_USAGE, errors: parsed.error, usage: TURN_STATUS_USAGE });
  }
  const values = parsed.value.values;
  const declared = statusDeclaration({ values });
  if (declared.isErr()) {
    return refuseWith({ code: EXIT_USAGE, errors: declared.error, usage: TURN_STATUS_USAGE });
  }
  const declaration = declared.value;
  const tierOutcome = turnStatusTierFromFlag({ raw: str({ key: "tier", values }) });
  if ("error" in tierOutcome) {
    return refuseWith({ code: EXIT_USAGE, errors: [tierOutcome.error], usage: TURN_STATUS_USAGE });
  }
  const ready = readyPush({ declaration, values });
  if ("code" in ready) {
    return ready.code;
  }
  const said = declarationSummary({ declaration });
  if (values["dry-run"] === true) {
    logger.out({ line: JSON.stringify(ready.plan, null, 2) });
    logger.out({
      line: `dry run — nothing was sent. would advance ${ready.askIdentity.channel} (ts ${ready.started.workingTs}) — ${said} [tier=${tierOutcome.tier}]`,
    });
    return EXIT_OK;
  }
  const outcome = await attemptChecklistAdvance({
    advanceWorking: (p) => ready.advancer.advanceWorking(p),
    plan: ready.plan,
  });
  if (outcome.kind === "failed") {
    return refuseWith({
      code: EXIT_ERROR,
      errors: [`turn status: could not advance the checklist — ${outcome.reason}`],
    });
  }
  // Recorded AFTER the edit landed, never before: a stage written ahead of a failed `chat.update` would put
  // a line on the trail the reader never saw, and the staleness probe reads these same writes.
  for (const event of ready.events) {
    appendProgressLogEvent({ askIdentity: ready.askIdentity, event, home: ready.home });
  }
  recordCardWrite({
    askIdentity: ready.askIdentity,
    detail: clampVisible({ cap: CARD_LINE_CAP, text: writtenDetail({ declaration }) }),
    home: ready.home,
    stageCount: ready.stageCount,
  });
  logger.out({
    line: `turn status: advanced ${ready.askIdentity.channel} (ts ${ready.started.workingTs}) — ${said}`,
  });
  return EXIT_OK;
}

export const turnStatusCommand = defineCommand({ run: runTurnStatus });
