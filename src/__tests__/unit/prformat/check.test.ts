/**
 * The checks `src/prformat/checkCore.ts` still owns, read over the RETIRED table body the old `validatePrBody` judged.
 *
 * That validator went with the table shape: its badge, word-cap, Next-cap, Proof-evidence, Proof-notes-cap and gold
 * anchor rules were all rules OF the table, and the C3 gate (`src/prformat/prBodyGate.ts`) refuses a table body
 * outright, naming the conversion. What survives is asserted here against the same fixtures: the word counter the C3
 * caps reuse, `tableCell` (which `github pr summary` still reads an old pull request's body with), the lead-row
 * reading of a commented-out cell, and what the C3 gate now says to every body the old validator used to judge.
 */

// deleted-with-code: validatePrBody, MAX_PROOF_NOTES_WORDS, NEXT_MAX_WORDS
import { describe, expect, it } from "vitest";

import { PRE_C3_CONVERSION } from "../../../outbound/github/errors.js";
import { countWords, MAX_WORDS, tableCell } from "../../../prformat/checkCore.js";
import { prBodyLeadRowsError } from "../../../prformat/leadRows.js";
import { gatePrBody, retiredPublicationErrors } from "../../../prformat/prBodyGate.js";

/** Badge row for a given proof grade. */
function badges({ grade = "bronze" }: { grade?: "bronze" | "silver" | "gold" } = {}): string {
  return `![CI](https://img.shields.io/badge/CI-passing-2ea44f) ![proof](https://img.shields.io/badge/proof-${grade}-9ea7ad)`;
}

/** The textless origin link the table fixture's Problem cell carried, so a word count sees only what a case passes. */
const ORIGIN = '<a href="https://linear.app/acme/issue/DEVX-1"></a>';

/** Build a canonical HTML-table PR body, the retired shape. */
function body({
  problem,
  solution,
  proof = "ok",
  grade = "bronze",
  withBadges = true,
  anchor,
}: {
  problem: string;
  solution: string;
  proof?: string;
  grade?: "bronze" | "silver" | "gold";
  withBadges?: boolean;
  /** A raw line appended after the table — the `proof-commit:` anchor, in whatever spelling a case is testing. */
  anchor?: string;
}): string {
  return [
    withBadges ? badges({ grade }) : "(no badges)",
    "",
    "<table>",
    "<tr>\n<td><strong>Risk</strong></td>\n<td>Low risk, a fixture.</td>\n</tr>",
    "<tr>\n<td><strong>Blast radius</strong></td>\n<td>This test only.</td>\n</tr>",
    `<tr><td><strong>Problem</strong></td><td>${problem}${ORIGIN}</td></tr>`,
    `<tr><td><strong>Solution</strong></td><td>${solution}</td></tr>`,
    `<tr><td><strong>Proof</strong></td><td>${proof}</td></tr>`,
    "</table>",
    ...(anchor === undefined ? [] : ["", anchor]),
  ].join("\n");
}

/** Prepend a `👉 Next` row's own table ahead of the main Problem/Solution/Proof one. */
function withNext({ next, body: mainBody }: { next: string; body: string }): string {
  return `<table>\n<tr><td>👉 <strong>Next</strong></td><td>${next}</td></tr>\n</table>\n\n${mainBody}`;
}

const words = ({ n }: { n: number }): string => Array.from({ length: n }, (_, i) => `w${String(i)}`).join(" ");

/** The full head SHA the anchor cases carried. */
const HEAD = "c6b7dbca1f2e3d4b5a6978890abcdef012345678";
/** A real `git patch-id --verbatim` id from the scratch-repo measurement behind the retired anchor. */
const PATCH = "5e1877358e8c58c6bdc46b92483800474b4b1b32";

/** The markdown-table spelling of the same retired body. */
const MARKDOWN_BODY = `${badges()}\n\n| | |\n|---|---|\n| **Risk** | Low risk, a fixture. |\n| **Blast radius** | This test only. |\n| **Problem** | ${words({ n: 3 })} [DEVX-1](https://linear.app/acme/issue/DEVX-1) |\n| **Solution** | ${words({ n: 3 })} |\n| **Proof** | ok |`;

/** What the C3 gate answers for every pre-C3 table body of this repository's own. */
const TABLE_REFUSAL = {
  errors: [
    "PRE_C3_SHAPE: the description is a pre-C3 retired-table body. Convert it, which writes an authoring file and " +
      `sends nothing: \`${PRE_C3_CONVERSION}\`.`,
  ],
  shape: "pre-c3",
};

/** The one refusal a published gold anchor earns, however many anchor lines carry it. */
const ANCHOR_REFUSAL = [
  "RETIRED_PUBLICATION: the description publishes a gold anchor, which a C3 description never carries. Remove it",
];

describe("countWords", () => {
  it("ignores HTML tags, <br>, link URLs, inline code and markdown noise", () => {
    expect(
      countWords({ cell: '• <strong>Strip</strong> the prototype<br><img src="x.png"> `argv` [run](https://x.y/z)' }),
    ).toBe(5);
  });

  it("counts an empty cell as zero words", () => {
    expect(countWords({ cell: "" })).toBe(0);
  });

  it("keeps the shared cell cap at fifty words", () => {
    expect(MAX_WORDS).toBe(50);
  });

  it("counts exactly MAX_WORDS for a cell of the cap, and one over for one word more", () => {
    expect(countWords({ cell: words({ n: MAX_WORDS }) })).toBe(MAX_WORDS);
    expect(countWords({ cell: words({ n: MAX_WORDS + 1 }) })).toBe(MAX_WORDS + 1);
  });

  it("counts nothing for a link with no text, so an origin link costs a capped cell no words", () => {
    expect(countWords({ cell: `${words({ n: 3 })}${ORIGIN}` })).toBe(3);
  });

  it("counts an evidence link's label and never its URL", () => {
    expect(countWords({ cell: '<a href="https://github.com/x/y/actions/runs/1">the run</a>' })).toBe(2);
    expect(countWords({ cell: "[DEVX-1](https://linear.app/acme/issue/DEVX-1)" })).toBe(1);
  });

  it("counts a word wrapped in emphasis or code once, and a bare bullet or pipe as nothing", () => {
    expect(countWords({ cell: "**bold** _em_ `code` • | #" })).toBe(3);
  });
});

describe("tableCell — the retired table body `github pr summary` still reads", () => {
  const html = body({ problem: words({ n: 3 }), solution: words({ n: 4 }) });

  it("reads each HTML row's content cell, trimmed", () => {
    expect(tableCell({ body: html, label: "Problem" })).toBe(`${words({ n: 3 })}${ORIGIN}`);
    expect(tableCell({ body: html, label: "Solution" })).toBe(words({ n: 4 }));
    expect(tableCell({ body: html, label: "Proof" })).toBe("ok");
  });

  it("reads a row whose cells sit on their own lines, as the Risk and Blast radius rows do", () => {
    expect(tableCell({ body: html, label: "Risk" })).toBe("Low risk, a fixture.");
    expect(tableCell({ body: html, label: "Blast radius" })).toBe("This test only.");
  });

  it("answers null for a row the body does not carry", () => {
    const noSolution = `${badges()}\n<table>\n<tr><td><strong>Problem</strong></td><td>${words({ n: 3 })}</td></tr>\n<tr><td><strong>Proof</strong></td><td>ok</td></tr>\n</table>`;
    expect(tableCell({ body: noSolution, label: "Solution" })).toBe(null);
    const noProof = `${badges()}\n<table>\n<tr><td><strong>Problem</strong></td><td>${words({ n: 3 })}</td></tr>\n<tr><td><strong>Solution</strong></td><td>${words({ n: 3 })}</td></tr>\n</table>`;
    expect(tableCell({ body: noProof, label: "Proof" })).toBe(null);
  });

  it("answers null for a body with no table at all", () => {
    expect(tableCell({ body: "(no badges)\n\njust prose", label: "Problem" })).toBe(null);
  });

  it("matches the label as a whole word, so a prefix of it finds nothing", () => {
    expect(tableCell({ body: html, label: "Prob" })).toBe(null);
  });

  it("matches an HTML label case-insensitively", () => {
    expect(tableCell({ body: html, label: "problem" })).toBe(`${words({ n: 3 })}${ORIGIN}`);
  });

  it("reads the markdown-table fallback, link and all", () => {
    expect(tableCell({ body: MARKDOWN_BODY, label: "Problem" })).toBe(
      `${words({ n: 3 })} [DEVX-1](https://linear.app/acme/issue/DEVX-1)`,
    );
    expect(tableCell({ body: MARKDOWN_BODY, label: "Solution" })).toBe(words({ n: 3 }));
    expect(tableCell({ body: MARKDOWN_BODY, label: "Proof" })).toBe("ok");
    expect(tableCell({ body: MARKDOWN_BODY, label: "Risk" })).toBe("Low risk, a fixture.");
  });

  it("reads the Next row from its own table ahead of the main one", () => {
    const withRow = withNext({ body: html, next: words({ n: 15 }) });
    expect(tableCell({ body: withRow, label: "Next" })).toBe(words({ n: 15 }));
    expect(tableCell({ body: withRow, label: "Solution" })).toBe(words({ n: 4 }));
  });

  it("reads a gold Proof cell's evidence link as written", () => {
    const proof = "end-to-end run: https://github.com/x/y/actions/runs/1";
    const gold = body({ grade: "gold", problem: words({ n: 3 }), proof, solution: words({ n: 3 }) });
    expect(tableCell({ body: gold, label: "Proof" })).toBe(proof);
  });
});

describe("the lead rows of a retired body whose Problem cell is commented out", () => {
  it("still finds the hidden cell, and refuses the lead once (fallback review r12)", () => {
    const hidden = `<!--<td>Problem</td><td>${words({ n: 3 })} [DEVX-1](https://linear.app/acme/issue/DEVX-1)</td>-->`;
    const hiddenBody = `${badges()}\n${hidden}\n\nprose`;
    const cell = tableCell({ body: hiddenBody, label: "Problem" });
    expect(cell).toBe(`${words({ n: 3 })} [DEVX-1](https://linear.app/acme/issue/DEVX-1)`);
    expect(prBodyLeadRowsError({ body: hiddenBody, sourceProblem: cell !== null })).toContain(
      "must be the first two rows",
    );
  });
});

describe("gatePrBody over the bodies the retired validator judged", () => {
  it("refuses a conforming bronze table body of this repository's own, naming the conversion", () => {
    const bronze = body({ problem: words({ n: 10 }), solution: words({ n: 40 }) });
    expect(gatePrBody({ body: bronze, owned: true })).toStrictEqual(TABLE_REFUSAL);
  });

  it("refuses the markdown-table fallback the same way", () => {
    expect(gatePrBody({ body: MARKDOWN_BODY, owned: true })).toStrictEqual(TABLE_REFUSAL);
  });

  it("refuses a table body with no badge row by its table markup alone", () => {
    const bare = body({ problem: words({ n: 2 }), solution: words({ n: 2 }), withBadges: false });
    expect(gatePrBody({ body: bare, owned: true })).toStrictEqual(TABLE_REFUSAL);
  });

  it("refuses a gold table body with its anchor as one pre-C3 refusal, not one per retired rule", () => {
    const gold = body({
      anchor: `proof-commit: ${HEAD}\nproof-patch-id: ${PATCH}`,
      grade: "gold",
      problem: words({ n: 3 }),
      proof: "end-to-end run: https://github.com/x/y/actions/runs/1",
      solution: words({ n: 3 }),
    });
    expect(gatePrBody({ body: gold, owned: true })).toStrictEqual(TABLE_REFUSAL);
  });

  it("refuses a table body with a Next row ahead of it", () => {
    const withRow = withNext({
      body: body({ problem: words({ n: 3 }), solution: words({ n: 3 }) }),
      next: words({ n: 16 }),
    });
    expect(gatePrBody({ body: withRow, owned: true })).toStrictEqual(TABLE_REFUSAL);
  });

  it("reads a CRLF table body exactly as an LF one", () => {
    const crlf = body({ problem: words({ n: 3 }), solution: words({ n: 3 }) }).replace(/\n/g, "\r\n");
    expect(gatePrBody({ body: crlf, owned: true })).toStrictEqual(TABLE_REFUSAL);
  });

  it("judges nothing in a stranger's table body", () => {
    const bronze = body({ problem: words({ n: 3 }), solution: words({ n: 3 }) });
    expect(gatePrBody({ body: bronze, owned: false })).toStrictEqual({ errors: [], shape: "stranger" });
  });
});

describe("retiredPublicationErrors over the gold anchor a table body carried", () => {
  it("refuses a plain `proof-commit:` line", () => {
    expect(retiredPublicationErrors({ body: `prose\n\nproof-commit: ${HEAD}` })).toEqual(ANCHOR_REFUSAL);
  });

  it("refuses the commit and patch-id lines together as ONE gold anchor", () => {
    expect(retiredPublicationErrors({ body: `prose\n\nproof-commit: c6b7dbc\nproof-patch-id: ${PATCH}` })).toEqual(
      ANCHOR_REFUSAL,
    );
  });

  it("refuses a patch-id line on its own", () => {
    expect(retiredPublicationErrors({ body: `prose\n\nproof-patch-id: ${PATCH}` })).toEqual(ANCHOR_REFUSAL);
  });

  // The retired table renderer wrapped the anchor in a collapsed `<details>` block and added a plain-words gloss to
  // the patch id. These are those exact bytes, frozen, since an old body still carries them.
  it("refuses the collapsed anchor block the retired renderer wrote", () => {
    const anchor = [
      "<details>",
      "<summary>Proof anchor (for CI)</summary>",
      "",
      `proof-commit: [\`${HEAD}\`](https://github.com/o/r/commit/${HEAD})`,
      `proof-patch-id: ${PATCH} — a fingerprint of this branch's own change — it survives a plain rebase that only moves the commit above`,
      "",
      "</details>",
    ].join("\n");
    expect(retiredPublicationErrors({ body: `${words({ n: 3 })}\n\n${anchor}` })).toEqual(ANCHOR_REFUSAL);
  });

  it("refuses an indented or upper-case anchor line", () => {
    expect(retiredPublicationErrors({ body: "  proof-commit: c6b7dbc" })).toEqual(ANCHOR_REFUSAL);
    expect(retiredPublicationErrors({ body: "PROOF-COMMIT: C6B7DBC" })).toEqual(ANCHOR_REFUSAL);
  });

  it("leaves prose that only names an anchor mid-line alone", () => {
    expect(retiredPublicationErrors({ body: "the old gate read a proof-commit: line off gold bodies" })).toEqual([]);
  });

  it("leaves a bronze table body with no anchor alone", () => {
    expect(retiredPublicationErrors({ body: body({ problem: words({ n: 3 }), solution: words({ n: 3 }) }) })).toEqual(
      [],
    );
  });
});
