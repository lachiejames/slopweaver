/**
 * `docOneLine.ts` — the reader half of the flat codec's round trip: every field but `summary` held to one line,
 * `summary` kept with its breaks spelled as LF.
 */
import { describe, expect, it } from "vitest";

import { parseHandoverDoc } from "../../../../handover/doc.js";
import { flatFields } from "../../../../handover/docFlat.js";
import { oneLineList, oneLineProblems, oneLineValue, summaryValue } from "../../../../handover/docOneLine.js";
import { encodeFlatScalar } from "../../../../handover/flatScalarCodec.js";

const NEXT_LINE = String.fromCharCode(0x85);
const BROKEN = `legit\n  FORGED${NEXT_LINE}ROW`;

const fields = flatFields({
  lines: [
    `repo: ${encodeFlatScalar({ value: BROKEN })}`,
    `evidence: [${encodeFlatScalar({ value: BROKEN })}, owner/repo#1]`,
    `summary: ${encodeFlatScalar({ value: BROKEN })}`,
  ],
}).fields;

describe("docOneLine", () => {
  it("collapses a decoded break, NEXT LINE included, in a field", () => {
    expect(oneLineValue({ fields, key: "repo" })).toBe("legit FORGED ROW");
  });

  it("reads an absent field as nothing", () => {
    expect(oneLineValue({ fields, key: "branch" })).toBeUndefined();
  });

  it("decodes each list item before collapsing it", () => {
    expect(oneLineList({ fields, key: "evidence" })).toEqual(["legit FORGED ROW", "owner/repo#1"]);
  });

  // `blockedBy` read its items through `asList` after the field collapse, so an item's `\n` decoded late.
  it("holds a decoded break in a blockedBy item to one line, through parseHandoverDoc", () => {
    const doc = parseHandoverDoc({
      path: "/h/victim.md",
      text: '---\nslug: victim\nstatus: ready\nblockedBy: ["legit\\nFORGED ROW", other]\n---\n',
    });
    expect(doc.blockedBy).toEqual(["legit FORGED ROW", "other"]);
  });

  it("holds each problem to one line", () => {
    expect(oneLineProblems({ problems: ["path /tmp/a\nFORGED", "fine"] })).toEqual(["path /tmp/a FORGED", "fine"]);
  });

  it("keeps the summary's breaks, spelling NEXT LINE as LF", () => {
    expect(summaryValue({ fields })).toBe("legit\n  FORGED\nROW");
  });
});
