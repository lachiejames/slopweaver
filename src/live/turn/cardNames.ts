/**
 * WHO a progress card names — every `@(U…)` the card carries, read as the person's display name.
 *
 * A card in a review channel once read `answering: … @(U0SYN000003)'s question` and quoted
 * `add @(U0SYN000003) and @(U0SYN000015) to the whitelist`. `../listen/mention.ts` normalises every Slack tag to
 * `@(id)` on purpose — an id is never ambiguous — and the card quotes that text: `./taskLabel.ts` strips only
 * the LEADING run (the bot's own address), so every person the question names past it reached the thread as an
 * id. The same defect on the console's drafts is fixed with `../../corpus/members/slackPeople.ts`; this is
 * that resolver applied to the card, not a second one.
 *
 * Applied in ONE place — `./posterFrame.ts`'s `turnFrame`, the renderer every post, advance and finalise of the
 * card goes through — so no frame builder (capture, dispatch, `turn status`, `turn watch`, the sweep) can emit
 * an id the others resolve.
 *
 * An id no member row names STAYS the id, in the `@(id)` form it arrived in: `./quotedQuestion.ts`'s doctrine
 * — an invented name on a card is worse than an honest id someone can paste into `slopweaver slack`.
 */
import { EMPTY_ORG_CHART } from "../../corpus/members/orgChartIndex.js";
import { slackPeopleFor } from "../../corpus/members/slackPeople.js";
import { readAllMembers } from "../../corpus/members/store.js";
import type { TodoStep } from "../../outbound/assistant/todoBlock.js";
import { PERSON_TAG_SOURCE } from "./taskLabel.js";

/**
 * A person tag, in either form a card carries it — see `PERSON_TAG_SOURCE`. A group's `@(S…)` is not a person
 * and is left alone.
 */
const PERSON_TAG = new RegExp(PERSON_TAG_SOURCE, "g");

/** The id one {@link PERSON_TAG} match carries, whichever of its two capture groups matched. */
function tagId({ normalised, bare }: { normalised: string | undefined; bare: string | undefined }): string {
  if (normalised !== undefined) {
    return normalised;
  }
  return bare!;
}

/** Slack user id → the name a card shows for them. Absent means nobody could name that id. */
export type CardNames = Readonly<Record<string, string>>;

/**
 * Every person id the text tags, in order of first appearance.
 *
 * @param text a card field — the task label, a step title or a detail
 * @returns the ids, duplicates dropped; empty when the text tags nobody
 */
export function personTagIds({ text }: { text: string }): readonly string[] {
  return [...new Set([...text.matchAll(PERSON_TAG)].map(([, normalised, bare]) => tagId({ bare, normalised })))];
}

/**
 * The text with every person tag a name is known for read as `@Name`.
 *
 * Byte-identical to its input when nothing in it resolves, which keeps every card that tags nobody exactly as
 * it was.
 *
 * @param text a card field
 * @param names who each id is
 * @returns the text, named
 */
export function namedTags({ text, names }: { text: string; names: CardNames }): string {
  return text.replace(PERSON_TAG, (tag: string, normalised: string | undefined, bare: string | undefined) => {
    const name = names[tagId({ bare, normalised })];
    if (name === undefined) {
      return tag;
    }
    return `@${name}`;
  });
}

/**
 * Every person id one frame of the card carries — the task label, every step title, every detail, every child
 * line. A child is where a live step's finding and a loop phase's updates ride, so a tag there unscanned would
 * reach the thread as a raw id.
 *
 * @param steps the frame's checklist
 * @param task the bracketed task label
 * @returns the ids, first appearance first
 */
export function frameTagIds({ steps, task }: { steps: readonly TodoStep[]; task: string }): readonly string[] {
  const texts = [task, ...steps.flatMap((step) => stepTexts({ step }))];
  return [...new Set(texts.flatMap((text) => personTagIds({ text })))];
}

/**
 * Every text one step renders — its title, its detail and each child — in display order.
 *
 * @param step the step
 * @returns the texts it carries
 */
function stepTexts({ step }: { step: TodoStep }): readonly string[] {
  const texts = [step.title];
  if (step.detail !== undefined) {
    texts.push(step.detail);
  }
  if (step.children !== undefined) {
    texts.push(...step.children);
  }
  return texts;
}

/**
 * One frame of the card with every person it tags named.
 *
 * @param steps the frame's checklist
 * @param task the bracketed task label
 * @param names who each id is
 * @returns the same frame, named
 */
export function namedFrame({ steps, task, names }: { steps: readonly TodoStep[]; task: string; names: CardNames }): {
  readonly steps: readonly TodoStep[];
  readonly task: string;
} {
  return {
    steps: steps.map((step) => ({
      ...step,
      title: namedTags({ names, text: step.title }),
      ...(step.detail === undefined ? {} : { detail: namedTags({ names, text: step.detail }) }),
      ...(step.children === undefined
        ? {}
        : { children: step.children.map((child) => namedTags({ names, text: child })) }),
    })),
    task: namedTags({ names, text: task }),
  };
}

/**
 * The name member bronze holds for a person — their display name, else their handle, else nothing.
 *
 * @param person one resolved member
 * @returns the name to show, or `undefined` when the member carries neither
 */
function shownName({
  person,
}: {
  person: { name: string | undefined; handle: string | undefined };
}): string | undefined {
  if (person.name !== undefined && person.name.length > 0) {
    return person.name;
  }
  if (person.handle !== undefined && person.handle.length > 0) {
    return person.handle;
  }
  return undefined;
}

/**
 * The live name lookup one poster renders with: member bronze read at most ONCE, on the first frame that
 * tags anybody, and every answer cached for the frames after it.
 *
 * Lazy because the overwhelmingly common frame tags nobody past the stripped address, and a card tick is no
 * place to pay for a roster read that frame never needed. Cached because a card is advanced many times over
 * one turn and the question it quotes does not change between ticks.
 *
 * @param home the state home holding member bronze
 * @returns the lookup — ids in, the names it could find out
 */
export function cardNameLookup({ home }: { home: string }): (args: { ids: readonly string[] }) => CardNames {
  const known = new Map<string, string | undefined>();
  let rows: ReturnType<typeof readAllMembers>["rows"] = [];
  let rowsRead = false;
  return ({ ids }) => {
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length > 0) {
      if (!rowsRead) {
        rows = readAllMembers({ home }).rows;
        rowsRead = true;
      }
      missing.forEach((id) => known.set(id, undefined));
      // A card label is a name only, so nothing is joined off the org chart.
      slackPeopleFor({ ids: missing, orgChart: EMPTY_ORG_CHART, rows }).forEach((person) => {
        known.set(person.nativeId, shownName({ person }));
      });
    }
    const names: Record<string, string> = {};
    ids.forEach((id) => {
      const name = known.get(id);
      if (name !== undefined) {
        names[id] = name;
      }
    });
    return names;
  };
}
