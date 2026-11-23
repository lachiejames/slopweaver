/*
 * `prBodyLeadRowsError` on a PR body: a label read as a reader sees it, hidden markup that never makes a lead, a
 * Problem label disguised in a second table, and the markdown-table fallback.
 */
import { describe, expect, it } from "vitest";

import { prBodyLeadRowsError, requiredLeadRowsError } from "../../../../prformat/leadRows.js";
import { htmlBody, PAIR } from "./harness.js";

describe("prBodyLeadRowsError", () => {
  it("reads a default-ignorable letter as a blank cell, on the body and the form path (fallback review r12)", () => {
    const body = htmlBody({ lead: [{ label: "Risk", text: "\u3164" }, PAIR[1]!] });
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(
      "the **Risk** row is empty. Say what it asks, plainly.",
    );
    expect(requiredLeadRowsError({ rows: [{ label: "Risk", text: "\uFFA0" }, PAIR[1]!] })).toBe(
      "the **Risk** row is empty. Say what it asks, plainly.",
    );
  });

  it("reads a label's marks as a reader sees them, and sees a row holding only an image (fallback reviews r12, r13)", () => {
    const rows = [
      ["*Risk", "Blast radius"],
      ["Risk", "Blast radius__"],
      ["<strong>Risk</strong>", "<em><strong>Blast radius</strong></em>"],
    ];
    const bodies = rows.map(
      ([risk, blast]) =>
        `<table><tr><td>${risk}</td><td>a</td></tr><tr><td>${blast}</td><td>a</td></tr><tr><td>Problem</td><td>a</td></tr></table>`,
    );
    const image = "<table><tr><td><img src=x.png></td><td></td></tr>" + bodies[2]!.slice("<table>".length);
    expect([...bodies, image].map((body) => prBodyLeadRowsError({ body, sourceProblem: true }))).toStrictEqual([
      expect.stringContaining('the rows above Problem here are "*Risk", "Blast radius"'),
      expect.stringContaining('the rows above Problem here are "Risk", "Blast radius__"'),
      undefined,
      expect.stringContaining('the rows above Problem here are "\u{FFFC}", "Risk"'),
    ]);
  });

  it("refuses a markdown label whose stars a reader sees, and past the emphasis cap reads every label as written (fallback review r13)", () => {
    const tables = ["\\*Risk\\*", "* Risk *", "**Risk**"].map((risk) =>
      [`| ${risk} | Low. |`, "| --- | --- |", "| **Blast radius** | One page. |", "| **Problem** | A bug. |"].join(
        "\n",
      ),
    );
    const marks = `\n\n${"_".repeat(8193)}`;
    expect(
      [...tables, tables[2]! + marks].map((body) => prBodyLeadRowsError({ body, sourceProblem: true })),
    ).toStrictEqual([
      expect.stringContaining('the rows above Problem here are "*Risk*", "Blast radius"'),
      expect.stringContaining('the rows above Problem here are "* Risk *", "Blast radius"'),
      undefined,
      expect.stringContaining('the rows above Problem here are "**Risk**", "**Blast radius**"'),
    ]);
  });

  it("reads a label split by a break, struck, raised, or closed in a <details> as the reader sees it (fallback review r14)", () => {
    const labels = [
      "Ri<br>sk",
      "<p>Ri</p><p>sk</p>",
      "<del>Risk</del>",
      "<s>Risk</s>",
      "R<sup>isk</sup>",
      "<details>Risk</details>",
    ];
    const blast = "<td>Blast radius</td><td>a</td></tr><tr><td>Problem</td><td>a</td></tr></table>";
    const bodies = labels.map((label) => `<table><tr><td>${label}</td><td>a</td></tr><tr>${blast}`);
    expect(bodies.map((body) => prBodyLeadRowsError({ body, sourceProblem: true }))).toStrictEqual([
      expect.stringContaining('here are "Ri sk", "Blast radius"'),
      expect.stringContaining('here are "Ri sk", "Blast radius"'),
      expect.stringContaining('here are "~Risk~", "Blast radius"'),
      expect.stringContaining('here are "~Risk~", "Blast radius"'),
      expect.stringContaining('here are "R isk", "Blast radius"'),
      expect.stringContaining('here are "", "Blast radius"'),
    ]);
    const open = `<table><tr><td><details open><summary></summary>Risk</details></td><td>a</td></tr><tr>${blast}`;
    expect(prBodyLeadRowsError({ body: open, sourceProblem: true })).toBe(undefined);
  });

  it("reads a tag outside the read-through set as a drawn object, never a word (fallback review r15)", () => {
    const bodies = [
      "<td>Risk</td><td><ruby><rp>Low</rp></ruby></td>",
      "<td><ruby>Ri<rp>sk</rp></ruby></td><td>a</td>",
      '<td><bdo dir="rtl">Risk</bdo></td><td>a</td>',
      "<td><q>Risk</q></td><td>a</td>",
    ].map(
      (first) =>
        `<table><tr>${first}</tr><tr><td>Blast radius</td><td>a</td></tr><tr><td>Problem</td><td>a</td></tr></table>`,
    );
    expect(bodies.map((body) => prBodyLeadRowsError({ body, sourceProblem: true }))).toStrictEqual([
      "the **Risk** row is empty. Say what it asks, plainly.",
      expect.stringContaining('here are "\u{FFFC}", "Blast radius"'),
      expect.stringContaining('here are "\u{FFFC}", "Blast radius"'),
      expect.stringContaining('here are "\u{FFFC}", "Blast radius"'),
    ]);
  });

  it("reads a zero-width U+FEFF as no space, and only a closed <details>'s first <summary> (fallback review r16)", () => {
    const table = ({ risk, blast }: { risk: string; blast: string }): string =>
      `<table><tr><td>Risk</td><td>${risk}</td></tr><tr><td>${blast}</td><td>x</td></tr><tr><td>Problem</td><td>a</td></tr></table>`;
    expect(
      [
        table({ blast: "Blast&#xFEFF;radius", risk: "Low" }),
        table({ blast: "Blast radius", risk: "<details><summary></summary><summary>Low</summary></details>" }),
        table({ blast: "Blast&nbsp;radius", risk: "Low" }),
      ].map((body) => prBodyLeadRowsError({ body, sourceProblem: true })),
    ).toStrictEqual([
      expect.stringContaining('here are "Risk", "Blast\u{FEFF}radius"'),
      "the **Risk** row is empty. Say what it asks, plainly.",
      undefined,
    ]);
  });

  it("keeps an unlisted tag's drawn object in a label, so its words never drop out (fallback review r17)", () => {
    const labels = ["<time>No </time>Risk", "<q>No</q> Risk", '<bdo dir="ltr">Not a</bdo> Risk'];
    const bodies = labels.map(
      (label) =>
        `<table><tr><td>${label}</td><td>Low</td></tr><tr><td>Blast radius</td><td>x</td></tr><tr><td>Problem</td><td>a</td></tr></table>`,
    );
    expect(bodies.map((body) => prBodyLeadRowsError({ body, sourceProblem: true }))).toStrictEqual([
      expect.stringContaining('here are "\u{FFFC}Risk", "Blast radius"'),
      expect.stringContaining('here are "\u{FFFC} Risk", "Blast radius"'),
      expect.stringContaining('here are "\u{FFFC} Risk", "Blast radius"'),
    ]);
    const hidden =
      "<table><tr><td>Risk</td><td><span hidden>Low</span></td></tr><tr><td>Blast radius</td><td>x</td></tr><tr><td>Problem</td><td>a</td></tr></table>";
    expect(prBodyLeadRowsError({ body: hidden, sourceProblem: true })).toBe(
      "the **Risk** row is empty. Say what it asks, plainly.",
    );
  });

  it("reads a hidden element, row, cell or table as a drawn object, so hiding never makes a lead (fallback review r18)", () => {
    const rows = ({ risk, blast }: { risk: string; blast: string }): string =>
      `${risk}${blast}<tr><td>Problem</td><td>a</td></tr>`;
    const shown = rows({
      blast: "<tr><td>Blast radius</td><td>x</td></tr>",
      risk: "<tr><td>Risk</td><td>Low</td></tr>",
    });
    const bodies = [
      `<table>${rows({ blast: "<tr hidden><td>Blast radius</td><td>x</td></tr>", risk: "<tr hidden><td>Risk</td><td>Low</td></tr>" })}</table>`,
      `<table>${rows({ blast: "<tr><td>Blast radius</td><td>x</td></tr>", risk: "<tr><td><span hidden>No </span>Risk</td><td>Low</td></tr>" })}</table>`,
      `<table>${rows({ blast: "<tr><td>Blast radius</td><td>x</td></tr>", risk: "<tr><td>Risk</td><td hidden>Low</td></tr>" })}</table>`,
      `<table><tbody hidden>${rows({ blast: "<tr><td>Blast radius</td><td>x</td></tr>", risk: "<tr><td>Risk</td><td>Low</td></tr>" })}</tbody></table>`,
      `<div hidden><table>${shown}</table></div>`,
      `<details><summary>s</summary><table>${shown}</table></details>`,
      `<table>${shown}</table>`,
    ];
    expect(bodies.map((body) => prBodyLeadRowsError({ body, sourceProblem: true }))).toStrictEqual([
      expect.stringContaining('here are "\u{FFFC}", "\u{FFFC}"'),
      expect.stringContaining('here are "\u{FFFC}Risk", "Blast radius"'),
      "the **Risk** row is empty. Say what it asks, plainly.",
      expect.stringContaining('here are "\u{FFFC}", "\u{FFFC}"'),
      expect.stringContaining('here are "\u{FFFC}", "\u{FFFC}"'),
      expect.stringContaining('here are "\u{FFFC}", "\u{FFFC}"'),
      undefined,
    ]);
  });

  it("judges a second table whose Problem label a tag, a direction or a look-alike disguises (fallback reviews r19–r22)", () => {
    const main =
      "<table><tr><td>Risk</td><td>Low</td></tr><tr><td>Blast radius</td><td>x</td></tr><tr><td>Problem</td><td>a</td></tr></table>";
    const labels = [
      "<time>Problem</time>",
      "<q>Problem</q>",
      '<bdo dir="rtl">melborP</bdo>',
      "Pr\u{043E}bIem",
      "<strong>Problem</strong>",
      'Prob<bdo dir="rtl">mel</bdo>',
      "PRO\u{0392}LEM",
      "\u{1D18}\u{0280}\u{1D0F}\u{0299}\u{029F}\u{1D07}\u{1D0D}",
      "Pr\u{0585}blem",
      "Prob\u{01C0}em",
      "PRO8LEM",
      "PR0BL3M",
      "Pr\u{1F17E}\u{FE0F}blem",
      "Pr\u{2205}blem",
      "\u{1F17F}\u{1F181}\u{1F17E}\u{1F171}\u{1F17B}\u{1F174}\u{1F17C}",
      "\u{20BD}ROBLEM",
      "PR\u{3007}BLEM",
      "PROBL\u{2208}M",
    ];
    const bodies = labels.map(
      (label) => `${main}\n\n<table><tr><td>${label}</td><td>the login page drops sessions</td></tr></table>`,
    );
    expect(bodies.map((body) => prBodyLeadRowsError({ body, sourceProblem: true }))).toStrictEqual(
      labels.map(() => expect.stringContaining("here are none")),
    );
    expect(prBodyLeadRowsError({ body: main, sourceProblem: true })).toBe(undefined);
  });

  it("searches every cell of a row that may be drawn right to left, and any cell naming it in a word (fallback reviews r21–r25)", () => {
    const main =
      "<table><tr><td>Risk</td><td>Low</td></tr><tr><td>Blast radius</td><td>x</td></tr><tr><td>Problem</td><td>a</td></tr></table>";
    const seconds = [
      '<table dir="rtl"><tr><td>the login page drops sessions</td><td><strong>Problem\u{B9}</strong></td></tr></table>',
      '<div dir="auto"><table><tr><td>the login page drops sessions</td><td>Problem \u{24D8}</td></tr></table></div>',
      "<table><tr><td></td><td>Problem\u{B9}</td></tr></table>",
      "| # | Item |\n|---|---|\n| 1 | **Problem**<br>the login page drops sessions |",
      "| # | Item |\n|---|---|\n| 1 | **Problem**\u{2014}the login page drops sessions |",
      "| # | Item |\n|---|---|\n| 1 | JJJJ-1642 **Problem:** the login page drops sessions |",
      "<table><tr><td>Follow-up</td><td>the problem in the retry path</td></tr></table>",
    ];
    expect(
      seconds.map((second) => prBodyLeadRowsError({ body: `${main}\n\n${second}`, sourceProblem: true })),
    ).toStrictEqual([
      expect.stringContaining("here are none"),
      expect.stringContaining("here are none"),
      expect.stringContaining("here are none"),
      expect.stringContaining('here are "#"'),
      expect.stringContaining('here are "#"'),
      expect.stringContaining('here are "#"'),
      expect.stringContaining("here are none"),
    ]);
    const next = `${main}\n\n<table><tr><td>Follow-up</td><td>the retry path drops a session</td></tr></table>`;
    expect(prBodyLeadRowsError({ body: next, sourceProblem: true })).toBe(undefined);
  });

  it("never reads a hyphenated word as Problem, so a Next table saying Re-import owes no lead (a fleet finding)", () => {
    const main =
      "<table><tr><td>Risk</td><td>Low</td></tr><tr><td>Blast radius</td><td>x</td></tr><tr><td>Problem</td><td>a</td></tr></table>";
    const next = "| Next | Who |\n|---|---|\n| Re-import the export | the importer |";
    expect(prBodyLeadRowsError({ body: `${main}\n\n${next}`, sourceProblem: true })).toBe(undefined);
    const labels = ["Pro-blem", "Prob\u{FE31}em"];
    const bodies = labels.map(
      (label) => `${main}\n\n<table><tr><td>${label}</td><td>the login page drops sessions</td></tr></table>`,
    );
    expect(bodies.map((body) => prBodyLeadRowsError({ body, sourceProblem: true }))).toStrictEqual(
      labels.map(() => expect.stringContaining("here are none")),
    );
  });

  it("never reads a Risk or Blast radius row that mentions a problem as the Problem row", () => {
    const lead = [
      { label: "Risk", text: "Low. A card it cannot fill draws no problem, stakes or option row." },
      { label: "Blast radius", text: "The Problem cell of the finding card." },
    ];
    const spare = htmlBody({ lead }).replace("draws no problem, stakes or option row.</td>", "$&<td></td>");
    expect([htmlBody({ lead }), spare].map((body) => prBodyLeadRowsError({ body, sourceProblem: true }))).toStrictEqual(
      [undefined, undefined],
    );
    const turned = `<table dir="rtl"><tr><td>Risk</td><td>Problem</td></tr></table>\n\n${htmlBody({ lead: PAIR })}`;
    const near = htmlBody({ lead }).replace("<strong>Risk</strong>", "<strong>Risk:</strong>");
    const lone = [
      '<tr><td>Risk</td><th scope="row">Problem</th><td>a</td></tr>',
      "<tr><td>Risk</td><td><strong>Problem</strong><br>the login page drops sessions</td></tr>",
      '<tr><td>Risk</td><td><bdo dir="rtl">melborP</bdo></td></tr>',
      '<tr><td title="Problem">Risk</td><td>Low.</td></tr>',
      "<tr><td>Risk</td><td>a problem</td></tr><tr><td>Blast radius</td><td>x</td></tr>",
    ].map((rows) => `${htmlBody({ lead: PAIR })}\n\n<table>${rows}</table>`);
    const below = "<tr><td>Blast radius</td><td>x</td></tr><tr><td>Problem</td><td>a</td></tr>";
    const sameTable = [
      '<tr><td>Risk</td><th scope="row">Problem</th><td>a</td></tr>',
      '<tr><td title="Problem">Risk</td><td>Low.</td></tr>',
      '<tr><td>Risk</td><td>Low.</td><th scope="row">Problem</th></tr>',
    ].map((risk) => `<table>${risk}${below}</table>`);
    expect(
      [turned, near, ...lone, ...sameTable].map((body) => prBodyLeadRowsError({ body, sourceProblem: true })),
    ).toStrictEqual([
      expect.stringContaining("here are none"),
      expect.stringContaining("here are none"),
      ...lone.map(() => expect.stringContaining("here are none")),
      ...sameTable.map(() => expect.stringContaining("here are none")),
    ]);
  });

  it("never lets a run of newlines push a Problem label past the letters it keeps (fallback review r24)", () => {
    const main =
      "<table><tr><td>Risk</td><td>Low</td></tr><tr><td>Blast radius</td><td>x</td></tr><tr><td>Problem</td><td>a</td></tr></table>";
    const padded = `| a | b |\n|---|---|\n| **${"&#10;".repeat(300)}Problem** | the login page drops sessions |`;
    const listed = "| # | Item |\n|---|---|\n| Bug | 10. **Problem:** the login page drops sessions |";
    expect(
      [padded, listed].map((second) => prBodyLeadRowsError({ body: `${main}\n\n${second}`, sourceProblem: true })),
    ).toStrictEqual([expect.stringContaining('here are "a"'), expect.stringContaining('here are "#"')]);
  });

  it("keeps a U+FEFF run a label was cut inside, so the cut never trims a label down to Risk (fallback review r20)", () => {
    const body = `<table><tr><td>Risk${"&#xFEFF;".repeat(300)}y? not assessed</td><td>Low</td></tr><tr><td>Blast radius</td><td>x</td></tr><tr><td>Problem</td><td>a</td></tr></table>`;
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toContain(
      'the rows above Problem here are "Risk\u{FEFF}',
    );
  });

  it("reads the markdown-table fallback", () => {
    const body = [
      "| **Risk** | Low risk. |",
      "| --- | --- |",
      "| **Blast radius** | One page. |",
      "| **Problem** | A problem. |",
    ].join("\n");
    expect(prBodyLeadRowsError({ body, sourceProblem: true })).toBe(undefined);
  });

  it("says nothing about a body with no Problem row, which is already its own error", () => {
    expect(prBodyLeadRowsError({ body: "just prose", sourceProblem: false })).toBe(undefined);
  });
});
