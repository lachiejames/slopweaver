import { describe, expect, it } from "vitest";
import { undeclaredGates } from "../../../devLint/gateRegistration.js";
import { DECLARED_LINT_GATES, LINT_GATE_DECLARATIONS, lintDeclarationFor } from "../../../devLint/refusal/registry.js";
import { gateOutcome, lintGateRefusal, lintGateRefusalLines } from "../../../devLint/refusal/render.js";
import { scanLintRefusalWrites } from "../../../devLint/refusal/scan.js";
import type { LintGateDeclaration } from "../../../devLint/refusal/types.js";
import { JUDGEMENT_NOTE } from "../../../hatch/render.js";

const DECLARATION: LintGateDeclaration = {
  caught: "an epoch is scaled into an instant by hand",
  correction: "call the seconds-to-ISO helper in the date module",
  exceptions: ["a millisecond value with no arithmetic", "a window bound, whose operator is a subtraction"],
  gate: "epoch-arithmetic",
};

describe("a lint gate's refusal", () => {
  it("emits the owner's four lines, in their order", () => {
    expect(lintGateRefusalLines({ declaration: DECLARATION, detail: "4 violations" })).toEqual([
      "Passing dev lint is blocked because the `epoch-arithmetic` gate an epoch is scaled into an instant by hand (4 violations).",
      "Legitimate exceptions may include a millisecond value with no arithmetic; a window bound, whose operator is a subtraction.",
      "There is no override for this lint gate at run time. The designated way through is to correct the source: call the seconds-to-ISO helper in the date module",
      JUDGEMENT_NOTE,
    ]);
  });

  it("refuses a RUN-TIME override rather than claiming no exemption exists at all", () => {
    const line = lintGateRefusalLines({ declaration: DECLARATION, detail: "1 violation" })[2]!;
    expect(line).toContain("no override for this lint gate at run time");
  });

  it("carries the judgement note the gate cannot word", () => {
    expect(lintGateRefusalLines({ declaration: DECLARATION, detail: "1 violation" }).at(-1)).toBe(JUDGEMENT_NOTE);
  });

  it("folds this run's own detail into the first line", () => {
    expect(lintGateRefusal({ declaration: DECLARATION, detail: "AGENTS.md at 206 lines" }).split("\n")[0]).toContain(
      "(AGENTS.md at 206 lines)",
    );
  });

  it("joins with no trailing newline, so a caller decides its own spacing", () => {
    expect(lintGateRefusal({ declaration: DECLARATION, detail: "1 violation" }).endsWith("approach.")).toBe(true);
  });
});

describe("the lint-gate declarations", () => {
  it("gives every row a non-empty exception list", () => {
    const lengths = Object.values(LINT_GATE_DECLARATIONS).map((declaration) => declaration.exceptions.length);
    expect(Math.min(...lengths)).toBeGreaterThan(0);
  });

  it("never lets a row's reason be only its own gate name", () => {
    const lazy = Object.entries(LINT_GATE_DECLARATIONS)
      .filter(([, declaration]) => declaration.caught.includes(declaration.gate))
      .map(([id]) => id);
    expect(lazy).toEqual([]);
  });

  it("derives the declared gate names without duplicates", () => {
    expect(DECLARED_LINT_GATES.length).toBe(new Set(DECLARED_LINT_GATES).size);
  });

  it("looks a row up by id", () => {
    expect(lintDeclarationFor({ id: "epoch-arithmetic" }).gate).toBe("epoch-arithmetic");
  });

  it("gives a gate with two distinct corrections a row each", () => {
    expect(lintDeclarationFor({ id: "whole-file-json" }).correction).not.toBe(
      lintDeclarationFor({ id: "whole-file-json-debt" }).correction,
    );
  });
});

describe("the hand-written-summary criterion", () => {
  it("refuses a gate that writes its own summary", () => {
    const hits = scanLintRefusalWrites({
      content: "process.stderr.write(`witness: ${String(hits.length)} violation(s):\\n`);",
      path: "src/devLint/witness.ts",
    });
    expect(hits.length).toBe(1);
    expect(hits[0]!.message).toContain("a lint summary written by hand");
  });

  it("allows an indented per-finding diagnostic, which is what the reader acts on", () => {
    expect(
      scanLintRefusalWrites({
        content: "process.stderr.write(`  ${hit.path}:${String(hit.line)}: ${hit.message}\\n`);",
        path: "src/devLint/witness.ts",
      }),
    ).toEqual([]);
  });

  it("allows the renderer's own output", () => {
    expect(
      scanLintRefusalWrites({
        content: "process.stderr.write(`${lintGateRefusal({ declaration, detail })}\\n`);",
        path: "src/devLint/witness.ts",
      }),
    ).toEqual([]);
  });

  it("allows a write the line above declares is not a refusal", () => {
    const content = [
      "// devlint: not-a-refusal -- the repository could not be discovered, so there is no verdict",
      'process.stderr.write("witness: not a git checkout\\n");',
    ].join("\n");
    expect(scanLintRefusalWrites({ content, path: "src/devLint/witness.ts" })).toEqual([]);
  });

  it("refuses a bare marker with no reason after it", () => {
    const content = ["// devlint: not-a-refusal", 'process.stderr.write("witness: something\\n");'].join("\n");
    expect(scanLintRefusalWrites({ content, path: "src/devLint/witness.ts" }).length).toBe(1);
  });

  it("leaves stdout alone, because a clean report is not a refusal", () => {
    expect(
      scanLintRefusalWrites({
        content: "process.stdout.write(`witness: clean (${String(readCount)} scanned)\\n`);",
        path: "src/devLint/witness.ts",
      }),
    ).toEqual([]);
  });

  it("reads nothing out of a comment describing the shape it refuses", () => {
    expect(
      scanLintRefusalWrites({
        content: ' * A gate used to call process.stderr.write("gate: 3 violation(s)") directly.',
        path: "src/devLint/witness.ts",
      }),
    ).toEqual([]);
  });
});

describe("the declaration parity check", () => {
  it("names a planned bespoke gate that declares nothing", () => {
    expect(
      undeclaredGates({ declaredGates: ["epoch-arithmetic"], plannedGates: ["epoch-arithmetic", "a-new-gate"] }),
    ).toEqual(["a-new-gate"]);
  });

  it("passes when every planned bespoke gate is declared", () => {
    expect(undeclaredGates({ declaredGates: ["epoch-arithmetic"], plannedGates: ["epoch-arithmetic"] })).toEqual([]);
  });

  it("never asks a third-party tool for a declaration this repository does not author", () => {
    expect(
      undeclaredGates({ declaredGates: [], plannedGates: ["biome-imports", "prettier", "oxlint", "knip"] }),
    ).toEqual([]);
  });
});

describe("the marker's own edges", () => {
  it("accepts a reason that needed two comment lines", () => {
    const content = [
      "// devlint: not-a-refusal -- a bad invocation of the runner itself, answered with usage; no gate",
      "// ran, so there is no policy verdict to refuse with",
      'process.stderr.write(`${resolved.error.join("\\n")}\\n${USAGE}\\n`);',
    ].join("\n");
    expect(scanLintRefusalWrites({ content, path: "src/devLint/witness.ts" })).toEqual([]);
  });

  it("does not let a marker reach across a blank line to a write it does not belong to", () => {
    const content = [
      "// devlint: not-a-refusal -- the repository could not be discovered",
      'process.stderr.write("witness: not a git checkout\\n");',
      "",
      "process.stderr.write(`witness: ${String(hits.length)} violation(s):\\n`);",
    ].join("\n");
    const hits = scanLintRefusalWrites({ content, path: "src/devLint/witness.ts" });
    expect(hits.length).toBe(1);
    expect(hits[0]!.line).toBe(4);
  });
});

describe("the evasion the r3 review pass found", () => {
  it("refuses a policy summary prefixed with a single space", () => {
    const hits = scanLintRefusalWrites({
      content: 'process.stderr.write(" Passing dev lint is blocked because the `witness` gate rejects this.\\n");',
      path: "src/devLint/witness.ts",
    });
    expect(hits.length).toBe(1);
  });

  it("still allows the two-space diagnostic every gate actually writes", () => {
    expect(
      scanLintRefusalWrites({
        content: "process.stderr.write(`  ${hit.path}:${String(hit.line)}: ${hit.message}\\n`);",
        path: "src/devLint/witness.ts",
      }),
    ).toEqual([]);
  });
});

describe("the wrapped-call evasion the r3 review pass found", () => {
  it("refuses a policy summary whose literal is on the next physical line", () => {
    const content = [
      "process.stderr.write(",
      '  "Passing dev lint is blocked because the `witness` gate rejects this policy state.\\n",',
      ");",
    ].join("\n");
    const hits = scanLintRefusalWrites({ content, path: "src/devLint/witness.ts" });
    expect(hits.length).toBe(1);
    expect(hits[0]!.line).toBe(1);
  });

  it("allows a WRAPPED renderer call, which is how prettier formats every converted gate", () => {
    const content = [
      "process.stderr.write(",
      "  `${lintGateRefusal({",
      '    declaration: lintDeclarationFor({ id: "epoch-arithmetic" }),',
      "    detail: `${String(hits.length)} violation(s)`,",
      "  })}\\n`,",
      ");",
    ].join("\n");
    expect(scanLintRefusalWrites({ content, path: "src/devLint/witness.ts" })).toEqual([]);
  });

  it("reports the line the CALL is on, not the line its literal wrapped onto", () => {
    const content = ["const x = 1;", "process.stderr.write(", '  "Passing dev lint is blocked.\\n",', ");"].join("\n");
    expect(scanLintRefusalWrites({ content, path: "src/devLint/witness.ts" })[0]!.line).toBe(2);
  });
});

describe("the indirect-write evasion the r3 review pass found", () => {
  it("refuses a refusal parked in a variable and written through it", () => {
    const content = [
      'const refusal = "Passing dev lint is blocked because the `witness` gate rejects this.\\n";',
      "process.stderr.write(refusal);",
    ].join("\n");
    const hits = scanLintRefusalWrites({ content, path: "src/devLint/witness.ts" });
    expect(hits.length).toBe(1);
    expect(hits[0]!.line).toBe(2);
  });

  it("allows a sink forwarding its own arrow parameter", () => {
    const content = ["write: (text) => {", "  process.stderr.write(text);", "},"].join("\n");
    expect(scanLintRefusalWrites({ content, path: "src/devLint/witness.ts" })).toEqual([]);
  });

  it("allows a sink whose parameter arrives destructured", () => {
    const content = ["writeErr: ({ text }) => {", "  process.stderr.write(text);", "},"].join("\n");
    expect(scanLintRefusalWrites({ content, path: "src/devLint/witness.ts" })).toEqual([]);
  });

  it("reads no call out of prose that happens to say write(s)", () => {
    expect(
      scanLintRefusalWrites({
        content: "  detail: `${String(hits.length)} direct stdout write(s) on the verb surface`,",
        path: "src/devLint/witness.ts",
      }),
    ).toEqual([]);
  });
});

describe("the console.error evasion the r3 review pass found", () => {
  it("refuses a policy refusal written through console.error", () => {
    const hits = scanLintRefusalWrites({
      content: 'console.error("Passing dev lint is blocked because the `witness` gate rejects this.");',
      path: "src/devLint/witness.ts",
    });
    expect(hits.length).toBe(1);
  });

  it("refuses one written through console.warn", () => {
    const hits = scanLintRefusalWrites({
      content: 'console.warn("Passing dev lint is blocked because the `witness` gate rejects this.");',
      path: "src/devLint/witness.ts",
    });
    expect(hits.length).toBe(1);
  });

  it("refuses console.error handed a variable, not just a literal", () => {
    const content = ['const refusal = "Passing dev lint is blocked.";', "console.error(refusal);"].join("\n");
    expect(scanLintRefusalWrites({ content, path: "src/devLint/witness.ts" }).length).toBe(1);
  });
});

describe("the catch-all criterion, after five spelling evasions", () => {
  it("refuses an argument wrapped in a call the scanner has never heard of", () => {
    const hits = scanLintRefusalWrites({
      content: 'process.stderr.write(Buffer.from("Passing dev lint is blocked because the gate rejects this.\\n"));',
      path: "src/devLint/witness.ts",
    });
    expect(hits.length).toBe(1);
  });

  it("refuses a template built by a helper call", () => {
    const hits = scanLintRefusalWrites({
      content: "process.stderr.write(summaryFor({ hits }));",
      path: "src/devLint/witness.ts",
    });
    expect(hits.length).toBe(1);
  });

  it("still allows the renderer call prettier wrapped across four lines", () => {
    const content = [
      "writeErr({",
      "  text: `${lintGateRefusal({",
      '    declaration: lintDeclarationFor({ id: "coverage-ratchet" }),',
      "    detail: `${String(n)} file(s)`,",
      "  })}\\n`,",
      "});",
    ].join("\n");
    expect(scanLintRefusalWrites({ content, path: "src/devLint/witness.ts" })).toEqual([]);
  });
});

describe("the blind spot this criterion does not close", () => {
  it("misses a private forwarding alias called with hand-written text, and says so in its own header", () => {
    const content = [
      "const emit: (text: string) => void = (text) => {",
      "  process.stderr.write(text);",
      "};",
      'emit("Passing dev lint is blocked because the witness gate rejects this policy state.\\n");',
    ].join("\n");
    // Pinned deliberately. Closing this needs dataflow, which a text criterion does not have — and if a
    // later change DOES close it, this test fails and the paragraph in scan.ts's header stops being true
    // at the same moment, which is the only way a stated blind spot stays honest.
    expect(scanLintRefusalWrites({ content, path: "src/devLint/witness.ts" })).toEqual([]);
  });
});

describe("the undeclared-only branch an adversarial review pass found", () => {
  it("names a registered gate that declares nothing, separately from an unrun one", () => {
    expect(undeclaredGates({ declaredGates: [], plannedGates: ["a-new-gate"] })).toEqual(["a-new-gate"]);
  });

  it("declares a refusal for that branch, so it is not an exit code with no shape", () => {
    expect(lintDeclarationFor({ id: "gate-registration-declaration" }).correction).toContain("lint-gate declarations");
  });

  it("keeps the two halves' corrections distinct, because the fixes are different", () => {
    expect(lintDeclarationFor({ id: "gate-registration" }).correction).not.toBe(
      lintDeclarationFor({ id: "gate-registration-declaration" }).correction,
    );
  });
});

describe("gateOutcome", () => {
  it("refuses only when the gate's own criterion caught something", () => {
    expect(gateOutcome({ refused: 1, unseen: 0 })).toBe("refused");
  });

  it("still refuses when the criterion caught something AND an input went unseen", () => {
    expect(gateOutcome({ refused: 1, unseen: 3 })).toBe("refused");
  });

  it("reports an unseen input as incomplete, never as a policy refusal", () => {
    expect(gateOutcome({ refused: 0, unseen: 1 })).toBe("incomplete");
  });

  it("is clean only when it saw everything and caught nothing", () => {
    expect(gateOutcome({ refused: 0, unseen: 0 })).toBe("clean");
  });
});
