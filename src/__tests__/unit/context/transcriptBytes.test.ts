/**
 * `src/context/transcriptBytes.ts` — the two bounded reads a delivery marker makes of a transcript, over real files in
 * a temp directory. A directory at the transcript's path fails every read whoever runs the test, where a chmod would
 * not stop root.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { transcriptBytesFrom, transcriptLastWholeLineEnd } from "../../../context/transcriptBytes.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("transcriptBytes", () => {
  let dir: string;
  let transcript: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "transcript-bytes-"));
    transcript = join(dir, "session.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("reads the bytes past an offset, none past the end, and nothing for a file shorter than it", () => {
    writeFileSync(transcript, "one\ntwo\n");
    const tail = unwrap(transcriptBytesFrom({ offset: 4, path: transcript }));
    const atEnd = unwrap(transcriptBytesFrom({ offset: 8, path: transcript }));
    const pastEnd = unwrap(transcriptBytesFrom({ offset: 9, path: transcript }));
    expect([tail!.toString("utf8"), atEnd!.length, pastEnd]).toEqual(["two\n", 0, undefined]);
  });

  it("reads a missing transcript as empty at offset zero, and as not the one checked past it", () => {
    const fresh = unwrap(transcriptBytesFrom({ offset: 0, path: transcript }));
    const gone = unwrap(transcriptBytesFrom({ offset: 4, path: transcript }));
    expect([fresh!.length, gone]).toEqual([0, undefined]);
  });

  it("ends at the last whole line, leaving a line the host is still writing for the next check", () => {
    writeFileSync(transcript, "one\ntwo\nthr");
    const partial = unwrap(transcriptLastWholeLineEnd({ path: transcript }));
    writeFileSync(transcript, "no newline yet");
    const none = unwrap(transcriptLastWholeLineEnd({ path: transcript }));
    const missing = unwrap(transcriptLastWholeLineEnd({ path: join(dir, "absent.jsonl") }));
    expect([partial, none, missing]).toEqual([8, 0, 0]);
  });

  it("finds a line end further back than one tail step", () => {
    writeFileSync(transcript, `head\n${"x".repeat(70 * 1024)}`);
    expect(unwrap(transcriptLastWholeLineEnd({ path: transcript }))).toBe(5);
  });

  it("names the transcript it could not read, on either read", () => {
    mkdirSync(transcript);
    const from = unwrapErr(transcriptBytesFrom({ offset: 0, path: transcript }));
    const end = unwrapErr(transcriptLastWholeLineEnd({ path: transcript }));
    expect([from.code, end.code]).toEqual(["TRANSCRIPT_UNREADABLE", "TRANSCRIPT_UNREADABLE"]);
    expect(from.message).toContain(`the transcript ${transcript} could not be read`);
  });
});
