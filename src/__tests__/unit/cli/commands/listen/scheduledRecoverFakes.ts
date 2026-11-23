/**
 * The fakes every `listen recover --scheduled` test file shares — the clock, the asker's whitelist, the
 * channel-lane read seam, the write transport and the base options — so a case can live in the file its
 * behaviour belongs to without copying the transport.
 */
import type { ScheduledIncidentDetect } from "../../../../../cli/commands/listen/scheduledScan.js";
import type { SlackApi } from "../../../../../corpus/slack/fetch.js";
import type { SlackWriteTransport } from "../../../../../corpus/slack/writeTransport.js";
import { ok } from "../../../../../lib/result.js";
import type { ResponderWhitelist } from "../../../../../live/listen/whitelist.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { workspaceShapeRefusals } from "../../../../slackWorkspaceShapeFake.js";

export const NOW_MS = Date.parse("2026-08-13T12:00:00.000Z");
export const BOT = "U_BOT";
export const OPEN_WHITELIST: ResponderWhitelist = { identities: ["U_ASKER"], kind: "list" };
export const CLOSED_WHITELIST: ResponderWhitelist = { kind: "absent" };
const POSTED = { channel: "C1", ts: "1786400000.000900" };

/**
 * The channel-lane seam every fake here shares: C1 in the channel lane, nothing in the group-DM lane.
 * Discovery walks the two lanes separately, so a lane-blind fake would return C1 twice and sweep it twice.
 *
 * @returns C1 for the channel lane, no channel for the group-DM lane
 */
export const listOnlyC1: Pick<SlackApi, "listChannels">["listChannels"] = async ({ lane }) =>
  lane === "group-dms" ? { channels: [] } : { channels: [{ id: "C1", is_member: true }] };

/**
 * Every method the capture/refusal path touches works; everything else throws so a stray call fails loudly.
 *
 * @param calls receives the name of each capture/refusal method called, in order
 * @returns the write transport
 */
export function fakeTransport({ calls }: { calls: string[] }): SlackWriteTransport {
  const unused =
    ({ method }: { method: string }) =>
    async (): Promise<never> => {
      throw new Error(`${method} is not part of scheduled recovery's capture/refusal path`);
    };
  return {
    ...workspaceShapeRefusals({ path: "the scheduled-recover path" }),
    addReaction: async () => {
      calls.push("addReaction");
      return true;
    },
    appendStream: unused({ method: "appendStream" }),
    attachAssistantMedia: unused({ method: "attachAssistantMedia" }),
    attachMedia: unused({ method: "attachMedia" }),
    attachRecipeResponseMedia: unused({ method: "attachRecipeResponseMedia" }),
    conversationInfo: async () => ({ name: undefined, surface: "public-channel" as const }),
    deleteMessage: unused({ method: "deleteMessage" }),
    deleteMessageOnce: unused({ method: "deleteMessageOnce" }),
    postAssistantMessage: unused({ method: "postAssistantMessage" }),
    postCard: unused({ method: "postCard" }),
    postDripMessage: async () => {
      calls.push("postDripMessage");
      return POSTED;
    },
    postNoFold: unused({ method: "postNoFold" }),
    postPoll: unused({ method: "postPoll" }),
    postRecipeResponse: unused({ method: "postRecipeResponse" }),
    postTurn: async () => {
      calls.push("postTurn");
      return POSTED;
    },
    readBackFileCount: unused({ method: "readBackFileCount" }),
    readMessage: unused({ method: "readMessage" }),
    readReactions: async () => [],
    removeReaction: async () => true,
    setAssistantStatus: async () => {
      calls.push("setAssistantStatus");
      return ok(undefined);
    },
    setThreadTitle: async () => ok(undefined),
    startStream: unused({ method: "startStream" }),
    stopStream: unused({ method: "stopStream" }),
    updateCard: unused({ method: "updateCard" }),
    correctMessage: unused({ method: "correctMessage" }),
    updateDripMessage: unused({ method: "updateDripMessage" }),
    updateTurn: async () => {
      calls.push("updateTurn");
    },
    uploadPrivately: unused({ method: "uploadPrivately" }),
    userGroupIds: async () => new Map<string, string>(),
    whoAmI: async () => ({}),
  };
}

export const BASE_OPTIONS = {
  botUserId: BOT,
  channels: ["C1"],
  deadlineMs: undefined,
  // An in-memory port: the door records are not what these cases assert, but they must be writable.
  doorLedger: memoryDoorLedger().port,
  incidents: async (): ReturnType<ScheduledIncidentDetect> => ({ registered: [], skipped: [] }),
  nowMs: (): number => NOW_MS,
  responderHatchOpen: (): boolean => false,
  responderWhitelist: (): ResponderWhitelist => OPEN_WHITELIST,
  selfBotId: undefined,
  sinceExplicit: false,
  sinceIso: "2026-08-10T00:00:00.000Z",
  supervisor: undefined,
};
