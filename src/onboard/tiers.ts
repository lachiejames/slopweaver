/**
 * The SOURCE OF TRUTH for the Slack app manifest `slopweaver onboard` hands a user to paste, and for what
 * each tier of it costs them.
 *
 * ## Why this is TypeScript and not a bundled file
 *
 * The three committed `templates/slack-app-manifest.*.json` files were measured as dangerous
 * to paste: pasted over a live app they renamed it and revoked scopes it was running on. A file that a user
 * is told to copy has to be produced from the same declarations the code actually uses, so that a scope
 * appearing here has a call site to point at and a scope the program needs cannot go missing. The ingest
 * half is not even restated — it IS {@link SLACK_REQUIRED_USER_SCOPES}, the constant `connect slack --check`
 * verifies against, and a test asserts the two agree.
 *
 * ## Every scope carries the reason it is there
 *
 * A {@link ScopeGrant} is a scope PLUS the capability that needs it PLUS the call that fails without it. A
 * user about to hand this to a workspace admin can read the whole request line by line, and a scope nobody
 * can name a use for cannot be added without visibly inventing one.
 *
 * ## No workspace, no app, no team
 *
 * Nothing here can emit an app id, a team id or a workspace name: the only value that varies is the app
 * name the user typed, and the manifest has no field for the rest. That is deliberate — this repository is
 * public and a rendered manifest is the kind of thing that ends up pasted into an issue.
 *
 * Pure: no I/O, no clock. Every function is total.
 */

// biome-ignore lint/correctness/noUnusedImports: named by this file's {@link}, which Biome does not count as a use
import { SLACK_REQUIRED_USER_SCOPES } from "../connect/slack.js";
import { err, ok, type Result } from "../lib/result.js";
import {
  AGENT_BOT_GRANTS,
  INGEST_GRANTS,
  type ScopeGrant,
  type ScopeLane,
  SPEAKING_BOT_GRANTS,
  SPEAKING_USER_GRANTS,
} from "./scopeGrants.js";

/**
 * The three rungs a user chooses between, most capable first.
 *
 * `agent` is `standard` plus Slack's Agents surface, which is the one thing here that cannot be undone;
 * `standard` is the whole speaking bot with every part of it revertible; `restricted` is ingest alone. The
 * owner's decision: the MOST capable rung is the default and is named the least secure in the
 * same breath — we do not force the risky thing and we do not quietly withhold the capable thing.
 */
export type OnboardTier = "agent" | "standard" | "restricted";

/** The rungs in ladder order, most capable first — the order they are offered and printed in. */
export const TIER_ORDER: readonly OnboardTier[] = ["agent", "standard", "restricted"] as const;

/**
 * The tier a bare Enter takes. Stated rather than searched for, and asserted equal to the rung marked
 * `recommended` by `src/__tests__/unit/onboard/tiers.test.ts` — a default that drifts from the recommendation
 * is the exact failure this flow exists to prevent.
 */
export const DEFAULT_TIER: OnboardTier = "agent";

/** The app name used when the user does not choose one. */
export const DEFAULT_APP_NAME = "Slopweaver";

/** Slack's own ceiling on an app's display name. A longer name is rejected at paste time, so reject it here. */
export const MAX_APP_NAME_LENGTH = 35;

/** The one-line app description a speaking tier's manifest carries. Fixed: it names no organisation. */
export const APP_DESCRIPTION =
  "An AI agent in a session its owner watches. While it listens, people on its roster tag it; it investigates, answers with evidence, acts.";

/** The one-line description of the `restricted` tier's app, which has no bot to tag and only reads. */
export const READ_ONLY_APP_DESCRIPTION = "Reads what its owner can read, on their token, into their world model.";

/**
 * What Slack shows inside the Agents panel, under the app's name — read by someone who has just seen the bot
 * reply and wants to know, at a glance, what it is. Only the `agent` tier declares it, and declaring it is the
 * irreversible act — the field's presence IS `features.agent_view`.
 */
export const AGENT_DESCRIPTION =
  "An AI agent running in a Claude Code session its owner can watch. While it is listening, tag it in a thread or a DM: it investigates with live tools and the team's own history, replies with the evidence, and can raise the pull request or file the ticket. It answers only a short roster of people unless its owner opens it to everyone.";

/**
 * The costs of the AGENT tier that a later change of mind cannot recover, quoted from Slack's own reference
 * ([Agents](https://docs.slack.dev/ai/developing-agents)) and re-measured against the live app.
 *
 * Kept as data rather than prose so the render prints them AT the point of choice, which is the owner's
 * instruction: the irreversibility is stated in plain words next to the recommendation, never in a footnote.
 */
const AGENT_IRREVERSIBLE: readonly string[] = [
  "enabling the Agents feature CANNOT BE UNDONE — Slack: \"once you change your app's manifest from " +
    "`assistant_view` to `agent_view`, you can't revert\". There is no setting that turns it back off.",
  "workspace GUESTS lose access to the app entirely — Slack does not permit a guest to use an app with the " +
    "Agents feature enabled.",
  "every member has to hard-refresh Slack before the panel appears for them.",
];

/** The verbs that need no bot at all — the whole of the restricted tier. */
const INGEST_VERBS: readonly string[] = ["refresh", "store read", "store cite"];

/** The verbs that need a bot token, a socket, or a write scope. */
const SPEAKING_VERBS: readonly string[] = ["listen", "turn", "slack post", "slack poll", "slack edit", "slack delete"];

/**
 * The bot events a speaking tier subscribes to. Two, not one, and both are load-bearing: a channel tag
 * raises `app_mention`, and a DM raises `message.im` and never `app_mention`. `listen --check`'s own step 3
 * says exactly this pair, and a manifest that subscribed only the first would make that instruction a lie.
 */
const SPEAKING_BOT_EVENTS: readonly string[] = ["app_mention", "message.im"];

/** Everything a tier declares: its scopes, its Slack settings, and what it costs in one line. */
export interface TierSpec {
  readonly tier: OnboardTier;
  /** Whether this is the one `onboard` recommends. */
  readonly recommended: boolean;
  /** The security label, stated in the same breath as the recommendation rather than in a footnote. */
  readonly securityLabel: string;
  /** The whole trade in ONE line: what it enables, and what the admin is being asked to trust. */
  readonly trade: string;
  /** What adopting this tier cannot take back. Empty when every part of it is revertible. */
  readonly irreversible: readonly string[];
  /** Every scope, with its justification. */
  readonly grants: readonly ScopeGrant[];
  /** The bot events the app subscribes to. */
  readonly botEvents: readonly string[];
  /** Whether the app opens a Socket Mode connection (and therefore needs a third, app-level token). */
  readonly socketMode: boolean;
  /** Whether the app declares `features.agent_view` — Slack's Agents surface, and the one-way door. */
  readonly agentView: boolean;
  /** The slopweaver verbs this tier makes usable. */
  readonly enables: readonly string[];
  /** The slopweaver verbs this tier leaves unusable — stated, so the trade is not a surprise later. */
  readonly withholds: readonly string[];
}

/**
 * The three tiers. `agent` is the default AND is labelled the least secure — that pairing is the point, and
 * it is the owner's decision rather than an engineering one: recommending the safer rung would have been
 * quietly withholding the capable thing. The cost is made impossible to miss instead, and `restricted` is
 * offered in the same breath, one answer away.
 */
export const TIERS: Readonly<Record<OnboardTier, TierSpec>> = {
  agent: {
    agentView: true,
    botEvents: SPEAKING_BOT_EVENTS,
    enables: [...INGEST_VERBS, ...SPEAKING_VERBS, "the Agents panel"],
    grants: [...INGEST_GRANTS, ...SPEAKING_USER_GRANTS, ...SPEAKING_BOT_GRANTS, ...AGENT_BOT_GRANTS],
    irreversible: AGENT_IRREVERSIBLE,
    recommended: true,
    securityLabel: "the LEAST SECURE of the three, and the only one that cannot be undone",
    socketMode: true,
    tier: "agent",
    trade:
      "everything the bot can do — answer a channel tag, answer a direct message, react, edit its own messages " +
      "in place, post as the bot including into public channels nobody invited it to, post as YOU, and mention " +
      "people — plus Slack's Agents panel; which asks your workspace admin to trust software with a voice in " +
      "public channels, with your own name on a message, and with one setting that can never be switched off " +
      "again.",
    withholds: [],
  },
  restricted: {
    agentView: false,
    botEvents: [],
    enables: INGEST_VERBS,
    grants: INGEST_GRANTS,
    irreversible: [],
    recommended: false,
    securityLabel: "the smallest grant, and meaningfully less capable",
    socketMode: false,
    tier: "restricted",
    trade:
      "ingest only — it reads, on your token, exactly what you can already read, and can write nothing at all; " +
      "which asks your admin for no new reach whatsoever, and costs you every verb that speaks: no bot, no " +
      "answering a tag, no posting, no reacting.",
    withholds: SPEAKING_VERBS,
  },
  standard: {
    agentView: false,
    botEvents: SPEAKING_BOT_EVENTS,
    enables: [...INGEST_VERBS, ...SPEAKING_VERBS],
    grants: [...INGEST_GRANTS, ...SPEAKING_USER_GRANTS, ...SPEAKING_BOT_GRANTS],
    irreversible: [],
    recommended: false,
    securityLabel: "the same reach without the one-way door",
    socketMode: true,
    tier: "standard",
    trade:
      "the same speaking bot as `agent` — a channel tag, a direct message, reactions, live edits, posting as " +
      "the bot and as YOU — but WITHOUT the Agents panel, so every part of this install can be undone by " +
      "editing the app; which asks your workspace admin to trust software with a voice in public channels and " +
      "with your own name on a message.",
    withholds: ["the Agents panel", "the thread naming on a `turn brief --surface dm` turn"],
  },
};

/** A Slack app manifest, in the shape `api.slack.com/apps → From a manifest` accepts. */
export interface SlackAppManifest {
  readonly display_information: { readonly name: string; readonly description: string };
  readonly features?: {
    /** Present ONLY on the agent tier. Its presence IS the irreversible toggle. */
    readonly agent_view?: { readonly agent_description: string };
    /** The messages tab, without which a user cannot open a DM with the bot at all. */
    readonly app_home: {
      readonly home_tab_enabled: boolean;
      readonly messages_tab_enabled: boolean;
      readonly messages_tab_read_only_enabled: boolean;
    };
    readonly bot_user: { readonly display_name: string; readonly always_online: boolean };
  };
  readonly oauth_config: { readonly scopes: { readonly user: readonly string[]; readonly bot?: readonly string[] } };
  readonly settings: {
    readonly event_subscriptions?: { readonly bot_events: readonly string[] };
    readonly org_deploy_enabled: boolean;
    readonly socket_mode_enabled: boolean;
    readonly token_rotation_enabled: boolean;
  };
}

/**
 * Parse a tier answer. Accepts the three names and nothing else — an empty answer means "take the default",
 * which is `agent`, because the recommended option must be what pressing Enter gets you.
 *
 * @param value the raw answer (a tier name, or empty for the default)
 * @returns the tier, or an error naming every valid answer
 */
export function parseTier({ value }: { value: string }): Result<OnboardTier> {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    return ok(DEFAULT_TIER);
  }
  const match = TIER_ORDER.find((tier) => tier === trimmed);
  if (match !== undefined) {
    return ok(match);
  }
  return err([`unrecognised tier: ${value} (expected ${TIER_ORDER.map((tier) => `"${tier}"`).join(", ")})`]);
}

/**
 * Validate an app name. Empty means "take the default"; anything Slack would reject at paste time is
 * rejected here instead, where the user is still in a position to fix it.
 *
 * @param value the raw answer (an app name, or empty for the default)
 * @returns the name to put in the manifest, or an error
 */
export function parseAppName({ value }: { value: string }): Result<string> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return ok(DEFAULT_APP_NAME);
  }
  if (trimmed.length > MAX_APP_NAME_LENGTH) {
    return err([
      `app name is ${String(trimmed.length)} characters; Slack allows at most ${String(MAX_APP_NAME_LENGTH)}`,
    ]);
  }
  // Compared as characters rather than matched with a regex: a literal control byte in a source file is the
  // defect this repo has already paid for once, and a regex naming one has to CONTAIN one.
  // Iterating by Unicode CODE POINT is exactly right for a control-character scan (every control char is
  // single-code-unit); code-unit indexing would be the actual bug here (a split surrogate pair), not this.
  // oxlint-disable-next-line no-misused-spread
  if ([...trimmed].some((ch) => ch < " " || ch === "\u007f")) {
    return err(["app name contains a control character, which would corrupt the manifest you paste"]);
  }
  return ok(trimmed);
}

/**
 * The bot's display name, DERIVED from the app name rather than asked for — one fewer question, and Slack
 * rejects a bot display name containing a period, which a user would only discover on paste.
 *
 * @param appName the validated app name
 * @returns the bot display name
 */
export function botDisplayName({ appName }: { appName: string }): string {
  return appName.replaceAll(".", "-");
}

/** The scopes of one lane, in declaration order (which is grouped by capability, not alphabetised). */
function scopesOfLane({ grants, lane }: { grants: readonly ScopeGrant[]; lane: ScopeLane }): readonly string[] {
  return grants.filter((grant) => grant.lane === lane).map((grant) => grant.scope);
}

/**
 * Build the manifest for a tier. Pure — the only thing that varies between two users is the app name.
 *
 * @param appName the validated app name
 * @param tier the chosen tier
 * @returns the manifest object
 */
export function buildSlackAppManifest({ appName, tier }: { appName: string; tier: OnboardTier }): SlackAppManifest {
  const spec = TIERS[tier];
  const bot = scopesOfLane({ grants: spec.grants, lane: "bot" });
  // `agent_view` first, so the one-way field is the first thing a reader of the pasted JSON meets rather
  // than something they scroll past. `app_home.messages_tab_enabled` is not decoration: without it Slack
  // offers no DM composer for the app at all, and `im:history` would subscribe to an event nobody can raise.
  const features = {
    ...(spec.agentView ? { agent_view: { agent_description: AGENT_DESCRIPTION } } : {}),
    app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
    bot_user: { always_online: false, display_name: botDisplayName({ appName }) },
  };
  return {
    display_information: { description: bot.length > 0 ? APP_DESCRIPTION : READ_ONLY_APP_DESCRIPTION, name: appName },
    oauth_config: {
      scopes: {
        user: scopesOfLane({ grants: spec.grants, lane: "user" }),
        ...(bot.length > 0 ? { bot } : {}),
      },
    },
    settings: {
      org_deploy_enabled: false,
      socket_mode_enabled: spec.socketMode,
      token_rotation_enabled: false,
      ...(spec.botEvents.length > 0 ? { event_subscriptions: { bot_events: spec.botEvents } } : {}),
    },
    ...(bot.length > 0 ? { features } : {}),
  };
}

/**
 * The manifest as the text a user copies — two-space JSON, the form Slack's own manifest editor shows.
 *
 * @param appName the validated app name
 * @param tier the chosen tier
 * @returns the JSON text to paste
 */
export function renderSlackAppManifest({ appName, tier }: { appName: string; tier: OnboardTier }): string {
  return JSON.stringify(buildSlackAppManifest({ appName, tier }), null, 2);
}
