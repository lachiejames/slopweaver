/**
 * `slopweaver store cite` — the records a question selects, printed with the citation token each one is
 * quoted by (source · cite token · url · title · snippet), for a person or a subagent to read.
 *
 * **No model runs here and nothing ranks.** Postgres full text plus the structured filters select, the rows
 * come back newest first, and what this verb adds over {@link ./run.runStoreQuery} is the citation: a token
 * an answer can carry, computed once in {@link ./citeCore}. `store query` takes filters; this takes a
 * QUESTION, which is the difference worth having two verbs for.
 *
 * What it deliberately does NOT do is worth stating rather than leaving for a reader to discover: there is
 * no coverage refusal, no just-in-time refresh wait and no roster reconciliation. All three were properties
 * of a corpus assembled out of per-source bronze windows with per-source cursors, and the store has
 * neither — its freshness is a property of the last `store load`, which `slopweaver store status` reports.
 */
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK } from "../../exitCodes.js";
import { renderCiteLines } from "./citeCore.js";
import { storeTail } from "./core.js";
import { readStoreQuestion, STORE_QUESTION_FLAGS } from "./shell.js";

/** How many records `store cite` returns when the caller names no limit. */
const DEFAULT_LIMIT = 12;

/** The flags `store cite` takes: the store's filter surface, and nothing else. */
export const STORE_CITE_FLAG_SPEC = {
  boolean: [...STORE_QUESTION_FLAGS.boolean],
  string: [...STORE_QUESTION_FLAGS.string],
} as const;

/**
 * The flags `store cite` advertises, for the help-truth ratchet.
 *
 * @internal
 */
export const STORE_CITE_FLAG_NAMES: readonly string[] = [
  ...STORE_CITE_FLAG_SPEC.string.map((name) => `--${name}`),
  ...STORE_CITE_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/**
 * What `store cite --help` prints.
 *
 * @internal
 */
export const STORE_CITE_USAGE =
  "usage: slopweaver store cite <question> [--search <terms>] [--contains <literal>] [--like <pattern>] [--source <s>] [--person <name|handle|email>] " +
  "[--container <c>] [--kind <k>] [--author <a>] [--since <iso>] [--until <iso>] [--thread <native-id>] [--channel <c>] [--repo <o/r>] " +
  "[--team <t>] [--assignee <a>] [--state <s>] [--visibility <v>] [--limit <n>] [--home <dir>] [--json]\n" +
  "  Prints the records a question selects, each with the citation token an answer quotes it by. Nothing\n" +
  "  ranks them: they come back newest first. `--person` spans every platform that person is known on.\n" +
  "  Freshness is whatever the last `slopweaver store load` put in; `slopweaver store status` says what.\n" +
  "  --search narrows the SELECTION without changing the question, which a naturally-phrased question\n" +
  "  usually needs: full text ANDs its content words.\n" +
  "  --contains matches literal CHARACTERS where --search matches stemmed WORDS, so a name inside an email\n" +
  "  address, a mention or a URL path reaches one and is invisible to the other. --like takes your own ILIKE\n" +
  "  pattern. At most one of the three per query.";

/**
 * Run `store cite`.
 *
 * @param rest the argv tail
 * @returns the process exit code
 */
export async function runStoreCiteFromStore({ rest }: { rest: readonly string[] }): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: STORE_CITE_USAGE });
    return EXIT_OK;
  }
  const read = await readStoreQuestion({
    defaultLimit: DEFAULT_LIMIT,
    rest,
    spec: STORE_CITE_FLAG_SPEC,
    usage: STORE_CITE_USAGE,
  });
  if ("code" in read) {
    return read.code;
  }
  const { query, records } = read.resolved;
  if (read.values["json"] === true) {
    logger.out({ line: safeJsonStringify({ label: "store cite", value: { records } }) });
    return EXIT_OK;
  }
  renderCiteLines({ slice: records }).forEach((line) => {
    logger.out({ line });
  });
  // A resolved person with no rows is a different fact from a person nobody has heard of, and BOTH read as
  // an empty page unless one of them says so. The name got past the query layer's own resolution, so
  // somebody by that name IS in the store; what is absent is content attributed to them in what is loaded.
  if (query.person !== undefined && records.length === 0) {
    logger.out({
      line:
        `"${query.person}" resolved to a person the store holds, and no row in the loaded window is ` +
        "attributed to them. That is a fact about what has been loaded, not evidence that they said nothing.",
    });
  }
  return EXIT_OK;
}

/**
 * Run the `store cite` verb from a full argv.
 *
 * @param argv the full process argv (`[node, cli, store, cite, <question>, …]`)
 * @returns the process exit code
 */
export async function runStoreCite(argv: readonly string[]): Promise<number> {
  return runStoreCiteFromStore({ rest: storeTail({ argv }) });
}

export const storeCiteCommand = defineCommand({ run: runStoreCite });
