/**
 * `slopweaver talk knowledge` — what the fleet has already learned about a question, for the console voice.
 *
 * The voice's `knowledge` tool runs this. It is `knowledge recall` over the same store, with one difference
 * that is the reason it exists: it prints ONE JSON document, projected and bounded by `src/talk/knowledge.ts`,
 * because the console's tool route parses a verb's whole stdout and `knowledge recall --json` prints JSONL.
 * An unreachable store is a non-zero exit carrying the reason, exactly as there, never an empty answer.
 */
import { recallMemories } from "../../../knowledge/memoryStore.js";
import type { RecallPage, RecallQuery } from "../../../knowledge/recall.js";
import { parseRecallQuery } from "../../../knowledge/recall.js";
import { logger } from "../../../lib/logger.js";
import { withTimeout } from "../../../lib/resilience.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { connectStore } from "../../../store/client.js";
import { knowledgeForVoice } from "../../../talk/knowledge.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseKnowledgeArgs } from "./knowArgs.js";
import { TALK_KNOWLEDGE_USAGE } from "./knowUsage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "knowledge", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * How long the connect and the recall may take together. The console kills a tool at 20 s with no reason
 * given, and a local store that accepts the socket but never answers the handshake waits out postgres-js's
 * own 30 s connect timeout, so this verb gives up first and SAYS why.
 */
const KNOWLEDGE_DEADLINE_MS = 12_000;

/**
 * Open the store, recall one page and close it, as one task a deadline can race.
 *
 * @param query the parsed recall query
 * @returns the page, or the store's own reason it could not answer
 */
async function recallFromStore({ query }: { query: RecallQuery }): Promise<Result<RecallPage>> {
  const opened = await connectStore();
  if (opened.isErr()) return err([opened.error.message]);
  const client = opened.value;
  try {
    const page = await recallMemories({ client, query });
    if (page.isErr()) return err([page.error.message]);
    return ok(page.value);
  } finally {
    await client.close();
  }
}

/**
 * Run the `talk knowledge` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTalkKnowledge(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_KNOWLEDGE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseKnowledgeArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_KNOWLEDGE_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const query = parseRecallQuery({ value: { limit: args.limit, offset: 0, query: args.query } });
  if (query.isErr()) {
    logger.error({ msg: `talk knowledge: ${query.error.message}` });
    return EXIT_USAGE;
  }
  const page = await recallLocally({ query: query.value });
  if (page === undefined) {
    return EXIT_ERROR;
  }
  if (page.isErr()) {
    page.error.forEach((message) => {
      logger.error({ msg: `talk knowledge: ${message}` });
    });
    return EXIT_ERROR;
  }
  const answer = knowledgeForVoice({
    hasMore: page.value.hasMore,
    hits: page.value.hits,
    maxBytes: args.maxBytes,
    query: args.query,
  });
  if (args.json) {
    logger.out({ line: JSON.stringify(answer) });
    return EXIT_OK;
  }
  logger.out({ line: `talk knowledge: ${String(answer.claims.length)} claim(s) for "${answer.query}"` });
  answer.claims.forEach((claim) => {
    logger.out({ line: `  [${claim.verdict}] ${claim.claim}` });
  });
  return EXIT_OK;
}

/**
 * Recall from the LOCAL store inside the voice's deadline, saying why on stderr when it cannot.
 *
 * @returns the store's answer, or `undefined` once the refusal is printed
 */
async function recallLocally({ query }: { query: RecallQuery }): Promise<Result<RecallPage> | undefined> {
  // The voice's tools read this machine and nothing else: the store is selected through `storeUrl`, which refuses
  // a remote host with no hatch, so a read carrying the owner's query cannot reach out.
  try {
    return await withTimeout({ task: () => recallFromStore({ query }), timeoutMs: KNOWLEDGE_DEADLINE_MS });
  } catch {
    logger.error({
      msg: `talk knowledge: the local store did not answer within ${String(KNOWLEDGE_DEADLINE_MS / 1000)} s — check it with slopweaver store`,
    });
    return undefined;
  }
}

export const talkKnowledgeCommand = defineCommand({ run: runTalkKnowledge });
