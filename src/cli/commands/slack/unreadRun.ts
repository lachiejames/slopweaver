/**
 * `slopweaver slack unread` — their unread Slack, DMs first and then activity, one line each, read live.
 *
 * Straight-line: help before any I/O, parse, fix one instant, build the live seams on their USER token (checked by
 * `auth.test` to be their, exactly as `slack tagged` does), run both reads under one deadline, build the document
 * (`live/slack/unreadDocument.ts`) and render it. The console voice's `slack_unread` tool runs this; its 20 s
 * kill is why the deadline is {@link SLACK_UNREAD_DEADLINE_MS} and why a read past it is residue, not a hang.
 * Exit 1 when nothing could be read, or a short read listed nothing — never an empty all-clear; a short read that
 * lists rows exits 0 with its status and residue saying what it missed (`slackUnreadAnswers`). An exit 1 says why on
 * stderr too, the one stream the voice's runner keeps from a failed verb. It READS; it never drafts, posts or sends.
 */
import { slackUserToken } from "../../../config.js";
import { makeSlackApi, makeSlackConversationInfoCall } from "../../../corpus/slack/api.js";
import type { SlackNameMaps } from "../../../corpus/slack/visibleProse.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { makeSlackSearchMessages } from "../../../live/slack/searchMessages.js";
import {
  renderSlackUnreadText,
  type SlackUnreadDocument,
  slackUnreadDocument,
  slackUnreadFailureLines,
  unavailableUnreadDocument,
} from "../../../live/slack/unreadDocument.js";
import type { PersonOf } from "../../../live/slack/unreadRows.js";
import { loadProfile } from "../../../profileStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { flagValueOr, parseFlagTail, positiveIntFlag } from "../../optionParsers.js";
import { type MemberFacts, memberIndexRead, selfBotIds } from "../sessionStart/slackPeople.js";
import { type AuthorResolver, peopleResolver } from "./taggedRead.js";
import { type SlackTaggedLiveError, SlackTaggedLiveErrors } from "./taggedRun.js";
import { readUnreadDms } from "./unreadDms.js";
import { readUnreadActivity, type SlackUnreadSeams } from "./unreadRead.js";
import { SLACK_UNREAD_USAGE } from "./unreadUsage.js";

/** The argv index the `slack <verb>` tail starts at. */
const VERB_ARG_OFFSET = 4;

/** The activity window when `--days` is absent. */
const DEFAULT_DAYS = 3;

/** The widest activity window: wider reads more threads than the deadline can open. */
const MAX_DAYS = 7;

/** How far back a DM's traffic names it for a read-marker check — an unread DM older than this is residue. */
const DM_WINDOW_DAYS = 7;

/** One day in milliseconds. */
const DAY_MS = 86_400_000;

/**
 * How long both reads may take, together. The console kills a voice tool at 20 s with no reason given
 * (`site/lib/talkToolsList.ts`); `auth.test` and the document come out of the remainder, so the reads stop first and
 * the document SAYS what they did not reach.
 */
export const SLACK_UNREAD_DEADLINE_MS = 15_000;

/** Every flag this verb accepts, exported so the help-truth guard compares the usage against it. */
export const SLACK_UNREAD_FLAG_SPEC = {
  boolean: ["json"],
  value: ["days", "home"],
} as const;

/** The resolved invocation. */
export interface SlackUnreadOptions {
  readonly days: number;
  readonly json: boolean;
  readonly home: string;
}

/**
 * Parse `slack unread`'s argv tail.
 *
 * @param rest the argv after the verb
 * @param defaultHome the home used when `--home` is absent
 * @returns the options, or every usage problem at once
 */
export function parseSlackUnreadOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<SlackUnreadOptions> {
  const parsed = parseFlagTail({ rest, spec: SLACK_UNREAD_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const problems: string[] = [];
  const days = positiveIntFlag({ fallback: DEFAULT_DAYS, name: "days", problems, values: parsed.value.values });
  if (days > MAX_DAYS) {
    problems.push(`--days must be at most ${String(MAX_DAYS)}, got ${String(days)}`);
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({
    days,
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: parsed.value.flags.has("json"),
  });
}

/** The injected edges. */
export interface SlackUnreadDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  readonly nowMs: () => number;
  readonly defaultHome: () => string;
  /** The live seams on their user token, or why they cannot be built. */
  readonly liveFor: (args: {
    home: string;
    ownerId: string;
  }) => Promise<Result<SlackUnreadSeams, SlackTaggedLiveError>>;
}

/**
 * Run the verb against injected edges.
 *
 * @param rest the argv tail after `slack unread`
 * @param deps the injected write channels, clock, home and live seams
 * @returns the process exit code
 */
export async function runSlackUnread({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: SlackUnreadDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(SLACK_UNREAD_USAGE);
    return EXIT_OK;
  }
  const options = parseSlackUnreadOptions({ defaultHome: deps.defaultHome(), rest });
  if (options.isErr()) {
    options.error.forEach((problem) => {
      deps.writeDiagnostic(`slack unread: ${problem}`);
    });
    deps.writeDiagnostic(SLACK_UNREAD_USAGE);
    return EXIT_USAGE;
  }
  const document = await readDocument({ deps, options: options.value });
  if (options.value.json) {
    deps.writeOut(JSON.stringify(document));
  } else {
    renderSlackUnreadText({ document }).forEach((line) => {
      deps.writeOut(line);
    });
  }
  const failure = slackUnreadFailureLines({ document });
  failure.forEach((line) => {
    deps.writeDiagnostic(line);
  });
  return failure.length === 0 ? EXIT_OK : EXIT_ERROR;
}

/**
 * Resolve the owner and the seams, then run both reads under one deadline.
 *
 * @param options the parsed invocation
 * @param deps the clock and the seam factory
 * @returns the document; one that could not read at all is `unavailable`, never empty
 */
async function readDocument({
  options,
  deps,
}: {
  options: SlackUnreadOptions;
  deps: SlackUnreadDeps;
}): Promise<SlackUnreadDocument> {
  const { home, days } = options;
  const startMs = deps.nowMs();
  const readAtIso = new Date(startMs).toISOString();
  const dmSinceIso = new Date(startMs - DM_WINDOW_DAYS * DAY_MS).toISOString();
  const activitySinceIso = new Date(startMs - days * DAY_MS).toISOString();
  const windows = { activitySinceIso, dmSinceIso, readAtIso };
  const ownerId = loadProfile({ home })?.slackBot?.ownerUserId;
  if (ownerId === undefined || ownerId.length === 0) {
    return unavailableUnreadDocument({
      ...windows,
      reason: "profile.json declares no `slackBot.ownerUserId`, so nothing can tell your word from anybody else's",
    });
  }
  const seams = await deps.liveFor({ home, ownerId });
  if (seams.isErr()) {
    return unavailableUnreadDocument({ ...windows, reason: seams.error.message });
  }
  const { members, problem } = memberIndexRead({ home });
  const author = peopleResolver({ members, selfIds: selfBotIds({ home }) });
  const deadline = { remainingMs: () => startMs + SLACK_UNREAD_DEADLINE_MS - deps.nowMs() };
  // Side by side under the one deadline; a group DM the activity half also opened is the DM half's row.
  const [dms, activity] = await Promise.all([
    readUnreadDms({ author, deadline, nowMs: startMs, ownerId, seams: seams.value, sinceIso: dmSinceIso }),
    readUnreadActivity({
      author,
      deadline,
      nowIso: readAtIso,
      ownerId,
      seams: seams.value,
      sinceIso: activitySinceIso,
    }),
  ]);
  // A DM's own threads come from the DM half, which read them off the DM searches; the activity half's copy of a
  // group DM would be the same conversation twice.
  const threads = [...activity.read.filter((thread) => !dms.channels.has(thread.channelId)), ...dms.threads];
  return slackUnreadDocument({
    input: {
      ...windows,
      activitySinceIso,
      appTagsNotListed: activity.appTagsNotListed,
      dms: dms.read,
      dmsChecked: dms.checked,
      // Without the members index no author can be told a person, so a row may be judged an app's and dropped.
      incomplete: dms.incomplete || activity.incomplete || problem !== null,
      maps: nameMapsOf({ members }),
      ownerId,
      person: personOf({ author }),
      residue: [...dms.residue, ...activity.residue, ...(problem === null ? [] : [problem])],
      threads,
    },
  });
}

/** Who an author id is, as a row names them: a person the index does not know is "someone", never an id. */
function personOf({ author }: { author: AuthorResolver }): PersonOf {
  return ({ authorId }) => {
    const facts = author({ authorId });
    return { isHuman: facts.isHuman, name: facts.known ? facts.name : "someone" };
  };
}

/** The id → name map mentions are said with, from the members index. */
function nameMapsOf({ members }: { members: ReadonlyMap<string, MemberFacts> }): SlackNameMaps {
  const userNames: Record<string, string> = {};
  for (const [id, facts] of members) {
    userNames[id] = facts.name;
  }
  return { channelNames: {}, userNames };
}

/**
 * The production seams: their user token, checked by `auth.test` to be their before anything it reads is trusted.
 *
 * @param home the state home the token is read from
 * @param ownerId the profile's owner id the token must belong to
 * @returns the seams, or why they cannot be built
 */
async function productionLive({
  home,
  ownerId,
}: {
  home: string;
  ownerId: string;
}): Promise<Result<SlackUnreadSeams, SlackTaggedLiveError>> {
  const token = slackUserToken({ home });
  if (token === undefined) {
    return err(SlackTaggedLiveErrors.tokenMissing());
  }
  let self: Awaited<ReturnType<ReturnType<typeof makeSlackWriteTransport>["whoAmI"]>>;
  try {
    self = await makeSlackWriteTransport({ home, token }).whoAmI();
  } catch (error) {
    return err(SlackTaggedLiveErrors.authFailed({ cause: error }));
  }
  if (self.userId !== ownerId) {
    return err(SlackTaggedLiveErrors.wrongUser({ ownerId, tokenUserId: String(self.userId) }));
  }
  if (self.workspaceUrl === undefined) {
    return err(SlackTaggedLiveErrors.authFailed({ cause: new Error("auth.test named no workspace URL") }));
  }
  return ok({
    api: makeSlackApi({ token }),
    info: makeSlackConversationInfoCall({ token }),
    search: makeSlackSearchMessages({ token }),
    workspace: new URL(self.workspaceUrl).origin,
  });
}

/**
 * The production edges.
 *
 * @returns the process streams, the wall clock, the installed home and the live seams
 */
export function productionSlackUnreadDeps(): SlackUnreadDeps {
  return {
    defaultHome: () => slopweaverHome(),
    liveFor: productionLive,
    nowMs: () => Date.now(),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver slack unread` — unread DMs, then activity, one line each, read live; reads, never sends. */
export const slackUnreadCommand = defineCommand({
  run: (argv) => runSlackUnread({ deps: productionSlackUnreadDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
