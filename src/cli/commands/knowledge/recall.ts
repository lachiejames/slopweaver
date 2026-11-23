/**
 * `slopweaver knowledge recall` — think back. Full-text search over the memories table, read early in a
 * task rather than after it has gone wrong.
 *
 * Recall runs early: a task about a system starts by searching the memories table for that system's name
 * and reading every row that comes up, not after the work has gone wrong.
 *
 * The connection is opened here and closed in a `finally`, so the pure modules under `src/knowledge/` never
 * hold one. An unreachable store is a non-zero exit carrying the reason, never an empty page — the two
 * lead to opposite next actions and a session cannot tell them apart from an empty list.
 */
import { recallMemories } from "../../../knowledge/memoryStore.js";
import { parseRecallQuery, renderRecall } from "../../../knowledge/recall.js";
import { logger } from "../../../lib/logger.js";
import { connectStore } from "../../../store/client.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { RECALL_USAGE, VERB_ARG_OFFSET } from "./core.js";
import { parseKnowledgeRecallArgs } from "./flagSpecs.js";

/** A flag's value, or undefined when it was not supplied. */
function flag({ values, name }: { values: Readonly<Record<string, unknown>>; name: string }): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/** A numeric flag's value, or undefined — left for the schema to refuse rather than coerced silently. */
function numericFlag({
  values,
  name,
}: {
  values: Readonly<Record<string, unknown>>;
  name: string;
}): number | undefined {
  const raw = flag({ name, values });
  return raw === undefined ? undefined : Number(raw);
}

/**
 * Run `knowledge recall`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runKnowledgeRecall(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: RECALL_USAGE });
    return EXIT_OK;
  }
  const parsed = parseKnowledgeRecallArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: RECALL_USAGE });
    return EXIT_USAGE;
  }
  const { values, positionals } = parsed.value;
  const query = parseRecallQuery({
    value: {
      domain: flag({ name: "domain", values }),
      kind: flag({ name: "kind", values }),
      learner: flag({ name: "learner", values }),
      limit: numericFlag({ name: "limit", values }),
      offset: numericFlag({ name: "offset", values }),
      query: positionals.join(" "),
    },
  });
  if (query.isErr()) {
    logger.error({ msg: `knowledge recall: ${query.error.message}` });
    logger.error({ msg: RECALL_USAGE });
    return EXIT_USAGE;
  }
  const opened = await connectStore();
  if (opened.isErr()) {
    logger.error({ msg: `knowledge recall: ${opened.error.message}` });
    return EXIT_ERROR;
  }
  const client = opened.value;
  try {
    const page = await recallMemories({ client, query: query.value });
    if (page.isErr()) {
      logger.error({ msg: `knowledge recall: ${page.error.message}` });
      return EXIT_ERROR;
    }
    if (values["json"] === true) {
      page.value.hits.forEach((hit) => {
        logger.out({ line: JSON.stringify(hit) });
      });
      return EXIT_OK;
    }
    renderRecall({ page: page.value }).forEach((line) => {
      logger.out({ line });
    });
    return EXIT_OK;
  } finally {
    await client.close();
  }
}

export const knowledgeRecallCommand = defineCommand({ run: runKnowledgeRecall });
