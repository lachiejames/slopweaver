/**
 * The C3 description: the renderer's exact bytes, and the parser inverting them byte for byte.
 */
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { PRE_C3_CONVERSION } from "../../../../outbound/github/errors.js";
import { parsePrBody } from "../../../../outbound/github/parse.js";
import { renderBody, renderBodyIn } from "../../../../outbound/github/render.js";
import { prBodySchema } from "../../../../outbound/github/schema.js";
import type { PrBody } from "../../../../outbound/github/types.js";
import {
  EVERY_CELL_BODY,
  FEATURE_BODY,
  FIX_BODY,
  P2_CHECKED,
  QUOTE_BODY,
  QUOTED_LOG,
  TESTS_BODY,
  TESTS_ONLY_BODY,
  t,
} from "./fixtures.js";

/** The feature body's badge row and explainer, the same in both layouts. */
const FEATURE_HEAD = [
  '<a href="#proof-of-the-solution" title="Worst case a sign-in that used to work is refused. It only refuses an ' +
    'expiry that is not a sensible number of seconds."><img src="https://img.shields.io/badge/risk-medium-dbab09' +
    '?style=flat" alt="risk: medium"></a> <a href="#proof-of-the-problem" title="Not seen on a real sign-in yet.">' +
    '<img src="https://img.shields.io/badge/problem-not%20seen%20yet-6e7781?style=flat" alt="problem: not seen ' +
    'yet"></a> <a href="#proof-of-the-solution" title="A screenshot of the solution from a real run by an agent. ' +
    "The problem wasn't captured: Not captured yet: the 7-day expiry has to pass first.\"><img " +
    'src="https://img.shields.io/badge/proof-solution%20only-2ea44f?style=flat" alt="proof: solution only"></a>',
  '<p><a href="https://example.com/oauth#expiry">The provider expires sign-ins after 7 days</a> for an app in ' +
    "testing mode. This saves the expiry and warns 48 hours before.</p>",
];

/** The feature body's solution screenshot, the same in both layouts. */
const FEATURE_SOLUTION =
  "<p>Straight after a sign-in, the expiry is saved 7 days out.</p>\n" +
  '<p><img src="https://github.com/user-attachments/assets/77777777-aaaa-4bbb-8ccc-000000000001" alt="saved ' +
  'expiry seven days out"></p>';

/** The feature body's Not-checked list and fold, the same in both layouts. */
const FEATURE_TAIL = [
  "<ul>\n<li>The 48-hour warning on a real sign-in. Tests cover it, and a third capture on day 5 adds little.</li>\n</ul>",
  "<details>\n<summary>Re-run</summary>\n\n<p>Where the warning shows up, and the tests.</p>\n\n" +
    "<ul>\n<li>expiry.test.ts</li>\n<li>warning.test.ts</li>\n</ul>\n\n</details>",
];

/** Layout 2: `##` headings, a reason slot's heading saying it is not shown, the checks a list under their own heading. */
const FEATURE_BYTES = [
  ...FEATURE_HEAD,
  '## <a name="proof-of-the-problem"></a>Proof of the problem: not shown',
  "<p>Not captured yet: the 7-day expiry has to pass first.</p>",
  '## <a name="proof-of-the-solution"></a>Proof of the solution',
  FEATURE_SOLUTION,
  '## <a name="checks"></a>Checks',
  "<ul>\n<li>A garbled expiry is refused, not ignored.</li>\n<li>A sign-in saved before still reads.</li>\n</ul>",
  '## <a name="not-checked-and-why"></a>Not checked, and why',
  FEATURE_TAIL[0]!,
  FEATURE_TAIL[1]!,
].join("\n\n");

/** Layout 1, as a description published before the ruling reads: `###` headings and the checks as paragraphs. */
const FEATURE_LAYOUT_1_BYTES = [
  ...FEATURE_HEAD,
  '### <a name="proof-of-the-problem"></a>Proof of the problem',
  "<p>Not captured yet: the 7-day expiry has to pass first.</p>",
  '### <a name="proof-of-the-solution"></a>Proof of the solution',
  FEATURE_SOLUTION,
  "<p>A garbled expiry is refused, not ignored.</p>",
  "<p>A sign-in saved before still reads.</p>",
  '### <a name="not-checked-and-why"></a>Not checked, and why',
  FEATURE_TAIL[0]!,
  FEATURE_TAIL[1]!,
].join("\n\n");

/** The feature body with a labelled group of checks after its base ones. */
const GROUPED_BODY: PrBody = {
  ...FEATURE_BODY,
  checkGroups: [
    {
      items: [t({ text: "The warning shows 48 hours out." }), t({ text: "It clears after a sign-in." })],
      label: t({ text: "On a real sign-in" }),
    },
  ],
};

describe("renderBody", () => {
  it("writes the C3 shape: badges, explainer, both proofs, checks, not checked, the fold", () => {
    expect(unwrap(renderBody({ body: FEATURE_BODY }))).toBe(`${FEATURE_BYTES}\n`);
  });

  it("writes a layout-1 body exactly as it was published before the ruling", () => {
    expect(unwrap(renderBodyIn({ body: FEATURE_BODY, layout: 1 }))).toBe(`${FEATURE_LAYOUT_1_BYTES}\n`);
  });

  it("writes a check group after the base checks, its label an item holding its own list, on one line", () => {
    expect(unwrap(renderBody({ body: GROUPED_BODY }))).toContain(
      "<ul>\n<li>A garbled expiry is refused, not ignored.</li>\n<li>A sign-in saved before still reads.</li>\n" +
        "<li>On a real sign-in<ul><li>The warning shows 48 hours out.</li><li>It clears after a sign-in.</li></ul></li>\n" +
        "</ul>",
    );
  });

  it("refuses check groups in layout 1, which has nowhere to put them", () => {
    expect(unwrapErr(renderBodyIn({ body: GROUPED_BODY, layout: 1 })).code).toBe("NON_CANONICAL");
  });

  it("says not shown on both proof headings when both slots are reasons", () => {
    const bytes = unwrap(renderBody({ body: TESTS_ONLY_BODY }));
    expect(bytes.match(/: not shown\n/g)!.length).toBe(2);
  });

  it("writes no fold and no Not checked heading when both are empty", () => {
    const bytes = unwrap(renderBody({ body: FIX_BODY }));
    expect(bytes.includes("<details>")).toBe(false);
    expect(bytes.includes("Not checked, and why")).toBe(false);
  });

  it("publishes no grade, anchor, origin, reviewer table or leftovers", () => {
    const bytes = unwrap(renderBody({ body: TESTS_BODY }));
    for (const retired of ["slopweaver-review", "proof-commit:", "Who reviews what", "Origin", "gold", "Codex"]) {
      expect({ retired, present: bytes.includes(retired) }).toEqual({ present: false, retired });
    }
  });

  it("refuses a derived hover longer than the cap rather than shortening it", () => {
    const long = { ...P2_CHECKED, worst: `a sign-in ${"that used to work ".repeat(12)}is refused` };
    const error = unwrapErr(renderBody({ body: { ...FIX_BODY, risk: { items: [long] } } }));
    expect(error.code).toBe("HOVER_TOO_LONG");
  });

  it("colours the five proof values and never red", () => {
    expect(unwrap(renderBody({ body: TESTS_ONLY_BODY }))).toContain("proof-tests%20only-6e7781");
    const notRun: PrBody = { ...TESTS_ONLY_BODY, visualProof: "screen-change" };
    expect(unwrap(renderBody({ body: notRun }))).toContain("proof-not%20run%20yet-dbab09");
    expect(unwrap(renderBody({ body: TESTS_BODY }))).toContain("proof-problem%20and%20solution-2ea44f");
  });

  it("writes the seen hover with the day, what was seen and an unrecorded actor", () => {
    expect(unwrap(renderBody({ body: TESTS_BODY }))).toContain(
      'title="Seen 16 Nov 2026: widget connect failed after consent on a personal account. Who ran it isn\'t recorded."',
    );
  });
});

describe("parsePrBody", () => {
  it.each([
    ["the tests body", TESTS_BODY],
    ["the feature body", FEATURE_BODY],
    ["the tests-only body", TESTS_ONLY_BODY],
    ["a body with every kind of content cell filled, run for run", EVERY_CELL_BODY],
  ])("inverts %s exactly", (_name, body) => {
    const bytes = unwrap(renderBody({ body }));
    const parsed = unwrap(parsePrBody({ body: bytes }));
    expect(parsed.body).toEqual(body);
    expect(parsed.remainder).toBe("");
  });

  it("inverts a body with check groups, and reads it as layout 2", () => {
    const parsed = unwrap(parsePrBody({ body: unwrap(renderBody({ body: GROUPED_BODY })) }));
    expect([parsed.body, parsed.layout]).toEqual([GROUPED_BODY, 2]);
  });

  it.each([1, 2] as const)("reads a layout-%i body back as its own layout, every field intact", (layout) => {
    const parsed = unwrap(parsePrBody({ body: unwrap(renderBodyIn({ body: FEATURE_BODY, layout })) }));
    expect([parsed.body, parsed.layout]).toEqual([FEATURE_BODY, layout]);
  });

  it("reads a layout-1 body as layout 1 when its Re-run command quotes the layout-2 heading", () => {
    const body: PrBody = {
      ...FEATURE_BODY,
      rerun: [
        { kind: "command", lang: "sh", text: 'echo ok\n\n## <a name="proof-of-the-problem"></a>Proof of the problem' },
      ],
    };
    const parsed = unwrap(parsePrBody({ body: unwrap(renderBodyIn({ body, layout: 1 })) }));
    expect([parsed.body, parsed.layout]).toEqual([body, 1]);
  });

  it("refuses a code source carrying a backtick, which the authoring file could not read back", () => {
    const solutionProof = { ...QUOTE_BODY.solutionProof, source: { kind: "code", text: "printf `x`" } };
    expect(prBodySchema.safeParse({ ...QUOTE_BODY, solutionProof }).error!.issues[0]!.message).toBe(
      "a code source carries no backtick; quote that command's job log as a link source instead",
    );
  });

  it("refuses an empty check-group list, which would render as none and come back without the key", () => {
    expect(prBodySchema.safeParse({ ...FEATURE_BODY, checkGroups: [] }).error!.issues[0]!.message).toBe(
      "checkGroups holds at least one group when present; leave it out for none",
    );
  });

  it("refuses a layout-2 body whose reason heading lost its not-shown mark", () => {
    const bytes = unwrap(renderBody({ body: FEATURE_BODY })).replace(
      "Proof of the problem: not shown",
      "Proof of the problem",
    );
    expect(unwrapErr(parsePrBody({ body: bytes })).code).toBe("NON_CANONICAL");
  });

  it("splits a Not checked row at the first full stop OUTSIDE a tag, so a link URL carrying `. ` reads back", () => {
    const body: PrBody = {
      ...FIX_BODY,
      notChecked: [
        {
          check: [{ kind: "link", text: "A work account", url: "https://example.com/x. y" }],
          why: t({ text: "Not available." }),
        },
      ],
    };
    const parsed = unwrap(parsePrBody({ body: unwrap(renderBody({ body })) }));
    expect(parsed.body.notChecked).toEqual(body.notChecked);
  });

  it("reads back the top risk alone, its kind the one its level implies", () => {
    const parsed = unwrap(parsePrBody({ body: unwrap(renderBody({ body: FIX_BODY })) }));
    expect(parsed.body.risk).toEqual({ items: [P2_CHECKED] });
    expect(unwrap(renderBody({ body: parsed.body }))).toBe(unwrap(renderBody({ body: FIX_BODY })));
  });

  it("hands third-party content after the body back as the remainder", () => {
    const bytes = unwrap(renderBody({ body: FEATURE_BODY }));
    const parsed = unwrap(parsePrBody({ body: `${bytes}\n---\nA bot footer.\n` }));
    expect(parsed.remainder).toBe("\n---\nA bot footer.\n");
    expect(parsed.body).toEqual(FEATURE_BODY);
  });

  it.each(['### <a name="proof-of-the-problem"></a>Proof of the problem', '## <a name="checks"></a>Checks'])(
    "refuses a remainder carrying either layout's heading: %s",
    (heading) => {
      const bytes = unwrap(renderBody({ body: FIX_BODY }));
      expect(unwrapErr(parsePrBody({ body: `${bytes}\n${heading}\n` })).code).toBe("TRAILING_MARKUP");
    },
  );

  it("reads a CRLF body as LF", () => {
    const bytes = unwrap(renderBody({ body: TESTS_BODY })).replaceAll("\n", "\r\n");
    expect(unwrap(parsePrBody({ body: bytes })).body).toEqual(TESTS_BODY);
  });

  it("names the conversion verb for a reading-order body", () => {
    const error = unwrapErr(parsePrBody({ body: "## What does this PR do and why?\n\n<p>x</p>\n" }));
    expect(error.code).toBe("PRE_C3_SHAPE");
    expect(error.message).toContain(PRE_C3_CONVERSION);
  });

  it("refuses a hand-recoloured badge as non-canonical", () => {
    const bytes = unwrap(renderBody({ body: FIX_BODY })).replace("risk-medium-dbab09", "risk-medium-2ea44f");
    expect(unwrapErr(parsePrBody({ body: bytes })).code).toBe("NON_CANONICAL");
  });

  it("refuses an absent body", () => {
    expect(unwrapErr(parsePrBody({ body: undefined })).code).toBe("ABSENT_BODY");
  });

  it("refuses free text as not the C3 shape", () => {
    expect(unwrapErr(parsePrBody({ body: "<p>hello</p>\n" })).code).toBe("STRUCTURE");
  });

  it("reads a body with nothing pasted into it as no pasted media", () => {
    expect(unwrap(parsePrBody({ body: `${FEATURE_BYTES}\n` })).pasted).toStrictEqual([]);
  });

  it.each([
    ["both quoted, nothing on screen", QUOTE_BODY],
    ["both quoted, a screen change", { ...QUOTE_BODY, visualProof: "screen-change" }],
    ["a quoted problem beside a reason", { ...QUOTE_BODY, solutionProof: FEATURE_BODY.problemProof }],
    ["a reason beside a quoted solution", { ...QUOTE_BODY, problemProof: FEATURE_BODY.problemProof }],
    [
      "a quoted problem beside a screenshot",
      { ...QUOTE_BODY, solutionProof: FIX_BODY.solutionProof, visualProof: "screen-change" },
    ],
  ] satisfies readonly [string, PrBody][])("inverts a quote body, %s, exactly", (_name, body) => {
    const parsed = unwrap(parsePrBody({ body: unwrap(renderBody({ body })) }));
    expect([parsed.body, parsed.layout, parsed.remainder]).toEqual([body, 2, ""]);
  });

  it("writes a quote's proves and source above its fold, the output fenced inside it, and no not-shown mark", () => {
    const bytes = unwrap(renderBody({ body: QUOTE_BODY }));
    expect(bytes).toContain(
      '## <a name="proof-of-the-problem"></a>Proof of the problem\n\n' +
        "<p>On main, the build job fails because one required job did not succeed.</p>\n" +
        '<p>Source: <a href="https://github.com/acme/widgets/actions/runs/1/job/2">the build job\'s log</a></p>\n\n' +
        "<details>\n<summary>Quoted output</summary>\n\n" +
        `\`\`\`\`\`text\n${QUOTED_LOG}\n\`\`\`\`\`\n\n</details>\n\n` +
        '## <a name="proof-of-the-solution"></a>Proof of the solution\n\n',
    );
    expect(bytes).toContain("<p>Source: <code>widgets checks --all</code></p>");
  });

  it("never states nothing-on-screen beside a screenshot, which reads back as a screen change", () => {
    const beside = { ...QUOTE_BODY, solutionProof: FIX_BODY.solutionProof };
    expect([
      unwrap(renderBody({ body: { ...beside, visualProof: "nothing-on-screen" } })),
      unwrap(parsePrBody({ body: unwrap(renderBody({ body: beside })) })).body.visualProof,
    ]).toEqual([unwrap(renderBody({ body: { ...beside, visualProof: "screen-change" } })), "screen-change"]);
  });

  it("refuses a quote in layout 1, which has nowhere to put one", () => {
    expect(unwrapErr(renderBodyIn({ body: QUOTE_BODY, layout: 1 })).code).toBe("NON_CANONICAL");
  });

  it("refuses a quote whose fence is longer than the one the renderer picks", () => {
    const bytes = unwrap(renderBody({ body: QUOTE_BODY })).replace(/`{5}/g, "``````");
    expect(unwrapErr(parsePrBody({ body: bytes })).code).toBe("STRUCTURE");
  });

  it("round-trips a command whose text carries a fence", () => {
    const body: PrBody = {
      ...FEATURE_BODY,
      rerun: [
        { kind: "command", lang: "", text: "echo '```'\n\nsecond line" },
        { content: t({ text: "x" }), kind: "note" },
      ],
    };
    expect(unwrap(parsePrBody({ body: unwrap(renderBody({ body })) })).body).toEqual(body);
  });
});

/** A screenshot as github.com's editor writes one, on a synthetic attachment id. */
const PASTE = '<img width="1512" height="982" alt="Image" src="https://github.com/user-attachments/assets/abc-1" />';

/** A second paste, a Markdown image, so two pastes in one description stay distinguishable. */
const SECOND_PASTE = "![image](https://github.com/user-attachments/assets/abc-2)";

/** `blocks` with `paste` standing as its own block straight after the block at `index`. */
function pastedAfter({ blocks, index, paste }: { blocks: readonly string[]; index: number; paste: string }): string {
  return [...blocks.slice(0, index + 1), paste, ...blocks.slice(index + 1)].join("\n\n");
}

/** The layout-2 feature body's blocks, in render order. */
const FEATURE_BLOCKS = FEATURE_BYTES.split("\n\n<details>")[0]!.split("\n\n").concat(FEATURE_TAIL[1]!);

/** The layout-1 feature body's blocks, in render order. */
const FEATURE_LAYOUT_1_BLOCKS = FEATURE_LAYOUT_1_BYTES.split("\n\n<details>")[0]!
  .split("\n\n")
  .concat(FEATURE_TAIL[1]!);

describe("parsePrBody — media pasted on github.com", () => {
  it("lifts a screenshot pasted between two sections, keys it to the block before, and re-renders it in place", () => {
    const bytes = `${pastedAfter({ blocks: FEATURE_BLOCKS, index: 3, paste: PASTE })}\n`;
    const parsed = unwrap(parsePrBody({ body: bytes }));
    expect(parsed).toStrictEqual({
      body: FEATURE_BODY,
      layout: 2,
      pasted: [{ after: "problem-proof", occurrence: 1, raw: PASTE }],
      remainder: "",
    });
    expect(unwrap(renderBodyIn({ body: parsed.body, layout: 2, pasted: parsed.pasted }))).toBe(bytes);
  });

  it("keys a paste between two layout-1 check paragraphs to the first of them", () => {
    const bytes = `${pastedAfter({ blocks: FEATURE_LAYOUT_1_BLOCKS, index: 6, paste: PASTE })}\n`;
    const parsed = unwrap(parsePrBody({ body: bytes }));
    expect([parsed.body, parsed.layout, parsed.pasted]).toStrictEqual([
      FEATURE_BODY,
      1,
      [{ after: "checks", occurrence: 1, raw: PASTE }],
    ]);
    expect(unwrap(renderBodyIn({ body: parsed.body, layout: 1, pasted: parsed.pasted }))).toBe(bytes);
  });

  it("keys a paste opening the description to the start, and two pastes in one slot in their order", () => {
    const twice = pastedAfter({ blocks: FEATURE_BLOCKS, index: 9, paste: `${PASTE}\n\n${SECOND_PASTE}` });
    const bytes = `${PASTE}\n\n${twice}\n`;
    const parsed = unwrap(parsePrBody({ body: bytes }));
    expect(parsed.pasted).toStrictEqual([
      { after: "start", raw: PASTE },
      { after: "not-checked", occurrence: 1, raw: PASTE },
      { after: "not-checked", occurrence: 1, raw: SECOND_PASTE },
    ]);
    expect(unwrap(renderBodyIn({ body: parsed.body, layout: 2, pasted: parsed.pasted }))).toBe(bytes);
  });

  it("leaves a paste after the re-run fold, the last rendered block, in the remainder", () => {
    const parsed = unwrap(parsePrBody({ body: `${FEATURE_BYTES}\n\n${PASTE}\n` }));
    expect([parsed.body, parsed.pasted, parsed.remainder]).toStrictEqual([FEATURE_BODY, [], `\n${PASTE}\n`]);
  });

  it("reads a CRLF body with a paste in it as LF, keyed the same", () => {
    const bytes = `${pastedAfter({ blocks: FEATURE_BLOCKS, index: 3, paste: PASTE })}\n`.replaceAll("\n", "\r\n");
    expect(unwrap(parsePrBody({ body: bytes })).pasted).toStrictEqual([
      { after: "problem-proof", occurrence: 1, raw: PASTE },
    ]);
  });

  it("refuses a paste on the line under a proof paragraph, which is not a block of its own", () => {
    const blocks = FEATURE_BLOCKS.map((block, index) => (index === 3 ? `${block}\n${PASTE}` : block));
    expect(unwrapErr(parsePrBody({ body: `${blocks.join("\n\n")}\n` })).code).toBe("STRUCTURE");
  });

  it("reads an attachment URL standing alone inside a Re-run command as the command, never as a paste", () => {
    const asset = "https://github.com/user-attachments/assets/abc-3";
    const body: PrBody = {
      ...FEATURE_BODY,
      rerun: [{ kind: "command", lang: "sh", text: `curl\n\n${asset}\n\necho` }],
    };
    const parsed = unwrap(parsePrBody({ body: unwrap(renderBody({ body })) }));
    expect([parsed.body, parsed.pasted]).toStrictEqual([body, []]);
  });

  it("refuses a block that is not a narrow paste, such as an image hosted anywhere but user-attachments", () => {
    const elsewhere = '<img width="10" height="10" alt="Image" src="https://example.invalid/a.png" />';
    const bytes = `${pastedAfter({ blocks: FEATURE_BLOCKS, index: 3, paste: elsewhere })}\n`;
    expect(unwrapErr(parsePrBody({ body: bytes })).code).toBe("STRUCTURE");
  });
});

/** The feature body with no Not-checked list and no fold, so in layout 1 it ends on its open run of checks. */
const OPEN_CHECKS_BODY: PrBody = { ...FEATURE_BODY, notChecked: [], rerun: [] };

/** {@link OPEN_CHECKS_BODY} rendered in layout 1. */
const OPEN_CHECKS_BYTES = unwrap(renderBodyIn({ body: OPEN_CHECKS_BODY, layout: 1 }));

/** The layout-1 render's second check paragraph, the last block it writes. */
const SECOND_CHECK = "<p>A sign-in saved before still reads.</p>";

/** The layout-1 render with `inserted` written immediately before its second check. */
function insertedBeforeSecondCheck({ inserted }: { inserted: string }): string {
  return OPEN_CHECKS_BYTES.replace(SECOND_CHECK, `${inserted}${SECOND_CHECK}`);
}

describe("parsePrBody — a layout-1 body ending on its checks", () => {
  it.each([
    ["as its own block", "NOT AN ATTACHMENT\n\n"],
    ["on the line above the check", "NOT AN ATTACHMENT\n"],
    ["on the check's own line", "NOT AN ATTACHMENT "],
    ["indenting the check", "NOT AN ATTACHMENT\n\n "],
    ["behind a comment", "NOT AN ATTACHMENT\n\n<!-- x -->"],
  ])("refuses prose inserted between two checks %s, never reading the second check as a footer", (_, inserted) => {
    const bytes = insertedBeforeSecondCheck({ inserted });
    expect(bytes).toContain(`${inserted}${SECOND_CHECK}\n`);
    expect(unwrapErr(parsePrBody({ body: bytes })).code).toBe("STRUCTURE");
  });

  it("refuses prose and then a check after a body with no check at all, which ends on the solution proof", () => {
    const body: PrBody = { ...OPEN_CHECKS_BODY, checks: [] };
    const bytes = `${unwrap(renderBodyIn({ body, layout: 1 }))}\nNOT AN ATTACHMENT\n\n${SECOND_CHECK} x\n`;
    expect(unwrapErr(parsePrBody({ body: bytes })).code).toBe("TRAILING_MARKUP");
  });

  it.each([
    ["inside its opening tag", "<pX>A sign-in saved before still reads.</p>", "STRUCTURE"],
    ["inside its closing tag", "<p>A sign-in saved before still reads.</pX>", "TRAILING_MARKUP"],
  ])("refuses an edit %s to the last check, which keeps the other tag whole", (_, edited, code) => {
    const bytes = OPEN_CHECKS_BYTES.replace(SECOND_CHECK, edited);
    expect(bytes).toContain(`</p>\n\n${edited}\n`);
    expect(unwrapErr(parsePrBody({ body: bytes })).code).toBe(code);
  });

  it("refuses a footer carrying a check's paragraph tag, which reads the same as an inserted block", () => {
    const bytes = `${OPEN_CHECKS_BYTES}\n---\n<p>Bot status: passed.</p>\n`;
    expect(unwrapErr(parsePrBody({ body: bytes })).code).toBe("STRUCTURE");
  });

  it("reads a paragraph-free footer as the remainder, the body whole", () => {
    const parsed = unwrap(parsePrBody({ body: `${OPEN_CHECKS_BYTES}\n---\nA bot footer.\n` }));
    expect([parsed.body, parsed.layout, parsed.remainder]).toStrictEqual([
      OPEN_CHECKS_BODY,
      1,
      "\n---\nA bot footer.\n",
    ]);
  });

  it("leaves a paste after the last check in the remainder", () => {
    const parsed = unwrap(parsePrBody({ body: `${OPEN_CHECKS_BYTES}\n${PASTE}\n` }));
    expect([parsed.body, parsed.pasted, parsed.remainder]).toStrictEqual([OPEN_CHECKS_BODY, [], `\n${PASTE}\n`]);
  });

  it("still reads a paragraph footer after a layout-2 body, whose checks list is closed", () => {
    const bytes = unwrap(renderBodyIn({ body: OPEN_CHECKS_BODY, layout: 2 }));
    const parsed = unwrap(parsePrBody({ body: `${bytes}\n---\n<p>Bot status: passed.</p>\n` }));
    expect([parsed.body, parsed.layout, parsed.remainder]).toStrictEqual([
      OPEN_CHECKS_BODY,
      2,
      "\n---\n<p>Bot status: passed.</p>\n",
    ]);
  });
});
