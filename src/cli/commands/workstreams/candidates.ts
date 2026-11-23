/**
 * `slopweaver workstreams candidates` — the candidates (their stated outcomes, then the mined ones), their latest word on
 * each, and what the seat owes.
 *
 * Reads local files and nothing else: the mined candidates, the reactions, definitions, titles, proposals and who-first
 * ledgers, the register (absent on a fresh install, until the first accepted candidate starts it) and the Slack draft
 * register, for where each owed
 * conversation stands. `--json` prints ONE document, the shape the console reads: the candidates are a bounded
 * document (about a hundred rows), not a growing ledger, exactly as `list` argues for the register.
 */
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { readSlackDraftLines } from "../../../admit/slackDraftStore.js";
import { foldSlackDraftLog, parseSlackDraftLog } from "../../../outbound/slack/draftLog.js";
import {
  candidatesOnly,
  fitListing,
  listingName,
  type RulingFilter,
  rulingWords,
} from "../../../workstreams/candidateRulings.js";
import {
  readCandidateCatalog,
  readDefinitionRows,
  readProposalRows,
  readReactionRows,
  readTitleRows,
  readWhoFirstRows,
} from "../../../workstreams/candidateStore.js";
import { REACTIONS } from "../../../workstreams/candidates.js";
import {
  type CandidatesDocument,
  type CandidateView,
  candidatesDocument,
} from "../../../workstreams/candidatesDocument.js";
import type { WorkstreamStore } from "../../../workstreams/store/port.js";
import { productionWorkstreamRegister } from "../../../workstreams/store/register.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";

import { parseWorkstreamsCandidatesArgs, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import { WORKSTREAMS_CANDIDATES_USAGE } from "./usage.js";

/** Everything `workstreams candidates` touches outside itself, injected so a test drives the whole verb. */
export interface WorkstreamsCandidatesDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** The store-backed register the document joins. */
  readonly store: WorkstreamStore;
}

/**
 * One line a reader scans for a candidate: its number and id, their word, and either the evidence's span (unruled) or
 * the day they ruled and their words as heard (ruled).
 *
 * @returns the line
 */
function lineOf({ one }: { one: CandidateView }): string {
  let word = "unanswered";
  let detail = `(${one.first} to ${one.last}, ${String(one.evidenceCount)} messages)`;
  const ruling = rulingWords({ one });
  if (one.reaction !== null && ruling !== undefined) {
    word = one.reaction;
    detail = `— ruled ${ruling}`;
  }
  let held = "";
  if (one.registerId !== null) {
    held = `  on the register as ${one.registerId}`;
  }
  let name = one.name;
  if (one.title !== null) {
    name = `${one.title} (proposed as "${one.name}")`;
  }
  // The retitled form is cut as one name, so a title cannot push the ruling past the line's budget.
  return `${String(one.n).padStart(3)}  ${one.id}  ${word.padEnd(10)}  ${listingName({ name })}  ${detail}${held}`;
}

/**
 * The side of the ruled line `--unruled` or `--ruled` asks for, refusing both at once.
 *
 * @returns the filter, `undefined` for the whole set, or the usage refusal
 */
function filterOf({ values }: { values: Readonly<Record<string, unknown>> }): Result<RulingFilter | undefined, string> {
  const unruled = values["unruled"] === true;
  const ruled = values["ruled"] === true;
  if (unruled && ruled) {
    return err("--unruled and --ruled each keep one half — give one");
  }
  if (unruled) {
    return ok("unruled");
  }
  if (ruled) {
    return ok("ruled");
  }
  return ok(undefined);
}

/**
 * Every file the document joins, read and joined; the first that will not read stops it. `onboard workstreams` reads
 * the same document, so the two verbs can never disagree about what was mined. Nothing mined or stated yet is still a
 * document, with no candidates in it.
 *
 * The register is read from the store; an empty one is a fresh install before its first accepted candidate, and a
 * store that will not answer is a refusal, never drawn as empty.
 *
 * @param store the store-backed register
 * @returns the document, or the exit code and the line saying why not
 */
export async function documentAt({
  home,
  store,
}: {
  home: string;
  store: WorkstreamStore;
}): Promise<Result<CandidatesDocument, { exit: number; line: string }>> {
  const catalog = readCandidateCatalog({ home });
  if (catalog.isErr()) {
    return err({ exit: EXIT_ERROR, line: catalog.error.message });
  }
  const register = await store.read({ home });
  if (register.isErr()) {
    return err({ exit: EXIT_ERROR, line: `${register.error.code}: ${register.error.message}` });
  }
  const rows = readReactionRows({ home });
  if (rows.isErr()) {
    return err({ exit: EXIT_ERROR, line: rows.error.message });
  }
  const definitions = readDefinitionRows({ home });
  if (definitions.isErr()) {
    return err({ exit: EXIT_ERROR, line: definitions.error.message });
  }
  const titles = readTitleRows({ home });
  if (titles.isErr()) {
    return err({ exit: EXIT_ERROR, line: titles.error.message });
  }
  const proposals = readProposalRows({ home });
  if (proposals.isErr()) {
    return err({ exit: EXIT_ERROR, line: proposals.error.message });
  }
  const whoFirst = readWhoFirstRows({ home });
  if (whoFirst.isErr()) {
    return err({ exit: EXIT_ERROR, line: whoFirst.error.message });
  }
  const drafts = foldSlackDraftLog({ log: parseSlackDraftLog({ lines: readSlackDraftLines({ home }) }) });
  return ok(
    candidatesDocument({
      catalog: catalog.value,
      definitions: definitions.value,
      drafts,
      proposals: proposals.value,
      register: register.value,
      rows: rows.value,
      titles: titles.value,
      whoFirst: whoFirst.value,
    }),
  );
}

/**
 * Run `workstreams candidates` against injected seams.
 *
 * @param rest the argv tail after `workstreams candidates`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runWorkstreamsCandidates({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: WorkstreamsCandidatesDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(WORKSTREAMS_CANDIDATES_USAGE);
    return EXIT_OK;
  }
  const parsed = parseWorkstreamsCandidatesArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(WORKSTREAMS_CANDIDATES_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const filter = filterOf({ values });
  if (filter.isErr()) {
    deps.writeDiagnostic(`workstreams candidates: ${filter.error}`);
    deps.writeDiagnostic(WORKSTREAMS_CANDIDATES_USAGE);
    return EXIT_USAGE;
  }
  const whole = await documentAt({
    home: resolveHome({ named: stringFlag({ name: "home", values }) }),
    store: deps.store,
  });
  if (whole.isErr()) {
    deps.writeDiagnostic(`workstreams candidates: ${whole.error.line}`);
    return whole.error.exit;
  }
  let document = whole.value;
  if (filter.value !== undefined) {
    document = candidatesOnly({ document, filter: filter.value });
  }
  if (values["json"] === true) {
    deps.writeOut(JSON.stringify(document));
    return EXIT_OK;
  }
  printCandidates({ document, filter: filter.value, writeOut: deps.writeOut });
  return EXIT_OK;
}

/**
 * One line per candidate, then the counts, then what the seat owes. A filtered listing is the voice's read, so it is
 * fitted to one verb answer and says how many it left out rather than being cut mid-list.
 */
function printCandidates({
  document,
  filter,
  writeOut,
}: {
  document: CandidatesDocument;
  filter: RulingFilter | undefined;
  writeOut: (line: string) => void;
}): void {
  const lines = document.candidates.map((one) => lineOf({ one }));
  if (filter === undefined) {
    lines.forEach((line) => {
      writeOut(line);
    });
  } else {
    const fitted = fitListing({ lines });
    fitted.kept.forEach((line) => {
      writeOut(line);
    });
    if (fitted.left > 0 && filter === "unruled") {
      writeOut(`… ${String(fitted.left)} more unruled not shown: each one the owner rules on leaves this list`);
    } else if (fitted.left > 0) {
      writeOut(`… ${String(fitted.left)} older ruling(s) not shown`);
    }
  }
  const { counts } = document;
  const words = REACTIONS.map((word) => `${String(counts[word])} ${word}`);
  // The counts describe the whole set even when a filter kept one half, so the total is theirs, not the lines.
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  writeOut(`${String(total)} candidates: ${words.join(", ")}, ${String(counts.unanswered)} unanswered`);
  writeOut(
    `the seat owes: ${String(document.promotionOwed.length)} promotion(s), ${String(document.definitionOwed.length)} definition(s), ${String(document.placementOwed.length)} placement(s), ${String(document.storyOwed.length)} story(ies), ${String(document.retractions.length)} retraction(s); the next mine owes ${String(document.proposalOwed.length)} proposal(s)`,
  );
}

/**
 * The real seams: the two output channels and the store.
 *
 * @returns the production dependencies for {@link runWorkstreamsCandidates}
 */
export function productionWorkstreamsCandidatesDeps(): WorkstreamsCandidatesDeps {
  return {
    store: productionWorkstreamRegister(),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver workstreams candidates`. */
export const workstreamsCandidatesCommand = defineCommand({
  run: (argv) =>
    runWorkstreamsCandidates({ deps: productionWorkstreamsCandidatesDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
