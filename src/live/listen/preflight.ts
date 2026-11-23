/**
 * `listen`'s credential preflight — the refusal, in the SAME voice `connect slack --check` already speaks.
 *
 * PURE: two token values in, a {@link ConnectCheckReport} out. It is rendered by `renderConnectText` /
 * `renderConnectJson`, the same two functions the preflight verb uses, deliberately rather than inventing a
 * second report style for one new verb.
 *
 * ## The credential that does not exist yet
 *
 * Socket Mode needs an APP-LEVEL token (`xapp-…`) with `connections:write`. It is a third credential,
 * distinct from both the bot token (`xoxb-`) and the user token (`xoxp-`) this program already holds, and it
 * cannot be derived from either: it authenticates the APP's connection rather than any workspace identity.
 *
 * So the refusal has to teach four things a user cannot guess from "token missing", and all four are one-time
 * app configuration rather than anything this program can do for them: create the token, turn Socket Mode on,
 * subscribe to the events, and grant the scopes those events need. They are stated as numbered steps because
 * the order matters — the token cannot be created before Socket Mode is enabled on the app.
 *
 * There are THREE ways to address this bot and therefore three subscriptions, not one: `app_mention` for a
 * channel tag, `message.im` for a direct message whose text tags it, and `message.channels` for a reply under
 * one of the bot's own posts in a channel `listen --thread-replies` names. The steps used to say
 * "`app_mention` and nothing else", which was true of the rule and false of the wiring — a DM does not raise
 * `app_mention` at all, so following that instruction produced a bot that was deaf in a DM.
 *
 * A subscription is not a policy. `message.channels` delivers EVERY message in every channel the bot is in,
 * and `../listen/mention.ts` refuses all but the narrow slice above — which is why both bundled manifests
 * (`templates/slack-app-manifest.*.json`) have carried it all along, and why 2,576 such events had already
 * been refused at the parse on this install before thread replies were an address at all. Subscribing is what
 * lets the predicate be the one place the rule lives; it is never itself the rule.
 *
 * ## What cannot be checked without connecting, said out loud
 *
 * Whether Socket Mode is enabled, which events are subscribed, and which scopes were granted are all facts
 * about the app's configuration that no local check can see. Claiming READY on the strength of two well-formed
 * token strings would be the over-claim this repo keeps paying for, so the report carries an explicit
 * `warning` capability naming exactly what is unverified and how it surfaces (the connection opens and
 * nothing ever arrives).
 *
 * ## A corrupt profile.json stops the listener; a closed whitelist does not
 *
 * The two look alike and fail in opposite directions. An unreadable `responders.json` fails CLOSED — the
 * listener runs and refuses everyone, which an operator can watch working. A `profile.json` that is there but
 * corrupt fails OPEN: read as absent, the listener would wire default chrome, default reactions and no owner
 * id into every capture it posts, which nobody chose. So a corrupt profile is `missing` and the listener will
 * not start on it, while an ABSENT one is an unconfigured install and passes. The rule is to fail loudly and
 * early: a corrupt profile.json stops the Slack listener rather than entering undefined behavior.
 */
import { type ConnectCapability, type ConnectCheckReport, finaliseReport } from "../../connect/types.js";
import type { Result } from "../../lib/result.js";
import type { Profile } from "../../profile.js";
import type { ProfileReadError } from "../../profileStore.js";
import { type ResponderWhitelist, whitelistSummary } from "./whitelist.js";
import type { WitnessIdentityError, WitnessStateError } from "./witnessErrors.js";
import type { ResolvedWitnessBot } from "./witnessIdentity.js";

/** The prefix an app-level token carries. A bot/user token in this slot is refused before any network call. */
const APP_TOKEN_PREFIX = "xapp-";

/** The prefix the bot token carries — the identity the acknowledgement posts under. */
const BOT_TOKEN_PREFIX = "xoxb-";

/** The secret name the app-level token is stored under. */
export const APP_TOKEN_SECRET = "slack-app-token";

/**
 * The one-time app setup a listener needs, in the order it has to be done.
 *
 * Exported so the CLI prints exactly these steps and a test asserts exactly these steps — the instructions
 * and the check cannot drift into disagreement.
 */
export const LISTEN_SETUP_STEPS: readonly string[] = [
  "1. Slack app settings → Socket Mode → enable it",
  "2. Basic Information → App-Level Tokens → generate a token with the `connections:write` scope (it starts `xapp-`)",
  "3. Event Subscriptions → subscribe to the bot events `app_mention`, `message.im` and `message.channels` — " +
    "a channel tag, a direct message, and a reply under one of the bot's own posts are the three ways to " +
    "address it. `message.channels` is a firehose the parser filters; it is never itself permission to answer",
  "4. OAuth & Permissions → add the `app_mentions:read`, `im:history` and `channels:history` bot scopes, then " +
    "reinstall the app",
  `5. slopweaver secrets set ${APP_TOKEN_SECRET}   (paste the xapp- token)`,
] as const;

/** The app-level-token verdict: absent, the wrong kind of token, or usable. */
function appTokenCapability({ appToken }: { appToken: string | undefined }): ConnectCapability {
  const id = "app-token";
  if (appToken === undefined || appToken.length === 0) {
    return {
      detail:
        "no Slack app-level token configured, so Socket Mode cannot be opened and a tag can never reach this " +
        "machine. It is a THIRD credential — neither the bot nor the user token can be used for it",
      id,
      status: "missing",
    };
  }
  if (!appToken.startsWith(APP_TOKEN_PREFIX)) {
    return {
      detail:
        `the configured ${APP_TOKEN_SECRET} is not an \`${APP_TOKEN_PREFIX}…\` — Socket Mode accepts only an ` +
        "app-level token, and a bot or user token here is refused before any network call",
      id,
      status: "missing",
    };
  }
  return { detail: `an ${APP_TOKEN_PREFIX} app-level token is configured`, id, status: "ok" };
}

/** The bot-token verdict — the identity the listener's reply is posted as. */
function botTokenCapability({ botToken }: { botToken: string | undefined }): ConnectCapability {
  const id = "bot-token";
  if (botToken === undefined || botToken.length === 0) {
    return {
      detail:
        "no Slack bot token configured, so a mention could be received but never answered — run " +
        "`slopweaver secrets set slack-bot-token`",
      id,
      status: "missing",
    };
  }
  if (!botToken.startsWith(BOT_TOKEN_PREFIX)) {
    return {
      detail: `the configured slack-bot-token is not an \`${BOT_TOKEN_PREFIX}…\`, so it cannot post as the bot`,
      id,
      status: "missing",
    };
  }
  return { detail: `an ${BOT_TOKEN_PREFIX} bot token is configured — replies post as the bot`, id, status: "ok" };
}

/**
 * The app CONFIGURATION verdict, which is always a warning because it is always unverified locally.
 *
 * Kept as its own capability rather than folded into the token line: the two failures look identical from
 * the outside (nothing happens when you tag the bot) and have completely different fixes.
 */
const SUBSCRIPTION_CAPABILITY: ConnectCapability = {
  detail:
    "whether Socket Mode is enabled, `app_mention`, `message.im` and `message.channels` are subscribed, and " +
    "`app_mentions:read`, `im:history` and `channels:history` are granted cannot be checked from here — they " +
    "are app configuration. If the connection opens but nothing ever arrives, it is one of those, not the token",
  id: "app-subscription",
  status: "warning",
};

/**
 * The RESPONDER whitelist verdict — how many identities may command this bot.
 *
 * It is here because a closed list looks, from Slack, exactly like a missing token: you tag the bot and
 * nothing happens. A count in the credential report is what makes an absent, empty or unreadable list
 * obvious BEFORE a tag goes unanswered rather than after.
 *
 * A closed list is a `warning` rather than `missing`, deliberately. `missing` would stop `listen` from
 * starting, and a listener that refuses to start is not the same thing as a listener that runs and refuses
 * everyone — the second is the fail-closed behaviour the gate promises, and the one an operator can watch
 * working. The gate itself never consults this report; it exists to be READ, not enforced twice.
 */
function whitelistCapability({
  responderWhitelist,
  responderAllowOpen,
}: {
  responderWhitelist: ResponderWhitelist;
  responderAllowOpen: boolean;
}): ConnectCapability {
  const healthy = responderWhitelist.kind === "list" && responderWhitelist.identities.length > 0;
  return {
    detail: whitelistSummary({ openOverride: responderAllowOpen, whitelist: responderWhitelist }),
    id: "responder-whitelist",
    status: healthy ? "ok" : "warning",
  };
}

/**
 * The profile verdict: valid, absent (an unconfigured install), or there but corrupt — the one that stops the
 * listener, for the reason this module's header gives.
 */
function profileCapability({ profile }: { profile: Result<Profile | null, ProfileReadError> }): ConnectCapability {
  const id = "profile";
  if (profile.isErr()) {
    return {
      detail: `${profile.error.message}. The listener will not start on it: read as absent, every capture would post on default chrome nobody chose`,
      id,
      status: "missing",
    };
  }
  if (profile.value === null) {
    return {
      detail: "no profile.json — an unconfigured install, so captures post on the default chrome",
      id,
      status: "ok",
    };
  }
  return { detail: "profile.json is valid — captures post on its chrome", id, status: "ok" };
}

/**
 * The witness verdict: no peer configured, witnessing named bots, or unable to start — which stops the listener
 * exactly as a corrupt profile does. A thread a person tagged THIS bot in is witnessed either way.
 */
function witnessCapability({
  witness,
}: {
  witness: Result<readonly ResolvedWitnessBot[], WitnessIdentityError | WitnessStateError>;
}): ConnectCapability {
  const id = "witness";
  if (witness.isErr()) {
    return { detail: `${witness.error.message}. The listener will not start on it`, id, status: "missing" };
  }
  if (witness.value.length === 0) {
    return {
      detail: "no slackBot.witnessBotHandles — only threads a person tagged this bot in are witnessed, under --follow",
      id,
      status: "ok",
    };
  }
  const named = witness.value.map((bot) => `@${bot.handle} (${bot.userId})`).join(", ");
  return {
    detail: `witnessing every thread tagging ${named}, and every thread a person tagged this bot in, under --follow`,
    id,
    status: "ok",
  };
}

/**
 * The listener's preflight report: what is present, what is missing, and how to fix it.
 *
 * @param appToken the resolved Slack app-level token, when configured
 * @param botToken the resolved Slack bot token, when configured
 * @param profile the strict `profile.json` read: the profile, `null` when no file is there, or why it is corrupt
 * @param responderWhitelist the loaded responder whitelist, reported as a COUNT (never as identities)
 * @param responderAllowOpen whether the journalled `responder-allow-open` grant is open at startup — narration only
 * @param witness the resolved witnessed bots (empty when none are configured), or why they did not resolve
 * @returns the finalised report — `ok` only when both tokens are present and the right kind, the profile is
 *   valid or absent, and any configured witnessing can start
 */
export function listenPreflight({
  appToken,
  botToken,
  profile,
  responderAllowOpen,
  responderWhitelist,
  witness,
}: {
  appToken: string | undefined;
  botToken: string | undefined;
  profile: Result<Profile | null, ProfileReadError>;
  responderAllowOpen: boolean;
  responderWhitelist: ResponderWhitelist;
  witness: Result<readonly ResolvedWitnessBot[], WitnessIdentityError | WitnessStateError>;
}): ConnectCheckReport {
  const app = appTokenCapability({ appToken });
  return finaliseReport({
    capabilities: [
      app,
      botTokenCapability({ botToken }),
      profileCapability({ profile }),
      whitelistCapability({ responderAllowOpen, responderWhitelist }),
      witnessCapability({ witness }),
      SUBSCRIPTION_CAPABILITY,
    ],
    source: "slack",
    tokenPresent: appToken !== undefined && appToken.length > 0,
    // The steps ride on the report only when the app token is the thing missing: a user who already has one
    // does not need to be told how to make it, and a report that always lectures gets skimmed.
    warnings: app.status === "missing" ? ["set the listener up once, in this order:", ...LISTEN_SETUP_STEPS] : [],
  });
}
