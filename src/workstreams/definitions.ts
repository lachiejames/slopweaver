/**
 * What a person says DONE means for a mined workstream: one of the options the miner offered, or their own words,
 * kept in `definitions.jsonl` beside the reactions ledger and carried onto the workstream once they accept it.
 *
 * The page reveals to the person what they want by putting the right options in front of them to react to. So
 * a pick is durable context a later session reads: the workstream's definition of done and its `outcome` become the
 * definition and a dated note records it, with the option's trade-off, the day it was picked.
 *
 * Its own ledger rather than a reactions row, because the reactions fold is "the latest row per candidate is the owner's
 * word", and a definition is not a word. A row SNAPSHOTS the option's text and trade-off: a re-mine may reword the
 * option, and what was picked must not move with it.
 *
 * Pure. `./definitionStore.ts` is the effectful half.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import { type CandidatesError, CandidatesErrors } from "./candidateErrors.js";
import { type Candidate, DONE_LENSES, type DoneOption, idSchema, REACTION_VIAS, textSchema } from "./candidates.js";
import { DONE_MILESTONE_ID } from "./store/doneMilestoneId.js";
import type { WorkstreamAggregate } from "./store/types.js";

/** One offered option, snapshotted as it read when picked. */
const pickedOptionSchema = z.strictObject({
  lens: z.enum(DONE_LENSES),
  optionId: idSchema,
  /** The rung beyond the floor, when the option offered one; absent on a row picked before stretches existed. */
  stretch: textSchema.nullable().default(null),
  text: textSchema,
  tradeoff: textSchema,
});

/**
 * What was picked: one offered option, snapshotted; the person's own words; or every option offered, with which comes
 * first. Picking "all the above" is a real answer, and which one matters most is a separate question. So `all` keeps every
 * option and `first` stays `null` until the owner says, which the page then asks. Its `text` is what the tile's outcome
 * becomes: the first option's, or every option's joined while none is first.
 */
const selectionSchema = z.discriminatedUnion("kind", [
  pickedOptionSchema.extend({ kind: z.literal("option") }),
  z.strictObject({ kind: z.literal("words"), stretch: textSchema.nullable().default(null), text: textSchema }),
  z.strictObject({
    first: idSchema.nullable(),
    kind: z.literal("all"),
    options: z.array(pickedOptionSchema).min(2),
    text: textSchema,
  }),
]);

/** One definitions.jsonl row. */
export const definitionRowSchema = z.strictObject({
  bySession: textSchema,
  candidate: idSchema,
  iso: z.iso.datetime(),
  /** The candidate's name when it was defined: what pins the id to one workstream across a re-mine. */
  name: textSchema,
  selection: selectionSchema,
  via: z.enum(REACTION_VIAS),
});

/** One definitions.jsonl row. */
export type DefinitionRow = z.infer<typeof definitionRowSchema>;

/** What was picked. */
export type DefinitionSelection = DefinitionRow["selection"];

/** The words a definition note opens with, so the latest one on a tile can be found again. */
export const DEFINITION_NOTE_PREFIX = "Definition of done:";
const NOTE_PREFIX = DEFINITION_NOTE_PREFIX;

/**
 * Fold the ledger: the latest row per candidate stands.
 *
 * @param rows every definitions.jsonl row, in file order
 * @returns each defined candidate id and its standing row
 */
export function latestDefinitions({ rows }: { rows: readonly DefinitionRow[] }): ReadonlyMap<string, DefinitionRow> {
  const standing = new Map<string, DefinitionRow>();
  for (const row of rows) {
    standing.set(row.candidate, row);
  }
  return standing;
}

/**
 * An offered option as a row keeps it: its words, lens, trade-off and stretch, fixed at the moment it was picked.
 *
 * @param option the option as the candidate offers it
 * @returns the snapshot
 */
function snapshotOf({ option }: { option: DoneOption }): z.infer<typeof pickedOptionSchema> {
  return {
    lens: option.lens,
    optionId: option.id,
    stretch: option.stretch,
    text: option.text,
    tradeoff: option.tradeoff,
  };
}

/**
 * Every option the candidate offers, snapshotted, with which comes first — `first` must be one of them.
 *
 * @param first the option id the owner named first, or `undefined` while they have not said
 * @returns the all-of-the-above selection, or the refusal
 */
function allOf({
  candidate,
  first,
}: {
  candidate: Candidate;
  first: string | undefined;
}): Result<DefinitionSelection, CandidatesError> {
  if (candidate.doneOptions.length === 0) {
    return err(
      CandidatesErrors.definitionRefused({
        problems: [`${candidate.id} offers no definitions of done — give --text <their words>`],
      }),
    );
  }
  const options = candidate.doneOptions.map((option) => snapshotOf({ option }));
  if (first === undefined) {
    return ok({ first: null, kind: "all", options, text: options.map((one) => one.text).join("; ") });
  }
  const lead = options.find((one) => one.optionId === first);
  if (lead === undefined) {
    const offered = options.map((one) => one.optionId).join(", ");
    return err(
      CandidatesErrors.definitionRefused({
        problems: [`--first ${first} is not one of ${candidate.id}'s: ${offered}`],
      }),
    );
  }
  return ok({ first, kind: "all", options, text: lead.text });
}

/**
 * Resolve what a call picked against the candidate: exactly one of an offered option's id, the person's own words, or
 * all of the options (with `--first` naming which leads), an option snapshotted with its text, lens and trade-off.
 *
 * @param optionId what `--option` named, when given
 * @param words the `--text` value, when given
 * @param all whether `--all` was given
 * @param first the `--first` value, which goes only with `--all`
 * @param stretch the `--stretch` value — the rung beyond their words — which goes only with `--text`
 * @returns the selection, or the refusal naming what was wrong
 */
export function resolveSelection({
  candidate,
  optionId,
  words,
  all,
  first,
  stretch,
}: {
  candidate: Candidate;
  optionId: string | undefined;
  words: string | undefined;
  all: boolean;
  first: string | undefined;
  stretch: string | undefined;
}): Result<DefinitionSelection, CandidatesError> {
  if (stretch !== undefined && words === undefined) {
    return err(
      CandidatesErrors.definitionRefused({
        problems: ["--stretch goes with --text: an offered option carries its own stretch"],
      }),
    );
  }
  const given = [optionId !== undefined, words !== undefined, all].filter(Boolean).length;
  if (given !== 1) {
    return err(
      CandidatesErrors.definitionRefused({
        problems: ["give exactly one of --option <id>, --text <their words> or --all [--first <id>]"],
      }),
    );
  }
  if (first !== undefined && !all) {
    return err(CandidatesErrors.definitionRefused({ problems: ["--first goes with --all: which of them leads"] }));
  }
  if (all) {
    return allOf({ candidate, first });
  }
  if (words !== undefined) {
    return ownWords({ stretch, words });
  }
  return offeredOption({ candidate, optionId });
}

/**
 * The person's own definition, with the rung beyond it when they gave one.
 *
 * @param words the `--text` value
 * @param stretch the `--stretch` value, when given
 * @returns the selection, or the refusal for empty words
 */
function ownWords({
  words,
  stretch,
}: {
  words: string;
  stretch: string | undefined;
}): Result<DefinitionSelection, CandidatesError> {
  const text = words.trim();
  if (text.length === 0) {
    return err(CandidatesErrors.definitionRefused({ problems: ["--text is empty: say what done means"] }));
  }
  const beyond = stretch === undefined ? "" : stretch.trim();
  return ok({ kind: "words", stretch: beyond.length === 0 ? null : beyond, text });
}

/**
 * One option the candidate offers, snapshotted as it reads now.
 *
 * @param optionId what `--option` named
 * @returns the selection, or the refusal naming what the candidate does offer
 */
function offeredOption({
  candidate,
  optionId,
}: {
  candidate: Candidate;
  optionId: string | undefined;
}): Result<DefinitionSelection, CandidatesError> {
  const option = candidate.doneOptions.find((one) => one.id === optionId);
  if (option === undefined) {
    const offered = candidate.doneOptions.map((one) => one.id).join(", ");
    const problem =
      offered.length === 0
        ? `${candidate.id} offers no definitions of done — give --text <their words>`
        : `${candidate.id} offers no option ${String(optionId)}; it offers ${offered}`;
    return err(CandidatesErrors.definitionRefused({ problems: [problem] }));
  }
  return ok({ ...snapshotOf({ option }), kind: "option" });
}

/**
 * Whether two selections say the same thing, so an exact retry appends nothing.
 *
 * @returns true when they are the same pick
 */
export function sameSelection({ a, b }: { a: DefinitionSelection; b: DefinitionSelection }): boolean {
  if (a.kind === "words" || b.kind === "words") {
    return a.kind === "words" && b.kind === "words" && a.text === b.text && a.stretch === b.stretch;
  }
  if (a.kind === "all" || b.kind === "all") {
    if (a.kind !== "all" || b.kind !== "all" || a.first !== b.first || a.options.length !== b.options.length) {
      return false;
    }
    return a.options.every((one, at) => {
      const other = b.options[at]!;
      return sameSelection({ a: { ...one, kind: "option" }, b: { ...other, kind: "option" } });
    });
  }
  const sameWords = a.text === b.text && a.tradeoff === b.tradeoff && a.stretch === b.stretch;
  return a.optionId === b.optionId && a.lens === b.lens && sameWords;
}

/** The note a definition writes on its workstream, before it takes an entry id and a position. */
export interface DefinitionNote {
  /** `YYYY-MM-DD`, the day it was picked. */
  readonly date: string;
  readonly kind: "note";
  readonly text: string;
}

/**
 * The dated note a definition writes on its workstream: the definition, and for an offered option what choosing it
 * costs.
 *
 * @param row the standing definition
 * @returns the note, dated the day it was picked, with no link (the ledger row is its source)
 */
export function definitionNote({ row }: { row: DefinitionRow }): DefinitionNote {
  const { selection } = row;
  let text = `${NOTE_PREFIX} "${selection.text}", in their own words`;
  if (selection.kind === "option") {
    text = `${NOTE_PREFIX} "${selection.text}", picked from the options; the trade-off: ${selection.tradeoff}`;
  } else if (selection.kind === "all" && selection.first === null) {
    text = `${NOTE_PREFIX} all of the options offered, which comes first not yet said: "${selection.text}"`;
  } else if (selection.kind === "all") {
    const rest = selection.options.filter((one) => one.optionId !== selection.first).map((one) => `"${one.text}"`);
    text = `${NOTE_PREFIX} "${selection.text}" first, of all the options offered; the rest: ${rest.join("; ")}`;
  }
  if (selection.kind !== "all" && selection.stretch !== null) {
    text = `${text}; the stretch beyond it: "${selection.stretch}"`;
  }
  return { date: row.iso.slice(0, 10), kind: "note", text };
}

/**
 * Whether a workstream already carries a definition: its definition of done (the `done` milestone) is named it, its
 * outcome is it, and the latest definition note among its entries, by position, is this one. Judged on the workstream
 * rather than the ledger, so a ledger row whose register write failed is seen as owed and a retry repairs it with one
 * note — the same test `redefineDone` (`./store/doneMilestone.ts`) makes before it appends anything.
 *
 * @returns true when the workstream says exactly this definition
 */
export function definitionApplied({ aggregate, row }: { aggregate: WorkstreamAggregate; row: DefinitionRow }): boolean {
  const name = row.selection.text;
  const done = aggregate.milestones.find((one) => one.id === DONE_MILESTONE_ID);
  const latest = aggregate.entries
    .filter((entry) => entry.kind === "note" && entry.text.startsWith(NOTE_PREFIX))
    .toSorted((a, b) => a.position - b.position)
    .at(-1);
  const noted = latest?.text === definitionNote({ row }).text;
  return done?.name === name && aggregate.outcome === name && noted;
}
