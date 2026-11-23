/**
 * INTEGRATION test: the answer's Slack write seam (`postAssistantMessage`/`attachAssistantMedia`) against
 * the REAL Slack Web API, recorded + replayed via Polly cassettes — the twin of `slackWrite.test.ts` for the
 * path `turn answer` actually uses, rather than the operator card.
 *
 * Recording this POSTS FOR REAL, into the bot's own DM with the owner — never a live team channel — for the
 * same reason `slackWrite.test.ts` does.
 *
 * ## Why this file exists separately from the card's
 *
 * `SlackWriteTransport`'s `postCard`/`attachMedia` and `postAssistantMessage`/`attachAssistantMedia` send the
 * same `attachments` wire shape now, but under distinct metadata/renderer ids, so a cassette recorded
 * against one method never exercises the other. The card path already has integration coverage; this file
 * is what makes the answer path's attach → read-back → retract sequence provable against real Slack rather
 * than only against a fake transport (`writeSend/assistantSend.test.ts`, unit lane).
 *
 * ## The retraction test proves something a fake transport cannot
 *
 * An adversarial review of the plan for this file found the obvious version — force `attachAssistantMedia`
 * to fail and assert the message is retracted — would pass even if a REAL Slack attach silently no-ops.
 * Two fixes:
 *
 * 1. **A genuine positive-success proof stands alongside it**: the ONE/TWO-file tests below read the
 *    message back through the REAL `readBackFileCount`, which is Slack's own stored file count, not a
 *    trusted `ok: true`. If a real attach ever silently dropped files, THOSE tests fail.
 * 2. **The retraction proof reads the message back as GONE**, via `transport.readMessage`, which returns
 *    `undefined` when Slack has no message at that `ts` — genuinely distinct from "exists with zero files".
 *    Only `attachAssistantMedia` is faked (to force the failure deterministically); the upload, post,
 *    delete and read-back all hit the real API.
 *
 * ## Redaction still applies — see `slackWrite.test.ts`'s header
 *
 * No assertion here may depend on a string Slack echoes back. Structural shape only: block/element type
 * sequence, counts, `files.length`, `ts` shape.
 *
 * Run:
 *   yarn test:integration                                                   # replay (default, offline)
 *   POLLY_MODE=record SLOPWEAVER_RECORD_SLACK_BOT_TOKEN=xoxb-… \
 *     SLOPWEAVER_RECORD_SLACK_DM=D… yarn test:integration                   # (re)record — POSTS FOR REAL
 */
import { describe, expect, it } from "vitest";

import { makeSlackWriteTransport } from "../../corpus/slack/writeApi.js";
import { PLACEMENT_OUT_OF_SCOPE } from "../../corpus/slack/writeGuardPlacement.js";
import { runAssistantCompositeSend } from "../../corpus/slack/writeSend.js";
import { SlackCompositeSendError } from "../../corpus/slack/writeSendSteps.js";
import type { PostedMessage, SlackWriteTransport, UploadReadiness } from "../../corpus/slack/writeTransport.js";
import { slopweaverHome } from "../../homeDir.js";
import { isRecord } from "../../lib/parsers.js";
import type { UpdateArtifact } from "../../outbound/artifact/types.js";
import { renderAssistantMessage } from "../../outbound/assistant/answerMessage.js";
import type { SlackCardChrome } from "../../outbound/slack/types.js";
import { admitAll } from "../imageAdmitFake.js";

const RECORD = process.env["POLLY_MODE"] === "record";

function botToken(): string {
  if (!RECORD) {
    return "xoxb-replay";
  }
  const token = process.env["SLOPWEAVER_RECORD_SLACK_BOT_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_SLACK_BOT_TOKEN to record the Slack write cassettes");
  }
  return token;
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

/** Recording posts for real, so each case is visibly a test in the DM. */
function artifactFor({ label, detail }: { label: string; detail: UpdateArtifact["detail"] }): UpdateArtifact {
  return { citations: [], detail, index: [], kind: "update", media: [], tldr: `assistant integration ${label}` };
}

/** Neutral chrome — never a real operator's bot name; this repo is public. */
const CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "slopweaver",
  bannerColor: "#8B5CF6",
  detailLabel: "*Details*",
  metadataEventType: "slopweaver_assistant_answer_v1",
};

function payloadFor({ artifact }: { artifact: UpdateArtifact }) {
  return renderAssistantMessage({ artifact, chrome: CHROME, mentions: { groups: new Map(), people: new Map() } });
}

/** Uploads are already complete by the time the seam polls in a cassette; the race is unit-tested. */
const READY: UploadReadiness = { waitForFile: async () => ({ kind: "ready", polls: 1, waitedMs: 0 }) };

function tinyPng(): Uint8Array {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

/** Whether `value` (or anything nested inside it) carries an own `attachments` key. Pure, recursive. */
function hasAttachmentsKey({ value }: { value: unknown }): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => hasAttachmentsKey({ value: entry }));
  }
  if (!isRecord(value)) {
    return false;
  }
  if (Object.hasOwn(value, "attachments")) {
    return true;
  }
  return Object.values(value).some((entry) => hasAttachmentsKey({ value: entry }));
}

/**
 * The real transport, with ONLY `attachAssistantMedia` forced to fail — deterministic, without needing an
 * actually-broken Slack call. Upload, post, delete and read-back all still hit the real API.
 */
function transportWithForcedAttachFailure({ transport }: { transport: SlackWriteTransport }): SlackWriteTransport {
  return {
    ...transport,
    attachAssistantMedia: async () => {
      throw new Error("forced failure for the retraction proof");
    },
  };
}

/**
 * Whether a message is genuinely gone, resolved to one normalised value rather than left as a conditional
 * inside an assertion. `readMessage` returns `undefined` when `conversations.history` finds nothing and the
 * message is not a thread reply either; when the ts never existed as a thread anchor at all — exactly the
 * state a deleted top-level DM message is in — `conversations.replies` itself throws `thread_not_found`
 * rather than returning an empty result. Both are the same real fact: nothing is there.
 */
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

// Titles below still say "wrapper-free" even though the assertions now check the OPPOSITE — Polly's
// recording name is derived from the describe/it title (see `setup-polly.ts`), so renaming either breaks
// the cassette lookup (`recordIfMissing: false`, no live credentials to re-record with here). Confirmed by
// running it: a title change alone produced 5 "Recording ... is not found" failures. Fix the wording once
// this suite is next re-recorded against real Slack.
describe("slack assistant write — wrapper-free (integration — real Slack via Polly cassette)", () => {
  it("posts a wrapper-free message with no attachments key anywhere", async () => {
    const payload = payloadFor({
      artifact: artifactFor({
        detail: [{ runs: [{ text: "An accent-wrapped paragraph.", type: "text" }], type: "paragraph" }],
        label: "accent wrapper",
      }),
    });

    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0].color).toBe(CHROME.bannerColor);
    expect(hasAttachmentsKey({ value: payload.attachments[0].blocks })).toBe(false);

    const result = await runAssistantCompositeSend({
      admit: admitAll().admit,
      channel: targetChannel(),
      documents: [],
      payload,
      readiness: READY,
      transport: makeSlackWriteTransport({
        home: slopweaverHome(),
        placementSeams: PLACEMENT_OUT_OF_SCOPE,
        token: botToken(),
      }),
      uploads: [],
    });

    expect(result.ok).toBe(true);
    expect(result.fileIds).toEqual([]);
    // A Slack ts is `<seconds>.<micros>` — assertable shape, and not a string Slack echoes from us.
    expect(/^\d{10}\.\d{6}$/.test(result.ts)).toBe(true);
  });

  it("attaches ONE file and proves it by reading the message back, never by trusting ok:true", async () => {
    const result = await runAssistantCompositeSend({
      admit: admitAll().admit,
      channel: targetChannel(),
      documents: [],
      payload: payloadFor({
        artifact: artifactFor({
          detail: [{ runs: [{ text: "One file rides along, accent-wrapped.", type: "text" }], type: "paragraph" }],
          label: "one file",
        }),
      }),
      readiness: READY,
      transport: makeSlackWriteTransport({
        home: slopweaverHome(),
        placementSeams: PLACEMENT_OUT_OF_SCOPE,
        token: botToken(),
      }),
      uploads: [{ bytes: tinyPng(), filename: "assistant-one.png" }],
    });

    expect(result.fileIds.length).toBe(1);
  });

  it("attaches TWO files of different types on a single wrapper-free message", async () => {
    const result = await runAssistantCompositeSend({
      admit: admitAll().admit,
      channel: targetChannel(),
      documents: [],
      payload: payloadFor({
        artifact: artifactFor({
          detail: [{ runs: [{ text: "Two files, mixed types, accent-wrapped.", type: "text" }], type: "paragraph" }],
          label: "two files",
        }),
      }),
      readiness: READY,
      transport: makeSlackWriteTransport({
        home: slopweaverHome(),
        placementSeams: PLACEMENT_OUT_OF_SCOPE,
        token: botToken(),
      }),
      uploads: [
        { bytes: tinyPng(), filename: "assistant-two-a.png" },
        { bytes: Buffer.from("assistant integration probe\n", "utf8"), filename: "assistant-two-b.txt" },
      ],
    });

    expect(result.fileIds.length).toBe(2);
  });

  // The answer door carries no picture-count cap, so the count Slack actually stores on ONE message is
  // the fact worth holding. Eleven is the ISO answer's own case — one capture per control it names.
  it("attaches ELEVEN pictures on one answer message, and Slack stores all eleven", async () => {
    const result = await runAssistantCompositeSend({
      admit: admitAll().admit,
      channel: targetChannel(),
      documents: [],
      payload: payloadFor({
        artifact: artifactFor({
          detail: [{ runs: [{ text: "Eleven pictures, one per control named.", type: "text" }], type: "paragraph" }],
          label: "eleven pictures",
        }),
      }),
      readiness: READY,
      transport: makeSlackWriteTransport({
        home: slopweaverHome(),
        placementSeams: PLACEMENT_OUT_OF_SCOPE,
        token: botToken(),
      }),
      uploads: Array.from({ length: 11 }, (_, i) => ({
        bytes: tinyPng(),
        filename: `assistant-eleven-${String(i)}.png`,
      })),
    });

    expect(result.fileIds.length).toBe(11);
  });

  it("attaches a DOCUMENT beside an image, and Slack stores both on the one message", async () => {
    const admit = admitAll();

    const result = await runAssistantCompositeSend({
      admit: admit.admit,
      channel: targetChannel(),
      documents: [
        {
          bytes: Buffer.from("# ISO 27001 controls\n\nThe deliverable, as markdown.\n", "utf8"),
          filename: "assistant-deliverable.md",
        },
        { bytes: Buffer.from("<h1>ISO 27001 controls</h1>\n", "utf8"), filename: "assistant-deliverable.html" },
      ],
      payload: payloadFor({
        artifact: artifactFor({
          detail: [
            { runs: [{ text: "The deliverable is attached, markdown first.", type: "text" }], type: "paragraph" },
          ],
          label: "document lane",
        }),
      }),
      readiness: READY,
      transport: makeSlackWriteTransport({
        home: slopweaverHome(),
        placementSeams: PLACEMENT_OUT_OF_SCOPE,
        token: botToken(),
      }),
      uploads: [{ bytes: tinyPng(), filename: "assistant-shot.png" }],
    });

    // Three files stored on the one message, counted by Slack itself — the read-back check inside the send
    // retracts the message rather than returning if that count disagrees.
    expect(result.fileIds.length).toBe(3);
    // Image admission saw the IMAGE and neither document, on both of its two calls. This is the falsifiable
    // half: a document routed into the images array would appear here, and live Slack would have refused
    // the whole batch with IMAGE_RECORD_MISSING before a byte was offered.
    expect(admit.asked).toEqual([["assistant-shot.png"], ["assistant-shot.png"]]);
  });

  it("RETRACTS the message when the attach step fails, and proves it GONE by reading it back — not just a returned flag", async () => {
    const transport = makeSlackWriteTransport({
      home: slopweaverHome(),
      placementSeams: PLACEMENT_OUT_OF_SCOPE,
      token: botToken(),
    });
    const forced = transportWithForcedAttachFailure({ transport });

    let caught: SlackCompositeSendError | undefined;
    try {
      await runAssistantCompositeSend({
        admit: admitAll().admit,
        channel: targetChannel(),
        documents: [],
        payload: payloadFor({
          artifact: artifactFor({
            detail: [{ runs: [{ text: "This message must not survive.", type: "text" }], type: "paragraph" }],
            label: "forced retraction",
          }),
        }),
        readiness: READY,
        transport: forced,
        uploads: [{ bytes: tinyPng(), filename: "assistant-retracted.png" }],
      });
    } catch (error) {
      caught = error instanceof SlackCompositeSendError ? error : undefined;
    }

    if (caught === undefined) {
      throw new Error("expected runAssistantCompositeSend to throw SlackCompositeSendError");
    }
    expect(caught.deletedMessage).toBe(true);
    expect(caught.uploadedFileIds.length).toBe(1);

    // The REAL proof: read the message back through the UNFAKED transport. `chat.delete` returning
    // ok:true is Slack's own confirmation, but this is the same "prove it, don't trust it" discipline
    // the positive-attach tests apply to the attach step, applied here to the delete step.
    expect(await readAfterDelete({ posted: caught.posted!, transport })).toBe("gone");
  });

  it("replies inside a thread, carrying the parent timestamp", async () => {
    const transport = makeSlackWriteTransport({
      home: slopweaverHome(),
      placementSeams: PLACEMENT_OUT_OF_SCOPE,
      token: botToken(),
    });
    const parent = await runAssistantCompositeSend({
      admit: admitAll().admit,
      channel: targetChannel(),
      documents: [],
      payload: payloadFor({
        artifact: artifactFor({
          detail: [
            { runs: [{ text: "The parent of a threaded accent-wrapped reply.", type: "text" }], type: "paragraph" },
          ],
          label: "thread parent",
        }),
      }),
      readiness: READY,
      transport,
      uploads: [],
    });

    const reply = await runAssistantCompositeSend({
      admit: admitAll().admit,
      channel: targetChannel(),
      documents: [],
      payload: payloadFor({
        artifact: artifactFor({
          detail: [{ runs: [{ text: "The accent-wrapped reply itself.", type: "text" }], type: "paragraph" }],
          label: "thread reply",
        }),
      }),
      readiness: READY,
      threadTs: parent.ts,
      transport,
      uploads: [],
    });

    expect(reply.ok).toBe(true);
    expect(/^\d{10}\.\d{6}$/.test(reply.ts)).toBe(true);
  });
});
