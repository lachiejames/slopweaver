/**
 * INTEGRATION test: the Slack WRITE seam against the REAL Slack Web API, recorded + replayed via
 * Polly cassettes (see `setup-polly.ts` + `cassetteRedact.ts`).
 *
 * Recording this POSTS FOR REAL. It records into the bot's own DM with the owner — never a live team
 * channel — because a write cassette cannot be produced any other way, and a throwaway workspace was
 * rejected as too thin to be evidence of anything.
 *
 * ## Why every assertion here is structural, and what that rules out
 *
 * The locked cassette policy redacts EVERY response-body string whose key is not on the per-provider
 * allowlist. `text` is not on it and must never be added — allowlisting it would leak arbitrary Slack
 * content into a public repo, which is precisely what the policy exists to prevent. So in a committed
 * cassette a label is `[REDACTED]`, a URL collapses to `origin/[REDACTED]`, and an em-dash is
 * unobservable.
 *
 * **Therefore no assertion here may depend on a string Slack echoes back.** What survives redaction,
 * and is asserted below: the block/element TYPE sequence, block and element COUNTS, boolean `style`
 * flags, `files.length`, and the shape of a `ts`. Every string-level case lives in the unit lane,
 * where the renderer is pure and the whole block array can be compared exactly.
 *
 * Run:
 *   yarn test:integration                                                   # replay (default, offline)
 *   POLLY_MODE=record SLOPWEAVER_RECORD_SLACK_BOT_TOKEN=xoxb-… \
 *     SLOPWEAVER_RECORD_SLACK_DM=D… yarn test:integration                   # (re)record — POSTS FOR REAL
 */
import { describe, expect, it } from "vitest";

import { makeSlackWriteAuth } from "../../connect/probes.js";
import { SLACK_REQUIRED_WRITE_SCOPES, type SlackWriteAuth } from "../../connect/slack.js";
import { makeSlackWriteTransport } from "../../corpus/slack/writeApi.js";
import { PLACEMENT_OUT_OF_SCOPE } from "../../corpus/slack/writeGuardPlacement.js";
import { runCompositeSend } from "../../corpus/slack/writeSend.js";
import type { UploadReadiness } from "../../corpus/slack/writeTransport.js";
import { slopweaverHome } from "../../homeDir.js";
import { orThrow } from "../../lib/safeBoundary.js";
import type { UpdateArtifact } from "../../outbound/artifact/types.js";
import { renderUpdateCard } from "../../outbound/slack/render.js";
import type { SlackCardChrome } from "../../outbound/slack/types.js";
import { admitAll } from "../imageAdmitFake.js";
import { REPEAT_GUARD_OUT_OF_SCOPE } from "../repeatGuardOutOfScope.js";

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

/** Neutral chrome — never a real operator's bot name; this repo is public. */
const CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "slopweaver",
  bannerColor: "#12B5A6",
  detailLabel: "*Details*",
  metadataEventType: "slopweaver_card_v1",
};

/** Recording posts for real, so each case is visibly a test in the DM. */
function artifactFor({ label, detail }: { label: string; detail: UpdateArtifact["detail"] }): UpdateArtifact {
  return { citations: [], detail, index: [], kind: "update", media: [], tldr: `integration ${label}` };
}

function payloadFor({ artifact }: { artifact: UpdateArtifact }) {
  return renderUpdateCard({
    artifact,
    artifactFingerprint: "integration",
    chrome: CHROME,
    mentions: { groups: new Map(), people: new Map() },
  });
}

/** Uploads are already complete by the time the seam polls in a cassette; the race is unit-tested. */
const READY: UploadReadiness = { waitForFile: async () => ({ kind: "ready", polls: 1, waitedMs: 0 }) };

function tinyPng(): Uint8Array {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

/**
 * The write token's auth seam, or a throw. A narrowing `if` inside an assertion would let the test pass
 * silently on the wrong branch, so the branch is resolved HERE and loudly.
 */
function writeAuthOf({ probe }: { probe: SlackWriteAuth }): Extract<SlackWriteAuth, { kind: "probe" }>["auth"] {
  if (probe.kind !== "probe") {
    throw new Error(`expected a probeable bot token, got ${probe.kind}`);
  }
  return probe.auth;
}

describe("slack write preflight (integration — real Slack via Polly cassette)", () => {
  it("proves the BOT token's OWN auth.test and scope list — never the read token's", async () => {
    // The shipped defect reported the read token's scopes as the write verdict, green-lighting a send on a
    // box where `slack post` could not send at all. This asserts the seam that replaced it: one `auth.test`
    // with the xoxb, and the granted scopes lifted off its `x-oauth-scopes` header. No write is attempted —
    // discovering you can post by posting is indistinguishable from posting.
    const auth = orThrow({
      result: await writeAuthOf({ probe: makeSlackWriteAuth({ lane: "bot", token: botToken() }) })(),
    });

    expect(auth.reachable).toBe(true);
    expect(SLACK_REQUIRED_WRITE_SCOPES.every((scope) => auth.scopes.includes(scope))).toBe(true);
  });
});

describe("slack write (integration — real Slack via Polly cassette)", () => {
  it("posts a six-block card and reads back the confirmed message identity", async () => {
    const artifact = artifactFor({
      detail: [{ runs: [{ text: "A single paragraph of detail.", type: "text" }], type: "paragraph" }],
      label: "six-block card",
    });
    const payload = payloadFor({ artifact });

    // The card the renderer produced is what makes the fold fire: SIX blocks in ONE wrapper.
    expect(payload.attachments[0].blocks.length).toBe(6);

    const result = await runCompositeSend({
      admit: admitAll().admit,
      channel: targetChannel(),
      payload,
      readiness: READY,
      transport: makeSlackWriteTransport({
        home: slopweaverHome(),
        placementSeams: PLACEMENT_OUT_OF_SCOPE,
        repeatSeams: REPEAT_GUARD_OUT_OF_SCOPE,
        token: botToken(),
      }),
      uploads: [],
    });

    expect(result.ok).toBe(true);
    expect(result.fileIds).toEqual([]);
    // A Slack ts is `<seconds>.<micros>` — assertable shape, and not a string Slack echoes from us.
    expect(/^\d{10}\.\d{6}$/.test(result.ts)).toBe(true);
  });

  it("posts a card whose detail mixes a paragraph, bullets and a native table", async () => {
    const artifact = artifactFor({
      detail: [
        {
          runs: [
            { bold: true, text: "Lead-in: ", type: "text" },
            { text: "then prose.", type: "text" },
          ],
          type: "paragraph",
        },
        { items: [[{ text: "first", type: "text" }], [{ text: "second", type: "text" }]], type: "bullets" },
        {
          columns: ["Probe", "Folds"],
          rows: [[[{ text: "A4", type: "text" }], [{ text: "yes", type: "text" }]]],
          type: "table",
        },
        { runs: [{ text: "A closing paragraph after the table.", type: "text" }], type: "paragraph" },
      ],
      label: "mixed detail",
    });
    const payload = payloadFor({ artifact });

    // A table cannot nest inside rich_text, so it breaks the group: chrome, grouped prose, table, tail.
    expect(payload.attachments[0].blocks.map((block) => block.type)).toEqual([
      "context",
      "divider",
      "rich_text",
      "divider",
      "context",
      "rich_text",
      "table",
      "rich_text",
    ]);

    const result = await runCompositeSend({
      admit: admitAll().admit,
      channel: targetChannel(),
      payload,
      readiness: READY,
      transport: makeSlackWriteTransport({
        home: slopweaverHome(),
        placementSeams: PLACEMENT_OUT_OF_SCOPE,
        repeatSeams: REPEAT_GUARD_OUT_OF_SCOPE,
        token: botToken(),
      }),
      uploads: [],
    });

    expect(result.ok).toBe(true);
  });

  it("attaches ONE file and proves it by reading the message back, never by trusting ok:true", async () => {
    const artifact = artifactFor({
      detail: [{ runs: [{ text: "One file rides along.", type: "text" }], type: "paragraph" }],
      label: "one file",
    });

    const result = await runCompositeSend({
      admit: admitAll().admit,
      channel: targetChannel(),
      payload: payloadFor({ artifact }),
      readiness: READY,
      transport: makeSlackWriteTransport({
        home: slopweaverHome(),
        placementSeams: PLACEMENT_OUT_OF_SCOPE,
        repeatSeams: REPEAT_GUARD_OUT_OF_SCOPE,
        token: botToken(),
      }),
      uploads: [{ bytes: tinyPng(), filename: "one.png" }],
    });

    expect(result.fileIds.length).toBe(1);
  });

  it("attaches TWO files of different types on a single card", async () => {
    const artifact = artifactFor({
      detail: [{ runs: [{ text: "Two files, mixed types.", type: "text" }], type: "paragraph" }],
      label: "two files",
    });

    const result = await runCompositeSend({
      admit: admitAll().admit,
      channel: targetChannel(),
      payload: payloadFor({ artifact }),
      readiness: READY,
      transport: makeSlackWriteTransport({
        home: slopweaverHome(),
        placementSeams: PLACEMENT_OUT_OF_SCOPE,
        repeatSeams: REPEAT_GUARD_OUT_OF_SCOPE,
        token: botToken(),
      }),
      uploads: [
        { bytes: tinyPng(), filename: "two-a.png" },
        { bytes: Buffer.from("integration probe\n", "utf8"), filename: "two-b.txt" },
      ],
    });

    expect(result.fileIds.length).toBe(2);
  });

  it("replies inside a thread, carrying the parent timestamp", async () => {
    const transport = makeSlackWriteTransport({
      home: slopweaverHome(),
      placementSeams: PLACEMENT_OUT_OF_SCOPE,
      repeatSeams: REPEAT_GUARD_OUT_OF_SCOPE,
      token: botToken(),
    });
    const parent = await runCompositeSend({
      admit: admitAll().admit,
      channel: targetChannel(),
      payload: payloadFor({
        artifact: artifactFor({
          detail: [{ runs: [{ text: "The parent of a threaded reply.", type: "text" }], type: "paragraph" }],
          label: "thread parent",
        }),
      }),
      readiness: READY,
      transport,
      uploads: [],
    });

    const reply = await runCompositeSend({
      admit: admitAll().admit,
      channel: targetChannel(),
      payload: payloadFor({
        artifact: artifactFor({
          detail: [{ runs: [{ text: "The reply itself.", type: "text" }], type: "paragraph" }],
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
