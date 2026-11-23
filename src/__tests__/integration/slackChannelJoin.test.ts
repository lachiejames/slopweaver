/**
 * INTEGRATION test: `conversations.join` on the USER token against the REAL Slack Web API, recorded + replayed via
 * Polly cassettes — the transport half of an approved as-me release joining a public channel the owner is not in
 * (`../../cli/commands/slack/releaseJoin.ts`).
 *
 * Recording this CREATES FOR REAL, exactly as `./slackConversationWrite.test.ts` does, under the same two mechanical
 * guards: every channel carries the `slopweaver-int` correlation marker in its name, and each test ARCHIVES what it
 * minted before it ends — Slack offers no delete for a channel.
 *
 * ## What this can and cannot prove, stated up front
 *
 * A join FROM OUTSIDE needs a public channel the recording account is not in, and the only channel a lap can mint is
 * one its own token created, which it is in already. So the fresh join is not recorded here: it is the release's gold
 * proof, a live post as the owner into a public channel they were not in, witnessed by its permalink. What a cassette CAN
 * establish, and only a real API can:
 *   - `conversations.join` on a public channel the account is in answers `ok` with Slack's `already_in_channel`
 *     WARNING, which the transport reads as `alreadyMember` (kept verbatim by the cassette policy's `warning` key);
 *   - a private channel is refused by Slack itself (`method_not_supported_for_channel_type`), the refusal
 *     `../../outbound/slack/channelJoin.ts` never asks for;
 *   - an archived channel is refused `is_archived`, the shape a release holds `slack-refused` on.
 *
 * Run:
 *   yarn test:integration                                                         # replay (default, offline)
 *   POLLY_MODE=record SLOPWEAVER_RECORD_SLACK_USER_TOKEN=xoxp-… yarn test:integration    # (re)record — CREATES FOR REAL
 */
import { beforeEach, describe, expect, it } from "vitest";

import { makeSlackWriteTransport } from "../../corpus/slack/writeApi.js";
import { slopweaverHome } from "../../homeDir.js";
import { activePolly } from "../setup-polly.js";

const RECORD = process.env["POLLY_MODE"] === "record";

/** A channel name per recorded create, stamped so a re-record never meets an archived channel's taken name. */
function channelName({ suffix }: { suffix: string }): string {
  return `slopweaver-int-${suffix}-${String(Date.now())}`;
}

/** The USER token: a join on it puts the owner's account in the channel, which is the act under test. */
function userToken(): string {
  if (!RECORD) {
    return "xoxp-replay";
  }
  const token = process.env["SLOPWEAVER_RECORD_SLACK_USER_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_SLACK_USER_TOKEN to record the Slack channel-join cassette");
  }
  return token;
}

/** Ordered matching, so two byte-identical joins of one channel keep their two different answers. */
function requireOrderedMatching(): void {
  const polly = activePolly();
  if (polly === undefined) {
    return;
  }
  polly.server.any().on("request", (req) => {
    req.configure({ matchRequestsBy: { order: true } });
  });
}

/** The Slack error code a refused call threw, read off the SDK's platform error. */
async function refusalOf({ attempt }: { attempt: () => Promise<unknown> }): Promise<string> {
  try {
    await attempt();
  } catch (cause: unknown) {
    return cause instanceof Error ? cause.message : String(cause);
  }
  return "no refusal";
}

describe("slack channel join (integration — real Slack via Polly cassette)", () => {
  beforeEach(() => {
    requireOrderedMatching();
  });

  it("answers already_in_channel on a public channel the account holds, and is_archived once it is archived", async () => {
    const transport = makeSlackWriteTransport({ home: slopweaverHome(), token: userToken() });
    const created = await transport.createChannel({ isPrivate: false, name: channelName({ suffix: "join" }) });

    const joined = await transport.joinChannel({ channel: created.id, confirm: () => true });

    expect(joined.id).toBe(created.id);
    expect(joined.alreadyMember).toBe(true);

    expect(await transport.archiveChannel({ channel: created.id })).toBe(true);
    expect(
      await refusalOf({ attempt: () => transport.joinChannel({ channel: created.id, confirm: () => true }) }),
    ).toContain("is_archived");
  });

  it("is refused by Slack itself on a private channel", async () => {
    const transport = makeSlackWriteTransport({ home: slopweaverHome(), token: userToken() });
    const created = await transport.createChannel({ isPrivate: true, name: channelName({ suffix: "join-private" }) });

    const refusal = await refusalOf({
      attempt: () => transport.joinChannel({ channel: created.id, confirm: () => true }),
    });

    expect(refusal).toContain("method_not_supported_for_channel_type");
    await transport.archiveChannel({ channel: created.id });
  });
});
