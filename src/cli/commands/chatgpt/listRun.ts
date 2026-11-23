/**
 * `slopweaver chatgpt list` — every conversation on the owner's ChatGPT account, listed through the imported web
 * session (`listing.ts`), and reported. It writes nothing; the full-history sync is what stores them.
 *
 * The default report is a bounded summary — counts per lane and the newest and oldest update — because the listing is
 * the owner's own chat titles and a terminal is somewhere they paste from. `--json` carries every listed conversation,
 * since printing the listing is what that flag asks for.
 */
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";

import { slopweaverHome } from "../../../homeDir.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { type ChatgptInventory, type ChatgptListingLane, listChatgptInventory } from "./listing.js";
import { type ChatgptPacer, productionChatgptPacer } from "./pacer.js";
import { readStoredSession } from "./session.js";
import { CHATGPT_LIST_USAGE, CHATGPT_WEB_CAVEATS } from "./usage.js";
import { type ChatgptWebDeps, productionChatgptWebDeps } from "./web.js";

/** Where a `chatgpt` verb's own arguments start: past the runtime, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** The per-lane page bound when `--max-pages` is not passed: 14,000 chats in one lane. */
const DEFAULT_MAX_PAGES = 500;

/** The options `chatgpt list` takes. */
interface ListOptions {
  readonly maxPages: number;
  readonly json: boolean;
  readonly home: string;
}

/**
 * Parse `chatgpt list`'s argv tail. Pure.
 *
 * @param rest the argv after the verb
 * @returns the options, or one sentence per refusal
 *
 * @internal
 */
export function parseListArgs({ rest }: { rest: readonly string[] }): Result<ListOptions> {
  const parsed = parseFlags({ args: rest, spec: { boolean: ["json"], string: ["home", "max-pages"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  let maxPages = DEFAULT_MAX_PAGES;
  const rawMax = values["max-pages"];
  if (typeof rawMax === "string") {
    maxPages = Number(rawMax);
    if (!Number.isInteger(maxPages) || maxPages < 1) {
      return err([`--max-pages must be a whole number of at least 1, got ${rawMax}`]);
    }
  }
  const home = values["home"];
  return ok({ home: typeof home === "string" ? home : slopweaverHome(), json: values["json"] === true, maxPages });
}

/**
 * The bounded summary of one inventory: counts and instants, never a title. Pure.
 *
 * @param inventory what the walk listed
 * @param bearerExpiresIso the session's own expiry, when its token states one
 * @returns the lines to print, caveats last
 */
export function listSummaryLines({
  inventory,
  bearerExpiresIso,
}: {
  inventory: ChatgptInventory;
  bearerExpiresIso: string | null;
}): readonly string[] {
  const { conversations, projects, repeats, requests } = inventory;
  const byLane: Record<ChatgptListingLane, number> = { active: 0, archived: 0, project: 0 };
  for (const conversation of conversations) {
    byLane[conversation.lane] += 1;
  }
  const lines = [
    `listed ${String(conversations.length)} conversation(s) over ${String(requests)} request(s): ${String(byLane.active)} active, ${String(byLane.archived)} archived, ${String(byLane.project)} in ${String(projects.length)} project(s)`,
  ];
  if (repeats > 0) {
    lines.push(`  ${String(repeats)} listing(s) named a conversation already listed; each is counted once`);
  }
  const updates = conversations.map((conversation) => conversation.updatedIso).toSorted();
  const [oldest] = updates;
  const newest = updates.at(-1);
  if (oldest !== undefined && newest !== undefined) {
    lines.push(`  updates run from ${oldest} to ${newest}`);
  }
  lines.push(
    bearerExpiresIso === null
      ? "  the session's bearer states no expiry"
      : `  the session's bearer expires ${bearerExpiresIso}`,
  );
  lines.push(...CHATGPT_WEB_CAVEATS.map((caveat) => `  ${caveat}`));
  return lines;
}

/** The edges `chatgpt list` reads through. */
export interface ChatgptListDeps {
  readonly web: ChatgptWebDeps;
  readonly pacer: ChatgptPacer;
}

/**
 * Run `chatgpt list` against injected edges.
 *
 * @param rest the argv after the verb
 * @param deps the GET edge and the pacer
 * @returns the process exit code
 */
export async function runChatgptList({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: ChatgptListDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CHATGPT_LIST_USAGE });
    return EXIT_OK;
  }
  const options = parseListArgs({ rest });
  if (options.isErr()) {
    for (const line of [...options.error, CHATGPT_LIST_USAGE]) {
      logger.error({ msg: line });
    }
    return EXIT_USAGE;
  }
  const { home, json, maxPages } = options.value;
  const session = readStoredSession({ home });
  if (session.isErr()) {
    logger.error({ msg: session.error.message });
    return EXIT_ERROR;
  }
  const { bearerExpiresIso, headers } = session.value;
  const inventory = await listChatgptInventory({
    deps: { fetchText: ({ path }) => deps.web.fetchText({ headers, path }), pacer: deps.pacer },
    maxPages,
  });
  if (inventory.isErr()) {
    logger.error({ msg: inventory.error.message });
    for (const caveat of CHATGPT_WEB_CAVEATS) {
      logger.error({ msg: caveat });
    }
    return EXIT_ERROR;
  }
  if (json) {
    logger.out({
      line: JSON.stringify({ ...inventory.value, bearerExpiresIso, caveats: CHATGPT_WEB_CAVEATS }, null, 1),
    });
    return EXIT_OK;
  }
  for (const line of listSummaryLines({ bearerExpiresIso, inventory: inventory.value })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/** `slopweaver chatgpt list` — every conversation on the account, listed through the imported session. */
export const chatgptListCommand = defineCommand({
  run: (argv) =>
    runChatgptList({
      deps: { pacer: productionChatgptPacer(), web: productionChatgptWebDeps() },
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});
