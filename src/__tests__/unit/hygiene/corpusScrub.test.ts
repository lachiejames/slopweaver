/**
 * The repair half of the corpus hygiene gate.
 *
 * The contract under test is byte-level: a flagged line loses its token shape and NOTHING else, an unflagged
 * line survives verbatim, and the file's own newline layout is reproduced exactly — a repair that silently
 * added or dropped a trailing newline would move every downstream byte offset the lexical index records.
 * Both seams are injected, so the whole walk runs on a synthetic file with no corpus on disk.
 */
import { describe, expect, it } from "vitest";

import type { CorpusHit } from "../../../hygiene/corpusScan.js";
import { renderCorpusScrub, scrubCorpusCredentials } from "../../../hygiene/corpusScrub.js";

const HOME = "/tmp/does-not-exist-home";

/**
 * The Stripe client-secret shape, ASSEMBLED from synthetic parts rather than written out — a literal would
 * trip the repository hygiene gate on this very file, correctly, since it cannot tell a fixture from a leak.
 * The values are invented; the SHAPE is what is under test.
 */
const STRIPE_SECRET = ["pi_1AaBbCcDdEeFfGgHhIiJjKkLl", "secret", "MmNnOoPpQqRrSsTtUuVvWwXx"].join("_");

/** A bronze line, as the writer lays one out. */
const line = ({ id, text }: { id: string; text: string }): string =>
  JSON.stringify({ kind: "message", source: "slack", sourceId: id, text });

/** A capture of what the repair wrote, plus the reader that fed it. */
function fakeFile({ content }: { content: string }): {
  readLines: (args: { path: string; onLine: (args: { line: string; index: number }) => void }) => void;
  writeFile: (args: { path: string; produce: (args: { write: (args: { text: string }) => void }) => void }) => void;
  written: () => string;
} {
  let out = "";
  return {
    readLines: ({ onLine }) => {
      content.split("\n").forEach((one, index) => {
        onLine({ index, line: one });
      });
    },
    writeFile: ({ produce }) => {
      produce({
        write: ({ text }) => {
          out += text;
        },
      });
    },
    written: () => out,
  };
}

const hit = ({ file, line: at }: { file: string; line: number }): CorpusHit => ({
  file,
  label: "client-secret",
  line: at,
  sourceId: "m1",
});

describe("scrubCorpusCredentials", () => {
  it("rewrites only the flagged line, and scrubs the token shape out of it", () => {
    const content = `${line({ id: "m1", text: `pay at https://x/checkout?client_secret=${STRIPE_SECRET}` })}\n${line({ id: "m2", text: "nothing here" })}\n`;
    const file = fakeFile({ content });
    const result = scrubCorpusCredentials({
      home: HOME,
      leaks: [hit({ file: "slack/compact.jsonl", line: 1 })],
      readLines: file.readLines,
      writeFile: file.writeFile,
    });

    expect(result.linesRewritten).toBe(1);
    expect(result.files).toEqual([{ file: "slack/compact.jsonl", linesRewritten: 1, linesUnchanged: 0 }]);
    expect(file.written()).toContain("[token]");
    expect(file.written()).not.toContain(STRIPE_SECRET);
  });

  it("scrubs every flagged line of one file, not only the first hit it met", () => {
    const content = `${line({ id: "m1", text: `first ${STRIPE_SECRET}` })}\n${line({ id: "m2", text: `second ${STRIPE_SECRET}` })}\n`;
    const file = fakeFile({ content });
    const result = scrubCorpusCredentials({
      home: HOME,
      leaks: [hit({ file: "slack/compact.jsonl", line: 1 }), hit({ file: "slack/compact.jsonl", line: 2 })],
      readLines: file.readLines,
      writeFile: file.writeFile,
    });

    expect(result.files).toEqual([{ file: "slack/compact.jsonl", linesRewritten: 2, linesUnchanged: 0 }]);
    expect(file.written()).not.toContain(STRIPE_SECRET);
  });

  it("reproduces the file byte for byte apart from the scrubbed span, trailing newline included", () => {
    const clean = line({ id: "m2", text: "an ordinary message with a 1234567890 in it" });
    const content = `${line({ id: "m1", text: `secret ${STRIPE_SECRET}` })}\n${clean}\n`;
    const file = fakeFile({ content });
    scrubCorpusCredentials({
      home: HOME,
      leaks: [hit({ file: "slack/compact.jsonl", line: 1 })],
      readLines: file.readLines,
      writeFile: file.writeFile,
    });
    const written = file.written();

    expect(written.split("\n")[1]).toBe(clean);
    expect(written.endsWith("\n")).toBe(true);
    expect(written.split("\n").length).toBe(content.split("\n").length);
  });

  it("leaves a flagged line's digit runs and emails ALONE — only the token passes run", () => {
    const content = `${line({ id: "m1", text: `${STRIPE_SECRET} from a@b.com at 1725760000000` })}\n`;
    const file = fakeFile({ content });
    scrubCorpusCredentials({
      home: HOME,
      leaks: [hit({ file: "slack/compact.jsonl", line: 1 })],
      readLines: file.readLines,
      writeFile: file.writeFile,
    });
    const written = file.written();

    expect(written).toContain("a@b.com");
    expect(written).toContain("1725760000000");
    expect(written).toContain("[token]");
  });

  it("counts a flagged line the redactor did not change rather than reporting it rewritten", () => {
    const content = `${line({ id: "m1", text: "no token here at all" })}\n`;
    const file = fakeFile({ content });
    const result = scrubCorpusCredentials({
      home: HOME,
      leaks: [hit({ file: "slack/compact.jsonl", line: 1 })],
      readLines: file.readLines,
      writeFile: file.writeFile,
    });

    expect(result.linesRewritten).toBe(0);
    expect(result.files[0]!.linesUnchanged).toBe(1);
  });

  it("opens nothing when the failing arm is empty", () => {
    const result = scrubCorpusCredentials({
      home: HOME,
      leaks: [],
      readLines: () => {
        throw new Error("should never read");
      },
      writeFile: () => {
        throw new Error("should never write");
      },
    });

    expect(result.files).toEqual([]);
    expect(result.linesRewritten).toBe(0);
    expect(result.failed).toEqual([]);
  });

  it("names a file it could not repair instead of reporting the repair complete", () => {
    const result = scrubCorpusCredentials({
      home: HOME,
      leaks: [hit({ file: "slack/compact.jsonl", line: 1 })],
      readLines: () => {
        throw new Error("EIO");
      },
      writeFile: ({ produce }) => {
        produce({ write: () => undefined });
      },
    });

    expect(result.files).toEqual([]);
    expect(result.failed).toEqual([{ file: "slack/compact.jsonl", reason: "EIO" }]);
  });
});

describe("renderCorpusScrub", () => {
  it("says plainly when there was nothing to repair", () => {
    const lines = renderCorpusScrub({ result: { failed: [], files: [], linesRewritten: 0 } });

    expect(lines.join("\n")).toContain("nothing to repair");
  });

  it("tells the reader to re-run the scan rather than trusting the repair's own word", () => {
    const lines = renderCorpusScrub({
      result: {
        failed: [],
        files: [{ file: "slack/compact.jsonl", linesRewritten: 6, linesUnchanged: 0 }],
        linesRewritten: 6,
      },
    });
    const text = lines.join("\n");

    expect(text).toContain("rewrote 6 line(s) in 1 file(s)");
    expect(text).toContain("Re-run `slopweaver audit hygiene`");
  });

  it("names a failed file in the report", () => {
    const lines = renderCorpusScrub({
      result: { failed: [{ file: "linear/compact.jsonl", reason: "EACCES" }], files: [], linesRewritten: 0 },
    });

    expect(lines.join("\n")).toContain("FAILED linear/compact.jsonl: EACCES");
  });
});
