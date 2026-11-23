/**
 * `slopweaver slack tagged` — every recent Slack message where a person tagged the owner, with its permalink.
 *
 * Straight-line: help before any I/O, parse, fix one instant, read the corpus leg, then — unless `--corpus-only` —
 * build the live seam on their USER token and read the live leg, build the document (`live/slack/taggedDocument.ts`)
 * and render it. Exit 1 whenever the document is not complete: an unreadable corpus or a live leg that could not
 * run or stopped short is never an empty all-clear. It READS; it never drafts, posts or sends.
 */

import { slackUserToken } from "../../../config.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { slopweaverHome } from "../../../homeDir.js";
import { parseIsoMs } from "../../../lib/date.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { makeSlackSearchMessages, type SlackSearchMessages } from "../../../live/slack/searchMessages.js";
import { slackTaggedDocument } from "../../../live/slack/taggedDocument.js";
import { renderSlackTaggedJson, renderSlackTaggedText } from "../../../live/slack/taggedRender.js";
import type { TaggedCorpusLeg, TaggedLiveLeg } from "../../../live/slack/taggedTypes.js";
import { loadProfile } from "../../../profileStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { flagValue, flagValueOr, parseFlagTail, positiveIntFlag } from "../../optionParsers.js";
import { memberIndexRead, selfBotIds } from "../sessionStart/slackPeople.js";
import { peopleResolver, readTaggedCorpus, readTaggedLive } from "./taggedRead.js";
import { SLACK_TAGGED_USAGE } from "./taggedUsage.js";

/** The argv index the `slack <verb>` tail starts at. */
const VERB_ARG_OFFSET = 4;

/** The window read when `--days` is absent. */
const DEFAULT_DAYS = 7;

/** The widest window accepted: the live search's page bound is sized for it. */
const MAX_DAYS = 30;

/** One day in milliseconds. */
const DAY_MS = 86_400_000;

/** Every flag this verb accepts, exported so the help-truth guard compares the usage against it. */
export const SLACK_TAGGED_FLAG_SPEC = {
  boolean: ["json", "corpus-only"],
  value: ["days", "now", "home"],
} as const;

/** The resolved invocation. */
export interface SlackTaggedOptions {
  readonly days: number;
  readonly corpusOnly: boolean;
  readonly json: boolean;
  readonly home: string;
  /** The frozen instant from `--now`, normalised to ISO 8601; absent, the shell reads the clock. */
  readonly nowIso?: string;
}

/**
 * Parse `slack tagged`'s argv tail.
 *
 * @param rest the argv after the verb
 * @param defaultHome the home used when `--home` is absent
 * @returns the options, or every usage problem at once
 */
export function parseSlackTaggedOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<SlackTaggedOptions> {
  const parsed = parseFlagTail({ rest, spec: SLACK_TAGGED_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const problems: string[] = [];
  const days = positiveIntFlag({ fallback: DEFAULT_DAYS, name: "days", problems, values: parsed.value.values });
  if (days > MAX_DAYS) {
    problems.push(`--days must be at most ${String(MAX_DAYS)}, got ${String(days)}`);
  }
  const now = flagValue({ name: "now", parsed: parsed.value });
  const nowMs = now === null ? undefined : parseIsoMs({ tsIso: now });
  if (now !== null && nowMs === undefined) {
    problems.push(`--now must be an ISO 8601 instant, got ${JSON.stringify(now)}`);
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({
    corpusOnly: parsed.value.flags.has("corpus-only"),
    days,
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: parsed.value.flags.has("json"),
    ...(nowMs === undefined ? {} : { nowIso: new Date(nowMs).toISOString() }),
  });
}

/** Why the live search seam could not be built — the live leg is then UNREAD, never clear. */
export type SlackTaggedLiveError =
  | { readonly code: "TOKEN_MISSING"; readonly message: string }
  | { readonly code: "AUTH_FAILED"; readonly message: string; readonly cause: unknown }
  | { readonly code: "WRONG_USER"; readonly message: string; readonly tokenUserId: string };

/** The one place a {@link SlackTaggedLiveError} is constructed. */
export const SlackTaggedLiveErrors = {
  authFailed: ({ cause }: { cause: unknown }): SlackTaggedLiveError => ({
    cause,
    code: "AUTH_FAILED",
    message: `auth.test on the user token failed — ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
  tokenMissing: (): SlackTaggedLiveError => ({
    code: "TOKEN_MISSING",
    message: "no Slack user token in the store — `slopweaver secrets status`",
  }),
  wrongUser: ({ tokenUserId, ownerId }: { tokenUserId: string; ownerId: string }): SlackTaggedLiveError => ({
    code: "WRONG_USER",
    message: `the Slack user token belongs to ${tokenUserId}, not the profile's owner ${ownerId}, so its search is somebody else's view`,
    tokenUserId,
  }),
} as const;

/** The injected edges. */
export interface SlackTaggedDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  readonly clockIso: () => string;
  readonly defaultHome: () => string;
  /** The live search seam on their user token, or why it cannot be built. */
  readonly liveFor: (args: {
    home: string;
    ownerId: string;
  }) => Promise<Result<SlackSearchMessages, SlackTaggedLiveError>>;
}

/**
 * Run the verb against injected edges.
 *
 * @param rest the argv tail after `slack tagged`
 * @param deps the injected write channels, clock, home and live seam
 * @returns the process exit code
 */
export async function runSlackTagged({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: SlackTaggedDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(SLACK_TAGGED_USAGE);
    return EXIT_OK;
  }
  const options = parseSlackTaggedOptions({ defaultHome: deps.defaultHome(), rest });
  if (options.isErr()) {
    options.error.forEach((problem) => {
      deps.writeDiagnostic(`slack tagged: ${problem}`);
    });
    deps.writeDiagnostic(SLACK_TAGGED_USAGE);
    return EXIT_USAGE;
  }
  // A destructured default: the clock is read only when `--now` was not passed.
  const { home, days, corpusOnly, json, nowIso = deps.clockIso() } = options.value;
  const sinceIso = new Date(Date.parse(nowIso) - days * DAY_MS).toISOString();
  const { corpus, live, membersProblem } = await readLegs({ corpusOnly, deps, home, nowIso, sinceIso });
  const document = slackTaggedDocument({ corpus, live, membersProblem, nowIso, sinceIso, windowDays: days });
  if (json) {
    deps.writeOut(renderSlackTaggedJson({ document }));
  } else {
    renderSlackTaggedText({ document }).forEach((line) => {
      deps.writeOut(line);
    });
  }
  return document.status === "complete" ? EXIT_OK : EXIT_ERROR;
}

/**
 * Read both legs: the corpus first, then the live search unless it was skipped or the owner is unknown.
 *
 * @param home the state home
 * @param nowIso the window's end
 * @param sinceIso the window's start
 * @param corpusOnly whether the live leg was skipped
 * @param deps the live seam factory
 * @returns both legs, and why the members index could not tell a person from a bot, when it could not
 */
async function readLegs({
  home,
  nowIso,
  sinceIso,
  corpusOnly,
  deps,
}: {
  home: string;
  nowIso: string;
  sinceIso: string;
  corpusOnly: boolean;
  deps: SlackTaggedDeps;
}): Promise<{ corpus: TaggedCorpusLeg; live: TaggedLiveLeg; membersProblem: string | null }> {
  const ownerId = loadProfile({ home })?.slackBot?.ownerUserId;
  if (ownerId === undefined || ownerId.length === 0) {
    const reason =
      "profile.json declares no `slackBot.ownerUserId`, so nothing can tell a tag of you from anybody else's";
    return { corpus: { kind: "unavailable", reason }, live: { kind: "unavailable", reason }, membersProblem: null };
  }
  const { members, problem: membersProblem } = memberIndexRead({ home });
  const author = peopleResolver({ members, selfIds: selfBotIds({ home }) });
  const corpus = readTaggedCorpus({ author, home, nowIso, ownerId, sinceIso });
  if (corpusOnly) {
    return { corpus, live: { kind: "skipped" }, membersProblem };
  }
  const seam = await deps.liveFor({ home, ownerId });
  if (seam.isErr()) {
    return { corpus, live: { kind: "unavailable", reason: seam.error.message }, membersProblem };
  }
  const live = await readTaggedLive({ author, nowIso, ownerId, search: seam.value, sinceIso });
  return { corpus, live, membersProblem };
}

/**
 * The production live seam: their user token, checked by `auth.test` to be their before its search is trusted.
 *
 * @param home the state home the token is read from
 * @param ownerId the profile's owner id the token must belong to
 * @returns the search seam, or why it cannot be built
 */
async function productionLive({
  home,
  ownerId,
}: {
  home: string;
  ownerId: string;
}): Promise<Result<SlackSearchMessages, SlackTaggedLiveError>> {
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
  return ok(makeSlackSearchMessages({ token }));
}

/**
 * The production edges.
 *
 * @returns the process streams, the wall clock, the installed home and the live seam
 */
export function productionSlackTaggedDeps(): SlackTaggedDeps {
  return {
    clockIso: () => new Date().toISOString(),
    defaultHome: () => slopweaverHome(),
    liveFor: productionLive,
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver slack tagged` — recent Slack messages that tagged you, with permalinks; reads, never sends. */
export const slackTaggedCommand = defineCommand({
  run: (argv) => runSlackTagged({ deps: productionSlackTaggedDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
