/**
 * `slopweaver talk glossary` — the fleet's own words, each in one plain sentence, for the console voice.
 *
 * The voice's `glossary` tool runs this when you use a word it does not know ("what the hell is a JumpCloud
 * atlas"). The list is `src/talk/glossary.ts`; this only looks a word up in it, and says plainly when it is
 * not there rather than returning an empty list the model could read as "that is not a thing".
 */
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { botSelfHandlesFromProfile } from "../../../profileStore.js";
import { glossaryMatches, installGlossary } from "../../../talk/glossary.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseGlossaryArgs } from "./knowArgs.js";
import { TALK_GLOSSARY_USAGE } from "./knowUsage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "glossary", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Run the `talk glossary` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkGlossary(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_GLOSSARY_USAGE });
    return EXIT_OK;
  }
  const parsed = parseGlossaryArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_GLOSSARY_USAGE });
    return EXIT_USAGE;
  }
  const { term, json } = parsed.value;
  const glossary = installGlossary({
    botHandles: botSelfHandlesFromProfile({ home: slopweaverHome(), reader: "talk glossary" }),
  });
  let entries = glossary;
  let note = "Every fleet word the glossary holds.";
  if (term !== undefined) {
    entries = glossaryMatches({ entries: glossary, query: term });
    note = "The glossary entries the words name, most specific first. Say the sentence as it is written.";
    if (entries.length === 0) {
      note = `The glossary has no entry for "${term}". Try knowledge, then code_find, before saying you do not know.`;
    }
  }
  if (json) {
    logger.out({ line: JSON.stringify({ entries, note, term }) });
    return EXIT_OK;
  }
  logger.out({ line: `talk glossary: ${note}` });
  entries.forEach((entry) => {
    logger.out({ line: `  ${entry.term} — ${entry.means}` });
  });
  return EXIT_OK;
}

export const talkGlossaryCommand = defineCommand({ run: runTalkGlossary });
