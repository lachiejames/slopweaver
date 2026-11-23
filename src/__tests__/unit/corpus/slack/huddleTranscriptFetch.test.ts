import { describe, expect, it } from "vitest";

import { type CuratedApi, fetchSlackCurated } from "../../../../corpus/slack/curatedFetch.js";
import type { SlackNameMaps } from "../../../../corpus/slack/visibleProse.js";

/** One raw `files.list` huddle-notes canvas. */
function notesFile({ id, transcriptId }: { id: string; transcriptId: string | undefined }): Record<string, unknown> {
  return {
    channels: ["C1"],
    created: 1_787_000_000,
    filetype: "quip",
    huddle_date_end: 1_787_895_799,
    huddle_date_start: 1_787_894_259,
    ...(transcriptId !== undefined ? { huddle_transcript_file_id: transcriptId } : {}),
    id,
    is_huddle_canvas: true,
    permalink: `https://example.slack.com/docs/T1/${id}`,
    title: "Huddle notes",
  };
}

/** The seam under test: a `files.list` page plus a scripted `files.info`, with a call log. */
function harness({
  files,
  info,
}: {
  files: readonly Record<string, unknown>[];
  info: (args: { fileId: string; includeTranscription?: boolean }) => Promise<{ file: unknown }>;
}): { api: CuratedApi; calls: { fileId: string; includeTranscription: boolean }[] } {
  const calls: { fileId: string; includeTranscription: boolean }[] = [];
  const api: CuratedApi = {
    files: () => Promise.resolve({ files }),
    filesInfo: (args) => {
      calls.push({ fileId: args.fileId, includeTranscription: args.includeTranscription === true });
      return info(args);
    },
  };
  return { api, calls };
}

const MAPS: SlackNameMaps = { channelNames: {}, userNames: { U089B: "Ada" } };

/** Run the curated lane over the given seam, with no channels so only the files walk runs. */
async function curated({ api }: { api: CuratedApi }) {
  return fetchSlackCurated({ api, channels: [], maps: MAPS, workspaceUrl: "https://example.slack.com" });
}

describe("the huddle transcript lane", () => {
  it("asks files.info for the TRANSCRIPT file with include_transcription, and stores the rendered words", async () => {
    const { api, calls } = harness({
      files: [notesFile({ id: "F_NOTES", transcriptId: "F_TRANS" })],
      info: () =>
        Promise.resolve({
          file: {
            huddle_transcription: {
              lines: [{ contents: "we shipped it", start_time_ms: 13_000, user_id: "U089B" }],
            },
            id: "F_TRANS",
          },
        }),
    });
    const { items } = await curated({ api });
    expect(calls).toEqual([{ fileId: "F_TRANS", includeTranscription: true }]);
    expect(items.huddles[0]!.transcriptText).toBe("[00:13] Ada: we shipped it");
  });

  it("makes no call at all for a huddle Slack generated no transcript for", async () => {
    const { api, calls } = harness({
      files: [notesFile({ id: "F_NOTES", transcriptId: undefined })],
      info: () => Promise.reject(new Error("must not be called")),
    });
    const { items } = await curated({ api });
    expect(calls).toEqual([]);
    expect(items.huddles[0]!.transcriptText).toBe(undefined);
  });

  it("leaves a huddle body-less rather than inventing words when the response carried no transcription", async () => {
    const { api } = harness({
      files: [notesFile({ id: "F_NOTES", transcriptId: "F_TRANS" })],
      info: () => Promise.resolve({ file: { id: "F_TRANS" } }),
    });
    const { items, warnings } = await curated({ api });
    expect(items.huddles[0]!.transcriptText).toBe(undefined);
    expect(warnings).toEqual([]);
  });

  it("warns and keeps going when one huddle's transcript call throws — it must not sink the others", async () => {
    const { api } = harness({
      files: [notesFile({ id: "F_A", transcriptId: "F_TA" }), notesFile({ id: "F_B", transcriptId: "F_TB" })],
      info: ({ fileId }) =>
        fileId === "F_TA"
          ? Promise.reject(new Error("file_not_found"))
          : Promise.resolve({
              file: { huddle_transcription: { lines: [{ contents: "kept", user_id: "U089B" }] }, id: fileId },
            }),
    });
    const { items, warnings } = await curated({ api });
    expect(items.huddles.length).toBe(2);
    expect(items.huddles[0]!.transcriptText).toBe(undefined);
    expect(items.huddles[1]!.transcriptText).toBe("Ada: kept");
    expect(warnings).toEqual(["slack huddle transcript F_TA skipped: file_not_found"]);
  });
});
