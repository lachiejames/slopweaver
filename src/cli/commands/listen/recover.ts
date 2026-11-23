/**
 * `slopweaver listen recover` — find the tags that were dropped, and say which of them are worth answering.
 *
 * ## Why a recovery pass exists at all
 *
 * Two ways a tag is lost, both accepted by design and neither acceptable in silence. A frame arriving after
 * `--once` closes the socket is thrown away (now counted — see `ConnectionOutcome.abandoned`), and a tag
 * arriving when no session is running is a no-op, because the bot runs only inside a visible supervisor
 * session. Neither produces an answer, and until this verb neither produced a way to find out.
 *
 * ## It reports; it does not answer
 *
 * This verb runs no model and posts nothing. It prints the recoverable tags and the exact `turn brief`
 * command for each, so the supervisor session picks them up the same way it picks up a live one. That keeps
 * one answering path rather than two, and it keeps the human decision — *should we still reply to this?* —
 * with the human who is watching.
 *
 * ## The WHERE gate is a required flag, and it governs REPLY — never breadth
 *
 * `--channels` has no default and the verb refuses without it, in every mode. A pass free to reply anywhere
 * it can see would be one flag away from answering in places it has no business in, weeks after the fact:
 * the owner's rule was explicit that "not an appropriate place to respond" is an exclusion, so the
 * appropriate places are stated rather than discovered.
 *
 * What that rule never said is that a pass may only LOOK where it may reply, and reading it that way cost a
 * whole day. MEASURED: the loop's widened gap pass carried thirteen channel ids typed into
 * `--channels`, copied from shift to shift, and the bot was tagged in
 * `C0SYN000011` (`#acme-bugs`) — a private channel it IS a member of and that literal had never named. Every
 * widened pass that day was blind to it by construction, and nothing failed, because a channel a pass never
 * opens reports exactly what a quiet channel reports. Repro, against the live door:
 * `slopweaver slack probe --method conversations.info channel=C0SYN000011 --bot --expect channel.is_member=true`.
 *
 * So `--discover-channels` WIDENS the breadth with the bot token's own `conversations.list` membership —
 * which notices a channel the bot was invited to yesterday, and which a typed list structurally cannot —
 * while `--channels` keeps governing the reply. A discovered survivor outside it comes back `wrong-place`
 * with no brief command, so widening the looking never widens the answering. `--scheduled` has always split
 * these two; this is the manual pass being taught the same distinction.
 *
 * It widens rather than REPLACES because Slack filters `conversations.list` by the token's own scopes. A
 * token with `channels:read` and no `groups:read` discovers every public channel and no private one, so a
 * replacing discovery would drop a private channel the operator had explicitly typed, read the rest, and
 * report `complete`. See `scanTargets` for the union and what dedupes it. A token that cannot see a whole
 * conversation class is refused BEFORE the walk — `recoverDiscovery.ts` asks `auth.test` for the scopes it
 * holds, because a scope-filtered walk exhausts every cursor cleanly and reports nothing missing.
 */
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { slackBotToken } from "../../../config.js";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import type { SlackApi } from "../../../corpus/slack/fetch.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { detectLiveIncidents, incidentChannelsOf } from "../../../incident/detect.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { currentlyIgnoredConversations } from "../../../live/ask/ignoredConversationStore.js";
import { currentlyIgnoredAsks } from "../../../live/ask/ignoreStore.js";
import { foldAskLifecycle, parseAskLifecycleLog, terminalAskEventsByKey } from "../../../live/ask/lifecycle.js";
import { readAskLifecycleText } from "../../../live/ask/store.js";
import { discoverRecoveryChannels } from "../../../live/listen/recoverDiscovery.js";
import type { RecoveryScanTarget } from "../../../live/listen/recoverScan.js";
import { responderHatchOpenNow } from "../../../live/listen/responderHatch.js";
import type { ListenLog } from "../../../live/listen/socket.js";
import { loadResponderWhitelist } from "../../../live/listen/whitelistStore.js";
import { detectSupervisorSession } from "../../../supervisor/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { productionIncidentDetectDeps } from "../incident/deps.js";
import { chromeFromProfile } from "../slack/wiring.js";
import { type ListenError, ListenErrors, listenErrorLines } from "./errors.js";
import { DEFAULT_LOOKBACK_DAYS, LISTEN_RECOVER_USAGE } from "./listenUsage.js";
import { resolveSelfIdentity } from "./liveListenDeps.js";
import { discoveryFailureOutput, manualRecoverExitCode, renderCoverage } from "./manualRecoverReport.js";
import { sweep } from "./manualSweep.js";
import { runScheduledRecover } from "./scheduledRecover.js";

/** Where a resolution failure is narrated — matches this file's existing `logger.error` narration style. */
const progressLog: ListenLog = (args) => {
  logger.error({ msg: args.line });
};

/** Where this verb's own arguments start in `process.argv`: `[node, cli, listen, recover, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/** The verb's flag SPEC, exported so the repo-wide `--help`-truth ratchet can read it. */
export const LISTEN_RECOVER_FLAG_SPEC = {
  boolean: ["json", "scheduled", "discover-channels"],
  string: ["bot-user", "channels", "since", "home", "deadline-ms"],
} as const;

/** Every flag this verb accepts, as the `--`-prefixed tokens a caller types. */
export const LISTEN_RECOVER_FLAG_NAMES: readonly string[] = [
  ...LISTEN_RECOVER_FLAG_SPEC.string.map((name) => `--${name}`),
  ...LISTEN_RECOVER_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/**
 * Parse the verb's argv tail. Pure.
 *
 * @param rest the argv tail after `listen recover`
 * @returns the parsed flags, or the rejections
 */
export function parseRecoverArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({
    args: rest,
    spec: { boolean: [...LISTEN_RECOVER_FLAG_SPEC.boolean], string: [...LISTEN_RECOVER_FLAG_SPEC.string] },
  });
}

/**
 * Resolve `--since` to an ISO cutoff.
 *
 * Two spellings because the two uses are different: `Nd` is what a person types when catching up after a
 * weekend, and an ISO instant is what a script passes when it knows exactly when the last listener ran.
 *
 * @param since the raw flag value, or `undefined` for the default
 * @param nowMs the clock, injected so the default is pinnable in a test
 * @returns the ISO cutoff, or why the value was rejected
 */
export function resolveSince({
  since,
  nowMs,
}: {
  since: string | undefined;
  nowMs: number;
}): Result<string, ListenError> {
  if (since === undefined) {
    return ok(new Date(nowMs - DEFAULT_LOOKBACK_DAYS * 86_400_000).toISOString());
  }
  const days = /^(\d+)d$/.exec(since);
  if (days !== null) {
    return ok(new Date(nowMs - Number(days[1]) * 86_400_000).toISOString());
  }
  const parsed = Date.parse(since);
  if (Number.isNaN(parsed)) {
    return err(ListenErrors.sinceUnreadable({ got: since }));
  }
  return ok(new Date(parsed).toISOString());
}

/** A string flag's value, or `undefined` when it was absent. */
function str({ values, key }: { values: Readonly<Record<string, string | boolean>>; key: string }): string | undefined {
  const value = values[key];
  return typeof value === "string" ? value : undefined;
}

/** Everything the sweep needs, resolved from the flags. */
export interface RecoverOptions {
  readonly botUserId: string;
  /** Where a survivor may be ANSWERED. Also the scan breadth, unless {@link RecoverOptions.discoverChannels}. */
  readonly channels: readonly string[];
  /** Whether to WIDEN the scan breadth with the bot's own membership, on top of the `--channels` ids. */
  readonly discoverChannels: boolean;
  readonly json: boolean;
  readonly sinceIso: string;
  /** Whether `--since` was explicitly typed, as opposed to defaulted — scheduled mode's bootstrap-only rule. */
  readonly sinceExplicit: boolean;
  readonly scheduled: boolean;
  readonly deadlineMs: number | undefined;
}

/**
 * Validate `--deadline-ms` against the rest of the parsed flags: a positive safe integer, given only
 * alongside `--scheduled --json`, or omitted entirely.
 *
 * @param values the parsed flag values
 * @returns `ok(undefined)` when the flag was not given, `ok(value)` for a valid one, or every rejection
 */
function validateRecoverDeadline({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Result<number | undefined, ListenError> {
  const raw = str({ key: "deadline-ms", values });
  if (raw === undefined) {
    return ok(undefined);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    return err(ListenErrors.deadlineNotPositive({ got: raw }));
  }
  if (values["scheduled"] !== true || values["json"] !== true) {
    return err(ListenErrors.deadlineOutsideScheduledJson());
  }
  return ok(value);
}

/** The distinct, non-empty channel ids `--channels` named, in the order they were typed. */
function namedChannels({ raw }: { raw: string | undefined }): readonly string[] {
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((channel) => channel.trim())
    .filter((channel) => channel.length > 0);
}

/**
 * Resolve the flags into the sweep's options, refusing anything incomplete before Slack is touched.
 *
 * @param values the parsed flag values
 * @param nowMs the clock, so the `--since` default is pinnable
 * @returns the options, or every reason they could not be built
 */
export function recoverOptions({
  values,
  nowMs,
}: {
  values: Readonly<Record<string, string | boolean>>;
  nowMs: number;
}): Result<RecoverOptions, ListenError> {
  const botUserId = str({ key: "bot-user", values });
  const channels = namedChannels({ raw: str({ key: "channels", values }) });
  // An absent `--channels` and a `--channels ,,` naming nothing are ONE refusal on purpose: both leave the
  // pass with nowhere it may reply, and splitting them bought a second message saying the same thing.
  if (botUserId === undefined || channels.length === 0) {
    return err(ListenErrors.recoverFlagsMissing({ botUser: botUserId === undefined, channels: channels.length === 0 }));
  }
  const rawSince = str({ key: "since", values });
  const since = resolveSince({ nowMs, since: rawSince });
  if (since.isErr()) {
    return err(since.error);
  }
  const scheduled = values["scheduled"] === true;
  const json = values["json"] === true;
  if (scheduled && !json) {
    return err(ListenErrors.scheduledWithoutJson());
  }
  const discoverChannels = values["discover-channels"] === true;
  if (discoverChannels && scheduled) {
    return err(ListenErrors.discoverWithScheduled());
  }
  const deadlineMs = validateRecoverDeadline({ values });
  if (deadlineMs.isErr()) {
    return err(deadlineMs.error);
  }
  return ok({
    botUserId,
    channels,
    deadlineMs: deadlineMs.value,
    discoverChannels,
    json,
    scheduled,
    sinceExplicit: rawSince !== undefined,
    sinceIso: since.value,
  });
}

/**
 * Resolve both tokens, the responder whitelist and the visible supervisor, then run one scheduled cycle.
 * Refuses loudly (before touching Slack) when either token is missing.
 *
 * @param home the Slopweaver home
 * @param options the resolved verb options (bootstrap `--since`, `--channels`, `--deadline-ms`, …)
 * @returns the process exit code
 */
async function dispatchScheduled({ home, options }: { home: string; options: RecoverOptions }): Promise<number> {
  const botToken = slackBotToken({ home });
  if (botToken === undefined) {
    logger.error({ msg: "--scheduled requires a Slack bot token — run `slopweaver connect slack` first" });
    return EXIT_ERROR;
  }
  const detection = detectSupervisorSession({ env: process.env });
  const transport = makeSlackWriteTransport({ home, token: botToken });
  const selfBotId = (await resolveSelfIdentity({ progressLog, whoAmI: transport.whoAmI })).botId;
  return runScheduledRecover({
    api: makeSlackApi({ token: botToken }),
    doorLedger: doorLedgerPort(),
    home,
    incidents: ({ channels, nowMs }) =>
      detectLiveIncidents({
        channels: incidentChannelsOf({ refs: channels }),
        deps: productionIncidentDetectDeps({ home, nowMs }),
        home,
        nowMs,
      }),
    nowMs: () => Date.now(),
    responderHatchOpen: () => responderHatchOpenNow({ home }),
    responderWhitelist: () => loadResponderWhitelist({ home }),
    selfBotId,
    supervisor: detection.kind === "active" ? detection.session : undefined,
    transport,
    ...options,
  });
}

/**
 * Run the recover verb.
 *
 * @param argv the FULL process argv — the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export async function runListenRecover(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: LISTEN_RECOVER_USAGE });
    return EXIT_OK;
  }
  const parsed = parseRecoverArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ errors: parsed.error, usage: true });
  }
  const options = recoverOptions({ nowMs: Date.now(), values: parsed.value.values });
  if (options.isErr()) {
    return refuse({ errors: listenErrorLines({ error: options.error }), usage: true });
  }
  const home = resolveHome({ named: str({ key: "home", values: parsed.value.values }) });
  if (options.value.scheduled) {
    return dispatchScheduled({ home, options: options.value });
  }
  const token = slackBotToken({ home });
  if (token === undefined) {
    logger.error({ msg: "no Slack bot token — run `slopweaver connect slack` first" });
    return EXIT_ERROR;
  }
  const events = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events;
  const lifecycles = foldAskLifecycle({ events });
  const terminalByAsk = terminalAskEventsByKey({ events });
  const selfBotId = (
    await resolveSelfIdentity({ progressLog, whoAmI: makeSlackWriteTransport({ home, token }).whoAmI })
  ).botId;
  const api = makeSlackApi({ token });
  const targets = await scanTargets({ api, options: options.value });
  if (targets.isErr()) {
    return reportDiscoveryFailure({ json: options.value.json, reason: targets.error });
  }
  return sweep({
    // `channels` is the BREADTH here and `allowedChannels` the reply gate, so the options bag is spread
    // FIRST and both are named after it — a trailing `...options.value` would put the typed ids back.
    ...options.value,
    allowedChannels: options.value.channels,
    api,
    cardEventType: chromeFromProfile({ home }).metadataEventType,
    channels: targets.value,
    error: (args) => {
      logger.error(args);
    },
    ignored: currentlyIgnoredAsks({ home }),
    ignoredConversations: currentlyIgnoredConversations({ home }),
    lifecycles,
    out: (args) => {
      logger.out(args);
    },
    selfBotId,
    terminalByAsk,
  });
}

/**
 * The conversations this pass will READ — the typed `--channels` ids, WIDENED by the bot's own membership
 * when `--discover-channels` was given.
 *
 * **Widened, never replaced**, and the difference is a coverage lie rather than a preference. Slack filters
 * `conversations.list` by the token's own scopes, so a token holding `channels:read` but not `groups:read`
 * discovers every public channel and no private one — and a discovery that REPLACED the typed list would
 * then drop a private channel the operator had explicitly named, read the rest, and report
 * `completeness: "complete"` over a conversation nobody opened. Carrying both means an explicitly requested
 * channel is always attempted: it is read, or it lands in `excludedChannels` and the pass goes partial.
 * The union only restores an id somebody TYPED, so it is half the answer: a private channel nobody typed
 * would still be missing, and `discoverRecoveryChannels`' scope preflight is what refuses that walk
 * outright rather than letting it certify a breadth it could not see.
 * A conversation on both lists is scanned once, as the DISCOVERED target, whose Slack metadata resolves its
 * surface properly where a bare id can only be assumed to be a channel (`recoverScan.ts#distinctTargets`
 * keeps the first of a repeated id, which is why discovery is ordered first here).
 *
 * @param api the Slack read seam, holding the BOT token
 * @param options the resolved verb options
 * @returns the scan targets, or the discovery walk's own failure message
 */
export async function scanTargets({
  api,
  options,
}: {
  api: Pick<SlackApi, "grantedScopes" | "listChannels">;
  options: RecoverOptions;
}): Promise<Result<readonly RecoveryScanTarget[], string>> {
  const explicit = options.channels.map((id): RecoveryScanTarget => ({ id, kind: "explicit" }));
  if (!options.discoverChannels) {
    return ok(explicit);
  }
  const discovered = await discoverRecoveryChannels({ api });
  if (discovered.isErr()) {
    return err(discovered.error.message);
  }
  const widened = discovered.value.map((channel): RecoveryScanTarget => ({ channel, kind: "discovered" }));
  return ok([...widened, ...explicit]);
}

/**
 * Print a failed `--discover-channels` walk as the partial pass it is, and refuse.
 *
 * It goes through the SAME renderers a partial scan does rather than a bespoke error line, because the
 * operator's question is identical either way — how much of the workspace did this pass actually read —
 * and a discovery failure read nothing at all.
 *
 * @param json whether the caller asked for the machine-readable document
 * @param reason the walk failure's own message
 * @returns the process exit code
 */
function reportDiscoveryFailure({ json, reason }: { json: boolean; reason: string }): number {
  const output = discoveryFailureOutput({ reason });
  logger.error({ msg: `could not discover the bot's own channel membership: ${reason}` });
  if (json) {
    logger.out({ line: JSON.stringify(output, null, 2) });
  } else {
    for (const line of renderCoverage({ output })) {
      logger.out({ line });
    }
  }
  return manualRecoverExitCode({ output });
}

/** Print every reason, optionally the usage, and refuse. */
function refuse({ errors, usage }: { errors: readonly string[]; usage: boolean }): number {
  for (const error of errors) {
    logger.error({ msg: error });
  }
  if (usage) {
    logger.error({ msg: LISTEN_RECOVER_USAGE });
  }
  return EXIT_USAGE;
}

export const listenRecoverCommand = defineCommand({ run: runListenRecover });
