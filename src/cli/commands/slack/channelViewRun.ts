/**
 * `slopweaver slack channel-view <channel-id>` — the effectful shell behind the console's channel hover window.
 *
 * One live `conversations.history` page, the channel's name off `conversations.info`, each Block Kit file reference
 * resolved through `files.info`, and each picture's preview fetched into the private channel-media store
 * (`../../../live/slack/channelMedia.ts`). Read on the owner's user token when there is one, since the owner is the reader the window
 * shows Slack as; the bot's otherwise. Data to STDOUT, diagnostics to STDERR, and in `--json` mode stdout carries
 * exactly one document — the same separation `./readFileRun.ts` keeps.
 */

import { slackBotToken, slackUserToken, slopweaverHome } from "../../../config.js";
import { readOrgChart } from "../../../corpus/members/orgChartStore.js";
import { type SlackPerson, slackPeopleFor } from "../../../corpus/members/slackPeople.js";
import { readAllMembers } from "../../../corpus/members/store.js";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import { resolveSlackReadToken } from "../../../corpus/slack/fetch.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { slackTsFromEpochMs } from "../../../lib/slackTs.js";
import { type LookupSlackFile, slackFileLookup } from "../../../live/slack/blockFiles.js";
import { type FetchPicture, livePictureFetch, workspaceHostOf } from "../../../live/slack/channelMedia.js";
import {
  CHANNEL_VIEW_MESSAGES,
  type ChannelViewDocument,
  channelViewDocument,
} from "../../../live/slack/channelView.js";
import { type ChannelViewError, ChannelViewErrors } from "../../../live/slack/channelViewErrors.js";
import { channelViewTextLines } from "../../../live/slack/channelViewText.js";
import { downloadSlackFile } from "../../../live/slack/download.js";
import { draftContextMemberIds } from "../../../live/slack/draftContext.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseSlackChannelViewArgs } from "./channelViewCore.js";
import { slackReadErrorLines } from "./readErrors.js";
import { SLACK_CHANNEL_VIEW_USAGE } from "./verbUsage.js";

/** The argv index the `slack <verb>` tail starts at. */
const VERB_ARG_OFFSET = 4;

/** What one live read of the channel returned, before any of it is shaped. */
interface ChannelRead {
  readonly rows: readonly unknown[];
  readonly hasMore: boolean;
  readonly name: string | undefined;
}

/** The injected edges, so the shell is testable without a token, a network or a store. */
export interface SlackChannelViewDeps {
  readonly userToken: (args: { home: string }) => string | undefined;
  readonly botToken: (args: { home: string }) => string | undefined;
  /** The workspace origin `auth.test` answers for the token — asked before the channel is read at all. */
  readonly workspaceUrl: (args: { channel: string; token: string }) => Promise<Result<string, ChannelViewError>>;
  /** One history page of `limit` rows, newest first, and the channel's name. Reads only. */
  readonly readChannel: (args: {
    channel: string;
    home: string;
    limit: number;
    token: string;
  }) => Promise<Result<ChannelRead, ChannelViewError>>;
  readonly lookupFile: (args: { token: string }) => LookupSlackFile;
  /** The picture fetch for one read, downloading every preview on the token the channel was read under. */
  readonly fetchPicture: (args: { home: string; token: string }) => FetchPicture;
  /** Who each id is, off member bronze — nothing read for an empty list. */
  readonly people: (args: { home: string; ids: readonly string[] }) => readonly SlackPerson[];
  readonly nowIso: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run the verb against injected dependencies.
 *
 * @param rest the argv tail after `slack channel-view`
 * @param deps the injected edges
 * @returns the process exit code
 */
export async function runSlackChannelView({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: SlackChannelViewDeps;
}): Promise<number> {
  const options = parseSlackChannelViewArgs({ rest });
  if (options.isErr()) {
    for (const problem of slackReadErrorLines({ error: options.error })) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(SLACK_CHANNEL_VIEW_USAGE);
    return EXIT_USAGE;
  }
  const { channel, json, workspace } = options.value;
  let home: string;
  if (options.value.home === undefined) {
    home = slopweaverHome();
  } else {
    home = options.value.home;
  }
  const userToken = deps.userToken({ home });
  const chosen = resolveSlackReadToken({ botToken: deps.botToken({ home }), userToken });
  // Whose eyes the read was through, carried in the document so the window can say a bot read is narrower than the owner's
  // view rather than lose the stderr warning.
  const readAs: ChannelReadAs = userToken === undefined ? "bot" : "user";
  if (chosen.token === undefined) {
    deps.writeDiagnostic("no Slack token configured; run `slopweaver connect slack`");
    return EXIT_ERROR;
  }
  if (chosen.warning !== undefined) {
    deps.writeDiagnostic(chosen.warning);
  }
  const document = await readDocument({ channel, deps, home, token: chosen.token, workspace });
  if (document.isErr()) {
    deps.writeDiagnostic(document.error.message);
    return EXIT_ERROR;
  }
  printDocument({ deps, document: document.value, home, json, readAs });
  return EXIT_OK;
}

/** Which token a read went through: the owner's own, or the bot's narrower one. */
type ChannelReadAs = "user" | "bot";

/**
 * The channel read live and shaped into the window's document — or why it could not be. A channel id is only an id
 * within one workspace, so when the caller named the workspace its link was in, a token answering for another one
 * refuses on `auth.test` alone, before the channel's history, name or any picture is read.
 */
async function readDocument({
  channel,
  deps,
  home,
  token,
  workspace,
}: {
  channel: string;
  deps: SlackChannelViewDeps;
  home: string;
  token: string;
  workspace: string | undefined;
}): Promise<Result<ChannelViewDocument, ChannelViewError>> {
  const workspaceUrl = await deps.workspaceUrl({ channel, token });
  if (workspaceUrl.isErr()) {
    return err(workspaceUrl.error);
  }
  const readIn = workspaceHostOf({ url: workspaceUrl.value });
  if (readIn === undefined) {
    return err(
      ChannelViewErrors.channelUnreadable({
        cause: `auth.test answered ${workspaceUrl.value}, which is not a Slack workspace URL`,
        channel,
      }),
    );
  }
  if (workspace !== undefined && workspace !== readIn) {
    return err(ChannelViewErrors.workspaceMismatch({ asked: workspace, channel, readIn }));
  }
  const read = await deps.readChannel({ channel, home, limit: CHANNEL_VIEW_MESSAGES, token });
  if (read.isErr()) {
    return err(read.error);
  }
  if (read.value.name === undefined) {
    return err(ChannelViewErrors.channelUnnamed({ channel }));
  }
  return channelViewDocument({
    channel,
    fetchPicture: deps.fetchPicture({ home, token }),
    hasMore: read.value.hasMore,
    lookupFile: deps.lookupFile({ token }),
    name: read.value.name,
    observedAtIso: deps.nowIso(),
    rows: read.value.rows,
    workspace: workspaceUrl.value.replace(/\/+$/u, ""),
  });
}

/** The document on stdout, with every member it shows named: one JSON document, or one line per message. */
function printDocument({
  deps,
  document,
  home,
  json,
  readAs,
}: {
  deps: SlackChannelViewDeps;
  document: ChannelViewDocument;
  home: string;
  json: boolean;
  readAs: ChannelReadAs;
}): void {
  const people = deps.people({ home, ids: draftContextMemberIds({ messages: document.messages }) });
  if (json) {
    deps.writeOut(JSON.stringify({ ...document, people, readAs }, null, 2));
    return;
  }
  const names = new Map<string, string>();
  for (const person of people) {
    if (person.name !== undefined) {
      names.set(person.nativeId, person.name);
    }
  }
  for (const line of channelViewTextLines({ document, names })) {
    deps.writeOut(line);
  }
}

/**
 * Whether a history page leaves older messages unread. Slack may mark that with a next cursor alone, without
 * `has_more`, so either signal means the page is not the whole channel and the window must say so.
 *
 * @param page the paging fields of one `conversations.history` answer
 * @returns true when earlier messages exist past this page
 */
export function historyHasEarlier({ page }: { page: { hasMore?: boolean; nextCursor?: string } }): boolean {
  return page.hasMore === true || page.nextCursor !== undefined;
}

/** The live `auth.test`: the workspace origin the token reads, and nothing about any channel. */
const workspaceUrlLive: SlackChannelViewDeps["workspaceUrl"] = async ({ channel, token }) => {
  try {
    const workspaceUrl = await makeSlackApi({ token }).workspaceUrl();
    if (workspaceUrl === undefined) {
      return err(ChannelViewErrors.channelUnreadable({ cause: "auth.test returned no workspace url", channel }));
    }
    return ok(workspaceUrl);
  } catch (cause: unknown) {
    return err(ChannelViewErrors.channelUnreadable({ cause, channel }));
  }
};

/** The live channel read: one history page up to now, and `conversations.info`. */
const readChannelLive: SlackChannelViewDeps["readChannel"] = async ({ channel, home, limit, token }) => {
  try {
    const latest = slackTsFromEpochMs({ ms: Date.now() });
    const page = await makeSlackApi({ token }).history({ channel, latest, oldest: "0", pageSize: limit });
    const info = await makeSlackWriteTransport({ home, token }).conversationInfo({ channel });
    return ok({ hasMore: historyHasEarlier({ page }), name: info.name, rows: page.messages });
  } catch (cause: unknown) {
    return err(ChannelViewErrors.channelUnreadable({ cause, channel }));
  }
};

/**
 * The production edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionSlackChannelViewDeps(): SlackChannelViewDeps {
  return {
    botToken: ({ home }) => slackBotToken({ home }),
    fetchPicture: ({ home, token }) =>
      livePictureFetch({
        download: downloadSlackFile,
        root: stateHomePaths({ home }).live.slack.channelMedia,
        token,
      }),
    lookupFile: ({ token }) => slackFileLookup({ api: makeSlackApi({ token }) }),
    nowIso: () => new Date().toISOString(),
    people: ({ home, ids }) => {
      if (ids.length === 0) {
        return [];
      }
      const members = readAllMembers({ home });
      const org = readOrgChart({ home });
      for (const warning of [...members.warnings, ...org.warnings]) {
        logger.warn({ msg: warning });
      }
      return slackPeopleFor({ ids, orgChart: org.chart, rows: members.rows });
    },
    readChannel: readChannelLive,
    userToken: ({ home }) => slackUserToken({ home }),
    workspaceUrl: workspaceUrlLive,
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver slack channel-view` — a channel as it is now, pictures included, for the console's hover window. */
export const slackChannelViewCommand = defineCommand({
  run: (argv) => runSlackChannelView({ deps: productionSlackChannelViewDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
