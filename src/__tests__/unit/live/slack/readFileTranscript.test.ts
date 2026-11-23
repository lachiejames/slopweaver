import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { err, unwrap } from "../../../../lib/result.js";
import { SlackFileDownloadErrors } from "../../../../live/slack/downloadErrors.js";
import { type ReadSlackFileDeps, readSlackFile } from "../../../../live/slack/readFile.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** The notes canvas, as `files.info` returns one for a huddle. */
const NOTES: Record<string, unknown> = {
  filetype: "quip",
  huddle_transcript_file_id: "F0BSVQT5MRD",
  id: "F0BTACLP1D0",
  is_huddle_canvas: true,
  permalink: "https://example.slack.com/docs/T1/F0BTACLP1D0",
  title: "Huddle notes",
};

/** The transcript file, with the words Slack returns inline under `include_transcription=true`. */
const TRANSCRIPT_WITH_WORDS: Record<string, unknown> = {
  filetype: "huddle_transcript",
  huddle_transcription: {
    date_end: 1_787_895_799,
    date_start: 1_787_894_259,
    lines: [
      { contents: "we shipped it", start_time_ms: 13_000, user_id: "U089B" },
      { contents: "and it held", start_time_ms: 41_000, user_id: "U0ATJ" },
    ],
  },
  id: "F0BSVQT5MRD",
  title: "Huddle transcript",
  url_private: "https://files.slack.com/files-pri/T1-F0BSVQT5MRD/transcript",
};

/**
 * The injected edges: a scripted `files.info` and a download that always refuses, so any test whose
 * assertion depends on bytes arriving fails loudly rather than passing on a fallback.
 */
function deps({
  transcriptFile,
  calls = [],
}: {
  transcriptFile: unknown;
  calls?: { fileId: string; includeTranscription: boolean }[];
}): ReadSlackFileDeps {
  return {
    api: {
      filesInfo: (args) => {
        calls.push({ fileId: args.fileId, includeTranscription: args.includeTranscription === true });
        return Promise.resolve({ file: args.fileId === "F0BTACLP1D0" ? NOTES : transcriptFile });
      },
    },
    downloadFile: ({ filename }) =>
      Promise.resolve(
        err(
          SlackFileDownloadErrors.redirectUnusable({
            filename,
            reason: "Slack bounced it to the workspace root — a browser session, not a token, is what it serves",
          }),
        ),
      ),
    nowIso: () => "2026-08-29T02:00:00.000Z",
  };
}

/** Read the huddle notes into a throwaway files root, returning the document. */
async function read({ deps: injected }: { deps: ReadSlackFileDeps }) {
  const filesRoot = mkdtempSync(join(tmpdir(), "slopweaver-read-file-"));
  fixtureDirs.push(filesRoot);
  return unwrap(
    await readSlackFile({
      deps: injected,
      filesRoot,
      followTranscript: true,
      reference: "F0BTACLP1D0",
      token: "xoxp-test",
    }),
  );
}

describe("readSlackFile — the huddle transcript", () => {
  it("asks the TRANSCRIPT file for its words and the notes canvas for none", async () => {
    const calls: { fileId: string; includeTranscription: boolean }[] = [];
    await read({ deps: deps({ calls, transcriptFile: TRANSCRIPT_WITH_WORDS }) });
    expect(calls).toEqual([
      { fileId: "F0BTACLP1D0", includeTranscription: false },
      { fileId: "F0BSVQT5MRD", includeTranscription: true },
    ]);
  });

  it("returns the rendered words even though the transcript's BYTES are refused", async () => {
    const document = await read({ deps: deps({ transcriptFile: TRANSCRIPT_WITH_WORDS }) });
    expect(document.transcript!.body!.text).toBe("[00:13] <@U089B>: we shipped it\n\n[00:41] <@U0ATJ>: and it held");
  });

  it("lands the rendered words on disk, so a caller has a path to open", async () => {
    const document = await read({ deps: deps({ transcriptFile: TRANSCRIPT_WITH_WORDS }) });
    const body = document.transcript!.body!;
    expect(readFileSync(body.localPath, "utf8")).toBe(body.text);
    expect(body.bytes).toBe(62);
  });

  it("does not report the transcript's own bytes as residue when the words arrived inline", async () => {
    const document = await read({ deps: deps({ transcriptFile: TRANSCRIPT_WITH_WORDS }) });
    expect(document.residue.some((line) => line.includes("F0BSVQT5MRD"))).toBe(false);
  });

  it("falls back to the doomed download and SAYS SO when the response carried no transcription", async () => {
    const document = await read({
      deps: deps({ transcriptFile: { filetype: "huddle_transcript", id: "F0BSVQT5MRD" } }),
    });
    expect(document.transcript!.body).toBe(undefined);
    expect(document.residue).toContain(
      "F0BSVQT5MRD returned no inline transcription — falling back to its bytes, which Slack serves to a browser session and not to a token",
    );
  });
});

describe("readSlackFile — the notes canvas is unaffected", () => {
  it("still reports what the notes canvas's own bytes could not do", async () => {
    const document = await read({ deps: deps({ transcriptFile: TRANSCRIPT_WITH_WORDS }) });
    expect(document.file.id).toBe("F0BTACLP1D0");
    expect(document.body).toBe(undefined);
    expect(document.residue.length).toBeGreaterThan(0);
  });
});
