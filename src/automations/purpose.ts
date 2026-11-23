/**
 * What one automation is FOR, in plain words: the name the Automations page titles its card with, the one line
 * saying what it does for the owner, and — where a field this repository already measures backs it — what goes missing
 * while it is broken and what still stands in its place. Pure.
 *
 * A count of three failed only reads as bad if those three matter, so each one says what it is for — and never by
 * an identifier the owner cannot read whole.
 *
 * **Derived from the row's kind and argv, never its recipe id.** A recipe id is per-install state; the kind, the
 * verb it runs and the corpus source or atlas it syncs are this build's own vocabulary. A row whose params name
 * nothing more specific takes its kind's own sentence, which every registered kind must declare.
 *
 * **Every `whenBroken` and `meanwhile` sentence is a claim, so each one names what backs it.** A sentence here that
 * a reader could act on wrongly is worse than none: the bot's freshness gates (`retrieval/justInTime.ts`) have no
 * production caller, so nothing below says the bot is protected from a stale history. What IS true is narrower and
 * is said exactly — a Linear search verifies each issue it cites live (`cli/commands/linear/queryRun.ts`), a ticket
 * missing from the history is never found and so never checked.
 */
import { findAtlasPlatform } from "../atlas/registry.js";
import type { CorpusSource } from "../corpus/types.js";
import type { RecipeDefinition } from "../live/automation/definition.js";
import type { RegisteredRecipeKind } from "../live/automation/kinds.js";
import { ATLAS_NAMES, KIND_PURPOSES, VERB_PURPOSES } from "./purposeNames.js";
import { corpusSourceOf } from "./rowAsks.js";

/** What one automation is for. */
export interface AutomationPurpose {
  /** The plain name a card is titled with. */
  readonly name: string;
  /** One line: what it does for the owner. */
  readonly forWhat: string;
  /** What goes missing while it is broken, when a measured field backs a sentence more specific than "it stops". */
  readonly whenBroken: string | null;
  /** What still stands in its place while it is broken, only where code makes that true. */
  readonly meanwhile: string | null;
}

/**
 * Each corpus source's purpose. A total record over {@link CorpusSource}, so a new source fails to compile until it
 * says what it is for. Who reads each one is measured in `../corpus/freshnessPolicy.ts`.
 */
export const CORPUS_PURPOSES: Readonly<Record<CorpusSource, AutomationPurpose>> = {
  calendar: {
    forWhat: "Keeps a local copy of your calendar in the history the bot searches.",
    meanwhile: "Every calendar verb reads Google Calendar live, not this copy.",
    name: "Calendar history sync",
    whenBroken: "Meetings added since it last ran are missing from the searchable history.",
  },
  chatgpt: {
    forWhat: "Brings your ChatGPT conversations, from the export you download, into the history you search.",
    meanwhile: "A named chat can still be read live with `chatgpt conversation`, and `chatgpt list` lists the account.",
    name: "ChatGPT history sync",
    whenBroken: "Conversations since the last export it read are missing from the searchable history.",
  },
  fathom: {
    forWhat: "Brings recorded Fathom calls into the history the bot searches.",
    meanwhile: null,
    name: "Fathom call sync",
    whenBroken: "Calls recorded since it last ran are missing from the searchable history.",
  },
  github: {
    forWhat: "Keeps a local copy of pull requests, issues and reviews, which the bot searches for what happened.",
    meanwhile: null,
    name: "GitHub history sync",
    whenBroken: "Pull requests, reviews and comments since it last ran are missing from the history the bot searches.",
  },
  gmail: {
    forWhat: "Keeps a local copy of your mailbox in the history the bot searches.",
    meanwhile: "Session start reads your mailbox live, not this copy.",
    name: "Gmail history sync",
    whenBroken: "Mail since it last ran is missing from the searchable history.",
  },
  gold: {
    forWhat: "Keeps the distilled notes the bot reads first.",
    meanwhile: null,
    name: "Distilled notes",
    whenBroken: null,
  },
  linear: {
    forWhat:
      "Keeps a local copy of Linear issues, comments and projects, which the bot searches for what was decided and who owns what.",
    meanwhile:
      "A Linear search still checks each issue it cites against live Linear, but an issue missing from the history is never found, so never checked.",
    name: "Linear history sync",
    whenBroken: "Issues and comments since it last ran are missing from the history the bot searches.",
  },
  notion: {
    forWhat: "Keeps a local copy of Notion pages, which only the bot's history search reads.",
    meanwhile: null,
    name: "Notion history sync",
    whenBroken: "Pages edited since it last ran are missing from the history search.",
  },
  "outlook-calendar": {
    forWhat: "Keeps a local copy of your Outlook calendar in the history the bot searches.",
    meanwhile: "Every outlook-calendar verb reads Outlook live, not this copy.",
    name: "Outlook calendar history sync",
    whenBroken: "Meetings added or changed since it last ran are missing from the searchable history.",
  },
  self: {
    forWhat: "Keeps your own notes in the history the bot searches.",
    meanwhile: null,
    name: "Your notes",
    whenBroken: null,
  },
  slack: {
    forWhat: "Keeps a local copy of Slack channels and threads, which the bot searches for what was said and decided.",
    meanwhile: null,
    name: "Slack history sync",
    whenBroken: "Messages since it last ran are missing from the history the bot searches.",
  },
};

/** Each corpus source this module can place, as a guard over the record's own keys. */
function isCorpusSource(source: string): source is CorpusSource {
  return Object.hasOwn(CORPUS_PURPOSES, source);
}

/** The row's argv, when it carries a string-only one. */
function argvOf({ definition }: { definition: RecipeDefinition }): readonly string[] | null {
  const argv = definition.params["argv"];
  if (Array.isArray(argv) && argv.every((part): part is string => typeof part === "string")) {
    return argv;
  }
  return null;
}

/**
 * The atlas platform a resync row brings current, read off its own `--atlas` flag — never the recipe id.
 *
 * @param definition the row
 * @returns the platform, or `null` for anything that is not an atlas resync
 */
export function atlasPlatformOf({ definition }: { definition: RecipeDefinition }): string | null {
  const argv = argvOf({ definition });
  if (argv === null || !argv.includes("resync")) {
    return null;
  }
  const at = argv.indexOf("--atlas");
  const platform = argv[at + 1];
  if (at < 0 || platform === undefined) {
    return null;
  }
  return platform;
}

/** A descriptor question up to its first comma or dash — the lead clause; the rest is its field list. */
function firstClause({ text }: { text: string }): string {
  const end = text.search(/,\s| — /);
  if (end < 0) {
    return text;
  }
  return text.slice(0, end);
}

/** An atlas resync's purpose, from its descriptor's own question. */
function atlasPurpose({
  platform,
  atlasQuestions,
}: {
  platform: string;
  atlasQuestions: ReadonlyMap<string, string>;
}): AutomationPurpose | null {
  const name = ATLAS_NAMES[platform];
  const question = atlasQuestions.get(platform);
  if (name === undefined || question === undefined || findAtlasPlatform({ platform }) === null) {
    return null;
  }
  return {
    forWhat: `Keeps the ${name} atlas current, so the bot can answer ${firstClause({ text: question })}.`,
    meanwhile: null,
    name: `${name} atlas refresh`,
    whenBroken: `Answers about ${name} come from the copy it published at its last good refresh.`,
  };
}

/**
 * A verb run's purpose, from the verb it runs — and a verb this build has no sentence for still says which verb, so
 * the line names the command rather than a generic "scheduled command".
 */
function verbPurpose({ argv }: { argv: readonly string[] }): AutomationPurpose {
  const path = argv.slice(0, 2).join(" ");
  const known = VERB_PURPOSES[path];
  if (known === undefined) {
    return {
      forWhat: `Runs \`slopweaver ${path}\` on a schedule.`,
      meanwhile: null,
      name: KIND_PURPOSES["verb-run"].name,
      whenBroken: null,
    };
  }
  return { ...known, meanwhile: null };
}

/** The first sentence of an investigation's question — its purpose in its own words. */
function firstSentence({ text }: { text: string }): string {
  const end = text.search(/[.?!](\s|$)/);
  if (end < 0) {
    return text;
  }
  return text.slice(0, end + 1);
}

/** Whether a kind name is one this build registers — a guard over the purpose registry's own keys. */
function isRegisteredKind(kind: string): kind is RegisteredRecipeKind {
  return Object.hasOwn(KIND_PURPOSES, kind);
}

/** The most specific purpose a row's own params name — its corpus source, atlas or verb — when they name one. */
function specificPurpose({
  definition,
  atlasQuestions,
}: {
  definition: RecipeDefinition;
  atlasQuestions: ReadonlyMap<string, string>;
}): AutomationPurpose | null {
  const source = corpusSourceOf({ definition });
  if (source !== null && isCorpusSource(source)) {
    return CORPUS_PURPOSES[source];
  }
  const platform = atlasPlatformOf({ definition });
  if (platform !== null) {
    return atlasPurpose({ atlasQuestions, platform });
  }
  const argv = argvOf({ definition });
  if (definition.kind === "verb-run" && argv !== null) {
    return verbPurpose({ argv });
  }
  return null;
}

/**
 * What one automation is for, in plain words: the most specific purpose its params name, else its investigation's
 * own question, else its kind's sentence ({@link KIND_PURPOSES}) — so every registered kind says what it is.
 *
 * @param definition the row
 * @param atlasQuestions each atlas descriptor's `question`, by platform, as `./read.ts` loaded them
 * @returns its purpose, or `null` only for a kind this build does not register, which the definition parser refuses
 */
export function purposeOf({
  definition,
  atlasQuestions,
}: {
  definition: RecipeDefinition;
  atlasQuestions: ReadonlyMap<string, string>;
}): AutomationPurpose | null {
  const specific = specificPurpose({ atlasQuestions, definition });
  if (specific !== null) {
    return specific;
  }
  if (!isRegisteredKind(definition.kind)) {
    return null;
  }
  const kindPurpose = KIND_PURPOSES[definition.kind];
  const question = definition.params["question"];
  if (typeof question === "string" && question.length > 0) {
    return { forWhat: firstSentence({ text: question }), meanwhile: null, name: kindPurpose.name, whenBroken: null };
  }
  return { ...kindPurpose, meanwhile: null };
}
