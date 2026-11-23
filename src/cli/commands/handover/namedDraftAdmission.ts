/**
 * The effectful half of `src/handover/namedDraftGate.ts`: read the draft register only when the texts name a draft,
 * fold it, and hand the judgement to the pure gate. Shared by every verb that writes a card the owner reads — `handover
 * ask`, `correct`, `offer`, `reconfirm`, a decision `register`, and `hand post` — so none of them can drift from it.
 * Beside it, the undrawn-draft gate on a card saying a message was drafted as the owner (`undrawnAskDraftExit`), which every
 * one of those but `offer` (which always carries its draft) and `hand post` (`../hand/draftCarried.ts`) runs.
 * Beside it, the effectful halves of `src/handover/planSignInGate.ts`, which `handover ask` and `correct` run, and of
 * `src/handover/fleetSignInGate.ts`, which those and `hand post` run.
 */

import { readSlackDraftLines } from "../../../admit/slackDraftStore.js";
import { readSignInProbes } from "../../../browser/signInProbeStore.js";
import { readPlanEmails } from "../../../hand/planSignIn.js";
import { type AskAction, actionMessages } from "../../../handover/askAction.js";
import type { AskExampleSet } from "../../../handover/askExamples.js";
import type { AskOption, AskStakes } from "../../../handover/askShape.js";
import { offeredADraft, runDisposition } from "../../../handover/boardTypes.js";
import { fleetSignInProviders, fleetSignInVerdict } from "../../../handover/fleetSignInGate.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { draftIdsNamed, namedDraftVerdict } from "../../../handover/namedDraftGate.js";
import { planSignInVerdict } from "../../../handover/planSignInGate.js";
import { undrawnAskDraftVerdict } from "../../../handover/undrawnAskDraftGate.js";
import { logger } from "../../../lib/logger.js";
import { foldSlackDraftLog, parseSlackDraftLog, skippedDraftNote } from "../../../outbound/slack/draftLog.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";
import { shapeFrom } from "./listJsonAsk.js";

/**
 * A row's example scenes, which the card LEADS with — so a sign-in ask written into one reaches
 * the owner as surely as one in the question.
 *
 * @param examples the row's examples, when it has any
 * @returns each scene's text, or none for a gap or no examples
 */
export function exampleTexts({ examples }: { examples: AskExampleSet | undefined }): readonly string[] {
  if (examples?.kind !== "examples") {
    return [];
  }
  return examples.examples;
}

/**
 * The texts a card's shape draws — its problem, every option with its trade-off, its lean and its stakes — or none
 * when the verb was handed no shape. The stakes count: the card draws risk, blast radius and still-real as its own
 * lines (`site/lib/queueAskRow.ts`'s `askTexts`), so an id there is one the card names.
 *
 * @param shape the admitted shape, when there is one
 * @returns the texts, in the order the card draws them
 */
export function shapeTexts({
  shape,
}: {
  shape:
    | {
        readonly problem: string;
        readonly lean: string;
        readonly options: readonly AskOption[];
        readonly stakes: AskStakes | undefined;
      }
    | undefined;
}): readonly string[] {
  if (shape === undefined) {
    return [];
  }
  const options = shape.options.flatMap((one) => [one.option, one.tradeoff]);
  if (shape.stakes === undefined) {
    return [shape.problem, ...options, shape.lean];
  }
  const { risk, blastRadius, stillReal } = shape.stakes;
  return [shape.problem, ...options, shape.lean, risk, blastRadius, stillReal];
}

/**
 * The texts a card takes off the run's own doc rather than off the verb's flags — its slug, drawn as the subject, and
 * its summary, drawn as a linked hand card's what — so an id either names is checked by the verb recording the card.
 *
 * @param doc the run's parsed doc
 * @returns the slug, then the summary when the doc states one
 */
export function docTexts({ doc }: { doc: { readonly slug: string; readonly summary: string | undefined } }): string[] {
  if (doc.summary === undefined) {
    return [doc.slug];
  }
  return [doc.slug, doc.summary];
}

/**
 * Every text an action draws on its card — a Slack action's every message, mention names and each destination's label,
 * trade-off and recipients, as `SlackActionPreview` renders them; a mail's sender, recipients, subject and body, as
 * `MailActionPreview` does — or none when the verb was handed no action. An id any of them quotes is a draft the card
 * names, so it answers the same check.
 *
 * @param action the admitted action, when there is one
 * @returns the texts, in the order the preview draws them
 */
export function actionTexts({ action }: { action: AskAction | undefined }): readonly string[] {
  if (action === undefined) {
    return [];
  }
  if ("form" in action) {
    const { to, cc, bcc, subject, body } = action.form;
    return [action.from, ...to, ...cc, ...bcc, subject, body];
  }
  const destinations = action.destinations.flatMap((one) => [
    one.label,
    one.tradeoff,
    ...(one.kind === "dm" ? one.recipients.map((person) => person.label) : []),
  ]);
  return [...actionMessages({ action }), ...action.mentions.map((person) => person.label), ...destinations];
}

/** Why a verb must not record: the lines to print, whole, and the exit code to return. */
export interface NamedDraftRefusal {
  readonly code: number;
  readonly lines: readonly string[];
}

/**
 * Whether the texts a verb is about to record name only drafts the register still holds.
 *
 * No id named is no read: the register is never opened for a card that names no draft. A register that exists
 * carrying a line it cannot read that names one of these ids, or names none, is a refusal of FACT: that
 * line may be the one that spent the draft, so reading past it would blame the card for a broken log.
 *
 * @param texts the fields about to be recorded; an absent one is skipped
 * @param command the door being refused, as the owner would type it
 * @param home the state home the register lives under
 * @param env the process environment, for the hatch
 * @returns `undefined` to proceed, or the refusal
 */
export function namedDraftRefusal({
  texts,
  command,
  home,
  env,
}: {
  texts: readonly (string | undefined)[];
  command: string;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
}): NamedDraftRefusal | undefined {
  const ids = draftIdsNamed({ texts });
  if (ids.length === 0) {
    return undefined;
  }
  const log = parseSlackDraftLog({ lines: readSlackDraftLines({ home }) });
  const unread = skippedDraftNote({
    skipped: log.skipped.filter((line) => line.id === undefined || ids.includes(line.id)),
  });
  if (unread !== undefined) {
    return {
      code: EXIT_ERROR,
      lines: [
        `${command}: it names ${ids.join(", ")}, and the drafts register could not be read to check them — ` +
          `${unread}. NOTHING was recorded.`,
      ],
    };
  }
  const verdict = namedDraftVerdict({ command, env, ids, items: foldSlackDraftLog({ log }) });
  if (verdict.kind === "ok") {
    return undefined;
  }
  return { code: EXIT_USAGE, lines: verdict.lines };
}

/**
 * {@link namedDraftRefusal}, with its lines already written — the one call every gated verb makes, so each prints a
 * refusal the same way and none of them grows a loop of its own.
 *
 * @param texts the fields about to be recorded; an absent one is skipped
 * @param command the door being refused, as the owner would type it
 * @param home the state home the register lives under
 * @param env the process environment, for the hatch
 * @param write where a refusal line goes — the verb's own diagnostic channel
 * @returns `undefined` to proceed, or the exit code to return
 */
export function namedDraftExit({
  texts,
  command,
  home,
  env,
  write,
}: {
  texts: readonly (string | undefined)[];
  command: string;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  write: (line: string) => void;
}): number | undefined {
  const refused = namedDraftRefusal({ command, env, home, texts });
  if (refused === undefined) {
    return undefined;
  }
  for (const line of refused.lines) {
    write(line);
  }
  return refused.code;
}

/**
 * What the run's waiting card already carries, for a verb rewriting part of its words (`correct`, a reshaping `ask`,
 * `reconfirm`): whether its ask offers a message — a broken action counts, since the card says its draft did not
 * read rather than silently showing none — and the question, shape and reconfirmed still-real line it keeps drawing,
 * where a parked draft's id may already be named. A correction keeps the reconfirmed line (`openQuestion.ts`), and the
 * card publishes it (`listJsonAsk.ts`), so it is drawn text like the shape. The shape is the
 * card's own `shapeFrom`, so a run that journalled none falls back to the doc's front matter here exactly as there.
 *
 * @param context the resolved run, its journal already decoded, and the doc whose shape the card may fall back to
 * @returns the offer, the waiting question, its shape's texts and its reconfirmed line — none of them for a run not
 * waiting on the owner
 */
export function waitingCard({
  context,
}: {
  context: {
    readonly events: readonly RunEvent[];
    readonly unreadable: readonly number[];
    readonly doc: Parameters<typeof shapeFrom>[0]["doc"];
  };
}): {
  readonly offersMessage: boolean;
  readonly question: string | undefined;
  readonly shape: readonly string[];
  readonly stillReal: string | undefined;
} {
  const run = runDisposition({ events: context.events, unreadableLines: context.unreadable });
  if (run.kind !== "waiting-on-owner") {
    return { offersMessage: false, question: undefined, shape: [], stillReal: undefined };
  }
  return {
    offersMessage: offeredADraft({ run }),
    question: run.question,
    shape: shapeTexts({ shape: shapeFrom({ doc: context.doc, run })?.shape }),
    stillReal: run.reconfirmed?.stillReal,
  };
}

/**
 * The undrawn-draft gate (`../../../handover/undrawnAskDraftGate.ts`) over one card, with its lines already written:
 * a card saying a message was drafted as the owner must name a parked draft or offer the message. Pure — every input is
 * already in hand — so it costs nothing on a card that says no such thing.
 *
 * @param texts what the card asks, which the phrase is read in — never the row's slug or summary
 * @param named every text an `sd-` id may carry the draft in, slug and summary included
 * @param offersMessage the ask carries an `--action`, on this call or already on the run
 * @param command the door being refused, as the owner would type it
 * @param env the process environment, for the hatch
 * @param write where a refusal or hatched line goes — the verb's own diagnostic channel
 * @returns `undefined` to proceed, or the exit code to return
 */
export function undrawnAskDraftExit({
  texts,
  named,
  offersMessage,
  command,
  env,
  write,
}: {
  texts: readonly (string | undefined)[];
  named: readonly (string | undefined)[];
  offersMessage: boolean;
  command: string;
  env: Readonly<Record<string, string | undefined>>;
  write: (line: string) => void;
}): number | undefined {
  const draftIds = draftIdsNamed({ texts: [...named, ...texts] });
  const verdict = undrawnAskDraftVerdict({ command, draftIds, env, offersMessage, texts });
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

/**
 * The plan sign-in gate (`../../../handover/planSignInGate.ts`) over the texts a question's card draws, with its
 * lines already written. The doc's own slug and summary are deliberately NOT among them: a row ABOUT plan sign-ins
 * names aliases in its summary and asks the owner to sign into nothing.
 *
 * @param texts the question and its shape, as the card draws them
 * @param command the door being refused, as the owner would type it
 * @param home the state home the plan register lives under
 * @param env the process environment, for the hatch
 * @param write where a refusal line goes — the verb's own diagnostic channel
 * @returns `undefined` to proceed, or the exit code to return
 */
export async function planSignInExit({
  texts,
  command,
  home,
  env,
  write,
}: {
  texts: readonly string[];
  command: string;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  write: (line: string) => void;
}): Promise<number | undefined> {
  const verdict = planSignInVerdict({ command, env, plans: await readPlanEmails({ home }), texts });
  if (verdict.kind === "ok") {
    return undefined;
  }
  for (const line of verdict.lines) {
    write(line);
  }
  return EXIT_USAGE;
}

/**
 * The fleet sign-in gate (`../../../handover/fleetSignInGate.ts`) over the texts a card draws, with its lines already
 * written: a card asking the owner to sign in to Datadog or GitHub needs a fresh `browser sign-in` look that reached the
 * owner's hands. The ledger is read only when the texts name one of the two, so every other card costs nothing. A ledger that
 * exists and cannot be read refuses as FACT, never reads as "no look".
 *
 * @param texts the fields about to be recorded, as the card draws them
 * @param command the door being refused, as the owner would type it
 * @param home the state home the probe ledger lives under
 * @param env the process environment, for the hatch
 * @param nowIso the instant the card would be recorded at, which a look must be fresh against
 * @param write where a refusal line goes — the verb's own diagnostic channel
 * @returns `undefined` to proceed, or the exit code to return
 */
export function fleetSignInExit({
  texts,
  command,
  home,
  env,
  nowIso,
  write,
}: {
  texts: readonly (string | undefined)[];
  command: string;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  nowIso: string;
  write: (line: string) => void;
}): number | undefined {
  const present = texts.filter((text): text is string => text !== undefined);
  if (fleetSignInProviders({ text: present.join("\n") }).length === 0) {
    return undefined;
  }
  const probes = readSignInProbes({ home });
  if (probes.isErr()) {
    write(`${command}: the card asks the owner to sign in, and ${probes.error.message}. NOTHING was recorded.`);
    return EXIT_ERROR;
  }
  const verdict = fleetSignInVerdict({ command, env, nowIso, probes: probes.value, texts: present });
  if (verdict.kind === "ok") {
    return undefined;
  }
  for (const line of verdict.lines) {
    write(line);
  }
  return EXIT_USAGE;
}

/**
 * Both sign-in gates over one card, in the order every recording verb runs them — {@link planSignInExit} over the
 * question and shape, then {@link fleetSignInExit} over those and the example scenes — each refusal line written to
 * stderr, judged at this instant.
 *
 * @param command the door being refused, as the owner would type it
 * @param home the state home both registers live under
 * @param planTexts the texts the plan gate reads, which leave the example scenes out
 * @param fleetTexts the texts the fleet gate reads, scenes included
 * @returns `undefined` to proceed, or the exit code of the first refusal
 */
export async function cardSignInExit({
  command,
  home,
  planTexts,
  fleetTexts,
}: {
  command: string;
  home: string;
  planTexts: readonly string[];
  fleetTexts: readonly string[];
}): Promise<number | undefined> {
  const write: (line: string) => void = (line) => {
    logger.error({ msg: line });
  };
  const plan = await planSignInExit({ command, env: process.env, home, texts: planTexts, write });
  if (plan !== undefined) {
    return plan;
  }
  const nowIso = new Date().toISOString();
  return fleetSignInExit({ command, env: process.env, home, nowIso, texts: fleetTexts, write });
}
