/**
 * `crawlGmail` progress: one beat per message read, labelled through the renderer, counted against what the
 * crawl will actually read.
 */
import { describe, expect, it } from "vitest";

import { collapseProgressPhase } from "#lib/progress.js";

import { crawlGmail } from "../../../../../corpus/gmail/fetch.js";
import { toRichProgressEvent } from "../../../../../corpus/progress.js";
import { fakeApi, WINDOW } from "./harness.js";

describe("progress", () => {
  it("beats once per message read, so a long crawl is never mistaken for a hang", async () => {
    // Asserted through the RENDERER, not on the raw field. The raw phase was once `gmail.messages`, which
    // is self-consistent and wrong: `toRichProgressEvent` prefixes the source, so the operator's line read
    // "Gmail gmail messages". A test on the field could not see that; a test on the label can.
    const labels: { done: number | undefined; total: number | undefined; label: string }[] = [];
    await crawlGmail({
      backfillFloorIso: undefined,
      anchor: undefined,
      api: fakeApi({ pages: [{ ids: ["a", "b", "c"], next: undefined }] }),
      cap: undefined,
      epochWide: false,
      onProgress: (event) => {
        const rich = toRichProgressEvent({ event });
        labels.push({
          done: rich.done,
          label: collapseProgressPhase({ phase: rich.phase, verb: "refresh" }),
          total: rich.total,
        });
      },
      window: WINDOW,
    });
    expect(labels).toStrictEqual([
      { done: 1, label: "Reading mail", total: 3 },
      { done: 2, label: "Reading mail", total: 3 },
      { done: 3, label: "Reading mail", total: 3 },
    ]);
  });

  it("counts against what it will actually read, not what the listing offered", async () => {
    const beats: number[] = [];
    await crawlGmail({
      backfillFloorIso: undefined,
      anchor: undefined,
      api: fakeApi({ pages: [{ ids: ["a", "b", "c"], next: undefined }] }),
      cap: { maxMessages: 2 },
      epochWide: false,
      onProgress: (event) => beats.push(event.total!),
      window: WINDOW,
    });
    expect(beats).toStrictEqual([2, 2]);
  });
});
