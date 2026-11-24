/**
 * `private-terms list` over a throwaway home: every row by id, class and case, every readable waiting proposal marked
 * current or stale against one read of the terms file with the retire step on a stale one, the JSON document, and the
 * absent-file case still listing what waits while it exits non-zero. Never a private cell. Every term is synthetic.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runPrivateTermsList } from "../../../../../cli/commands/privateTerms/list.js";
import { type PrivateTermsCommandDeps } from "../../../../../cli/commands/privateTerms/runSupport.js";
import { writePrivateTerms } from "../../../../privateTermsFixture.js";
import { SEEDED_MEANING, SEEDED_PATTERN, seedPrivateTermsProposal } from "../../../../privateTermsProposalFixture.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "private-terms-list-"));
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
  "list",
  ...rest,
];

/** A home with one row, one proposal decided over an earlier file (stale) and one over the file as it is (current). */
function homeWithStaleAndCurrent(): string {
  const home = freshHome();
  writePrivateTerms({ home });
  seedPrivateTermsProposal({ home, proposalId: "pp-00000000000a", termId: "pt-00000000000a" });
  writePrivateTerms({ home, rows: ["person\ti\tinkwell\tsynthetic"] });
  seedPrivateTermsProposal({
    action: "narrow",
    createdAtIso: "2026-11-22T00:00:01.000Z",
    home,
    proposalId: "pp-00000000000b",
    termId: "line-2",
  });
  return home;
}

describe("private-terms list", () => {
  it("marks each waiting proposal current or stale, the stale one carrying its retire step", () => {
    const home = homeWithStaleAndCurrent();
    const run = depsOf();
    expect(runPrivateTermsList({ argv: argvOf({ rest: ["--home", home] }), deps: run.deps })).toBe(0);
    expect(run.out).toStrictEqual([
      "line-2  person  case-insensitive  refuses on a match (no meaning), names nowhere it is fine",
      "1 row(s)",
      `waiting: proposal pp-00000000000a to add pt-00000000000a, owner unanswered (stale); retire it: slopweaver private-terms retire pp-00000000000a --home ${home}`,
      "waiting: proposal pp-00000000000b to narrow line-2, owner unanswered (current)",
    ]);
    expect(run.diagnostics).toStrictEqual([]);
    const printed = run.out.join("\n");
    expect(printed).not.toContain(SEEDED_PATTERN);
    expect(printed).not.toContain(SEEDED_MEANING);
    expect(printed).not.toContain("inkwell");
  });

  it("carries stale on each waiting entry under --json", () => {
    const home = homeWithStaleAndCurrent();
    const run = depsOf();
    expect(runPrivateTermsList({ argv: argvOf({ rest: ["--home", home, "--json"] }), deps: run.deps })).toBe(0);
    expect(JSON.parse(run.out[0]!)).toStrictEqual({
      rows: [{ allowedWhere: false, caseInsensitive: true, className: "person", meaning: false, termId: "line-2" }],
      waiting: [
        {
          action: "add",
          answer: "unanswered",
          proposalId: "pp-00000000000a",
          stale: true,
          termId: "pt-00000000000a",
        },
        { action: "narrow", answer: "unanswered", proposalId: "pp-00000000000b", stale: false, termId: "line-2" },
      ],
    });
  });

  it("still lists a proposal made over no file, and still exits non-zero for the missing file", () => {
    const home = freshHome();
    seedPrivateTermsProposal({ home, proposalId: "pp-00000000000c", termId: "pt-00000000000c" });
    const run = depsOf();
    expect(runPrivateTermsList({ argv: argvOf({ rest: ["--home", home] }), deps: run.deps })).toBe(1);
    expect(run.diagnostics).toStrictEqual([
      "private-terms list: no private terms file; every write refuses until one exists",
    ]);
    expect(run.out).toStrictEqual([
      "waiting: proposal pp-00000000000c to add pt-00000000000c, owner unanswered (current)",
    ]);
  });

  it("exits non-zero with nothing waiting and no terms file", () => {
    const run = depsOf();
    expect(runPrivateTermsList({ argv: argvOf({ rest: ["--home", freshHome()] }), deps: run.deps })).toBe(1);
    expect(run.out).toStrictEqual([]);
  });
});
