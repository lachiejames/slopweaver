import { describe, expect, it } from "vitest";

import { renderHuddleTranscript, shapeHuddleTranscript } from "../../../../live/slack/huddleTranscript.js";

/**
 * A raw `files.info` response's `file` member, shaped like the real one measured —
 * `files.info file=<transcript id> include_transcription=true` on the owner's own workspace.
 */
function transcriptFile(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    filetype: "huddle_transcript",
    huddle_transcription: {
      channel_id: "D0ASA",
      date_end: 1787_895_799,
      date_start: 1787_894_259,
      lines: [
        { contents: "The context is being captured.", line_id: "a", start_time_ms: 13_000, user_id: "U089B" },
        { contents: "Alright. OK, all right.", line_id: "b", start_time_ms: 25_000, user_id: "U0ATJ" },
      ],
      transcription_time_ranges: [{ start_ts: "1787894271.000000", stop_ts: "1787895801.000000" }],
    },
    id: "F0BSV",
    ...over,
  };
}

describe("shapeHuddleTranscript", () => {
  it("shapes every spoken line with its speaker and offset", () => {
    const transcript = shapeHuddleTranscript({ file: transcriptFile() })!;
    expect(transcript.lines.length).toBe(2);
    expect(transcript.lines[0]!.contents).toBe("The context is being captured.");
    expect(transcript.lines[0]!.speakerId).toBe("U089B");
    expect(transcript.lines[0]!.startMs).toBe(13_000);
  });

  it("carries the transcription's own channel and window, which the notes file does not", () => {
    const transcript = shapeHuddleTranscript({ file: transcriptFile() })!;
    expect(transcript.channelId).toBe("D0ASA");
    expect(transcript.startedIso).toBe("2026-08-28T05:17:39.000Z");
    expect(transcript.endedIso).toBe("2026-08-28T05:43:19.000Z");
  });

  it("returns undefined for a file.info response that carried no transcription at all", () => {
    expect(shapeHuddleTranscript({ file: { filetype: "huddle_transcript", id: "F0BSV" } })).toBe(undefined);
  });

  it("returns undefined rather than an empty transcript when every line was blank", () => {
    const file = transcriptFile({ huddle_transcription: { lines: [{ contents: "  " }, { contents: "" }] } });
    expect(shapeHuddleTranscript({ file })).toBe(undefined);
  });

  it("drops a malformed line rather than the whole transcription", () => {
    const file = transcriptFile({
      huddle_transcription: { lines: ["not an object", { contents: "kept", user_id: "U1" }] },
    });
    expect(shapeHuddleTranscript({ file })!.lines.length).toBe(1);
  });

  it("returns undefined for a non-object file", () => {
    expect(shapeHuddleTranscript({ file: "F0BSV" })).toBe(undefined);
  });

  it("leaves the window unset when Slack dated neither end", () => {
    const file = transcriptFile({ huddle_transcription: { lines: [{ contents: "said", user_id: "U1" }] } });
    const transcript = shapeHuddleTranscript({ file })!;
    expect(transcript.startedIso).toBe(undefined);
    expect(transcript.endedIso).toBe(undefined);
  });
});

describe("renderHuddleTranscript", () => {
  it("renders `[mm:ss] name: words`, blank-line separated so the corpus chunker can cut it", () => {
    const transcript = shapeHuddleTranscript({ file: transcriptFile() })!;
    const rendered = renderHuddleTranscript({ speakerNames: { U089B: "Ada", U0ATJ: "Grace" }, transcript });
    expect(rendered).toBe("[00:13] Ada: The context is being captured.\n\n[00:25] Grace: Alright. OK, all right.");
  });

  it("keeps an unresolved speaker as Slack's own mention syntax rather than inventing a placeholder", () => {
    const transcript = shapeHuddleTranscript({ file: transcriptFile() })!;
    expect(renderHuddleTranscript({ transcript })).toBe(
      "[00:13] <@U089B>: The context is being captured.\n\n[00:25] <@U0ATJ>: Alright. OK, all right.",
    );
  });

  it("does not wrap minutes into hours — a huddle is one sitting", () => {
    const file = transcriptFile({
      huddle_transcription: { lines: [{ contents: "late", start_time_ms: 3_725_000, user_id: "U1" }] },
    });
    const transcript = shapeHuddleTranscript({ file })!;
    expect(renderHuddleTranscript({ transcript })).toBe("[62:05] <@U1>: late");
  });

  it("omits the stamp and the speaker Slack did not report, rather than printing blanks", () => {
    const file = transcriptFile({ huddle_transcription: { lines: [{ contents: "anonymous" }] } });
    const transcript = shapeHuddleTranscript({ file })!;
    expect(renderHuddleTranscript({ transcript })).toBe("anonymous");
  });

  it("floors a negative offset to 00:00 rather than rendering a negative stamp", () => {
    const file = transcriptFile({
      huddle_transcription: { lines: [{ contents: "early", start_time_ms: -500, user_id: "U1" }] },
    });
    const transcript = shapeHuddleTranscript({ file })!;
    expect(renderHuddleTranscript({ transcript })).toBe("[00:00] <@U1>: early");
  });
});
