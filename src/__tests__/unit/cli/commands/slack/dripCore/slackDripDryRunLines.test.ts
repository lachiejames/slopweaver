/*
 * `slackDripDryRunLines`: nothing sent and every message shown in order, no fold marker, the cadence and count,
 * the thread parent under `--shape thread`, and the media it would attach — its files, steps and silence when
 * there is none.
 */
import { describe, expect, it } from "vitest";

import { buildSlackDripPlan, slackDripDryRunLines } from "../../../../../../cli/commands/slack/dripCore.js";
import { dripArtifact, NO_MENTIONS, options, RESOLUTION } from "./harness.js";

describe("slackDripDryRunLines", () => {
  const plan = buildSlackDripPlan({
    artifact: dripArtifact({ texts: ["Shipped it.", "Docs to follow."] }),
    intervalMs: 1500,
    mentions: NO_MENTIONS,
    options: options({ texts: ["Shipped it.", "Docs to follow."] }),
  });

  it("says nothing was sent, and shows every message in order", () => {
    const lines = slackDripDryRunLines({ mentions: RESOLUTION, plan });

    expect(lines[0]).toBe("dry run — nothing was sent. as=me channel=C1 shape=top-level");
    expect(lines).toContain("── message 1/2 ──");
    expect(lines).toContain("Shipped it.");
    expect(lines).toContain("── message 2/2 ──");
    expect(lines).toContain("Docs to follow.");
  });

  it("draws NO fold marker — a drip has no wrapper and therefore nothing to fold", () => {
    const lines = slackDripDryRunLines({ mentions: RESOLUTION, plan });

    expect(lines.filter((line) => line.includes("Show more"))).toEqual([]);
    expect(lines.filter((line) => line.includes("WILL NOT FOLD"))).toEqual([]);
  });

  it("states the cadence and the message count", () => {
    const lines = slackDripDryRunLines({ mentions: RESOLUTION, plan });

    expect(lines[1]).toBe("drip: 2 message(s), 1500ms apart, sent in order (no card, no fold)");
  });

  it("says which message becomes the thread parent under `--shape thread`", () => {
    const threaded = buildSlackDripPlan({
      artifact: dripArtifact({ texts: ["a", "b"] }),
      intervalMs: 0,
      mentions: NO_MENTIONS,
      options: options({ shape: "thread", texts: ["a", "b"] }),
    });

    const lines = slackDripDryRunLines({ mentions: RESOLUTION, plan: threaded });

    expect(lines.some((line) => line.includes("becomes the thread parent"))).toBe(true);
    expect(lines.some((line) => line.includes("thread_ts=<parent from message 1>"))).toBe(true);
  });
});

describe("slackDripDryRunLines — the media it would attach", () => {
  function linesFor({ media }: { media: readonly string[] }): readonly string[] {
    return slackDripDryRunLines({
      mentions: RESOLUTION,
      plan: buildSlackDripPlan({
        artifact: dripArtifact({ texts: ["a", "b"] }),
        intervalMs: 0,
        mentions: NO_MENTIONS,
        options: options({ media, texts: ["a", "b"] }),
      }),
    });
  }

  it("names the files, their count and the message they land under", () => {
    const lines = linesFor({ media: ["/tmp/one.png", "/tmp/two.png"] });

    expect(lines[2]).toBe("media: 2 file(s) — one.png, two.png — attached UNDER message 2/2, the last one");
  });

  it("lists the upload, the attach and the read-back as their own steps", () => {
    const lines = linesFor({ media: ["/tmp/one.png"] });

    expect(lines.filter((line) => line.startsWith("     ↳"))).toEqual([
      "     ↳ files.uploadV2 ×1 (private, before the post — an unreadable path fails before anything is said)",
      "     ↳ chat.update file_ids=1 — the files land under this message's own text",
      "     ↳ read-back — a count that disagrees DELETES this message rather than leaving it evidence-free",
    ]);
  });

  it("says nothing at all about media when there is none", () => {
    const lines = linesFor({ media: [] });

    expect(lines.filter((line) => line.includes("media:"))).toEqual([]);
    expect(lines.filter((line) => line.startsWith("     ↳"))).toEqual([]);
  });
});
