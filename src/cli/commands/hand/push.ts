/**
 * `slopweaver hand push` — the push lane: one macOS notification, and only when something ARRIVED.
 *
 * The owner's design: a lane that reaches them off the fleet briefing, saying a live thing is blocked and needs
 * a sign-in, or that pull requests are ready and need code owners picked. Both of those reach this verb as local
 * reads: the sign-in case off the ask-lifecycle log that `turn block` writes, and the code-owner case as a
 * hand step the session that got the pull request ready posted (`../../../hand/push/select.ts` carries why
 * that is better than a second GitHub ranking inside a notification lane).
 *
 * Safe to run on a schedule, and that is the whole design: the decision reads no clock, so a set that has
 * not changed can be looked at every fifteen minutes forever and the owner is never pinged twice about it.
 */
import { macosOnly, raiseHandNote } from "../../../hand/note/raise.js";
import { appendPushRow, readPushedBefore } from "../../../hand/push/ledger.js";
import { buildPushNotice } from "../../../hand/push/notice.js";
import {
  decidePush,
  handStepSubject,
  type PushSubject,
  type WaitingAskPremise,
  waitingAskSubject,
} from "../../../hand/push/select.js";
import { sendPushNotice } from "../../../hand/push/send.js";
import { reconcileHandSteps } from "../../../hand/reconcile.js";
import { activeSnoozes, readSnoozes, snoozePending } from "../../../hand/snoozeStore.js";
import { type HandStep, waitingHandSteps } from "../../../hand/step.js";
import { readOpenHandSteps } from "../../../hand/store.js";
import { foldAskLifecycle, parseAskLifecycleLog } from "../../../live/ask/lifecycle.js";
import { readAskLifecycleText } from "../../../live/ask/store.js";
import { blockedAsks } from "../../../live/turn/blockedOnHuman.js";
import { noteKeptDown } from "../../../monitor/kindAnswerGate.js";
import { kindAnswerOffer } from "../../../monitor/noteAnswers.js";
import { rankWaiting } from "../../../waiting/rank.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";

import { PUSH_USAGE, parseHandPushArgs, VERB_ARG_OFFSET } from "./core.js";
import {
  bySession,
  type HandDeps,
  productionHandDeps,
  reportReconciled,
  reportUnparsed,
  resolvedHomeOf,
} from "./deps.js";
import { recordKindPressesAndCheckStores } from "./kindPresses.js";

/**
 * Every ask standing `waiting` on the owner, as this lane's own premise.
 *
 * A `ready-to-resume` row is deliberately NOT a subject: the owner has already done that one, and what is owed is a
 * re-dispatch by a session rather than anything of the owner's.
 *
 * An absent or unreadable ask log yields NO subjects rather than a failure — `readAskLifecycleText` answers
 * the empty string for both, and this lane treats that as "nothing waiting". That is the conservative
 * reading rather than a gap: the lane can only ever ADD a notification, so a missing input makes it quieter
 * instead of making it guess, exactly as `../../../briefing/blockedAsks.ts` reasons about the same log.
 *
 * @param home the state home
 * @returns the waiting asks, as premises
 */
export function waitingAskPremises({ home }: { home: string }): readonly WaitingAskPremise[] {
  const parsed = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) });
  return blockedAsks({ folded: foldAskLifecycle({ events: parsed.events }) })
    .filter((ask) => ask.standing === "waiting" && ask.blocked.need !== "other")
    .map((ask) => ({
      headline: ask.blocked.what,
      id: `${ask.channel}/${ask.messageTs}`,
      kind: ask.blocked.need === "sign-in" ? ("sign-in" as const) : ("go-ahead" as const),
    }));
}

/**
 * Everything outstanding on the owner right now, RANKED: what blocks a colleague first, then the fleet's own stopped
 * work, then check-ins — the one ranking every surface shares. Within a tier, hand steps before asks and each
 * register's oldest first, as before.
 *
 * @param steps the open hand steps, oldest first
 * @param asks the asks standing waiting on the owner
 * @returns the subjects, in the order the lane shows them
 */
export function outstandingSubjects({
  steps,
  asks,
}: {
  steps: readonly HandStep[];
  asks: readonly WaitingAskPremise[];
}): readonly PushSubject[] {
  return rankWaiting({
    items: [...steps.map((step) => handStepSubject({ step })), ...asks.map((ask) => waitingAskSubject({ ask }))],
    tierOf: (subject) => subject.tier,
  });
}

/**
 * The open steps this lane may push: every waiting step the owner has not snoozed.
 *
 * A notice waits on nobody: its own floating note is the whole of it, never a "waiting on you" banner. A step
 * the owner snoozed is out of the set until its time comes, and then ARRIVES again: the clock is read in the snooze
 * filter, never in the decision, so the lane stays arrival-only. A press a store failure left as a bare marker
 * is a snooze too: the owner made it, and the reconcile already said it could not record it. So is a record
 * that stands but will not read — its wake time is unknown, so the step stays down, named in the diagnostics,
 * exactly as the note's own raise refuses on it (`noteStanding`).
 *
 * @param home the state home whose snooze store is read
 * @param nowIso the instant a snooze is judged at
 * @param steps the open steps the register read
 * @param deps the verb's seams, for the diagnostics a record that will not read writes
 * @returns the steps the lane decides over
 */
function awakeHandSteps({
  home,
  nowIso,
  steps,
  deps,
}: {
  home: string;
  nowIso: string;
  steps: readonly HandStep[];
  deps: HandDeps;
}): readonly HandStep[] {
  const snoozes = readSnoozes({ home });
  snoozes.problems.forEach((problem) => {
    deps.writeDiagnostic(`hand push: ${problem.message}`);
  });
  const snoozed = activeSnoozes({ nowIso, records: snoozes.records });
  const unreadable = new Set(snoozes.unreadable);
  return waitingHandSteps({ steps }).filter(
    (step) => !snoozed.has(step.id) && !unreadable.has(step.id) && !snoozePending({ home, id: step.id }),
  );
}

/**
 * The owner's kind-answer presses recorded first, so a mute or hold stands before anything is raised, then the steps the
 * lane decides over ({@link awakeHandSteps}), and whether a press met a problem — one that may still keep a note
 * down fails the pass.
 */
function pressedThenAwake({
  home,
  nowIso,
  steps,
  deps,
}: {
  home: string;
  nowIso: string;
  steps: readonly HandStep[];
  deps: HandDeps;
}): { pressFaulted: boolean; steps: readonly HandStep[] } {
  const problems = recordKindPressesAndCheckStores({
    home,
    open: steps,
    verb: "hand push",
    writeDiagnostic: deps.writeDiagnostic,
  });
  return { pressFaulted: problems > 0, steps: awakeHandSteps({ deps, home, nowIso, steps }) };
}

/**
 * Run `hand push` against injected seams.
 *
 * @param rest the argv tail after `hand push`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runHandPush({ rest, deps }: { rest: readonly string[]; deps: HandDeps }): number {
  const gated = refuseRunnerOnStandingRuling({ noun: "hand", rest, verb: "push" });
  if (gated !== undefined) {
    return gated;
  }
  return pushPass({ deps, rest });
}

/** One `hand push` pass, past the ruling gate {@link runHandPush} asks first. */
function pushPass({ rest, deps }: { rest: readonly string[]; deps: HandDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(PUSH_USAGE);
    return EXIT_OK;
  }
  const parsed = parseHandPushArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(PUSH_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const resolvedHome = resolvedHomeOf({ values });
  const nowIso = deps.now();
  const reconciled = reconcileHandSteps({ bySession: bySession({ values }), home: resolvedHome, nowIso });
  if (reconciled.isErr()) {
    deps.writeDiagnostic(`hand push: ${reconciled.error.message}`);
    return EXIT_ERROR;
  }
  reportReconciled({ deps, outcome: reconciled.value, verb: "hand push" });
  const read = readOpenHandSteps({ home: resolvedHome });
  if (read.isErr()) {
    deps.writeDiagnostic(`hand push: ${read.error.message}`);
    return EXIT_ERROR;
  }
  const before = readPushedBefore({ home: resolvedHome });
  if (before.isErr()) {
    deps.writeDiagnostic(`hand push: ${before.error.message}`);
    return EXIT_ERROR;
  }
  reportUnparsed({ deps, unparsed: read.value.unparsed, verb: "hand push" });
  const { pressFaulted, steps } = pressedThenAwake({ deps, home: resolvedHome, nowIso, steps: read.value.steps });
  const faulted = ({ code }: { code: number }): number => (pressFaulted ? EXIT_ERROR : code);
  const outstanding = outstandingSubjects({ asks: waitingAskPremises({ home: resolvedHome }), steps });
  const decision = decidePush({ before: before.value, outstanding });
  if (values["dry-run"] === true) {
    return faulted({
      code: report({ decision, delivery: { line: "not sent (--dry-run)", posted: false }, deps, values }),
    });
  }
  const delivery = decision.send
    ? deliver({ decision, deps, home: resolvedHome, steps })
    : { line: "nothing new", posted: false };
  // An arrival the owner was never actually shown must NOT enter the ledger: `before` is "what the owner has been told
  // about", so recording a failed banner would retire that subject silently and the owner would never hear about it
  // again. A pass that only cleared members still records — nothing was owed to the owner there.
  if (decision.record && (delivery.posted || !decision.send)) {
    const recorded = appendPushRow({
      home: resolvedHome,
      row: { atIso: nowIso, outstanding: outstanding.map((subject) => subject.id), sent: delivery.posted },
    });
    if (recorded.isErr()) {
      deps.writeDiagnostic(`hand push: ${recorded.error.message}`);
      return EXIT_ERROR;
    }
  }
  return faulted({ code: report({ decision, delivery, deps, values }) });
}

/**
 * What one pass actually delivered, as opposed to what it decided to deliver.
 *
 * `posted` is the BANNER's own outcome and nothing else's, because it is the only thing the ledger may be
 * advanced on: a note that failed to draw after a banner the owner saw still leaves them told. The distinction is not
 * cosmetic — an earlier shape recorded `sent: decision.send`, so a pass that decided to send and then failed
 * wrote the arrival into the ledger anyway and the subject was never pushed again.
 */
interface PushDelivery {
  /** Whether the notification really reached macOS. */
  readonly posted: boolean;
  /** One phrase saying what happened, for `--json` and for the verb's own output. */
  readonly line: string;
}

/**
 * The arrival whose note this push raises: the first one the owner's kind answers leave free, else the first one — whose
 * raise then reports it kept down. A kind the owner muted, or a subject the owner held, never takes the note's one slot from an
 * arrival of another kind.
 *
 * @param arrivals the open steps that arrived, in arrival order
 * @returns the step to raise, or `undefined` when nothing arrived
 */
function noteStepOf({ arrivals, home }: { arrivals: readonly HandStep[]; home: string }): HandStep | undefined {
  const free = arrivals.find((open) => noteKeptDown({ home, step: open }) === undefined);
  if (free !== undefined) {
    return free;
  }
  return arrivals[0];
}

/**
 * Raise the note for the top hand step among what arrived, then post the banner saying where it is.
 *
 * The note goes up for the highest-ranked hand step among the arrivals, by the order `arrived` already
 * carries: the banner has room for one line and the note has the literal, the address and the buttons, which
 * is the progressive disclosure rule 7 asks for on a surface that cannot hold both. Another step's note already
 * up never holds it back: notes stack, cascaded, and the arrival's draws in front.
 *
 * The note is raised BEFORE the banner so the banner can say where the step is. That order does not touch
 * the ledger rule: `posted` is still the banner's own outcome, and a note that drew before a failed banner
 * is kept by the next pass rather than drawn twice.
 *
 * @param decision what the lane decided
 * @param steps the open hand steps
 * @param home the state home
 * @param deps the verb's seams
 * @returns whether the banner posted, and one phrase saying what was delivered
 */
function deliver({
  decision,
  steps,
  home,
  deps,
}: {
  decision: ReturnType<typeof decidePush>;
  steps: readonly HandStep[];
  home: string;
  deps: HandDeps;
}): PushDelivery {
  const platform = macosOnly({ platform: deps.platform });
  if (platform !== undefined) {
    return { line: platform.message, posted: false };
  }
  const arrivals = decision.arrived
    .map((subject) => steps.find((open) => subject.id === `hand:${open.id}`))
    .filter((open) => open !== undefined);
  const step = noteStepOf({ arrivals, home });
  const note = step === undefined ? undefined : raiseForArrival({ deps, home, step });
  const noteShown = note?.shown === true && decision.arrived[0]?.id === `hand:${note.id}`;
  const notice = buildPushNotice({
    arrived: decision.arrived,
    noteShown,
    outstandingCount: decision.outstanding.length,
  });
  if (notice.isErr()) {
    return { line: notice.error.message, posted: false };
  }
  const posted = sendPushNotice({ notice: notice.value, run: deps.run });
  if (posted.isErr()) {
    return { line: posted.error.message, posted: false };
  }
  if (note === undefined) {
    return { line: `notified: ${notice.value.title} — ${notice.value.subtitle}`, posted: true };
  }
  return { line: `notified, and ${note.line}`, posted: true };
}

/**
 * Raise one arrival's note, keeping it if it is already up, and report what it did.
 *
 * @param step the arriving hand step
 * @param home the state home
 * @param deps the verb's seams
 * @returns the step's id, whether its note is on screen now, and one phrase
 */
function raiseForArrival({ step, home, deps }: { step: HandStep; home: string; deps: HandDeps }): {
  id: string;
  shown: boolean;
  line: string;
} {
  // The owner's mute of the kind, or their hold until it reads worse, keeps the NOTE down; the banner still names the card.
  const keptDown = noteKeptDown({ home, step });
  if (keptDown !== undefined) {
    return { id: step.id, line: `${step.id}'s note is ${keptDown}`, shown: false };
  }
  const raised = raiseHandNote({
    home,
    kindAnswers: kindAnswerOffer({ step }),
    level: "ordinary",
    nowIso: deps.now(),
    run: deps.run,
    step,
    whenLive: "keep",
  });
  if (raised.isErr()) {
    return { id: step.id, line: `the note did not come up: ${raised.error.message}`, shown: false };
  }
  if (raised.value.kind === "kept") {
    return { id: step.id, line: `${step.id} was already floating top right`, shown: true };
  }
  return { id: step.id, line: `${step.id} is floating top right, in front of any note already up`, shown: true };
}

/**
 * Print what the pass decided, and exit non-zero when a banner was owed and did not go out.
 *
 * A send that was decided and did not happen is rule 6's failure mode exactly — the owner is blocked and does not
 * know — so it is an error rather than a line in a log nobody reads. A platform that has no notifications at
 * all is not that: `NOT_THIS_PLATFORM` is a fact about the machine, it is reported, and the exit stays 0.
 *
 * @param decision what the lane decided
 * @param delivery whether the banner posted, and what to print
 * @param values the parsed flags
 * @param deps the verb's seams
 * @returns the process exit code
 */
function report({
  decision,
  delivery,
  values,
  deps,
}: {
  decision: ReturnType<typeof decidePush>;
  delivery: PushDelivery;
  values: Readonly<Record<string, unknown>>;
  deps: HandDeps;
}): number {
  const dryRun = values["dry-run"] === true;
  const undelivered = decision.send && !delivery.posted && !dryRun && deps.platform === "darwin";
  if (values["json"] === true) {
    deps.writeOut(
      JSON.stringify({
        arrived: decision.arrived,
        outstanding: decision.outstanding,
        posted: delivery.posted,
        recorded: decision.record && (delivery.posted || !decision.send),
        send: decision.send,
        sent: delivery.line,
        why: decision.why,
      }),
    );
    return undelivered ? EXIT_ERROR : EXIT_OK;
  }
  deps.writeOut(`hand push: ${decision.why}`);
  deps.writeOut(`  ${delivery.line}`);
  if (undelivered) {
    deps.writeDiagnostic("hand push: the banner did not go out, so nothing was recorded — the next pass retries it");
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

/** `slopweaver hand push`. */
export const handPushCommand = defineCommand({
  run: (argv) => runHandPush({ deps: productionHandDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
