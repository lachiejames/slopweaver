/*
 * Plain fakes for the per-kind `slack edit --as bot` tests (checklist, poll, refused targets): a transport that
 * answers one read-back and records every update, and a dependency bag whose unlisted members throw. Neither is a
 * mock — each is a hand-written stand-in passed in through the seam the verb already takes.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EditCardOptions } from "../../../../../cli/commands/slack/lifecycleCore.js";
import type { LifecycleDeps } from "../../../../../cli/commands/slack/lifecycleRunTypes.js";
import type { PostedMessage, SlackWriteTransport } from "../../../../../corpus/slack/writeTransport.js";
import { ok } from "../../../../../lib/result.js";
import type { ReadSlackMessage, SlackSelfIdentity } from "../../../../../outbound/slack/lifecycleGuards.js";
import type { ConversationSurface } from "../../../../../outbound/slack/types.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

/** Who the bot token is: the poster of every fixture message below. */
const SELF: SlackSelfIdentity = { botId: "B_SELF", teamId: "T1", userId: "U_SELF" };

/** The card event type the fake profile configures. */
export const TEST_CARD_TYPE = "test_card_v1";
/** The progress event type the fake profile configures. */
export const TEST_PROGRESS_TYPE = "test_progress_v1";
/** The poll event type the fake profile configures. */
export const TEST_POLL_TYPE = "test_poll_v1";

/** One update the transport received, by method. */
export interface RecordedUpdate {
  readonly method: "updateTurn" | "updateCard";
  readonly posted: PostedMessage;
  readonly payload: unknown;
}

/**
 * A transport answering one read-back and recording every update; any other method throws by name.
 *
 * @param message the one message a read at its own ts returns
 * @param updates where each update is recorded
 * @param surface what `conversationInfo` answers about the channel
 * @param updateFails an error `updateCard` throws, standing in for Slack refusing the update
 * @returns the transport
 */
export function editTransport({
  message,
  updates,
  surface = "public-channel",
  updateFails,
}: {
  message: ReadSlackMessage;
  updates: RecordedUpdate[];
  surface?: ConversationSurface | undefined;
  updateFails?: Error;
}): SlackWriteTransport {
  const real: Partial<SlackWriteTransport> = {
    conversationInfo: async () => ({ name: "proj-x", surface }),
    readMessage: async ({ posted }) => (posted.ts === message.ts ? message : undefined),
    updateCard: async ({ payload, posted }) => {
      if (updateFails !== undefined) {
        throw updateFails;
      }
      updates.push({ method: "updateCard", payload, posted });
    },
    updateTurn: async ({ payload, posted }) => {
      updates.push({ method: "updateTurn", payload, posted });
    },
    userGroupIds: async () => new Map<string, string>(),
    whoAmI: async () => SELF,
  };
  const guarded = new Proxy(real, {
    get: (target, property) =>
      Reflect.has(target, property)
        ? Reflect.get(target, property)
        : () => {
            throw new Error(`slack edit touched transport method \`${String(property)}\` it should not need`);
          },
  });
  // `as`: the Proxy answers every member the edit paths read and throws, by name, on any other.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return guarded as SlackWriteTransport;
}

/**
 * Every dependency a per-kind bot edit reads, over the given transport; any other member throws by name.
 *
 * @param transport the transport `makeTransport` hands back
 * @param out where printed lines land
 * @param stdin the form text `readStdin` answers, for a case driving the whole `runEdit` dispatch
 * @param cardEventType the card type the profile configures, for a case that collides it with another kind's
 * @returns the dependency bag
 */
export function editDeps({
  transport,
  out,
  stdin,
  cardEventType = TEST_CARD_TYPE,
}: {
  transport: SlackWriteTransport;
  out: string[];
  stdin?: string;
  cardEventType?: string;
}): LifecycleDeps {
  const real: Partial<LifecycleDeps> = {
    ...(stdin === undefined ? {} : { readStdin: async () => stdin }),
    // The card path's form admission reads these two before any Slack call.
    bareRefContext: () => ({ linearTeamKeys: [], repos: [] }),
    resolveMentions: async () =>
      ok({
        groupAddresses: new Map(),
        heldRequested: [],
        memberLookups: new Map(),
        resolved: new Map(),
        roster: { addressableKeys: 0, collisions: [], derivedPeople: 0, freshness: { kind: "fresh" }, heldPeople: 0 },
      }),
    botToken: () => "xoxb-fake",
    cardChrome: () => ({
      authorEmoji: ":robot_face:",
      authorLabel: "test-bot",
      bannerColor: "#12B5A6",
      detailLabel: "*Details*",
      metadataEventType: cardEventType,
    }),
    cardNames: () => () => ({}),
    doorEnv: () => ({}),
    doorLedger: memoryDoorLedger().port,
    highStakes: () => ok({ channels: [], fleetGap: undefined, fleetUserIds: [], listGap: undefined }),
    makeTransport: () => transport,
    nowIso: () => "2026-11-06T00:00:00.000Z",
    nowMs: () => Date.parse("2026-11-06T00:00:00.000Z"),
    out: (line) => {
      out.push(line);
    },
    pollEventType: () => TEST_POLL_TYPE,
    standaloneProgressEventType: () => TEST_PROGRESS_TYPE,
    verifiedOwnDm: async () => undefined,
    voiceRules: () => ok([]),
  };
  const guarded = new Proxy(real, {
    get: (target, property) =>
      Reflect.has(target, property)
        ? Reflect.get(target, property)
        : () => {
            throw new Error(`slack edit touched dependency \`${String(property)}\` it should not need`);
          },
  });
  // `as`: the Proxy answers every member the edit paths read and throws, by name, on any other.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return guarded as LifecycleDeps;
}

/**
 * A bot-lane edit invocation over one message.
 *
 * @param home the throwaway home
 * @param ts the target message's ts
 * @param dryRun whether the edit stops before the door
 * @returns the parsed options
 */
export function editOptions({
  home,
  ts,
  dryRun = false,
}: {
  home: string;
  ts: string;
  dryRun?: boolean;
}): EditCardOptions {
  return {
    actor: "bot",
    allowUnresolvedOwner: false,
    channel: "C0EDIT",
    dryRun,
    formJson: "-",
    home,
    json: false,
    kind: "edit",
    ts,
  };
}

/**
 * A message this bot posted, of one event type and renderer.
 *
 * @param eventType the `metadata.event_type` it carries
 * @param renderer the renderer it names
 * @param extra any further read-back fields, such as an inherited turnId or pollId
 * @returns the read-back
 */
export function ownMessage({
  eventType,
  renderer,
  ts,
  extra = {},
}: {
  eventType: string;
  renderer: string;
  ts: string;
  extra?: Partial<ReadSlackMessage>;
}): ReadSlackMessage {
  return { botId: "B_SELF", fileIds: [], metadataEventType: eventType, renderer, ts, userId: "U_SELF", ...extra };
}

/**
 * Mint one throwaway home, registering it so the calling test file's `afterEach` removes it.
 *
 * @param dirs the caller's own list of minted homes, which its `afterEach` empties
 * @returns the new home
 */
export function freshHome({ dirs }: { dirs: string[] }): string {
  const dir = mkdtempSync(join(tmpdir(), "edit-kind-"));
  dirs.push(dir);
  return dir;
}
