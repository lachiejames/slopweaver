/**
 * `slopweaver sweep apply` driven end to end over a real handovers directory.
 *
 * The routing from a verdict to a register verb is covered in `./applyRouting.test.ts`. What this file covers
 * is the RAIL — that an act which really happened is never left unrecorded and unreported, including on the
 * one path where the register verb succeeded and the ledger append did not.
 *
 * The register verb itself is a plain fake function passed in through `SweepApplyDeps`, which is the seam
 * `.claude/rules/testing.md` allows rather than a mock: it answers an exit code and touches nothing.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runSweepApply, type SweepApplyDeps } from "../../../cli/commands/sweep/applyRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import type { PrClosure } from "../../../live/github/prClosure.js";

import { tableFetch } from "./boardRunFixture.js";

const roots: string[] = [];

/** The owner's decline an ORPHANED settle needs: the owner's words and where they said them. */
const HIS_DECLINE = ["--reason", "drop it", "--anchor", "https://example.slack.com/archives/C0/p1"] as const;

afterEach(() => {
  roots.splice(0).forEach((root) => {
    rmSync(root, { force: true, recursive: true });
  });
});

/** One board row on disk, in the front-matter shape `scanBoard` parses. */
function writeRow({
  handoverDir,
  slug,
  status,
  blockedBy = [],
}: {
  handoverDir: string;
  slug: string;
  status: string;
  blockedBy?: readonly string[];
}): void {
  writeFileSync(
    join(handoverDir, `${slug}.md`),
    `---\nslug: ${slug}\nstatus: ${status}\nsummary: "what ${slug} does"\nblockedBy: [${blockedBy.join(", ")}]\ndoneWhen: []\n---\n\n# ${slug}\n`,
    "utf8",
  );
}

/**
 * A throwaway home holding one ORPHANED row — `can-never-run` is blocked by a rejected leaf, which is the
 * cheapest fixture that classifies to a real act without needing probes or a run journal.
 */
function homeWithAnOrphan(): string {
  const root = mkdtempSync(join(tmpdir(), "sweep-apply-"));
  roots.push(root);
  const handoverDir = join(root, "handovers");
  mkdirSync(handoverDir, { recursive: true });
  mkdirSync(join(root, "runs"), { recursive: true });
  writeRow({ handoverDir, slug: "a-dead-leaf", status: "rejected" });
  writeRow({ blockedBy: ["a-dead-leaf"], handoverDir, slug: "can-never-run", status: "ready" });
  return root;
}

function capture({ exitCode, closures = new Map() }: { exitCode: number; closures?: ReadonlyMap<string, PrClosure> }): {
  deps: SweepApplyDeps;
  out: string[];
  diagnostics: string[];
  ran: string[][];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const ran: string[][] = [];
  return {
    deps: {
      nowIso: () => "2026-09-20T02:30:00.000Z",
      prClosure: () => tableFetch({ closures }),
      runRegisterVerb: ({ argv }) => {
        ran.push([...argv]);
        return Promise.resolve(exitCode);
      },
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    diagnostics,
    out,
    ran,
  };
}

describe("runSweepApply", () => {
  it("journals the act and prints where to find it once the register verb succeeds", async () => {
    const root = homeWithAnOrphan();
    const { deps, out, ran } = capture({ exitCode: EXIT_OK });
    const code = await runSweepApply({
      deps,
      rest: ["can-never-run", "--home", root, "--session", "workspace:151", ...HIS_DECLINE],
    });
    expect(code).toBe(EXIT_OK);
    expect(ran[0]!.slice(3, 11)).toEqual([
      "settle",
      "can-never-run",
      "--as",
      "declined",
      "--witness",
      "https://example.slack.com/archives/C0/p1",
      "--reason",
      "drop it",
    ]);
    expect(out[0]).toBe("sweep apply: can-never-run ORPHANED — settle, recorded as sw-20260920023000-can-never-run");
    expect(out[1]).toBe(
      "  witness: blockedBy reaches a-dead-leaf (rejected) via can-never-run -> a-dead-leaf — it can never run",
    );
    expect(out[2]).toBe("  find it: slopweaver sweep list --slug can-never-run");
  });

  it("refuses an ORPHANED decline without the owner's words and anchor before any register verb runs", async () => {
    const root = homeWithAnOrphan();
    const { deps, out, diagnostics, ran } = capture({ exitCode: EXIT_OK });
    const code = await runSweepApply({ deps, rest: ["can-never-run", "--home", root, "--session", "workspace:151"] });
    expect(code).toBe(EXIT_USAGE);
    expect(ran).toEqual([]);
    expect(out).toEqual([]);
    expect(diagnostics[0]).toContain("can-never-run is ORPHANED");
    expect(diagnostics[0]).toContain("missing --reason and --anchor");
    expect(existsSync(join(root, "ledgers"))).toBe(false);
  });

  // The rail's only real hole, and the one this asserts is closed: the register verb has already run, so the
  // board row is mutated, and the row in hand is the last surviving copy of what was taken and on what
  // evidence. `ledgers` is planted as a FILE so the append fails on every platform for the same reason —
  // a permission bit would not fail for a CI user that happens to be root.
  it("prints the row it could not write when the act landed but the ledger append failed", async () => {
    const root = homeWithAnOrphan();
    writeFileSync(join(root, "ledgers"), "not a directory\n", "utf8");
    const { deps, diagnostics } = capture({ exitCode: EXIT_OK });
    const code = await runSweepApply({
      deps,
      rest: ["can-never-run", "--home", root, "--session", "workspace:151", ...HIS_DECLINE],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics[1]).toBe(
      "sweep apply: the act happened and is NOT in the ledger — this row is the only record:",
    );
    expect(diagnostics[2]).toContain(String.raw`"slug":"can-never-run"`);
    expect(diagnostics[2]).toContain(String.raw`"verbLine":"slopweaver handover settle can-never-run --as declined`);
    expect(diagnostics[2]).toContain(String.raw`"witness":"blockedBy reaches a-dead-leaf (rejected)`);
  });

  it("writes no ledger row at all when the register verb refuses the act", async () => {
    const root = homeWithAnOrphan();
    const { deps, out, diagnostics } = capture({ exitCode: EXIT_ERROR });
    const code = await runSweepApply({
      deps,
      rest: ["can-never-run", "--home", root, "--session", "workspace:151", ...HIS_DECLINE],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
    expect(diagnostics[0]).toContain("slopweaver handover settle can-never-run");
    expect(diagnostics).toHaveLength(1);
  });

  it("refuses a verdict that carries no act rather than inventing one", async () => {
    const root = homeWithAnOrphan();
    const { deps, diagnostics, ran } = capture({ exitCode: EXIT_OK });
    const code = await runSweepApply({ deps, rest: ["a-dead-leaf", "--home", root, "--session", "workspace:151"] });
    expect(code).toBe(EXIT_ERROR);
    expect(ran).toEqual([]);
    expect(diagnostics[0]).toContain("a-dead-leaf");
  });
});
