/*
 * A picture named in a card's prose (the owner wants to see it on the queue card itself). The first case is the tracing card's own still-real line, word for word.
 */
import { describe, expect, it } from "vitest";

import { ASK_SHOT_VERB, askImageProblems, namedImageFiles, namedImageProblem } from "../../../handover/cardImage.js";

/** The tracing card's still-real line as recorded, the path they could not see. */
const TRACING_STILL_REAL =
  "Seen in Datadog on 5 Oct: the span-profiles tab is empty on every trace, " +
  "~/.slopweaver/proof/is-running-opentelemetry-for-traces-beside-dd-trace/span-profiles-tab.png.";

describe("namedImageFiles", () => {
  it("finds the tracing card's path, its full stop stripped", () => {
    expect(namedImageFiles({ text: TRACING_STILL_REAL })).toEqual([
      "~/.slopweaver/proof/is-running-opentelemetry-for-traces-beside-dd-trace/span-profiles-tab.png",
    ]);
  });

  it("reads every format, any case, bare or wrapped in quotes, ticks or brackets", () => {
    expect(namedImageFiles({ text: 'see "a.PNG", `b.jpg`, (c.jpeg) [d.webp] <e.gif>' })).toEqual([
      "a.PNG",
      "b.jpg",
      "c.jpeg",
      "d.webp",
      "e.gif",
    ]);
  });

  it("names a URL to a picture too — the card draws it as a link, not the picture", () => {
    expect(namedImageFiles({ text: "https://example.com/shots/net-93.png" })).toEqual([
      "https://example.com/shots/net-93.png",
    ]);
  });

  it("names one file once, however often the prose repeats it", () => {
    expect(namedImageFiles({ text: "a.png then a.png again" })).toEqual(["a.png"]);
  });

  it("names nothing in prose with no picture file: a word, an extension alone, a directory, another format", () => {
    expect(namedImageFiles({ text: "the png tab, .png alone, shots/png/, notes.md and report.pdf" })).toEqual([]);
  });
});

describe("namedImageProblem", () => {
  it("names the field, the file and the verb that attaches it", () => {
    expect(namedImageProblem({ attach: ASK_SHOT_VERB, label: "the risk", text: "see net-93.png" })).toBe(
      'the risk names the picture "net-93.png" as text, which the card draws as a path the owner cannot see — attach it ' +
        "with slopweaver handover shot <slug> --shot <png> --box x,y,width,height=<label> so the card shows it with a " +
        "box on what to read, and say in words what it shows",
    );
  });

  it("is undefined for prose naming no picture", () => {
    expect(namedImageProblem({ attach: ASK_SHOT_VERB, label: "the risk", text: "nothing here" })).toBe(undefined);
  });
});

describe("askImageProblems", () => {
  it("answers one line per field naming a picture, in field order, and none for a clean field", () => {
    const problems = askImageProblems({
      fields: [
        { label: "the problem", text: "clean" },
        { label: "the still-real check", text: TRACING_STILL_REAL },
        { label: "the lean", text: "a.png and b.gif" },
      ],
    });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('the still-real check names the picture "~/.slopweaver/proof/');
    expect(problems[1]).toContain('the lean names the picture "a.png", "b.gif" as text');
  });

  it("is empty when no field names one", () => {
    expect(askImageProblems({ fields: [{ label: "the problem", text: "clean" }] })).toEqual([]);
  });
});
