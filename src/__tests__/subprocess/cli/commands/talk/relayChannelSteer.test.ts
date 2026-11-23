/**
 * The SHIPPED binary, end to end over a recorded incident: `talk relay` hears the owner move the draft held for
 * #proj-launch-room to #dev-alerts, and `slack post --draft` then refuses to release it into the launch channel.
 * The unit lane proves each half against the functions; this proves the two verbs meet through the register on disk.
 */
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unwrap } from "#lib/result.js";

import { appendSlackDraftEvent, readSlackDraftLines } from "../../../../../admit/slackDraftStore.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { foldSlackDrafts } from "../../../../../outbound/slack/draftFold.js";
import { parseSlackDraftLog } from "../../../../../outbound/slack/draftLog.js";
import { type ParkedSlackDraft, parkedDraftDigest } from "../../../../../outbound/slack/draftRegister.js";
import { storeAnnotatedShot } from "../../../../annotatedShotFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const TURN = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b";
const LAUNCH = { id: "C0SYN000001", name: "proj-launch-room" };
const ALERTS = { id: "C0SYN000006", name: "dev-alerts" };

let scratch = "";
let home = "";

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "slop-relay-steer-"));
  home = join(scratch, "home");
  mkdirSync(home);
  mkdirSync(join(scratch, "handovers"));
});

afterEach(() => {
  rmSync(scratch, { force: true, recursive: true });
});

/**
 * One held as-me row, top-level in a channel — a first message, so it carries the link and the annotated screenshot
 * that rule owes, and the release reaches the steer this test is about.
 */
function parked({ channel, id }: { channel: { id: string; name: string }; id: string }): ParkedSlackDraft {
  const content = {
    authorId: "U0ME",
    channel: channel.id,
    media: [storeAnnotatedShot({ home })],
    mentions: [],
    payload: {
      form: "plain" as const,
      text: "<https://linear.app/acme/issue/GGGG-1809|GGGG-1809> is a Vanta P1",
      unfurl_links: false,
      unfurl_media: false,
    },
  };
  return {
    ...content,
    advisory: [],
    channelName: channel.name,
    digest: parkedDraftDigest({ draft: content }),
    form: '{"sections":[{"kind":"prose","text":"GGGG-1809 is a Vanta P1"}]}',
    id,
    kind: "message",
    shape: "top-level",
    tsIso: "2026-10-12T00:10:00.000Z",
    why: "the incident's draft",
  };
}

/** Run the shipped binary against this file's home, with no inherited Slopweaver state. */
function run({ args }: { args: readonly string[] }): SpawnSyncReturns<string> {
  return spawnSync(BIN, [...args, "--home", home], {
    cwd: scratch,
    encoding: "utf8",
    // A shape-only fake, as `../slack/asMeBumpGate.fixture.test.ts` uses: the steer refusal fires off the register,
    // before any Slack call could use it.
    env: { HOME: scratch, PATH: process.env["PATH"]!, SLACK_USER_TOKEN: "xoxp-test" },
  });
}

describe("bin/slopweaver talk relay then slack post --draft, over the draft the owner moved to #dev-alerts", () => {
  it("records the steer from the owner's words and refuses the release into the launch channel", () => {
    const original = parked({ channel: LAUNCH, id: "sd-359bafb2" });
    for (const draft of [parked({ channel: ALERTS, id: "sd-aaaaaaaa" }), original]) {
      unwrap(appendSlackDraftEvent({ event: { draft, id: draft.id, kind: "parked", tsIso: draft.tsIso }, home }));
    }

    const relay = run({
      args: [
        "talk",
        "relay",
        "--turn",
        TURN,
        "--say",
        "The owner wants the GGGG-1809 draft in dev-alerts instead.",
        "--heard",
        "No, this needs to go into dev alerts, not the launch channel.",
        "--about",
        `post:${original.id}`,
        "--screen-not-taken",
        "--dir",
        join(scratch, "handovers"),
        "--json",
      ],
    });
    expect([relay.status, relay.error]).toEqual([0, undefined]);
    const row = foldSlackDrafts({ events: parseSlackDraftLog({ lines: readSlackDraftLines({ home }) }).events }).find(
      (item) => item.id === original.id,
    )!;
    expect(row.steer!.channels).toEqual([ALERTS]);

    const release = run({
      args: ["slack", "post", "--as", "me", "--draft", original.id, "--approve", original.digest, "--dry-run"],
    });
    // A release refused off the row, before any live read, is the verb's usage exit, as an approval mismatch is.
    expect(release.status).toBe(EXIT_USAGE);
    expect(release.stderr).toContain("channel-steered-draft");
    expect(release.stderr).toContain(
      `Re-cut it into #dev-alerts: slopweaver slack draft record <the same flags> --channel ${ALERTS.id} --supersedes ${original.id}`,
    );
  });
});
