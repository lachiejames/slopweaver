/**
 * The reading-order parser is the renderer's exact inverse: every rendered body reads back into the stamped body
 * that rendered it, the facts only the tooltips carry included, and anything else is declined by name.
 */
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { parseReadingOrderBody } from "../../../../../outbound/github/legacy/parse.js";
import type { PastedMediaBlock } from "../../../../../outbound/github/legacy/pastedMedia.js";
import { renderStampedBody } from "../../../../../outbound/github/legacy/render.js";
import type { RiskRowShape } from "../../../../../outbound/github/legacy/riskRow.js";
import type { BadgeRowShape } from "../../../../../outbound/github/legacy/tooltips.js";
import type { Claim, StampedPrBody } from "../../../../../outbound/github/legacy/types.js";
import {
  BEFORE_AFTER,
  CLICK_THROUGH,
  FAILS_ON_MAIN,
  FULL_BODY,
  GOLD_REVIEW,
  MINIMAL_BODY,
  NOTES,
  P3_UNCHECKED,
  PROOF,
  PROVEN,
  TARGET,
  t,
} from "./fixtures.js";

/**
 * A real body in the RETIRED table shape, as the old renderer wrote it: badge row, the Next callout, the
 * labelled rows and the collapsed proof anchor. Literal on purpose — nothing in this repository renders it now.
 */
const RETIRED_TABLE_BODY = [
  '<img src="https://img.shields.io/badge/CI-passing-2ea44f?style=flat" alt="CI"> ' +
    '<img src="https://img.shields.io/badge/proof-gold-ffd700?style=flat" alt="proof">',
  "> 👉 <strong>Next</strong>: the re-run docs it unblocks become runnable",
  [
    "<table>",
    "<tr>\n<td><strong>Risk</strong></td>\n<td>Low risk, a fixture.</td>\n</tr>",
    '<tr>\n<td><strong>Problem</strong></td>\n<td>Updating a description destroys the Proof section. <a href="https://linear.app/acme/issue/DEVX-1">DEVX-1</a></td>\n</tr>',
    "<tr>\n<td><strong>Solution</strong></td>\n<td>Store the rendered form and merge field by field.</td>\n</tr>",
    '<tr>\n<td><strong>Proof</strong></td>\n<td><a href="https://github.com/o/r/actions/runs/1">the run</a></td>\n</tr>',
    "</table>",
  ].join("\n"),
  "<details>\n<summary>Proof anchor (for CI)</summary>\n\nproof-commit: [`9f3c1de`](https://github.com/o/r/commit/9f3c1de)\n\n</details>",
].join("\n\n");

/**
 * Render a stamped body, its anchor (when it has one) pointing into the fixture target, with the plain badge row
 * and sentence risk rows unless an older shape is asked for. `render.test.ts` pins every shape's literal bytes.
 */
function rendered({
  badges = "plain",
  body,
  pasted = [],
  riskRows = "sentence",
}: {
  badges?: BadgeRowShape;
  body: StampedPrBody;
  pasted?: readonly PastedMediaBlock[];
  riskRows?: RiskRowShape;
}): string {
  const anchor = body.goldAnchor === undefined ? undefined : { goldAnchor: body.goldAnchor, repo: TARGET };
  return unwrap(renderStampedBody({ anchor, badges, body, pasted, riskRows }));
}

const SEEN = { kind: "seen", on: "2026-09-28" } as const;

/** A proven claim whose evidence is a run link, then the screenshot of it. */
const PROVEN_WITH_SCREENSHOT: Claim = {
  claim: t({ text: "Logs are visible." }),
  proof: {
    evidence: [
      { kind: "link", text: "run", url: "https://github.com/o/r/actions/runs/7" },
      { kind: "text", text: " shows them: " },
      { alt: "logs", kind: "image", url: "https://github.com/user-attachments/assets/a" },
    ],
    kind: "proven",
  },
};

describe("parseReadingOrderBody — round trips", () => {
  const cases: ReadonlyArray<{ name: string; body: StampedPrBody }> = [
    { body: MINIMAL_BODY, name: "the minimal body, every optional section off" },
    { body: FULL_BODY, name: "the full body, every optional section on" },
    { body: { ...MINIMAL_BODY, beforeAfter: BEFORE_AFTER, problemSeen: SEEN }, name: "Before-and-after only" },
    { body: { ...MINIMAL_BODY, failsOnMain: FAILS_ON_MAIN }, name: "fails-on-main only" },
    { body: { ...MINIMAL_BODY, clickThrough: CLICK_THROUGH }, name: "a click-through only" },
    { body: { ...FULL_BODY, clickThrough: CLICK_THROUGH }, name: "a click-through after fails-on-main" },
    {
      body: { ...MINIMAL_BODY, clickThrough: { ...CLICK_THROUGH, control: t({ text: "a<br>b" }) } },
      name: "a click-through whose control text spells a <br>",
    },
    { body: { ...MINIMAL_BODY, whyApproach: [t({ text: "a" }), t({ text: "b" })] }, name: "Why this approach only" },
    { body: { ...MINIMAL_BODY, notes: NOTES }, name: "notes without an anchor" },
    { body: { ...MINIMAL_BODY, goldAnchor: { commit: "9f3c1de" } }, name: "an anchor without notes or a patch id" },
    { body: { ...MINIMAL_BODY, claims: [PROVEN], review: GOLD_REVIEW }, name: "a review with no gap" },
    { body: { ...MINIMAL_BODY, claims: [PROVEN_WITH_SCREENSHOT] }, name: "a proven claim carrying its screenshot" },
    { body: { ...MINIMAL_BODY, proof: PROOF }, name: "a Proof section, one picture sized and one not" },
    {
      body: {
        ...MINIMAL_BODY,
        beforeAfter: {
          ...BEFORE_AFTER,
          fix: { ...BEFORE_AFTER.fix, evidence: [{ ...PROOF[0]!.image, width: 320 }] },
        },
        problemSeen: SEEN,
      },
      name: "a Before-and-after screenshot carrying a display width",
    },
    {
      body: { ...MINIMAL_BODY, risk: { ...MINIMAL_BODY.risk, items: [{ ...P3_UNCHECKED, priority: 4 }] } },
      name: "a risk list with no check at any priority",
    },
  ];

  it.each(cases)("reads back $name", ({ body }) => {
    const parsed = unwrap(parseReadingOrderBody({ body: rendered({ body }) }));
    expect(parsed.body).toEqual(body);
    expect(parsed.remainder).toBe("");
    expect(parsed.riskRows).toBe("sentence");
  });

  it.each(cases)("reads back $name written in the dotted risk rows, and says so", ({ body }) => {
    const parsed = unwrap(parseReadingOrderBody({ body: rendered({ body, riskRows: "dotted" }) }));
    expect(parsed.body).toEqual(body);
    expect(parsed.riskRows).toBe("dotted");
  });

  it.each(cases)("reads back $name written with the legacy three-badge row, and says so", ({ body }) => {
    const parsed = unwrap(parseReadingOrderBody({ body: rendered({ badges: "withSolved", body }) }));
    expect(parsed.body).toEqual(body);
    expect([parsed.badges, parsed.riskRows]).toEqual(["withSolved", "sentence"]);
  });

  it.each(cases)("reads back $name in the oldest shape, legacy badges over dotted rows", ({ body }) => {
    const parsed = unwrap(
      parseReadingOrderBody({ body: rendered({ badges: "withSolved", body, riskRows: "dotted" }) }),
    );
    expect(parsed.body).toEqual(body);
    expect([parsed.badges, parsed.riskRows]).toEqual(["withSolved", "dotted"]);
  });

  it.each([
    ["a comment closer", "it holds --> and <!-- inside"],
    ["a double hyphen", "a -- b --- c"],
    ["an ampersand and markup", "a & b <b>c</b>"],
    ["entity-like text", "&amp; &lt; &#45; \\u002d"],
    ["a quote and a backslash", 'it said "ok" \\ fine'],
  ])("round-trips a review why carrying %s through its hidden comment", (_name, why) => {
    const body = { ...MINIMAL_BODY, claims: [PROVEN], review: { ...GOLD_REVIEW, why } };
    const text = rendered({ body });
    const badgeLine = text.slice(0, text.indexOf("\n"));
    expect(badgeLine.slice(badgeLine.indexOf("<!--") + 4, badgeLine.lastIndexOf("-->"))).not.toContain("--");
    expect(unwrap(parseReadingOrderBody({ body: text })).body).toEqual(body);
  });

  it("reads back a worst ending in a question, which the row adds no full stop to", () => {
    const item = { ...P3_UNCHECKED, reach: t({ text: "old pull requests" }), worst: t({ text: "Is it misread?" }) };
    const body = { ...MINIMAL_BODY, risk: { ...MINIMAL_BODY.risk, items: [item] } };
    const text = rendered({ body });
    expect(text).toContain(
      "<strong>Is it misread?</strong> Possible, but minor if it happens. Affects old pull requests.<br>",
    );
    expect(unwrap(parseReadingOrderBody({ body: text })).body).toEqual(body);
  });

  it("reads a typed full stop back as the added one, rendering the same bytes", () => {
    const item = { ...P3_UNCHECKED, reach: t({ text: "old pull requests." }), worst: t({ text: "It is misread." }) };
    const body = { ...MINIMAL_BODY, risk: { ...MINIMAL_BODY.risk, items: [item] } };
    const text = rendered({ body });
    const parsed = unwrap(parseReadingOrderBody({ body: text }));
    expect([parsed.body.risk.items[0]!.worst, parsed.body.risk.items[0]!.reach]).toEqual([
      t({ text: "It is misread" }),
      t({ text: "old pull requests" }),
    ]);
    expect(rendered({ body: parsed.body })).toBe(text);
  });

  it("reads back a worst ending in a code run, the added full stop outside it", () => {
    const worst = [...t({ text: "It breaks " }), { kind: "code", text: "yarn start." } as const];
    const body = { ...MINIMAL_BODY, risk: { ...MINIMAL_BODY.risk, items: [{ ...P3_UNCHECKED, worst }] } };
    const text = rendered({ body });
    expect(text).toContain("<strong>It breaks <code>yarn start.</code>.</strong>");
    expect(unwrap(parseReadingOrderBody({ body: text })).body).toEqual(body);
  });

  it("returns the anchor's repository off the commit link", () => {
    expect(unwrap(parseReadingOrderBody({ body: rendered({ body: FULL_BODY }) })).anchorRepo).toEqual({
      owner: "o",
      repo: "r",
    });
  });

  it("returns no repository when there is no anchor", () => {
    expect(unwrap(parseReadingOrderBody({ body: rendered({ body: MINIMAL_BODY }) })).anchorRepo).toBe(undefined);
  });
});

describe("parseReadingOrderBody — the tooltips carry what the sections do not", () => {
  it("recovers writtenOn and the seen day from the problem tooltip", () => {
    const body = { ...FULL_BODY, problemSeen: { kind: "seen", on: "2026-08-01" }, writtenOn: "2026-09-30" } as const;
    const parsed = unwrap(parseReadingOrderBody({ body: rendered({ body }) })).body;
    expect([parsed.writtenOn, parsed.problemSeen]).toEqual(["2026-09-30", { kind: "seen", on: "2026-08-01" }]);
  });

  it("recovers a review whose reason carries a colon", () => {
    const review = { grade: "silver", reviewer: "a reviewer", why: "checked: the bytes match" } as const;
    const body = { ...FULL_BODY, review };
    expect(unwrap(parseReadingOrderBody({ body: rendered({ body }) })).body.review).toEqual(review);
  });
});

describe("parseReadingOrderBody — the trailing region", () => {
  it("preserves a third-party footer verbatim", () => {
    const footer = "\n---\n<sub>Summary by a review bot</sub>\n";
    const parsed = unwrap(parseReadingOrderBody({ body: `${rendered({ body: FULL_BODY })}${footer}` }));
    expect(parsed.remainder).toBe(footer);
    expect(parsed.body).toEqual(FULL_BODY);
  });

  it("refuses a footer carrying a second proof anchor", () => {
    const body = `${rendered({ body: MINIMAL_BODY })}\nproof-commit: 9f3c1de\n`;
    expect(unwrapErr(parseReadingOrderBody({ body })).code).toBe("TRAILING_MARKUP");
  });

  it.each([
    {
      footer: '\n## <a name="what-can-go-wrong-if-this-merges"></a>What can go wrong if this merges\n',
      name: "a second reading-order heading",
    },
    { footer: "\n<td><strong>Proof</strong></td>\n", name: "a retired table row" },
  ])("refuses a footer carrying $name", ({ footer }) => {
    const body = `${rendered({ body: FULL_BODY })}${footer}`;
    expect(unwrapErr(parseReadingOrderBody({ body })).code).toBe("TRAILING_MARKUP");
  });

  it("keeps a bot's release-notes footer and its own shields badge as third-party content", () => {
    const footer =
      "\n<!-- auto-generated by coderabbit.ai -->\n\n## Summary by CodeRabbit\n\n" +
      '<img src="https://img.shields.io/badge/coverage-98%25-brightgreen?style=flat" alt="coverage">\n';
    expect(unwrap(parseReadingOrderBody({ body: `${rendered({ body: MINIMAL_BODY })}${footer}` })).remainder).toBe(
      footer,
    );
  });
});

/** A paste in each spelling GitHub's editor writes, from a user-attachments upload. */
const PASTES = [
  [
    "an <img> tag with a width and height",
    '<img width="1512" height="982" alt="Image" src="https://github.com/user-attachments/assets/abc-1" />',
  ],
  ["a Markdown image", "![image](https://github.com/user-attachments/assets/abc-1)"],
  ["a bare video URL", "https://github.com/user-attachments/assets/abc-1"],
] as const;

/** The full body with `raw` pasted straight after its Problem paragraph. */
function pastedAfterProblem({ raw }: { raw: string }): string {
  return rendered({ body: FULL_BODY, pasted: [{ after: "problem", raw }] });
}

describe("parseReadingOrderBody — media pasted between the sections", () => {
  it.each(PASTES)("reads past %s and keys it to the block it followed", (_name, raw) => {
    const text = pastedAfterProblem({ raw });
    expect(text).toContain(`<p>A reviewer meets the table before the risk.</p>\n\n${raw}\n\n### Change`);
    const parsed = unwrap(parseReadingOrderBody({ body: text }));
    expect([parsed.body, parsed.pasted, parsed.remainder]).toEqual([FULL_BODY, [{ after: "problem", raw }], ""]);
  });

  it("keys a paste above the badge row to the start, and two pastes in a row keep their order", () => {
    const pasted = [
      { after: "start", raw: PASTES[1][1] },
      { after: "claims", raw: PASTES[2][1] },
      { after: "claims", raw: PASTES[0][1] },
    ] as const;
    const parsed = unwrap(parseReadingOrderBody({ body: rendered({ body: FULL_BODY, pasted }) }));
    expect(parsed.pasted).toEqual(pasted);
  });

  it("re-renders a paste after an edit to the block before it, by key rather than by its old bytes", () => {
    const parsed = unwrap(parseReadingOrderBody({ body: pastedAfterProblem({ raw: PASTES[1][1] }) }));
    const edited = { ...parsed.body, problem: t({ text: "A new problem statement." }) };
    expect(rendered({ body: edited, pasted: parsed.pasted })).toContain(
      `<p>A new problem statement.</p>\n\n${PASTES[1][1]}\n\n### Change`,
    );
  });

  it("keys a paste after a notes-free body's last block to that block, so notes an edit adds go below it", () => {
    const paste = PASTES[1][1];
    const text = rendered({ body: MINIMAL_BODY, pasted: [{ after: "where", raw: paste }] });
    expect(text.endsWith(`</ol>\n\n${paste}\n`)).toBe(true);
    const parsed = unwrap(parseReadingOrderBody({ body: text }));
    expect([parsed.body, parsed.pasted, parsed.remainder]).toEqual([
      MINIMAL_BODY,
      [{ after: "where", raw: paste }],
      "",
    ]);
    const withNotes = rendered({ body: { ...parsed.body, notes: NOTES }, pasted: parsed.pasted });
    expect(withNotes).toContain(`</ol>\n\n${paste}\n\n<details>`);
  });

  it("keys that paste the same way when no newline closes it, as github.com saves one typed at the end", () => {
    const paste = PASTES[1][1];
    const closed = rendered({ body: MINIMAL_BODY, pasted: [{ after: "where", raw: paste }] });
    const parsed = unwrap(parseReadingOrderBody({ body: closed.slice(0, -1) }));
    expect([parsed.body, parsed.pasted, parsed.remainder]).toEqual([
      MINIMAL_BODY,
      [{ after: "where", raw: paste }],
      "",
    ]);
  });

  it("still keys that paste to the last block when a third party's footer follows it", () => {
    const paste = PASTES[1][1];
    const footer = "\n<!-- a bot footer -->\n";
    const text = `${rendered({ body: MINIMAL_BODY, pasted: [{ after: "where", raw: paste }] })}${footer}`;
    const parsed = unwrap(parseReadingOrderBody({ body: text }));
    expect([parsed.body, parsed.pasted, parsed.remainder]).toEqual([
      MINIMAL_BODY,
      [{ after: "where", raw: paste }],
      footer,
    ]);
  });

  it("keeps a paste after the Longer notes whose alt spells one of our own markers", () => {
    const paste = '<img src="https://github.com/user-attachments/assets/abc-1" alt="proof-commit:">';
    const text = `${rendered({ body: FULL_BODY })}\n${paste}\n`;
    const parsed = unwrap(parseReadingOrderBody({ body: text }));
    expect([parsed.body, parsed.remainder]).toEqual([FULL_BODY, `\n${paste}\n`]);
  });

  it("leaves media after the Longer notes as appended content, since nothing renders after the notes", () => {
    const paste = PASTES[1][1];
    const text = `${rendered({ body: FULL_BODY })}\n${paste}\n`;
    const parsed = unwrap(parseReadingOrderBody({ body: text }));
    expect([parsed.body, parsed.pasted, parsed.remainder]).toEqual([FULL_BODY, [], `\n${paste}\n`]);
  });

  it("moves a paste whose block an edit removed to just after the nearest earlier block still there", () => {
    const pasted = [{ after: "fails-on-main", raw: PASTES[1][1] }] as const;
    const text = rendered({ body: { ...FULL_BODY, failsOnMain: undefined }, pasted });
    expect(text).toContain(`</table>\n\n${PASTES[1][1]}\n\n### <a name="other-claims"></a>Other claims`);
  });

  it.each([
    ["an image off user-attachments", '<img alt="x" src="https://example.com/a.png" />'],
    [
      "an image carrying an event handler",
      '<img src="https://github.com/user-attachments/assets/abc-1" onerror="x" />',
    ],
    [
      "an image whose width is not a number",
      '<img width="50%" src="https://github.com/user-attachments/assets/abc-1" />',
    ],
    [
      "an image naming its source twice",
      '<img src="https://github.com/user-attachments/assets/abc-1" src="https://example.com/a" />',
    ],
    ["a Markdown image with a title", '![image](https://github.com/user-attachments/assets/abc-1 "t")'],
    ["prose carrying an attachment URL", "see https://github.com/user-attachments/assets/abc-1"],
    ["a raw paragraph", "<p>hand-written</p>"],
  ])("still refuses %s mid-body", (_name, raw) => {
    expect(unwrapErr(parseReadingOrderBody({ body: pastedAfterProblem({ raw }) })).code).toBe("STRUCTURE");
  });
});

describe("parseReadingOrderBody — declines", () => {
  it("names the conversion for a real retired table body", () => {
    const refused = unwrapErr(parseReadingOrderBody({ body: RETIRED_TABLE_BODY }));
    expect(refused.code).toBe("RETIRED_SHAPE");
    expect(refused.message).toContain("`slopweaver github pr update --repo <owner/name> --number <n> --file <f>`");
  });

  it("refuses a retired table body even with a third party's footer after it", () => {
    const body = `${RETIRED_TABLE_BODY}\n\n---\n<sub>Summary by a review bot</sub>\n`;
    expect(unwrapErr(parseReadingOrderBody({ body })).code).toBe("RETIRED_SHAPE");
  });

  it("refuses an empty body", () => {
    expect(unwrapErr(parseReadingOrderBody({ body: "" })).code).toBe("ABSENT_BODY");
  });

  it("refuses a body whose derived badge was hand-edited", () => {
    const body = rendered({ body: FULL_BODY }).replace("risk-high-d73a49", "risk-low-2ea44f");
    expect(unwrapErr(parseReadingOrderBody({ body })).code).toBe("NON_CANONICAL");
  });

  it("declines risk items that mix the sentence and dotted row shapes", () => {
    const sentence = rendered({ body: FULL_BODY });
    const dotted = rendered({ body: FULL_BODY, riskRows: "dotted" });
    const firstDottedRow = dotted.split("\n").find((line) => line.startsWith("<li><strong>"))!;
    const firstSentenceRow = sentence.split("\n").find((line) => line.startsWith('<li data-priority="'))!;
    const mixed = sentence.replace(firstSentenceRow, firstDottedRow);
    expect(mixed).not.toBe(sentence);
    expect(unwrapErr(parseReadingOrderBody({ body: mixed })).message).toContain("(stopped at: the risk items)");
  });

  it("refuses a body with a section removed", () => {
    const body = rendered({ body: MINIMAL_BODY }).replace(
      "### Change\n\n<p>Render the body in reading order.</p>\n\n",
      "",
    );
    expect(unwrapErr(parseReadingOrderBody({ body })).code).toBe("STRUCTURE");
  });

  it("declines a click-through line carrying a second, hand-typed <br>", () => {
    const body = rendered({ body: { ...MINIMAL_BODY, clickThrough: CLICK_THROUGH } }).replace(
      "<strong>Open</strong>",
      "<strong>Open</strong><br>",
    );
    expect(unwrapErr(parseReadingOrderBody({ body })).message).toContain("(stopped at: the click-through line)");
  });

  it("declines a click-through whose destination carries no screenshot", () => {
    const clickThrough = { ...CLICK_THROUGH, destination: t({ text: "the pull request page" }) };
    const body = rendered({ body: { ...MINIMAL_BODY, clickThrough } });
    expect(unwrapErr(parseReadingOrderBody({ body })).code).toBe("RECOVERED_SCHEMA");
  });
});
