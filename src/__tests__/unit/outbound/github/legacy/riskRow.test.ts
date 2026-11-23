/**
 * The risk item row in both shapes: the nine odds sentences pinned, the full stop added and taken back exactly,
 * and every row reading back to the fields that rendered it.
 */
import { describe, expect, it } from "vitest";
import {
  RISK_ODDS,
  type RiskRowFields,
  readRiskRowLine,
  riskRowLine,
  sentenceRowCellIssue,
  withFullStop,
  withoutAddedFullStop,
} from "../../../../../outbound/github/legacy/riskRow.js";
import type { Level, Priority } from "../../../../../outbound/github/legacy/types.js";

const LEVELS: readonly Level[] = ["low", "medium", "high"];
const PRIORITIES: readonly Priority[] = [0, 1, 2, 3, 4];

const KNIP: RiskRowFields = {
  check: { html: "I scanned every removal for uses CI can't see and kept 79", kind: "checked" },
  impact: "high",
  likelihood: "low",
  priority: 1,
  reachHtml: "hand-run scripts, migrations, Pulumi stacks, code loaded by a computed name",
  worstHtml: "Something still uses a removed package and breaks the next time someone runs it",
};

describe("RISK_ODDS — the nine sentences are a wire format", () => {
  const cells = LEVELS.flatMap((likelihood) => LEVELS.map((impact) => [likelihood, impact] as const));

  it("has a sentence for every likelihood and impact", () => {
    expect(cells.length).toBe(9);
  });

  it.each([
    ["low", "low", "Unlikely, and minor if it happens."],
    ["low", "medium", "Unlikely, but noticeable if it happens."],
    ["low", "high", "Unlikely, but serious if it happens."],
    ["medium", "low", "Possible, but minor if it happens."],
    ["medium", "medium", "Possible, and noticeable if it happens."],
    ["medium", "high", "Possible, and serious if it happens."],
    ["high", "low", "Likely, but minor if it happens."],
    ["high", "medium", "Likely, and noticeable if it happens."],
    ["high", "high", "Likely, and serious if it happens."],
  ] as const)("likelihood %s, impact %s reads %j", (likelihood, impact, sentence) => {
    expect(RISK_ODDS[likelihood][impact]).toBe(sentence);
  });
});

describe("withFullStop / withoutAddedFullStop", () => {
  it.each([
    ["plain", "Foo", "Foo."],
    ["a question", "Does it read?", "Does it read?"],
    ["an exclamation", "Breaks!", "Breaks!"],
    ["already stopped", "Foo.", "Foo."],
    ["a code run last", "Breaks <code>yarn start</code>", "Breaks <code>yarn start</code>."],
  ])("%s", (_, html, rendered) => {
    expect(withFullStop({ html })).toBe(rendered);
  });

  it.each(["Foo", "Does it read?", "Foo..", "Foo?.", "Breaks <code>x</code>", "Foo."])(
    "re-rendering what was read back reproduces %j's render",
    (html) => {
      const rendered = withFullStop({ html });
      expect(withFullStop({ html: withoutAddedFullStop({ html: rendered }) })).toBe(rendered);
    },
  );

  it("reads a field authored with its own full stop back without it", () => {
    expect(withoutAddedFullStop({ html: withFullStop({ html: "this test." }) })).toBe("this test");
  });
});

describe("sentenceRowCellIssue — what the write door refuses in a worst or reach", () => {
  it("passes a plain field, a question, a trailing code run and a typed full stop", () => {
    const fields = [
      "Something breaks",
      "Does it read?",
      "It breaks <code>yarn start.</code>",
      "A badge reads wrong.",
      "<strong>x</strong>.",
    ];
    expect(fields.map((html) => sentenceRowCellIssue({ html }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it.each(["<strong>x</strong> .", ".", " ."])("refuses %j, a full stop standing apart from its text", (html) => {
    expect(sentenceRowCellIssue({ html })).toBe(
      "ends in a full stop standing apart from its text, which would read back as a blank run. Join or remove it",
    );
  });

  it("refuses a field carrying an odds sentence, which would end the worst early", () => {
    expect(
      sentenceRowCellIssue({ html: "<strong>Nothing</strong> Unlikely, and minor if it happens. Affects it" }),
    ).toBe('contains "Unlikely, and minor if it happens.", which the risk row is split on. Reword it');
  });
});

describe("riskRowLine — the sentence row", () => {
  it("renders the knip item the way a reader reads it", () => {
    expect(riskRowLine({ fields: KNIP, shape: "sentence" })).toBe(
      '<li data-priority="1"><strong>Something still uses a removed package and breaks the next time someone runs ' +
        "it.</strong> Unlikely, but serious if it happens. Affects hand-run scripts, migrations, Pulumi stacks, code " +
        "loaded by a computed name.<br>✅ I scanned every removal for uses CI can't see and kept 79</li>",
    );
  });

  it("says why an unchecked item was not checked after a colon", () => {
    const fields: RiskRowFields = { ...KNIP, check: { html: "no live body read", kind: "unchecked" } };
    expect(riskRowLine({ fields, shape: "sentence" }).endsWith("<br>⚠️ Not checked: no live body read</li>")).toBe(
      true,
    );
  });

  it("renders the dotted row's exact bytes when asked for that shape", () => {
    expect(riskRowLine({ fields: KNIP, shape: "dotted" })).toBe(
      "<li><strong>Something still uses a removed package and breaks the next time someone runs it</strong> · " +
        "impact high · likelihood low · hand-run scripts, migrations, Pulumi stacks, code loaded by a computed name " +
        "· P1<br>✅ I scanned every removal for uses CI can't see and kept 79</li>",
    );
  });
});

describe("readRiskRowLine — the exact inverse, in either shape", () => {
  const variants: RiskRowFields[] = LEVELS.flatMap((likelihood) =>
    LEVELS.flatMap((impact) =>
      PRIORITIES.flatMap((priority) => [
        { ...KNIP, impact, likelihood, priority },
        { ...KNIP, check: { html: "no live body read", kind: "unchecked" }, impact, likelihood, priority },
      ]),
    ),
  );

  it("covers every level pair, priority and check kind", () => {
    expect(variants.length).toBe(90);
  });

  it.each(["sentence", "dotted"] as const)("reads every %s row back to its fields", (shape) => {
    const read = variants.map((fields) => readRiskRowLine({ line: riskRowLine({ fields, shape }) }));
    expect(read).toEqual(variants.map((fields) => ({ ...fields, shape })));
  });

  it("reads the dotted literal every old body carries", () => {
    const line =
      "<li><strong>An old body is misread</strong> · impact low · likelihood medium · old pull requests · P3<br>⚠️ No check. no live body read</li>";
    expect(readRiskRowLine({ line })).toEqual({
      check: { html: "no live body read", kind: "unchecked" },
      impact: "low",
      likelihood: "medium",
      priority: 3,
      reachHtml: "old pull requests",
      shape: "dotted",
      worstHtml: "An old body is misread",
    });
  });

  it("reads a worst carrying its own strong run", () => {
    const fields: RiskRowFields = { ...KNIP, worstHtml: "Breaks <strong>every</strong> script" };
    expect(readRiskRowLine({ line: riskRowLine({ fields, shape: "sentence" }) })).toEqual({
      ...fields,
      shape: "sentence",
    });
  });

  it("declines an odds sentence that is not one of the nine", () => {
    const line = '<li data-priority="1"><strong>Foo.</strong> Unlikely, high impact. Affects bar.<br>✅ baz</li>';
    expect(readRiskRowLine({ line })).toBe(undefined);
  });

  it("declines a line in neither shape", () => {
    expect(readRiskRowLine({ line: "<li><code>src/a.ts</code></li>" })).toBe(undefined);
  });
});
