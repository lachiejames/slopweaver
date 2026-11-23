/**
 * The Slack scope grants the onboarding tiers are assembled from: each scope, the capability that needs it and
 * the call that fails without it. `./tiers.ts` says which of these lists each tier takes and renders the manifest.
 *
 * Pure data: no I/O, no clock.
 */

import { SLACK_REQUIRED_USER_SCOPES } from "../connect/slack.js";

/** Which token a scope is granted on — the two lanes are separate grants and separate risks. */
export type ScopeLane = "bot" | "user";

/** One scope, the capability that needs it, and the call that fails without it. */
export interface ScopeGrant {
  /** The Slack OAuth scope string, verbatim as it appears in the manifest. */
  readonly scope: string;
  /** Which token it is granted on. */
  readonly lane: ScopeLane;
  /** The user-facing capability this scope buys (the thing they would miss). */
  readonly capability: string;
  /** The concrete call or event that fails without it — the justification, not a restatement. */
  readonly why: string;
}

/**
 * The ingest scopes, one grant per scope in {@link SLACK_REQUIRED_USER_SCOPES}.
 *
 * Declared in the same order as that constant so the two read as one list, and asserted equal to it by
 * `src/__tests__/unit/onboard/tiers.test.ts` — the manifest cannot drift from the preflight that checks it.
 */
export const INGEST_GRANTS: readonly ScopeGrant[] = [
  {
    capability: "know who each Slack id is",
    lane: "user",
    scope: "users:read",
    why: "`users.list` — without it every message is authored by an opaque id",
  },
  {
    capability: "link a Slack person to the same person in GitHub/Linear/Notion",
    lane: "user",
    scope: "users:read.email",
    why: "the email is the exact-match join key; identity is never fuzzy-matched from a name",
  },
  {
    capability: "name the public channels",
    lane: "user",
    scope: "channels:read",
    why: "`conversations.list` / `conversations.info`",
  },
  {
    capability: "read public messages and their threads",
    lane: "user",
    scope: "channels:history",
    why: "`conversations.history` / `conversations.replies` — the bulk of the corpus",
  },
  {
    capability: "name the private channels you are already in",
    lane: "user",
    scope: "groups:read",
    why: "`conversations.list` over private conversations — it grants nothing you cannot already see",
  },
  {
    capability: "read the private channels you are already in",
    lane: "user",
    scope: "groups:history",
    why: "`conversations.history` over private conversations you are a member of",
  },
  {
    capability: "record the files shared in a conversation",
    lane: "user",
    scope: "files:read",
    why: "`files.list` / `files.info` — the file's metadata, so a decision that landed as an upload is citable",
  },
  {
    capability: "record what a channel pinned",
    lane: "user",
    scope: "pins:read",
    why: "`pins.list` — a pin is the team saying this one matters",
  },
  {
    capability: "record a channel's bookmarks",
    lane: "user",
    scope: "bookmarks:read",
    why: "`bookmarks.list` — the links a channel treats as canonical",
  },
  {
    capability: "name the workspace the corpus came from",
    lane: "user",
    scope: "team:read",
    why: "`team.info` — so a citation can say which workspace it is from",
  },
  {
    capability: "record who is in which user group",
    lane: "user",
    scope: "usergroups:read",
    why: "`usergroups.list` — team membership that no message states",
  },
];

/** What the speaking tiers add on the USER token: two scopes, and the first is the sharpest one in the set. */
export const SPEAKING_USER_GRANTS: readonly ScopeGrant[] = [
  {
    capability: "post as YOU — a message that appears to come from you, sent by software",
    lane: "user",
    scope: "chat:write",
    why: "`chat.postMessage` on the `xoxp-` token — what `slopweaver slack post --as me` sends",
  },
  {
    capability: "attach a file to a message posted as YOU",
    lane: "user",
    scope: "files:write",
    why:
      "`files.uploadV2` on the `xoxp-` token — the upload step of `slopweaver slack post --as me --media`, " +
      "so a message under your name can carry the screenshot that proves it",
  },
];

/** What the speaking tiers add on the BOT token. */
export const SPEAKING_BOT_GRANTS: readonly ScopeGrant[] = [
  {
    capability: "wake up when you tag it in a channel",
    lane: "bot",
    scope: "app_mentions:read",
    why: "the `app_mention` event — one of the two ways `slopweaver listen` can be addressed",
  },
  {
    capability: "answer a direct message, where every message counts as addressing it",
    lane: "bot",
    scope: "im:history",
    why:
      "the `message` event with `channel_type: im` — a tag inside a DM raises no `app_mention` at all, so " +
      "without this the bot is simply deaf in a DM",
  },
  {
    capability: "answer, and post as the bot",
    lane: "bot",
    scope: "chat:write",
    why: "`chat.postMessage` / `chat.update` / `chat.delete` — the answer, its live checklist, and un-posting it",
  },
  {
    capability: "post into a public channel nobody invited it to",
    lane: "bot",
    scope: "chat:write.public",
    why: "`chat.postMessage` to a channel the bot is not a member of — unprompted posting, and the loudest grant here",
  },
  {
    capability: "attach an image to what it posts",
    lane: "bot",
    scope: "files:write",
    why: "the upload step of `slopweaver slack post --as bot --media` (there is no `--image` verb; media rides on a card)",
  },
  {
    capability: "react",
    lane: "bot",
    scope: "reactions:write",
    why: "`reactions.add` — seeds the clickable ballot chips on `slopweaver slack poll`",
  },
  {
    capability: "count a poll's votes",
    lane: "bot",
    scope: "reactions:read",
    why: "`reactions.get` — the live tally, read at the moment you ask rather than from the corpus",
  },
  {
    capability: "read the public thread it was tagged in",
    lane: "bot",
    scope: "channels:history",
    why: "`conversations.replies` — so an answer can see the thread it is answering",
  },
  {
    capability: "read the private thread it was tagged in",
    lane: "bot",
    scope: "groups:history",
    why: "`conversations.replies` in a private channel the bot was invited to",
  },
  {
    capability: "resolve the channel a message names",
    lane: "bot",
    scope: "channels:read",
    why: "`conversations.info` on a public channel",
  },
  {
    capability: "resolve a private channel it is in",
    lane: "bot",
    scope: "groups:read",
    why: "`conversations.info` on a private channel",
  },
  {
    capability: "mention people",
    lane: "bot",
    scope: "users:read",
    why: "turns a person into the `<@U…>` id a real mention needs — exact match only, never a guessed name",
  },
  {
    capability: "link the person it is talking to across tools",
    lane: "bot",
    scope: "users:read.email",
    why: "the same exact-match join key, on the bot lane",
  },
];

/**
 * What the AGENT tier adds: one bot scope, and it is the only one in this file whose adoption is permanent.
 *
 * Measured against the live app and written up in
 * `docs/slack-agent-surface/measured-rendering-and-identities.md` and
 * `docs/slack-agent-surface/manifests-and-layout.md`: the whole agent surface except two methods already runs
 * on `chat:write`. `assistant:write` buys `assistant.threads.setTitle` and
 * `assistant.threads.setSuggestedPrompts` and nothing else, so this is the shortest justified list in the
 * file rather than the tier absorbing every scope the live app happens to hold.
 */
export const AGENT_BOT_GRANTS: readonly ScopeGrant[] = [
  {
    capability: "name the agent thread your question opened, and seed it with prompts",
    lane: "bot",
    scope: "assistant:write",
    why:
      "`assistant.threads.setTitle` (what `turn answer` sends on a `turn brief --surface dm` turn) and " +
      "`assistant.threads.setSuggestedPrompts` — measured as the only two methods behind this scope",
  },
];
