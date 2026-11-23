/**
 * INTEGRATION test: creating, rewriting and deleting a Slack CANVAS against the REAL Web API, recorded +
 * replayed via Polly cassettes.
 *
 * Recording this CREATES FOR REAL — and unlike a channel, a canvas CAN be deleted, so every test here ends
 * by deleting what it made. The standalone canvases it creates are visible to the authoring identity alone
 * until access is granted, so nothing this file records is visible to anybody else at any point.
 *
 * ## What this can and cannot prove, stated up front
 *
 * The cassette policy redacts every response string whose key is not on the Slack allowlist. `canvas_id` was
 * added to that allowlist's `idKeys` for this file — as an opaque `F…` handle, exactly like `file_id` — so
 * it survives as a stable synthetic. The TITLE and the BODY do not survive and no assertion here may depend
 * on them; the round-trip of prose belongs in the unit lane, where the form builder is pure.
 *
 * What survives redaction and IS asserted here — the parts only a real API can establish:
 *   - `canvases.create` really mints a document and answers with a `canvas_id`;
 *   - `canvases.edit` with a whole-body `replace` is accepted against that id;
 *   - `canvases.delete` really deletes, and a REPEAT answers `canvas_not_found`, which the transport reads
 *     as the desired end state rather than as a failure — a distinction no unit test can source;
 *   - a SECOND `conversations.canvases.create` for the same conversation mints a SECOND document rather
 *     than being refused or updating the first — measured, and the opposite of what this file first
 *     asserted. It is why the create is at-most-once and carries a duplicate gate.
 *
 * Run:
 *   yarn test:integration                                                    # replay (default, offline)
 *   POLLY_MODE=record SLOPWEAVER_RECORD_SLACK_BOT_TOKEN=xoxb-… \
 *     SLOPWEAVER_RECORD_SLACK_DM=D… yarn test:integration                    # (re)record — CREATES FOR REAL
 */
import { beforeEach, describe, expect, it } from "vitest";

import { makeSlackWriteTransport } from "../../corpus/slack/writeApi.js";
import { slopweaverHome } from "../../homeDir.js";
import { activePolly } from "../setup-polly.js";

const RECORD = process.env["POLLY_MODE"] === "record";

/** A correlation marker in every canvas title, so a re-record's artefacts are identifiable afterwards. */
const CORRELATION = "slopweaver-canvas-integration";

/** Both tokens hold `canvases:write`; the bot's is the lane the verb defaults to. */
function botToken(): string {
  if (!RECORD) {
    return "xoxb-replay";
  }
  const token = process.env["SLOPWEAVER_RECORD_SLACK_BOT_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_SLACK_BOT_TOKEN to record the Slack canvas cassette");
  }
  return token;
}

/** The bot's own DM with the owner — the one conversation a channel-canvas test may touch. */
function targetChannel(): string {
  if (!RECORD) {
    return "D0SYN00REPLAY";
  }
  const channel = process.env["SLOPWEAVER_RECORD_SLACK_DM"];
  if (channel === undefined || channel.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_SLACK_DM to the bot DM to record against");
  }
  return channel;
}

/** The canvas body every test writes. Markdown, because that is the only content type Slack's canvas takes. */
const BODY = `# ${CORRELATION}\n\nRecording the canvas write cassette.\n`;

/**
 * Force ORDERED matching for this file.
 *
 * Without it the shared lenient config collapses the two `canvases.delete` calls onto one entry, and the
 * "a repeat answers `canvas_not_found`" assertion — the whole reason the delete is idempotent — would
 * replay the FIRST delete's success twice and pass while proving nothing. The same collapse would hide the
 * second `conversations.canvases.create`, whose refusal is the other thing this file exists to record.
 */
function requireOrderedMatching(): void {
  const polly = activePolly();
  if (polly === undefined) {
    return;
  }
  polly.server.any().on("request", (req) => {
    req.configure({ matchRequestsBy: { order: true } });
  });
}

describe("slack canvas writes (integration — real Slack via Polly cassette)", () => {
  beforeEach(() => {
    requireOrderedMatching();
  });

  it("creates a STANDALONE canvas, rewrites its whole body, and deletes it", async () => {
    const transport = makeSlackWriteTransport({ home: slopweaverHome(), token: botToken() });

    const canvasId = await transport.createCanvas({ markdown: BODY, title: `${CORRELATION} — create` });

    // A synthetic in replay, so its value proves nothing and its presence does: without `canvas_id` on the
    // allowlist this would be `[REDACTED]` and the create would be unassertable at all.
    expect(canvasId.length).toBeGreaterThan(0);

    await transport.replaceCanvas({ canvasId, markdown: `${BODY}\nRewritten.\n` });

    expect(await transport.deleteCanvas({ canvasId })).toBe(true);
  });

  it("reports a SECOND delete as success — `canvas_not_found` IS the desired end state", async () => {
    const transport = makeSlackWriteTransport({ home: slopweaverHome(), token: botToken() });
    const canvasId = await transport.createCanvas({ markdown: BODY, title: `${CORRELATION} — twice` });

    expect(await transport.deleteCanvas({ canvasId })).toBe(true);
    expect(await transport.deleteCanvas({ canvasId })).toBe(true);
  });

  it("attaches a canvas to a conversation — and a SECOND create makes a SECOND document, not an update", async () => {
    const transport = makeSlackWriteTransport({ home: slopweaverHome(), token: botToken() });

    const first = await transport.createChannelCanvas({
      channel: targetChannel(),
      markdown: BODY,
      title: `${CORRELATION} — channel`,
    });
    const second = await transport.createChannelCanvas({
      channel: targetChannel(),
      markdown: BODY,
      title: `${CORRELATION} — channel again`,
    });

    expect(first.length).toBeGreaterThan(0);
    // THE measurement this file exists to pin, and it is the opposite of the obvious guess. The first draft
    // of this test asserted a `channel_canvas_already_exists` refusal, ran against the real API, and got two
    // `ok: true` responses carrying different ids. There is no per-conversation uniqueness to lean on, which
    // is why the create is at-most-once at the transport and gated against a re-run at the verb.
    expect(second).not.toBe(first);

    expect(await transport.deleteCanvas({ canvasId: first })).toBe(true);
    expect(await transport.deleteCanvas({ canvasId: second })).toBe(true);
  });
});
