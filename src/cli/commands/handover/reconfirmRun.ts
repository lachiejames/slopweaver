/**
 * `handover reconfirm` — record that the question a run is holding still stands, WITHOUT re-asking it.
 *
 * ## Why a verb rather than a re-ask
 *
 * A refresh pass re-reads every ask waiting on the owner against the latest landed state, so the page stays
 * current and the owner wades through no stale cards. The ones still theirs need to SAY so on the console,
 * whose card ages an ask by when its still-real check was last true. The only other ways to move that date are
 * `handover ask` and `handover offer`, and both re-deliver or re-shape — so every re-verified ask would read
 * "never re-confirmed", and the pass could not make the page current without pinging the owner about decisions
 * they already have.
 *
 * So a reconfirm is its own event, bound to the question it names, carrying the one line of the check that
 * was just re-run. It touches neither the question's text, its shape, nor the instant it was asked: a
 * three-week-old ask stays three weeks old, and only its "still real as of" moves.
 *
 * ## Why it does not require holding the run
 *
 * A refresh pass crosses rows other sessions hold, exactly as `handover rule` does. Ownership guards exist so
 * two sessions never both DRIVE a run; a reconfirm moves no phase and replaces nothing the holder authored,
 * and its check line is printed on the card, so a vague one is visible where the owner reads it.
 *
 * ## A registered ask with no run is reconfirmed in its own front matter
 *
 * A row `handover register` wrote waits on the owner with no run behind it, and its card reads `stillReal:` and
 * `stillRealIso:` off the row itself, so that is what a reconfirm rewrites there
 * (`../../../handover/registeredAskChange.ts`). Refusing it with "start it first" would be no answer, because
 * starting a run is what takes the card off the owner's Queue.
 *
 * ## It does not post
 *
 * The question was delivered when it was asked. The console reads the journal, so the card changes where the
 * owner is already looking.
 */

import { cardProseVerdict } from "../../../handover/cardAlignment.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { lifecycleUsage, nowIso, phaseRefusalFor, type Resolved, resolve, stringFlag } from "./lifecycleRunCore.js";
import { docTexts, fleetSignInExit, namedDraftExit, undrawnAskDraftExit, waitingCard } from "./namedDraftAdmission.js";
import { applyRegisteredAskChange, registeredAskOfResolved, registeredKeptShape } from "./registeredAskWrite.js";

/**
 * `handover reconfirm` — journal a re-run still-real check against the question a run is waiting on.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverReconfirm(argv: readonly string[]): Promise<number> {
  const resolved = resolve({ argv, verb: "reconfirm" });
  if (typeof resolved === "number") {
    return resolved;
  }
  const stillReal = stillRealLine({ value: stringFlag({ name: "still-real", parsed: resolved.parsed }) });
  if (stillReal === undefined) {
    logger.error({
      msg:
        "handover reconfirm: --still-real is required, one non-empty line — the check you just re-ran that " +
        "shows the question is still the owner's to answer",
    });
    logger.error({ msg: lifecycleUsage({ verb: "reconfirm" }) });
    return EXIT_USAGE;
  }
  const registered = registeredAskOfResolved({ resolved, rewritesStillReal: true });
  if (registered !== undefined) {
    return reconfirmRegistered({ question: registered.question, resolved, stillReal });
  }
  const refusal = phaseRefusalFor({ resolved, verb: "reconfirm" });
  if (refusal !== undefined) {
    logger.error({ msg: `handover reconfirm: ${refusal}` });
    return EXIT_ERROR;
  }
  const waiting = waitingCard({ context: resolved.context });
  const proseExit = stillRealProseExit({
    command: "slopweaver handover reconfirm",
    home: resolved.home,
    kept: [waiting.question, ...waiting.shape],
    named: docTexts({ doc: resolved.context.doc }),
    offersMessage: waiting.offersMessage,
    stillReal,
  });
  if (proseExit !== undefined) {
    return proseExit;
  }
  const question = resolved.context.run.openQuestion;
  if (question === undefined) {
    logger.error({
      msg:
        "handover reconfirm: the run reads as waiting on the owner but carries no question text, which is a " +
        "defect rather than a state — NOTHING was recorded",
    });
    return EXIT_ERROR;
  }
  const atIso = nowIso();
  const appended = applyRowEvent({
    event: { atIso, kind: "question-reconfirmed", question, stillReal },
    runsDir: resolved.runsDir,
    slug: resolved.context.doc.slug,
  });
  if (appended.isErr()) {
    logger.error({ msg: `handover reconfirm: ${appended.error.message}` });
    return EXIT_ERROR;
  }
  logger.out({ line: `handover reconfirm: ${resolved.context.doc.slug} still stands as of ${atIso}` });
  logger.out({ line: `  journal: ${appended.value.path}` });
  return EXIT_OK;
}

/**
 * Reconfirm a registered ask that never opened a run: the same prose gates over the line, then its front matter's
 * `stillReal:` and `stillRealIso:` — where its card reads them — rather than a journal no run would derive from.
 */
async function reconfirmRegistered({
  resolved,
  question,
  stillReal,
}: {
  resolved: Resolved;
  question: string;
  stillReal: string;
}): Promise<number> {
  const proseExit = stillRealProseExit({
    command: "slopweaver handover reconfirm",
    home: resolved.home,
    kept: [question, ...registeredKeptShape({ resolved })],
    named: docTexts({ doc: resolved.context.doc }),
    offersMessage: false,
    stillReal,
  });
  if (proseExit !== undefined) {
    return proseExit;
  }
  const atIso = nowIso();
  return applyRegisteredAskChange({
    change: { atIso, kind: "reconfirm", stillReal },
    resolved,
    said: `still stands as of ${atIso}`,
    verb: "reconfirm",
  });
}

/**
 * The still-real line's four prose gates, in the order the card reads it: a picture named as text is refused on the
 * `unaligned-card` hatch, an id it names must answer the ask's own check, since the line replaces the one the
 * card draws under the question, a message it says was drafted as the owner must be one the ask carries, and a Datadog or
 * GitHub sign-in ask needs a fresh look that reached the owner's hands.
 *
 * `handover correct --still-real` runs the same four, because its line is journalled as a reconfirm.
 *
 * @param command the verb the refusal names
 * @param home the state home the named-draft admission and the sign-in probe ledger are read from
 * @param kept the waiting question and shape the card keeps drawing beside the line, so a "drafted as you" there
 * still needs its draft
 * @param named the doc's slug and summary, where an id carries a draft the line speaks of
 * @param offersMessage the run's waiting ask offers a message, which carries it too
 * @param stillReal the one-line check about to be journalled
 * @returns the exit code when either gate refuses, `undefined` when the line may be recorded
 */
export function stillRealProseExit({
  command,
  home,
  kept,
  named,
  offersMessage,
  stillReal,
}: {
  command: string;
  home: string;
  kept: readonly (string | undefined)[];
  named: readonly (string | undefined)[];
  offersMessage: boolean;
  stillReal: string;
}): number | undefined {
  const pictured = cardProseVerdict({
    command,
    env: process.env,
    fields: [{ label: "the still-real check", text: stillReal }],
  });
  if (pictured.kind === "refused") {
    pictured.lines.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  const write: Parameters<typeof namedDraftExit>[0]["write"] = (line) => {
    logger.error({ msg: line });
  };
  const drafts = namedDraftExit({ command, env: process.env, home, texts: [stillReal], write });
  if (drafts !== undefined) {
    return drafts;
  }
  // The card keeps drawing the waiting question and shape beside this line, so their prose is checked too.
  const undrawn = undrawnAskDraftExit({
    command,
    env: process.env,
    named,
    offersMessage,
    texts: [stillReal, ...kept],
    write,
  });
  if (undrawn !== undefined) {
    return undrawn;
  }
  // The card draws this line, so a sign-in ask written into it meets the fleet sign-in gate.
  return fleetSignInExit({ command, env: process.env, home, nowIso: nowIso(), texts: [stillReal], write });
}

/**
 * The `--still-real` value as the one line the card prints, or `undefined` when it is absent, blank or spans
 * lines — a check the card would have to truncate or reflow is not one line.
 *
 * @param value the raw flag value
 * @returns the trimmed line, or `undefined` when it is not one
 */
export function stillRealLine({ value }: { value: string | undefined }): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const line = value.trim();
  if (line.length === 0 || line.includes("\n")) {
    return undefined;
  }
  return line;
}
