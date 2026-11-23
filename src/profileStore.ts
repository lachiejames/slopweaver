/**
 * The effectful edge that reads the persona seed `$SLOPWEAVER_HOME/profile.json` back into a {@link Profile}.
 *
 * Missing and corrupt are two different states, and {@link readProfile} is the one reader that keeps them
 * apart. No file is an unconfigured install, which has documented defaults — the `eyes` capture emoji, no
 * declared checkouts, no exact voice rules. A file that is there but unreadable, not JSON or not a valid
 * profile is broken configuration: read as absent, it would hand every caller those same defaults, and an
 * empty voice-rule list or checkout list is exactly the wrong answer for an install that configured some.
 *
 * {@link loadProfile} keeps the old `Profile | undefined` shape for the chrome resolvers below, which want
 * a working emoji over a crashed turn. It still answers `undefined` for a corrupt file, but says so on stderr
 * once per path per process, so the fallback is never silent. The Slack listener never reaches that fallback:
 * `listen` reads {@link readProfile} before it connects and will not start on a corrupt file
 * (`live/listen/preflight.ts`), so every resolver it wires at startup reads a valid profile or none.
 */
import { absentAs, absentAsEmpty, absentAsNull } from "#lib/absent.js";
import { readStrictFileIfPresent } from "#lib/presentFile.js";
import { parseJson } from "./lib/jsonParse.js";
import { logger } from "./lib/logger.js";
import { err, ok, type Result } from "./lib/result.js";
import { type Profile, parseProfile } from "./profile.js";
import { stateHomePaths } from "./stateHome.js";

/** A `profile.json` that is there but cannot be trusted — the one way reading it fails, since absence is not one. */
export interface ProfileReadError {
  readonly code: "PROFILE_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly detail: string;
}

/** The factory for {@link ProfileReadError}, exported so a test builds its fixture the way the reader does. */
export const ProfileReadErrors = {
  unreadable: ({ path, detail }: { path: string; detail: string }): ProfileReadError => ({
    code: "PROFILE_UNREADABLE",
    detail,
    message:
      `the profile at ${path} is there but cannot be trusted (${detail}) — fix it, or move it aside to run ` +
      "as an install that has configured nothing",
    path,
  }),
} as const;

/**
 * Read and validate `profile.json`, keeping "not there" apart from "there but corrupt".
 *
 * @param home the Slopweaver home
 * @returns the validated profile, `null` when no file is there, or why the file that is there cannot be trusted
 */
export function readProfile({ home }: { home: string }): Result<Profile | null, ProfileReadError> {
  const path = stateHomePaths({ home }).profileJson;
  const read = readStrictFileIfPresent({ operation: "readProfile", path });
  if (read.isErr()) {
    return err(ProfileReadErrors.unreadable({ detail: read.error.message, path }));
  }
  if (read.value === null) {
    return ok(null);
  }
  const parsed = parseJson({ text: read.value });
  if (parsed.isErr()) {
    return err(ProfileReadErrors.unreadable({ detail: `not JSON: ${parsed.error.message}`, path }));
  }
  const profile = parseProfile({ value: parsed.value });
  if (profile.isErr()) {
    return err(ProfileReadErrors.unreadable({ detail: profile.error.join("; "), path }));
  }
  return ok(profile.value);
}

/** Every profile path already reported corrupt by this process, so a listener warns once rather than per event. */
const warnedPaths = new Set<string>();

/** Where {@link loadProfile} reports a corrupt profile unless a caller injects its own sink. */
const warnOnStderr = ({ message }: { readonly message: string }): void => {
  logger.warn({ msg: message });
};

/**
 * Read the persona seed for a caller that wants a working fallback: `undefined` when absent OR corrupt.
 *
 * Corrupt still answers `undefined`, because the chrome resolvers below would rather react with a default
 * emoji than crash a turn. It is never silent: the first corrupt read of each path in a process is reported
 * through `warn`. A caller whose answer changes what may be SENT or WRITTEN reads {@link readProfile} instead.
 *
 * @param home the Slopweaver home
 * @param warn where the one corrupt-profile warning goes; stderr unless a test injects a sink
 * @returns the validated profile, or `undefined` when there is none to use
 */
export function loadProfile({
  home,
  warn = warnOnStderr,
}: {
  home: string;
  warn?: (report: { readonly message: string }) => void;
}): Profile | undefined {
  const read = readProfile({ home });
  if (read.isOk()) {
    if (read.value === null) {
      return undefined;
    }
    return read.value;
  }
  if (!warnedPaths.has(read.error.path)) {
    warnedPaths.add(read.error.path);
    warn({ message: read.error.message });
  }
  return undefined;
}

/**
 * The capture-reaction emoji for this operator, from `profile.json`.
 *
 * Same fallback discipline as the other chrome resolvers: an unloadable profile must still yield a WORKING
 * emoji so a listener with no configured profile still reacts at capture. `"eyes"` matches the schema's own
 * default and the owner's own suggestion. Lives here rather than in `cli/commands/slack/wiring.ts` (which
 * re-exports it) so `live/turn/poster.ts` can read it without a `live/` → `cli/` import.
 *
 * @param home the state home holding `profile.json`
 * @returns the bare reaction name (no colons) to seed at capture
 */
export function captureReactionEmojiFromProfile({ home }: { home: string }): string {
  return absentAs({ value: loadProfile({ home })?.slackBot?.captureReaction.emoji, whenAbsent: "eyes" });
}

/**
 * The owner's own Slack user id, from `profile.json`.
 *
 * `null` rather than `undefined` when it is absent, because "the profile declares no owner" is a state a
 * withhold policy has to be able to ACT on, and an optional field would let it read as "not checked" in one
 * branch and as "not the owner" in another. Same fallback discipline as the chrome resolvers: an unloadable
 * profile yields a working value rather than crashing a turn. Lives here rather than in
 * `cli/commands/slack/wiring.ts` (which re-exports it) so `live/turn/poster.ts` can tag the owner on a
 * failure notice without a `live/` → `cli/` import.
 *
 * @param home the state home holding `profile.json`
 * @returns the owner's Slack user id, or `null` when none is declared
 */
export function ownerUserIdFromProfile({ home }: { home: string }): string | null {
  return absentAsNull({ value: loadProfile({ home })?.slackBot?.ownerUserId });
}

/**
 * The operator's private exact voice rules, refusing a corrupt profile rather than reading it as no rules.
 *
 * An empty list lets every word the owner does not write through, so a corrupt profile is the error and stops the
 * send. No profile at all is an install that declared no vocabulary, and that is an empty list.
 *
 * Read out of `slackMe.voice` even for a BOT send, and that is the whole point rather than an oversight: it
 * is one list of words the owner does not write, and the actor split over it lives in
 * `outbound/voice/exactRules.ts`'s `rulesForActor` — one place — not in a second profile block a reader
 * would have to keep in step. Here rather than in `cli/commands/slack/wiring.ts` for the reason
 * {@link ownerUserIdFromProfile} is: `live/turn/posterAnswer.ts` reads it, and a `live/` → `cli/` import
 * would be the wrong way round.
 *
 * @param home the state home holding `profile.json`
 * @returns the configured rules, none when there is no profile, or why the profile that is there cannot be trusted
 */
export function readExactVoiceRules({
  home,
}: {
  home: string;
}): Result<Profile["slackMe"]["voice"]["exact"], ProfileReadError> {
  return readProfile({ home }).map((profile) => {
    if (profile === null) {
      return [];
    }
    return profile.slackMe.voice.exact;
  });
}

/** The install's high-stakes channels and every user id the fleet posts as. */
export interface HighStakesConfig {
  readonly channels: Profile["slackHighStakes"]["channels"];
  readonly fleetUserIds: readonly string[];
  /**
   * Why the fleet ids cannot be trusted to count every fleet post, when the profile names channels but not both
   * the owner and the bot. The second-post check refuses on it rather than count a partial fleet.
   */
  readonly fleetGap: string | undefined;
  /**
   * Why the home cannot say which channels are high-stakes, when it holds no `profile.json` at all. Every send to
   * a channel refuses on it: an empty `--home` read as "none are" would walk past the whole gate.
   */
  readonly listGap: string | undefined;
}

/**
 * The install's HIGH-STAKES Slack channels and every user id the fleet posts as, refusing a corrupt profile.
 *
 * Read through {@link readProfile}, never {@link loadProfile}: the answer decides what may be SENT, and a
 * corrupt profile read as "no high-stakes channels" would open the gate it configures. No profile at all names no
 * list, which is not the same as naming an empty one, so it answers a `listGap`. The fleet ids are the owner's
 * (`slackBot.ownerUserId`), the bot's own
 * (`slackBot.botUserIds`, `slackBot.selfUserIds`), de-duplicated; the send token's own `auth.test` user joins
 * them at the live read, which is why an install with no `slackBot` block still counts its own posts.
 *
 * @param home the state home holding `profile.json`
 * @returns the named channels and fleet ids, or why the profile that is there cannot be trusted
 */
export function readHighStakesConfig({ home }: { home: string }): Result<HighStakesConfig, ProfileReadError> {
  return readProfile({ home }).map((profile) => {
    if (profile === null) {
      return {
        channels: [],
        fleetGap: undefined,
        fleetUserIds: [],
        listGap: `${home} holds no profile.json, so it cannot say which channels are high-stakes`,
      };
    }
    const { channels } = profile.slackHighStakes;
    const bot = profile.slackBot;
    if (bot === undefined) {
      return {
        channels,
        fleetGap: fleetGapOf({ botIds: [], channels, ownerUserId: undefined }),
        fleetUserIds: [],
        listGap: undefined,
      };
    }
    const owner = bot.ownerUserId === undefined ? [] : [bot.ownerUserId];
    const botIds = [...bot.botUserIds, ...bot.selfUserIds];
    return {
      channels,
      fleetGap: fleetGapOf({ botIds, channels, ownerUserId: bot.ownerUserId }),
      fleetUserIds: [...new Set([...owner, ...botIds])],
      listGap: undefined,
    };
  });
}

/**
 * Why a profile naming high-stakes channels cannot count every fleet post there, or undefined when it can. Pure.
 *
 * A post the gate cannot attribute to the fleet is a post it would wave a second one past, so an install that
 * names a channel must name both identities it posts as there.
 */
function fleetGapOf({
  botIds,
  channels,
  ownerUserId,
}: {
  botIds: readonly string[];
  channels: readonly unknown[];
  ownerUserId: string | undefined;
}): string | undefined {
  if (channels.length === 0) {
    return undefined;
  }
  if (ownerUserId === undefined) {
    return "profile.json names no `slackBot.ownerUserId`, so the owner's own posts there cannot be counted";
  }
  if (botIds.length === 0) {
    return "profile.json names no bot user id (`slackBot.botUserIds`, `selfUserIds`), so the bot's posts there cannot be counted";
  }
  return undefined;
}

/**
 * The completion-reaction emoji for this operator, from `profile.json` — the reaction that REPLACES
 * {@link captureReactionEmojiFromProfile}'s once the turn's answer has actually posted.
 *
 * @param home the state home holding `profile.json`
 * @returns the bare reaction name (no colons) to react with once the answer has posted
 */
export function completionReactionEmojiFromProfile({ home }: { home: string }): string {
  return absentAs({ value: loadProfile({ home })?.slackBot?.completionReaction.emoji, whenAbsent: "white_check_mark" });
}

/**
 * The STOPPED-reaction emoji for this operator, from `profile.json` — the reaction that replaces
 * {@link captureReactionEmojiFromProfile}'s when a turn reaches a terminal state without an answer.
 *
 * Same fallback discipline as its two siblings: an unloadable profile still yields a working emoji, so a
 * refused or abandoned turn still stops showing `:eyes:` on an install that has configured nothing.
 *
 * @param home the state home holding `profile.json`
 * @returns the bare reaction name (no colons) to leave standing when a turn ends without answering
 */
export function stoppedReactionEmojiFromProfile({ home }: { home: string }): string {
  return absentAs({ value: loadProfile({ home })?.slackBot?.stoppedReaction.emoji, whenAbsent: "warning" });
}

/**
 * The ACKNOWLEDGED-reaction emoji for this operator, from `profile.json` — the reaction that replaces
 * {@link captureReactionEmojiFromProfile}'s when a turn judged the ask and owed no reply.
 *
 * Same fallback discipline as its three siblings, with one difference worth stating rather than
 * discovering: the fallback `"ack"` is a CUSTOM workspace emoji, so unlike `eyes`, `white_check_mark` and
 * `warning` it can fail to resolve on a workspace that never added it. That failure is loud — `reactions.add`
 * answers `invalid_name`, which `settleTagReaction` reports as an unsettled reaction — rather than a message
 * silently left wearing the capture emoji, which is the defect this whole ending exists to end.
 *
 * @param home the state home holding `profile.json`
 * @returns the bare reaction name (no colons) to leave standing when a turn owed no reply
 */
export function acknowledgedReactionEmojiFromProfile({ home }: { home: string }): string {
  return absentAs({ value: loadProfile({ home })?.slackBot?.acknowledgedReaction.emoji, whenAbsent: "ack" });
}

/**
 * The FOR-A-HUMAN-reaction emoji for this operator, from `profile.json` — the reaction that replaces
 * {@link captureReactionEmojiFromProfile}'s when a turn judged the ask and left it for a person to answer.
 *
 * Same fallback discipline as {@link acknowledgedReactionEmojiFromProfile}, and the same custom-emoji
 * caveat: `"for-a-human"` resolves only on a workspace that added it, and a missing one is reported, never
 * swallowed.
 *
 * @param home the state home holding `profile.json`
 * @returns the bare reaction name (no colons) to leave standing when a turn left the ask for a person
 */
export function forAHumanReactionEmojiFromProfile({ home }: { home: string }): string {
  const slackBot = loadProfile({ home })?.slackBot;
  if (slackBot === undefined) {
    return "for-a-human";
  }
  return slackBot.forAHumanReaction.emoji;
}

/**
 * The STAND-DOWN reaction emoji for this operator, from `profile.json` — what `witness stand-down` puts on the
 * message that told the bot it was in the way, in place of any reply.
 *
 * @param home the state home holding `profile.json`
 * @returns the bare reaction name (no colons); the Unicode default when no profile configures one
 */
export function standDownReactionEmojiFromProfile({ home }: { home: string }): string {
  const slackBot = loadProfile({ home })?.slackBot;
  if (slackBot === undefined) {
    return "zipper_mouth_face";
  }
  return slackBot.standDownReaction.emoji;
}

/**
 * The bot's own Slack handles out of a profile's `slackBot` block, and the notice a reader prints when there are
 * none. Pure. Each handle is trimmed and loses a leading `@`, the way `profile/slackPlace.ts` reads the same field,
 * so `@acme-bot` and `acme-bot` match the same text in every reader.
 *
 * The notice is owed only when a `slackBot` block exists and names no handle: that reader then knows the bot by its
 * role word alone and its output would otherwise read as complete. A profile with no `slackBot` block at all has no
 * Slack bot, so there is no handle to miss and nothing to say — Slack is one entry point, never a requirement.
 *
 * @param slackBot the profile's `slackBot` block, `undefined` when the profile has none or there is no profile
 * @param reader the verb asking, named in the notice
 * @returns the declared handles, bare, and the notice to print, `undefined` when none is owed
 */
export function botSelfHandlesOf({
  slackBot,
  reader,
}: {
  slackBot: { readonly selfHandles: readonly string[] } | undefined;
  reader: string;
}): { readonly handles: readonly string[]; readonly notice: string | undefined } {
  if (slackBot === undefined) {
    return { handles: [], notice: undefined };
  }
  const handles = slackBot.selfHandles
    .map((handle) => handle.trim().replace(/^@/u, ""))
    .filter((handle) => handle !== "");
  if (handles.length === 0) {
    return {
      handles,
      notice: `${reader}: profile.json declares no slackBot.selfHandles, so the bot is recognised by its role word alone, never by its handle`,
    };
  }
  return { handles, notice: undefined };
}

/**
 * The bot's own Slack handles for this operator, from `profile.json`, so a reader that recognises the bot by
 * handle learns them from the install rather than the code. A `slackBot` block naming none is said on stderr,
 * naming the reader ({@link botSelfHandlesOf} says when that is owed).
 *
 * @param home the state home holding `profile.json`
 * @param reader the verb asking, named in the notice when there are none
 * @returns the declared handles, bare; empty when no profile declares any
 */
export function botSelfHandlesFromProfile({ home, reader }: { home: string; reader: string }): readonly string[] {
  const { handles, notice } = botSelfHandlesOf({ reader, slackBot: loadProfile({ home })?.slackBot });
  if (notice !== undefined) {
    logger.warn({ msg: notice });
  }
  return handles;
}

/**
 * The main checkouts this install is expected to keep current and correctly installed.
 *
 * An absent profile yields an EMPTY list rather than a throw, and so does a corrupt one — reported once on
 * stderr by {@link loadProfile}, matching the fallback discipline above — and every caller prints that emptiness as "none declared" rather than as a clean bill,
 * so an operator who has configured nothing is told so instead of being reassured.
 *
 * @param home the state home holding `profile.json`
 * @returns the declared main checkouts, empty when none are configured
 */
export function mainCheckoutsFromProfile({ home }: { home: string }): Profile["mainCheckouts"] {
  return absentAsEmpty({ value: loadProfile({ home })?.mainCheckouts });
}
