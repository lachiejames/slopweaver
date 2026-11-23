/**
 * `slopweaver talk capabilities` — what the console voice can do and what it cannot, one noun at a time.
 *
 * The voice's delegated model runs this through its `verb` tool before telling them it cannot do something: every
 * verb of a noun, whether the voice can run it, can run part of it, or only a seat can, and why. Derived from the
 * catalog, the voice's read list and its tools (`src/talk/voiceReach.ts`), so it cannot fall behind any of them.
 * Without a noun it prints how much of each noun the voice reaches; a noun or verb that does not exist is said so,
 * with the real ones, rather than an empty list the model could read as "nothing".
 */
import { logger } from "../../../lib/logger.js";
import { shippedVoiceReach } from "../../../talk/shippedReach.js";
import { type NounReach, nounReachDocument, refusalLines, renderNounReach } from "../../../talk/voiceReach.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { canonicalNoun } from "../../nounAliases.js";
import { parseCapabilitiesArgs } from "./capabilitiesArgs.js";
import { TALK_CAPABILITIES_USAGE } from "./knowUsage.js";
import { talkPositionalArgsErrorLines } from "./positionalArgsErrors.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "capabilities", ...]`. */
const VERB_ARG_OFFSET = 4;

/** What the model is told to do with what it read. */
const NOTE =
  "can: run it. partly: run the part named. cannot: only a seat runs it — say so in one line and relay their ask. " +
  "Never guess a verb name that is not listed here.";

/**
 * Run the `talk capabilities` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkCapabilities(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_CAPABILITIES_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCapabilitiesArgs({ rest });
  if (parsed.isErr()) {
    talkPositionalArgsErrorLines({ error: parsed.error }).forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_CAPABILITIES_USAGE });
    return EXIT_USAGE;
  }
  const { noun, verb, json } = parsed.value;
  capabilitiesAnswer({ json, noun, reach: shippedVoiceReach(), verb }).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

/** Every noun with how many of its verbs the voice reaches. */
function everyNounAnswer({ reach, json }: { reach: readonly NounReach[]; json: boolean }): readonly string[] {
  const nouns = reach.map((entry) => ({
    noun: entry.noun,
    reached: entry.verbs.filter((one) => one.state !== "cannot").length,
    verbs: entry.verbs.length,
  }));
  if (json) {
    return [JSON.stringify({ note: NOTE, nouns })];
  }
  return [
    `talk capabilities: ${NOTE}`,
    ...nouns.map((entry) => `  ${entry.noun}: ${String(entry.reached)} of ${String(entry.verbs)}`),
  ];
}

/** One noun's whole answer, grouped by reason. */
function nounAnswer({ found, json }: { found: NounReach; json: boolean }): readonly string[] {
  if (json) {
    return [JSON.stringify({ ...nounReachDocument({ noun: found }), exists: true, note: NOTE })];
  }
  return [`talk capabilities: ${NOTE}`, ...renderNounReach({ noun: found })];
}

/**
 * What `talk capabilities` prints for a noun and verb — every noun, one noun, one verb, or why one does not exist.
 *
 * @param reach the derived inventory
 * @param noun the noun asked about, if any
 * @param verb the verb of that noun asked about, if any
 * @param json whether to answer as one JSON document
 * @returns the lines to print
 */
function capabilitiesAnswer({
  reach,
  noun,
  verb,
  json,
}: {
  reach: readonly NounReach[];
  noun: string | undefined;
  verb: string | undefined;
  json: boolean;
}): readonly string[] {
  if (noun === undefined) {
    return everyNounAnswer({ json, reach });
  }
  const found = reach.find((entry) => entry.noun === canonicalNoun({ noun }));
  const row = found?.verbs.find((entry) => entry.verb === verb);
  if (found === undefined || (verb !== undefined && row === undefined)) {
    // The verb is only read once the noun is found, so a bare unknown noun passes its own name for it.
    let asked = noun;
    if (verb !== undefined) {
      asked = verb;
    }
    const lines = refusalLines({ noun, reach, verb: asked });
    return json ? [JSON.stringify({ exists: false, lines, note: NOTE })] : lines;
  }
  if (row === undefined) {
    return nounAnswer({ found, json });
  }
  if (json) {
    return [JSON.stringify({ ...row, exists: true, note: NOTE })];
  }
  return [`${row.noun} ${row.verb} [${row.state}] ${row.summary}`, `  ${row.how}`];
}

export const talkCapabilitiesCommand = defineCommand({ run: runTalkCapabilities });
