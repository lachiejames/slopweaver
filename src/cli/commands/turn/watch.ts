/**
 * `slopweaver turn watch` — the ticker that keeps a live card current without asking the model anything.
 *
 * ## What this is, and what it deliberately is not
 *
 * It is a plain CLI process. It reads two local files — the turn's own progress log
 * (`../../../live/turn/progressLog.ts`) and the worker session's command log
 * (`../../../live/turn/workerLog.ts`) — renders a card from them, and calls `chat.update`. **No model runs
 * here**, so operating doctrine rule 2 is not in play: that rule bans a headless MODEL, and nothing on this
 * path starts one.
 *
 * It is also not a daemon. It runs in the FOREGROUND and blocks, the same shape
 * `listen --follow` already uses, and the session doing the work backgrounds it
 * from its own shell with a bare `&`.
 *
 * ## It is NOT a child of the session
 *
 * It must not be described as one that dies with the session: a bare `&` is the one mechanism that
 * produces a PID 1 orphan, whatever a doc says about `nohup` and `disown`.
 * MEASURED: a bare `&` from an agent tool-call shell has **ppid 1** by the time the call returns, because
 * that shell is one-shot. `./tickerOwner.ts` carries the two-command reproduction and the whole finding.
 *
 * So the ban on `nohup`/`setsid`/`disown` stays — they buy nothing — but it is no longer the protection.
 * `--max-seconds` was the only bound on an orphan, and its default is the two-hour dispatch lease, so a
 * worker that died WITHOUT answering left a process telling the thread its turn was alive for the rest of
 * it. The loop now reaps ITSELF (`orphanedTickerVerdict`) when this process is orphaned AND its worker's
 * own transcript has stood still past `ORPHAN_SILENCE_MS`, and the ask is NOT blocked on the owner — a turn
 * waiting on THE OWNER is idle by design and its card is what tells the thread so. This is the
 * listener's own answer to the same class: a death-watch rather than a better hosting trick
 * (`docs/listener-supervision/failure-and-evidence.md`).
 *
 * ## One ticker per card
 *
 * A looping watch claims its card for its session first and renews the claim before every tick
 * (`./watchLock.ts`): a second one exits at once, and one that finds its claim taken stops without writing.
 * Fifteen tickers on one card, fourteen of them started by detective leaves, is that module's measurement.
 *
 * ## Why it stops on `answered` but NOT on `failed`
 *
 * The dispatcher's own sweep stops the moment an ask stops holding a live dispatch, and `failed` is one of
 * the kinds that ends one (`../../../live/ask/lifecycle.ts`'s `supersedesDispatch`). Measured on
 * one real ask: the outbound form refused an over-cap answer, the sweep
 * reported "0 still working" from then on, and the worker went on investigating for another
 * 36 minutes while the owner was looking at a frozen card.
 *
 * A refused send is therefore the moment the reader needs this ticker MOST, not the moment to stop it. So it
 * ends only on the states where the card is genuinely gone or moot — the turn answered, or the ask was
 * triaged to no response — and on its own `--max-seconds` bound.
 */

import { unsetFieldAsNull } from "#lib/absent.js";
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { slackBotToken } from "../../../config.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { logger } from "../../../lib/logger.js";
import { askIdentityOf } from "../../../live/ask/identity.js";
import type { AskLifecycleState } from "../../../live/ask/lifecycle.js";
import { capturedAskFor } from "../../../live/ask/store.js";
import { readBrief } from "../../../live/turn/briefStore.js";
import { currentGenerationDispatchRecord } from "../../../live/turn/dispatchStore.js";
import { liveChecklistAdvancer } from "../../../live/turn/poster.js";
import {
  detectSupervisorSession,
  type SupervisorSession,
  supervisorSessionProblem,
} from "../../../supervisor/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { chromeFromProfile, turnChromeFrom } from "../slack/wiring.js";
import { answerProvenanceLabel, str, TURN_WATCH_USAGE } from "./core.js";
import { orphanedTickerVerdict } from "./tickerOwner.js";
import { parseTurnWatchArgs, watchCadence } from "./watchArgs.js";
import { claimTurnWatch, type TurnWatchHold, turnWatchStaleAfterMs } from "./watchLock.js";
import { watchTick } from "./watchTick.js";

/** Where this verb's own arguments start in `process.argv`: `[node, cli, turn, watch, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/**
 * The ask states that END a watch: the card is deleted on answer, and a no-response triage — or an ask
 * settled as already satisfied elsewhere — removes it too.
 *
 * `failed` is deliberately absent — see this module's own header for the measured turn that is about. So is
 * `first-answered`: a posted plan keeps its card and its worker, which is still building what it promised.
 */
const TERMINAL_WATCH_STATES: ReadonlySet<AskLifecycleState> = new Set<AskLifecycleState>([
  "answered",
  "triaged-no-response",
  "left-for-a-human",
  "triage-cleanup-intended",
  "handover-cleanup-intended",
  // `slopweaver turn satisfied` reaps the card before it appends this event, so a ticker that kept going
  // would be rewriting a message that no longer exists.
  "satisfied-elsewhere",
]);

/**
 * Whether an ask in this state ends its watch — the card is gone or the turn is over. Pure.
 *
 * @param state the ask's folded lifecycle state
 * @returns whether the ticker should stop
 */
export function endsWatch({ state }: { state: AskLifecycleState }): boolean {
  return TERMINAL_WATCH_STATES.has(state);
}

/**
 * The two things this tick needs off the ask's own lifecycle log, folded ONCE.
 *
 * One read rather than two, because the log is a whole-file parse and both readings are wanted on every
 * single tick — and because they have to describe the SAME fold: a turn that unblocked between two reads
 * would otherwise be judged blocked by one and reapable by the other. `capturedAskFor` is that one read,
 * keyed by `(channel, messageTs)` exactly as the fold is, so there is no scan and no second predicate to
 * drift from the key.
 *
 * @param home the resolved state home
 * @param askIdentity the ask being watched
 * @returns the terminal state that ended the watch, if one has, and whether the turn is waiting on the owner
 */
function askPosture({ askIdentity, home }: { askIdentity: ReturnType<typeof askIdentityOf>; home: string }): {
  readonly blockedOnHuman: boolean;
  readonly terminal: AskLifecycleState | undefined;
} {
  const entry = capturedAskFor({ channel: askIdentity.channel, home, messageTs: askIdentity.messageTs });
  if (entry === undefined) {
    return { blockedOnHuman: false, terminal: undefined };
  }
  return {
    blockedOnHuman: entry.blockedOnHuman !== undefined,
    terminal: endsWatch({ state: entry.state }) ? entry.state : undefined,
  };
}

/** Wait, without a child process and without a busy loop — the only thing this verb does between ticks. */
async function pause({ ms }: { ms: number }): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Everything one watch needs, resolved once: who to edit, how often, and for how long. */
interface ResolvedWatch {
  readonly advancer: Pick<ReturnType<typeof liveChecklistAdvancer>, "advanceWorking">;
  readonly askIdentity: ReturnType<typeof askIdentityOf>;
  readonly deadlineMs: number;
  readonly home: string;
  readonly intervalMs: number;
  readonly question: string;
  readonly sessionId: string;
  /** How old a claim on this card may be before it is not a live ticker's (`turnWatchStaleAfterMs`). */
  readonly staleAfterMs: number;
  readonly workerCwd: string;
  readonly workingTs: string;
}

/**
 * Where the watched worker runs: the directory its dispatch record says it booted in, or this process's own
 * when there is no current record, or one written before records carried a cwd.
 *
 * @param record the ask's current-generation dispatch record, `undefined` when there is none
 * @returns the worker's directory
 */
function workerCwdOf({ record }: { record: ReturnType<typeof currentGenerationDispatchRecord> }): string {
  const booted = unsetFieldAsNull({ key: "cwd", record: record?.session });
  if (booted === null) {
    return process.cwd();
  }
  return booted;
}

/**
 * Resolve every flag, file and credential this watch needs — or the exact exit code a refusal already
 * reported. Split from the loop so the loop is only the loop: the gate order here is the same one
 * `./status.ts`'s `readyPush` uses, and one function doing both was over this repo's own line cap.
 *
 * @param values the parsed flag values
 * @returns the resolved watch, or the code a refusal already printed
 */
function resolveWatch({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): ResolvedWatch | { readonly code: number } {
  const home = resolveHome({ named: str({ key: "home", values }) });
  const briefPath = str({ key: "brief", values });
  if (briefPath === undefined) {
    logger.error({ msg: "--brief is required" });
    logger.error({ msg: TURN_WATCH_USAGE });
    return { code: EXIT_USAGE };
  }
  const brief = readBrief({ path: briefPath });
  if (brief.isErr()) {
    logger.error({ msg: brief.error.message });
    return { code: EXIT_ERROR };
  }
  const cadence = watchCadence({ values });
  if ("code" in cadence) {
    return cadence;
  }
  const started = brief.value.started;
  if (started === undefined) {
    logger.error({
      msg: "turn watch: this brief carries no capture-time checklist, so there is no card to keep current",
    });
    return { code: EXIT_EXPECTED_EMPTY };
  }
  const token = slackBotToken({ home });
  if (token === undefined) {
    logger.error({ msg: "no Slack bot token — run `slopweaver connect slack` first" });
    return { code: EXIT_ERROR };
  }
  const detected = detectSupervisorSession({ env: process.env });
  if (detected.kind !== "active") {
    logger.error({ msg: supervisorSessionProblem({ detection: detected }) });
    return { code: EXIT_USAGE };
  }
  const askIdentity = askIdentityOf({ source: brief.value });
  const record = currentGenerationDispatchRecord({ askIdentity, home });
  return {
    advancer: watchAdvancer({ askIdentity, home, record, session: detected.session, token, turnId: started.turnId }),
    askIdentity,
    deadlineMs: Date.now() + cadence.boundSeconds * 1000,
    home,
    intervalMs: cadence.intervalSeconds * 1000,
    question: brief.value.question,
    sessionId: detected.session.id,
    staleAfterMs: turnWatchStaleAfterMs({ intervalSeconds: cadence.intervalSeconds }),
    workerCwd: workerCwdOf({ record }),
    workingTs: started.workingTs,
  };
}

/**
 * The card writer this watch edits through, provenance and all.
 *
 * The label comes from `answerProvenanceLabel` with the dispatch record's own worker, so the card names the
 * session that is DOING the work rather than whichever host variable happens to be set in this process — the
 * mislabel the owner read off a live card.
 *
 * @param askIdentity the ask whose card this edits
 * @param home the resolved state home
 * @param record this generation's dispatch record, when the ask has one
 * @param session the visible session this process is running under
 * @param token the Slack bot token
 * @param turnId the id correlating every edit with this turn
 * @returns the advancer
 */
function watchAdvancer({
  askIdentity,
  home,
  record,
  session,
  token,
  turnId,
}: {
  askIdentity: ReturnType<typeof askIdentityOf>;
  home: string;
  record: ReturnType<typeof currentGenerationDispatchRecord>;
  session: SupervisorSession;
  token: string;
  turnId: string;
}): Pick<ReturnType<typeof liveChecklistAdvancer>, "advanceWorking"> {
  return liveChecklistAdvancer({
    askIdentity,
    doorLedger: doorLedgerPort(),
    home,
    provenance: {
      modelId: answerProvenanceLabel({
        modelOverride: undefined,
        supervisor: session,
        worker:
          record === undefined ? undefined : { host: record.session.host, workspaceRef: record.session.workspaceRef },
      }),
      supervisor: session,
    },
    transport: makeSlackWriteTransport({ home, token }),
    turnChrome: turnChromeFrom({ chrome: chromeFromProfile({ home }) }),
    turnId,
  });
}

/** What one pass of the loop decided: tick again, or stop after printing `line` (none after a `--once` probe). */
type WatchStep = { readonly kind: "continue" } | { readonly kind: "stop"; readonly line: string | undefined };

/**
 * One pass of the loop: stop on a terminal ask or a lost claim, else tick and judge the reap.
 *
 * @param hold this ticker's claim on the card, renewed before the tick; absent on the `--once` probe
 * @param once this pass is the probe's only one
 * @param ticks how many ticks ran before this pass
 * @param watch the resolved watch
 * @returns whether to tick again
 */
async function watchStep({
  hold,
  once,
  ticks,
  watch,
}: {
  hold: TurnWatchHold | undefined;
  once: boolean;
  ticks: number;
  watch: ResolvedWatch;
}): Promise<WatchStep> {
  const posture = askPosture({ askIdentity: watch.askIdentity, home: watch.home });
  if (posture.terminal !== undefined) {
    return {
      kind: "stop",
      line: `turn watch: stopping — the ask is ${posture.terminal} after ${String(ticks)} tick(s)`,
    };
  }
  // One instant for the line and the reap, so the line a reap leaves standing is the one judged quiet.
  const nowIso = new Date().toISOString();
  // BEFORE the write: a ticker that lost its claim (it slept past the stale window and a newcomer took the
  // card) stops without editing, so the one holding the claim is the only one that ever writes.
  if (hold !== undefined && !hold.renew({ nowIso })) {
    return {
      kind: "stop",
      line: `turn watch: stopping after ${String(ticks)} tick(s) — another ticker holds this card now`,
    };
  }
  const tick = await watchTick({ blockedOnHuman: posture.blockedOnHuman, nowIso, watch });
  const done = ticks + 1;
  if (tick.ok) {
    logger.out({ line: `turn watch: tick ${String(done)} — ${tick.line}` });
  } else {
    // Never fatal. A tick that could not reach Slack is one stale minute, and stopping the ticker over it
    // would turn a transient failure into the permanently frozen card this verb exists to prevent.
    logger.error({ msg: `turn watch: tick ${String(done)} ${tick.line}` });
  }
  if (once) {
    return { kind: "stop", line: undefined };
  }
  // AFTER the tick, and only on the looping path. The reap needs the worker's last activity instant,
  // which the tick has just read out of the transcript; `--once` is a probe and reaps nothing.
  //
  // `blockedOnHuman` suppresses it entirely, and that is the one case that would otherwise make this a
  // defect rather than a fix: a turn waiting on THE OWNER is a first-class resumable state
  // (`../../../live/ask/lifecycle.ts`'s `BlockedOnHumanEvent`), its worker sits idle making no tool
  // calls for as long as the owner takes, and its card is the surface telling the thread what the owner owes. Silence
  // there is the turn working as designed, never a death.
  const reap = orphanedTickerVerdict({
    blockedOnHuman: posture.blockedOnHuman,
    latestActivityIso: tick.latestActivityIso,
    nowMs: Date.parse(nowIso),
    parentPid: process.ppid,
  });
  if (reap.kind === "reap") {
    return { kind: "stop", line: `turn watch: stopping after ${String(done)} tick(s) — this process is ${reap.line}` };
  }
  return { kind: "continue" };
}

/**
 * Tick until the ask ends, this process is reaped as orphaned, the deadline passes, or — with `--once` —
 * exactly once.
 *
 * @param hold this ticker's claim on the card, renewed before every tick; absent on the `--once` probe
 * @param once do one tick immediately and return, never sleeping
 * @param watch the resolved watch
 * @returns the process exit code
 */
async function tickUntilDone({
  hold,
  once,
  watch,
}: {
  hold: TurnWatchHold | undefined;
  once: boolean;
  watch: ResolvedWatch;
}): Promise<number> {
  let ticks = 0;
  while (Date.now() < watch.deadlineMs) {
    if (!once) {
      await pause({ ms: watch.intervalMs });
    }
    const step = await watchStep({ hold, once, ticks, watch });
    if (step.kind === "stop") {
      if (step.line !== undefined) {
        logger.out({ line: step.line });
      }
      return EXIT_OK;
    }
    ticks++;
  }
  logger.out({ line: `turn watch: reached --max-seconds after ${String(ticks)} tick(s)` });
  return EXIT_OK;
}

/**
 * Run the watch verb.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export async function runTurnWatch(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TURN_WATCH_USAGE });
    return EXIT_OK;
  }
  const parsed = parseTurnWatchArgs({ rest });
  if (parsed.isErr()) {
    for (const error of parsed.error) {
      logger.error({ msg: error });
    }
    logger.error({ msg: TURN_WATCH_USAGE });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const watch = resolveWatch({ values });
  if ("code" in watch) {
    return watch.code;
  }
  const once = values["once"] === true;
  if (once) {
    // A probe takes no claim: it is one tick, and the moment it is used is while the real ticker runs.
    return tickUntilDone({ hold: undefined, once, watch });
  }
  const claim = claimTurnWatch({
    channel: watch.askIdentity.channel,
    home: watch.home,
    nowIso: new Date().toISOString(),
    sessionId: watch.sessionId,
    staleAfterMs: watch.staleAfterMs,
    workingTs: watch.workingTs,
  });
  if (claim.isErr()) {
    // Not an error: the caller backgrounded this with `&`, and the card already has its one ticker.
    logger.out({ line: `turn watch: not starting a second ticker on this card — ${claim.error}` });
    return EXIT_OK;
  }
  logger.out({
    line:
      `turn watch: keeping ${watch.askIdentity.channel} (ts ${watch.workingTs}) current every ` +
      `${String(Math.round(watch.intervalMs / 1000))}s`,
  });
  try {
    return await tickUntilDone({ hold: claim.value, once, watch });
  } finally {
    claim.value.release();
  }
}

export const turnWatchCommand = defineCommand({ run: runTurnWatch });
