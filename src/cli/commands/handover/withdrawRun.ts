/**
 * `handover withdraw` — the run's holder takes its own recorded question back, because the fact it waited on
 * resolved itself, WITHOUT writing an answer in the owner's name.
 *
 * ## The gap this closes
 *
 * An ask can go moot while it waits: a failing check the ask was about turns green again. The verbs
 * on a waiting run are `answer`, `correct`, `reconfirm` and `amend`, and none retracts, so a holder would journal
 * `handover answer --answer "Premise dissolved, not a ruling: …"` — an `answered` event every reader takes as
 * the owner's words, for a question they never saw. Reproduce: `jq -c 'select(.kind=="answered")'
 * $SLOPWEAVER_HOME/runs/<slug>.jsonl`.
 *
 * So a withdrawal is its own event, `question-withdrawn`, bound to the open question's current text and carrying
 * the one line of the check that dissolved it. It settles the question and reopens the run exactly as an answer
 * does, and nothing that reads `answered` as the owner's (`../../../handover/ruling.ts`, `../../../handover/rulingAudit.ts`)
 * ever sees it.
 *
 * ## Why it requires holding the run, unlike `reconfirm`
 *
 * A reconfirm only re-dates a card; a withdrawal takes it OFF the owner's Queue. Only the session that asked — or one that
 * has since claimed the run — knows whether the premise really dissolved, so a peer's withdrawal on someone
 * else's run is refused by the same ownership guard `answer` and `correct` pass.
 *
 * That guard lets an UNOWNED run through — one `handover start` recorded no writer for, because it could not name
 * exactly one session — so every caller would be its holder. A withdrawal asks for the run to be MINE instead, and
 * an unowned run is `handover claim`ed first.
 *
 * ## A registered ask with no run has no holder, and is cancelled rather than reopened
 *
 * A row `handover register` wrote waits on the owner with no run, so there is nothing to reopen and nobody to hold it:
 * any session may withdraw it, exactly as any may reconfirm it. Starting a run to get a holder would itself take
 * the card off the owner's Queue, which loops. The row becomes `status: cancelled` with the
 * reason as its `statusSummary:` — never a `settlement:`, which reads as the owner's decision
 * (`../../../handover/registeredAskChange.ts`).
 *
 * ## It does not post
 *
 * The console reads the journal, so the card leaves the page the owner is already looking at.
 */

import { realCmuxCli } from "../../../cmux/sidebar.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { currentSessionId, runOwnership } from "../../../handover/runOwner.js";
import { publishRunWorkspaceRef } from "../../../handover/workspaceRefPublish.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import {
  lifecycleUsage,
  mutationRefusal,
  nowIso,
  phaseRefusalFor,
  type Resolved,
  resolve,
  stringFlag,
  VERB_ARG_OFFSET,
} from "./lifecycleRunCore.js";
import { stillRealLine } from "./reconfirmRun.js";
import { applyRegisteredAskChange, registeredAskOfResolved } from "./registeredAskWrite.js";

/**
 * `handover withdraw` — journal the holder's withdrawal of the question its run is waiting on.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverWithdraw(argv: readonly string[]): Promise<number> {
  // The deepest shell: the fleet-ceiling delivery withdraws yesterday's card in-process, past main.ts's gate.
  const gated = refuseRunnerOnStandingRuling({ noun: "handover", rest: argv.slice(VERB_ARG_OFFSET), verb: "withdraw" });
  if (gated !== undefined) {
    return gated;
  }
  const resolved = resolve({ argv, verb: "withdraw" });
  if (typeof resolved === "number") {
    return resolved;
  }
  // The same one-line rule a reconfirm's check answers to: a reason that spans lines is not the one check it names.
  const why = stillRealLine({ value: stringFlag({ name: "why", parsed: resolved.parsed }) });
  if (why === undefined) {
    logger.error({
      msg:
        "handover withdraw: --why is required, one non-empty line — the check that shows the fact the question " +
        "waited on resolved itself",
    });
    logger.error({ msg: lifecycleUsage({ verb: "withdraw" }) });
    return EXIT_USAGE;
  }
  if (registeredAskOfResolved({ resolved, rewritesStillReal: false }) !== undefined) {
    return applyRegisteredAskChange({
      change: { kind: "withdraw", why },
      resolved,
      said: "withdrawn — cancelled with that reason, and no answer written in the owner's name",
      verb: "withdraw",
    });
  }
  const ownership = mutationRefusal({ resolved, verb: "withdraw" });
  if (ownership !== undefined) {
    return ownership;
  }
  if (!heldHere({ events: resolved.context.events, slug: resolved.context.doc.slug })) {
    return EXIT_ERROR;
  }
  const refusal = phaseRefusalFor({ resolved, verb: "withdraw" });
  if (refusal !== undefined) {
    logger.error({ msg: `handover withdraw: ${refusal}` });
    return EXIT_ERROR;
  }
  return recordWithdrawal({ resolved, why });
}

/** Journal the withdrawal of the run's open question, reopening the run. */
function recordWithdrawal({ resolved, why }: { resolved: Resolved; why: string }): number {
  const question = resolved.context.run.openQuestion;
  if (question === undefined) {
    logger.error({
      msg:
        "handover withdraw: the run reads as waiting on the owner but carries no question text, which is a " +
        "defect rather than a state — NOTHING was recorded",
    });
    return EXIT_ERROR;
  }
  const appended = applyRowEvent({
    event: { atIso: nowIso(), kind: "question-withdrawn", question, why },
    runsDir: resolved.runsDir,
    slug: resolved.context.doc.slug,
  });
  if (appended.isErr()) {
    logger.error({ msg: `handover withdraw: ${appended.error.message}` });
    return EXIT_ERROR;
  }
  publishRunWorkspaceRef({ cli: realCmuxCli(), verb: "handover withdraw" });
  logger.out({
    line: `handover withdraw: withdrew the question for ${resolved.context.doc.slug} — the run is open again`,
  });
  logger.out({ line: `  journal: ${appended.value.path}` });
  return EXIT_OK;
}

/** Whether this session is the run's recorded writer, saying why not when it is not; foreign and released runs are refused upstream. */
function heldHere({ events, slug }: { events: readonly RunEvent[]; slug: string }): boolean {
  if (runOwnership({ events, sessionId: currentSessionId({ env: process.env }) }).kind === "mine") {
    return true;
  }
  logger.error({
    msg:
      `handover withdraw: ${slug} has no recorded holder, so no session may withdraw its question — ` +
      `\`handover claim ${slug} --why "<why>"\` first. NOTHING was recorded`,
  });
  return false;
}
