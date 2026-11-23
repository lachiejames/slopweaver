/**
 * Which prose a step's Queue card draws, and the first machine id in it — the card gate's own criterion over exactly
 * the fields `site/lib/handCard.ts` draws in prose the poster wrote.
 *
 * A LEAF on purpose: it imports only `../pages/machineIds.ts` and `./queueLink.ts`, and reads a step STRUCTURALLY,
 * so the site lane's parity test (`site/__tests__/unit/handPostMachineIdParity.test.ts`) can import it without
 * dragging `./step.ts` and `./errors.ts` — and through them most of `src/` — into the site's own type-check.
 *
 * The criterion is not restated: it is `../pages/machineIds.ts`, the one the console's copy is pinned equal to
 * (`site/__tests__/unit/machineIdsMirror.test.ts`). The fields: its sentence, its do-nothing line, what it unblocks
 * (also the summary over a carried decision), why it has no address, what settles it, each checklist line's sentence
 * and where its value sits, and a carried decision's problem, options, lean and stakes on a step that links nowhere but
 * its own card, the only step whose card draws one. Never an address — `url`, `opened`, `where`, `cites` or a checklist
 * line's page — nor a copy block (`literal`, a line's command), because the card draws an address as a link and a copy
 * block as what the owner pastes, and allows an id in either. A URL inside prose is skipped, as the card skips it.
 */
import { machineIdsIn } from "../pages/machineIds.js";

import { opensOwnHandStep } from "./queueLink.js";

/** A URL in prose, which the card draws as a link and so allows an id inside. */
const URL_IN_PROSE = /https?:\/\/\S+/g;

/** The step fields the card draws, read structurally so a posted step and a test fixture both satisfy it. */
interface DrawnStep {
  readonly id: string;
  readonly what: string;
  readonly url?: string | undefined;
  readonly notice?: true | undefined;
  readonly ifIgnored?: string | undefined;
  readonly unblocks?: string | undefined;
  readonly unaddressed?: string | undefined;
  readonly witness?: string | undefined;
  readonly checklist?:
    readonly { readonly action: string; readonly find?: readonly string[] | undefined }[] | undefined;
  readonly decision?:
    | {
        readonly problem: string;
        readonly options: readonly { readonly option: string; readonly tradeoff: string }[];
        readonly lean: string;
        readonly stakes: { readonly risk: string; readonly blastRadius: string; readonly stillReal: string };
      }
    | undefined;
}

/** One run of prose the card draws, named by the step field a refusal points the poster at. */
interface DrawnProse {
  readonly field: string;
  readonly text: string;
}

/**
 * Each checklist line's sentence and where its value sits, in the order the card draws them.
 *
 * @returns one `checklist` run per sentence and per place
 */
function checklistProse({ checklist }: { checklist: DrawnStep["checklist"] }): readonly DrawnProse[] {
  if (checklist === undefined) {
    return [];
  }
  return checklist.flatMap((line): readonly DrawnProse[] => {
    if (line.find === undefined) {
      return [{ field: "checklist", text: line.action }];
    }
    return [line.action, ...line.find].map((text) => ({ field: "checklist", text }));
  });
}

/**
 * A carried decision's problem, options, lean and stakes — drawn only on a step linking nowhere but its own card
 * (`site/lib/handStepAsk.ts` `decisionForHand`); beside an incident's proof link the card draws none, so its words are
 * not read.
 *
 * @returns one `decision` run per drawn sentence, or none when the card draws no decision
 */
function decisionProse({ step }: { step: DrawnStep }): readonly DrawnProse[] {
  const decision = step.decision;
  const drawsDecision = step.url === undefined || opensOwnHandStep({ id: step.id, url: step.url });
  if (decision === undefined || !drawsDecision) {
    return [];
  }
  const texts = [
    decision.problem,
    ...decision.options.flatMap((option) => [option.option, option.tradeoff]),
    decision.lean,
    decision.stakes.risk,
    decision.stakes.blastRadius,
    decision.stakes.stillReal,
  ];
  return texts.map((text) => ({ field: "decision", text }));
}

/**
 * Every run of prose the step's card draws that the poster wrote, in the order the card draws it.
 *
 * @returns each present field with its text
 */
function cardDrawnProse({ step }: { step: DrawnStep }): readonly DrawnProse[] {
  const optional: readonly { field: string; text: string | undefined }[] = [
    { field: "ifIgnored", text: step.ifIgnored },
    { field: "unblocks", text: step.unblocks },
    { field: "unaddressed", text: step.unaddressed },
    { field: "witness", text: step.witness },
  ];
  const present = optional.flatMap(({ field, text }) => (text === undefined ? [] : [{ field, text }]));
  return [
    { field: "what", text: step.what },
    ...present,
    ...checklistProse({ checklist: step.checklist }),
    ...decisionProse({ step }),
  ];
}

/**
 * The first field of the step's card that names a session, call, talk, turn or run by its machine id.
 *
 * @param step the step a writer is about to record, read for the fields its card draws
 * @returns the field and the id it carries, or `undefined` when the card would be drawn or the step is a notice,
 * which is on no Queue (`./step.ts` `waitingHandSteps`) and so has no card to withhold
 */
export function machineIdInCardProse({ step }: { step: DrawnStep }): { field: string; id: string } | undefined {
  if (step.notice === true) {
    return undefined;
  }
  return firstMachineId({ runs: cardDrawnProse({ step }) });
}

/**
 * The first run of prose carrying a machine id, a URL inside it skipped as the card skips it.
 *
 * @param runs the prose the card draws, in its order
 * @returns the field and the id it carries, or `undefined` when none carries one
 */
function firstMachineId({ runs }: { runs: readonly DrawnProse[] }): { field: string; id: string } | undefined {
  for (const { field, text } of runs) {
    const id = machineIdsIn({ text: text.replace(URL_IN_PROSE, " ") }).at(0);
    if (id !== undefined) {
      return { field, id };
    }
  }
  return undefined;
}

/**
 * The decision an opened ask brings to the step's card, field for field as the board publishes it and
 * `site/lib/handStepAsk.ts` `linkedHandDecision` joins it — the summary already capped, each stakes line on its own.
 */
interface OpenedAskDecision {
  readonly summary: string | undefined;
  readonly problem: string;
  readonly options: readonly { readonly option: string; readonly tradeoff: string }[];
  readonly lean: string;
  readonly risk: string | undefined;
  readonly blastRadius: string | undefined;
  readonly stillReal: string | undefined;
}

/**
 * The first machine id in the decision an OPENED ask draws on a step's card — `site/lib/handStepAsk.ts`
 * `decisionForHand` draws the linked ask's summary, problem, options, lean and stakes in place of the step's own,
 * and the card gate reads every one of them.
 *
 * @param ask the decision as the board publishes it, so a cap or a derivation the board applies is already applied
 * @returns the field (named `ask <field>`, so the poster knows the words are the ask's) and the id, or `undefined`
 */
export function machineIdInOpenedAsk({ ask }: { ask: OpenedAskDecision }): { field: string; id: string } | undefined {
  const texts: readonly { field: string; text: string | undefined }[] = [
    { field: "summary", text: ask.summary },
    { field: "problem", text: ask.problem },
    ...ask.options.flatMap((option) => [
      { field: "options", text: option.option },
      { field: "options", text: option.tradeoff },
    ]),
    { field: "lean", text: ask.lean },
    ...stakesRuns({ ask }),
  ];
  const runs = texts.flatMap(({ field, text }) => (text === undefined ? [] : [{ field: `ask ${field}`, text }]));
  return firstMachineId({ runs });
}

/**
 * An opened ask's three stakes lines — drawn only whole, as `site/lib/handCard.ts` `stepDecision` draws them, so a
 * lone reconfirmed still-real line beside no risk or blast radius is not read. A blank line counts as
 * absent, as the site's `saidText` reads one.
 *
 * @returns one `stakes` run per line when all three are said, else none
 */
function stakesRuns({ ask }: { ask: OpenedAskDecision }): readonly DrawnProse[] {
  const lines = [ask.risk, ask.blastRadius, ask.stillReal];
  const said = lines.filter((line): line is string => line !== undefined && line.trim() !== "");
  if (said.length < lines.length) {
    return [];
  }
  return said.map((text) => ({ field: "stakes", text }));
}
