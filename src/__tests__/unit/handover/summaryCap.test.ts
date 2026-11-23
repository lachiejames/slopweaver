import { describe, expect, it } from "vitest";

import {
  MAX_SUMMARY_BYTES,
  summaryCapOffence,
  summaryCapRefusalLines,
  summaryKeyLine,
  summaryScalar,
  summaryWrittenFit,
} from "../../../handover/summaryCap.js";

/** A doc whose `summary:` holds exactly `bytes` ASCII characters, with the key on line 3. */
const docWith = ({ bytes }: { bytes: number }): string =>
  `---\nslug: s\nsummary: "${"a".repeat(bytes)}"\nstatus: ready\n---\n\n# body\n`;

describe("summaryKeyLine", () => {
  it("reports the 1-based line the key sits on", () => {
    expect(summaryKeyLine({ text: docWith({ bytes: 4 }) })).toBe(3);
  });

  it("reports the top of the file when no line starts with the key", () => {
    expect(summaryKeyLine({ text: "---\nslug: s\n---\n" })).toBe(1);
  });

  it("reads a CRLF doc the same as an LF one", () => {
    expect(summaryKeyLine({ text: docWith({ bytes: 4 }).replace(/\n/g, "\r\n") })).toBe(3);
  });
});

describe("summaryCapOffence", () => {
  it("passes a summary exactly at the cap", () => {
    const offence = summaryCapOffence({
      docPath: "/d.md",
      summary: "a".repeat(MAX_SUMMARY_BYTES),
      text: docWith({ bytes: MAX_SUMMARY_BYTES }),
    });
    expect(offence).toBeUndefined();
  });

  it("refuses one byte over the cap", () => {
    const summary = "a".repeat(MAX_SUMMARY_BYTES + 1);
    const offence = summaryCapOffence({ docPath: "/d.md", summary, text: docWith({ bytes: summary.length }) });
    expect(offence!.bytes).toBe(MAX_SUMMARY_BYTES + 1);
    expect(offence!.cap).toBe(MAX_SUMMARY_BYTES);
    expect(offence!.line).toBe(3);
    expect(offence!.message).toContain("/d.md:3");
    expect(offence!.message).toContain("8001-byte `summary:`");
  });

  it("passes a doc that declares no summary at all", () => {
    expect(summaryCapOffence({ docPath: "/d.md", summary: undefined, text: "---\nslug: s\n---\n" })).toBeUndefined();
  });

  it("passes an empty summary", () => {
    expect(summaryCapOffence({ docPath: "/d.md", summary: "", text: docWith({ bytes: 0 }) })).toBeUndefined();
  });

  it("measures BYTES, not characters, so a multi-byte summary under the character cap is still refused", () => {
    // 4,001 three-byte characters is 12,003 bytes but only 4,001 characters — under the cap by length, over
    // it by `wc -c`, which is the unit the refusal quotes.
    const summary = "文".repeat(4001);
    expect(summary.length).toBe(4001);
    const offence = summaryCapOffence({ docPath: "/d.md", summary, text: docWith({ bytes: 10 }) });
    expect(offence!.bytes).toBe(12003);
  });

  it("counts every character of the value it is handed, quote characters included", () => {
    // The flat reader strips a double-quoted scalar's own quotes (`docFlat.ts`), so these are quotes INSIDE the
    // value: 7,998 characters plus two is the last value that opens a run.
    const quoted = `"${"a".repeat(MAX_SUMMARY_BYTES - 2)}"`;
    expect(summaryCapOffence({ docPath: "/d.md", summary: quoted, text: docWith({ bytes: 10 }) })).toBeUndefined();
    const oneMore = `"${"a".repeat(MAX_SUMMARY_BYTES - 1)}"`;
    expect(summaryCapOffence({ docPath: "/d.md", summary: oneMore, text: docWith({ bytes: 10 }) })!.bytes).toBe(
      MAX_SUMMARY_BYTES + 1,
    );
  });

  it("measures the field, not the line count — a one-line summary over the cap is still refused", () => {
    const summary = "a".repeat(MAX_SUMMARY_BYTES + 500);
    const text = docWith({ bytes: summary.length });
    expect(text.split("\n").filter((line) => line.startsWith("summary:"))).toHaveLength(1);
    expect(summaryCapOffence({ docPath: "/d.md", summary, text })!.bytes).toBe(MAX_SUMMARY_BYTES + 500);
  });
});

describe("summaryWrittenFit", () => {
  it("measures the written scalar, quotes included, admitting it exactly at the cap and refusing one byte over", () => {
    expect(summaryWrittenFit({ summary: "a".repeat(MAX_SUMMARY_BYTES - 2) })).toEqual({
      bytes: MAX_SUMMARY_BYTES,
      fits: true,
    });
    expect(summaryWrittenFit({ summary: "a".repeat(MAX_SUMMARY_BYTES - 1) })).toEqual({
      bytes: MAX_SUMMARY_BYTES + 1,
      fits: false,
    });
  });

  it("counts a three-byte character as three, and an escaped quote as two", () => {
    expect(summaryWrittenFit({ summary: 'ࠀ"' })).toEqual({ bytes: 7, fits: true });
  });

  it("is the spelling a registered row writes", () => {
    expect(summaryScalar({ summary: 'say "hi"\n' })).toBe('"say \\"hi\\"\\n"');
  });
});

describe("summaryCapRefusalLines", () => {
  it("says nothing when there is no offence", () => {
    expect(summaryCapRefusalLines({ offence: undefined })).toEqual([]);
  });

  it("names the offence, what unblocks it, and where the measurement lives", () => {
    const summary = "a".repeat(MAX_SUMMARY_BYTES + 1);
    const offence = summaryCapOffence({ docPath: "/d.md", summary, text: docWith({ bytes: summary.length }) })!;
    const lines = summaryCapRefusalLines({ offence });
    expect(lines[0]).toBe("handover start: this doc's `summary:` breaks its size contract:");
    expect(lines[1]).toBe(`  - ${offence.message}`);
    expect(lines[2]).toContain("slopweaver handover check");
    expect(lines[3]).toContain("skills/handover/reference/verifying-a-doc.md");
    expect(lines).toHaveLength(4);
  });
});
