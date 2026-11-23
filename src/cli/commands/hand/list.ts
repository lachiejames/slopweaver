/**
 * `slopweaver hand list` — every step still waiting on the owner.
 *
 * It reconciles first: a Done the owner pressed on the note is a marker on disk until something reads it, and a step
 * whose board row has finished is settled by that evidence — a list that skipped either would show the owner a step
 * the owner has already finished. `--json` carries `rowProblem` on a step whose named row could not be read.
 *
 * Diagnostic and local: no door, no network, no model. Prints how long nothing.
 */
import { integrationOfStep } from "../../../hand/integration.js";
import { placeGaps } from "../../../hand/placeLink.js";
import { reconcileHandSteps } from "../../../hand/reconcile.js";
import { pasteableSecrets } from "../../../hand/secretName.js";
import { snoozeWakeLabel } from "../../../hand/snooze.js";
import { activeSnoozes, readSnoozes } from "../../../hand/snoozeStore.js";
import { type HandStep, handStepTier, waitingHandSteps } from "../../../hand/step.js";
import { readOpenHandSteps } from "../../../hand/store.js";
import { keptReasons } from "../../../talk/cardLanding.js";
import { readCardLandings } from "../../../talk/cardLandingStore.js";
import { unreadableCardLinesForKeys } from "../../../talk/cardLedgerFile.js";
import { rankWaiting } from "../../../waiting/rank.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { LIST_USAGE, parseHandListArgs, VERB_ARG_OFFSET } from "./core.js";
import {
  bySession,
  type HandDeps,
  productionHandDeps,
  reportReconciled,
  reportUnparsed,
  resolvedHomeOf,
} from "./deps.js";

/**
 * The open steps in the one ranking every surface shares — what blocks a colleague first, check-ins last —
 * keeping the register's own oldest-first order within a tier, which is all `rankWaiting` ever does.
 *
 * @param steps the open steps, oldest first
 * @returns a new list, tier-first
 */
export function rankedSteps({ steps }: { steps: readonly HandStep[] }): readonly HandStep[] {
  return rankWaiting({ items: steps, tierOf: (step) => handStepTier({ step }) });
}

/**
 * One open step as `hand list --json` prints it: the register row plus what the card derives from it.
 *
 * @param step the open step
 * @param rowProblem why the board row it names has not let it leave, when it has not
 * @param keptReason why a settle left it up, when one did
 * @param snoozedUntil when the owner's snooze on it lapses, while one holds
 * @param ranked whether the list was asked for tier-first, so each line carries its tier
 * @returns the JSON line
 */
function jsonLineOf({
  step,
  rowProblem,
  keptReason,
  snoozedUntil,
  ranked,
}: {
  step: HandStep;
  rowProblem: string | undefined;
  keptReason: string | undefined;
  snoozedUntil: string | undefined;
  ranked: boolean;
}): string {
  const integration = integrationOfStep({ step });
  const secrets = pasteableSecrets({ step });
  return JSON.stringify({
    ...step,
    // The system the step touches, named from the credential register — the Queue card's `integration=` tag.
    ...(integration === undefined ? {} : { integration }),
    // The names the card draws a secure paste field for, so the owner never runs `secrets set` themself.
    ...(secrets.length === 0 ? {} : { secrets }),
    // Why a card that names its row has not left, on the card itself: the console keeps stdout only.
    ...(rowProblem === undefined ? {} : { rowProblem }),
    // Why a settle left this card up after answering the owner (`handover settle --card kept`).
    ...(keptReason === undefined ? {} : { keptReason }),
    // When a snooze the owner chose brings the note back; the step stays on every list meanwhile, marked rather than hidden.
    ...(snoozedUntil === undefined ? {} : { snoozedUntil }),
    ...(ranked ? { tier: handStepTier({ step }) } : {}),
  });
}

/**
 * Run `hand list` against injected seams.
 *
 * @param rest the argv tail after `hand list`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runHandList({ rest, deps }: { rest: readonly string[]; deps: HandDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(LIST_USAGE);
    return EXIT_OK;
  }
  const parsed = parseHandListArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(LIST_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const resolvedHome = resolvedHomeOf({ values });
  const reconciled = reconcileHandSteps({ bySession: bySession({ values }), home: resolvedHome, nowIso: deps.now() });
  if (reconciled.isErr()) {
    deps.writeDiagnostic(`hand list: ${reconciled.error.message}`);
    return EXIT_ERROR;
  }
  reportReconciled({ deps, outcome: reconciled.value, verb: "hand list" });
  const read = readOpenHandSteps({ home: resolvedHome });
  if (read.isErr()) {
    deps.writeDiagnostic(`hand list: ${read.error.message}`);
    return EXIT_ERROR;
  }
  reportUnparsed({ deps, unparsed: read.value.unparsed, verb: "hand list" });
  // A notice waits on nobody, so no list of what waits on the owner carries it — the console queue reads this one.
  const waiting = waitingHandSteps({ steps: read.value.steps });
  const open = values["ranked"] === true ? rankedSteps({ steps: waiting }) : waiting;
  if (values["gaps"] === true) {
    writeGaps({ deps, json: values["json"] === true, steps: open });
    return EXIT_OK;
  }
  const kept = keptReasonsOf({
    cardKeys: new Set(open.map((step) => `hand:${step.id}`)),
    deps,
    home: resolvedHome,
  });
  const snoozed = snoozedUntilOf({ deps, home: resolvedHome, nowIso: deps.now() });
  if (values["json"] === true) {
    const rowProblems = new Map(reconciled.value.evidenceProblems.map((problem) => [problem.slug, problem.message]));
    open.forEach((step) => {
      const rowProblem = step.row === undefined ? undefined : rowProblems.get(step.row);
      const keptReason = kept.get(`hand:${step.id}`);
      const snoozedUntil = snoozed.get(step.id);
      deps.writeOut(jsonLineOf({ keptReason, ranked: values["ranked"] === true, rowProblem, snoozedUntil, step }));
    });
    return EXIT_OK;
  }
  if (open.length === 0) {
    deps.writeOut("hand list: nothing is waiting on the owner");
    return EXIT_OK;
  }
  writeStepLines({ deps, kept, ranked: values["ranked"] === true, snoozed, steps: open });
  return EXIT_OK;
}

/**
 * Print each open card naming a place on the web its card does not send the owner to, then how many of the open cards that is — the
 * check over the owner's whole queue for the gap the owner met on a sign-in card (`../../../hand/placeLink.ts`).
 *
 * @param steps the open steps
 * @param json whether each gap is one JSON line, with no count line after them
 */
function writeGaps({ deps, steps, json }: { deps: HandDeps; steps: readonly HandStep[]; json: boolean }): void {
  const gaps = placeGaps({ steps });
  if (json) {
    gaps.forEach((gap) => {
      deps.writeOut(JSON.stringify(gap));
    });
    return;
  }
  gaps.forEach((gap) => {
    deps.writeOut(`${gap.id}  names ${gap.host} and draws no link to it as its call to action — ${gap.what}`);
  });
  deps.writeOut(
    `hand list --gaps: ${String(gaps.length)} of ${String(steps.length)} open card(s) name a place their card does not link to`,
  );
}

/**
 * When each snoozed open step's note comes back. A record that will not read is said on stderr; the step it
 * names then reads as not snoozed, which shows the owner MORE, never less.
 *
 * @param nowIso the instant a snooze is judged active at
 * @returns step id → wake instant, for every snooze still holding
 */
function snoozedUntilOf({
  deps,
  home,
  nowIso,
}: {
  deps: HandDeps;
  home: string;
  nowIso: string;
}): ReadonlyMap<string, string> {
  const read = readSnoozes({ home });
  read.problems.forEach((problem) => {
    deps.writeDiagnostic(`hand list: ${problem.message}`);
  });
  return new Map([...activeSnoozes({ nowIso, records: read.records })].map(([id, record]) => [id, record.untilIso]));
}

/**
 * Print each open step as the human list reads it: its line, what it unblocks, how it settles, and why a settle
 * kept it up when one did.
 *
 * @param ranked whether each line carries its queue tier
 * @param kept card key → why a settle left that card up
 * @param snoozed step id → when the owner's snooze on it lapses
 */
function writeStepLines({
  deps,
  steps,
  ranked,
  kept,
  snoozed,
}: {
  deps: HandDeps;
  steps: readonly HandStep[];
  ranked: boolean;
  kept: ReadonlyMap<string, string>;
  snoozed: ReadonlyMap<string, string>;
}): void {
  steps.forEach((step) => {
    deps.writeOut(ranked ? `${step.id}  [${handStepTier({ step })}]  ${step.what}` : `${step.id}  ${step.what}`);
    if (step.ifIgnored !== undefined) {
      deps.writeOut(`    if the owner does nothing: ${step.ifIgnored}`);
    }
    deps.writeOut(`    unblocks ${step.unblocks} · posted ${step.postedIso} by ${step.postedBy}`);
    deps.writeOut(`    settles with ${step.witness}`);
    const keptReason = kept.get(`hand:${step.id}`);
    if (keptReason !== undefined) {
      deps.writeOut(`    kept because ${keptReason}`);
    }
    const snoozedUntil = snoozed.get(step.id);
    if (snoozedUntil !== undefined) {
      deps.writeOut(`    snoozed until ${snoozeWakeLabel({ untilIso: snoozedUntil })}`);
    }
  });
}

/**
 * Why each card a settle kept is still up, read off the card-landing ledger. A ledger that cannot be read is said
 * on stderr and reads as no reasons, so the list of what waits on the owner never fails for want of an annotation. A
 * ledger line that did not read is said only when it may be about one of the listed cards: one naming another card, or
 * naming no card key at all, cannot be a listed card's reason (`../../../talk/cardLedgerFile.ts`).
 *
 * @param cardKeys the card key of every step the list prints
 * @param deps where the problem is said
 * @returns card key → reason
 */
function keptReasonsOf({
  cardKeys,
  deps,
  home,
}: {
  cardKeys: ReadonlySet<string>;
  deps: HandDeps;
  home: string;
}): ReadonlyMap<string, string> {
  const ledger = readCardLandings({ home });
  if (ledger.isErr()) {
    deps.writeDiagnostic(`hand list: why a kept card stays up is not shown — ${ledger.error.message}`);
    return new Map();
  }
  const unread = unreadableCardLinesForKeys({ cardKeys, lines: ledger.value.unreadableLines });
  if (unread.length > 0) {
    deps.writeDiagnostic(
      `hand list: card-landing line(s) ${unread.map((line) => String(line.lineNumber)).join(", ")} did not read, so a kept card's reason may be missing`,
    );
  }
  return keptReasons({ rows: ledger.value.rows });
}

/** `slopweaver hand list`. */
export const handListCommand = defineCommand({
  run: (argv) => runHandList({ deps: productionHandDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
