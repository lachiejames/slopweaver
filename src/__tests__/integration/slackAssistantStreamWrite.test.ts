/**
 * INTEGRATION test: the STREAM-based Slack write seam (`startStream`/`appendStream`/`stopStream`) against
 * the REAL Slack Web API, recorded + replayed via Polly cassettes. Production turn messages no longer use
 * this seam; the suite preserves the explicitly supported generic transport contract.
 *
 * Recording this POSTS FOR REAL, into the bot's own DM with the owner — never a live team channel — for the
 * same reason every other file in this directory does.
 *
 * ## Why this file exists separately from the assistant-write suite
 *
 * `chat.startStream`/`appendStream`/`stopStream` are genuinely different wire calls from
 * `chat.postMessage`/`chat.update` (different endpoints, a mandatory `thread_ts`, chunk-shaped bodies), so a
 * cassette recorded against one family never exercises the other. The answer itself no longer streams — its
 * `attachments` wrapper cannot be expressed on `chat.startStream`'s payload — so it moved onto
 * `postAssistantMessage`/`attachAssistantMedia`, covered by `slackAssistantWrite.test.ts` instead. The
 * checklist now uses static post/update calls too, because an open stream cannot carry ownership metadata.
 *
 * ## Every stream needs a thread to open into
 *
 * `chat.startStream` requires `thread_ts` unconditionally — there is no top-level streamed message. Each
 * case that needs one posts an ordinary top-level "parent" message first, through the UNCHANGED
 * `postAssistantMessage` path (proven by the existing suite), then streams into its `ts`.
 *
 * ## Redaction still applies — see `slackWrite.test.ts`'s header
 *
 * No assertion here may depend on a string Slack echoes back. Structural shape only: block/element type
 * sequence, counts, `files.length`, `ts` shape, `streaming_state`.
 *
 * Run:
 *   yarn test:integration                                                   # replay (default, offline)
 *   POLLY_MODE=record SLOPWEAVER_RECORD_SLACK_BOT_TOKEN=xoxb-… \
 *     SLOPWEAVER_RECORD_SLACK_DM=D… yarn test:integration                   # (re)record — POSTS FOR REAL
 */

import type { AnyChunk } from "@slack/types";
import { describe, expect, it } from "vitest";

import { makeSlackWriteTransport } from "../../corpus/slack/writeApi.js";
import { PLACEMENT_OUT_OF_SCOPE } from "../../corpus/slack/writeGuardPlacement.js";
import { runAssistantCompositeSend } from "../../corpus/slack/writeSend.js";
import type { PostedMessage, SlackWriteTransport, UploadReadiness } from "../../corpus/slack/writeTransport.js";
import { slopweaverHome } from "../../homeDir.js";
import type { UpdateArtifact } from "../../outbound/artifact/types.js";
import { renderAssistantMessage } from "../../outbound/assistant/answerMessage.js";
import { type TodoStep, type TodoTaskChunk, todoTaskChunks } from "../../outbound/assistant/todoBlock.js";
import type { SlackCardChrome } from "../../outbound/slack/types.js";
import { admitAll } from "../imageAdmitFake.js";

const RECORD = process.env["POLLY_MODE"] === "record";

/** Neutral chrome — never a real operator's bot name; this repo is public. */
const CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "slopweaver",
  bannerColor: "#8B5CF6",
  detailLabel: "*Details*",
  metadataEventType: "slopweaver_assistant_answer_v1",
};

function botToken(): string {
  if (!RECORD) {
    return "xoxb-replay";
  }
  const token = process.env["SLOPWEAVER_RECORD_SLACK_BOT_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_SLACK_BOT_TOKEN to record the Slack stream cassettes");
  }
  return token;
}

/** Convert the repo's explicit-undefined optional convention to Slack's omitted-optional chunk convention. */
function asAnyChunk({ chunk }: { chunk: TodoTaskChunk }): AnyChunk {
  const { details, ...rest } = chunk;
  return details === undefined ? rest : { ...rest, details };
}

/** A generic plan-stream payload used only to preserve the supported transport contract. */
function planStreamChunks({ task, steps }: { task: string; steps: readonly TodoStep[] }): readonly AnyChunk[] {
  return [{ title: task, type: "plan_update" }, ...todoTaskChunks({ steps }).map((chunk) => asAnyChunk({ chunk }))];
}

/** The bot's own DM with the owner. Never a live team channel. */
function targetChannel(): string {
  if (!RECORD) {
    return "D0SYN00REPLAY";
  }
  const channel = process.env["SLOPWEAVER_RECORD_SLACK_DM"];
  if (channel === undefined || channel.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_SLACK_DM to the bot DM to record into");
  }
  return channel;
}

/** Uploads are already complete by the time the seam polls in a cassette; the race is unit-tested. */
const READY: UploadReadiness = { waitForFile: async () => ({ kind: "ready", polls: 1, waitedMs: 0 }) };

/** A plain top-level parent, through the UNCHANGED legacy path, so every stream in this file has a thread. */
async function postParent({
  label,
  transport,
}: {
  label: string;
  transport: SlackWriteTransport;
}): Promise<PostedMessage> {
  const artifact: UpdateArtifact = {
    citations: [],
    detail: [{ runs: [{ text: `Stream parent: ${label}`, type: "text" }], type: "paragraph" }],
    index: [],
    kind: "update",
    media: [],
    tldr: `stream integration parent — ${label}`,
  };
  const result = await runAssistantCompositeSend({
    admit: admitAll().admit,
    channel: targetChannel(),
    documents: [],
    payload: renderAssistantMessage({ artifact, chrome: CHROME, mentions: { groups: new Map(), people: new Map() } }),
    readiness: READY,
    transport,
    uploads: [],
  });
  return { channel: result.channel, ts: result.ts };
}

/** Same gone-check `slackAssistantWrite.test.ts` uses — genuinely distinct from "exists with zero files". */
async function readAfterDelete({
  posted,
  transport,
}: {
  posted: PostedMessage;
  transport: SlackWriteTransport;
}): Promise<"gone" | "present"> {
  try {
    return (await transport.readMessage({ posted })) === undefined ? "gone" : "present";
  } catch (error) {
    return error instanceof Error && error.message.includes("thread_not_found") ? "gone" : "present";
  }
}

describe("slack assistant stream write (integration — real Slack via Polly cassette)", () => {
  it("whoAmI structurally reports a non-empty team id, needed for a channel-surface recipient", async () => {
    const self = await makeSlackWriteTransport({
      home: slopweaverHome(),
      placementSeams: PLACEMENT_OUT_OF_SCOPE,
      token: botToken(),
    }).whoAmI();
    expect(self.teamId).toBeDefined();
    expect(self.teamId!.length).toBeGreaterThan(0);
  });

  // The historical test title stays fixed because Polly derives the cassette directory from it.
  it("opens a plan-mode checklist stream, advances it, stops it, and deletes it — proven gone afterward", async () => {
    const transport = makeSlackWriteTransport({
      home: slopweaverHome(),
      placementSeams: PLACEMENT_OUT_OF_SCOPE,
      token: botToken(),
    });
    const parent = await postParent({ label: "checklist", transport });

    const posted = await transport.startStream({
      channel: parent.channel,
      payload: {
        chunks: planStreamChunks({
          steps: [{ id: "t1", state: "running", title: "Read the question" }],
          task: "Answering your question",
        }),
        taskDisplayMode: "plan",
      },
      recipient: undefined,
      threadTs: parent.ts,
    });

    await transport.appendStream({
      chunks: planStreamChunks({
        steps: [{ id: "t1", state: "done", title: "Read the question" }],
        task: "Answering your question",
      }),
      posted,
    });

    const stopped = await transport.stopStream({ posted });
    expect(stopped).toBe(true);

    const deleted = await transport.deleteMessage({ posted });
    expect(deleted).toBe(true);
    expect(await readAfterDelete({ posted, transport })).toBe("gone");
  });

  it("appendStream after stopStream resolves as a no-op rather than throwing — an adversarial review's counterexample", async () => {
    const transport = makeSlackWriteTransport({
      home: slopweaverHome(),
      placementSeams: PLACEMENT_OUT_OF_SCOPE,
      token: botToken(),
    });
    const parent = await postParent({ label: "append after stop", transport });

    const posted = await transport.startStream({
      channel: parent.channel,
      payload: {
        chunks: planStreamChunks({ steps: [{ id: "t1", state: "running", title: "Step one" }], task: "Working" }),
        taskDisplayMode: "plan",
      },
      recipient: undefined,
      threadTs: parent.ts,
    });
    await transport.stopStream({ posted });

    // The generic transport keeps this idempotent state contract even though production turn checklists now
    // use metadata-bearing static messages rather than streams.
    await expect(
      transport.appendStream({
        chunks: planStreamChunks({ steps: [{ id: "t1", state: "done", title: "Step one" }], task: "Working" }),
        posted,
      }),
    ).resolves.toBeUndefined();

    await transport.deleteMessage({ posted });
  });
});
