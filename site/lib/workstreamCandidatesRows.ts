/**
 * Narrowing one row of the candidates document at a time: a field, an option, a person to loop in, a steer, the
 * definition picked. Each refuses rather than repairs. Split out of `./workstreamCandidates.ts`, which reads the
 * whole document with them.
 */

import { type Bag, bags, str, strings, sub } from "./bag";
import {
  type CandidateEvidenceView,
  type CandidateRowView,
  type DefinitionView,
  DONE_LENSES,
  type DoneOptionView,
  LOOP_IN_STATES,
  type LoopInPersonView,
  type PickedOptionView,
  type PriorSteerView,
} from "./workstreamCandidatesTypes";

/**
 * A string-or-null field: `null` when the verb wrote null, `undefined` when it is absent or the wrong type.
 *
 * @returns the value, `null`, or `undefined` for a field that will not read
 */
export function strOrNull({ bag, key }: { bag: Bag; key: string }): string | null | undefined {
  if (bag[key] === null) {
    return null;
  }
  return str({ bag, key });
}

/**
 * Whether a string is one member of a closed list.
 *
 * @returns the member, or `undefined`
 */
export function memberOf<T extends string>({
  list,
  value,
}: {
  list: readonly T[];
  value: string | undefined;
}): T | undefined {
  return list.find((one) => one === value);
}

/**
 * Every element of an array field read by one reader, refusing the whole field when any one will not read.
 *
 * @returns the elements, or `undefined`
 */
export function every<T>({
  bag,
  key,
  read,
}: {
  bag: Bag;
  key: string;
  read: (row: Bag) => T | undefined;
}): T[] | undefined {
  const rows = bags({ bag, key });
  if (rows === undefined) {
    return undefined;
  }
  const out: T[] = [];
  for (const one of rows) {
    const value = read(one);
    if (value === undefined) {
      return undefined;
    }
    out.push(value);
  }
  return out;
}

/**
 * Several string-or-null fields at once, refusing the lot when any one will not read.
 *
 * @returns each field by its key, or `undefined`
 */
export function nullableStrings<K extends string>({
  bag,
  keys,
}: {
  bag: Bag;
  keys: readonly K[];
}): Record<K, string | null> | undefined {
  const out: Partial<Record<K, string | null>> = {};
  for (const key of keys) {
    const value = strOrNull({ bag, key });
    if (value === undefined) {
      return undefined;
    }
    out[key] = value;
  }
  // oxlint-disable-next-line no-unsafe-type-assertion -- the loop set every key or returned early, which the type cannot see
  return out as Record<K, string | null>;
}

/**
 * One evidence line.
 *
 * @returns the line, or `undefined`
 */
export function evidenceOf(row: Bag): CandidateEvidenceView | undefined {
  const date = str({ bag: row, key: "date" });
  const quote = str({ bag: row, key: "quote" });
  const links = nullableStrings({ bag: row, keys: ["anchor", "href"] });
  if (date === undefined || quote === undefined || links === undefined) {
    return undefined;
  }
  return { ...links, date, quote };
}

/**
 * The fields one offered option and its snapshot share: lens, words, trade-off and stretch.
 *
 * @returns the four, or `undefined`
 */
function optionBodyOf({ row }: { row: Bag }): Omit<DoneOptionView, "id"> | undefined {
  const lens = memberOf({ list: DONE_LENSES, value: str({ bag: row, key: "lens" }) });
  const text = str({ bag: row, key: "text" });
  const tradeoff = str({ bag: row, key: "tradeoff" });
  const stretch = strOrNull({ bag: row, key: "stretch" });
  if (lens === undefined || text === undefined || tradeoff === undefined || stretch === undefined) {
    return undefined;
  }
  return { lens, stretch, text, tradeoff };
}

/**
 * One offered definition of done.
 *
 * @returns the option, or `undefined`
 */
export function doneOptionOf(row: Bag): DoneOptionView | undefined {
  const id = str({ bag: row, key: "id" });
  const body = optionBodyOf({ row });
  if (id === undefined || body === undefined) {
    return undefined;
  }
  return { ...body, id };
}

/**
 * One option as a definition snapshotted it.
 *
 * @returns the option, or `undefined`
 */
function pickedOptionOf(row: Bag): PickedOptionView | undefined {
  const optionId = str({ bag: row, key: "optionId" });
  const body = optionBodyOf({ row });
  if (optionId === undefined || body === undefined) {
    return undefined;
  }
  return { ...body, optionId };
}

/**
 * One person owed a conversation, and where the draft stands.
 *
 * @returns the person, or `undefined`
 */
export function loopInOf(row: Bag): LoopInPersonView | undefined {
  const name = str({ bag: row, key: "name" });
  const slack = str({ bag: row, key: "slack" });
  const why = str({ bag: row, key: "why" });
  const opener = str({ bag: row, key: "opener" });
  const draftId = strOrNull({ bag: row, key: "draftId" });
  const draftState = memberOf({ list: LOOP_IN_STATES, value: str({ bag: row, key: "draftState" }) });
  if (
    name === undefined ||
    slack === undefined ||
    why === undefined ||
    opener === undefined ||
    draftId === undefined ||
    draftState === undefined
  ) {
    return undefined;
  }
  return { draftId, draftState, name, opener, slack, why };
}

/**
 * One earlier steer.
 *
 * @returns the steer, or `undefined`
 */
export function priorSteerOf(row: Bag): PriorSteerView | undefined {
  const anchor = str({ bag: row, key: "anchor" });
  const date = str({ bag: row, key: "date" });
  const text = str({ bag: row, key: "text" });
  if (anchor === undefined || date === undefined || text === undefined) {
    return undefined;
  }
  return { anchor, date, text };
}

/**
 * The selection of a picked definition — the verb's `DefinitionSelection`, one of three kinds.
 *
 * @returns the definition, or `undefined` when it will not read
 */
function selectionOf({ selection }: { selection: Bag }): DefinitionView | undefined {
  const kind = str({ bag: selection, key: "kind" });
  const text = str({ bag: selection, key: "text" });
  if (text === undefined) {
    return undefined;
  }
  if (kind === "words") {
    const stretch = strOrNull({ bag: selection, key: "stretch" });
    return stretch === undefined ? undefined : { kind, stretch, text };
  }
  if (kind === "all") {
    const first = strOrNull({ bag: selection, key: "first" });
    const options = every({ bag: selection, key: "options", read: pickedOptionOf });
    if (first === undefined || options === undefined) {
      return undefined;
    }
    return { first, kind, options, text };
  }
  const optionId = str({ bag: selection, key: "optionId" });
  const body = optionBodyOf({ row: selection });
  if (kind !== "option" || optionId === undefined || body === undefined) {
    return undefined;
  }
  return { ...body, kind, optionId };
}

/**
 * What was picked as done, or `null` when nothing is — the verb's `{ iso, selection }`.
 *
 * @returns the definition, `null`, or `undefined` when it will not read
 */
export function definitionOf({ row }: { row: Bag }): DefinitionView | null | undefined {
  if (row["definition"] === null) {
    return null;
  }
  const definition = sub({ bag: row, key: "definition" });
  const selection = definition === undefined ? undefined : sub({ bag: definition, key: "selection" });
  if (selection === undefined) {
    return undefined;
  }
  return selectionOf({ selection });
}

/**
 * A nullable object field read by one reader: `null` when the verb wrote null.
 *
 * @returns the value, `null`, or `undefined` when it will not read
 */
export function nullableOf<T>({
  bag,
  key,
  read,
}: {
  bag: Bag;
  key: string;
  read: (row: Bag) => T | undefined;
}): T | null | undefined {
  if (bag[key] === null) {
    return null;
  }
  const inner = sub({ bag, key });
  return inner === undefined ? undefined : read(inner);
}

/**
 * What looks stalled.
 *
 * @returns the stall, or `undefined`
 */
export function stallOf(row: Bag): { readonly since: string; readonly what: string } | undefined {
  const since = str({ bag: row, key: "since" });
  const what = str({ bag: row, key: "what" });
  return since === undefined || what === undefined ? undefined : { since, what };
}

/**
 * The team the mine says owns a candidate.
 *
 * @returns the team, or `undefined`
 */
export function owningTeamOf(row: Bag): { readonly name: string; readonly why: string } | undefined {
  const name = str({ bag: row, key: "name" });
  const why = str({ bag: row, key: "why" });
  return name === undefined || why === undefined ? undefined : { name, why };
}

/**
 * Who the owner says the first conversation is with.
 *
 * @returns the answer, or `undefined`
 */
export function whoFirstOf(row: Bag): CandidateRowView["whoFirst"] | undefined {
  const people = strings({ bag: row, key: "people" });
  const team = strOrNull({ bag: row, key: "team" });
  return people === undefined || team === undefined ? undefined : { people, team };
}
