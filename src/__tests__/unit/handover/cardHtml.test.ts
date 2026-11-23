import { describe, expect, it } from "vitest";

import { cardAlignmentVerdict, cardProseVerdict } from "../../../handover/cardAlignment.js";
import { askHtmlProblems, bareHtmlFiles } from "../../../handover/cardHtml.js";

const VIEWER = "http://localhost:3000/view?src=%2Fapi%2Fpage%2Fleavers-access-briefing%2Findex.html&back=%2Fqueue";

describe("bareHtmlFiles", () => {
  it("names a bare file, a path, a ~ path and a file:// address, each once, wrapping stripped", () => {
    const text =
      "the full picture is in `leavers-access-briefing.html`, also ~/.slopweaver/pages/x/index.HTM and " +
      "file:///tmp/brief.html — see leavers-access-briefing.html.";
    expect(bareHtmlFiles({ text })).toEqual([
      "leavers-access-briefing.html",
      "~/.slopweaver/pages/x/index.HTM",
      "file:///tmp/brief.html",
    ]);
  });

  it("passes a web address to an HTML page, a markdown link's target included", () => {
    expect(bareHtmlFiles({ text: `open http://localhost:3000/api/page/x/index.html or ${VIEWER}` })).toEqual([]);
    expect(bareHtmlFiles({ text: "[the briefing](https://example.org/brief.html)" })).toEqual([]);
  });

  it("names nothing in prose with no HTML file", () => {
    expect(bareHtmlFiles({ text: "the html briefing is attached" })).toEqual([]);
    expect(bareHtmlFiles({ text: "" })).toEqual([]);
  });
});

describe("askHtmlProblems", () => {
  it("names the field, the file and the fix", () => {
    expect(askHtmlProblems({ fields: [{ label: "example 1", text: "read leavers-access-briefing.html" }] })).toEqual([
      'example 1 names the HTML "leavers-access-briefing.html" as a file name, which nothing on the console opens — ' +
        "publish it with `slopweaver page publish <slug> --page <file> --review <id>` (the review from " +
        "`slopweaver page review-prepare`) and cite the viewer address it prints, " +
        "writing that address into the card in its place, or attach it to the draft so its card carries an Open in " +
        "the viewer chip",
    ]);
  });
});

describe("the card verdicts refuse a bare HTML file name", () => {
  const env = {};

  it("refuses an ask's question naming one", () => {
    const verdict = cardAlignmentVerdict({
      command: "slopweaver handover ask",
      env,
      question: "Should the leavers DM go out with leavers-access-briefing.html attached?",
    });
    expect(verdict.kind).toBe("refused");
    expect(JSON.stringify(verdict)).toContain('the question names the HTML \\"leavers-access-briefing.html\\"');
  });

  it("refuses a card field naming one, and passes one citing the viewer address", () => {
    expect(
      cardProseVerdict({
        command: "slopweaver handover ask",
        env,
        fields: [{ label: "the still-real check", text: "see leavers-access-briefing.html" }],
      }).kind,
    ).toBe("refused");
    expect(
      cardProseVerdict({
        command: "slopweaver handover ask",
        env,
        fields: [{ label: "the still-real check", text: `see ${VIEWER}` }],
      }),
    ).toEqual({ kind: "ok" });
  });
});
