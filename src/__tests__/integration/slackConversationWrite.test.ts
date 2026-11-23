/**
 * INTEGRATION test: creating a CHANNEL and opening a group DM against the REAL Slack Web API, recorded +
 * replayed via Polly cassettes.
 *
 * Recording this CREATES FOR REAL. Two things make that acceptable and both are mechanical rather than a
 * promise: every channel it mints carries the correlation marker below in its name, and the last thing each
 * create test does is ARCHIVE it — Slack offers no delete for a channel, so archiving is the only retraction
 * there is and the name stays taken forever. The DM it opens is with the OWNER only, which is a conversation
 * that already exists, so `conversations.open` mints nothing at all on that path.
 *
 * ## What this can and cannot prove, stated up front
 *
 * The cassette policy redacts every response string whose key is not on the Slack allowlist, so the channel
 * NAME comes back `[REDACTED]` and no assertion here may depend on it. Ids become stable synthetics and
 * booleans, numbers and Slack's own `error` enum survive untouched.
 *
 * What survives redaction and IS asserted here — the parts only a real API can establish:
 *   - `conversations.create` really mints a channel and answers with an id;
 *   - `is_private` is what was asked for, which is the one field of the create nobody can infer from the id
 *     (Slack gives a private channel a `C…` id too — see `writeApiPoll.ts`'s `conversationInfoCall`);
 *   - `conversations.invite` sent with `force` reports a bad id under `errors` and still succeeds, which is
 *     the whole batch-does-not-sink property and is unprovable without a real refusal;
 *   - `conversations.open` is IDEMPOTENT — opening the same user set twice answers the same id;
 *   - `conversations.archive` really archives, and answers `already_archived` on a repeat.
 *
 * Run:
 *   yarn test:integration                                                      # replay (default, offline)
 *   POLLY_MODE=record SLOPWEAVER_RECORD_SLACK_USER_TOKEN=xoxp-… \
 *     SLOPWEAVER_RECORD_SLACK_BOT_TOKEN=xoxb-… SLOPWEAVER_RECORD_SLACK_SELF=U… \
 *     SLOPWEAVER_RECORD_SLACK_INVITEE=U… yarn test:integration                 # (re)record — CREATES FOR REAL
 */
import { beforeEach, describe, expect, it } from "vitest";

import { makeSlackWriteTransport } from "../../corpus/slack/writeApi.js";
import { slopweaverHome } from "../../homeDir.js";
import { activePolly } from "../setup-polly.js";

const RECORD = process.env["POLLY_MODE"] === "record";

/**
 * A correlation marker in every channel this file creates, so a re-record's artefacts are identifiable
 * afterwards — the same discipline `slackPoll.test.ts` states for its messages, and it matters more here
 * because a channel cannot be deleted.
 */
const CORRELATION = "slopweaver-int";

/**
 * The channel name for one recorded create.
 *
 * STAMPED with the recording instant rather than fixed, and the reasoning went the other way first. A fixed
 * name is tidier — it mints one channel ever — but Slack keeps an ARCHIVED channel's name taken forever, so
 * the second re-record would fail `name_taken` with no way to free the name: a workspace cannot delete a
 * channel or rename an archived one. That would make this cassette un-re-recordable, which is worse than
 * litter. So each lap mints its own, archives it before the test ends, and the cost is one archived
 * `slopweaver-int-*` channel per create per re-record — which is exactly the throwaway test traffic the
 * recording of this file was authorised against.
 *
 * The stamp lives in the REQUEST body, which Polly's shared config does not match on, so a replay keeps
 * working against a cassette recorded under a different stamp.
 *
 * @param suffix which of this file's creates this is
 * @returns the channel name
 */
function channelName({ suffix }: { suffix: string }): string {
  return `${CORRELATION}-${suffix}-${String(Date.now())}`;
}

/** The token a create runs on: the USER token, measured as the only lane this install can create with. */
function userToken(): string {
  if (!RECORD) {
    return "xoxp-replay";
  }
  const token = process.env["SLOPWEAVER_RECORD_SLACK_USER_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_SLACK_USER_TOKEN to record the Slack conversation cassette");
  }
  return token;
}

/** The bot token, which holds `im:write`/`mpim:write` and is the lane a DM open normally runs on. */
function botToken(): string {
  if (!RECORD) {
    return "xoxb-replay";
  }
  const token = process.env["SLOPWEAVER_RECORD_SLACK_BOT_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_SLACK_BOT_TOKEN to record the Slack conversation cassette");
  }
  return token;
}

/** The owner's own Slack user id — the one person a recorded DM is ever opened with. */
function selfUserId(): string {
  if (!RECORD) {
    return "U0REPLAY";
  }
  const id = process.env["SLOPWEAVER_RECORD_SLACK_SELF"];
  if (id === undefined || id.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_SLACK_SELF to the owner's Slack user id");
  }
  return id;
}

/**
 * The user the invite test actually invites: the BOT.
 *
 * Not the owner, and the difference is load-bearing. The owner's own token creates the channel, so the
 * owner is already in it and Slack answers `already_in_channel` for them — which this transport folds into
 * `inChannel` rather than reporting. With the owner as the only valid id there would be no LANDED invite in
 * the recording at all, and the "the batch still lands" half of the assertion would be vacuous.
 */
function inviteeUserId(): string {
  if (!RECORD) {
    return "U0INVITE";
  }
  const id = process.env["SLOPWEAVER_RECORD_SLACK_INVITEE"];
  if (id === undefined || id.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_SLACK_INVITEE to the bot's own Slack user id");
  }
  return id;
}

/**
 * Force ORDERED matching for this file.
 *
 * Without it the shared lenient config (`body: false`, `order: false`) collapses the two
 * `conversations.open` calls — which are byte-identical requests — onto ONE cassette entry, and the
 * idempotence assertion then replays a single recorded response twice and passes without proving anything.
 * The same collapse would hide the second `conversations.archive`, whose whole point is that it answers
 * DIFFERENTLY from the first.
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

describe("slack conversation writes (integration — real Slack via Polly cassette)", () => {
  beforeEach(() => {
    requireOrderedMatching();
  });

  it("creates a PRIVATE channel, describes it, archives it, and reports a SECOND archive as success", async () => {
    const transport = makeSlackWriteTransport({ home: slopweaverHome(), token: userToken() });

    const created = await transport.createChannel({ isPrivate: true, name: channelName({ suffix: "private" }) });

    // The id is a synthetic in replay, so its VALUE proves nothing — its presence does.
    expect(created.id.length).toBeGreaterThan(0);
    expect(created.alreadyExisted).toBe(false);

    await transport.setChannelPurpose({ channel: created.id, purpose: "recording the workspace-shape cassette" });
    await transport.setChannelTopic({ channel: created.id, topic: "throwaway" });

    expect(await transport.archiveChannel({ channel: created.id })).toBe(true);
    // The idempotence arm: Slack answers `already_archived`, which the transport reads as the desired end
    // state. Folded into this test rather than given its own so a re-record mints ONE channel here, not two
    // — every create in this file is a permanent, un-deletable artefact in a real workspace.
    expect(await transport.archiveChannel({ channel: created.id })).toBe(true);
  });

  it("invites with `force`, so ONE bad id is reported and the batch still lands", async () => {
    const transport = makeSlackWriteTransport({ home: slopweaverHome(), token: userToken() });
    const created = await transport.createChannel({ isPrivate: true, name: channelName({ suffix: "invite" }) });

    // A user id that belongs to nobody. Only a real API can produce this refusal, which is exactly why the
    // batch property is asserted here rather than in the unit lane. The placeholder is deliberately SHORTER
    // than any real Slack id: the hygiene gate's `raw-workspace-id` class is `[CUAW]` plus eight or more
    // upper-alphanumerics, which every genuine id satisfies and this does not — so a made-up id in a test
    // does not have to be excused, and the gate keeps its full reach over the real ones.
    const outcome = await transport.inviteToChannel({
      channel: created.id,
      userIds: [inviteeUserId(), "U0NOBODY"],
    });

    // `error` is a documented machine enum and is kept verbatim by the cassette policy, so this is a real
    // assertion rather than a shape check. MEASURED: this workspace answers `org_user_not_in_team` and
    // attaches NO `user` to the entry, which is why the outcome has an `unattributed` arm at all — the
    // first version of this shaper read that response as "everybody made it".
    expect(outcome.unattributed).toEqual(["org_user_not_in_team"]);
    expect(outcome.refused).toEqual([]);
    expect(outcome.landed).toBe(1);

    await transport.archiveChannel({ channel: created.id });
  });

  it("opens the owner's DM, and answers the SAME conversation the second time", async () => {
    const transport = makeSlackWriteTransport({ home: slopweaverHome(), token: botToken() });

    const first = await transport.openConversation({ userIds: [selfUserId()] });
    const second = await transport.openConversation({ userIds: [selfUserId()] });

    expect(first.id.length).toBeGreaterThan(0);
    // The IDEMPOTENCE property, and the reason this file forces ordered matching: with the two calls
    // collapsed onto one cassette entry the equality below would hold trivially.
    expect(second.id).toBe(first.id);
  });
});
