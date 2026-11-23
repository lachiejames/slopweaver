import { describe, expect, it } from "vitest";

import { guardTypedRuns } from "../../../../corpus/slack/writeGuardTypedRuns.js";
import type { PostedMessage, SlackWriteTransport } from "../../../../corpus/slack/writeTransport.js";
import { TypedRunsOnlyError } from "../../../../outbound/slack/typedRunsOnly.js";
import type { SlackCardPayload, SlackDripMessagePayload } from "../../../../outbound/slack/types.js";
import { workspaceShapeRefusals } from "../../../slackWorkspaceShapeFake.js";

const POSTED: PostedMessage = { channel: "C0CHAN01", ts: "1787544581.257679" };

/** What the underlying transport was actually asked to do. A refused send must leave this empty. */
interface Calls {
  readonly postedCards: string[];
  readonly postedDrips: string[];
}

/**
 * A plain fake transport that records what reached it — not a mock: it is a hand-written object passed in
 * as a seam, which is what makes "the guard refused BEFORE the wire" a checkable claim rather than a hope.
 *
 * Every method the guard does not wrap throws, so a future change that starts routing content through one
 * of them fails here instead of quietly posting unguarded.
 */
function fakeTransport({ calls }: { calls: Calls }): SlackWriteTransport {
  const unused =
    ({ name }: { name: string }) =>
    async (): Promise<never> => {
      throw new Error(`${name} is not exercised by this test`);
    };
  return {
    ...workspaceShapeRefusals({ path: "the typed-runs guard" }),
    addReaction: async () => true,
    appendStream: unused({ name: "appendStream" }),
    attachAssistantMedia: unused({ name: "attachAssistantMedia" }),
    attachMedia: unused({ name: "attachMedia" }),
    attachRecipeResponseMedia: unused({ name: "attachRecipeResponseMedia" }),
    conversationInfo: async () => ({ name: undefined, surface: "public-channel" as const }),
    deleteMessage: async () => true,
    deleteMessageOnce: async () => ({ kind: "gone" }),
    postAssistantMessage: unused({ name: "postAssistantMessage" }),
    postCard: async ({ payload }) => {
      calls.postedCards.push(payload.attachments[0].fallback);
      return POSTED;
    },
    postDripMessage: async ({ payload }) => {
      calls.postedDrips.push(payload.text);
      return POSTED;
    },
    postNoFold: unused({ name: "postNoFold" }),
    postPoll: unused({ name: "postPoll" }),
    postRecipeResponse: unused({ name: "postRecipeResponse" }),
    postTurn: unused({ name: "postTurn" }),
    readBackFileCount: async () => 0,
    readMessage: async () => undefined,
    readReactions: async () => undefined,
    removeReaction: async () => true,
    setAssistantStatus: unused({ name: "setAssistantStatus" }),
    setThreadTitle: unused({ name: "setThreadTitle" }),
    startStream: unused({ name: "startStream" }),
    stopStream: unused({ name: "stopStream" }),
    updateCard: unused({ name: "updateCard" }),
    correctMessage: unused({ name: "correctMessage" }),
    updateDripMessage: unused({ name: "updateDripMessage" }),
    updateTurn: unused({ name: "updateTurn" }),
    uploadPrivately: unused({ name: "uploadPrivately" }),
    userGroupIds: async () => new Map<string, string>(),
    whoAmI: unused({ name: "whoAmI" }),
  };
}

/** A card payload built BY HAND, exactly as a composer that never met the artifact form would build one. */
function handBuiltCard({ text }: { text: string }): SlackCardPayload {
  return {
    attachments: [
      {
        blocks: [
          {
            elements: [{ elements: [{ text, type: "text" }], type: "rich_text_section" }],
            type: "rich_text",
          },
        ],
        color: "#12B5A6",
        fallback: text,
      },
    ],
    metadata: {
      event_payload: {
        artifactFingerprint: "fp-1",
        artifactKind: "update",
        renderer: "slack-card-v1",
        schemaVersion: 1,
      },
      event_type: "slopweaver_card_v1",
    },
    text: "",
    unfurl_links: false,
    unfurl_media: false,
  };
}

/** An as-me drip payload built by hand — the lane whose FORM path once posted dead URLs. */
function handBuiltDrip({ text }: { text: string }): SlackDripMessagePayload {
  return {
    blocks: [{ elements: [{ elements: [{ text, type: "text" }], type: "rich_text_section" }], type: "rich_text" }],
    form: "rich",
    text,
    unfurl_links: true,
    unfurl_media: true,
  };
}

/** The refusal a send produced, or the empty string when it went through. */
async function refusalOf({ send }: { send: () => Promise<unknown> }): Promise<string> {
  try {
    await send();
    return "";
  } catch (error) {
    return error instanceof TypedRunsOnlyError ? error.message : `unexpected: ${String(error)}`;
  }
}

describe("guardTypedRuns", () => {
  it("REFUSES a hand-built card carrying raw mention markup, and never reaches the transport", async () => {
    const calls: Calls = { postedCards: [], postedDrips: [] };
    const guarded = guardTypedRuns({ transport: fakeTransport({ calls }) });

    const message = await refusalOf({
      send: async () =>
        guarded.postCard({
          channel: "C1",
          payload: handBuiltCard({ text: "<@U08KJ> shipped it" }),
          threadTs: undefined,
        }),
    });

    expect(message).toContain("chat.postMessage (card): 1 outbound text run(s)");
    expect(calls.postedCards).toEqual([]);
  });

  it("REFUSES a hand-built as-me message carrying a bare URL, and never reaches the transport", async () => {
    const calls: Calls = { postedCards: [], postedDrips: [] };
    const guarded = guardTypedRuns({ transport: fakeTransport({ calls }) });

    const message = await refusalOf({
      send: async () =>
        guarded.postDripMessage({
          channel: "D0SYN000001",
          payload: handBuiltDrip({ text: "here it is https://example.com/x" }),
          threadTs: undefined,
        }),
    });

    expect(message).toContain("chat.postMessage (as-me): 1 outbound text run(s)");
    expect(calls.postedDrips).toEqual([]);
  });

  it("lets a card whose runs are already typed straight through, unchanged", async () => {
    const calls: Calls = { postedCards: [], postedDrips: [] };
    const guarded = guardTypedRuns({ transport: fakeTransport({ calls }) });

    const posted = await guarded.postCard({
      channel: "C1",
      payload: handBuiltCard({ text: "all green" }),
      threadTs: undefined,
    });

    expect(posted).toEqual(POSTED);
    expect(calls.postedCards).toEqual(["all green"]);
  });

  it("passes a method it does not guard straight to the transport", async () => {
    const calls: Calls = { postedCards: [], postedDrips: [] };
    const guarded = guardTypedRuns({ transport: fakeTransport({ calls }) });

    expect(await guarded.addReaction({ name: "eyes", posted: POSTED })).toBe(true);
  });
});
