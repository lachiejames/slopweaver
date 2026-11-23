import { describe, expect, it } from "vitest";
import { isScannablePath, scanEscapeHatch, scanLaneClaims, scanReaderClaims } from "../../../devLint/escapeHatch.js";
import { JOURNALLED_IDS } from "../../../devLint/journalledIds.js";
import { ESCAPE_HATCHES } from "../../../hatch/registry.js";

describe("the escape-hatch gate", () => {
  it("refuses an env hatch with no row in the register", () => {
    const hits = scanEscapeHatch({
      content: 'const flag = process.env["SLOPWEAVER_ALLOW_MADE_UP"];',
      path: "src/outbound/thing.ts",
    });
    expect(hits.length).toBe(1);
    expect(hits[0]!.message).toContain("SLOPWEAVER_ALLOW_MADE_UP has no row");
  });

  it("accepts an ambient env hatch the register declares", () => {
    expect(
      scanEscapeHatch({ content: 'const DIRTY = "SLOPWEAVER_ALLOW_DIRTY_TREE";', path: "src/cli/thing.ts" }),
    ).toEqual([]);
  });

  it("refuses a journalled row's retired variable, because a grant is the only key that row has", () => {
    const hits = scanEscapeHatch({
      content: 'export const WALL = "SLOPWEAVER_ALLOW_WALL";',
      path: "src/outbound/thing.ts",
    });
    expect(hits.length).toBe(1);
    expect(hits[0]!.message).toContain("SLOPWEAVER_ALLOW_WALL has no row");
  });

  it("refuses a door override token with no row", () => {
    const hits = scanEscapeHatch({
      content: 'export const THING_OVERRIDE = "thing.made-up:v1";',
      path: "src/admit/thingGate.ts",
    });
    expect(hits.length).toBe(1);
    expect(hits[0]!.message).toContain('door override token "thing.made-up:v1" has no row');
  });

  it("accepts a door override token the register declares", () => {
    expect(
      scanEscapeHatch({
        content: 'export const SKILL_LOAD_OVERRIDE = "answer.skill-load:v1";',
        path: "src/admit/skillLoadGate.ts",
      }),
    ).toEqual([]);
  });

  it("refuses findings mapped into text outside the renderer", () => {
    const hits = scanEscapeHatch({
      content: "const lines = decision.findings.map((f) => `${f.summary}`);",
      path: "src/cli/commands/thing/run.ts",
    });
    expect(hits.length).toBe(1);
    expect(hits[0]!.message).toBe(
      "door refusal rendered by hand — call doorRefusalLines({ command, decision }) from src/admit/doorRefusal.ts instead, so the refusal carries its override token",
    );
  });

  it("refuses the bare verdict interpolated alone, which drops every finding and its override token", () => {
    const hits = scanEscapeHatch({
      content: "    deps.writeDiagnostic(`refused by door: ${through.decision.status}`);",
      path: "src/cli/commands/github/threadRun.ts",
    });
    const bare = scanEscapeHatch({
      content: "    return `status: ${ decision.status }`;",
      path: "src/live/turn/posterDoor.ts",
    });
    const chained = scanEscapeHatch({
      content: "  out({ line: `door decision: ${routed.decision.status.toUpperCase()}` });",
      path: "src/cli/commands/dev/door.ts",
    });
    const withArguments = scanEscapeHatch({
      content: '    deps.writeDiagnostic(`refused by door: ${through.decision.status.padStart(4, " ")}`);',
      path: "src/cli/commands/github/threadRun.ts",
    });
    const nested = scanEscapeHatch({
      content: "    deps.writeDiagnostic(`status: ${decision.status || `unknown`}`);",
      path: "src/cli/commands/dev/example.ts",
    });
    expect([hits.length, hits[0]!.criterion, bare.length, chained.length, withArguments.length, nested.length]).toEqual(
      [1, "door", 1, 1, 1, 1],
    );
  });

  it("allows a verdict compared rather than printed, and the renderer's own verdict line", () => {
    expect(
      scanEscapeHatch({
        content: '  if (decision.status === "pass") { out({ line: `${decision.statusNote}` }); }',
        path: "src/cli/commands/dev/door.ts",
      }),
    ).toEqual([]);
    expect(
      scanEscapeHatch({
        content: "    `the door did not admit this (${decision.status}). Nothing was changed.`,",
        path: "src/admit/doorRefusal.ts",
      }),
    ).toEqual([]);
  });

  it("refuses findings spread into a lines array", () => {
    const hits = scanEscapeHatch({
      content: "      ...routed.decision.findings,",
      path: "src/cli/commands/thing/run.ts",
    });
    expect(hits.length).toBe(1);
  });

  it("refuses findings iterated in a for-of outside the renderer", () => {
    const hits = scanEscapeHatch({
      content: "  for (const finding of routed.decision.findings) {",
      path: "src/cli/commands/thing/run.ts",
    });
    expect(hits.length).toBe(1);
  });

  it("allows findings mapped into a RECORD, which is a journal row rather than a message", () => {
    expect(
      scanEscapeHatch({
        content: "    findings: decision.findings.map((f) => ({ code: f.code, summary: f.summary })),",
        path: "src/admit/ledger.ts",
      }),
    ).toEqual([]);
  });

  it("allows the renderer itself to build a refusal from findings", () => {
    expect(
      scanEscapeHatch({
        content: "    ...decision.findings.flatMap((finding) => doorFindingLines({ command, finding })),",
        path: "src/admit/doorRefusal.ts",
      }),
    ).toEqual([]);
  });

  it("reads nothing out of a doc comment, so a rule can describe what it refuses", () => {
    expect(
      scanEscapeHatch({
        content: ["/**", " * There is no `SLOPWEAVER_ALLOW_REMOTE_AHEAD` override, deliberately.", " */"].join("\n"),
        path: "src/cli/commands/github/stackAdoptCore.ts",
      }),
    ).toEqual([]);
    expect(
      scanEscapeHatch({
        content: "/* never `${decision.status}` here, and no SLOPWEAVER_ALLOW_REMOTE_AHEAD either */",
        path: "src/cli/commands/github/example.ts",
      }),
    ).toEqual([]);
  });

  it("reads the code after a closed block comment on the same line", () => {
    const hits = scanEscapeHatch({
      content: "/* note */ deps.writeDiagnostic(`refused by door: ${decision . status}`);",
      path: "src/cli/commands/github/example.ts",
    });
    expect(hits.map((hit) => [hit.line, hit.criterion])).toEqual([[1, "door"]]);
    const inner = scanEscapeHatch({
      content: "/* note */ const rendered = `refused by door: ${decision /* comment */.status}`;",
      path: "src/cli/commands/github/example.ts",
    });
    expect(inner.length).toBe(1);
  });

  it("refuses the verdict read through a spaced or optional dot, or a quoted bracket", () => {
    const spaced = scanEscapeHatch({
      content: "    deps.writeDiagnostic(`refused by door: ${through.decision . status}`);",
      path: "src/cli/commands/github/example.ts",
    });
    const optional = scanEscapeHatch({
      content: "    deps.writeDiagnostic(`refused by door: ${through.decision?.status}`);",
      path: "src/cli/commands/github/example.ts",
    });
    const bracket = scanEscapeHatch({
      content: '    deps.writeDiagnostic(`refused by door: ${through.decision["status"]}`);',
      path: "src/cli/commands/github/example.ts",
    });
    const optionalBracket = scanEscapeHatch({
      content: "    deps.writeDiagnostic(`refused by door: ${through.decision?.['status']}`);",
      path: "src/cli/commands/github/example.ts",
    });
    const asserted = scanEscapeHatch({
      content: "    deps.writeDiagnostic(`refused by door: ${decision!.status}`);",
      path: "src/cli/commands/github/example.ts",
    });
    const parenthesised = scanEscapeHatch({
      content: "    deps.writeDiagnostic(`refused by door: ${(decision).status}`);",
      path: "src/cli/commands/github/example.ts",
    });
    expect([spaced, optional, bracket, optionalBracket, asserted, parenthesised].map((hits) => hits.length)).toEqual([
      1, 1, 1, 1, 1, 1,
    ]);
  });

  it("refuses a register row whose reader does not name its own key", () => {
    const hits = scanReaderClaims({ readFile: () => "a module that mentions nothing" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.message).toContain("which does not mention");
  });

  it("accepts a grant row's reader that names the row's own quoted id", () => {
    const hits = scanReaderClaims({ readFile: () => 'export const WALL_HATCH = "wall";' });
    expect(hits.some((hit) => hit.message.startsWith('hatch "wall" '))).toBe(false);
    expect(hits.some((hit) => hit.message.startsWith('hatch "voice-rules" '))).toBe(true);
  });

  it("names the quoted id as the key a grant row's reader is missing", () => {
    const hits = scanReaderClaims({ readFile: () => "a module that mentions nothing" });
    const wall = hits.find((hit) => hit.message.startsWith('hatch "wall" '))!;
    expect(wall.message).toBe(
      'hatch "wall" names reader src/outbound/slack/wallGate.ts, which does not mention "wall"',
    );
  });

  it("refuses a register row whose reader is not there at all", () => {
    const hits = scanReaderClaims({ readFile: () => undefined });
    expect(hits[0]!.message).toContain("which is not there");
  });

  it("scans production source and skips the test tree", () => {
    expect(isScannablePath({ path: "src/outbound/slack/wallGate.ts" })).toBe(true);
    expect(isScannablePath({ path: "src/__tests__/unit/admit/door.test.ts" })).toBe(false);
  });
});

describe("the lane check", () => {
  it("reports every row on the correct side of the owner's ruling", () => {
    expect(scanLaneClaims()).toEqual([]);
  });
});

describe("the journalled-id register", () => {
  it("names only rows the escape-hatch register actually declares", () => {
    const declared = new Set<string>(ESCAPE_HATCHES.map((hatch) => hatch.id));
    expect(JOURNALLED_IDS.size).toBeGreaterThan(0);
    expect([...JOURNALLED_IDS].filter((id) => !declared.has(id))).toEqual([]);
  });

  it("holds the outbound row this page's stale-snapshot door opens", () => {
    expect(JOURNALLED_IDS.has("stale-snapshot")).toBe(true);
  });
});
