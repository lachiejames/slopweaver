/**
 * The shell of `chatgpt import-request` and `chatgpt conversation`: argv, the session, and the report. The network
 * edge is `web.ts`'s, shared with `chatgpt list`.
 */
import { join } from "node:path";

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { slopweaverHome } from "../../../homeDir.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { type ChatgptMessage, parseConversationId, pullConversation, renderTranscript } from "./conversation.js";
import { type ChatgptError, ChatgptErrors } from "./errors.js";
import { importRequestPaste, readSessionHeaders } from "./session.js";
import { CHATGPT_CONVERSATION_USAGE, CHATGPT_IMPORT_REQUEST_USAGE } from "./usage.js";
import { type ChatgptWebDeps, productionChatgptWebDeps } from "./web.js";

/** Where a `chatgpt` verb's own arguments start: past the runtime, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** The page bound when `--max-pages` is not passed: 2,000 turns, far past an hour a day for a week. */
const DEFAULT_MAX_PAGES = 200;

/** Print each line of a failure to stderr. */
function diagnose({ lines }: { lines: readonly string[] }): void {
  for (const line of lines) {
    logger.error({ msg: line });
  }
}

/** The options `chatgpt import-request` takes. */
interface ImportRequestOptions {
  readonly from: string;
  readonly json: boolean;
  readonly home: string;
}

/**
 * Parse `chatgpt import-request`'s argv tail. Pure.
 *
 * @param rest the argv after the verb
 * @returns the options, or one sentence per refusal
 *
 * @internal
 */
export function parseImportRequestArgs({ rest }: { rest: readonly string[] }): Result<ImportRequestOptions> {
  const parsed = parseFlags({ args: rest, spec: { boolean: ["json"], string: ["from", "home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const from = values["from"];
  if (typeof from !== "string") {
    return err(["--from <file> is required: the request copied from Chrome DevTools"]);
  }
  const home = values["home"];
  return ok({ from, home: typeof home === "string" ? home : slopweaverHome(), json: values["json"] === true });
}

/** The options `chatgpt conversation` takes. */
interface ConversationOptions {
  readonly id: string;
  readonly maxPages: number;
  readonly json: boolean;
  readonly home: string;
}

/**
 * Parse `chatgpt conversation`'s argv tail. Pure.
 *
 * @param rest the argv after the verb
 * @returns the options, or one sentence per refusal
 *
 * @internal
 */
export function parseConversationArgs({ rest }: { rest: readonly string[] }): Result<ConversationOptions> {
  const parsed = parseFlags({
    allowPositionals: true,
    args: rest,
    spec: { boolean: ["json"], string: ["home", "max-pages"] },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { positionals, values } = parsed.value;
  if (positionals.length !== 1) {
    return err([`expected exactly one conversation id, got ${String(positionals.length)}`]);
  }
  const id = parseConversationId({ given: positionals[0]! });
  if (id.isErr()) {
    return err([id.error.message]);
  }
  let maxPages = DEFAULT_MAX_PAGES;
  const rawMax = values["max-pages"];
  if (typeof rawMax === "string") {
    maxPages = Number(rawMax);
    if (!Number.isInteger(maxPages) || maxPages < 1) {
      return err([`--max-pages must be a whole number of at least 1, got ${rawMax}`]);
    }
  }
  const home = values["home"];
  return ok({
    home: typeof home === "string" ? home : slopweaverHome(),
    id: id.value,
    json: values["json"] === true,
    maxPages,
  });
}

/**
 * Run `chatgpt import-request`.
 *
 * @param rest the argv after the verb
 * @param nowIso the import instant
 * @returns the process exit code
 */
export function runChatgptImportRequest({ rest, nowIso }: { rest: readonly string[]; nowIso: string }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CHATGPT_IMPORT_REQUEST_USAGE });
    return EXIT_OK;
  }
  const options = parseImportRequestArgs({ rest });
  if (options.isErr()) {
    diagnose({ lines: [...options.error, CHATGPT_IMPORT_REQUEST_USAGE] });
    return EXIT_USAGE;
  }
  const { from, home, json } = options.value;
  const report = importRequestPaste({ from, home, nowIso });
  if (report.isErr()) {
    diagnose({ lines: [report.error.message] });
    return EXIT_ERROR;
  }
  if (json) {
    logger.out({ line: JSON.stringify(report.value, null, 1) });
    return EXIT_OK;
  }
  const { bearerExpiresIso, kept, path, removedSource } = report.value;
  logger.out({ line: `imported ${kept.join(", ")} into ${path} (0600)` });
  if (bearerExpiresIso === null) {
    logger.out({ line: "bearer expires at an instant the token does not state" });
  } else {
    logger.out({ line: `bearer expires ${bearerExpiresIso}` });
  }
  logger.out({ line: `removed ${removedSource}` });
  return EXIT_OK;
}

/**
 * Where one conversation's files land.
 *
 * @param home the Slopweaver home
 * @param id the conversation id
 * @returns the directory and its two files
 */
function conversationPaths({ home, id }: { home: string; id: string }): {
  directory: string;
  messages: string;
  transcript: string;
} {
  const directory = join(stateHomePaths({ home }).live.chatgpt.conversations, id);
  return { directory, messages: join(directory, "messages.jsonl"), transcript: join(directory, "transcript.md") };
}

/**
 * Write one pulled conversation's two files at `0600` under a `0700` directory.
 *
 * @param home the Slopweaver home
 * @param id the conversation id, naming the directory
 * @param messages the whole conversation, oldest first
 * @param title the conversation's title, when the backend gave one
 * @returns the paths written, or `FILE_FAILED`
 */
function writeConversation({
  home,
  id,
  messages,
  title,
}: {
  home: string;
  id: string;
  messages: readonly ChatgptMessage[];
  title: string | null;
}): Result<ReturnType<typeof conversationPaths>, ChatgptError> {
  const paths = conversationPaths({ home, id });
  try {
    writeFileAtomic({
      contents: messages.map((message) => `${JSON.stringify(message)}\n`),
      dirMode: 0o700,
      fileMode: 0o600,
      path: paths.messages,
    });
    writeFileAtomic({
      contents: renderTranscript({ id, messages, title }),
      dirMode: 0o700,
      fileMode: 0o600,
      path: paths.transcript,
    });
  } catch (error: unknown) {
    return err(ChatgptErrors.fileFailed({ cause: error, path: paths.directory }));
  }
  return ok(paths);
}

/**
 * Run `chatgpt conversation` against an injected edge.
 *
 * @param rest the argv after the verb
 * @param deps the GET edge
 * @returns the process exit code
 */
export async function runChatgptConversation({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: ChatgptWebDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CHATGPT_CONVERSATION_USAGE });
    return EXIT_OK;
  }
  const options = parseConversationArgs({ rest });
  if (options.isErr()) {
    diagnose({ lines: [...options.error, CHATGPT_CONVERSATION_USAGE] });
    return EXIT_USAGE;
  }
  const { home, id, json, maxPages } = options.value;
  const headers = readSessionHeaders({ home });
  if (headers.isErr()) {
    diagnose({ lines: [headers.error.message] });
    return EXIT_ERROR;
  }
  const pulled = await pullConversation({
    fetchText: ({ path }) => deps.fetchText({ headers: headers.value, path }),
    id,
    maxPages,
  });
  if (pulled.isErr()) {
    diagnose({ lines: [pulled.error.message] });
    return EXIT_ERROR;
  }
  const { messages, pages, title } = pulled.value;
  const written = writeConversation({ home, id, messages, title });
  if (written.isErr()) {
    diagnose({ lines: [written.error.message] });
    return EXIT_ERROR;
  }
  const paths = written.value;
  const report = { id, messages: messages.length, pages, paths, title };
  if (json) {
    logger.out({ line: JSON.stringify(report, null, 1) });
    return EXIT_OK;
  }
  logger.out({
    line: `pulled ${String(messages.length)} message(s) over ${String(pages)} page(s)${title === null ? "" : `: ${title}`}`,
  });
  logger.out({ line: `  ${paths.transcript}` });
  logger.out({ line: `  ${paths.messages}` });
  return EXIT_OK;
}

/** `slopweaver chatgpt import-request --from <file>` — a DevTools paste into the 0600 session file. */
export const chatgptImportRequestCommand = defineCommand({
  run: (argv) => runChatgptImportRequest({ nowIso: new Date().toISOString(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver chatgpt conversation <id>` — one named conversation, read whole, onto this machine. */
export const chatgptConversationCommand = defineCommand({
  run: (argv) => runChatgptConversation({ deps: productionChatgptWebDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
