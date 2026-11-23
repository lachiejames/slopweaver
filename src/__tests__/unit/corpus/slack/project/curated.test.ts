/*
 * `projectSlackRecords` over the curated surfaces: pins, bookmarks and canvases become records, each inheriting its
 * channel's lane and failing closed to private when that channel was never crawled. It moved here when
 * `project.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";
import {
  projectSlackRecords,
  type SlackChannelItems,
  type SlackCuratedItems,
} from "../../../../../corpus/slack/project.js";

describe("projectSlackRecords — curated surfaces (PR4.3)", () => {
  const curated: SlackCuratedItems = {
    huddles: [],
    bookmarks: [
      {
        channelId: "C1",
        channelName: "dev",
        id: "Bk1",
        link: "https://runbook",
        title: "Runbook",
        tsIso: "2026-05-01T00:00:00.000Z",
      },
    ],
    canvases: [
      {
        id: "F1",
        permalink: "https://acme.slack.com/canvas/F1",
        title: "Rollout plan",
        tsIso: "2026-05-01T00:00:00.000Z",
      },
    ],
    pins: [
      {
        author: "Seth",
        channelId: "C1",
        channelName: "dev",
        permalink: "https://acme.slack.com/p1",
        text: "read this first",
        ts: "1700000000.001",
        tsIso: "2026-05-01T00:00:00.000Z",
      },
    ],
  };

  it("projects a pin to a `pin` record cited by its permalink", () => {
    const record = projectSlackRecords({ channels: [], curated }).find((r) => r.kind === "pin")!;
    expect(record.sourceId).toBe("C1:pin:1700000000.001");
    expect(record.text).toBe("read this first");
    expect(record.url).toBe("https://acme.slack.com/p1");
  });

  it("projects a bookmark to a `bookmark` record", () => {
    const record = projectSlackRecords({ channels: [], curated }).find((r) => r.kind === "bookmark")!;
    expect(record.sourceId).toBe("C1:bookmark:Bk1");
    expect(record.url).toBe("https://runbook");
  });

  it("projects a canvas to a `canvas` record classified `strategy`", () => {
    const record = projectSlackRecords({ channels: [], curated }).find((r) => r.kind === "canvas")!;
    expect(record.sourceId).toBe("canvas:F1");
    expect(record.attrs!["classification"]).toBe("strategy");
    expect(record.url).toBe("https://acme.slack.com/canvas/F1");
  });

  it("fails a canvas with an unknown/absent channel CLOSED to private (never leaks as public)", () => {
    const record = projectSlackRecords({ channels: [], curated }).find((r) => r.kind === "canvas")!;
    expect(record.visibility).toBe("private");
  });

  it("keeps a curated surface public when its channel is crawled and public", () => {
    const channels: SlackChannelItems[] = [{ channelId: "C1", messages: [], replies: [] }];
    const record = projectSlackRecords({ channels, curated }).find((r) => r.kind === "pin")!;
    expect(record.visibility).toBeUndefined();
  });

  it("stamps a curated surface private when its channel is crawled and private", () => {
    const channels: SlackChannelItems[] = [{ channelId: "C1", isPrivate: true, messages: [], replies: [] }];
    const record = projectSlackRecords({ channels, curated }).find((r) => r.kind === "bookmark")!;
    expect(record.visibility).toBe("private");
  });

  it("inherits a curated surface's lane from crawledChannels when passed, and from channels when not", () => {
    const channels: SlackChannelItems[] = [{ channelId: "C1", isPrivate: true, messages: [], replies: [] }];
    const passed = projectSlackRecords({ channels, crawledChannels: [{ channelId: "C1" }], curated });
    expect(passed.find((r) => r.kind === "pin")!.visibility).toBeUndefined();
    const defaulted = projectSlackRecords({ channels, curated });
    expect(defaulted.find((r) => r.kind === "pin")!.visibility).toBe("private");
  });
});
