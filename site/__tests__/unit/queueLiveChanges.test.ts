/**
 * The Queue's change map and cadence: which registers a home path moves, which directories are watched, how often a
 * register polls once its changes are pushed, how soon a change re-reads it, and what the page says when a signal is
 * down.
 */
import { describe, expect, it } from "vitest";
import { QUEUE_STORE_SLUGS } from "../../../src/store/schema/queueChangeNotify";
import {
  BOARD_EVENT_GAP_MS,
  EVENT_GAP_MS,
  eventRefreshDelayMs,
  isQueueLiveSlug,
  liveChangesNotice,
  QUEUE_CHANGE_HEALTH_DOWN,
  QUEUE_LIVE_SLUGS,
  queuePollMs,
  queueSlugsForHomePath,
  queueSlugsForSource,
  queueSourcesForSlug,
  queueWatchRoots,
  SAFETY_POLL_BASE_MS,
  SAFETY_POLL_SPREAD_MS,
  safetyPollMs,
} from "../../lib/queueLiveChanges";

const ALL_UP = { files: true, store: true, transport: true } as const;

describe("queueSlugsForHomePath", () => {
  it("moves a file's own register, and only that one", () => {
    expect(queueSlugsForHomePath({ relativePath: "queue/slack-drafts.jsonl" })).toEqual(["slack-drafts"]);
  });

  it("moves a file's register for a staged write beside it", () => {
    expect(queueSlugsForHomePath({ relativePath: "queue/withheld.jsonl.4242.5f1c.tmp" })).toEqual(["drafts"]);
  });

  it("moves a tree's register for anything under it", () => {
    expect(queueSlugsForHomePath({ relativePath: "handovers/some-run.md" })).toEqual(["board"]);
    expect(queueSlugsForHomePath({ relativePath: "readings/github-landing/2026-11-18.json" })).toEqual([
      "landing-reading",
      "reviewers",
    ]);
  });

  it("moves a tree's register when its parent directory moves", () => {
    expect(queueSlugsForHomePath({ relativePath: "talk" })).toEqual(["hands", "talk-cards"]);
  });

  it("moves a file's register when the directory holding it reports alone", () => {
    expect(queueSlugsForHomePath({ relativePath: "ledgers" })).toEqual(["reviewers"]);
  });

  it("moves the board for every home file a card resolves a reference against", () => {
    expect(queueSlugsForHomePath({ relativePath: "corpus/silver/index/structures.json" })).toEqual(["board"]);
    expect(queueSlugsForHomePath({ relativePath: "datadog/catalogue/manifest.json" })).toEqual(["board"]);
    expect(queueSlugsForHomePath({ relativePath: "atlas/vanta/controls.jsonl" })).toEqual(["board"]);
    expect(queueSlugsForHomePath({ relativePath: "secrets/vanta-tenant-slug" })).toEqual(["board"]);
    expect(queueSlugsForHomePath({ relativePath: "profile.json" })).toEqual(["board", "reviewers"]);
  });

  it("moves the hand steps and the talk cards for a card landing", () => {
    expect(queueSlugsForHomePath({ relativePath: "talk/card-landings.jsonl" })).toEqual(["hands", "talk-cards"]);
  });

  it("moves nothing for a sibling that only shares a prefix", () => {
    expect(queueSlugsForHomePath({ relativePath: "queue/slack-drafts-archive.jsonl" })).toEqual([]);
    expect(queueSlugsForHomePath({ relativePath: "handovers-old/x.md" })).toEqual([]);
  });

  it("moves nothing for a path no register reads", () => {
    expect(queueSlugsForHomePath({ relativePath: "corpus/bronze/slack/2026-11.jsonl" })).toEqual([]);
  });

  it("reads either separator and a trailing slash the same", () => {
    expect(queueSlugsForHomePath({ relativePath: "hand-steps\\one.json" })).toEqual(["hands"]);
    expect(queueSlugsForHomePath({ relativePath: "./hand-steps/" })).toEqual(["hands"]);
  });

  it("moves every file-kept register when the watcher named no file", () => {
    expect(queueSlugsForHomePath({ relativePath: null })).toEqual(queueSlugsForSource({ source: "files" }));
  });

  it("moves nothing for a path that leaves the home, or names nothing", () => {
    expect(queueSlugsForHomePath({ relativePath: "/etc/passwd" })).toEqual([]);
    expect(queueSlugsForHomePath({ relativePath: "handovers/../../x" })).toEqual([]);
    expect(queueSlugsForHomePath({ relativePath: "" })).toEqual([]);
  });
});

describe("queueSlugsForSource", () => {
  it("feeds the store only to the six registers read from it", () => {
    expect(queueSlugsForSource({ source: "store" })).toEqual([
      "autonomy",
      "board",
      "import-questions",
      "reviewers",
      "standing-asks",
      "workstreams",
    ]);
  });

  it("feeds the store exactly the registers its notify triggers name", () => {
    expect(QUEUE_STORE_SLUGS.length).toBeGreaterThan(0);
    expect(queueSlugsForSource({ source: "store" }).toSorted()).toEqual(QUEUE_STORE_SLUGS.toSorted());
  });

  it("gives every register at least one source", () => {
    expect(QUEUE_LIVE_SLUGS.length).toBeGreaterThan(0);
    expect(QUEUE_LIVE_SLUGS.filter((slug) => queueSourcesForSlug({ slug }).length === 0)).toEqual([]);
  });
});

describe("queueWatchRoots", () => {
  it("watches the home flat, every tree recursively and each file's directory flat, never the whole corpus", () => {
    expect(queueWatchRoots()).toEqual([
      { dir: "", recursive: false },
      { dir: "atlas/vanta", recursive: true },
      { dir: "corpus/members", recursive: true },
      { dir: "corpus/silver/index", recursive: false },
      { dir: "datadog/catalogue", recursive: false },
      { dir: "hand-steps", recursive: true },
      { dir: "handovers", recursive: true },
      { dir: "judgement", recursive: false },
      { dir: "ledgers", recursive: false },
      { dir: "queue", recursive: false },
      { dir: "readings/github-landing", recursive: true },
      { dir: "readings/handover-currency", recursive: true },
      { dir: "runs", recursive: true },
      { dir: "secrets", recursive: false },
      { dir: "sessions", recursive: false },
      { dir: "talk", recursive: false },
      { dir: "talk/calls", recursive: true },
      { dir: "talk/turns", recursive: true },
    ]);
  });
});

describe("safetyPollMs", () => {
  it("keeps every register inside the five-minute window and its spread", () => {
    expect(QUEUE_LIVE_SLUGS.length).toBeGreaterThan(0);
    const outside = QUEUE_LIVE_SLUGS.filter((slug) => {
      const ms = safetyPollMs({ slug });
      return ms < SAFETY_POLL_BASE_MS || ms >= SAFETY_POLL_BASE_MS + SAFETY_POLL_SPREAD_MS;
    });
    expect(outside).toEqual([]);
  });

  it("staggers the registers rather than firing them together", () => {
    const intervals = new Set(QUEUE_LIVE_SLUGS.map((slug) => safetyPollMs({ slug })));
    expect(intervals.size).toBe(QUEUE_LIVE_SLUGS.length);
  });

  it("gives one register the same interval every time", () => {
    expect(safetyPollMs({ slug: "board" })).toBe(safetyPollMs({ slug: "board" }));
  });
});

describe("queuePollMs", () => {
  it("slows a register to its safety poll once every signal it needs is up", () => {
    expect(queuePollMs({ askedMs: 20_000, health: ALL_UP, slug: "drafts" })).toBe(safetyPollMs({ slug: "drafts" }));
  });

  it("keeps the old cadence while the stream is down", () => {
    expect(queuePollMs({ askedMs: 20_000, health: QUEUE_CHANGE_HEALTH_DOWN, slug: "drafts" })).toBe(20_000);
  });

  it("keeps the old cadence when one source a register reads is down", () => {
    const storeDown = { files: true, store: false, transport: true };
    expect(queuePollMs({ askedMs: 20_000, health: storeDown, slug: "workstreams" })).toBe(20_000);
    expect(queuePollMs({ askedMs: 20_000, health: storeDown, slug: "drafts" })).toBe(safetyPollMs({ slug: "drafts" }));
  });

  it("leaves a slug that is not a Queue register as asked, a single read included", () => {
    expect(queuePollMs({ askedMs: 20_000, health: ALL_UP, slug: "source-freshness" })).toBe(20_000);
    expect(queuePollMs({ askedMs: undefined, health: ALL_UP, slug: "source-freshness" })).toBeUndefined();
  });

  it("gives a Queue register read once its safety poll, so a lost change event cannot leave it stale", () => {
    expect(queuePollMs({ askedMs: undefined, health: ALL_UP, slug: "autonomy" })).toBe(
      safetyPollMs({ slug: "autonomy" }),
    );
    expect(queuePollMs({ askedMs: undefined, health: QUEUE_CHANGE_HEALTH_DOWN, slug: "autonomy" })).toBe(
      safetyPollMs({ slug: "autonomy" }),
    );
  });

  it("never polls faster than asked", () => {
    expect(queuePollMs({ askedMs: 900_000, health: ALL_UP, slug: "board" })).toBe(900_000);
  });
});

describe("eventRefreshDelayMs", () => {
  it("re-reads at once a register never re-read for a change", () => {
    expect(eventRefreshDelayMs({ lastRefreshAtMs: undefined, nowMs: 1_000, slug: "board" })).toBe(0);
  });

  it("waits out the rest of the board's minute", () => {
    expect(eventRefreshDelayMs({ lastRefreshAtMs: 10_000, nowMs: 25_000, slug: "board" })).toBe(
      BOARD_EVENT_GAP_MS - 15_000,
    );
  });

  it("waits out the rest of any other register's twenty seconds, and not past it", () => {
    expect(eventRefreshDelayMs({ lastRefreshAtMs: 10_000, nowMs: 25_000, slug: "drafts" })).toBe(EVENT_GAP_MS - 15_000);
    expect(eventRefreshDelayMs({ lastRefreshAtMs: 10_000, nowMs: 31_000, slug: "drafts" })).toBe(0);
  });
});

describe("liveChangesNotice", () => {
  it("says nothing while connecting, or while every signal is up", () => {
    expect(liveChangesNotice({ health: QUEUE_CHANGE_HEALTH_DOWN, settled: false })).toBeUndefined();
    expect(liveChangesNotice({ health: ALL_UP, settled: true })).toBeUndefined();
  });

  it("says the stream is gone", () => {
    expect(liveChangesNotice({ health: QUEUE_CHANGE_HEALTH_DOWN, settled: true })).toBe(
      "live updates off: no change stream, so every register is back on its old poll",
    );
  });

  it("names the one signal down", () => {
    expect(liveChangesNotice({ health: { files: true, store: false, transport: true }, settled: true })).toBe(
      "live updates partly off: the store listener is down, so those registers are back on their old poll",
    );
  });

  it("names both signals down", () => {
    expect(liveChangesNotice({ health: { files: false, store: false, transport: true }, settled: true })).toBe(
      "live updates partly off: the file watch and the store listener are down, so those registers are back on their old poll",
    );
  });
});

describe("isQueueLiveSlug", () => {
  it("accepts a register and refuses anything else", () => {
    expect(isQueueLiveSlug("talk-cards")).toBe(true);
    expect(isQueueLiveSlug("source-freshness")).toBe(false);
  });
});
