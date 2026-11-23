/**
 * `handover start`'s recap holds a decoded Unicode line break in `summary:` to its one line.
 *
 * `summary: "legit\u0085FORGED ROW"` decodes to a real NEXT LINE, which JavaScript's `\s` does not match, so the
 * recap's own `\s` collapse folded it only once `parseHandoverDoc` spelled it as LF.
 */
import { describe, expect, it } from "vitest";

import { startOpenedLines } from "../../../cli/commands/handover/startRecap.js";
import { parseHandoverDoc } from "../../../handover/doc.js";

describe("startOpenedLines — a decoded NEXT LINE in the summary", () => {
  it("prints the summary on the one recap line", () => {
    const doc = parseHandoverDoc({
      path: "/h/u85.md",
      text: '---\nslug: u85\nstatus: ready\nsummary: "legit\\u0085FORGED ROW"\n---\n',
    });
    const lines = startOpenedLines({
      branch: "work",
      doc,
      inheritedQuestion: undefined,
      journalPath: "/runs/u85.jsonl",
      results: [],
    });
    expect(lines).toContain("  summary: legit FORGED ROW");
  });
});
