import { describe, expect, it } from "vitest";

import { isHuddleCanvasFile, shapeCanvasFile, shapeHuddleFile } from "../../../../corpus/slack/curated.js";
import { projectSlackRecords, type SlackHuddleItem } from "../../../../corpus/slack/project.js";
import type { CorpusRecord } from "../../../../corpus/types.js";

/** A raw `files.list` huddle-notes canvas, shaped like a real one. */
function huddleFile(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    channels: ["C0BT"],
    created: 1787_000_000,
    filetype: "quip",
    huddle_date_end: 1786_999_000,
    huddle_date_start: 1786_997_000,
    huddle_summary_id: "As0BT6",
    huddle_transcript_file_id: "F0BT8F",
    id: "F0BTAC",
    is_huddle_canvas: true,
    mimetype: "application/vnd.slack-docs",
    permalink: "https://example.slack.com/docs/T1/F0BTAC",
    title: "Huddle notes: 28/08/2026 with &lt;@U08J&gt;",
    ...over,
  };
}

describe("isHuddleCanvasFile", () => {
  it("accepts a file Slack marked as a huddle canvas", () => {
    expect(isHuddleCanvasFile({ file: huddleFile() })).toBe(true);
  });

  it("rejects an authored canvas, which carries no huddle marker", () => {
    expect(isHuddleCanvasFile({ file: { filetype: "quip", id: "F1" } })).toBe(false);
  });

  it("rejects a truthy-but-not-true marker rather than guessing", () => {
    expect(isHuddleCanvasFile({ file: huddleFile({ is_huddle_canvas: "yes" }) })).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(isHuddleCanvasFile({ file: "F0BTAC" })).toBe(false);
  });
});

describe("shapeHuddleFile", () => {
  it("carries the transcript and summary pointers Slack named", () => {
    const shaped = shapeHuddleFile({ file: huddleFile() })!;
    expect(shaped.transcriptFileId).toBe("F0BT8F");
    expect(shaped.summaryId).toBe("As0BT6");
  });

  it("dates the huddle by when people TALKED, not when the notes file was written", () => {
    const shaped = shapeHuddleFile({ file: huddleFile() })!;
    expect(shaped.tsIso).toBe("2026-08-17T20:03:20.000Z");
    expect(shaped.startedIso).toBe("2026-08-17T20:03:20.000Z");
    expect(shaped.endedIso).toBe("2026-08-17T20:36:40.000Z");
  });

  it("falls back to the notes file's creation time when Slack reported no huddle start", () => {
    const shaped = shapeHuddleFile({ file: huddleFile({ huddle_date_start: undefined }) })!;
    expect(shaped.tsIso).toBe("2026-08-17T20:53:20.000Z");
  });

  it("decodes the entities Slack escapes, so the title carries a real mention", () => {
    const shaped = shapeHuddleFile({ file: huddleFile() })!;
    expect(shaped.title).toBe("Huddle notes: 28/08/2026 with <@U08J>");
  });

  it("omits the transcript pointer when Slack generated none", () => {
    const shaped = shapeHuddleFile({ file: huddleFile({ huddle_transcript_file_id: undefined }) })!;
    expect(shaped.transcriptFileId).toBe(undefined);
  });

  it("refuses a huddle with no permalink, since there is nothing safe to cite", () => {
    expect(shapeHuddleFile({ file: huddleFile({ permalink: undefined }) })).toBe(undefined);
  });

  it("refuses an ordinary canvas", () => {
    expect(shapeHuddleFile({ file: { filetype: "quip", id: "F1", permalink: "https://x" } })).toBe(undefined);
  });
});

describe("the canvas and huddle shapers overlap, which is why the fetch splits on the huddle marker first", () => {
  it("shapeCanvasFile ACCEPTS a huddle canvas — it is structurally a canvas", () => {
    expect(shapeCanvasFile({ file: huddleFile() })?.id).toBe("F0BTAC");
  });
});

/** A shaped huddle, transcript-less, as `shapeHuddleFile` returns one. */
function huddleItem(over: Partial<SlackHuddleItem> = {}): SlackHuddleItem {
  return {
    channelId: "C0BT",
    endedIso: "2026-08-28T02:55:03.000Z",
    id: "F0BTAC",
    permalink: "https://example.slack.com/docs/T1/F0BTAC",
    startedIso: "2026-08-28T02:28:34.000Z",
    summaryId: "As0BT6",
    title: "Huddle notes: 28/08/2026",
    transcriptFileId: "F0BT8F",
    tsIso: "2026-08-28T02:28:34.000Z",
    ...over,
  };
}

/** The huddle records one shaped huddle projects to, in chunk order. */
function huddleRecordsFor({ huddle }: { huddle: SlackHuddleItem }): readonly CorpusRecord[] {
  return projectSlackRecords({
    channels: [],
    curated: { bookmarks: [], canvases: [], huddles: [huddle], pins: [] },
  });
}

describe("a huddle whose words the fetch lane could not read", () => {
  it("projects ONE pointer record naming the read-file command, exactly as before the words were reachable", () => {
    const records = huddleRecordsFor({ huddle: huddleItem() });
    expect(records.length).toBe(1);
    expect(records[0]!.sourceId).toBe("huddle:F0BTAC");
    expect(records[0]!.text).toBe(
      "Huddle notes: 28/08/2026\n2026-08-28T02:28:34.000Z → 2026-08-28T02:55:03.000Z\nTranscript: slopweaver slack read-file F0BT8F",
    );
  });

  it("carries no `huddleTranscriptChars`, so a reader can tell a pointer from stored words", () => {
    const record = huddleRecordsFor({ huddle: huddleItem() })[0]!;
    expect(record.attrs!["huddleTranscriptFileId"]).toBe("F0BT8F");
    expect(record.attrs!["huddleTranscriptChars"]).toBe(undefined);
  });

  it("says so plainly when Slack generated no transcript at all", () => {
    const { transcriptFileId, ...noTranscript } = huddleItem();
    expect(transcriptFileId).toBe("F0BT8F");
    const record = huddleRecordsFor({ huddle: noTranscript })[0]!;
    expect(record.text).toBe(
      "Huddle notes: 28/08/2026\n2026-08-28T02:28:34.000Z → 2026-08-28T02:55:03.000Z\nNo transcript was generated for this huddle.",
    );
  });
});

describe("a huddle carrying its transcript's words", () => {
  it("projects the words rather than the pointer line, keeping the bare source id for a short call", () => {
    const record = huddleRecordsFor({ huddle: huddleItem({ transcriptText: "[00:13] Ada: we shipped it" }) })[0]!;
    expect(record.sourceId).toBe("huddle:F0BTAC");
    expect(record.text).toBe(
      "Huddle notes: 28/08/2026\n\n2026-08-28T02:28:34.000Z → 2026-08-28T02:55:03.000Z\n\n[00:13] Ada: we shipped it",
    );
    expect(record.attrs!["huddleTranscriptChars"]).toBe(26);
  });

  it("splits a long transcript into several records, every chunk suffixed once there is more than one", () => {
    const line = `[00:13] Ada: ${"word ".repeat(120)}`;
    const records = huddleRecordsFor({
      huddle: huddleItem({ transcriptText: [line, line, line].join("\n\n") }),
    });
    expect(records.length).toBe(2);
    expect(records[0]!.sourceId).toBe("huddle:F0BTAC:chunk:0");
    expect(records[1]!.sourceId).toBe("huddle:F0BTAC:chunk:1");
    expect(records[0]!.title).toBe("Huddle notes: 28/08/2026 (1/2)");
    expect(records[1]!.title).toBe("Huddle notes: 28/08/2026 (2/2)");
    expect(records[0]!.attrs!["chunkIndex"]).toBe(0);
    expect(records[1]!.attrs!["chunkIndex"]).toBe(1);
  });

  it("puts the call's own attrs on EVERY chunk — they describe the call, not the chunk", () => {
    const line = `[00:13] Ada: ${"word ".repeat(120)}`;
    const records = huddleRecordsFor({ huddle: huddleItem({ transcriptText: [line, line, line].join("\n\n") }) });
    expect(records[1]!.attrs!["huddleTranscriptFileId"]).toBe("F0BT8F");
    expect(records[1]!.attrs!["huddleStartedIso"]).toBe("2026-08-28T02:28:34.000Z");
    expect(records[1]!.attrs!["classification"]).toBe("strategy");
  });

  it("stamps every chunk private, because a huddle is private by KIND", () => {
    const line = `[00:13] Ada: ${"word ".repeat(120)}`;
    const records = huddleRecordsFor({ huddle: huddleItem({ transcriptText: [line, line, line].join("\n\n") }) });
    expect(records.map((record) => record.visibility)).toEqual(["private", "private"]);
  });

  it("heads only the FIRST chunk with the title and window, never repeats them into the rest", () => {
    const line = `[00:13] Ada: ${"word ".repeat(120)}`;
    const records = huddleRecordsFor({ huddle: huddleItem({ transcriptText: [line, line, line].join("\n\n") }) });
    expect(records[1]!.text.startsWith("[00:13] Ada:")).toBe(true);
  });
});
