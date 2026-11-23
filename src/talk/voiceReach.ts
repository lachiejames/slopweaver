/**
 * What the console voice can do and what it cannot, DERIVED — never hand-listed — from three inputs: the verb
 * catalog (`discoverCommands({ groups: NOUN_GROUPS })`), the voice's closed read list (`./modelReads.ts`) and its
 * tools (`./talkToolSchemas.ts`). Pure: the caller passes all three, so a fixture can stand in for any of them.
 *
 * The voice must know what it can do and what it cannot, so the owner never has to ask "can't you just do this". Asked
 * to read a whole Slack DM, a delegated model without that knowledge guesses `slack history` (no such verb) and then
 * `slack read-thread` (a real verb, off the read list) through the `verb` tool, learns each by refusal, and tells the
 * owner it could not. Both prompts listed the tools and the `verb` tool's description listed the reads,
 * but nothing said which verbs EXIST that the voice may not run, why, or what to do instead.
 *
 * Disclosed in three steps so the prompt stays short: {@link reachPromptBlock} names, per noun, the verbs the voice
 * reaches; `slopweaver talk capabilities <noun>` ({@link renderNounReach}) gives every verb of one noun with its
 * reason; and a refused `verb` call answers from the same derivation ({@link refusalLines}) instead of guessing why.
 *
 * ## Why "cannot" is worded from the catalog's `effect`, and only so far
 *
 * The one-door rule (AGENTS.md rule 3) puts every provider write behind a slopweaver verb a seat runs, and the
 * voice's one writer past this machine is `relay_steer` (`draft_edit` and `draft_restore` write only the local
 * parked-draft register). So a verb the voice cannot run is always routed the same way: relay the owner's ask.
 * The REASON is read off `CommandMeta.effect`, which is coarse — one meta is shared by a noun's verbs, and
 * `./modelReads.ts` says why it cannot decide the list — so a verb on the list wins over its effect, and an
 * off-list verb that neither writes out nor writes home is called untraced, never dangerous.
 */
import type { DoorEffect } from "../admit/types.js";
import { canonicalNoun } from "../cli/nounAliases.js";
import type { ModelRead } from "./modelReads.js";
import type { TalkTool } from "./talkToolSchemas.js";

/** Whether the voice can run a verb: wholly, in part (a subverb or a stand-in tool), or not at all. */
type ReachState = "can" | "partly" | "cannot";

/** One catalog verb, as the voice reaches it. */
interface VerbReach {
  readonly noun: string;
  readonly verb: string;
  /** The catalog's one-line summary of what the verb does. */
  readonly summary: string;
  readonly state: ReachState;
  /** How the voice reaches it, or why it cannot and what to do instead. */
  readonly how: string;
  /** The words the prompt block names it by: the verb, with its subverbs or stand-in tool. Empty when it cannot. */
  readonly named: string;
}

/** One noun's verbs, and the reads under another noun that answer for it. */
export interface NounReach {
  readonly noun: string;
  readonly verbs: readonly VerbReach[];
  /** Corpus reads (`ModelRead.readsCorpus`) when this noun is an ingested source, as `noun verb`. */
  readonly corpus: readonly string[];
}

/** The fields of a catalog entry the derivation reads — a `DiscoveredCommand` is one. */
export interface CatalogVerb {
  readonly noun: string;
  readonly verb: string;
  readonly meta: { readonly summary: string; readonly effect: DoorEffect };
}

/** The `talk` noun is the console's own plumbing: its readable verbs ARE the voice's tools, listed already. */
const PLUMBING_NOUN = "talk";

/** The route every "cannot" ends on: one door, and the relay its one writer past this machine. */
const RELAY_ROUTE = "only a seat runs it: relay the ask to the supervisor";

/**
 * Why the voice cannot run a verb, from its catalog effect.
 *
 * @param effect the verb's declared door effect
 * @returns the reason and the route, in one clause
 */
function cannotBecause({ effect }: { effect: DoorEffect }): string {
  if (effect === "external-write") {
    return `it acts on a provider, and ${RELAY_ROUTE}`;
  }
  if (effect === "local-state") {
    return `it may change state under the owner's slopweaver home, so ${RELAY_ROUTE}`;
  }
  return `it is not traced onto your read list, so ${RELAY_ROUTE}`;
}

/**
 * Derive one catalog verb's reach.
 *
 * @param entry the catalog verb
 * @param reads the voice's read list
 * @param tools the voice's tools
 * @returns how the voice reaches it, or why not
 */
function verbReach({
  entry,
  reads,
  tools,
}: {
  entry: CatalogVerb;
  reads: readonly ModelRead[];
  tools: readonly TalkTool[];
}): VerbReach {
  const { noun, verb } = entry;
  const base = { noun, summary: entry.meta.summary, verb };
  const read = reads.find((row) => row.noun === noun && row.verb === verb);
  if (read?.subverbs !== undefined) {
    const only = read.subverbs.join("|");
    return { ...base, how: `the verb tool, ${only} only: ${read.for}`, named: `${verb} ${only}`, state: "partly" };
  }
  if (read !== undefined) {
    return { ...base, how: `the verb tool: ${read.for}`, named: verb, state: "can" };
  }
  const running = tools.filter((tool) => tool.runs?.noun === noun && tool.runs.verb === verb).map((tool) => tool.name);
  if (running.length > 0) {
    return { ...base, how: `the ${running.join(", ")} tool`, named: `${verb} (${running.join(", ")})`, state: "can" };
  }
  const standIns = tools.flatMap((tool) => {
    if (tool.standsInFor?.noun !== noun || tool.standsInFor.verb !== verb) {
      return [];
    }
    return [{ name: tool.name, part: tool.standsInFor.part }];
  });
  const [only] = standIns;
  if (only !== undefined) {
    let how = `the ${only.name} tool does part: ${only.part}; for the rest ${RELAY_ROUTE}`;
    if (standIns.length > 1) {
      // "The rest" names its verb: beside a channel read, a bare "the rest" read as the channel's older history.
      const parts = standIns.map((standIn) => `${standIn.name}: ${standIn.part}`).join("; ");
      how = `${parts}; for the rest of ${verb} ${RELAY_ROUTE}`;
    }
    return {
      ...base,
      how,
      named: `${verb} in part (${standIns.map((standIn) => standIn.name).join(", ")})`,
      state: "partly",
    };
  }
  return { ...base, how: cannotBecause({ effect: entry.meta.effect }), named: "", state: "cannot" };
}

/**
 * Every noun of the catalog, each verb with what the voice can do about it.
 *
 * @param catalog every registered verb, sorted by noun then verb (`discoverCommands`'s order)
 * @param reads the voice's closed read list
 * @param tools the voice's tools
 * @param corpusSources the sources the corpus holds, whose nouns its reads answer for
 * @returns one entry per noun, in catalog order
 */
export function voiceReach({
  catalog,
  reads,
  tools,
  corpusSources,
}: {
  catalog: readonly CatalogVerb[];
  reads: readonly ModelRead[];
  tools: readonly TalkTool[];
  corpusSources: readonly string[];
}): readonly NounReach[] {
  const corpusReads = reads.filter((read) => read.readsCorpus === true).map((read) => `${read.noun} ${read.verb}`);
  const nouns = new Map<string, VerbReach[]>();
  for (const entry of catalog) {
    const reached = verbReach({ entry, reads, tools });
    const bucket = nouns.get(entry.noun);
    if (bucket === undefined) {
      nouns.set(entry.noun, [reached]);
    } else {
      bucket.push(reached);
    }
  }
  return [...nouns.entries()].map(([noun, verbs]) => {
    let corpus: readonly string[] = [];
    if (corpusSources.includes(noun)) {
      corpus = corpusReads;
    }
    return { corpus, noun, verbs };
  });
}

/** Whether the voice reaches any of a noun, by a verb or through the corpus. */
function reachesAny({ noun }: { noun: NounReach }): boolean {
  return noun.corpus.length > 0 || noun.verbs.some((verb) => verb.state !== "cannot");
}

/**
 * One line per noun the voice reaches by a verb, naming each verb it can run — the short, always-present step —
 * then one line naming every source whose ingested history it reads. The sources are named once rather than
 * tagged onto each noun's line, so a new source costs the prompt its name and nothing more. The `talk` noun is left
 * out: its readable verbs are the tools both prompts already list.
 *
 * @param reach the derived inventory
 * @returns the block, one `- noun: verbs` line each, then the line naming the corpus sources and what the rest is
 */
export function reachPromptBlock({ reach }: { reach: readonly NounReach[] }): string {
  const lines: string[] = [];
  const sources: string[] = [];
  let seatOnly = 0;
  let total = 0;
  for (const noun of reach) {
    total += noun.verbs.length;
    seatOnly += noun.verbs.filter((verb) => verb.state === "cannot").length;
    if (noun.noun === PLUMBING_NOUN || !reachesAny({ noun })) {
      continue;
    }
    if (noun.corpus.length > 0) {
      sources.push(noun.noun);
    }
    const named = noun.verbs.filter((verb) => verb.state !== "cannot").map((verb) => verb.named);
    if (named.length > 0) {
      lines.push(`- ${noun.noun}: ${named.join(", ")}`);
    }
  }
  let corpus = "";
  if (sources.length > 0) {
    corpus = `The corpus (store query, hours behind) holds the history of ${sources.join(", ")}. `;
  }
  lines.push(
    `${corpus}The other ${String(seatOnly)} of the ${String(total)} verbs only a seat runs. ` +
      "Run talk capabilities <noun> for a noun's verbs and why before saying you cannot; never guess a verb name.",
  );
  return lines.join("\n");
}

/**
 * The voice's own sentence: the nouns it reads, and what it does with the rest.
 *
 * @param reach the derived inventory
 * @returns two sentences
 */
export function reachVoiceSentence({ reach }: { reach: readonly NounReach[] }): string {
  const nouns = reach
    .filter((noun) => noun.noun !== PLUMBING_NOUN && reachesAny({ noun }))
    .map((noun) => noun.noun)
    .join(", ");
  return (
    `Through the thinking model you also read ${nouns}. For the rest, never say you can't before the thinking ` +
    "model has checked; if only a seat can, say so in one line and relay it."
  );
}

/** The most characters of a catalog summary one noun's answer carries. */
const SUMMARY_MAX_CHARS = 140;

/** One noun's answer to `talk capabilities <noun>`: what the voice reaches, then the rest grouped by reason. */
export interface NounReachDocument {
  readonly noun: string;
  readonly reach: readonly { readonly verb: string; readonly state: ReachState; readonly how: string }[];
  readonly corpus: string | null;
  readonly seatOnly: readonly { readonly why: string; readonly verbs: readonly string[] }[];
}

/**
 * One noun's answer, bounded: every verb the voice reaches with how, then every verb only a seat runs, grouped
 * under its reason with a clipped summary each. Grouped because the reason repeats across a noun's verbs, and the
 * console cuts a `verb` answer at 20 KiB (`./verbOutput.ts`) — one reason per verb put the atlas noun past it.
 *
 * @param noun the noun's reach
 * @returns the document
 */
export function nounReachDocument({ noun }: { noun: NounReach }): NounReachDocument {
  const reach = noun.verbs
    .filter((verb) => verb.state !== "cannot")
    .map((verb) => ({ how: verb.how, state: verb.state, verb: verb.verb }));
  const groups = new Map<string, string[]>();
  for (const verb of noun.verbs.filter((one) => one.state === "cannot")) {
    const line = `${verb.verb}: ${clippedTo({ line: verb.summary, max: SUMMARY_MAX_CHARS })}`;
    const group = groups.get(verb.how);
    if (group === undefined) {
      groups.set(verb.how, [line]);
    } else {
      group.push(line);
    }
  }
  let corpus: string | null = null;
  if (noun.corpus.length > 0) {
    corpus = corpusPhrase({ noun });
  }
  return { corpus, noun: noun.noun, reach, seatOnly: [...groups.entries()].map(([why, verbs]) => ({ verbs, why })) };
}

/**
 * One noun's answer as text — what `talk capabilities <noun>` prints without `--json`.
 *
 * @param noun the noun's reach
 * @returns the lines, the noun's count first
 */
export function renderNounReach({ noun }: { noun: NounReach }): readonly string[] {
  const document = nounReachDocument({ noun });
  const lines = [`${noun.noun}: you reach ${String(document.reach.length)} of its ${String(noun.verbs.length)} verbs`];
  for (const verb of document.reach) {
    lines.push(`  ${verb.verb} [${verb.state}] ${verb.how}`);
  }
  if (document.corpus !== null) {
    lines.push(`  and ${document.corpus}`);
  }
  for (const group of document.seatOnly) {
    lines.push(`  only a seat — ${group.why}:`, ...group.verbs.map((verb) => `    ${verb}`));
  }
  return lines;
}

/** How a source noun's ingested history is read: the corpus reads, scoped to it. */
function corpusPhrase({ noun }: { noun: NounReach }): string {
  return `its ingested history, hours behind, by ${noun.corpus.join(", ")} (source ${noun.noun})`;
}

/** The most characters one refusal line carries; the console funds six lines of 1500 characters, newest first. */
const REFUSAL_LINE_MAX_CHARS = 240;

/** One line cut to `max` characters, an ellipsis marking the cut. */
function clippedTo({ line, max }: { line: string; max: number }): string {
  if (line.length <= max) {
    return line;
  }
  return `${line.slice(0, max - 1)}…`;
}

/** One line cut to {@link REFUSAL_LINE_MAX_CHARS}. */
function clipped({ line }: { line: string }): string {
  return clippedTo({ line, max: REFUSAL_LINE_MAX_CHARS });
}

/** What the voice CAN use for a noun, as one line, or a line saying it reaches none of it. */
function canInsteadLine({ noun }: { noun: NounReach }): string {
  const named = noun.verbs.filter((verb) => verb.state !== "cannot").map((verb) => `${noun.noun} ${verb.named}`);
  if (noun.corpus.length > 0) {
    named.push(corpusPhrase({ noun }));
  }
  if (named.length === 0) {
    return `You reach nothing of ${noun.noun}: ${RELAY_ROUTE}.`;
  }
  return `What you can use instead: ${named.join("; ")}.`;
}

/**
 * Why a `verb` request the read list refused will not run, answered from the inventory — whether the verb exists,
 * what it does, and what the voice can use instead, the route LAST because the console keeps the newest lines.
 *
 * @param reach the derived inventory
 * @param noun the noun the model asked for
 * @param verb the verb the model asked for
 * @returns at most four lines, none over {@link REFUSAL_LINE_MAX_CHARS} characters
 */
export function refusalLines({
  reach,
  noun,
  verb,
}: {
  reach: readonly NounReach[];
  noun: string;
  verb: string;
}): readonly string[] {
  const found = reach.find((entry) => entry.noun === canonicalNoun({ noun }));
  if (found === undefined) {
    const nouns = reach
      .filter((entry) => entry.noun !== PLUMBING_NOUN && reachesAny({ noun: entry }))
      .map((entry) => entry.noun);
    return [`${noun} is not a slopweaver noun.`, `Nouns you can read: ${nouns.join(", ")}.`].map((line) =>
      clipped({ line }),
    );
  }
  const row = found.verbs.find((entry) => entry.verb === verb);
  if (row === undefined) {
    return [
      `${noun} ${verb} does not exist.`,
      `${noun} has: ${found.verbs.map((entry) => entry.verb).join(", ")}.`,
      canInsteadLine({ noun: found }),
    ].map((line) => clipped({ line }));
  }
  let why = `You cannot run it: ${row.how}.`;
  if (row.state === "partly") {
    why = `Only in part: ${row.how}.`;
  } else if (row.state === "can") {
    why = `Not through the verb tool: use ${row.how}.`;
  }
  return [`${noun} ${verb}: ${row.summary}`, why, canInsteadLine({ noun: found })].map((line) => clipped({ line }));
}
