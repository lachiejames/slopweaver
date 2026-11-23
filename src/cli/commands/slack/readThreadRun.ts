/**
 * `slopweaver slack read-thread <permalink>` — the effectful shell.
 *
 * Data goes to STDOUT, diagnostics to STDERR, and in `--json` mode stdout carries exactly one document so
 * `… | jq` works. That separation is not cosmetic here: the shared progress emitter defaults to stdout,
 * which would interleave progress lines into the JSON and break every machine consumer.
 */

import { slackBotToken, slackUserToken } from "../../../config.js";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import { resolveSlackReadToken } from "../../../corpus/slack/fetch.js";
import { logger } from "../../../lib/logger.js";
import { renderThreadJson, renderThreadText, type SlackThreadReadDocument } from "../../../live/slack/document.js";
import { downloadSlackFile } from "../../../live/slack/download.js";
import { type ReadPrincipal, readSlackThread } from "../../../live/slack/readThread.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { slackReadErrorLines } from "./readErrors.js";
import { parseSlackReadThreadArgs } from "./readThreadCore.js";
import { SLACK_READ_THREAD_USAGE } from "./verbUsage.js";

/** The argv index the `slack <verb>` tail starts at. */
const VERB_ARG_OFFSET = 4;

/** The injected edges, so the shell is testable without a token or a network. */
export interface SlackReadThreadDeps {
  readonly userToken: (args: { home?: string }) => string | undefined;
  readonly botToken: (args: { home?: string }) => string | undefined;
  readonly filesRoot: (args: { home?: string }) => string;
  readonly readThread: typeof readSlackThread;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** Write every refusal through the injected diagnostic edge. */
function writeProblems({
  problems,
  writeDiagnostic,
}: {
  problems: readonly string[];
  writeDiagnostic: SlackReadThreadDeps["writeDiagnostic"];
}): void {
  for (const problem of problems) {
    writeDiagnostic(problem);
  }
}

/** Build the progress sink once, keeping JSON stdout pure without adding branches to the command shell. */
function progressSink({
  json,
  writeDiagnostic,
}: {
  json: boolean;
  writeDiagnostic: SlackReadThreadDeps["writeDiagnostic"];
}): NonNullable<Parameters<typeof readSlackThread>[0]["deps"]["onProgress"]> {
  return ({ phase, done }) => {
    if (!json) {
      writeDiagnostic(`${phase}: ${String(done)}`);
    }
  };
}

/** Choose the exact renderer for one successful document. */
function rendered({ document, json }: { document: SlackThreadReadDocument; json: boolean }): string {
  return json ? renderThreadJson({ document }) : renderThreadText({ document });
}

/**
 * Run the verb against injected dependencies.
 *
 * @param rest the argv tail after `slack read-thread`
 * @param deps the injected edges
 * @returns the process exit code
 */
export async function runSlackReadThread({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: SlackReadThreadDeps;
}): Promise<number> {
  const options = parseSlackReadThreadArgs({ rest });
  if (options.isErr()) {
    writeProblems({ problems: slackReadErrorLines({ error: options.error }), writeDiagnostic: deps.writeDiagnostic });
    deps.writeDiagnostic(SLACK_READ_THREAD_USAGE);
    return EXIT_USAGE;
  }
  const { around, channelAround, home, json, permalink, maxFileBytes, sinceTs } = options.value;
  const homeArgs = home !== undefined ? { home } : {};
  const chosen = resolveSlackReadToken({
    botToken: deps.botToken(homeArgs),
    userToken: deps.userToken(homeArgs),
  });
  if (chosen.token === undefined) {
    deps.writeDiagnostic("no Slack token configured; run `slopweaver connect slack`");
    return EXIT_ERROR;
  }
  // Bound to a local before the closures below: narrowing on a property does not survive into a callback.
  const token = chosen.token;
  const principal: ReadPrincipal = chosen.warning === undefined ? "user" : "bot";
  const document = await deps.readThread({
    deps: {
      api: makeSlackApi({ token }),
      downloadFile: downloadSlackFile,
      nowIso: () => new Date().toISOString(),
      onProgress: progressSink({ json, writeDiagnostic: deps.writeDiagnostic }),
    },
    filesRoot: deps.filesRoot(homeArgs),
    permalink,
    principal,
    token,
    ...(around !== undefined ? { around } : {}),
    ...(channelAround !== undefined ? { channelAround } : {}),
    ...(maxFileBytes !== undefined ? { maxFileBytes } : {}),
    ...(sinceTs !== undefined ? { sinceTs } : {}),
  });
  if (document.isErr()) {
    writeProblems({ problems: [document.error.message], writeDiagnostic: deps.writeDiagnostic });
    return EXIT_ERROR;
  }
  deps.writeOut(rendered({ document: document.value, json }));
  return EXIT_OK;
}

/**
 * The production edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionSlackReadThreadDeps(): SlackReadThreadDeps {
  return {
    botToken: ({ home }) => slackBotToken(home !== undefined ? { home } : {}),
    filesRoot: ({ home }) => stateHomePaths(home !== undefined ? { home } : {}).live.slack.threadFiles,
    readThread: readSlackThread,
    userToken: ({ home }) => slackUserToken(home !== undefined ? { home } : {}),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line: line });
    },
  };
}

/** `slopweaver slack read-thread` — paste a link, then read the whole thread or agent-selected context. */
export const slackReadThreadCommand = defineCommand({
  run: (argv) => runSlackReadThread({ deps: productionSlackReadThreadDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
