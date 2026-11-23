/** Which regions of a bot card the above-the-fold rules are allowed to read. */
import { describe, expect, it } from "vitest";

import { updateArtifactAboveFoldCells, updateArtifactBelowFoldCells } from "../../../../outbound/artifact/aboveFold.js";
import type { UpdateArtifact } from "../../../../outbound/artifact/types.js";

const CARD: UpdateArtifact = {
  citations: [],
  detail: [{ runs: [{ text: "the workings; joined by a semicolon", type: "text" }], type: "paragraph" }],
  index: [],
  kind: "update",
  media: [],
  tldr: "the pool exhausted overnight.",
};

describe("updateArtifactAboveFoldCells", () => {
  it("reads the TL;DR and never the folded detail", () => {
    expect(updateArtifactAboveFoldCells({ artifact: CARD })).toStrictEqual([
      { path: "tldr", text: "the pool exhausted overnight." },
    ]);
  });

  it("reads each index line beside the TL;DR", () => {
    const artifact: UpdateArtifact = {
      ...CARD,
      index: [[{ text: "the staging pool", type: "text" }], [{ text: "the queue", type: "text" }]],
    };
    expect(updateArtifactAboveFoldCells({ artifact }).map((cell) => cell.path)).toStrictEqual([
      "tldr",
      "index[0]",
      "index[1]",
    ]);
  });

  it("replaces a typed link, mention and citation with a space rather than dropping them", () => {
    const artifact: UpdateArtifact = {
      ...CARD,
      citations: [{ id: "1", label: "the run", url: "https://example.test/r" }],
      index: [
        [
          { text: "we fixed it. ", type: "text" },
          { label: "the run", type: "link", url: "https://example.test/r" },
          { text: " is green.", type: "text" },
        ],
      ],
    };
    expect(updateArtifactAboveFoldCells({ artifact })[1]!.text).toBe("we fixed it.   is green.");
  });

  it("replaces a QUOTED text run with a space — somebody else's words are on the screen but not in the voice", () => {
    const artifact: UpdateArtifact = {
      ...CARD,
      index: [
        [
          { text: "\u{1F534} ", type: "text" },
          { bold: true, quoted: true, text: "Payments \u2014 guard trips", type: "text" },
          { text: " · 3×", type: "text" },
        ],
      ],
    };
    expect(updateArtifactAboveFoldCells({ artifact })[1]!.text).toBe("\u{1F534}   · 3×");
  });

  it("drops an index line that carries no authored text at all", () => {
    const artifact: UpdateArtifact = {
      ...CARD,
      index: [[{ label: "the run", type: "link", url: "https://example.test/r" }]],
    };
    expect(updateArtifactAboveFoldCells({ artifact }).map((cell) => cell.path)).toStrictEqual(["tldr"]);
  });
});

describe("updateArtifactBelowFoldCells", () => {
  it("reads the folded detail the above-the-fold cells deliberately skip", () => {
    expect(updateArtifactBelowFoldCells({ artifact: CARD })).toStrictEqual([
      { path: "detail[0]", text: "the workings; joined by a semicolon" },
    ]);
  });

  it("names every bullet, list line and table cell a reader meets after expanding", () => {
    const artifact: UpdateArtifact = {
      ...CARD,
      detail: [
        { items: [[{ text: "first", type: "text" }], [{ text: "second", type: "text" }]], type: "bullets" },
        { items: [[{ text: "plain", type: "text" }]], type: "list" },
        {
          columns: ["repo", "state"],
          rows: [[[{ text: "slopweaver", type: "text" }], [{ text: "green", type: "text" }]]],
          type: "table",
        },
      ],
    };
    expect(updateArtifactBelowFoldCells({ artifact }).map((cell) => cell.path)).toStrictEqual([
      "detail[0].items[0]",
      "detail[0].items[1]",
      "detail[1].items[0]",
      "detail[2].columns[0]",
      "detail[2].columns[1]",
      "detail[2].rows[0][0]",
      "detail[2].rows[0][1]",
    ]);
  });

  it("replaces a typed link with a space, exactly as the above-the-fold extractor does", () => {
    const artifact: UpdateArtifact = {
      ...CARD,
      detail: [
        {
          runs: [
            { text: "we fixed it. ", type: "text" },
            { label: "the run", type: "link", url: "https://example.test/r" },
            { text: " is green.", type: "text" },
          ],
          type: "paragraph",
        },
      ],
    };
    expect(updateArtifactBelowFoldCells({ artifact })[0]!.text).toBe("we fixed it.   is green.");
  });

  it("drops a detail region that carries no authored text at all", () => {
    const artifact: UpdateArtifact = {
      ...CARD,
      detail: [{ runs: [{ label: "the run", type: "link", url: "https://example.test/r" }], type: "paragraph" }],
    };
    expect(updateArtifactBelowFoldCells({ artifact })).toStrictEqual([]);
  });
});
