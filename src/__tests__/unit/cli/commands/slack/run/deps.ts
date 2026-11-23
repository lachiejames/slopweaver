/*
 * The full fake `SlackWriteDeps` the `--as bot` card-lane tests of `runSlackWrite` run against. The seams no option
 * reaches answer from one fixed object; `deps()` resolves the caller's options and lays the per-call seams over it.
 */
import type { DoorLedgerPort } from "../../../../../../admit/doorLedgerPort.js";
import type { SlackWriteDeps } from "../../../../../../cli/commands/slack/run.js";
import { ok } from "../../../../../../lib/result.js";
import type { MentionResolution } from "../../../../../../outbound/slack/mentionIndex.js";
import { memoryAutonomyLedgerPort } from "../../../../../autonomyLedgerFixture.js";
import { memoryDoorLedger } from "../../../../../doorLedgerFixture.js";
import { CHROME, FORM, type Recorder } from "./harness.js";

/** A resolution over a fake roster: everyone resolves except `ghost`. */
function fakeResolution({ people }: { people: readonly string[] }): MentionResolution {
  return {
    groupAddresses: new Map(),
    heldRequested: people.filter((person) => person === "held-person"),
    memberLookups: new Map(),
    resolved: new Map(
      people
        .filter((person) => person !== "ghost" && person !== "held-person")
        .map((person) => [person, { origin: "derived" as const, slackId: "U000TEST" }]),
    ),
    roster: {
      addressableKeys: 3,
      collisions: [],
      derivedPeople: 2,
      freshness: { kind: "fresh" },
      heldPeople: 1,
    },
  };
}

/** Every seam no option reaches: each answers the same, stateless way for every case. */
const FIXED_SEAMS = {
  threadAnchor: async () => ({ kind: "present" as const }),
  channelClaim: () => ({ kind: "free" as const }),
  releaseChannelClaim: () => undefined,
  bareRefContext: () => ({ repos: [] }),
  conversationGroupDm: async () => undefined,
  // A channel nobody is in, so neither the in-conversation rescue nor the DM hold fires on a fixture written for
  // something else.
  conversationMembership: async () => ({ directMessage: false, kind: "read", members: new Set() }),
  taggedAccount: async () => ({ deleted: false, kind: "read", name: undefined }),
  botMembership: async () => "member",
  chrome: () => CHROME,
  doorEnv: () => ({}),
  dripConfig: () =>
    ok({
      exactVoiceRules: [],
      paragraphSpacing: false,
      intervalMs: 0,
      maxMessages: 8,
      messageVisibleMax: 300,
      soleMessageVisibleMax: 1000,
      cardVisibleMax: 1000,
      maxBullets: 10,
      maxLines: 8,
    }),
  readMedia: async ({ path }) => ({ bytes: new Uint8Array([1, 2, 3]), filename: path }),
  readStdin: async () => FORM,
  recordVoicePainPoints: () => undefined,
  resolveMentions: async ({ people }) => ok(fakeResolution({ people })),
  // The card lane never reaches this; `homes` stays the BOT resolver's record so its assertion is exact.
  userToken: () => undefined,
  // The card lane never releases a parked draft, so these only have to exist for the type.
  readDraftLog: () => [],
  readDraftMedia: () => ok([]),
  appendDraftEvent: () => {
    throw new Error("the card lane never writes the draft register");
  },
  readReleaseConversation: async () => ok([]),
  readPriorAsk: async () => {
    throw new Error("no row here declares an earlier ask");
  },
  whoAmI: async () => ({ userId: "U0BOT" }),
  channelAccess: async () => {
    throw new Error("the card lane never releases a parked draft, so it never reads membership");
  },
  joinChannel: async () => {
    throw new Error("the card lane never joins a channel");
  },
} satisfies Partial<SlackWriteDeps>;

/** What a case may override in the fake world; every field it omits takes the default `deps()` names. */
interface DepsOptions {
  rec: Recorder;
  /** The door ledger every decision is recorded through; a fresh in-memory one unless a case reads it back. */
  door?: { readonly port: DoorLedgerPort };
  token?: string | null;
  /** Records every home the token resolver was asked about, proving `--home` reaches it. */
  homes?: string[];
  /** Every line written to stdout, so `--json` can be asserted byte-for-byte. */
  out?: string[];
  wallRun?: SlackWriteDeps["wallRun"];
  conversationSurface?: SlackWriteDeps["conversationSurface"];
  proveRender?: SlackWriteDeps["proveRender"];
  /** What `slackBot.promptChannel` resolves to; `undefined` is an install that has configured none. */
  promptChannel?: string | undefined;
  /** Whether a bot-token read proved the destination the owner's own DM. */
  ownDm?: SlackWriteDeps["verifiedOwnDm"];
  /** Every channel a recipe row records the owner's approval for — empty is the ordinary DM-only install. */
  approvedScheduledChannels?: readonly string[];
  /** What `slackBot.ownerUserId` resolves to; `null` is an install that has configured none. */
  ownerUserId?: string | null;
  /** The operator's voice rules as the card lane reads them, or why the profile holding them cannot be trusted. */
  voiceRules?: ReturnType<SlackWriteDeps["voiceRules"]>;
  /** The high-stakes channel list as the profile reads it; none by default, so the gate never fires unasked. */
  highStakes?: ReturnType<SlackWriteDeps["highStakes"]>;
  fleetHistory?: SlackWriteDeps["fleetHistory"];
}

/**
 * The full fake world one `runSlackWrite` call runs against. `token: null` means "no token configured". It is NOT
 * `undefined`, because a JS default parameter treats `undefined` as absent and would silently hand back the valid
 * default — which is exactly how the missing-token test passed while actually exercising the happy path.
 *
 * @param rec the recording write api every send goes through.
 * @returns every seam `runSlackWrite` reads, the overridden ones answering as the case asked.
 */
export function deps({
  rec,
  token = "xoxb-test",
  homes = [],
  out = [],
  wallRun = async () => ok({ length: 0 }),
  conversationSurface = async () => "private-channel" as const,
  proveRender = async () => ({ issues: [], kind: "checked" as const }),
  promptChannel = "D0PROMPT",
  // The bot-token read proves the configured prompt channel the owner's own DM; a colleague's case passes its own.
  ownDm = async ({ channel }) => (channel === promptChannel ? channel : undefined),
  ownerUserId = "U0OWNER",
  approvedScheduledChannels = [],
  voiceRules = ok([]),
  highStakes = ok({ channels: [], fleetGap: undefined, fleetUserIds: [], listGap: undefined }),
  fleetHistory = async () => ({ kind: "read" as const, priors: [] }),
  door = memoryDoorLedger(),
}: DepsOptions): SlackWriteDeps {
  return {
    ...FIXED_SEAMS,
    autonomy: memoryAutonomyLedgerPort(),
    doorLedger: door.port,
    highStakes: () => highStakes,
    fleetHistory,
    approvedScheduledChannels: () => approvedScheduledChannels,
    promptChannel: () => promptChannel,
    verifiedOwnDm: ownDm,
    ownerUserId: () => ownerUserId,
    // A PRIVATE channel by default, so the one-card gate never fires on a fixture that was written to test
    // something else. The public case has its own tests, which pass this explicitly.
    proveRender,
    conversationSurface,
    botToken: ({ home }) => {
      homes.push(home);
      if (token === null) {
        return undefined;
      }
      return token;
    },
    voiceRules: () => voiceRules,
    makeApi: () => rec.api,
    out: (line) => {
      out.push(line);
    },
    wallRun,
  };
}
