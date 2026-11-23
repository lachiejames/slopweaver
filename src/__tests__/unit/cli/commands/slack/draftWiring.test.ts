/*
 * The production wiring, checked for what it does NOT carry.
 *
 * `slack draft record` is safe because the bag it runs against has no way to put bytes into Slack — no
 * `makeApi`, no `proveRender`, no `readMedia`. The compiler already says so through `SlackDraftDeps`, but a
 * type is only as good as the next edit to it, so the key list is asserted here: adding a send edge to this
 * verb has to redden this file, in a diff that says what it is doing. `--media` added exactly two, an
 * admission read and a private store write, and neither can post. `--as bot` added the bot token, a membership
 * read, the card chrome and the four profile reads the card admission asks — reads, every one. `context` added
 * `readConversation`, a thread's replies or one history page: a read too. `taggedAccount` is one `users.info` per
 * person the draft tags, so a departed colleague is refused before the card is cut: a read. `pullRequestState` is
 * one GitHub GraphQL read per pull request a bump or review ask links, so a chase on a closed one is refused: a read.
 */

import { describe, expect, it } from "vitest";

import { liveSlackDraftDeps } from "../../../../../cli/commands/slack/draftWiring.js";

/** The environment variable that moves the console origin, read at call time by `consoleBase`. */
const CONSOLE_URL_ENV = "SLOPWEAVER_CONSOLE_URL";

/** Put the variable back exactly as it was found, absence included, so one case cannot leak into the next. */
function restoreConsoleUrl({ before }: { before: string | undefined }): void {
  delete process.env[CONSOLE_URL_ENV];
  if (before !== undefined) {
    process.env[CONSOLE_URL_ENV] = before;
  }
}

describe("liveSlackDraftDeps", () => {
  it("wires no edge that could post, and every edge the record path needs", () => {
    const keys = Object.keys(liveSlackDraftDeps()).toSorted();
    expect(keys.filter((key) => ["makeApi", "proveRender", "readMedia", "send"].includes(key))).toEqual([]);
    expect(keys).toEqual([
      "appendEvent",
      "approvedScheduledChannels",
      "bareRefContext",
      "botMembership",
      "botToken",
      "channelClaim",
      "chrome",
      "codexDraft",
      "consoleBase",
      "conversationInfo",
      "conversationMembership",
      "conversationSurface",
      "doorEnv",
      "doorLedger",
      "dripConfig",
      "fenceCallWrites",
      "fleetHistory",
      "highStakes",
      "loadMembers",
      "loadOrgChart",
      "loadVoiceBrief",
      "lockRegister",
      "mintId",
      "nowIso",
      "out",
      "ownerUserId",
      "prepareMedia",
      "promptChannel",
      "pullRequestState",
      "readApprovalLaterRelays",
      "readConversation",
      "readLandedDrafts",
      "readLog",
      "readOwnerWords",
      "readPriorAsk",
      "readStdin",
      "readSteerReceipts",
      "readVoiceRules",
      "recordVoicePainPoints",
      "releaseChannelClaim",
      "resolveMentions",
      "storeMedia",
      "taggedAccount",
      "threadAnchor",
      "threadReplies",
      "userToken",
      "verifiedOwnDm",
      "wallRun",
      "whoAmI",
    ]);
  });

  it("points a parked draft's report at the console port `yarn console` binds", () => {
    const before = process.env[CONSOLE_URL_ENV];
    delete process.env[CONSOLE_URL_ENV];
    expect(liveSlackDraftDeps().consoleBase()).toBe("http://localhost:3000");
    restoreConsoleUrl({ before });
  });

  it("takes an overridden origin without its trailing slash, so the deep link has one separator", () => {
    const before = process.env[CONSOLE_URL_ENV];
    process.env[CONSOLE_URL_ENV] = "http://localhost:3100/";
    expect(liveSlackDraftDeps().consoleBase()).toBe("http://localhost:3100");
    process.env[CONSOLE_URL_ENV] = "   ";
    expect(liveSlackDraftDeps().consoleBase()).toBe("http://localhost:3000");
    restoreConsoleUrl({ before });
  });

  it("mints an id a reader can retype, prefixed apart from a withheld reply's", () => {
    expect(liveSlackDraftDeps().mintId()).toMatch(/^sd-[0-9a-f]{8}$/);
  });
});
