/**
 * The below-the-fold half of the voice check: which rules run there, and what bounds the output.
 *
 * The aggregation test is the blast-radius measurement, pinned. Reproduce the raw count with
 * `grep -h '—' docs/recurring-failure-register.md docs/recurring-failure-register/*.md | wc -l`; what
 * matters here is that a rule firing many times is ONE warning, because 169 lines is the wall of text rule 7
 * bans.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { aboveFoldFindings, belowFoldFindings } from "../../../../outbound/voice/aboveFold.js";
import type { ExactVoiceRule } from "../../../../outbound/voice/exactRules.js";
import { REGISTER_PAGES } from "../../../../reflect/registerPages.js";

// register-class: voice-rules-run-late-and-only-on-one-lane (docs/recurring-failure-register/bindings.md)

const EM_DASH: ExactVoiceRule = { kind: "literal", value: "—" };
const LEVERAGE: ExactVoiceRule = { kind: "word", value: "leverage" };

describe("belowFoldFindings", () => {
  it("finds a vocabulary rule in prose no above-the-fold cell ever contained", () => {
    const findings = belowFoldFindings({
      cells: [{ path: "detail[0]", text: "the pool exhausted — overnight" }],
      rules: [EM_DASH],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("voice-rule-below-fold");
    expect(findings[0]!.path).toBe("detail[0]");
    expect(findings[0]!.message).toContain("in 1 below-the-fold region(s)");
  });

  it("reports ONE finding for a rule that fires across many regions, naming the width and the first field", () => {
    const findings = belowFoldFindings({
      cells: [
        { path: "detail[0]", text: "one — two — three" },
        { path: "detail[1]", text: "four — five" },
        { path: "detail[2]", text: "six — seven" },
      ],
      rules: [EM_DASH],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.path).toBe("detail[0]");
    expect(findings[0]!.message).toContain("in 3 below-the-fold region(s)");
  });

  it("counts a multi-line cell one region per line, which is what the register measurement counts", () => {
    const findings = belowFoldFindings({
      cells: [{ path: "body", text: "one — two\nthree — four\nfive is clean" }],
      rules: [EM_DASH],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.path).toBe("body.line[0]");
    expect(findings[0]!.message).toContain("in 2 below-the-fold region(s)");
  });

  it("aggregates this repository's own register to one line per rule, not one per match", () => {
    const text = REGISTER_PAGES.map((page) => readFileSync(page.path, "utf8")).join("\n");
    const findings = belowFoldFindings({ cells: [{ path: "register", text }], rules: [EM_DASH] });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("below-the-fold region(s)");
  });

  it("never runs the structural packing rules, which are about deciding whether to expand", () => {
    const packed = { path: "detail[0]", text: "three broke: the pool, the queue, and the cache; badly." };
    expect(belowFoldFindings({ cells: [packed], rules: [] })).toStrictEqual([]);
    expect(aboveFoldFindings({ cells: [packed], rules: [] }).map((f) => f.code)).toStrictEqual([
      "colon-list",
      "semicolon-clauses",
    ]);
  });

  it("reads authored prose only, so a fenced code block and a quoted line are exempt", () => {
    const text = ["```", "const a = b — c;", "```", "> they wrote — this", "mine is clean"].join("\n");
    expect(belowFoldFindings({ cells: [{ path: "detail[0]", text }], rules: [EM_DASH] })).toStrictEqual([]);
  });

  it("finds each distinct rule once, in the order the rules first fired", () => {
    const findings = belowFoldFindings({
      cells: [{ path: "detail[0]", text: "we leverage it — badly, and leverage it again" }],
      rules: [EM_DASH, LEVERAGE],
    });
    expect(findings.map((finding) => finding.path)).toStrictEqual(["detail[0]", "detail[0]"]);
    expect(findings[0]!.message).toContain('literal voice rule "—" in 1');
    expect(findings[1]!.message).toContain('word voice rule "leverage" in 1');
  });

  it("finds nothing when no rules are configured, so an operator with no profile sees no warnings", () => {
    expect(belowFoldFindings({ cells: [{ path: "detail[0]", text: "a — b" }], rules: [] })).toStrictEqual([]);
  });

  it("finds nothing in an empty cell set", () => {
    expect(belowFoldFindings({ cells: [], rules: [EM_DASH] })).toStrictEqual([]);
  });
});
