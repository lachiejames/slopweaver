/**
 * The `sidebar:` block `tick open` prints second: the `automation freshness` reading of every provider, worst first,
 * with the owner's own numbers — what the console sidebar's strip drew. Without this block the strip said Notion was failing
 * twelve hours before the chair did, because the tick never captured `automation freshness --json`. The other act-first blocks, and why the
 * order is what it is, are `./digestActFirst.ts`. A reading that did not complete prints UNKNOWN with why. Pure.
 */
import { z } from "zod";

import { renderAge } from "#lib/duration.js";

import type { CorpusSource } from "../corpus/types.js";

import {
  arrayField,
  capped,
  cappedInline,
  type DigestInputs,
  jsonOf,
  listOf,
  named,
  numberField,
  shortened,
  stringField,
} from "./digestRead.js";

/**
 * Where each state this block raises sorts, worst first. `current` and `unverified` are absent: a quiet source
 * reads `unverified` by construction, so this block does not raise on it.
 */
const STATE_RANK: Readonly<Record<string, number>> = {
  blocked: 1,
  failing: 0,
  late: 6,
  "never-synced": 3,
  paused: 5,
  unreadable: 2,
  unscheduled: 4,
};

/** Every `CorpusSource`, as a record so the compiler fails here when the union gains or loses one. */
const CORPUS_SOURCES: Readonly<Record<CorpusSource, true>> = {
  calendar: true,
  chatgpt: true,
  fathom: true,
  github: true,
  gmail: true,
  gold: true,
  linear: true,
  notion: true,
  outlook: true,
  "outlook-calendar": true,
  self: true,
  slack: true,
};

/**
 * The fields of `SourceFreshnessRow` (`../briefing/sourceFreshness.ts`) a sidebar line reads, so a row carrying
 * them in another shape, or lacks one the report always writes, is raised as unreadable rather than counted as
 * quiet. `state` is absent on purpose: a missing or unknown one is already raised, by
 * {@link raisedRank}.
 */
const sourceRowSchema = z.object({
  // The report clamps this age at zero, so a negative or non-finite one (which `z.number()`
  // already refuses) is no reading of it.
  behindMs: z.number().nonnegative().nullable(),
  label: z.string().min(1),
  // An empty problem names nothing, so a row carrying one is no reading of a problem list.
  problems: z.array(z.string().min(1)),
  // The report types `source` as a `CorpusSource`, so a name outside that set is no reading of one.
  source: z.string().refine((source) => Object.hasOwn(CORPUS_SOURCES, source)),
});

/**
 * Whether a source row carries the fields a sidebar line reads, each in the report's own shape.
 *
 * @returns whether the row reads
 */
function rowReadable({ row }: { row: unknown }): boolean {
  return sourceRowSchema.safeParse(row).success;
}

/**
 * What the freshness report calls a source: its display label, and its provider id when the report carries no label.
 *
 * @returns the name
 */
function sourceName({ row }: { row: unknown }): string {
  const label = stringField({ key: "label", value: row });
  if (label !== undefined) {
    return label;
  }
  return named({ key: "source", value: row });
}

/**
 * One source as the freshness report reads it: its label, its state (in capitals unless merely late), and how long since
 * its last verified sync — `behindMs`, which is that age and not the provider's own lag.
 *
 * @returns the clause
 */
function sourceClause({ row, repeated }: { row: unknown; repeated: ReadonlySet<string> }): string {
  const label = sourceName({ row });
  if (!rowReadable({ row })) {
    return `${label} UNKNOWN, its row will not read as a freshness row`;
  }
  if (repeated.has(named({ key: "source", value: row }))) {
    return `${label} UNKNOWN, the report carries more than one row for it`;
  }
  const state = named({ key: "state", value: row });
  if (knownRank({ state }) === undefined) {
    return `${label} UNKNOWN, in a state this build cannot judge: ${state}`;
  }
  const behind = numberField({ key: "behindMs", value: row });
  const age =
    behind === undefined ? "no verified sync age" : `${renderAge({ ms: behind })} since its last verified sync`;
  const problems = arrayField({ key: "problems", value: row }).filter((one): one is string => typeof one === "string");
  const why = state === "failing" && problems.length > 0 ? ` (${shortened({ text: problems[0]! })})` : "";
  return `${label} ${state === "late" ? state : state.toUpperCase()}, ${age}${why}`;
}

/** The two states this block does not raise. Counted apart in the head line: `unverified` is NOT `current`. */
const QUIET_STATES = ["current", "unverified"] as const;

/** Where a state this build does not know sorts: raised, after every known one, never dropped. */
const UNKNOWN_STATE_RANK = 7;

/**
 * Where a source's state sorts among the ones this block raises. A missing or unknown state is raised, last,
 * because dropping it would let the head line read "nothing raised" over a source nobody could judge.
 *
 * @returns the rank, or undefined for a quiet state
 */
function raisedRank({ row, repeated }: { row: unknown; repeated: ReadonlySet<string> }): number | undefined {
  if (!rowReadable({ row }) || repeated.has(named({ key: "source", value: row }))) {
    return UNKNOWN_STATE_RANK;
  }
  const state = stringField({ key: "state", value: row });
  if (QUIET_STATES.some((quiet) => quiet === state)) {
    return undefined;
  }
  const rank = knownRank({ state });
  if (rank === undefined) {
    return UNKNOWN_STATE_RANK;
  }
  return rank;
}

/**
 * A raised state's rank, read as an OWN key so a state named like an object property is not mistaken for one.
 *
 * @returns the rank, or undefined for a state this build does not raise by name
 */
function knownRank({ state }: { state: string | undefined }): number | undefined {
  if (state === undefined || !Object.hasOwn(STATE_RANK, state)) {
    return undefined;
  }
  return STATE_RANK[state];
}

/**
 * How many sources sit in one quiet state, counting none the report carries twice.
 *
 * @returns the count
 */
function quietCount({ sources, state }: { sources: readonly unknown[]; state: string }): number {
  const repeated = repeatedSources({ sources });
  return sources.filter(
    (row) =>
      rowReadable({ row }) &&
      !repeated.has(named({ key: "source", value: row })) &&
      stringField({ key: "state", value: row }) === state,
  ).length;
}

/**
 * Every source more than one row names. The report writes one row per provider, so two rows for one source
 * cannot both be the report's reading of it, and neither is.
 *
 * @returns the repeated source ids
 */
function repeatedSources({ sources }: { sources: readonly unknown[] }): ReadonlySet<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const row of sources) {
    const source = named({ key: "source", value: row });
    if (seen.has(source)) {
      repeated.add(source);
    }
    seen.add(source);
  }
  return repeated;
}

/**
 * One line per roster-wide issue the report carries. The report types each as a string, so an entry that is not
 * one, or is empty, prints UNKNOWN rather than being serialised as though it were an issue.
 *
 * @returns the lines
 */
function issueLines({ value }: { value: unknown }): readonly string[] {
  const issueList = listOf({ key: "issues", value });
  if (issueList === undefined) {
    return ["sidebar issue: UNKNOWN — the freshness report carries no issues list"];
  }
  return issueList.map((one) =>
    typeof one === "string" && one.length > 0
      ? `sidebar issue: ${one}`
      : "sidebar issue: UNKNOWN — the freshness report carries an issue that is not text",
  );
}

/**
 * The freshness report's own numbers: every source it raises, worst first and in the report's order within a state, then
 * each roster-wide issue the report carries.
 *
 * @returns the lines
 */
export function sidebarLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const read = jsonOf({ inputs, name: "freshness" });
  if ("line" in read) {
    return [`sidebar: UNKNOWN — ${read.line}`];
  }
  const sources = arrayField({ key: "sources", value: read.value });
  if (sources.length === 0) {
    return ["sidebar: UNKNOWN — the freshness report named no source"];
  }
  const repeated = repeatedSources({ sources });
  const raised = sources
    .map((row) => ({ rank: raisedRank({ repeated, row }), row }))
    .filter((one): one is { rank: number; row: unknown } => one.rank !== undefined)
    .toSorted((left, right) => left.rank - right.rank);
  const issues = issueLines({ value: read.value });
  const current = quietCount({ sources, state: "current" });
  const unverified = quietCount({ sources, state: "unverified" });
  const head =
    raised.length === 0
      ? `sidebar: nothing raised — ${String(current)} current, ${String(unverified)} unverified`
      : `sidebar: ${cappedInline({ items: raised.map(({ row }) => sourceClause({ repeated, row })) })}`;
  return [head, ...capped({ lines: issues, prefix: "sidebar issue" })];
}
