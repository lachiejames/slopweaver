import { describe, expect, it } from "vitest";

import { parseHandoverDoc } from "../../../handover/doc.js";
import { withRowProblems } from "../../../handover/rowProblems.js";

/** A well-formed draft doc, parsed the way the board parses one. */
const DRAFT = parseHandoverDoc({
  path: "/tmp/handovers/a-draft-row.md",
  text: "---\nslug: a-draft-row\nstatus: draft\n---\n\n# A draft row\n",
});

/**
 * The declared front-matter a row carries, read by key.
 *
 * @returns the reader
 */
function declared({ status }: { status: string }): (args: { key: string }) => string | undefined {
  const values = new Map([["status", status]]);
  return ({ key }) => values.get(key);
}

describe("withRowProblems", () => {
  it("returns a row with no defect as it is", () => {
    expect(DRAFT.problems).toEqual([]);
    expect(withRowProblems({ doc: DRAFT, named: declared({ status: "draft" }) })).toBe(DRAFT);
  });

  it("adds a pause field written beside another status to the row's problems", () => {
    const doc = { ...DRAFT, pausedOn: "a colleague" };
    expect(withRowProblems({ doc, named: declared({ status: "draft" }) }).problems).toEqual([
      "pausedOn is only meaningful on a paused row — declare `status: paused` or remove it",
    ]);
  });

  it("reports a declared settlement that is none of the settlements, which the parser reads as unsettled", () => {
    const doc = parseHandoverDoc({
      path: "/tmp/handovers/a-draft-row.md",
      text: "---\nslug: a-draft-row\nstatus: draft\nsettlement: typo\n---\n\n# A draft row\n",
    });
    expect(doc.settlement).toBe(undefined);
    expect(doc.problems).toEqual([
      'settlement: "typo" is not a settlement — use filed, answered, declined, or remove it',
    ]);
  });

  it("reports nothing for a recognised settlement value", () => {
    const named = ({ key }: { key: string }) =>
      new Map([
        ["settlement", "answered"],
        ["status", "draft"],
      ]).get(key);
    expect(withRowProblems({ doc: DRAFT, named })).toBe(DRAFT);
  });
});
