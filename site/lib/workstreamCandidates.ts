/**
 * Reading `slopweaver workstreams candidates --json` into the Proposed workstreams section on the Workstreams page.
 *
 * The verb joins the candidates — the owner's stated outcomes, built in, then any mined ones — the latest word on
 * each, the definitions of done picked, the titles, who-first answers, proposals, loop-in drafts and the register
 * (`candidatesDocument`, `src/workstreams/candidatesDocument.ts`); this file only narrows that document, because the
 * site cannot import `src/`. It REFUSES rather than repairs, the way `./workstreamTiles.ts` does: a candidate missing
 * a field, or carrying a word outside the owner's own, makes the whole
 * document `undefined`, which the page shows as not measured — never a row with a blank where a fact was, and never a
 * button selected on a word the verb did not write.
 */
import { type Bag, isBag, num, str, strings, sub } from "./bag";
import {
  definitionOf,
  doneOptionOf,
  every,
  evidenceOf,
  loopInOf,
  memberOf,
  nullableOf,
  nullableStrings,
  owningTeamOf,
  priorSteerOf,
  stallOf,
  strOrNull,
  whoFirstOf,
} from "./workstreamCandidatesRows";
import {
  CANDIDATE_REACTIONS,
  type CandidateReaction,
  type CandidateRowView,
  type CandidatesView,
  type MinedView,
  PROPOSAL_RELATIONS,
  type ProposalView,
  type RegisterEntryView,
} from "./workstreamCandidatesTypes";

/**
 * The enrichment a candidate carries beyond its head: options, stall, people, steers, teams and the definition.
 *
 * @returns the fields, or `undefined` when any will not read
 */
function enrichmentOf({
  row,
}: {
  row: Bag;
}):
  | Pick<
      CandidateRowView,
      "definition" | "doneOptions" | "loopIn" | "owningTeam" | "priorSteers" | "stalled" | "whoFirst"
    >
  | undefined {
  const doneOptions = every({ bag: row, key: "doneOptions", read: doneOptionOf });
  const loopIn = every({ bag: row, key: "loopIn", read: loopInOf });
  const priorSteers = every({ bag: row, key: "priorSteers", read: priorSteerOf });
  const stalled = nullableOf({ bag: row, key: "stalled", read: stallOf });
  const owningTeam = nullableOf({ bag: row, key: "owningTeam", read: owningTeamOf });
  const whoFirst = nullableOf({ bag: row, key: "whoFirst", read: whoFirstOf });
  const definition = definitionOf({ row });
  if (
    doneOptions === undefined ||
    loopIn === undefined ||
    priorSteers === undefined ||
    stalled === undefined ||
    owningTeam === undefined ||
    whoFirst === undefined ||
    definition === undefined
  ) {
    return undefined;
  }
  return { definition, doneOptions, loopIn, owningTeam, priorSteers, stalled, whoFirst };
}

/** The string-or-null fields a candidate row carries, read all at once. */
const NULLABLE_ROW_KEYS = [
  "coveredBy",
  "heard",
  "milestoneOf",
  "outcomeOf",
  "owner",
  "proposal",
  "reactedIso",
  "reason",
  "registerId",
  "sameAs",
  "steer",
  "supersededBy",
  "title",
] as const;

/**
 * The owner's standing word, refusing one outside their own.
 *
 * @returns the word, `null` while unanswered, or `undefined`
 */
function reactionOf({ row }: { row: Bag }): CandidateReaction | null | undefined {
  const raw = strOrNull({ bag: row, key: "reaction" });
  if (raw === null || raw === undefined) {
    return raw;
  }
  return memberOf({ list: CANDIDATE_REACTIONS, value: raw });
}

/**
 * One candidate.
 *
 * @returns the row, or `undefined` when any field will not read
 */
function candidateOf(row: Bag): CandidateRowView | undefined {
  const enrichment = enrichmentOf({ row });
  const nullable = nullableStrings({ bag: row, keys: NULLABLE_ROW_KEYS });
  const reaction = reactionOf({ row });
  const evidence = every({ bag: row, key: "evidence", read: evidenceOf });
  const id = str({ bag: row, key: "id" });
  const n = num({ bag: row, key: "n" });
  const name = str({ bag: row, key: "name" });
  const outcome = str({ bag: row, key: "outcome" });
  const theme = str({ bag: row, key: "theme" });
  const first = str({ bag: row, key: "first" });
  const last = str({ bag: row, key: "last" });
  const evidenceCount = num({ bag: row, key: "evidenceCount" });
  const people = strings({ bag: row, key: "people" });
  if (
    enrichment === undefined ||
    nullable === undefined ||
    reaction === undefined ||
    evidence === undefined ||
    id === undefined ||
    n === undefined ||
    name === undefined ||
    outcome === undefined ||
    theme === undefined ||
    first === undefined ||
    last === undefined ||
    evidenceCount === undefined ||
    people === undefined
  ) {
    return undefined;
  }
  return {
    ...enrichment,
    ...nullable,
    evidence,
    evidenceCount,
    first,
    id,
    last,
    n,
    name,
    outcome,
    people,
    reaction,
    theme,
  };
}

/**
 * One mined source and how many records the mine read there.
 *
 * @returns the source, or `undefined`
 */
function minedSourceOf(row: Bag): MinedView["minedSources"][number] | undefined {
  const source = str({ bag: row, key: "source" });
  const recordsRead = num({ bag: row, key: "recordsRead" });
  if (source === undefined || recordsRead === undefined) {
    return undefined;
  }
  return { recordsRead, source };
}

/**
 * One register entry.
 *
 * @returns the entry, or `undefined`
 */
function registerEntryOf(row: Bag): RegisterEntryView | undefined {
  const id = str({ bag: row, key: "id" });
  const name = str({ bag: row, key: "name" });
  const kind = str({ bag: row, key: "kind" });
  return id === undefined || name === undefined || kind === undefined ? undefined : { id, kind, name };
}

/**
 * One proposal of the owner's.
 *
 * @returns the proposal, or `undefined`
 */
function proposalOf(row: Bag): ProposalView | undefined {
  const id = str({ bag: row, key: "id" });
  const title = str({ bag: row, key: "title" });
  const relation = memberOf({ list: PROPOSAL_RELATIONS, value: str({ bag: row, key: "relation" }) });
  const nullable = nullableStrings({ bag: row, keys: ["from", "minedAs", "why"] });
  if (id === undefined || title === undefined || relation === undefined || nullable === undefined) {
    return undefined;
  }
  return { ...nullable, id, relation, title };
}

/**
 * Read the counts block: every one of the owner's words and `unanswered`, each a number.
 *
 * @returns the counts, or `undefined` when any is missing
 */
function countsOf({ bag }: { bag: Bag }): CandidatesView["counts"] | undefined {
  const out: Partial<Record<CandidateReaction | "unanswered", number>> = {};
  for (const key of [...CANDIDATE_REACTIONS, "unanswered"] as const) {
    const count = num({ bag, key });
    if (count === undefined) {
      return undefined;
    }
    out[key] = count;
  }
  // oxlint-disable-next-line no-unsafe-type-assertion -- the loop set every key or returned early, which the type cannot see
  return out as CandidatesView["counts"];
}

/** The top-level lists of ids the document names. */
const OWED_KEYS = [
  "definitionOwed",
  "placementOwed",
  "promotionOwed",
  "proposalOwed",
  "retractions",
  "storyOwed",
] as const;

/**
 * Every owed-id list at once, refusing the lot when any one will not read.
 *
 * @returns each list by its key, or `undefined`
 */
function owedOf({ bag }: { bag: Bag }): Record<(typeof OWED_KEYS)[number], readonly string[]> | undefined {
  const out: Partial<Record<(typeof OWED_KEYS)[number], readonly string[]>> = {};
  for (const key of OWED_KEYS) {
    const list = strings({ bag, key });
    if (list === undefined) {
      return undefined;
    }
    out[key] = list;
  }
  // oxlint-disable-next-line no-unsafe-type-assertion -- the loop set every key or returned early, which the type cannot see
  return out as Record<(typeof OWED_KEYS)[number], readonly string[]>;
}

/**
 * Read the verb's document into the section's view.
 *
 * @param payload the parsed `workstreams candidates --json` document
 * @returns the view, or `undefined` when the document will not read as one
 */
export function readWorkstreamCandidates({ payload }: { payload: unknown }): CandidatesView | undefined {
  if (!isBag(payload) || num({ bag: payload, key: "schemaVersion" }) !== 1) {
    return undefined;
  }
  const mined = minedOf({ bag: payload });
  const rawCounts = sub({ bag: payload, key: "counts" });
  const counts = rawCounts === undefined ? undefined : countsOf({ bag: rawCounts });
  const candidates = every({ bag: payload, key: "candidates", read: candidateOf });
  const register = every({ bag: payload, key: "register", read: registerEntryOf });
  const proposals = every({ bag: payload, key: "proposals", read: proposalOf });
  const owed = owedOf({ bag: payload });
  const registerExists = payload["registerExists"];
  if (
    mined === undefined ||
    counts === undefined ||
    candidates === undefined ||
    register === undefined ||
    proposals === undefined ||
    owed === undefined ||
    typeof registerExists !== "boolean"
  ) {
    return undefined;
  }
  return { ...owed, candidates, counts, mined: mined.value, proposals, register, registerExists };
}

/**
 * The document's `mined` provenance: an explicit `null` before any mine, else when, from what and each source.
 *
 * @returns the provenance boxed so a `null` reads apart from a field that will not read, or `undefined`
 */
function minedOf({ bag }: { bag: Bag }): { readonly value: MinedView | null } | undefined {
  if (bag["mined"] === null) {
    return { value: null };
  }
  const mined = sub({ bag, key: "mined" });
  if (mined === undefined) {
    return undefined;
  }
  const minedIso = str({ bag: mined, key: "minedIso" });
  const minedFrom = str({ bag: mined, key: "minedFrom" });
  const minedSources = every({ bag: mined, key: "minedSources", read: minedSourceOf });
  if (minedIso === undefined || minedFrom === undefined || minedSources === undefined) {
    return undefined;
  }
  return { value: { minedFrom, minedIso, minedSources } };
}
