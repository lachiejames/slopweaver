/**
 * The stranded lane's writes — a real temp home, a plain fake transport, no network and no ambient home.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../admit/doorLedgerPort.js";
import { pickUpStrandedAsks } from "../../../../cli/commands/listen/strandedPickup.js";
import type { StrandedScan } from "../../../../cli/commands/listen/strandedSurvivors.js";
import type { PostedMessage, SlackWriteTransport } from "../../../../corpus/slack/writeTransport.js";
import { foldAskLifecycle, parseAskLifecycleLog } from "../../../../live/ask/lifecycle.js";
import { readAskLifecycleText } from "../../../../live/ask/store.js";
import type { RecoveryVerdict } from "../../../../live/listen/recover.js";
import type { StrandedAsk } from "../../../../live/listen/stranded.js";
import type { SlackDripMessagePayload } from "../../../../outbound/slack/types.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../doorLedgerFixture.js";

const ASK = { channel: "C1", messageTs: "1788606000.000100", threadTs: "1788606000.000100" } as const;
const NOW = "2026-09-05T12:00:00.000Z";

const STRANDED: StrandedAsk = {
  ask: ASK,
  reason: "this ask has been dispatch-failed for 60m and has never been re-dispatched",
  sinceMinutes: 60,
  strandedAs: "dispatch-failed",
  surface: "channel",
};

const VERDICT: RecoveryVerdict = {
  candidate: {
    ...ASK,
    rawText: "<@U_BOT> what broke staging",
    selfAuthored: false,
    surface: "channel",
    threadAnswers: [],
    threadMarks: [],
    tsIso: "2026-09-05T11:00:00.000Z",
    userId: "U_ASKER",
  },
  exclusions: [],
  mention: { ...ASK, surface: "channel", text: "@(U_BOT) what broke staging", userId: "U_ASKER" },
  why: [],
};

/** The one write seam this lane has, recording what it was asked to send. */
function recordingReply({ posts }: { posts: SentNotice[] }): SlackWriteTransport["postDripMessage"] {
  const posted: PostedMessage = { channel: ASK.channel, ts: "1788609600.000200" };
  return async ({ channel, payload }) => {
    posts.push({ channel, payload });
    return posted;
  };
}

/** One notice as the lane handed it to the write seam. */
interface SentNotice {
  channel: string;
  payload: SlackDripMessagePayload;
}

describe("pickUpStrandedAsks", () => {
  let home = "";
  const posts: SentNotice[] = [];
  const lines: string[] = [];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slopweaver-stranded-pickup-"));
    posts.length = 0;
    lines.length = 0;
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** The one entry point, with this test's own home, gates and transport. */
  const pickUp = ({
    doorLedger = memoryDoorLedger().port,
    scan,
  }: {
    doorLedger?: DoorLedgerPort;
    scan: StrandedScan;
  }): Promise<readonly RecoveryVerdict[]> =>
    pickUpStrandedAsks({
      doorLedger,
      home,
      log: ({ line }) => lines.push(line),
      nowIso: NOW,
      postReply: recordingReply({ posts }),
      scan,
      sendGates: [],
    });

  it("posts the notice, spends the ask and hands the verdict on", async () => {
    const verdicts = await pickUp({
      scan: {
        builderRunning: [],
        refused: [],
        reviewOpen: [],
        survivors: [{ stranded: STRANDED, verdict: VERDICT }],
      },
    });

    expect(verdicts).toEqual([VERDICT]);
    // The metadata is what makes the notice retractable: posted bare, `slack delete` refused it.
    expect(posts).toEqual([
      {
        channel: "C1",
        payload: {
          form: "plain",
          metadata: {
            event_payload: { artifactKind: "notice", renderer: "slack-notice-v1", schemaVersion: 1 },
            event_type: "slopweaver_notice_v1",
          },
          text: "Picking this back up — nothing ever ran on it the first time.",
          unfurl_links: false,
          unfurl_media: false,
        },
      },
    ]);
    const folded = foldAskLifecycle({
      events: [
        { ...ASK, kind: "captured", surface: "channel", tsIso: "2026-09-05T10:00:00.000Z", userId: "U_ASKER" },
        ...parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events,
      ],
    });

    expect([...folded.values()][0]?.redispatched).toEqual({
      ...ASK,
      kind: "redispatched",
      reason: STRANDED.reason,
      strandedAs: "dispatch-failed",
      tsIso: NOW,
    });
  });

  it("posts no notice when the door record cannot be written, says why, and still picks the ask up", async () => {
    const verdicts = await pickUp({
      doorLedger: unreachableDoorLedger(),
      scan: { builderRunning: [], refused: [], reviewOpen: [], survivors: [{ stranded: STRANDED, verdict: VERDICT }] },
    });

    expect(verdicts).toEqual([VERDICT]);
    expect(posts).toEqual([]);
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain("posting the re-dispatch notice not performed:");
    expect(lines[1]).toBe("the re-dispatch notice was not posted — picking it up anyway");
    expect(lines[2]).toBe("re-dispatching a stranded ask: C1/1788606000.000100 — dispatch-failed for 60m");
  });

  it("names every stranded ask it did not pick up", async () => {
    const verdicts = await pickUp({
      scan: {
        builderRunning: [],
        refused: [{ reason: "could not read its thread — channel_not_found", stranded: STRANDED }],
        reviewOpen: [],
        survivors: [],
      },
    });

    expect(verdicts).toEqual([]);
    expect(posts).toEqual([]);
    expect(readAskLifecycleText({ home })).toBe("");
    expect(lines).toEqual([
      "stranded, not picked up: C1/1788606000.000100 — could not read its thread — channel_not_found",
    ]);
  });

  it("reports an ask held back by an open review as skipped, spending and posting nothing", async () => {
    // `C0SYN000001/1790048248.995219`: the pass that did not check this posted a public notice reading "the
    // session working on it stopped before it could answer" over a session that never stopped — a plain-text
    // line, so no card finalisation can ever reach it, and it stands in that channel permanently.
    const verdicts = await pickUp({ scan: { builderRunning: [], refused: [], reviewOpen: [ASK], survivors: [] } });

    expect(verdicts).toEqual([]);
    expect(posts).toEqual([]);
    expect(readAskLifecycleText({ home })).toBe("");
    expect(lines).toEqual([
      "recovery skipped: C1/1788606000.000100 — IN REVIEW; the review record is open, so no re-dispatch was spent.",
    ]);
  });

  it("reports an ask whose plan's builder is still running as skipped, spending and posting nothing", async () => {
    const verdicts = await pickUp({ scan: { builderRunning: [ASK], refused: [], reviewOpen: [], survivors: [] } });

    expect(verdicts).toEqual([]);
    expect(posts).toEqual([]);
    expect(readAskLifecycleText({ home })).toBe("");
    expect(lines).toEqual([
      "recovery skipped: C1/1788606000.000100 — BUILDING; its plan is posted and the workspace of the worker " +
        "that posted it is still alive, so no re-dispatch was spent.",
    ]);
  });
});
