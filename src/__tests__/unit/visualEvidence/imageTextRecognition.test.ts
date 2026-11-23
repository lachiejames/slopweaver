import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  ImageTextErrors,
  parseRecognisedImageText,
  RECOGNISE_PROGRAM,
  RECOGNISE_TIMEOUT_MS,
  type RecogniserRun,
  recogniseImageText,
  recogniserRunFailure,
} from "../../../visualEvidence/imageTextRecognition.js";

/** Synthetic bytes; the fake recogniser reads them back from the file the module wrote. */
const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

/** What one fake run saw: the command, the bytes on disk at that moment, their mode, and where they were. */
interface Seen {
  readonly file: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly bytesOnDisk: readonly number[];
  readonly mode: number;
  readonly path: string;
}

/** A recogniser seam that records what it saw and then answers, or throws, as told. */
function recordingRun({ answer }: { answer: () => string }): { run: RecogniserRun; seen: Seen[] } {
  const seen: Seen[] = [];
  const run: RecogniserRun = ({ file, args, timeoutMs }) => {
    const path = args.at(-1)!;
    seen.push({
      args,
      bytesOnDisk: [...readFileSync(path)],
      file,
      mode: statSync(path).mode & 0o777,
      path,
      timeoutMs,
    });
    return answer();
  };
  return { run, seen };
}

describe("recogniseImageText", () => {
  it("refuses a host that is not macOS without running anything", () => {
    const { run, seen } = recordingRun({ answer: () => '{"lines":[]}' });
    const result = recogniseImageText({ bytes: BYTES, hostOs: "linux", run });
    expect(unwrapErr(result).code).toBe("UNSUPPORTED_HOST");
    expect(unwrapErr(result).message).toBe("text in an image is read with macOS Vision, and this host is linux");
    expect(seen).toEqual([]);
  });

  it("runs the constant program over an owner-only copy of the exact bytes, then removes it", () => {
    const { run, seen } = recordingRun({
      answer: () => '{"lines":[{"text":"Ticket ABC-1 for Acme Widgets","confidence":1}]}',
    });
    const result = recogniseImageText({ bytes: BYTES, hostOs: "darwin", run });
    expect(unwrap(result).lines).toEqual(["Ticket ABC-1 for Acme Widgets"]);
    const call = seen[0]!;
    expect(seen.length).toBe(1);
    expect(call.file).toBe("/usr/bin/osascript");
    expect(call.args.slice(0, 4)).toEqual(["-l", "JavaScript", "-e", RECOGNISE_PROGRAM]);
    expect(call.timeoutMs).toBe(RECOGNISE_TIMEOUT_MS);
    expect(call.bytesOnDisk).toEqual([...BYTES]);
    expect(call.mode).toBe(0o600);
    expect(existsSync(dirname(call.path))).toBe(false);
  });

  it("removes its copy when the recogniser throws", () => {
    const { run, seen } = recordingRun({
      answer: () => {
        throw Object.assign(new Error("killed"), { code: "ETIMEDOUT" });
      },
    });
    const result = recogniseImageText({ bytes: BYTES, hostOs: "darwin", run, timeoutMs: 5000 });
    expect(unwrapErr(result).code).toBe("RECOGNISER_TIMED_OUT");
    expect(unwrapErr(result).message).toBe("the text recogniser did not finish within 5s");
    expect(existsSync(dirname(seen[0]!.path))).toBe(false);
  });

  it("refuses an answer that is not the agreed shape", () => {
    const { run } = recordingRun({ answer: () => '{"lines":"Acme Widgets"}' });
    const result = recogniseImageText({ bytes: BYTES, hostOs: "darwin", run });
    expect(unwrapErr(result).code).toBe("RECOGNISER_OUTPUT_MALFORMED");
  });
});

describe("recogniserRunFailure", () => {
  it("names a non-zero exit by its status", () => {
    const failure = recogniserRunFailure({ cause: Object.assign(new Error("x"), { status: 1 }), timeoutMs: 10 });
    expect(failure).toEqual(ImageTextErrors.recogniserFailed({ exitStatus: 1 }));
    expect(failure.message).toBe("the text recogniser exited 1");
  });

  it("names a run that never started as not run", () => {
    const failure = recogniserRunFailure({ cause: "spawn failed", timeoutMs: 10 });
    expect(failure.message).toBe("the text recogniser could not be run");
  });

  it("carries none of the recogniser's own output", () => {
    const cause = Object.assign(new Error("Acme Widgets"), { status: 1, stderr: "Acme Widgets", stdout: "ABC-1" });
    expect(cause.stderr).toBe("Acme Widgets");
    const failure = recogniserRunFailure({ cause, timeoutMs: 10 });
    expect(JSON.stringify(failure)).not.toContain("Acme");
    expect(JSON.stringify(failure)).not.toContain("ABC-1");
  });
});

describe("parseRecognisedImageText", () => {
  it("keeps every top candidate whatever its confidence, and drops a blank one", () => {
    const stdout = JSON.stringify({
      lines: [
        { confidence: 0.12, text: "Acme Widgets" },
        { confidence: 1, text: "   " },
        { confidence: 0.9, text: "ABC-1" },
      ],
    });
    expect(unwrap(parseRecognisedImageText({ stdout })).lines).toEqual(["Acme Widgets", "ABC-1"]);
  });

  it("reads an image with no recognised text as no lines", () => {
    expect(unwrap(parseRecognisedImageText({ stdout: '{"lines":[]}' })).lines).toEqual([]);
  });

  it("refuses output that is not JSON, without echoing it", () => {
    const stdout = "Acme Widgets ABC-1";
    const result = parseRecognisedImageText({ stdout });
    expect(unwrapErr(result).code).toBe("RECOGNISER_OUTPUT_MALFORMED");
    expect(unwrapErr(result).message).toBe("the text recogniser's answer was not the shape it is asked for");
  });

  it("refuses a key the shape does not declare", () => {
    const stdout = '{"lines":[],"extra":true}';
    expect(unwrapErr(parseRecognisedImageText({ stdout })).code).toBe("RECOGNISER_OUTPUT_MALFORMED");
  });

  it("refuses a confidence outside zero to one", () => {
    const stdout = '{"lines":[{"text":"Acme","confidence":2}]}';
    expect(unwrapErr(parseRecognisedImageText({ stdout })).code).toBe("RECOGNISER_OUTPUT_MALFORMED");
  });
});
