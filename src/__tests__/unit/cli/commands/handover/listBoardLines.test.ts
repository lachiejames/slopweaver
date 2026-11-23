/**
 * The board half of `handover list`'s text output, over models composed in memory. The collision and
 * stale-repository halves read disk and git, so `subprocess/handover/listDetachedAsk.test.ts` covers them.
 */
import { describe, expect, it } from "vitest";

import { boardAndFootnoteLines } from "../../../../../cli/commands/handover/listBoardLines.js";
import { composeBoardModels } from "../../../../../handover/boardState.js";
import { type HandoverDoc, parseHandoverDoc } from "../../../../../handover/doc.js";
import { EMPTY_TAG_FILTER } from "../../../../../handover/tagFilter.js";

/** A ready doc at a path nothing on disk holds. */
function ready({ slug }: { slug: string }): HandoverDoc {
  const text = ["---", `slug: ${slug}`, "kind: doc", `summary: ${slug} row`, "status: ready", "---", ""];
  return parseHandoverDoc({ path: `/h/${slug}.md`, text: text.join("\n") });
}

/** The board's lines for these docs, of which `live` are the ones the scan read. */
function linesOf({ docs, live }: { docs: readonly HandoverDoc[]; live: readonly HandoverDoc[] }): readonly string[] {
  const journals = new Map(docs.map((doc) => [doc.slug, { events: [], unreadableLines: [] }]));
  const models = composeBoardModels({ journals, probeStates: new Map(), resolutionDocs: docs, roots: docs });
  return boardAndFootnoteLines({ filter: EMPTY_TAG_FILTER, liveDocs: live, models, showAll: false, unreadable: [] });
}

describe("boardAndFootnoteLines", () => {
  it("prints a live row under its section, with the board's probe caveat", () => {
    const doc = ready({ slug: "live-row" });
    expect(linesOf({ docs: [doc], live: [doc] })).toEqual([
      "RUN NOW — 1 ready:",
      "",
      "  live-row — live-row row",
      "      paste: /h/live-row.md",
      "      why:   (no artifact linked — you will be reading the doc itself)",
      "      check: no `doneWhen:` probes and no `outputs:` — the board cannot tell whether this has landed",
      "",
      "⚠ 0 of 1 live doc(s) declare `doneWhen:`/`outputs:`.",
      "  The other 1 report the status they were TOLD — the board cannot check them.",
      "  Add probes when you next run one: `slopweaver handover start <slug>` asks for them.",
    ]);
  });
});
