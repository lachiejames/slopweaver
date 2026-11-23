import { describe, expect, it } from "vitest";
import {
  COGNITIVE_COMPLEXITY_LIMIT,
  isScannablePath,
  scanCognitiveComplexity,
} from "../../../devLint/cognitiveComplexity.js";

/** The single hit `scanCognitiveComplexity` should report for a one-function fixture. */
function complexityOf({ content, limit = 0 }: { content: string; limit?: number }): number {
  const hits = scanCognitiveComplexity({ content, limit, path: "src/x.ts" });
  expect(hits).toHaveLength(1);
  return hits[0]!.complexity;
}

describe("scanCognitiveComplexity — structural increments", () => {
  it("a single if costs 1", () => {
    expect(complexityOf({ content: "function f(a) { if (a) { g(); } }" })).toBe(1);
  });

  it("a nested if costs 1 + (1 + nesting) = 3", () => {
    const content = "function f(a, b) { if (a) { if (b) { g(); } } }";
    expect(complexityOf({ content })).toBe(3);
  });

  it("if / else if / else costs 1 + 1 + 1 = 3, siblings don't stack nesting", () => {
    const content = "function f(a, b) { if (a) { g(); } else if (b) { h(); } else { i(); } }";
    expect(complexityOf({ content })).toBe(3);
  });

  it("a for/while/do-while/switch/catch each cost 1 at top level", () => {
    expect(complexityOf({ content: "function f(xs) { for (const x of xs) { g(x); } }" })).toBe(1);
    expect(complexityOf({ content: "function f(a) { while (a) { g(); } }" })).toBe(1);
    expect(complexityOf({ content: "function f(a) { do { g(); } while (a); }" })).toBe(1);
    expect(complexityOf({ content: "function f(a) { switch (a) { case 1: g(); break; } }" })).toBe(1);
    expect(complexityOf({ content: "function f() { try { g(); } catch (e) { h(); } }" })).toBe(1);
  });

  it("a loop nested inside an if costs 1 + (1 + 1) = 3", () => {
    const content = "function f(a, xs) { if (a) { for (const x of xs) { g(x); } } }";
    expect(complexityOf({ content })).toBe(3);
  });

  it("a ternary costs 1, nested one deeper costs 1 + 2", () => {
    expect(complexityOf({ content: "function f(a) { return a ? 1 : 0; }" })).toBe(1);
    const nested = "function f(a, b) { return a ? (b ? 1 : 2) : 0; }";
    expect(complexityOf({ content: nested })).toBe(3);
  });
});

describe("scanCognitiveComplexity — logical operator runs (matches this repo's pinned eslint-plugin-sonarjs exactly)", () => {
  it("a run of && costs 1 regardless of length", () => {
    expect(complexityOf({ content: "function f(a, b, c) { return a && b && c; }" })).toBe(1);
  });

  it("a run of || costs NOTHING — this plugin never charges || or ??, only &&", () => {
    expect(complexityOf({ content: "function f(a, b, c) { return a || b || c; }", limit: -1 })).toBe(0);
    expect(complexityOf({ content: "function f(a, b) { return a ?? b; }", limit: -1 })).toBe(0);
  });

  it("`a && b || c` costs 1 — the && run charges once, the || never charges", () => {
    expect(complexityOf({ content: "function f(a, b, c) { return a && b || c; }" })).toBe(1);
  });

  it("`a || b && c` costs 1 — entering && from || starts a new (charged) run", () => {
    expect(complexityOf({ content: "function f(a, b, c) { return a || b && c; }" })).toBe(1);
  });

  it("two separate && runs joined by || cost 2, one per run", () => {
    const content = "function f(a, b, c, d, e) { return a && b && c || d && e; }";
    expect(complexityOf({ content })).toBe(2);
  });

  it("a || condition inside an if adds nothing beyond the if's own cost", () => {
    expect(complexityOf({ content: "function f(a, b) { if (a || b) { g(); } }" })).toBe(1);
  });
});

describe("scanCognitiveComplexity — jumps", () => {
  it("a bare break/continue costs nothing", () => {
    const content = "function f(xs) { for (const x of xs) { if (x) { break; } continue; } }";
    // for (1) + if nested inside it (1 + 1) = 3; bare break/continue add 0.
    expect(complexityOf({ content })).toBe(3);
  });

  it("a labelled break costs 1 (for:1 + nested if:2 + break:1 = 4)", () => {
    const content = "function f(xs) { outer: for (const x of xs) { if (x) { break outer; } } }";
    expect(complexityOf({ content })).toBe(4);
  });
});

describe("scanCognitiveComplexity — no recursion charge (this repo's pinned plugin has none)", () => {
  it("a function calling its own name is not charged for it", () => {
    expect(complexityOf({ content: "function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }" })).toBe(1);
  });
});

describe("scanCognitiveComplexity — nested functions score independently", () => {
  it("a nested arrow's own branching does not inflate the outer function's score", () => {
    const content = "function outer(xs) { return xs.map((x) => (x ? 1 : 0)); }";
    // limit -1 so even a 0-complexity function is reported, to inspect outer's own score directly.
    const hits = scanCognitiveComplexity({ content, limit: -1, path: "src/x.ts" });
    expect(hits.map((h) => h.name).toSorted()).toEqual(["(anonymous)", "outer"]);
    expect(hits.find((h) => h.name === "outer")!.complexity).toBe(0);
    expect(hits.find((h) => h.name === "(anonymous)")!.complexity).toBe(1);
  });
});

describe("scanCognitiveComplexity — limit and reporting", () => {
  it("COGNITIVE_COMPLEXITY_LIMIT is 12", () => {
    expect(COGNITIVE_COMPLEXITY_LIMIT).toBe(12);
  });

  it("does not report a function at or below the limit", () => {
    expect(
      scanCognitiveComplexity({ content: "function f(a) { if (a) { g(); } }", limit: 1, path: "src/x.ts" }),
    ).toEqual([]);
  });

  it("reports a function's name and start line", () => {
    const content = ["function bad(a, b) {", "  if (a) {", "    if (b) {", "      g();", "    }", "  }", "}"].join(
      "\n",
    );
    const hits = scanCognitiveComplexity({ content, limit: 1, path: "src/x.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({ complexity: 3, name: "bad", path: "src/x.ts", startLine: 1 });
  });

  it("does not count a matching keyword inside a comment or string (real AST, not text)", () => {
    const content = ["function f() {", "  // if (a) { if (b) { g(); } }", '  const s = "if (a) {}";', "}"].join("\n");
    expect(scanCognitiveComplexity({ content, limit: 0, path: "src/x.ts" })).toEqual([]);
  });
});

describe("isScannablePath", () => {
  it("accepts a .ts file under src/, eval/ or hooks/", () => {
    expect(isScannablePath({ path: "src/cli/commands/distil/run.ts" })).toBe(true);
    expect(isScannablePath({ path: "eval/scoreboardRun.ts" })).toBe(true);
    expect(isScannablePath({ path: "hooks/pretooluse-main-checkout-dirty-guard.ts" })).toBe(true);
  });

  it("rejects a path outside those trees, and this gate's own sources", () => {
    expect(isScannablePath({ path: "eslint.config.js" })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/cognitiveComplexity.ts" })).toBe(false);
  });
});
