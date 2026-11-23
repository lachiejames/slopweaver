/**
 * The effectful half of `../../../hand/cardDrawnProse.ts`'s `machineIdInOpenedAsk`: read the ask a step opens — its
 * doc by exact slug and its run journal, two file reads and never a board scan — and refuse the step when the
 * decision that ask brings to the step's card names a session, call, talk, turn or run by its machine id.
 *
 * The step's own words are the posting form's (`../../../hand/machineIdInProse.ts`); this is the half the posting
 * form cannot reach, because it is pure. The Queue draws an opened ask's shape in place of the step's own decision
 * (`site/lib/handStepAsk.ts` `decisionForHand`), so a clean step opening an ask whose problem names a call went up as a
 * note while its card was withheld — a review counterexample.
 *
 * The residue, stated: this reads the ask as it stands at posting. An ask re-shaped after the note is up can still
 * have its card withheld, and the Queue's own gate is what holds then; a journal that will not read is judged on
 * the doc's front matter alone, as a card falls back to it; and an ask filed under a name other than `<slug>.md`
 * is not found by the exact read, though the board would join it. Each misses toward posting, never toward refusing
 * a step whose card the Queue would draw. The one that can refuse one is a board holding two live docs under the same slug, where the Queue joins whichever the scan
 * lists first and this reads `<slug>.md`: a duplicate slug is already a defect every lifecycle verb
 * refuses, and telling the two apart would take a whole-board scan on every post.
 */
import { join } from "node:path";

import { machineIdInOpenedAsk } from "../../../hand/cardDrawnProse.js";
import { consoleQueueTarget } from "../../../hand/queueLink.js";
import type { HandStep } from "../../../hand/step.js";
import { runDisposition } from "../../../handover/boardTypes.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { lookupDocBySlug } from "../../../handover/store.js";
import { stateHomePaths } from "../../../stateHome.js";
import { EXIT_USAGE } from "../../exitCodes.js";
import { optionsFor, publishedStillRealOf, shapeFrom } from "../handover/listJsonAsk.js";
import { cappedSummary } from "../handover/listJsonRowText.js";

/**
 * The machine id the ask a step opens would draw on the step's card, or `undefined` when the step opens no ask, the
 * ask is not on the live board (an archived one is not), it carries no shape the card would draw, or none of its words names one.
 *
 * @param step the built step
 * @param home the state home the ask's doc and journal live under
 * @returns the slug of the ask, the field and the id
 */
function openedAskMachineId({
  step,
  home,
}: {
  step: HandStep;
  home: string;
}): { slug: string; field: string; id: string } | undefined {
  if (step.notice === true || step.url === undefined) {
    return undefined;
  }
  const target = consoleQueueTarget({ url: step.url });
  if (target?.kind !== "ask") {
    return undefined;
  }
  const paths = stateHomePaths({ home });
  // The live board only: the Queue joins an opened ask off the rows `scanBoard` composes, which skip the archive
  // and keep a doc whose front matter carries a problem, as this lenient read does.
  const live = join(paths.handovers, `${target.id}.md`);
  const doc = lookupDocBySlug({ handoverDir: paths.handovers, slug: target.id });
  if (doc === undefined || doc.path !== live) {
    return undefined;
  }
  const read = readRunJournal({ runsDir: paths.runs, slug: target.id });
  let run = runDisposition({ events: [], unreadableLines: [] });
  if (read.isOk()) {
    run = runDisposition({ events: read.value.events, unreadableLines: read.value.unreadable });
  }
  // Every field as `../handover/listJson.ts` publishes the row the Queue joins: the same shape, the options derived
  // from a recorded action, the still-real line a reconfirm replaced, and the summary capped.
  const shape = shapeFrom({ doc, run })?.shape;
  const options = optionsFor({ model: { run }, shape });
  // Fewer than two options and the Queue draws no decision for the ask (`site/lib/handStepAsk.ts` `linkedHandDecision`).
  if (shape === undefined || options.length < 2) {
    return undefined;
  }
  const found = machineIdInOpenedAsk({
    ask: {
      blastRadius: shape.stakes?.blastRadius,
      lean: shape.lean,
      options,
      problem: shape.problem,
      risk: shape.stakes?.risk,
      stillReal: publishedStillRealOf({ doc, run }).stillReal,
      summary: cappedSummary({ summary: doc.summary }),
    },
  });
  if (found === undefined) {
    return undefined;
  }
  return { ...found, slug: target.id };
}

/**
 * Whether the ask a step opens would have the step's card withheld for a machine id — with the refusal written.
 *
 * @param step the built step
 * @param home the state home
 * @param write where the refusal line goes — the verb's own diagnostic channel
 * @returns `undefined` to proceed, or the exit code to return
 */
export function openedAskMachineIdExit({
  step,
  home,
  write,
}: {
  step: HandStep;
  home: string;
  write: (line: string) => void;
}): number | undefined {
  const found = openedAskMachineId({ home, step });
  if (found === undefined) {
    return undefined;
  }
  write(
    `hand post: the ask this step opens (${found.slug}) has its ${found.field.replace(/^ask /, "")} name ` +
      `"${found.id}" by its machine id, and the Queue draws that ask's decision on this step's card and withholds a ` +
      "card that draws one — the note would go up while its card stayed off the owner's Queue. NOTHING was recorded. " +
      `Re-word that ask first (a run's with \`slopweaver handover ask ${found.slug}\`), naming it by what it was ` +
      "doing, then post the step.",
  );
  return EXIT_USAGE;
}
