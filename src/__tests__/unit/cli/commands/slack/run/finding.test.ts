import { Jimp } from "jimp";
import { afterEach, describe, expect, it } from "vitest";
import { storeSlackDraftMedia } from "../../../../../../admit/slackDraftMediaStore.js";
import { runSlackDraftWithDeps, type SlackDraftDeps } from "../../../../../../cli/commands/slack/draftRun.js";
import type { SlackWriteDeps } from "../../../../../../cli/commands/slack/run.js";
import { runSlackWrite } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { EMPTY_ORG_CHART } from "../../../../../../corpus/members/orgChartIndex.js";
import type { SlackUpload } from "../../../../../../corpus/slack/writeTransport.js";
import { HisWordsErrors } from "../../../../../../handover/hisWordsErrors.js";
import { err, ok, unwrap } from "../../../../../../lib/result.js";
import { BOT_FORM_KINDS } from "../../../../../../outbound/artifact/botFormKinds.js";
import {
  type ParkedSlackDraft,
  type SlackDraftEvent,
  slackDraftEventLine,
} from "../../../../../../outbound/slack/draftRegister.js";
import type { SlackCardPayload } from "../../../../../../outbound/slack/types.js";
import { imageDigestOf } from "../../../../../../visualEvidence/imageIo.js";
import { appendImageRecord } from "../../../../../../visualEvidence/store.js";
import { annotatedRecord } from "../../../../../annotatedShotFixture.js";
import { deps } from "./deps.js";
import { CHROME, freshHome, platformError, type Recorder, recorder, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite — a finding is one top-level post in the team's channel on the owner's yes", () => {
  const FINDING_FORM = JSON.stringify(BOT_FORM_KINDS.find((entry) => entry.kind === "finding")!.fixtures[0]);
  const COLOURS = [0xff0000ff, 0x00ff00ff, 0x0000ffff];

  /** The fake deps, reading each `--media` path as a distinct real PNG chosen by its name. */
  function findingDeps({ rec }: { rec: Recorder }): SlackWriteDeps {
    return {
      ...deps({ rec }),
      readMedia: async ({ path }) => {
        const image = new Jimp({ color: COLOURS[Number(path.slice(0, 1))]!, height: 8, width: 8 });
        return { bytes: new Uint8Array(await image.getBuffer("image/png")), filename: path };
      },
    };
  }

  /** The argv for one finding post, with the channel, purpose and media overridable. */
  function findingArgv({ channel = "D0PROMPT", media = "0.png,1.png,2.png" }: { channel?: string; media?: string }) {
    return ["--as", "bot", "--channel", channel, "--form", FINDING_FORM, "--home", freshHome()].concat([
      "--dm-purpose",
      "investigation-finding",
      "--media",
      media,
    ]);
  }

  it("REFUSES a finding posted straight to the owner's DM, three distinct pictures and all — never a DM", async () => {
    const rec = recorder();

    const code = await runSlackWrite({ argv: findingArgv({}), deps: findingDeps({ rec }), verb: "post" });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.sends.length).toBe(0);
  });

  it("REFUSES a DRY RUN of a finding for the owner's DM too, printing no preview of a post that cannot happen", async () => {
    const rec = recorder();
    const out: string[] = [];

    const code = await runSlackWrite({
      argv: findingArgv({}).concat(["--dry-run"]),
      deps: { ...findingDeps({ rec }), out: (line) => out.push(line) },
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(out).toEqual([]);
    expect(rec.sends.length).toBe(0);
  });

  it("REFUSES an unapproved finding in a team channel before anything is sent", async () => {
    const rec = recorder();

    const code = await runSlackWrite({
      argv: findingArgv({ channel: "C1" }),
      deps: findingDeps({ rec }),
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.sends.length).toBe(0);
  });

  it("REFUSES a finding as a thread reply", async () => {
    const rec = recorder();

    const code = await runSlackWrite({
      argv: findingArgv({}).concat(["--thread-ts", "1727500000.000100"]),
      deps: findingDeps({ rec }),
      verb: "reply",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.sends.length).toBe(0);
  });

  it("REFUSES to park a finding carrying one picture three times, recording nothing", async () => {
    const rec = recorder();

    const { code, events } = await recordBotFinding({ media: "0.png,0a.png,0b.png", rec });

    expect(code).toBe(EXIT_USAGE);
    expect(events).toEqual([]);
    expect(rec.sends.length).toBe(0);
  });

  /** A parked `--as bot` finding for C1 carrying three distinct pictures, asserted parked. */
  async function parkedBotFinding({ rec }: { rec: Recorder }): Promise<{
    readonly events: SlackDraftEvent[];
    readonly home: string;
    readonly store: Map<string, SlackUpload>;
  }> {
    const { code, events, home, store } = await recordBotFinding({ media: "0.png,1.png,2.png", rec });
    expect(code).toBe(EXIT_OK);
    return { events, home, store };
  }

  /**
   * An `--as bot` finding for C1, recorded through the real `slack draft record --as bot` over the same fakes the
   * send uses, with a register and a media store held in memory so the release reads what was written.
   */
  async function recordBotFinding({ rec, media }: { rec: Recorder; media: string }): Promise<{
    readonly code: number;
    readonly events: SlackDraftEvent[];
    readonly home: string;
    readonly store: Map<string, SlackUpload>;
  }> {
    const base = findingDeps({ rec });
    const events: SlackDraftEvent[] = [];
    const store = new Map<string, SlackUpload>();
    const home = freshHome();
    const draftDeps: SlackDraftDeps = {
      ...base,
      appendEvent: ({ event }) => {
        events.push(event);
        return ok(true);
      },
      // A bot finding owes no Codex draft, so neither is reached.
      codexDraft: async () => ({ kind: "unavailable", reason: "a bot finding owes no Codex draft" }),
      consoleBase: () => "http://localhost:3000",
      conversationInfo: async () => ({ name: "team-eng", surface: "public-channel" }),
      loadVoiceBrief: () => ok({ paragraphSpacing: false, rules: [], shape: null }),
      lockRegister: () => ok(() => undefined),
      loadMembers: () => ({ rows: [], warnings: [] }),
      loadOrgChart: () => ({ chart: EMPTY_ORG_CHART, warnings: [] }),
      mintId: () => "sd-0b0b0b0b",
      nowIso: () => "2026-09-29T00:00:00.000Z",
      // A finding is neither a bump nor a review ask, so the settled-chase hold reads nothing.
      pullRequestState: async () => ({ kind: "notChecked" }),
      // Each picture is resolved with the annotated, unobstructed record a first message in a channel owes, as `browser image-record` would have filed it.
      prepareMedia: async ({ paths }) => {
        const uploads = await Promise.all(paths.map(async (path) => base.readMedia({ path })));
        const evidence = uploads.map((upload) => {
          const digest = imageDigestOf({ bytes: upload.bytes });
          const artifact = { digest, heightPx: 8, widthPx: 8 };
          return {
            artifact,
            records: [annotatedRecord({ digest, over: { artifact } })],
            ref: { artifactDigest: digest, path: upload.filename },
          };
        });
        return ok({ evidence, exceptionOpened: false, uploads });
      },
      readConversation: async () => ok({ hasMore: false, rows: [], workspaceUrl: "https://example.slack.com" }),
      fenceCallWrites: () => ok({ recheck: () => undefined, release: () => undefined }),
      readApprovalLaterRelays: () => ok([]),
      readOwnerWords: ({ anchor }) => err(HisWordsErrors.recordMissing({ anchor, what: "no words seeded" })),
      readLandedDrafts: () => ({ bindings: { bound: [], unreadable: [] }, kind: "read", ledgerRows: 0, vanished: [] }),
      readLog: () => [],
      readSteerReceipts: () => ok({ rows: [], undecoded: 0 }),
      readVoiceRules: () => ok([]),
      // The bytes land in the real private media store under `home`, with the annotated record filed for each, because
      // the release re-judges the first-message proof from those stores rather than from anything the row carries.
      storeMedia: ({ uploads }) => {
        const stored = storeSlackDraftMedia({ home, uploads });
        if (stored.isErr()) {
          return err(stored.error);
        }
        stored.value.forEach((entry, index) => {
          const upload = uploads[index]!;
          const digest = imageDigestOf({ bytes: upload.bytes });
          const artifact = { digest, heightPx: 8, widthPx: 8 };
          unwrap(appendImageRecord({ home, record: annotatedRecord({ digest, over: { artifact } }) }));
          store.set(entry.sha256, upload);
        });
        return stored;
      },
      threadReplies: async () => ok([]),
    };
    const recorded = await runSlackDraftWithDeps({
      argv: [
        "node",
        "cli",
        "slack",
        "draft",
        "record",
        "--as",
        "bot",
        "--channel",
        "C1",
        "--form",
        FINDING_FORM,
      ].concat(["--why", "share the staging pool finding", "--media", media, "--home", home]),
      deps: draftDeps,
    });
    return { code: recorded, events, home, store };
  }

  /** The send's world reading that register and store, and appending to the same register. */
  function releaseDeps({
    events,
    rec,
    store,
  }: {
    events: SlackDraftEvent[];
    rec: Recorder;
    store: Map<string, SlackUpload>;
  }): SlackWriteDeps {
    return {
      ...findingDeps({ rec }),
      appendDraftEvent: ({ event }) => {
        events.push(event);
        return ok(true);
      },
      readDraftLog: () => events.map((event) => slackDraftEventLine({ event })),
      readDraftMedia: ({ media }) =>
        ok(media.map((record) => ({ path: `/store/${record.sha256}`, record, upload: store.get(record.sha256)! }))),
    };
  }

  it("RELEASES a parked bot finding into the team channel the owner approved it for, exactly as recorded", async () => {
    const rec = recorder();
    const { events, home, store } = await parkedBotFinding({ rec });
    const parked = parkedIn({ events });

    const code = await runSlackWrite({
      argv: ["--as", "bot", "--draft", parked.id, "--approve", parked.digest, "--home", home],
      deps: releaseDeps({ events, rec, store }),
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(rec.sends.map((send) => [send.channel, send.uploads.length])).toEqual([["C1", 3]]);
    expect(rec.sends[0]!.payload.attachments).toEqual(
      (parked.payload as SlackCardPayload).attachments satisfies SlackCardPayload["attachments"],
    );
    expect(events.map((event) => event.kind)).toEqual(["parked", "released"]);
  });

  it("HOLDS a bot release Slack refused slack-refused, so the owner's card says why, and lets the throw go on", async () => {
    const { events, home, store } = await parkedBotFinding({ rec: recorder() });
    const parked = parkedIn({ events });
    const refused = recorder({ failWith: platformError({ error: "channel_not_found" }) });

    await expect(
      runSlackWrite({
        argv: ["--as", "bot", "--draft", parked.id, "--approve", parked.digest, "--home", home],
        deps: releaseDeps({ events, rec: refused, store }),
        verb: "post",
      }),
    ).rejects.toThrow("channel_not_found");

    expect(refused.sends.length).toBe(1);
    expect(events.map((event) => event.kind)).toEqual(["parked", "held"]);
    expect(events[1]).toEqual(expect.objectContaining({ id: parked.id, reason: "slack-refused" }));
  });

  it("HOLDS a bot release whose approval check Slack refused to answer slack-refused", async () => {
    const rec = recorder();
    const { events, home, store } = await parkedBotFinding({ rec });
    const parked = parkedIn({ events });
    const sends = rec.sends.length;

    await expect(
      runSlackWrite({
        argv: ["--as", "bot", "--draft", parked.id, "--approve", parked.digest, "--home", home],
        deps: {
          ...releaseDeps({ events, rec, store }),
          whoAmI: async () => {
            throw platformError({ error: "invalid_auth" });
          },
        },
        verb: "post",
      }),
    ).rejects.toThrow("invalid_auth");

    expect(rec.sends.length).toBe(sends);
    expect(events.map((event) => event.kind)).toEqual(["parked", "held"]);
    expect(events[1]).toEqual(expect.objectContaining({ id: parked.id, reason: "slack-refused" }));
  });

  it("REFUSES a release whose card renders differently now, sending nothing and leaving the row held", async () => {
    const rec = recorder();
    const { events, home, store } = await parkedBotFinding({ rec });
    const parked = parkedIn({ events });

    const code = await runSlackWrite({
      argv: ["--as", "bot", "--draft", parked.id, "--approve", parked.digest, "--home", home],
      deps: { ...releaseDeps({ events, rec, store }), chrome: () => ({ ...CHROME, authorLabel: "another-bot" }) },
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(rec.sends.length).toBe(0);
    expect(events.map((event) => event.kind)).toEqual(["parked"]);
  });
});

/** The one parked draft an append recorded. */
function parkedIn({ events }: { events: readonly SlackDraftEvent[] }): ParkedSlackDraft {
  return events.flatMap((event) => (event.kind === "parked" ? [event.draft] : []))[0]!;
}
