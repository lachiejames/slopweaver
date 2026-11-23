/**
 * `slopweaver turn unblock` — the owner did the thing, so the turn picks up from where it stopped.
 *
 * The resume half of the block design: whenever the owner does the thing, which might be one minute or one
 * week later, the progress resumes. The turn is resumable, so eventually the progress card is deleted, the
 * final answer is posted, the eyes emoji is replaced with a tick emoji and the local state says it is done.
 *
 * ## Run by a VISIBLE session, never by a poller
 *
 * Nothing here watches for a credential coming back. Rule 2's property is visibility, and "the block cleared
 * itself" is a claim no file on this machine can honestly make about a person — so the fact that the owner has done
 * it enters the system the same way every other fact about them does: a session they can see records it. The
 * session learns it from the owner however they say it (a word to the supervisor, a reply in the thread, a reaction
 * on the briefing card); this verb is what makes that durable.
 *
 * ## It lifts the block and prints the resume; it does not dispatch
 *
 * Re-dispatching is `turn dispatch`'s job and it needs a routing judgement, which is a model act belonging
 * in the visible session — the same split `../../../live/listen/stranded.ts` documents for a stranded ask.
 * So this verb ends by printing the exact `turn dispatch` line, over the SAME brief and the SAME card, and
 * the session runs it. What it must never do is post a fresh capture checklist: the card the hourglass is
 * standing on is the one that has to resume, or the trail this shape keeps is lost.
 */

import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { AskLifecycle, UnblockedEvent } from "../../../live/ask/lifecycle.js";
import { appendAskLifecycleEvent, capturedAskFor } from "../../../live/ask/store.js";
import { resumedCardDetail } from "../../../live/turn/blockedOnHuman.js";
import { readBrief } from "../../../live/turn/briefStore.js";
import { liveChecklistAdvancer } from "../../../live/turn/poster.js";
import { nowLine, progressChecklistSteps, stillWorkingLead } from "../../../live/turn/progressCard.js";
import { appendProgressLogEvent, type ProgressStageEvent, readProgressLog } from "../../../live/turn/progressLog.js";
import { turnTaskLabel } from "../../../live/turn/taskLabel.js";
import type { SupervisorSession } from "../../../supervisor/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { productionMonitorDeps } from "../monitor/deps.js";
import { chromeFromProfile, turnChromeFrom } from "../slack/wiring.js";
import { TURN_UNBLOCK_USAGE } from "./blockUsage.js";
import { botTokenOrRefusal, cardEditHome, cardEditSupervisor, refuseWith } from "./cardGates.js";
import { answerProvenanceLabel, str, TURN_UNBLOCK_FLAG_SPEC } from "./core.js";
import { budgetWarned } from "./dispatchBudget.js";
import { fireTurnSignedOut } from "./signInCard.js";
import { attemptChecklistAdvance } from "./sweepCard.js";

/** Where this verb's own arguments start in `process.argv`: `[node, cli, turn, unblock, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/**
 * Parse the verb's argv tail. Pure — no filesystem, no network, so a bad flag is refused before any effect.
 *
 * @param rest the argv tail after `turn unblock`
 * @returns the parsed flags, or the rejections
 */
export function parseTurnUnblockArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({
    args: rest,
    spec: { boolean: [...TURN_UNBLOCK_FLAG_SPEC.boolean], string: [...TURN_UNBLOCK_FLAG_SPEC.string] },
  });
}

/**
 * Read the three values this verb cannot run without, or name the flags whose absence stopped it. Pure.
 *
 * @param values the parsed flag values
 * @returns the inputs, or every flag that was missing or unreadable
 */
export function turnUnblockInputs({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}):
  | { readonly kind: "ready"; readonly channel: string; readonly messageTs: string; readonly note: string }
  | { readonly kind: "missing"; readonly flags: readonly string[] } {
  const channel = str({ key: "channel", values });
  const messageTs = str({ key: "message-ts", values });
  const note = str({ key: "note", values })?.trim();
  const flags = [
    channel === undefined ? "--channel" : undefined,
    messageTs === undefined ? "--message-ts" : undefined,
    note === undefined || note.length === 0 ? "--note" : undefined,
  ].filter((flag): flag is string => flag !== undefined);
  return channel !== undefined && messageTs !== undefined && note !== undefined && note.length > 0
    ? { channel, kind: "ready", messageTs, note }
    : { flags, kind: "missing" };
}

/**
 * The command that resumes this turn — printed rather than run, for the reason this file's header states.
 *
 * @param ask the ask being resumed
 * @returns the exact `turn dispatch` line, over the same brief the block left standing
 */
export function resumeCommandFor({ ask }: { ask: { readonly channel: string; readonly messageTs: string } }): string {
  return (
    `slopweaver turn dispatch --brief ~/.slopweaver/briefs/${ask.channel}-${ask.messageTs}.json ` +
    "--decision <the routing decision this session judged>"
  );
}

/**
 * Run the unblock verb.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export async function runTurnUnblock(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TURN_UNBLOCK_USAGE });
    return EXIT_OK;
  }
  const parsed = parseTurnUnblockArgs({ rest });
  if (parsed.isErr()) {
    return refuseWith({ code: EXIT_USAGE, errors: parsed.error, usage: TURN_UNBLOCK_USAGE });
  }
  const values = parsed.value.values;
  const read = turnUnblockInputs({ values });
  if (read.kind === "missing") {
    return refuseWith({
      code: EXIT_USAGE,
      errors: read.flags.map((flag) => `${flag} is required`),
      usage: TURN_UNBLOCK_USAGE,
    });
  }
  const home = cardEditHome({ values });
  const ask = capturedAskFor({ channel: read.channel, home, messageTs: read.messageTs });
  const blocked = ask?.blockedOnHuman;
  if (ask === undefined || blocked === undefined) {
    logger.error({
      msg: `turn unblock: ${read.channel}/${read.messageTs} is not waiting on the owner — refusing rather than recording a resume nothing can act on`,
    });
    return EXIT_EXPECTED_EMPTY;
  }
  const event: UnblockedEvent = {
    channel: ask.channel,
    kind: "unblocked",
    lifted: { need: blocked.need, what: blocked.what },
    messageTs: ask.messageTs,
    note: read.note,
    threadTs: ask.threadTs,
    tsIso: new Date().toISOString(),
  };
  if (values["dry-run"] === true) {
    logger.out({ line: JSON.stringify(event, null, 2) });
    logger.out({ line: "dry run — nothing was recorded and the card was not touched." });
    return EXIT_OK;
  }
  appendAskLifecycleEvent({ event, home });
  if (blocked.signInOrigin !== undefined) {
    // The sign-in card leaves with the block, not a supervisor tick later.
    await fireTurnSignedOut({ bySession: "turn unblock", deps: productionMonitorDeps(), home, verb: "turn unblock" });
  }
  const card = await resumeCard({ ask, home, note: read.note, values });
  logger.out({ line: `turn unblock: ${ask.channel}/${ask.messageTs} is moving again — ${read.note} [card=${card}]` });
  logger.out({ line: `resume it in this session with: ${resumeCommandFor({ ask })}` });
  return EXIT_OK;
}

/**
 * Put the card's last step back to running, with what the owner did under it.
 *
 * Best-effort and REPORTED: the block is already lifted in the log by the time this runs, and a card edit
 * that fails must not undo that — the durable state is what every other reader depends on, and a stale card
 * is visibly stale where a lost `unblocked` event is invisible.
 *
 * @param ask the folded ask being resumed
 * @param home the resolved state home
 * @param note what the owner did, in the unblocking session's own words
 * @param values the parsed flag values, for `--brief`, `--model` and `--session-url`
 * @returns a short phrase naming what happened to the card, for the verb's own output line
 */
async function resumeCard({
  ask,
  home,
  note,
  values,
}: {
  ask: AskLifecycle;
  home: string;
  note: string;
  values: Readonly<Record<string, string | boolean>>;
}): Promise<string> {
  const ready = resumeCardInputs({ ask, home, values });
  if (typeof ready === "string") {
    return ready;
  }
  const { stages, timeline } = readProgressLog({ askIdentity: ask, home });
  const detail = resumedCardDetail({ note });
  const advancer = liveChecklistAdvancer({
    askIdentity: ask,
    doorLedger: doorLedgerPort(),
    home,
    provenance: {
      modelId: answerProvenanceLabel({
        modelOverride: str({ key: "model", values }),
        supervisor: ready.supervisor,
        worker: undefined,
      }),
      supervisor: ready.supervisor,
    },
    transport: makeSlackWriteTransport({ home, token: ready.token }),
    turnChrome: turnChromeFrom({ chrome: chromeFromProfile({ home }) }),
    turnId: ready.started.turnId,
  });
  const outcome = await attemptChecklistAdvance({
    advanceWorking: (plan) => advancer.advanceWorking(plan),
    plan: {
      posted: { channel: ask.channel, ts: ready.started.workingTs },
      steps: progressChecklistSteps({
        finished: false,
        nowDetail: resumeNowDetail({ askTs: ask.messageTs, detail, stages }),
        question: ready.question,
        timeline,
        warned: budgetWarned({ askIdentity: ask, home, nowIso: new Date().toISOString() }),
      }),
      task: turnTaskLabel({ question: ready.question }),
    },
  });
  if (outcome.kind === "failed") {
    return `NOT advanced — ${outcome.reason}`;
  }
  appendProgressLogEvent({
    askIdentity: ask,
    event: { detail, kind: "card-write", stageCount: stages.length, tsIso: new Date().toISOString() },
    home,
  });
  return "resumed";
}

/**
 * The four things the card edit needs, or the short phrase saying which one was missing.
 *
 * Every arm returns a PHRASE rather than an error, because none of them is a failure of the unblock: the
 * block is already lifted in the log by the time this runs, and what is being reported is only how much of
 * the card could be moved. A caller with no `--brief` is the ordinary case, not a mistake.
 *
 * @param ask the folded ask being resumed
 * @param home the resolved state home
 * @param values the parsed flag values, for `--brief`, `--model` and `--session-url`
 * @returns the resolved inputs, or the phrase naming what stopped the edit
 */
function resumeCardInputs({
  ask,
  home,
  values,
}: {
  ask: AskLifecycle;
  home: string;
  values: Readonly<Record<string, string | boolean>>;
}):
  | {
      readonly question: string;
      readonly started: { readonly turnId: string; readonly workingTs: string };
      readonly supervisor: SupervisorSession;
      readonly token: string;
    }
  | string {
  const briefPath = str({ key: "brief", values });
  if (briefPath === undefined) {
    return "not touched — no --brief given";
  }
  const brief = readBrief({ path: briefPath });
  if (brief.isErr()) {
    return `not touched — ${brief.error.message}`;
  }
  const started = ask.started;
  if (started === undefined) {
    return "not touched — this ask has no capture-time checklist";
  }
  const token = botTokenOrRefusal({ home });
  if (typeof token !== "string") {
    return "not touched — no Slack bot token";
  }
  const supervisor = cardEditSupervisor({ values, verb: "turn unblock" });
  if (supervisor.isErr()) {
    return `not touched — ${supervisor.error.message}`;
  }
  return { question: brief.value.question, started, supervisor: supervisor.value, token };
}

/**
 * The line under the resumed step: what the owner did, or the mechanical `now:` line when there is no trail yet.
 *
 * The resume line wins while it is the newest thing that happened, which it is at the instant this runs. The
 * worker's next `turn status` call replaces it with an ordinary `now:` line, which is correct — by then the
 * newest thing that happened is the work, not the unblocking.
 *
 * @param askTs the asking message's Slack timestamp, which dates the turn clock
 * @param detail the resumed-step line
 * @param stages the stages this turn has declared
 * @returns the detail to render under the running step
 */
function resumeNowDetail({
  askTs,
  detail,
  stages,
}: {
  askTs: string;
  detail: string;
  stages: readonly ProgressStageEvent[];
}): string {
  if (stages.length === 0) {
    const nowIso = new Date().toISOString();
    return nowLine({ callsSoFar: 0, latest: undefined, nowIso, turnClock: stillWorkingLead({ askTs, nowIso }) });
  }
  return detail;
}

export const turnUnblockCommand = defineCommand({ run: runTurnUnblock });
