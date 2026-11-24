/**
 * `private-terms retire` over a throwaway home: exact lines for a current and a stale proposal, the JSON record,
 * usage and absence refusals, a held lock, and never a pattern, meaning or source on any edge. Every term is synthetic.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runPrivateTermsRetire } from "../../../../../cli/commands/privateTerms/retire.js";
import { type PrivateTermsCommandDeps } from "../../../../../cli/commands/privateTerms/runSupport.js";
import { WITHHELD_REFUSAL_LINE } from "../../../../../hygiene/privateTerms.js";
import { writePrivateTerms } from "../../../../privateTermsFixture.js";
import { SEEDED_MEANING, SEEDED_PATTERN, seedPrivateTermsProposal } from "../../../../privateTermsProposalFixture.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

function freshHome({ prefix = "private-terms-retire-" }: { prefix?: string } = {}): string {
  const home = mkdtempSync(join(tmpdir(), prefix));
  homes.push(home);
  return home;
}

function depsOf(): { deps: PrivateTermsCommandDeps; out: string[]; diagnostics: string[] } {
  const out: string[] = [];
  const diagnostics: string[] = [];
  return {
    deps: {
      out: ({ line }) => {
        out.push(line);
      },
      writeDiagnostic: ({ line }) => {
        diagnostics.push(line);
      },
    },
    diagnostics,
    out,
  };
}

const argvOf = ({ rest }: { rest: readonly string[] }): readonly string[] => [
  "node",
  "slopweaver",
  "private-terms",
  "retire",
  ...rest,
];

describe("private-terms retire", () => {
  it("retires a current proposal with one line, naming no private cell", () => {
    const home = freshHome();
    writePrivateTerms({ home });
    const kept = seedPrivateTermsProposal({ home, proposalId: "pp-00000000000a", termId: "pt-00000000000a" });
    const run = depsOf();
    expect(runPrivateTermsRetire({ argv: argvOf({ rest: ["pp-00000000000a", "--home", home] }), deps: run.deps })).toBe(
      0,
    );
    expect(run.out).toStrictEqual([
      "retired: proposal pp-00000000000a to add pt-00000000000a (still current); the terms file is unchanged",
    ]);
    expect(run.diagnostics).toStrictEqual([]);
    expect(existsSync(kept)).toBe(false);
    const printed = [...run.out, ...run.diagnostics].join("\n");
    expect(printed).not.toContain(SEEDED_PATTERN);
    expect(printed).not.toContain(SEEDED_MEANING);
    expect(printed).not.toContain("relay:acme-row");
  });

  it("says stale once the terms file moved after the proposal", () => {
    const home = freshHome();
    writePrivateTerms({ home });
    seedPrivateTermsProposal({ action: "remove", home, proposalId: "pp-00000000000b", termId: "pt-00000000000b" });
    writePrivateTerms({ home, rows: ["person\ti\tinkwell\tsynthetic"] });
    const run = depsOf();
    expect(runPrivateTermsRetire({ argv: argvOf({ rest: ["pp-00000000000b", "--home", home] }), deps: run.deps })).toBe(
      0,
    );
    expect(run.out).toStrictEqual([
      "retired: proposal pp-00000000000b to remove pt-00000000000b (stale); the terms file is unchanged",
    ]);
  });

  it("prints one JSON record under --json", () => {
    const home = freshHome();
    writePrivateTerms({ home });
    seedPrivateTermsProposal({ home, proposalId: "pp-00000000000c", termId: "pt-00000000000c" });
    const run = depsOf();
    expect(
      runPrivateTermsRetire({ argv: argvOf({ rest: ["pp-00000000000c", "--home", home, "--json"] }), deps: run.deps }),
    ).toBe(0);
    expect(run.out).toStrictEqual([
      '{"action":"add","proposalId":"pp-00000000000c","stale":false,"termId":"pt-00000000000c"}',
    ]);
  });

  it("answers usage for a missing id, two ids, a malformed id and an absent proposal", () => {
    const home = freshHome();
    writePrivateTerms({ home });
    const missing = depsOf();
    expect(runPrivateTermsRetire({ argv: argvOf({ rest: ["--home", home] }), deps: missing.deps })).toBe(2);
    expect(missing.diagnostics).toStrictEqual([
      "a proposal id is required; `slopweaver private-terms list` names them",
      "usage: slopweaver private-terms retire <proposal-id> [--home <value>] [--json]",
    ]);
    const two = depsOf();
    expect(
      runPrivateTermsRetire({ argv: argvOf({ rest: ["pp-00000000000a", "pp-00000000000b"] }), deps: two.deps }),
    ).toBe(2);
    expect(two.diagnostics[0]).toBe("one proposal id at a time");
    const malformed = depsOf();
    expect(
      runPrivateTermsRetire({ argv: argvOf({ rest: ["pt-00000000000a", "--home", home] }), deps: malformed.deps }),
    ).toBe(2);
    expect(malformed.diagnostics).toStrictEqual([
      "no waiting proposal: a proposal id is pp- and twelve lowercase hex digits, as the read-back printed it",
    ]);
    const absent = depsOf();
    expect(
      runPrivateTermsRetire({ argv: argvOf({ rest: ["pp-0000000000ff", "--home", home] }), deps: absent.deps }),
    ).toBe(2);
    expect(absent.diagnostics[0]).toContain("pp-0000000000ff is not waiting");
  });

  it("exits 1 while a live process holds the lock, keeping the proposal", () => {
    const home = freshHome();
    const termsPath = writePrivateTerms({ home });
    const kept = seedPrivateTermsProposal({ home, proposalId: "pp-00000000000d", termId: "pt-00000000000d" });
    // This test's own pid is alive, so the production liveness check reads the lock as held.
    writeFileSync(`${termsPath}.lock`, `${String(process.pid)}\n`);
    const run = depsOf();
    expect(runPrivateTermsRetire({ argv: argvOf({ rest: ["pp-00000000000d", "--home", home] }), deps: run.deps })).toBe(
      1,
    );
    expect(run.diagnostics[0]).toContain("is not ours to take");
    expect(existsSync(kept)).toBe(true);
  });

  it("withholds a line carrying the home path when a term on the list matches it", () => {
    const home = freshHome({ prefix: "zephyrine-retire-" });
    const termsPath = writePrivateTerms({ home, rows: ["person\ti\tzephyrine\tsynthetic"] });
    const run = depsOf();
    expect(runPrivateTermsRetire({ argv: argvOf({ rest: ["--home", home] }), deps: run.deps })).toBe(2);
    expect(run.diagnostics).toStrictEqual([
      "a proposal id is required; `slopweaver private-terms list` names them",
      "usage: slopweaver private-terms retire <proposal-id> [--home <value>] [--json]",
    ]);
    const held = depsOf();
    writeFileSync(`${termsPath}.lock`, `${String(process.pid)}\n`);
    seedPrivateTermsProposal({ home, proposalId: "pp-00000000000e", termId: "pt-00000000000e" });
    expect(
      runPrivateTermsRetire({ argv: argvOf({ rest: ["pp-00000000000e", "--home", home] }), deps: held.deps }),
    ).toBe(1);
    expect(held.diagnostics).toStrictEqual([WITHHELD_REFUSAL_LINE]);
  });
});
