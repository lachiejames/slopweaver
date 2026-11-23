/**
 * `profile guidance`'s shell over real temp directories and in-memory stores (seams, not mocks): doctrine is read
 * from the checkout root it is HANDED, so two worktrees read two doctrines, and an `AGENTS.md` that is absent or will
 * not read is drawn NOT READ, never as a doctrine with no rules.
 *
 * Per `testing.md`, every read and write goes to a directory this file minted, never the ambient home.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type GuidanceDeps,
  readAgentsDocAt,
  readGuidance,
  runProfileGuidance,
} from "../../../../../cli/commands/profile/guidanceRun.js";
import { PROFILE_GUIDANCE_USAGE } from "../../../../../cli/commands/profile/guidanceUsage.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { guidanceLines } from "../../../../../profile/guidance.js";
import { memoryAutonomyLedgerPort } from "../../../../autonomyLedgerFixture.js";
import { standingAskFake } from "../../../../standingAskFixture.js";

const NOW = "2026-11-14T00:00:00.000Z";

/** An `AGENTS.md` whose one doctrine rule carries the given title. */
const doctrineDoc = ({ title }: { title: string }): string =>
  `# Working in this repo\n\n## Operating doctrine\n\n**1 · ${title}.** Body of the rule.\n\n## Design constraints\n`;

let scratch = "";
let home = "";
let projectsDir = "";

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "sw-guidance-"));
  home = join(scratch, "home");
  projectsDir = join(scratch, "projects");
  mkdirSync(home);
  mkdirSync(projectsDir);
});

afterEach(() => {
  rmSync(scratch, { force: true, recursive: true });
});

/** Every source read from this file's own directories, doctrine from the given checkout root. */
const depsAt = ({ root }: { root: string }): GuidanceDeps => ({
  asks: standingAskFake().port,
  ledger: memoryAutonomyLedgerPort(),
  projectsDir,
  readDoctrine: () => readAgentsDocAt({ root }),
  readProfile: () => Promise.resolve({ kind: "absent" }),
});

/** A checkout root holding the given `AGENTS.md`. */
const checkoutWith = ({ name, text }: { name: string; text: string }): string => {
  const root = join(scratch, name);
  mkdirSync(root);
  writeFileSync(join(root, "AGENTS.md"), text);
  return root;
};

describe("readGuidance's doctrine", () => {
  it("reads the AGENTS.md of the checkout it is handed, so two worktrees read two doctrines", async () => {
    const alpha = checkoutWith({ name: "alpha", text: doctrineDoc({ title: "Alpha rule" }) });
    const beta = checkoutWith({ name: "beta", text: doctrineDoc({ title: "Beta rule" }) });

    const fromAlpha = await readGuidance({ deps: depsAt({ root: alpha }), home, nowIso: NOW });
    const fromBeta = await readGuidance({ deps: depsAt({ root: beta }), home, nowIso: NOW });

    expect(fromAlpha.sources[0]!.state).toEqual({
      entries: [
        {
          body: "**1 · Alpha rule.** Body of the rule.",
          citation: "AGENTS.md rule 1",
          kinds: [],
          subjectPrefix: null,
          text: "Alpha rule",
        },
      ],
      gaps: [],
      kind: "read",
    });
    expect(fromBeta.sources[0]!.state).toEqual({
      entries: [
        {
          body: "**1 · Beta rule.** Body of the rule.",
          citation: "AGENTS.md rule 1",
          kinds: [],
          subjectPrefix: null,
          text: "Beta rule",
        },
      ],
      gaps: [],
      kind: "read",
    });
  });

  it("draws a checkout with no AGENTS.md as NOT READ with the reason, never empty", async () => {
    const bare = join(scratch, "bare");
    mkdirSync(bare);

    const lines = guidanceLines({ wire: await readGuidance({ deps: depsAt({ root: bare }), home, nowIso: NOW }) });

    expect(lines[0]).toBe(
      `Doctrine (AGENTS.md): NOT READ — AGENTS.md would not read: ENOENT: no such file or directory, open '${join(bare, "AGENTS.md")}'`,
    );
    expect(lines).not.toContain("Doctrine (AGENTS.md): empty");
  });

  it("draws an AGENTS.md that is there but will not read as NOT READ, never empty", async () => {
    const odd = join(scratch, "odd");
    mkdirSync(join(odd, "AGENTS.md"), { recursive: true });

    const wire = await readGuidance({ deps: depsAt({ root: odd }), home, nowIso: NOW });
    const lines = guidanceLines({ wire });

    expect(wire.sources[0]!.state.kind).toBe("unreadable");
    expect(lines[0]).toContain("Doctrine (AGENTS.md): NOT READ — AGENTS.md would not read: EISDIR");
    expect(lines).not.toContain("Doctrine (AGENTS.md): empty");
  });
});

/** A ruling journal line placing a live gate with no expiry, as `applyRowEvent` writes one. */
const LIVE_GATE = `${JSON.stringify({
  anchor: "talk:acme-gate",
  atIso: "2026-11-01T00:00:00.000Z",
  decidedIso: "2026-11-01T00:00:00.000Z",
  gate: { subjects: ["acme-digest"], verbs: [{ noun: "recipe", verb: "run-due" }] },
  kind: "ruling",
  ruling: "stop the acme digest",
})}\n`;

/** Run `body` with `path` unreadable, restoring it after so the sandbox can be removed. */
const whileUnreadable = async ({ path, body }: { path: string; body: () => Promise<void> }): Promise<void> => {
  chmodSync(path, 0o000);
  try {
    await body();
  } finally {
    chmodSync(path, 0o755);
  }
};

describe("readGuidance's lines over a source with a part that would not read", () => {
  it("heads ruling gates as read when the journal holding a live gate reads", async () => {
    const root = checkoutWith({ name: "control", text: doctrineDoc({ title: "Alpha rule" }) });
    mkdirSync(join(home, "runs"));
    writeFileSync(join(home, "runs", "acme-row.jsonl"), LIVE_GATE);

    const lines = guidanceLines({ wire: await readGuidance({ deps: depsAt({ root }), home, nowIso: NOW }) });

    expect(lines).toContain("Ruling gates in force: 1");
  });

  it("heads ruling gates NOT READ, never empty, when that journal will not read", async () => {
    const root = checkoutWith({ name: "gated", text: doctrineDoc({ title: "Alpha rule" }) });
    mkdirSync(join(home, "runs"));
    const journal = join(home, "runs", "acme-row.jsonl");
    writeFileSync(journal, LIVE_GATE);

    await whileUnreadable({
      body: async () => {
        const lines = guidanceLines({ wire: await readGuidance({ deps: depsAt({ root }), home, nowIso: NOW }) });
        const head = lines.indexOf("Ruling gates in force: NOT READ (1)");

        expect(head).toBeGreaterThan(-1);
        expect(lines[head + 1]).toBe(`    not read: acme-row.jsonl: EACCES: permission denied, open '${journal}'`);
        expect(lines).not.toContain("Ruling gates in force: empty");
      },
      path: journal,
    });
  });

  it("heads feedback memories NOT READ, never empty, when every corpus will not read", async () => {
    const root = checkoutWith({ name: "memoried", text: doctrineDoc({ title: "Alpha rule" }) });
    const memory = join(projectsDir, "acme", "memory");
    mkdirSync(memory, { recursive: true });
    writeFileSync(join(memory, "MEMORY.md"), "- [Lead](lead.md) — lead with the discussion\n");
    writeFileSync(
      join(memory, "lead.md"),
      "---\nname: lead\ndescription: lead with the discussion\nmetadata:\n  type: feedback\n---\n\nLead with it.\n",
    );

    await whileUnreadable({
      body: async () => {
        const lines = guidanceLines({ wire: await readGuidance({ deps: depsAt({ root }), home, nowIso: NOW }) });

        expect(lines).toContain("Feedback memories: NOT READ (1)");
        expect(lines).not.toContain("Feedback memories: empty");
      },
      path: memory,
    });
  });
});

describe("runProfileGuidance", () => {
  it("answers --help with its usage line before reading anything", async () => {
    expect(PROFILE_GUIDANCE_USAGE).toBe("usage: slopweaver profile guidance [--json] [--home <dir>]");
    expect(await runProfileGuidance(["node", "slopweaver", "profile", "guidance", "--help"])).toBe(EXIT_OK);
  });

  it("refuses a flag it does not know as a usage error", async () => {
    expect(await runProfileGuidance(["node", "slopweaver", "profile", "guidance", "--bogus"])).toBe(EXIT_USAGE);
  });
});
