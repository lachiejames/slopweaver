/**
 * INTEGRATION test: posting a POLL to the REAL Slack Web API, recorded + replayed via Polly cassettes.
 *
 * Recording this POSTS FOR REAL, into the bot's own DM with the owner — never a live team channel. A poll in
 * a team channel is the owner's to send.
 *
 * ## What this can and cannot prove, stated up front
 *
 * The cassette policy redacts every response string whose key is not on the Slack allowlist, so a label comes
 * back `[REDACTED]` and no assertion here may depend on a string Slack echoes from us. Exact per-option
 * numbers therefore live in the unit lane, where `tallyPoll` is pure.
 *
 * What survives redaction and IS asserted here — the parts only a real API can establish:
 *   - the post happened and Slack returned a `ts` of the documented shape (`<seconds>.<micros>`);
 *   - the recorded message can be READ BACK from inside Slack's attachment wrapper rather than inferred
 *     from the post response;
 *   - `reactions.add` really SEEDS one clickable chip per ballot option (`count` IS a number, not a string, so
 *     it survives redaction);
 *   - `reactions.get` returns `undefined` for a message that is not there, which the caller must never
 *     confuse with "no reactions".
 *
 * Run:
 *   yarn test:integration                                                    # replay (default, offline)
 *   POLLY_MODE=record SLOPWEAVER_RECORD_SLACK_BOT_TOKEN=xoxb-… \
 *     SLOPWEAVER_RECORD_SLACK_DM=D… yarn test:integration                    # (re)record — POSTS FOR REAL
 */
import { WebClient } from "@slack/web-api";
import { beforeEach, describe, expect, it } from "vitest";

import { makeSlackWriteTransport } from "../../corpus/slack/writeApi.js";
import { PLACEMENT_OUT_OF_SCOPE } from "../../corpus/slack/writeGuardPlacement.js";
import { slopweaverHome } from "../../homeDir.js";
import { type PollArtifact, pollBallot } from "../../outbound/slack/pollForm.js";
import { renderPoll } from "../../outbound/slack/pollRender.js";
import { DEFAULT_POLL_METADATA_EVENT_TYPE as POLL_METADATA_EVENT_TYPE } from "../../profile.js";
import { REPEAT_GUARD_OUT_OF_SCOPE } from "../repeatGuardOutOfScope.js";
import { activePolly } from "../setup-polly.js";

const RECORD = process.env["POLLY_MODE"] === "record";

function botToken(): string {
  if (!RECORD) {
    return "xoxb-replay";
  }
  const token = process.env["SLOPWEAVER_RECORD_SLACK_BOT_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_SLACK_BOT_TOKEN to record the Slack poll cassette");
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

/**
 * A correlation marker in every recorded poll, so a re-record's artefacts are identifiable afterwards.
 *
 * The archive left a permanent `[Integration Test]` message behind on every re-record and had no cleanup
 * anywhere, which then degraded the selectors of later read tests. A marker is what makes "find and remove
 * what this run created" possible at all.
 */
const CORRELATION = "slopweaver-poll-integration";

function pollArtifact({ options }: { options: readonly string[] }): PollArtifact {
  return {
    kind: "poll",
    options,
    question: `Integration probe (${CORRELATION}) — which one?`,
    why: "Recording the poll write cassette.",
  };
}

function ballotFor({ options }: { options: readonly string[] }) {
  return pollBallot({ options: pollArtifact({ options }).options });
}

function payloadFor({ options }: { options: readonly string[] }) {
  const artifact = pollArtifact({ options });
  return renderPoll({
    artifact,
    ballot: ballotFor({ options }),
    chrome: {
      authorEmoji: ":robot_face:",
      authorLabel: "test-bot",
      bannerColor: "#8B5CF6",
      detailLabel: "*Details*",
      metadataEventType: "unused_card_v1",
    },
    metadataEventType: POLL_METADATA_EVENT_TYPE,
    pings: [],
    pollId: CORRELATION,
    // The cassette records into a DM, so the DM footer is what actually goes on the wire here.
    surface: "direct-message",
  });
}

/** Read the posted message back and return the block TYPES Slack stored (types survive redaction). */
async function blockTypesOf({ channel, ts }: { channel: string; ts: string }): Promise<readonly string[]> {
  const history = await new WebClient(botToken()).conversations.history({
    channel,
    inclusive: true,
    latest: ts,
    limit: 1,
  });
  const message = history.messages?.[0];
  if (message === undefined) {
    throw new Error("the poll could not be read back — nothing at that ts");
  }
  // The blocks live inside the ATTACHMENT (the wrapper is what draws the stripe), not at top level.
  const wrapped = message.attachments?.[0]?.blocks;
  if (wrapped !== undefined) {
    return wrapped.map((block) => blockTypeLabel({ block }));
  }
  // A message posted with no blocks carries no `blocks` field: it has no block types, and the assertion
  // below reads that empty list as the failure it is. `== null` because the payload is parsed JSON.
  const { blocks } = message;
  return blocks == null ? [] : blocks.map((block) => blockTypeLabel({ block }));
}

/**
 * A block's stored `type`. A block with no `type` would itself be a defect, so it is surfaced as the literal
 * `<no-type>` rather than dropped — dropping it would let a malformed block read as "no blocks" and pass the
 * assertion it feeds. `== null` because the payload is parsed JSON, where the field may arrive as `null`.
 */
function blockTypeLabel({ block }: { block: { readonly type?: string | null | undefined } }): string {
  const { type } = block;
  if (type == null) {
    return "<no-type>";
  }
  return type;
}

/**
 * Force ORDERED matching for this test file.
 *
 * Without it the shared lenient config (`body: false`, `order: false`) collapses the three `reactions.add`
 * calls — which differ only in the emoji name — onto ONE cassette entry, and the "all three chips landed"
 * assertion then replays a single recorded success three times. That is a green test proving a third of what it
 * claims, which is the exact failure mode the cassette policy warns about for read-after-write.
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

describe("slack poll (integration — real Slack via Polly cassette)", () => {
  beforeEach(() => {
    requireOrderedMatching();
  });

  it("posts a poll and reads back the confirmed message identity", async () => {
    const payload = payloadFor({ options: ["Waiting on someone", "Fighting CI", "Meetings"] });

    // Asserted BEFORE the wire: the first five blocks are the full chrome and the sixth is the footer below
    // Details, while the complete question and ballot stay together in block two above the fold.
    expect(payload.attachments[0].blocks.length).toBe(6);

    const posted = await makeSlackWriteTransport({
      home: slopweaverHome(),
      placementSeams: PLACEMENT_OUT_OF_SCOPE,
      repeatSeams: REPEAT_GUARD_OUT_OF_SCOPE,
      token: botToken(),
    }).postPoll({
      channel: targetChannel(),
      payload,
    });

    // A Slack ts is `<seconds>.<micros>` — assertable shape, and not a string Slack echoes back from us.
    expect(/^\d{10}\.\d{6}$/.test(posted.ts)).toBe(true);
    expect(posted.channel.length).toBeGreaterThan(0);
  });

  it("PROVES the poll is really there by reading it back, never by trusting the post response", async () => {
    const payload = payloadFor({ options: ["Yes", "No"] });
    const posted = await makeSlackWriteTransport({
      home: slopweaverHome(),
      placementSeams: PLACEMENT_OUT_OF_SCOPE,
      repeatSeams: REPEAT_GUARD_OUT_OF_SCOPE,
      token: botToken(),
    }).postPoll({
      channel: targetChannel(),
      payload,
    });

    // This is the last live-recorded wrapper topology. The unit lane pins the current six-block request;
    // re-recording this cassette after live dogfood will replace this provider response with the new topology.
    expect(await blockTypesOf({ channel: posted.channel, ts: posted.ts })).toEqual([
      "header",
      "section",
      "section",
      "context",
    ]);
  });

  it("SEEDS a clickable chip per option and reads the live counts back", async () => {
    // The whole point of seeding: a voter clicks an existing chip instead of looking up an emoji name. This is
    // the only lane that can prove the chips actually land on a real message, in ballot order.
    const options = ["Waiting on someone", "Fighting CI"];
    const transport = makeSlackWriteTransport({
      home: slopweaverHome(),
      placementSeams: PLACEMENT_OUT_OF_SCOPE,
      repeatSeams: REPEAT_GUARD_OUT_OF_SCOPE,
      token: botToken(),
    });
    const posted = await transport.postPoll({ channel: targetChannel(), payload: payloadFor({ options }) });

    const ballot = ballotFor({ options });
    const landed: boolean[] = [];
    for (const entry of ballot) {
      landed.push(await transport.addReaction({ name: entry.emojiName, posted }));
    }

    expect(landed).toEqual(ballot.map(() => true));

    // Read the counts back LIVE. Every chip is slopweaver's own, so every count is exactly 1 — which is also
    // what the tally subtracts, so a freshly-posted poll correctly reads as zero HUMAN votes.
    const live = await transport.readReactions({ posted });

    expect(live?.length).toBe(ballot.length);
    expect(live?.every((reaction) => reaction.count === 1)).toBe(true);
  });

  it("reads back `undefined` for a message that is not there — not the same as no reactions", async () => {
    const gone = await makeSlackWriteTransport({
      home: slopweaverHome(),
      placementSeams: PLACEMENT_OUT_OF_SCOPE,
      repeatSeams: REPEAT_GUARD_OUT_OF_SCOPE,
      token: botToken(),
    }).readReactions({
      posted: { channel: targetChannel(), ts: "1500000000.000001" },
    });

    expect(gone).toBeUndefined();
  });
});
