import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OwnerProtectionResolver } from "../../../../corpus/bronzeProtection.js";
import { readCorpusDir } from "../../../../corpus/corpusDirRead.js";
import { bronzeSourceDir } from "../../../../corpus/corpusPaths.js";
import { createBronzeCommitter } from "../../../../corpus/corpusWriter.js";
import type { SourceIngestJob } from "../../../../corpus/ingestJob.js";
import { type IngestDeps, ingestSources } from "../../../../corpus/ingestSource.js";
import { computeChannelWatermarks } from "../../../../corpus/slack/channelWatermark.js";
import { fetchSlackActivity, type SlackApi, type SlackChannelCommit } from "../../../../corpus/slack/fetch.js";
import { planChannelOldest } from "../../../../corpus/slack/reach.js";
import type { CorpusRecord, ExportWindow } from "../../../../corpus/types.js";
import { err, ok, type Result, unwrap } from "../../../../lib/result.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

const window: ExportWindow = { since: "1970-01-01", until: "2026-08-23" };

/** The clock these plans are judged against — past every cursor here, so the clock cap changes nothing. */
const NOW = "2026-08-23T09:00:00.000Z";

const slackRecord = (over: Partial<CorpusRecord> = {}): CorpusRecord => ({
  container: "slack/C_A",
  kind: "message",
  refs: [],
  source: "slack",
  sourceId: "C_A:1.1",
  text: "hello",
  tsIso: "2026-05-01T00:00:00.000Z",
  url: "u",
  ...over,
});

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-per-channel-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Every slack record currently on disk, read back through the production reader. */
function bronzeSlackIds(): readonly string[] {
  const read = readCorpusDir({ dir: bronzeSourceDir({ home, source: "slack" }), home, protection: NO_ENTRIES });
  return unwrap(read).records.map((record) => record.sourceId);
}

describe("createBronzeCommitter", () => {
  it("puts each container on disk as it is committed, before any later container is fetched", () => {
    const committer = createBronzeCommitter({ home, protection: NO_ENTRIES, window });
    expect(unwrap(committer.commit({ records: [slackRecord({ sourceId: "C_A:1" })] })).written).toBe(1);
    expect(bronzeSlackIds()).toEqual(["C_A:1"]);
    expect(unwrap(committer.commit({ records: [slackRecord({ sourceId: "C_B:1" })] })).written).toBe(1);
    expect(bronzeSlackIds()).toEqual(["C_A:1", "C_B:1"]);
  });

  it("dedups a re-commit against BOTH what was already on disk and what this committer wrote", () => {
    const first = createBronzeCommitter({ home, protection: NO_ENTRIES, window });
    expect(unwrap(first.commit({ records: [slackRecord({ sourceId: "C_A:1" })] })).written).toBe(1);
    // A SECOND committer — the restarted process — must not re-append what the killed one already wrote.
    const restarted = createBronzeCommitter({ home, protection: NO_ENTRIES, window });
    const again = unwrap(restarted.commit({ records: [slackRecord({ sourceId: "C_A:1" })] }));
    expect(again.written).toBe(0);
    expect(again.deduped).toBe(1);
    // ... and neither may the SAME committer, whose index carries its own writes forward.
    expect(unwrap(first.commit({ records: [slackRecord({ sourceId: "C_A:1" })] })).written).toBe(0);
    expect(bronzeSlackIds()).toEqual(["C_A:1"]);
  });
});

/** A three-channel workspace whose third channel's history throws — the kill this doc is about. */
function threeChannelApi({ failChannel }: { failChannel: string }): SlackApi {
  return {
    filesInfo: async ({ fileId }) => {
      throw new Error(`the crawl must not call files.info, but it did for ${fileId}`);
    },
    grantedScopes: async () => [],
    history: async ({ channel }) => {
      if (channel === failChannel) {
        throw new Error("not_in_channel");
      }
      return { messages: [{ text: `msg in ${channel}`, ts: "1700000000.000100", user: "U1" }] };
    },
    listChannels: async () => ({
      channels: [
        { id: "C_A", is_member: true, name: "alpha" },
        { id: "C_B", is_member: true, name: "beta" },
        { id: "C_C", is_member: true, name: "gamma" },
      ],
    }),
    listUsers: async () => ({ members: [{ id: "U1", profile: {}, real_name: "Ada" }] }),
    replies: async ({ ts }) => ({ messages: [{ text: "parent", ts, user: "U1" }] }),
    workspaceUrl: async () => "https://acme.slack.com",
  };
}

describe("fetchSlackActivity per-channel commit", () => {
  it("commits each conversation as it finishes, so a channel read before a later failure is already kept", async () => {
    const committed: string[] = [];
    const onChannelCommit: SlackChannelCommit = ({ items }) => {
      committed.push(items.channelId);
      return ok({ written: items.messages.length });
    };
    const activity = unwrap(
      await fetchSlackActivity({ api: threeChannelApi({ failChannel: "C_C" }), onChannelCommit, window }),
    );
    expect(committed).toEqual(["C_A", "C_B"]);
    expect(activity.visitedChannels).toEqual(["C_A", "C_B"]);
  });

  it("reports the epoch-read conversations, which is what marks a channel fully backfilled", async () => {
    const activity = unwrap(await fetchSlackActivity({ api: threeChannelApi({ failChannel: "C_C" }), window }));
    expect(activity.fullHistoryChannels).toEqual(["C_A", "C_B"]);
  });

  it("does not mark a conversation whose commit FAILED as visited, so the next run backfills it again", async () => {
    const onChannelCommit: SlackChannelCommit = ({ items }) =>
      items.channelId === "C_B" ? err(["disk full"]) : ok({ written: 1 });
    const activity = unwrap(
      await fetchSlackActivity({ api: threeChannelApi({ failChannel: "C_C" }), onChannelCommit, window }),
    );
    expect(activity.visitedChannels).toEqual(["C_A"]);
    expect(activity.fullHistoryChannels).toEqual(["C_A"]);
    expect(activity.warnings.filter((line) => line.includes("C_B"))).toHaveLength(1);
  });
});

describe("planChannelOldest resumes an epoch-wide request", () => {
  it("resumes a fully backfilled channel from its own cursor even under an explicit epoch window", () => {
    expect(
      planChannelOldest({
        backfillNew: false,
        nowIso: NOW,
        stored: { cursor: "2026-05-01T00:00:00.000Z", fullHistory: true },
        windowOldest: "0",
      }),
    ).toBe("1777593600");
  });

  it("re-reads a channel that was NEVER read from the epoch, whatever its cursor says", () => {
    expect(
      planChannelOldest({
        backfillNew: false,
        nowIso: NOW,
        stored: { cursor: "2026-05-01T00:00:00.000Z", fullHistory: false },
        windowOldest: "0",
      }),
    ).toBe("0");
  });

  it("keeps an explicit LATER window when a backfilled channel's cursor sits below it", () => {
    expect(
      planChannelOldest({
        backfillNew: false,
        nowIso: NOW,
        stored: { cursor: "2026-05-01T00:00:00.000Z", fullHistory: true },
        windowOldest: "1780000000",
      }),
    ).toBe("1780000000");
  });
});

describe("computeChannelWatermarks records the epoch read", () => {
  it("marks only the channels that were read from the epoch as fully backfilled", () => {
    expect(
      computeChannelWatermarks({
        fallbackUntil: "2026-08-23T00:00:00.000Z",
        fullHistory: ["C_A"],
        nowIso: NOW,
        observed: [{ channel: "C_A", tsIso: "2026-05-01T00:00:00.000Z" }],
        visited: ["C_A", "C_B"],
      }),
    ).toEqual([
      { channel: "C_A", cursor: "2026-05-01T00:00:00.000Z", fullHistory: true },
      { channel: "C_B", cursor: "2026-08-23T00:00:00.000Z", fullHistory: false },
    ]);
  });
});

describe("ingestSources with a job that committed per-container", () => {
  it("counts what the job already wrote, so a per-container run does not report itself as all-duplicates", async () => {
    const written: CorpusRecord[][] = [];
    const deps: IngestDeps = {
      advance: () => ok({ paths: [] }),
      nowIso: () => "2030-01-01T00:00:00Z",
      write: ({ records }) => {
        written.push([...records]);
        // Everything was already committed per container, so the safety-net write appends nothing.
        return ok({ bySource: {}, deduped: records.length, excluded: 0, written: 0 });
      },
    };
    const job: SourceIngestJob = {
      label: "slack",
      run: async (): Promise<Result<{ records: readonly CorpusRecord[]; warnings: readonly string[] }>> =>
        ok({ committedPerContainer: 2, records: [slackRecord(), slackRecord({ sourceId: "C_B:1" })], warnings: [] }),
      source: "slack",
      window,
    };
    const results = unwrap(await ingestSources({ deps, home, jobs: [job] }));
    expect(results[0]!.written).toBe(2);
    expect(results[0]!.deduped).toBe(0);
    expect(results[0]!.projected).toBe(2);
    // The bulk write still runs — it is the safety net for a container whose own commit failed.
    expect(written).toHaveLength(1);
  });
});
