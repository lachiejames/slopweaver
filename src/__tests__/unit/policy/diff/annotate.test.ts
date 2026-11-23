import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { alignDocuments } from "../../../../policy/diff/align.js";
import { annotateRows } from "../../../../policy/diff/annotate.js";
import { type DocDiffDocument, parseDocDiffRecord } from "../../../../policy/diff/record.js";
import { documentUnits } from "../../../../policy/diff/units.js";
import { recordText, SOURCES } from "./fixture.js";

const sides = SOURCES.get("network")!;
const rows = alignDocuments({
  after: documentUnits({ markdown: sides.after }).units,
  before: documentUnits({ markdown: sides.before }).units,
});
const document = unwrap(parseDocDiffRecord({ text: recordText() })).documents[0]!;

/** The fixture document with its changes replaced. */
function withChanges({ changes }: { changes: DocDiffDocument["changes"] }): DocDiffDocument {
  return { ...document, changes };
}

describe("annotateRows", () => {
  it("gives every material row exactly one change, and marks any row it matches", () => {
    const annotated = unwrap(annotateRows({ document, rows }));
    expect(annotated.map((row) => [row.kind, row.change === null ? null : row.change.id])).toEqual([
      ["same", null],
      ["same", null],
      ["formatting", null],
      ["changed", "refresh"],
      ["added", "bypass"],
    ]);
    expect(annotated[4]!.marks.map((mark) => mark.id)).toEqual(["unasked"]);
  });

  it("refuses a material row no change explains", () => {
    const issues = unwrapErr(annotateRows({ document: withChanges({ changes: [document.changes[0]!] }), rows }));
    expect(issues.map((issue) => issue.code)).toEqual(["UNCOVERED_ROW"]);
    expect(issues[0]!.message).toContain("The public bypass on the Core API is still live.");
  });

  it("refuses a row two changes both claim", () => {
    const greedy = { id: "greedy", match: ["still live"], was: "x", why: "y" };
    const issues = unwrapErr(annotateRows({ document: withChanges({ changes: [...document.changes, greedy] }), rows }));
    expect(issues.map((issue) => issue.code)).toEqual(["AMBIGUOUS_ROW"]);
  });

  it("claims a row by a whole line where its text is the start of longer lines, and a match string still by substring", () => {
    const paths = alignDocuments({
      after: documentUnits({
        markdown: "Paths:\n\n- `packages/infra/cloud/gcp/vpc.ts` holds every VPC.\n- `packages/infra/cloud`",
      }).units,
      before: documentUnits({ markdown: "Paths:\n\n- `packages/infra/cloud/gcp/vpc.ts` holds the VPC." }).units,
    });
    const vpc = { id: "vpc", match: ["holds every VPC"], was: "x", why: "y" };
    const byLine = { id: "index", line: ["packages/infra/cloud"], match: [], was: "x", why: "y" };
    const bySubstring = { id: "index", match: ["packages/infra/cloud"], was: "x", why: "y" };
    const annotated = unwrap(
      annotateRows({ document: { ...withChanges({ changes: [vpc, byLine] }), marks: [] }, rows: paths }),
    );
    const greedy = unwrapErr(
      annotateRows({ document: { ...withChanges({ changes: [vpc, bySubstring] }), marks: [] }, rows: paths }),
    );
    expect(annotated.map((row) => [row.kind, row.change === null ? null : row.change.id])).toEqual([
      ["same", null],
      ["changed", "vpc"],
      ["added", "index"],
    ]);
    expect(greedy.map((issue) => issue.code)).toEqual(["AMBIGUOUS_ROW"]);
  });

  it("refuses a change that claims nothing", () => {
    const stale = { id: "stale", match: ["no such line"], was: "x", why: "y" };
    const issues = unwrapErr(annotateRows({ document: withChanges({ changes: [...document.changes, stale] }), rows }));
    expect(issues.map((issue) => issue.message)).toEqual([
      "network: change stale matches no line it could apply to — its match strings no longer describe the diff",
    ]);
  });

  it("refuses a mark that lands on nothing", () => {
    const mark = { id: "gone", label: "Gone", match: ["absent"], note: "n", tone: "amber" as const };
    const issues = unwrapErr(annotateRows({ document: { ...document, marks: [mark] }, rows }));
    expect(issues.map((issue) => issue.code)).toEqual(["UNUSED_ENTRY"]);
  });
});
