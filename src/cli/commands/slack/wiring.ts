/**
 * The production wiring for a Slack write: chrome and drip preferences from the profile, and the fresh Slack ids a
 * person-naming write resolves. Mention resolution itself is `../../../outbound/slack/mentionWiring.ts`, and the
 * live upload-readiness poll is `./uploadReadiness.ts`.
 *
 * These live apart from `./run.ts` so the shell stays a shell — every one of them is an injected
 * dependency there, and every one of them touches something real here.
 */
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { staleRosterRefusals } from "../../../outbound/slack/mentionIndex.js";
import { mentionsFromIdentity } from "../../../outbound/slack/mentionWiring.js";
import type { SlackCardChrome, TurnChrome } from "../../../outbound/slack/types.js";
import type { ExactVoiceRule } from "../../../outbound/voice/exactRules.js";
import type { Profile } from "../../../profile.js";
import {
  DEFAULT_CARD_METADATA_EVENT_TYPE,
  DEFAULT_POLL_METADATA_EVENT_TYPE,
  DEFAULT_PROGRESS_METADATA_EVENT_TYPE,
  DEFAULT_TURN_METADATA_EVENT_TYPE,
} from "../../../profile.js";
import { loadProfile, type ProfileReadError, readProfile } from "../../../profileStore.js";
import { type IdentityRosterPort, identityRosterPort } from "../../../silver/identityRoster.js";
import type { IdentityRosterError } from "../../../silver/identityRosterErrors.js";

export {
  captureReactionEmojiFromProfile,
  completionReactionEmojiFromProfile,
  ownerUserIdFromProfile,
} from "../../../profileStore.js";

/**
 * The card chrome for this operator, from `profile.json`.
 *
 * Every field has a schema default, so an operator who has never configured chrome still gets a
 * working card — and no bot name is ever a literal in this repo.
 *
 * @param home the state home holding `profile.json`
 * @returns the resolved chrome
 */
export function chromeFromProfile({ home }: { home: string }): SlackCardChrome {
  const chrome = loadProfile({ home })?.slackBot?.cardChrome;
  if (chrome === undefined) {
    return {
      authorEmoji: ":robot_face:",
      authorLabel: "slopweaver",
      bannerColor: "#8B5CF6",
      detailLabel: "*Details*",
      metadataEventType: DEFAULT_CARD_METADATA_EVENT_TYPE,
    };
  }
  return {
    authorEmoji: chrome.authorEmoji,
    authorLabel: chrome.authorLabel,
    bannerColor: chrome.bannerColor,
    detailLabel: chrome.detailLabel,
    metadataEventType: chrome.metadataEventType,
  };
}

/**
 * The TURN chrome derived from an operator's resolved card chrome — the same author/banner/detail fields, but
 * the metadata event type fixed to the turn family rather than the card's own.
 *
 * Three call sites built this object inline before this helper existed (`turn/run.ts`, `turn/dispatch.ts`,
 * `listen/liveCapture.ts`), and all three would have drifted independently the next time a field was added.
 *
 * @param chrome the resolved card chrome, from {@link chromeFromProfile}
 * @returns the turn chrome a checklist or turn poster construction needs
 */
export function turnChromeFrom({ chrome }: { chrome: SlackCardChrome }): TurnChrome {
  return {
    authorEmoji: chrome.authorEmoji,
    authorLabel: chrome.authorLabel,
    bannerColor: chrome.bannerColor,
    detailLabel: chrome.detailLabel,
    metadataEventType: DEFAULT_TURN_METADATA_EVENT_TYPE,
  };
}

/**
 * The `metadata.event_type` a standalone progress message carries, from `profile.json`.
 *
 * Nothing posts one any more — the spinner shape this named was deleted, leaving one
 * progress card in `src/outbound` — but messages an old run left standing in a channel still carry it, and
 * `slack delete` is the only way they come down. So this survives as a string an ownership check compares
 * against, never as a renderer input. An operator who renamed theirs keeps the ability to delete what they
 * already posted; an unconfigured profile gets the stock type.
 *
 * @param home the state home holding `profile.json`
 * @returns the event type a stranded standalone progress message would carry
 */
export function standaloneProgressEventTypeFromProfile({ home }: { home: string }): string {
  const configured = loadProfile({ home })?.slackBot?.progressChrome.metadataEventType;
  if (configured === undefined) {
    return DEFAULT_PROGRESS_METADATA_EVENT_TYPE;
  }
  return configured;
}

/**
 * The Slack id for each key a workspace-shape write names (`slack poll --ping`, `slack dm --with`,
 * `slack channel --invite`), with an id resting on a roster too stale to trust LEFT OUT.
 *
 * Those verbs refuse whatever key comes back unresolved, and none of them reads a freshness verdict — so
 * the stale-roster refusal every card send applies is applied here, once, rather than in each verb: its line
 * is printed, and every id only the derived roster vouched for is dropped, which the verb then refuses as
 * unresolved. An id the human roster, the member index or the bot's own identity settled is kept, because
 * `derive` running again could not change it.
 *
 * @param home the state home holding both rosters and the profile
 * @param people the keys the write names
 * @param askedAtIso when this write was asked for, which the roster's freshness is judged against
 * @param identityRoster the door the human roster is read through
 * @returns key → Slack id, for every key that resolved on a roster fit to send against; or the roster's typed
 *   refusal, which the verb prints and stops on
 */
export async function freshSlackIds({
  home,
  people,
  askedAtIso,
  identityRoster,
}: {
  home: string;
  people: readonly string[];
  askedAtIso: string;
  identityRoster: IdentityRosterPort;
}): Promise<Result<ReadonlyMap<string, string>, IdentityRosterError>> {
  // A write naming nobody (`slack channel create` with no `--invite`) has nothing to resolve, so it never
  // needs the store: the roster is read only when an answer depends on it.
  if (people.length === 0) {
    return ok(new Map());
  }
  const resolved = await mentionsFromIdentity({ askedAtIso, groups: [], home, identityRoster, people });
  if (resolved.isErr()) {
    return err(resolved.error);
  }
  const resolution = resolved.value;
  const stale = staleRosterRefusals({ people, resolution });
  for (const line of stale) {
    logger.error({ msg: line });
  }
  return ok(
    new Map(
      [...resolution.resolved]
        .filter(([, target]) => stale.length === 0 || target.origin !== "derived")
        .map(([key, target]) => [key, target.slackId]),
    ),
  );
}

/**
 * {@link freshSlackIds} as a production write resolves people: asked now, over the store's own identity roster.
 * The one binding every person-naming Slack write (`dm`, `channel`, `poll`) wires.
 *
 * @param home the state home holding both rosters and the profile
 * @param people the keys the write names
 * @returns key → Slack id for every key fit to send against, or the roster's typed refusal
 */
export async function freshSlackIdsNow({
  home,
  people,
}: {
  home: string;
  people: readonly string[];
}): Promise<Result<ReadonlyMap<string, string>, IdentityRosterError>> {
  return freshSlackIds({ askedAtIso: new Date().toISOString(), home, identityRoster: identityRosterPort(), people });
}

/** The operator's as-me drip preferences, as the send path consumes them. */
export interface DripConfig {
  readonly exactVoiceRules: readonly ExactVoiceRule[];
  /** Whether a single as-me message must space its paragraphs. Off unless the operator declared it. */
  readonly paragraphSpacing: boolean;
  readonly intervalMs: number;
  readonly maxMessages: number;
  readonly messageVisibleMax: number;
  readonly soleMessageVisibleMax: number;
  /** The whole-card ceiling for a `{"kind":"one-card"}` form, line breaks excluded. */
  readonly cardVisibleMax: number;
  /** How many lines one card may carry. */
  readonly maxLines: number;
  /** How many dot points a `{"kind":"one-list"}` roster may carry. */
  readonly maxBullets: number;
  /** The conversation a live render proof is posted to and deleted from. Absent when the install has not set one. */
  readonly renderProofChannel?: string | undefined;
}

/**
 * The as-me drip preferences for this operator, from `profile.json`.
 *
 * A profile that is there but cannot be trusted is the FAILURE, never the defaults: these numbers bound what
 * an as-me send may post and the exact voice rules judge its words, so a corrupt profile read as absent would
 * send under limits and rules nobody chose. An ABSENT profile is an install that has configured nothing, and
 * gets the schema's own defaults.
 *
 * Note which path each number comes from, because they are NOT the same path. A profile that loads but
 * carries no `slackMe` block still returns 300/1000/1000/8/8/1500 — those arrive from the nested `.default(…)`s in
 * `profile.ts`, through two `prefault({})` hops. The literals below are reached only when there is no profile
 * at all. So a run using 300 is almost never using a preference anyone expressed; it is using a
 * starting shape that has no measured corpus behind it, which is why `skills/slack/SKILL.md` says so plainly.
 *
 * This comment used to claim the duplicated numbers were "pinned equal by a unit test". There was no such
 * test — `dripConfigFromProfile` had no coverage at all, and the sentence had read as true for as long as
 * anyone had looked at it. The tests now exist, and they compare the two paths against each other rather
 * than each against a restated constant.
 *
 * @param home the state home holding `profile.json`
 * @returns the resolved drip preferences, or why the profile holding them cannot be trusted
 */
export function dripConfigFromProfile({ home }: { home: string }): Result<DripConfig, ProfileReadError> {
  return readProfile({ home }).map((profile) => dripConfigFrom({ slackMe: profile?.slackMe }));
}

/**
 * The drip preferences a profile's `slackMe` block resolves to, `undefined` being no profile at all.
 *
 * @param slackMe the profile's as-me block, absent when there is no profile
 * @returns the resolved drip preferences
 */
function dripConfigFrom({ slackMe }: { slackMe: Profile["slackMe"] | undefined }): DripConfig {
  // Every default is a DESTRUCTURED one, which is what the `no-silent-fallback` gate asks for and what the
  // absent case actually is: a profile the schema already defaulted, or no profile at all. A `??` chain says
  // the same thing to a machine and hides, from a reader, that ONE absence — the profile — explains all nine
  // substitutions rather than nine independent ones.
  const {
    cardVisibleMax = 1000,
    intervalMs = 1500,
    maxBullets = 10,
    maxLines = 8,
    maxMessages = 8,
    messageVisibleMax = 300,
    soleMessageVisibleMax = 1000,
  } = slackMe === undefined ? {} : slackMe.drip;
  const { exact: exactVoiceRules = [], paragraphSpacing = false } = slackMe === undefined ? {} : slackMe.voice;
  return {
    cardVisibleMax,
    exactVoiceRules,
    intervalMs,
    maxBullets,
    maxLines,
    maxMessages,
    messageVisibleMax,
    paragraphSpacing,
    soleMessageVisibleMax,
    // No literal fallback, deliberately: there is no defensible default conversation for a live proof, and
    // inventing one would post the owner's words somewhere nobody chose. Absent REFUSES, with a key.
    ...(slackMe?.renderProofChannel === undefined ? {} : { renderProofChannel: slackMe.renderProofChannel }),
  };
}

/**
 * The ONE conversation an automation's PROMPT may be posted into, from the operator's profile.
 *
 * NO literal fallback, deliberately, and for the same reason `renderProofChannel` has none: there is no
 * defensible default conversation for the bot's own instructions, and inventing one would post them
 * somewhere nobody chose. Absent REFUSES the send — see
 * `../../../outbound/slack/automationPromptChannel.ts`.
 *
 * @param home the state home holding `profile.json`
 * @returns the configured prompt conversation, or undefined when the install has set none
 */
export function promptChannelFromProfile({ home }: { home: string }): string | undefined {
  const slackBot = loadProfile({ home })?.slackBot;
  if (slackBot === undefined) {
    return undefined;
  }
  return slackBot.promptChannel;
}

/**
 * The poll's `metadata.event_type`, from the operator's profile.
 *
 * Same fallback discipline as the other two chrome resolvers: an unloadable profile must still yield a working
 * value rather than crash a send. It exists at all so that no message this tool posts carries this tool's NAME
 * in metadata unless the operator left the default — a poll was the last place that was hard-coded.
 *
 * @param home the state home holding `profile.json`
 * @returns the configured poll event type, or the stock default when there is no profile or no `slackBot` block
 */
export function pollEventTypeFromProfile({ home }: { home: string }): string {
  const slackBot = loadProfile({ home })?.slackBot;
  if (slackBot == null) {
    // No profile, or one with no `slackBot` block: the schema's own default is what it would have read.
    return DEFAULT_POLL_METADATA_EVENT_TYPE;
  }
  return slackBot.pollChrome.metadataEventType;
}
