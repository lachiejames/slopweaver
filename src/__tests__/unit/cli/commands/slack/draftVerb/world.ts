/**
 * The world `slopweaver slack draft` runs over in the cases: a dependency bag with no send edge at all, recording
 * every live call and every append, so a case reads what the verb observed.
 */
import { Jimp } from "jimp";

import type { SlackDraftDeps } from "../../../../../../cli/commands/slack/draftRun.js";
import type { CodexDraftAnswer } from "../../../../../../codex/slackDraftPass.js";
import { EMPTY_ORG_CHART } from "../../../../../../corpus/members/orgChartIndex.js";
import type { MemberBronzeRow } from "../../../../../../corpus/members/types.js";
import { type HisWordsError, HisWordsErrors } from "../../../../../../handover/hisWordsErrors.js";
import type { RawWords } from "../../../../../../handover/hisWordsResolve.js";
import { err, ok, type Result } from "../../../../../../lib/result.js";
import type { PullRequestLiveState } from "../../../../../../live/github/pullRequestState.js";
import { type AskedBeforeError, AskedBeforeErrors } from "../../../../../../outbound/slack/askedBeforeErrors.js";
import type { ConversationMembership } from "../../../../../../outbound/slack/dmMembership.js";
import type { SteerReceipt } from "../../../../../../outbound/slack/draftCorrections.js";
import type { SlackDraftError } from "../../../../../../outbound/slack/draftErrors.js";
import { type SlackDraftEvent, slackDraftEventLine } from "../../../../../../outbound/slack/draftRegister.js";
import type { BotMembership } from "../../../../../../outbound/slack/findingIdentity.js";
import type { MentionResolution } from "../../../../../../outbound/slack/mentionIndex.js";
import type { PriorRead } from "../../../../../../outbound/slack/priorAsk.js";
import type { ConversationSurface } from "../../../../../../outbound/slack/types.js";
import type { ExactVoiceRule } from "../../../../../../outbound/voice/exactRules.js";
import type { ResolvedImageEvidence } from "../../../../../../visualEvidence/admission.js";
import type { ImageAdmissionError } from "../../../../../../visualEvidence/errors.js";
import { imageDigestOf } from "../../../../../../visualEvidence/imageIo.js";
import type { ImageRecord } from "../../../../../../visualEvidence/types.js";
import { annotatedRecord } from "../../../../../annotatedShotFixture.js";
import { memoryDoorLedger } from "../../../../../doorLedgerFixture.js";
import { PROMPT_DM, PROMPT_DM_IS_OWNERS } from "../ownDmFakes.js";
import { CONFIG, OWNER_ROW, RESOLUTION } from "./fixtures.js";

/** Three distinct picture colours, one per leading digit of a `--media` path, so the finding floor counts three. */
const COLOURS = [0xff0000ff, 0x00ff00ff, 0x0000ffff];

/** The leading bytes the fake admission reads for each extension a case attaches. */
const SIGNATURE_BY_EXTENSION: Readonly<Record<string, Buffer>> = {
  mp4: Buffer.from([0, 0, 0, 0x10, ...Buffer.from("ftypisom"), 0, 0, 0, 0]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

/** Everything one run of the verb observed: what it printed, and what it appended. */
export interface Recording {
  readonly appended: SlackDraftEvent[];
  readonly lines: string[];
  readonly calls: string[];
}

/** What a case may seed into the world; every field but `recording` has a default in the seam group that reads it. */
interface WorldOptions {
  admission?: ImageAdmissionError;
  /** What the sealed Codex pass answers beside a recorded row; no seat unless a case seeds a draft. */
  codex?: CodexDraftAnswer;
  /** Whether the bot is in the channel, as its own token would read it. */
  botMembership?: BotMembership;
  /** What `context`'s live read of the draft's conversation answers. */
  conversation?: Result<
    { readonly rows: readonly unknown[]; readonly hasMore: boolean; readonly workspaceUrl: string },
    SlackDraftError
  >;
  /** The other member of a 1:1 DM, as `conversations.info` names one. */
  dmUser?: string;
  /** Whether `conversations.info` answers `is_mpim`, a group DM; not one unless a case says so. */
  groupDm?: true;
  /** What the owner's words at a `--approved` anchor read as; missing unless a case seeds them. */
  hisWords?: Result<RawWords, HisWordsError>;
  /** Admit each `--media` path as a distinct real PNG chosen by its leading digit, so the finding floor counts it. */
  image?: boolean;
  log?: string;
  /** Member bronze, as the roster reads it. */
  members?: readonly MemberBronzeRow[];
  /** Who is in the conversation, as the membership read answers; a channel nobody is in by default. */
  membership?: ConversationMembership;
  /** Whether the bot-token read proves the prompt channel the owner's own bot DM; proven unless a case says not. */
  ownDm?: SlackDraftDeps["verifiedOwnDm"];
  /** What the live read of an `--asked-before` permalink answers; unreadable unless a case seeds one. */
  priorRead?: Result<PriorRead, AskedBeforeError>;
  /** What the live read of every pull request a bump links answers; open unless a case says otherwise. */
  pullRequestState?: PullRequestLiveState;
  /** The relay receipts `corrections` joins to draft cards. */
  receipts?: readonly SteerReceipt[];
  /** The image records admission resolves for each picture, built from its digest; one annotated pass by default. */
  records?: (args: { digest: string }) => readonly ImageRecord[];
  recording: Recording;
  /** What mention resolution answers for the form. */
  resolution?: MentionResolution;
  replies?: readonly unknown[];
  stdin?: string;
  storage?: SlackDraftError;
  /** The conversation's kind, as `conversations.info` would read it. */
  surface?: ConversationSurface;
  /** The owner's exact voice rules, as the profile would answer them. */
  voiceRules?: readonly ExactVoiceRule[];
}

/** The colour of the picture a path is admitted as: its leading digit's, else the first — a named file like `control.png`. */
function colourOf({ path }: { path: string }): number {
  const digit = Number(path.slice(0, 1));
  return COLOURS[Number.isInteger(digit) ? digit : 0]!;
}

/** What admission resolves for one picture it read: its digest and the records filed under it. */
function evidenceOf({
  bytes,
  filename,
  records,
  size,
}: {
  bytes: Uint8Array;
  filename: string;
  records: (args: { digest: string }) => readonly ImageRecord[];
  size: number;
}): ResolvedImageEvidence {
  const digest = imageDigestOf({ bytes });
  return {
    artifact: { digest, heightPx: size, widthPx: size },
    records: records({ digest }).map((record) => ({ ...record, artifact: { digest, heightPx: size, widthPx: size } })),
    ref: { artifactDigest: digest, path: filename },
  };
}

/** The seams no case varies, bar the Codex answer: identity, chrome, clocks, the register's own append and lock. */
function fixedSeams({
  codex: codexAnswer = { kind: "unavailable", reason: "no Codex seat in this world" },
  recording,
}: WorldOptions) {
  return {
    appendEvent: ({ event }) => {
      recording.appended.push(event);
      return ok(true);
    },
    approvedScheduledChannels: () => [],
    lockRegister: () => ok(() => undefined),
    bareRefContext: () => ({ repos: [] }),
    codexDraft: async () => codexAnswer,
    botToken: () => "xoxb-test",
    chrome: () => ({
      authorEmoji: ":robot_face:",
      authorLabel: "test-bot",
      bannerColor: "#12B5A6",
      detailLabel: "*Details*",
      metadataEventType: "test_card_v1",
    }),
    consoleBase: () => "http://localhost:3000",
    taggedAccount: async () => ({ deleted: false, kind: "read", name: undefined }),
    doorEnv: () => ({}),
    doorLedger: memoryDoorLedger().port,
    dripConfig: () => ok(CONFIG),
    loadOrgChart: () => ({ chart: EMPTY_ORG_CHART, warnings: [] }),
    mintId: () => "sd-deadbeef",
    nowIso: () => "2026-09-23T01:02:03.000Z",
    out: (line) => {
      recording.lines.push(line);
    },
    ownerUserId: () => "U0OWNER",
    promptChannel: () => PROMPT_DM,
    recordVoicePainPoints: () => {},
    highStakes: () => ok({ channels: [], fleetGap: undefined, fleetUserIds: [], listGap: undefined }),
    threadAnchor: async () => ({ kind: "present" as const }),
    channelClaim: () => ({ kind: "free" as const }),
    releaseChannelClaim: () => undefined,
    userToken: () => "xoxp-test",
    wallRun: async () => ok({ length: 0 }),
  } satisfies Partial<SlackDraftDeps>;
}

/** The seams that read who and where: the conversation's kind and members, the roster, mentions and the thread. */
function conversationSeams({
  botMembership = "member",
  dmUser,
  groupDm,
  members = [OWNER_ROW],
  membership = { directMessage: false, kind: "read", members: new Set() },
  ownDm = PROMPT_DM_IS_OWNERS,
  recording,
  replies = [],
  resolution = RESOLUTION,
  surface = "private-channel",
}: WorldOptions) {
  return {
    botMembership: async ({ token }) => {
      recording.calls.push(`botMembership:${token}`);
      return botMembership;
    },
    conversationInfo: async () => {
      recording.calls.push("conversationInfo");
      return { ...(groupDm === true ? { groupDm } : {}), name: "iso-27001", surface, user: dmUser };
    },
    conversationSurface: async () => {
      recording.calls.push("conversationSurface");
      return surface;
    },
    conversationMembership: async () => membership,
    loadMembers: () => {
      recording.calls.push("loadMembers");
      return { rows: members, warnings: [] };
    },
    verifiedOwnDm: ownDm,
    resolveMentions: async () => ok(resolution),
    // `conversations.replies` answers the ROOT first, whichever message of the thread its ts names.
    threadReplies: async ({ threadTs }) => {
      recording.calls.push(`threadReplies:${threadTs}`);
      return ok(replies);
    },
    fleetHistory: async () => {
      recording.calls.push("fleetHistory");
      return { kind: "read", priors: [] };
    },
    whoAmI: async () => {
      recording.calls.push("whoAmI");
      return { userId: "U0SYNADAOWN" };
    },
  } satisfies Partial<SlackDraftDeps>;
}

/** The seams that read what a case seeded: the conversation, the owner's words, the register, an earlier ask, stdin, voice. */
function readSeams({
  conversation = ok({ hasMore: false, rows: [], workspaceUrl: "https://acme.slack.com/" }),
  hisWords = err(HisWordsErrors.recordMissing({ anchor: "unseeded", what: "no words seeded" })),
  log = "",
  priorRead = err(AskedBeforeErrors.priorUnreadable({ cause: "no earlier ask seeded", permalink: "unseeded" })),
  pullRequestState = { kind: "open" },
  receipts = [],
  recording,
  stdin = "",
  voiceRules = [],
}: WorldOptions) {
  return {
    loadVoiceBrief: () => ok({ paragraphSpacing: false, rules: voiceRules, shape: null }),
    // The store splits the file for real; this fake splits the seeded text the same way, so a case seeds
    // one string and the runner sees the lines it would see off disk.
    readConversation: async ({ channel, limit, threadTs, through, token }) => {
      recording.calls.push(`readConversation:${channel}:${String(threadTs)}:${String(limit)}:${token}`);
      // Only a read ending at a recording's watermark names it, so every read to now keeps its one call line.
      if (through !== undefined) {
        recording.calls.push(`through:${through}`);
      }
      return conversation;
    },
    fenceCallWrites: () => ok({ recheck: () => undefined, release: () => undefined }),
    readApprovalLaterRelays: ({ anchor }) => {
      recording.calls.push(`readApprovalLaterRelays:${anchor.anchor}`);
      return ok([]);
    },
    readOwnerWords: ({ anchor }) => {
      recording.calls.push(`readOwnerWords:${anchor}`);
      return hisWords;
    },
    readLandedDrafts: () => ({ bindings: { bound: [], unreadable: [] }, kind: "read", ledgerRows: 0, vanished: [] }),
    // An append is read back by the next read, as the register file would be.
    readLog: () => [...log.split("\n"), ...recording.appended.map((event) => slackDraftEventLine({ event }))],
    readPriorAsk: async ({ permalink, token }) => {
      recording.calls.push(`readPriorAsk:${permalink}:${token}`);
      return priorRead;
    },
    pullRequestState: async ({ number, repo }) => {
      recording.calls.push(`pullRequestState:${repo}#${String(number)}`);
      return pullRequestState;
    },
    readSteerReceipts: () => ok({ rows: receipts, undecoded: 0 }),
    readStdin: async () => stdin,
    readVoiceRules: () => ok(voiceRules),
  } satisfies Partial<SlackDraftDeps>;
}

/** The two media seams: admission, which reads and judges every path, and the store that keeps what it admitted. */
function mediaSeams({
  admission,
  image = false,
  records = ({ digest }) => [annotatedRecord({ digest })],
  recording,
  storage,
}: WorldOptions) {
  return {
    // Admission reads every path and judges the WHOLE batch before anything is stored; the fake answers the
    // bytes each path would read as — its extension's signature, then its own path — so a case can assert the
    // store saw exactly those and the card-fidelity check reads a picture as one.
    prepareMedia: async ({ paths }) => {
      recording.calls.push(`prepareMedia:${paths.join(",")}`);
      if (admission !== undefined) {
        return err(admission);
      }
      if (image) {
        const pngs = await Promise.all(
          paths.map(async (path) => ({
            bytes: new Uint8Array(
              await new Jimp({ color: colourOf({ path }), height: 8, width: 8 }).getBuffer("image/png"),
            ),
            filename: path,
          })),
        );
        // One evidence entry per picture, as real admission resolves each image it reads.
        const evidence = pngs.map((png) => evidenceOf({ bytes: png.bytes, filename: png.filename, records, size: 8 }));
        return ok({ evidence, exceptionOpened: false, uploads: pngs });
      }
      const uploads = paths.map((path) => ({
        bytes: Buffer.concat([SIGNATURE_BY_EXTENSION[path.split(".").at(-1)!]!, Buffer.from(`bytes of ${path}`)]),
        filename: path.split("/").at(-1)!,
      }));
      // A `.png` is a picture admission resolved records for; the video is carried with none, as real admission does.
      const evidence = uploads
        .filter((upload) => upload.filename.endsWith(".png"))
        .map((upload) => evidenceOf({ bytes: upload.bytes, filename: upload.filename, records, size: 2 }));
      return ok({ evidence, exceptionOpened: false, uploads });
    },
    storeMedia: ({ uploads }): Result<readonly { bytes: number; name: string; sha256: string }[], SlackDraftError> => {
      recording.calls.push(`storeMedia:${uploads.map((upload) => upload.filename).join(",")}`);
      if (storage !== undefined) {
        return err(storage);
      }
      return ok(
        uploads.map((upload, index) => ({
          bytes: upload.bytes.length,
          name: upload.filename,
          sha256: String(index).repeat(64),
        })),
      );
    },
  } satisfies Partial<SlackDraftDeps>;
}

/**
 * A world with no send edge, recording every live call and every append.
 *
 * `log` seeds the register, so a list/show/drop case reads a register a previous record could have written
 * without either case depending on the other having run.
 *
 * @returns the dependency bag the verb runs over
 */
export function draftDeps(options: WorldOptions): SlackDraftDeps {
  return {
    ...fixedSeams(options),
    ...conversationSeams(options),
    ...readSeams(options),
    ...mediaSeams(options),
  };
}

/**
 * A fresh, empty {@link Recording} for one case.
 *
 * @returns the recording
 */
export function freshRecording(): Recording {
  return { appended: [], calls: [], lines: [] };
}

/**
 * The argv a verb sees: `[node, cli, slack, draft, …]`.
 *
 * @returns the full argument vector
 */
export function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "cli", "slack", "draft", ...tail];
}
