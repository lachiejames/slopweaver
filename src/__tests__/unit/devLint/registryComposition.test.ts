/**
 * The registration tables that were split along a family seam, and the property every such split has to
 * keep: every row is defined ONCE, and the aggregate every consumer already imports still answers for all
 * of them. The declaration table is six leaves (quality, contract, source shape, claim, reach, harness), so
 * the cases below are a shape to copy rather than a one-off.
 *
 * A key count alone is deliberately not the test. An object spread can overwrite a row while leaving a
 * plausible count behind, so each case names the exact row it expects and where that row is defined, and
 * the last block asserts the leaves share no key at all.
 */
import { describe, expect, it } from "vitest";
import { DEV_TOOLING_SEAMS } from "../../../admit/sanctionedDevTooling.js";
import { SANCTIONED_SEAMS } from "../../../admit/sanctionedSeams.js";
import { CLAIM_LINT_GATE_DECLARATIONS } from "../../../devLint/refusal/claimDeclarations.js";
import { CONTRACT_LINT_GATE_DECLARATIONS } from "../../../devLint/refusal/contractDeclarations.js";
import { LINT_GATE_DECLARATIONS } from "../../../devLint/refusal/declarations.js";
import { HARNESS_LINT_GATE_DECLARATIONS } from "../../../devLint/refusal/harnessDeclarations.js";
import { QUALITY_LINT_GATE_DECLARATIONS } from "../../../devLint/refusal/qualityDeclarations.js";
import { REACH_LINT_GATE_DECLARATIONS } from "../../../devLint/refusal/reachDeclarations.js";
import { SOURCE_SHAPE_LINT_GATE_DECLARATIONS } from "../../../devLint/refusal/sourceShapeDeclarations.js";

/** The gates `gateGroups.ts`'s `qualityRatchets` runs — the family the declaration leaf was cut along. */
const QUALITY_GATES: ReadonlySet<string> = new Set([
  "baseline-against-main",
  "duplicate-windows",
  "file-size-ratchet",
  "internal-exports",
  "test-enshittification",
  "untested-modules",
]);

describe("quality declarations leaf", () => {
  it("is not empty, so every assertion below is about a real table", () => {
    expect(Object.keys(QUALITY_LINT_GATE_DECLARATIONS).length).toBeGreaterThan(0);
  });

  it("holds only rows whose gate is in the quality-ratchet family", () => {
    const strays = Object.values(QUALITY_LINT_GATE_DECLARATIONS)
      .map((row) => row.gate)
      .filter((gate) => !QUALITY_GATES.has(gate));
    expect(strays).toEqual([]);
  });

  it("holds EVERY refusal id of each family gate, so no gate's rows are split across two files", () => {
    const elsewhere = Object.entries(LINT_GATE_DECLARATIONS)
      .filter(([id]) => !(id in QUALITY_LINT_GATE_DECLARATIONS))
      .filter(([, row]) => QUALITY_GATES.has(row.gate))
      .map(([id]) => id);
    expect(elsewhere).toEqual([]);
  });

  it("is composed into the aggregate by value, not by a copy that could drift", () => {
    for (const [id, row] of Object.entries(QUALITY_LINT_GATE_DECLARATIONS)) {
      expect(LINT_GATE_DECLARATIONS[id as keyof typeof LINT_GATE_DECLARATIONS]).toBe(row);
    }
  });

  it("answers the file-size regression row through the aggregate, exactly as before the split", () => {
    expect(LINT_GATE_DECLARATIONS["file-size-ratchet"]).toEqual({
      caught: "a file grew past its recorded size, and a file nobody can hold in their head is one nobody reviews",
      correction:
        "split it along a real seam, and a test file by scenario or describe block into sibling files, never by moving a flow's steps into helpers; oversized files are always split",
      exceptions: [
        "a generated file, which carries the generated leading comment and is not edited by hand",
        "a non-test file carrying the exemption marker AND a row in the committed tradeoff register that names the tradeoff and the anchor of the owner's yes",
      ],
      gate: "file-size-ratchet",
    });
  });
});

describe("dev-tooling seams leaf", () => {
  it("is not empty, so every assertion below is about a real table", () => {
    expect(Object.keys(DEV_TOOLING_SEAMS).length).toBeGreaterThan(0);
  });

  it("classifies every row it holds as dev-tooling and nothing else", () => {
    const strays = Object.values(DEV_TOOLING_SEAMS).filter((seam) => seam !== "dev-tooling");
    expect(strays).toEqual([]);
  });

  it("holds EVERY dev-tooling row, so the class is not split across two files", () => {
    const elsewhere = Object.entries(SANCTIONED_SEAMS)
      .filter(([path]) => !(path in DEV_TOOLING_SEAMS))
      .filter(([, seam]) => seam === "dev-tooling")
      .map(([path]) => path);
    expect(elsewhere).toEqual([]);
  });

  it("is composed into the aggregate, so the scan that reads the aggregate still sees each row", () => {
    for (const path of Object.keys(DEV_TOOLING_SEAMS)) {
      expect(SANCTIONED_SEAMS[path]).toBe("dev-tooling");
    }
  });

  it("carries the file-size ratchet's own module, which the scan resolves through the aggregate", () => {
    expect(DEV_TOOLING_SEAMS["src/devLint/fileSizeRatchet.ts"]).toBe("dev-tooling");
    expect(SANCTIONED_SEAMS["src/devLint/fileSizeRatchet.ts"]).toBe("dev-tooling");
  });

  it("leaves a seam of another class where it was — the split moved one class, not the table", () => {
    expect(SANCTIONED_SEAMS["src/devLint/boundaryResidue.ts"]).toBe("read-only-tool");
    expect("src/devLint/boundaryResidue.ts" in DEV_TOOLING_SEAMS).toBe(false);
  });
});

/** The gates `gateGroups.ts`'s `contractRatchets` runs — the second family the declaration leaf was cut along. */
const CONTRACT_GATES: ReadonlySet<string> = new Set([
  "ci-offload-contract",
  "ambient-heap-ceiling",
  "ci-trigger-contract",
  "heap-ceiling-ratchet",
  "hook-bounded",
  "help-flag-opt-out",
  "coverage-ratchet",
  "door-coverage",
  "derived-card-voice",
  "escape-hatch",
  "hatch-release",
  "tsc-heap-contract",
  "typescript-pin",
]);

describe("contract declarations leaf", () => {
  it("is not empty, so every assertion below is about a real table", () => {
    expect(Object.keys(CONTRACT_LINT_GATE_DECLARATIONS).length).toBeGreaterThan(0);
  });

  it("holds only rows whose gate is in the contract-ratchet family", () => {
    const strays = Object.values(CONTRACT_LINT_GATE_DECLARATIONS)
      .map((row) => row.gate)
      .filter((gate) => !CONTRACT_GATES.has(gate));
    expect(strays).toEqual([]);
  });

  it("holds EVERY refusal id of each family gate, so no gate's rows are split across two files", () => {
    const elsewhere = Object.entries(LINT_GATE_DECLARATIONS)
      .filter(([id]) => !(id in CONTRACT_LINT_GATE_DECLARATIONS))
      .filter(([, row]) => CONTRACT_GATES.has(row.gate))
      .map(([id]) => id);
    expect(elsewhere).toEqual([]);
  });

  it("is composed into the aggregate by value, not by a copy that could drift", () => {
    for (const [id, row] of Object.entries(CONTRACT_LINT_GATE_DECLARATIONS)) {
      expect(LINT_GATE_DECLARATIONS[id as keyof typeof LINT_GATE_DECLARATIONS]).toBe(row);
    }
  });

  it("answers the ambient heap ceiling row through the aggregate, which is the gate that forced this cut", () => {
    expect(LINT_GATE_DECLARATIONS["ambient-heap-ceiling"].gate).toBe("ambient-heap-ceiling");
    expect(LINT_GATE_DECLARATIONS["ambient-heap-ceiling"].caught).toContain("AMBIENT heap ceiling");
  });

  it("shares no refusal id with the quality leaf, so the two cuts do not overlap", () => {
    const both = Object.keys(CONTRACT_LINT_GATE_DECLARATIONS).filter((id) => id in QUALITY_LINT_GATE_DECLARATIONS);
    expect(both).toEqual([]);
  });

  it("holds the compiler heap contract, which `contractRatchets` registers", () => {
    expect(CONTRACT_LINT_GATE_DECLARATIONS["tsc-heap-contract"].gate).toBe("tsc-heap-contract");
    expect(LINT_GATE_DECLARATIONS["tsc-heap-contract"]).toBe(CONTRACT_LINT_GATE_DECLARATIONS["tsc-heap-contract"]);
  });
});

/*
 * The four leaves cut by gate family when the table outgrew the 300-code-line cap. Each is described by the
 * gates it answers for, so a row filed in the wrong leaf, or a gate's refusal ids split across two leaves,
 * fails by name.
 */
const FAMILY_LEAVES: readonly {
  readonly gates: ReadonlySet<string>;
  readonly name: string;
  readonly rows: Readonly<Record<string, { readonly gate: string }>>;
}[] = [
  {
    gates: new Set([
      "boundary-schema",
      "cli-command-boundary",
      "cognitive-complexity",
      "control-bytes",
      "epoch-arithmetic",
      "error-shape-threshold",
      "hand-rolled-result",
      "house-rules",
      "jsdoc-tags",
      "max-function-lines",
      "named-object-params",
      "no-nested-ternaries",
      "no-silent-fallback",
      "outbound-form-strict",
      "primitive-ratchet",
      "redos-check",
      "runtime-dependencies",
      "typescript-import-seam",
      "unbounded-spread",
      "whole-file-json",
    ]),
    name: "source shape",
    rows: SOURCE_SHAPE_LINT_GATE_DECLARATIONS,
  },
  {
    gates: new Set([
      "agent-doc-size",
      "app-copy-voice",
      "atlas-content-coverage",
      "atlas-manifest-clock",
      "authored-separator",
      "command-meta-residue",
      "command-trigger",
      "console-loading-prose",
      "doc-counts",
      "doc-links",
      "forbidden-identifiers",
      "host-wording",
      "legacy-vocabulary",
      "manifest-loader-tests",
      "naming-doctrine",
      "own-hand-residue",
      "register-bindings",
      "register-hygiene",
      "retired-claude-transport",
      "secrets-registry",
      "transient-references",
    ]),
    name: "claim",
    rows: CLAIM_LINT_GATE_DECLARATIONS,
  },
  {
    gates: new Set([
      "boundary-residue",
      "claude-email-not-identity",
      "console-verb-binary",
      "linear-sdk-documents",
      "no-headless",
      "no-private-browser-profile",
      "no-python",
      "operation-labels",
      "outbound-privacy-closure",
      "resilience-residue",
      "running-checkout-root",
      "scheduler-bypass",
      "session-harness-lifecycle",
      "stdout-data-channel",
      "sync-child-timeout",
      "torn-tail-append",
      "unexpanded-plugin-root",
    ]),
    name: "reach",
    rows: REACH_LINT_GATE_DECLARATIONS,
  },
  {
    gates: new Set([
      "dev lint",
      "drizzle-migrations",
      "gate-registration",
      "git-in-tests",
      "home-safety",
      "no-proof-path",
      "store-journal-anchor",
      "testing-discipline",
      "unnamed-failure-assertion",
    ]),
    name: "harness",
    rows: HARNESS_LINT_GATE_DECLARATIONS,
  },
];

describe.each(FAMILY_LEAVES)("$name declarations leaf", ({ gates, rows }) => {
  it("is not empty, so every assertion below is about a real table", () => {
    expect(Object.keys(rows).length).toBeGreaterThan(0);
  });

  it("holds only rows whose gate is in its own family", () => {
    const strays = Object.values(rows)
      .map((row) => row.gate)
      .filter((gate) => !gates.has(gate));
    expect(strays).toEqual([]);
  });

  it("holds EVERY refusal id of each family gate, so no gate's rows are split across two files", () => {
    const elsewhere = Object.entries(LINT_GATE_DECLARATIONS)
      .filter(([id]) => !(id in rows))
      .filter(([, row]) => gates.has(row.gate))
      .map(([id]) => id);
    expect(elsewhere).toEqual([]);
  });

  it("is composed into the aggregate by value, not by a copy that could drift", () => {
    for (const [id, row] of Object.entries(rows)) {
      expect(LINT_GATE_DECLARATIONS[id as keyof typeof LINT_GATE_DECLARATIONS]).toBe(row);
    }
  });
});

describe("the composed declaration table", () => {
  const LEAF_KEYS = [
    CONTRACT_LINT_GATE_DECLARATIONS,
    QUALITY_LINT_GATE_DECLARATIONS,
    SOURCE_SHAPE_LINT_GATE_DECLARATIONS,
    CLAIM_LINT_GATE_DECLARATIONS,
    REACH_LINT_GATE_DECLARATIONS,
    HARNESS_LINT_GATE_DECLARATIONS,
  ].flatMap((leaf) => Object.keys(leaf));

  it("defines every refusal id in exactly one leaf, since a spread overwrites a duplicate silently", () => {
    expect(LEAF_KEYS.length).toBeGreaterThan(0);
    expect(LEAF_KEYS.length).toBe(new Set(LEAF_KEYS).size);
  });

  it("is the six leaves spread in order, contiguously and with nothing else", () => {
    expect(Object.keys(LINT_GATE_DECLARATIONS)).toEqual(LEAF_KEYS);
  });

  it("answers a row from each new leaf through the aggregate, unchanged", () => {
    expect(LINT_GATE_DECLARATIONS["jsdoc-tags"].gate).toBe("jsdoc-tags");
    expect(LINT_GATE_DECLARATIONS["doc-links-tree"].gate).toBe("doc-links");
    expect(LINT_GATE_DECLARATIONS["sync-child-timeout-debt"].gate).toBe("sync-child-timeout");
    expect(LINT_GATE_DECLARATIONS["drizzle-migrations-rls"].gate).toBe("drizzle-migrations");
  });
});
