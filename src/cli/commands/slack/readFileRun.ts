/**
 * `slopweaver slack read-file <F… | link>` — the effectful shell.
 *
 * Data goes to STDOUT, diagnostics to STDERR, and in `--json` mode stdout carries exactly one document so
 * `… | jq` works — the same separation `readThreadRun.ts` keeps, and for the same reason.
 */

import { slackBotToken, slackUserToken } from "../../../config.js";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import { resolveSlackReadToken } from "../../../corpus/slack/fetch.js";
import { logger } from "../../../lib/logger.js";
import { downloadSlackFile } from "../../../live/slack/download.js";
import { renderFileJson, renderFileText } from "../../../live/slack/fileDocument.js";
import { readSlackFile } from "../../../live/slack/readFile.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { slackReadErrorLines } from "./readErrors.js";
import { parseSlackReadFileArgs } from "./readFileCore.js";
import { SLACK_READ_FILE_USAGE } from "./verbUsage.js";

/** The argv index the `slack <verb>` tail starts at. */
const VERB_ARG_OFFSET = 4;

/** The injected edges, so the shell is testable without a token or a network. */
export interface SlackReadFileDeps {
  readonly userToken: (args: { home?: string }) => string | undefined;
  readonly botToken: (args: { home?: string }) => string | undefined;
  readonly filesRoot: (args: { home?: string }) => string;
  readonly readFile: typeof readSlackFile;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run the verb against injected dependencies.
 *
 * @param rest the argv tail after `slack read-file`
 * @param deps the injected edges
 * @returns the process exit code
 */
export async function runSlackReadFile({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: SlackReadFileDeps;
}): Promise<number> {
  const options = parseSlackReadFileArgs({ rest });
  if (options.isErr()) {
    for (const problem of slackReadErrorLines({ error: options.error })) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(SLACK_READ_FILE_USAGE);
    return EXIT_USAGE;
  }
  const { home, json, noTranscript, reference } = options.value;
  const homeArgs = home !== undefined ? { home } : {};
  const chosen = resolveSlackReadToken({
    botToken: deps.botToken(homeArgs),
    userToken: deps.userToken(homeArgs),
  });
  if (chosen.token === undefined) {
    deps.writeDiagnostic("no Slack token configured; run `slopweaver connect slack`");
    return EXIT_ERROR;
  }
  // Bound to a local before it crosses into the seam factory: narrowing a property does not survive that.
  const token = chosen.token;
  if (chosen.warning !== undefined) {
    deps.writeDiagnostic(chosen.warning);
  }
  const document = await deps.readFile({
    deps: {
      api: makeSlackApi({ token }),
      downloadFile: downloadSlackFile,
      nowIso: () => new Date().toISOString(),
    },
    filesRoot: deps.filesRoot(homeArgs),
    followTranscript: !noTranscript,
    reference,
    token,
  });
  if (document.isErr()) {
    deps.writeDiagnostic(document.error.message);
    return EXIT_ERROR;
  }
  deps.writeOut(json ? renderFileJson({ document: document.value }) : renderFileText({ document: document.value }));
  return EXIT_OK;
}

/**
 * The production edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionSlackReadFileDeps(): SlackReadFileDeps {
  return {
    botToken: ({ home }) => slackBotToken(home !== undefined ? { home } : {}),
    filesRoot: ({ home }) => stateHomePaths(home !== undefined ? { home } : {}).live.slack.fileReads,
    readFile: readSlackFile,
    userToken: ({ home }) => slackUserToken(home !== undefined ? { home } : {}),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line: line });
    },
  };
}

/** `slopweaver slack read-file` — one Slack file, and the transcript a huddle canvas points at. */
export const slackReadFileCommand = defineCommand({
  run: (argv) => runSlackReadFile({ deps: productionSlackReadFileDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
