/**
 * The effectful shells for the `outlook` verbs that only READ: `list`, `read`, `folders`, `categories`, `measure`
 * and `triage`.
 *
 * Every one is the same four steps — parse (pure), bind a session for that verb's capabilities, run the domain
 * read, print it as text or `--json` — so they share {@link runOutlookRead} and differ only in the parser, the
 * read and the renderer they hand it.
 */
import { err, type Result } from "../../../lib/result.js";
import type { OutlookApi } from "../../../live/outlook/apiCore.js";
import { withOutlookAttachments } from "../../../live/outlook/attachments.js";
import { listOutlookCategories } from "../../../live/outlook/categories.js";
import type { OutlookError } from "../../../live/outlook/errors.js";
import { resolveFolderId, walkFolders } from "../../../live/outlook/folders.js";
import { measureOutlook } from "../../../live/outlook/measure.js";
import { listOutlookMessages, readOutlookMessage, readOutlookThread } from "../../../live/outlook/messages.js";
import {
  renderOutlookCategoriesText,
  renderOutlookFoldersText,
  renderOutlookListingText,
  renderOutlookMeasureText,
  renderOutlookMessagesText,
  renderOutlookTriageText,
} from "../../../live/outlook/render.js";
import { triageOutlook } from "../../../live/outlook/triage.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import {
  parseOutlookListArgs,
  parseOutlookMeasureArgs,
  parseOutlookReadArgs,
  parseOutlookTriageArgs,
  parseOutlookViewArgs,
} from "./core.js";
import type { OutlookArgsError } from "./errors.js";
import { OUTLOOK_CATEGORIES_USAGE, OUTLOOK_FOLDERS_USAGE } from "./outlookUsage.js";
import { jsonOut, type OutlookShellDeps, productionOutlookShellDeps, refuseUsage, shellHome } from "./shell.js";

const VERB_ARG_OFFSET = 4;

/**
 * Parse, bind, read, print — the one shape every read verb has.
 *
 * @param verb the verb, which names the capabilities its session must carry
 * @param parse the verb's pure parser
 * @param read the domain read, over the bound seam
 * @param render the human rendering of what was read
 * @returns the process exit code
 */
export async function runOutlookRead<A extends { home: string | undefined; json: boolean }, T>({
  rest,
  deps,
  verb,
  parse,
  read,
  render,
}: {
  rest: readonly string[];
  deps: OutlookShellDeps;
  verb: string;
  parse: (args: { rest: readonly string[] }) => Result<A, OutlookArgsError>;
  read: (args: { api: OutlookApi; args: A }) => Promise<Result<T, OutlookError>>;
  render: (args: { value: T; args: A }) => string;
}): Promise<number> {
  const parsed = parse({ rest });
  if (parsed.isErr()) {
    return refuseUsage({ deps, error: parsed.error });
  }
  const args = parsed.value;
  const session = await deps.session({ home: shellHome({ deps, named: args.home }), verb });
  if (session.isErr()) {
    deps.warn(session.error.message);
    return EXIT_ERROR;
  }
  const result = await read({ api: session.value.api, args });
  if (result.isErr()) {
    deps.warn(result.error.message);
    return EXIT_ERROR;
  }
  deps.out(args.json ? jsonOut({ value: result.value }) : render({ args, value: result.value }));
  return EXIT_OK;
}

/**
 * Run `outlook list`.
 *
 * @param rest argv after `outlook list`
 * @returns the process exit code
 */
export async function runOutlookList({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: OutlookShellDeps;
}): Promise<number> {
  return runOutlookRead({
    deps,
    parse: parseOutlookListArgs,
    read: async ({ api, args }) => {
      const folderId = await resolveFolderId({ api, reference: args.folder });
      if (folderId.isErr()) {
        return err(folderId.error);
      }
      const { query, unreadOnly, limit } = args;
      return listOutlookMessages({ api, folderId: folderId.value, limit, query, unreadOnly });
    },
    render: ({ value, args }) => renderOutlookListingText({ folder: args.folder, listing: value }),
    rest,
    verb: "list",
  });
}

/**
 * Run `outlook read`: one message, or under `--thread` its whole conversation oldest first.
 *
 * @param rest argv after `outlook read`
 * @returns the process exit code
 */
export async function runOutlookReadMessage({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: OutlookShellDeps;
}): Promise<number> {
  return runOutlookRead({
    deps,
    parse: parseOutlookReadArgs,
    read: async ({ api, args }) => {
      const message = await readOutlookMessage({ api, id: args.id });
      if (message.isErr()) {
        return err(message.error);
      }
      if (!args.thread) {
        return withOutlookAttachments({ api, messages: [message.value] });
      }
      const thread = await readOutlookThread({ api, conversationId: message.value.conversationId });
      if (thread.isErr()) {
        return err(thread.error);
      }
      return withOutlookAttachments({ api, messages: thread.value });
    },
    render: ({ value }) => renderOutlookMessagesText({ messages: value }),
    rest,
    verb: "read",
  });
}

/**
 * Run `outlook folders`.
 *
 * @param rest argv after `outlook folders`
 * @returns the process exit code
 */
export async function runOutlookFolders({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: OutlookShellDeps;
}): Promise<number> {
  return runOutlookRead({
    deps,
    parse: ({ rest: tail }) => parseOutlookViewArgs({ rest: tail, usage: OUTLOOK_FOLDERS_USAGE }),
    read: ({ api }) => walkFolders({ api }),
    render: ({ value }) => renderOutlookFoldersText({ walk: value }),
    rest,
    verb: "folders",
  });
}

/**
 * Run `outlook categories`.
 *
 * @param rest argv after `outlook categories`
 * @returns the process exit code
 */
export async function runOutlookCategories({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: OutlookShellDeps;
}): Promise<number> {
  return runOutlookRead({
    deps,
    parse: ({ rest: tail }) => parseOutlookViewArgs({ rest: tail, usage: OUTLOOK_CATEGORIES_USAGE }),
    read: ({ api }) => listOutlookCategories({ api }),
    render: ({ value }) => renderOutlookCategoriesText({ categories: value }),
    rest,
    verb: "categories",
  });
}

/**
 * Run `outlook measure`.
 *
 * @param rest argv after `outlook measure`
 * @returns the process exit code
 */
export async function runOutlookMeasure({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: OutlookShellDeps;
}): Promise<number> {
  return runOutlookRead({
    deps,
    parse: parseOutlookMeasureArgs,
    read: ({ api, args }) => measureOutlook({ api, folder: args.folder }),
    render: ({ value }) => renderOutlookMeasureText({ measure: value }),
    rest,
    verb: "measure",
  });
}

/**
 * Run `outlook triage`.
 *
 * @param rest argv after `outlook triage`
 * @returns the process exit code
 */
export async function runOutlookTriage({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: OutlookShellDeps;
}): Promise<number> {
  return runOutlookRead({
    deps,
    parse: parseOutlookTriageArgs,
    read: ({ api, args }) => triageOutlook({ api, limit: args.limit }),
    render: ({ value }) => renderOutlookTriageText({ triage: value }),
    rest,
    verb: "triage",
  });
}

/** `slopweaver outlook list`. */
export const outlookListCommand = defineCommand({
  run: (argv) => runOutlookList({ deps: productionOutlookShellDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver outlook read`. */
export const outlookReadCommand = defineCommand({
  run: (argv) => runOutlookReadMessage({ deps: productionOutlookShellDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver outlook folders`. */
export const outlookFoldersCommand = defineCommand({
  run: (argv) => runOutlookFolders({ deps: productionOutlookShellDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver outlook categories`. */
export const outlookCategoriesCommand = defineCommand({
  run: (argv) => runOutlookCategories({ deps: productionOutlookShellDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver outlook measure`. */
export const outlookMeasureCommand = defineCommand({
  run: (argv) => runOutlookMeasure({ deps: productionOutlookShellDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver outlook triage`. */
export const outlookTriageCommand = defineCommand({
  run: (argv) => runOutlookTriage({ deps: productionOutlookShellDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
