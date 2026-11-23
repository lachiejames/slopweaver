/**
 * The effectful half of `../../../hand/draftAsOwner.ts`: read the ask a step opens only when the step names a draft as
 * the owner and names no parked draft by id, fold its journal, and hand the judgement to the pure gate.
 */

import { draftAsOwnerPhrase, type OpenedAskOffer, undrawnDraftVerdict } from "../../../hand/draftAsOwner.js";
import { consoleQueueTarget } from "../../../hand/queueLink.js";
import type { HandStep } from "../../../hand/step.js";
import { runDisposition } from "../../../handover/boardTypes.js";
import { draftIdsNamed } from "../../../handover/namedDraftGate.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { EXIT_USAGE } from "../../exitCodes.js";

/**
 * What the ask a step opens offers: `no-ask` when its address opens none, `offers-message` only when that ask's run
 * is waiting on the owner with a Slack or mail action the card draws.
 *
 * A journal that will not read is `offers-none`, never `offers-message`: the card could not draw it either.
 *
 * @param step the built step
 * @param home the state home the run journals live under
 * @returns what the opened ask offers
 */
function openedAskOffer({ step, home }: { step: HandStep; home: string }): OpenedAskOffer {
  if (step.url === undefined) {
    return "no-ask";
  }
  const target = consoleQueueTarget({ url: step.url });
  if (target?.kind !== "ask") {
    return "no-ask";
  }
  const read = readRunJournal({ runsDir: stateHomePaths({ home }).runs, slug: target.id });
  if (read.isErr()) {
    return "offers-none";
  }
  const disposition = runDisposition({ events: read.value.events, unreadableLines: read.value.unreadable });
  if (disposition.kind === "waiting-on-owner" && disposition.action !== undefined) {
    return "offers-message";
  }
  return "offers-none";
}

/**
 * Whether a step asking the owner to react to a message drafted as them carries it — with the refusal already written.
 *
 * No phrase is no read: the journal is never opened for a step that names no draft as the owner.
 *
 * @param step the built step
 * @param home the state home
 * @param env the process environment, for the hatch
 * @param write where a refusal line goes — the verb's own diagnostic channel
 * @returns `undefined` to proceed, or the exit code to return
 */
export function undrawnDraftExit({
  step,
  home,
  env,
  write,
}: {
  step: HandStep;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  write: (line: string) => void;
}): number | undefined {
  const texts = [step.what, step.where];
  if (draftAsOwnerPhrase({ texts }) === undefined) {
    return undefined;
  }
  const draftIds = draftIdsNamed({ texts: [step.what, step.where, step.unblocks, step.ifIgnored, step.witness] });
  let opened: OpenedAskOffer = "no-ask";
  if (draftIds.length === 0) {
    opened = openedAskOffer({ home, step });
  }
  const verdict = undrawnDraftVerdict({ command: "slopweaver hand post", draftIds, env, opened, texts });
  if (verdict.kind === "ok") {
    return undefined;
  }
  for (const line of verdict.lines) {
    write(line);
  }
  if (verdict.kind === "hatched") {
    return undefined;
  }
  return EXIT_USAGE;
}
