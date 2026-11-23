/*
 * The configurable recording fake `SlackWriteTransport` every composite-send test file shares, and the empty
 * record it writes into. Plain arrays — no mocking framework anywhere near this, and no disk.
 */
import type { PostedMessage, SlackWriteTransport } from "../../../../../corpus/slack/writeTransport.js";
import type { SlackAssistantAnswerPayload, SlackCardPayload } from "../../../../../outbound/slack/types.js";
import { workspaceShapeRefusals } from "../../../../slackWorkspaceShapeFake.js";
import { POSTED } from "./fixtures.js";

/** What a fake transport recorded. Plain arrays — no mocking framework anywhere near this. */
interface Calls {
  readonly uploaded: string[];
  readonly posted: number[];
  readonly attached: (readonly string[])[];
  readonly dripPosted: number[];
  readonly dripAttached: (readonly string[])[];
  readonly assistantPosted: number[];
  readonly assistantAttached: (readonly string[])[];
  readonly recipeResponsePosted: number[];
  readonly recipeResponseAttached: (readonly string[])[];
  readonly readBacks: number[];
  readonly deleted: PostedMessage[];
  /** The exact payloads each post/attach was given, so the missing-media note can be asserted verbatim. */
  readonly postedPayloads: SlackCardPayload[];
  readonly attachedPayloads: SlackCardPayload[];
  readonly assistantPostedPayloads: SlackAssistantAnswerPayload[];
}

/** The transport methods the composite send never reaches. */
type OutOfScopeMethods = Pick<
  SlackWriteTransport,
  | "appendStream"
  | "correctMessage"
  | "deleteMessageOnce"
  | "postTurn"
  | "readMessage"
  | "removeReaction"
  | "setAssistantStatus"
  | "setThreadTitle"
  | "startStream"
  | "stopStream"
  | "updateCard"
  | "updateTurn"
  | "whoAmI"
>;

/** Every method the composite send never reaches, each throwing its own named message. */
function outOfScopeMethods(): OutOfScopeMethods {
  return {
    appendStream: async () => {
      throw new Error("appendStream is not part of the composite send");
    },
    deleteMessageOnce: async () => {
      throw new Error("deleteMessageOnce is not part of the composite send");
    },
    // The lifecycle methods (PR5.2) are not part of the composite send. They THROW rather than returning a
    // benign value, so a future change that starts calling one from `runCompositeSend` fails loudly here
    // instead of silently passing against a stub that quietly did nothing.
    postTurn: async () => {
      throw new Error("postTurn is not part of the composite send");
    },
    readMessage: async () => {
      throw new Error("readMessage is not part of the composite send");
    },
    removeReaction: async () => {
      throw new Error("removeReaction is not part of the composite send");
    },
    setAssistantStatus: async () => {
      throw new Error("setAssistantStatus is not part of the composite send");
    },
    setThreadTitle: async () => {
      throw new Error("setThreadTitle is not part of the composite send");
    },
    startStream: async () => {
      throw new Error("startStream is not part of the composite send");
    },
    stopStream: async () => {
      throw new Error("stopStream is not part of the composite send");
    },
    correctMessage: async () => {
      throw new Error("correctMessage is not part of the composite send");
    },
    updateCard: async () => {
      throw new Error("updateCard is not part of the composite send");
    },
    updateTurn: async () => {
      throw new Error("updateTurn is not part of the composite send");
    },
    whoAmI: async () => {
      throw new Error("whoAmI is not part of the composite send");
    },
  };
}

/** The four post methods, each counted on its own surface and throwing `post_failed` on `failPost`. */
function postMethods({
  calls,
  failPost,
}: {
  calls: Calls;
  failPost: boolean;
}): Pick<SlackWriteTransport, "postAssistantMessage" | "postCard" | "postDripMessage" | "postRecipeResponse"> {
  return {
    postAssistantMessage: async ({ payload }) => {
      calls.assistantPosted.push(1);
      calls.assistantPostedPayloads.push(payload);
      if (failPost) {
        throw new Error("post_failed");
      }
      return POSTED;
    },
    postCard: async ({ payload }) => {
      calls.posted.push(1);
      calls.postedPayloads.push(payload);
      if (failPost) {
        throw new Error("post_failed");
      }
      return POSTED;
    },
    postDripMessage: async () => {
      calls.dripPosted.push(1);
      if (failPost) {
        throw new Error("post_failed");
      }
      return POSTED;
    },
    postRecipeResponse: async () => {
      calls.recipeResponsePosted.push(1);
      if (failPost) {
        throw new Error("post_failed");
      }
      return POSTED;
    },
  };
}

/** The four attach methods (the drip lane's is `updateDripMessage`), each throwing `update_failed` on `failAttach`. */
function attachMethods({
  calls,
  failAttach,
}: {
  calls: Calls;
  failAttach: boolean;
}): Pick<
  SlackWriteTransport,
  "attachAssistantMedia" | "attachMedia" | "attachRecipeResponseMedia" | "updateDripMessage"
> {
  return {
    attachAssistantMedia: async ({ fileIds }) => {
      calls.assistantAttached.push(fileIds);
      if (failAttach) {
        throw new Error("update_failed");
      }
    },
    attachMedia: async ({ fileIds, payload }) => {
      calls.attached.push(fileIds);
      calls.attachedPayloads.push(payload);
      if (failAttach) {
        throw new Error("update_failed");
      }
    },
    attachRecipeResponseMedia: async ({ fileIds }) => {
      calls.recipeResponseAttached.push(fileIds);
      if (failAttach) {
        throw new Error("update_failed");
      }
    },
    updateDripMessage: async ({ fileIds }) => {
      calls.dripAttached.push(fileIds);
      if (failAttach) {
        throw new Error("update_failed");
      }
    },
  };
}

/** The file count a read-back reports, from the case's own answer or what the fake has recorded so far. */
function fileCountOnReadBack({
  calls,
  readBackReturns,
}: {
  calls: Calls;
  readBackReturns: number | undefined;
}): number {
  // What a read-back counts, in priority order: the case's own answer, else the files of the latest attach on
  // the card, assistant, recipe-response and drip surfaces in turn, else none.
  if (readBackReturns !== undefined) {
    return readBackReturns;
  }
  const card = calls.attached.at(-1);
  if (card !== undefined) {
    return card.length;
  }
  const assistant = calls.assistantAttached.at(-1);
  if (assistant !== undefined) {
    return assistant.length;
  }
  const recipeResponse = calls.recipeResponseAttached.at(-1);
  if (recipeResponse !== undefined) {
    return recipeResponse.length;
  }
  const drip = calls.dripAttached.at(-1);
  if (drip !== undefined) {
    return drip.length;
  }
  return 0;
}

/**
 * A configurable recording fake. Each `fail*` switch turns one step into a failure so a single
 * partial-failure branch can be exercised in isolation. Card and assistant post/attach are counted
 * SEPARATELY — `assistantPosted`/`assistantAttached` versus `posted`/`attached` — so a test can assert
 * that `runCompositeSend` never touches the assistant methods and `runAssistantCompositeSend` never
 * touches the card ones.
 *
 * @param calls the record every upload, post, attach, read-back and delete is pushed onto
 * @param failUploadAt the one filename whose upload throws `upload_failed`
 * @param readBackReturns the file count every read-back reports, overriding the latest attach
 * @returns the fake transport
 */
export function fakeTransport({
  calls,
  failUploadAt,
  failPost = false,
  failAttach = false,
  readBackReturns,
  deleteSucceeds = true,
}: {
  calls: Calls;
  failUploadAt?: string;
  failPost?: boolean;
  failAttach?: boolean;
  readBackReturns?: number;
  deleteSucceeds?: boolean;
}): SlackWriteTransport {
  return {
    ...workspaceShapeRefusals({ path: "the composite send" }),
    ...outOfScopeMethods(),
    ...postMethods({ calls, failPost }),
    ...attachMethods({ calls, failAttach }),
    addReaction: async () => true,
    conversationInfo: async () => ({ name: undefined, surface: "public-channel" as const }),
    deleteMessage: async ({ posted }) => {
      calls.deleted.push(posted);
      return deleteSucceeds;
    },
    postNoFold: async () => POSTED,
    postPoll: async () => ({ channel: "C0", ts: "1.1" }),
    readBackFileCount: async () => {
      const count = fileCountOnReadBack({ calls, readBackReturns });
      calls.readBacks.push(count);
      return count;
    },
    readReactions: async () => [],
    uploadPrivately: async ({ upload }) => {
      if (upload.filename === failUploadAt) {
        throw new Error("upload_failed");
      }
      calls.uploaded.push(upload.filename);
      return `F_${upload.filename}`;
    },
    userGroupIds: async () => new Map<string, string>(),
  };
}

/**
 * A fresh record for one case's fake transport.
 *
 * @returns every recorded surface as an empty array
 */
export function emptyCalls(): Calls {
  return {
    assistantAttached: [],
    assistantPosted: [],
    assistantPostedPayloads: [],
    attached: [],
    attachedPayloads: [],
    deleted: [],
    dripAttached: [],
    dripPosted: [],
    posted: [],
    postedPayloads: [],
    readBacks: [],
    recipeResponseAttached: [],
    recipeResponsePosted: [],
    uploaded: [],
  };
}
