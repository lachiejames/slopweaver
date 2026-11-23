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
import { FEATURE_BODY, FIX_BODY, P2_CHECKED, TESTS_BODY, TESTS_ONLY_BODY, t } from "./fixtures.js";

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
