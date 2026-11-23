import { describe, expect, it } from "vitest";

import { renderedTables, saysAnything } from "../../../prformat/renderedTables.js";

describe("renderedTables", () => {
  it("draws a markdown table and a raw HTML one, each row as its cells' visible text", () => {
    const body =
      "| a | b |\n|---|---|\n| **Risk** | Low. |\n\n<table><tr><td>Blast <em>radius</em></td><td>x</td></tr></table>";
    expect(renderedTables({ body }).map((table) => table.rows)).toStrictEqual([
      [
        ["a", "b"],
        ["Risk", "Low."],
      ],
      [["Blast radius", "x"]],
    ]);
  });

  it("draws the implicit row a <td> straight after <table> opens, as a browser does", () => {
    expect(
      renderedTables({ body: "<table><td>x<tr><td>Risk</td><td>a</td></tr></table>" }).map((table) => table.rows),
    ).toStrictEqual([[["x"], ["Risk", "a"]]]);
  });

  it("draws nothing for a table inside code or a comment, and a template as a drawn object", () => {
    const body =
      "```\n<table><tr><td>Risk</td></tr></table>\n```\n\n<table><tr><td><template>t</template><!-- c --></td></tr></table>";
    expect(renderedTables({ body }).map((table) => table.rows)).toStrictEqual([[["\u{FFFC}"]]]);
  });

  it("reads Problem in each cell as shown and as written, folding look-alikes, for a reader never to miss a word", () => {
    const body =
      '<table><tr><td>Pr<span hidden>x</span>ob<time>lem</time></td><td>\u{1D40F}r\u{043E}bIem</td><td><bdo dir="rtl">melborP</bdo></td><td>Prob<span hidden>x</span>ing</td></tr></table>';
    const named = { carries: true, names: true };
    expect(renderedTables({ body }).map((table) => table.signs)).toStrictEqual([
      [[named, named, named, { carries: false, names: false }]],
    ]);
  });

  it("reads Problem past any length of text before it, through an empty raised run and past ruby text, and off a badge's alt or URL or a tooltip (fallback reviews r26, r27, r30, r31)", () => {
    const context = "the login page drops sessions ".repeat(20);
    const body = `<table><tr><td>1</td><td>${context}<br><br><b>Problem:</b> x</td><td>Pro<sub></sub>blem</td><td>Pro<ruby>b<rt>x</rt></ruby>lem</td><td><img alt="Problem" src="b.svg"></td><td><img src="https://img.shields.io/badge/-Problem-555"></td><td><abbr title="Problem">Prob.</abbr></td><td><img src="b.svg"></td></tr></table>`;
    expect(renderedTables({ body }).map((table) => table.signs.flat().map((cell) => cell.names))).toStrictEqual([
      [false, true, true, true, true, true, true, false],
    ]);
  });

  // `developer.mend.io` spells `loper.m`, Problem with the dot as its `b`: every Renovate bump's Age and Confidence
  // badges made its update table owe Risk and Blast radius. A labelled image's http(s) host
  // is not read, nor a word it starts (the host is drawn nowhere); its path, query and fragment
  // are, and every other source is read whole, as before.
  it("reads a labelled image's URL past its host, and every other image source whole", () => {
    const sources = [
      'alt="age" src="https://developer.mend.io/api/mc/badges/age/npm/lefthook/2.1.16?slim=true"',
      'alt="x" src="https://Problem.example/x.svg"',
      'alt="x" src="https://pro/blem"',
      'alt="x" src="https://Problem.example:8443/x.svg"',
      'alt="x" src="HTTPS://Problem.example/x.svg"',
      'src="https://Problem.example/x.svg"',
      'alt=" " src="https://Problem.example/x.svg"',
      'alt="x" src="https://img.shields.io/badge/-Problem-555"',
      'alt="x" src="https://example.test/b.svg?label=Problem"',
      'alt="x" src="https://example.test/b.svg#Problem"',
      'alt="x" src="https://example.test/badge/-Pr\u{043E}blem-555"',
      'alt="x" src="https://example.test\\Problem.svg"',
      'alt="x" src="https://Problem:secret@example.test/b.svg"',
      'alt="x" src="https://example.test Problem/x.svg"',
      'alt="x" src="https://example.test|Problem/x.svg"',
      'alt="x" src="https://example.test:Problem/x.svg"',
      'alt="x" src="https://example.test,Problem/x.svg"',
      'alt="x" src="https://Problem.example:290813/x.svg"',
      'alt="x" src="https://[::1]/Problem"',
      'alt="x" src="https://[0b1e::]/x.svg"',
      'alt="x" src="http\u{017F}://Problem.example/x.svg"',
      'alt="x" src="Problem.svg"',
      'alt="x" src="//Problem.example/x.svg"',
      'alt="x" src="data:image/svg+xml,Problem"',
      'alt="x" src="ftp://Problem.example/x.svg"',
      'alt="Problem" src="https://example.test/x.svg"',
    ];
    const body = `<table><tr>${sources.map((attrs) => `<td><img ${attrs}></td>`).join("")}</tr></table>`;
    expect(renderedTables({ body }).map((table) => table.signs.flat().map((cell) => cell.names))).toStrictEqual([
      [
        false,
        false,
        false,
        false,
        false,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
      ],
    ]);
  });

  it("orders a table's head first and its foot last, as a browser lays them out", () => {
    const body =
      "<table><tfoot><tr><td>f</td></tr></tfoot><tr><td>b</td></tr><thead><tr><td>h</td></tr></thead></table>";
    expect(renderedTables({ body }).map((table) => table.rows)).toStrictEqual([[["h"], ["b"], ["f"]]]);
  });
});

describe("saysAnything", () => {
  it("reads character references, dashes, bare markup, a comment and an image alone as nothing, and a word as something", () => {
    const fragments = ["&nbsp;", " — ", "<br>", "<!-- Low -->", "![Low](x.png)", "<b></b>", "Low.", "<b>3</b>"];
    expect(fragments.map((fragment) => saysAnything({ fragment }))).toStrictEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
  });
});
