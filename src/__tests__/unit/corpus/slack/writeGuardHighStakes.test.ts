/**
 * The high-stakes reply guard at the transport: a reply into a high-stakes channel is read back first, and one
 * whose thread names no top-level message there is refused BEFORE the wire, as is a turn-frame edit of a
 * top-level message. Plain fakes throughout: the channel list and the hatch are seams, and the transport records
 * what reached it and answers reads from a fixed table.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  guardHighStakesReplies,
  HighStakesReplyRefusedError,
  type HighStakesReplySeams,
  productionHighStakesReplySeams,
} from "../../../../corpus/slack/writeGuardHighStakes.js";
import { PLACEMENT_OUT_OF_SCOPE } from "../../../../corpus/slack/writeGuardPlacement.js";
import { guardWriteTransport } from "../../../../corpus/slack/writeGuards.js";
import type { PostedMessage, SlackWriteTransport } from "../../../../corpus/slack/writeTransport.js";
import { slopweaverHome } from "../../../../homeDir.js";
import { err, ok, unwrap } from "../../../../lib/result.js";
import type { ReadSlackMessage } from "../../../../outbound/slack/lifecycleGuards.js";
import { classifySendFailure } from "../../../../outbound/slack/sendFailure.js";
import type { SlackDripMessagePayload, SlackTurnPayload } from "../../../../outbound/slack/types.js";
import { readHighStakesConfig } from "../../../../profileStore.js";
import { grantedEnv, withLiveGrant } from "../../../hatchGrantFixture.js";
import { workspaceShapeRefusals } from "../../../slackWorkspaceShapeFake.js";

const BUGS = "C0SYN000003";
const ENGINEERING = "C0SYNENGINEER1";
const ROOT = "1790604264.247109";
const REPLY = "1790604300.100200";
const PHANTOM = "1790600000.000001";

/** What reached the fake transport, and what the guard read. */
interface Calls {
  readonly posted: string[];
  readonly reads: string[];
}

/** A plain fake transport: posts record, reads answer from `messages` or throw `readFailure`. */
function fakeTransport({
  calls,
  messages,
  readFailure,
}: {
  calls: Calls;
  messages: readonly ReadSlackMessage[];
  readFailure?: string;
}): SlackWriteTransport {
  const unused =
    ({ name }: { name: string }) =>
    async (): Promise<never> => {
      throw new Error(`${name} is not exercised by this test`);
    };
  const record =
    ({ method }: { method: string }) =>
    async ({ channel, threadTs }: { channel: string; threadTs?: string | undefined }): Promise<PostedMessage> => {
      calls.posted.push(`${method} ${channel} ${String(threadTs)}`);
      return { channel, ts: "1790611538.684019" };
    };
  return {
    ...workspaceShapeRefusals({ path: "the high-stakes reply guard" }),
    addReaction: async () => true,
    appendStream: unused({ name: "appendStream" }),
    attachAssistantMedia: unused({ name: "attachAssistantMedia" }),
    attachMedia: unused({ name: "attachMedia" }),
    attachRecipeResponseMedia: unused({ name: "attachRecipeResponseMedia" }),
    conversationInfo: async () => ({ name: undefined, surface: "public-channel" as const }),
    deleteMessage: async () => true,
    deleteMessageOnce: async () => ({ kind: "gone" }),
    openConversation: unused({ name: "openConversation" }),
    postAssistantMessage: record({ method: "postAssistantMessage" }),
    postCard: record({ method: "postCard" }),
    postDripMessage: record({ method: "postDripMessage" }),
    postNoFold: record({ method: "postNoFold" }),
    postPoll: record({ method: "postPoll" }),
    postRecipeResponse: record({ method: "postRecipeResponse" }),
    postTurn: record({ method: "postTurn" }),
    readBackFileCount: async () => 0,
    readMessage: async ({ posted }) => {
      calls.reads.push(`${posted.channel} ${posted.ts}`);
      if (readFailure !== undefined) {
        throw new Error(readFailure);
      }
      return messages.find((message) => message.ts === posted.ts);
    },
    readReactions: async () => undefined,
    removeReaction: async () => true,
    setAssistantStatus: unused({ name: "setAssistantStatus" }),
    setThreadTitle: unused({ name: "setThreadTitle" }),
    startStream: record({ method: "startStream" }),
    stopStream: unused({ name: "stopStream" }),
    updateCard: unused({ name: "updateCard" }),
    correctMessage: unused({ name: "correctMessage" }),
    updateDripMessage: unused({ name: "updateDripMessage" }),
    updateTurn: async ({ posted }) => {
      calls.posted.push(`updateTurn ${posted.channel} ${posted.ts}`);
    },
    uploadPrivately: unused({ name: "uploadPrivately" }),
    userGroupIds: async () => new Map<string, string>(),
    whoAmI: async () => ({ userId: "U0SYN000005", workspaceUrl: "https://acme.slack.com/" }),
  };
}

/** Seams naming #defects high-stakes, or failing the profile read, with the hatch shut unless asked. */
function seams({ failure, hatch = false }: { failure?: string; hatch?: boolean }): HighStakesReplySeams {
  return {
    channels: () => (failure === undefined ? ok([{ id: BUGS, name: "#defects" }]) : err(failure)),
    hatchIsOpen: () => hatch,
  };
}

/** An as-me plain drip. */
const DRIP: SlackDripMessagePayload = { form: "plain", text: "on it", unfurl_links: true, unfurl_media: true };

/** A live turn frame, keyed by its turn. */
const TURN: SlackTurnPayload = {
  attachments: [
    {
      blocks: [
        { elements: [{ elements: [{ text: "working", type: "text" }], type: "rich_text_section" }], type: "rich_text" },
      ],
      color: "#12B5A6",
      fallback: "working",
    },
  ],
  metadata: { event_payload: { renderer: "slack-turn-v1", schemaVersion: 1, turnId: "t-1" }, event_type: "turn" },
  text: "",
  unfurl_links: false,
  unfurl_media: false,
};

/** The root and one reply in #defects, as Slack stores them: the root carries its own ts as its thread. */
const THREAD: readonly ReadSlackMessage[] = [
  { fileIds: [], threadTs: ROOT, ts: ROOT },
  { fileIds: [], threadTs: ROOT, ts: REPLY },
];

/** The error a send threw, or undefined when it went through. */
async function thrownBy({ send }: { send: () => Promise<unknown> }): Promise<unknown> {
  try {
    await send();
    return undefined;
  } catch (error) {
    return error;
  }
}

const newCalls = (): Calls => ({ posted: [], reads: [] });

describe("guardHighStakesReplies", () => {
  it("lets a reply under a real top-level message in #defects through, after reading it", async () => {
    const calls = newCalls();
    const guarded = guardHighStakesReplies({ seams: seams({}), transport: fakeTransport({ calls, messages: THREAD }) });
    await guarded.postTurn({ channel: BUGS, payload: TURN, threadTs: ROOT });
    expect(calls.reads).toEqual([`${BUGS} ${ROOT}`]);
    expect(calls.posted).toEqual([`postTurn ${BUGS} ${ROOT}`]);
  });

  it("refuses a reply under a ts naming no message in #defects, before the wire, releasing the reservation", async () => {
    const calls = newCalls();
    const guarded = guardHighStakesReplies({ seams: seams({}), transport: fakeTransport({ calls, messages: THREAD }) });
    const error = await thrownBy({
      send: () => guarded.postDripMessage({ channel: BUGS, payload: DRIP, threadTs: PHANTOM }),
    });
    expect(error).toBeInstanceOf(HighStakesReplyRefusedError);
    expect(String(error)).toContain(
      `an as-me message replies under ${PHANTOM} in #defects, which names no top-level message there`,
    );
    expect(String(error)).toContain("slopweaver hatch open high-stakes-undefended");
    expect(classifySendFailure({ error })).toEqual({ kind: "refused-before-wire" });
    expect(calls.posted).toEqual([]);
  });

  it("refuses a reply under a reply, which is not a top-level message", async () => {
    const calls = newCalls();
    const guarded = guardHighStakesReplies({ seams: seams({}), transport: fakeTransport({ calls, messages: THREAD }) });
    const error = await thrownBy({
      send: () => guarded.postTurn({ channel: "#defects", payload: TURN, threadTs: REPLY }),
    });
    expect(String(error)).toContain(
      `a turn frame replies under ${REPLY} in #defects, which names no top-level message there`,
    );
    expect(calls.reads).toEqual([`${BUGS} ${REPLY}`]);
    expect(calls.posted).toEqual([]);
  });

  it("refuses when the thread cannot be read", async () => {
    const calls = newCalls();
    const guarded = guardHighStakesReplies({
      seams: seams({}),
      transport: fakeTransport({ calls, messages: THREAD, readFailure: "ratelimited" }),
    });
    const error = await thrownBy({
      send: () => guarded.postTurn({ channel: BUGS, payload: TURN, threadTs: ROOT }),
    });
    expect(String(error)).toContain(
      `a turn frame in #defects names ${ROOT}, which could not be read (ratelimited), so it is judged as a top-level post`,
    );
    expect(calls.posted).toEqual([]);
  });

  it("refuses when the profile naming the channels cannot be read", async () => {
    const calls = newCalls();
    const guarded = guardHighStakesReplies({
      seams: seams({ failure: "profile.json is not valid JSON" }),
      transport: fakeTransport({ calls, messages: THREAD }),
    });
    const error = await thrownBy({
      send: () => guarded.postDripMessage({ channel: ENGINEERING, payload: DRIP, threadTs: ROOT }),
    });
    expect(String(error)).toContain(
      `the high-stakes channel list could not be read (profile.json is not valid JSON), so ${ENGINEERING} could not be judged`,
    );
    expect(calls.reads).toEqual([]);
    expect(calls.posted).toEqual([]);
  });

  it("reads nothing for a top-level post, which the composing lane judges", async () => {
    const calls = newCalls();
    const guarded = guardHighStakesReplies({ seams: seams({}), transport: fakeTransport({ calls, messages: [] }) });
    await guarded.postTurn({ channel: BUGS, payload: TURN, threadTs: undefined });
    expect(calls.reads).toEqual([]);
    expect(calls.posted).toEqual([`postTurn ${BUGS} undefined`]);
  });

  it("reads nothing for a reply in a channel the profile does not name", async () => {
    const calls = newCalls();
    const guarded = guardHighStakesReplies({ seams: seams({}), transport: fakeTransport({ calls, messages: [] }) });
    await guarded.postDripMessage({ channel: ENGINEERING, payload: DRIP, threadTs: PHANTOM });
    expect(calls.reads).toEqual([]);
    expect(calls.posted).toEqual([`postDripMessage ${ENGINEERING} ${PHANTOM}`]);
  });

  it("passes a phantom reply unread while the undefended hatch is open", async () => {
    const calls = newCalls();
    const guarded = guardHighStakesReplies({
      seams: seams({ hatch: true }),
      transport: fakeTransport({ calls, messages: [] }),
    });
    await guarded.postTurn({ channel: BUGS, payload: TURN, threadTs: PHANTOM });
    expect(calls.reads).toEqual([]);
    expect(calls.posted).toEqual([`postTurn ${BUGS} ${PHANTOM}`]);
  });

  it("refuses a turn-frame edit of a top-level message in #defects", async () => {
    const calls = newCalls();
    const guarded = guardHighStakesReplies({ seams: seams({}), transport: fakeTransport({ calls, messages: THREAD }) });
    const error = await thrownBy({
      send: () => guarded.updateTurn({ payload: TURN, posted: { channel: BUGS, ts: ROOT } }),
    });
    expect(String(error)).toContain(
      `a turn frame edit would rewrite ${ROOT}, a top-level message in #defects, and a turn frame is only ever a reply`,
    );
    expect(calls.posted).toEqual([]);
  });

  it("is one of the doors every live transport is wrapped in", async () => {
    const calls = newCalls();
    const places: string[] = [];
    const guarded = guardWriteTransport({
      highStakesSeams: seams({}),
      repeatSeams: {
        hatchIsOpen: () => false,
        nowMs: () => 1790611538684,
        readPlace: async ({ channel }) => {
          places.push(channel);
          return ok([]);
        },
      },
      home: slopweaverHome(),
      placementSeams: PLACEMENT_OUT_OF_SCOPE,
      token: "xoxb-test",
      transport: fakeTransport({ calls, messages: THREAD }),
    });
    const refused = await thrownBy({
      send: () => guarded.postTurn({ channel: BUGS, payload: TURN, threadTs: PHANTOM }),
    });
    expect(refused).toBeInstanceOf(HighStakesReplyRefusedError);
    expect(places).toEqual([]);
    await guarded.postTurn({ channel: BUGS, payload: TURN, threadTs: ROOT });
    expect(calls.posted).toEqual([`postTurn ${BUGS} ${ROOT}`]);
  });

  it("lets a turn-frame edit of a reply in #defects through", async () => {
    const calls = newCalls();
    const guarded = guardHighStakesReplies({ seams: seams({}), transport: fakeTransport({ calls, messages: THREAD }) });
    await guarded.updateTurn({ payload: TURN, posted: { channel: BUGS, ts: REPLY } });
    expect(calls.posted).toEqual([`updateTurn ${BUGS} ${REPLY}`]);
  });
});

describe("the live seams read the lane's own home, never the ambient one", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  /** A `--home` whose profile names #defects high-stakes. */
  function laneHome(): string {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-high-stakes-lane-"));
    homes.push(home);
    const profile = {
      displayName: "Ada Owner",
      gitNamespace: "ada-gh",
      id: "owner-1",
      schemaVersion: 1,
      slackHighStakes: { channels: [{ id: BUGS, name: "#defects" }] },
      sources: [],
    };
    writeFileSync(join(home, "profile.json"), JSON.stringify(profile));
    return home;
  }

  it("names the lane home's #defects while the ambient home holds no profile at all", () => {
    expect(unwrap(readHighStakesConfig({ home: slopweaverHome() })).listGap).toContain("holds no profile.json");
    const channels = productionHighStakesReplySeams({ home: laneHome() }).channels();
    expect(unwrap(channels)).toEqual([{ id: BUGS, name: "#defects" }]);
  });

  it("reads the high-stakes grant under the lane home, not the process's own home", () => {
    // The counterexample: `hatch open high-stakes-undefended --home B` while SLOPWEAVER_HOME names A.
    const home = laneHome();
    grantedEnv({ hatchIds: ["high-stakes-undefended"], home });
    const open: boolean[] = [];
    withLiveGrant({
      hatchIds: [],
      run: () => {
        open.push(productionHighStakesReplySeams({ home }).hatchIsOpen());
        open.push(productionHighStakesReplySeams({ home: laneHome() }).hatchIsOpen());
      },
    });
    expect(open).toEqual([true, false]);
  });

  it("refuses a --home lane's phantom reply into #defects through every door a live transport wears", async () => {
    const calls = newCalls();
    const guarded = guardWriteTransport({
      highStakesSeams: undefined,
      home: laneHome(),
      repeatSeams: { hatchIsOpen: () => false, nowMs: () => 1790611538684, readPlace: async () => ok([]) },
      placementSeams: PLACEMENT_OUT_OF_SCOPE,
      token: "xoxb-test",
      transport: fakeTransport({ calls, messages: THREAD }),
    });
    const refused = await thrownBy({
      send: () => guarded.postTurn({ channel: BUGS, payload: TURN, threadTs: PHANTOM }),
    });
    expect(refused).toBeInstanceOf(HighStakesReplyRefusedError);
    expect(String(refused)).toContain(`a turn frame replies under ${PHANTOM} in #defects`);
    expect(calls.reads).toEqual([`${BUGS} ${PHANTOM}`]);
    expect(calls.posted).toEqual([]);
  });
});
