import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { shapeSlackFileMeta } from "../../../../live/slack/fileMeta.js";

/** A raw `files.info` huddle-notes canvas, shaped like the real one measured. */
function huddleCanvas(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    channels: ["C0AA"],
    created: 1787_000_000,
    file_access: "visible",
    filetype: "quip",
    groups: [],
    huddle_date_end: 1786_999_000,
    huddle_date_start: 1786_997_000,
    huddle_summary_id: "As0BT6",
    huddle_transcript_file_id: "F0BT8F",
    id: "F0BTAC",
    ims: ["D0BB", "D0CC"],
    is_huddle_canvas: true,
    mimetype: "application/vnd.slack-docs",
    mode: "quip",
    permalink: "https://example.slack.com/docs/T1/F0BTAC",
    size: 5565,
    title: "Huddle notes with &lt;@UAAA&gt; &amp; &lt;@UBBB&gt;",
    url_private: "https://files.slack.com/files-pri/T1-F0BTAC/canvas",
    url_private_download: "https://files.slack.com/files-pri/T1-F0BTAC/download/canvas",
    user: "UAAA",
    ...over,
  };
}

describe("shapeSlackFileMeta", () => {
  it("reads the five huddle fields the SDK typings do not declare", () => {
    const meta = unwrap(shapeSlackFileMeta({ file: huddleCanvas() }));
    expect(meta.isHuddleCanvas).toBe(true);
    expect(meta.huddleTranscriptFileId).toBe("F0BT8F");
    expect(meta.huddleSummaryId).toBe("As0BT6");
    expect(meta.huddleStartIso).toBe("2026-08-17T20:03:20.000Z");
    expect(meta.huddleEndIso).toBe("2026-08-17T20:36:40.000Z");
  });

  it("keeps both private URLs apart, since Slack serves some filetypes from only one", () => {
    const meta = unwrap(shapeSlackFileMeta({ file: huddleCanvas() }));
    expect(meta.urlPrivateDownload).toBe("https://files.slack.com/files-pri/T1-F0BTAC/download/canvas");
    expect(meta.urlPrivate).toBe("https://files.slack.com/files-pri/T1-F0BTAC/canvas");
  });

  it("gathers channels, ims and groups into one shared-into list", () => {
    const meta = unwrap(shapeSlackFileMeta({ file: huddleCanvas() }));
    expect(meta.channels).toEqual(["C0AA", "D0BB", "D0CC"]);
  });

  it("decodes Slack's escapes LAST-first, so an escaped ampersand stays one", () => {
    const meta = unwrap(shapeSlackFileMeta({ file: huddleCanvas() }));
    expect(meta.title).toBe("Huddle notes with <@UAAA> & <@UBBB>");
  });

  it("reports file_access, which separates a permission problem from a transport one", () => {
    const meta = unwrap(shapeSlackFileMeta({ file: huddleCanvas() }));
    expect(meta.fileAccess).toBe("visible");
  });

  it("reads an ordinary upload with none of the huddle fields present", () => {
    const meta = unwrap(
      shapeSlackFileMeta({
        file: { channels: ["C1"], filetype: "png", id: "F0PNG1234", name: "image.png", size: 74_690 },
      }),
    );
    expect(meta.isHuddleCanvas).toBe(false);
    expect(meta.huddleTranscriptFileId).toBe(undefined);
    expect(meta.title).toBe("image.png");
  });

  it("falls back to the id when Slack sent neither a title nor a name", () => {
    const meta = unwrap(shapeSlackFileMeta({ file: { id: "F0NOTITLE" } }));
    expect(meta.title).toBe("F0NOTITLE");
  });

  it("refuses a file object with no id, since nothing can be keyed on it", () => {
    const shaped = shapeSlackFileMeta({ file: { title: "orphan" } });
    expect(shaped.isErr()).toBe(true);
    expect(shaped._unsafeUnwrapErr().code).toBe("FILE_READ_UNUSABLE");
  });

  it("refuses a non-object", () => {
    expect(shapeSlackFileMeta({ file: null })._unsafeUnwrapErr().code).toBe("FILE_READ_UNUSABLE");
  });

  it("treats a truthy-but-not-true huddle marker as absent rather than guessing", () => {
    const meta = unwrap(shapeSlackFileMeta({ file: huddleCanvas({ is_huddle_canvas: 1 }) }));
    expect(meta.isHuddleCanvas).toBe(false);
  });
});
