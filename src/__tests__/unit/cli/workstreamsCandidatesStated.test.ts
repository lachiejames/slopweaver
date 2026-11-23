/**
 * `workstreams candidates` on a home where nothing has been mined or kept: the owner's stated outcomes, read from the
 * home's `workstreams/stated-candidates.json`, are still candidates to keep or drop, a home with none lists none, and
 * listing writes nothing.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runWorkstreamsCandidates } from "../../../cli/commands/workstreams/candidates.js";
import { EXIT_OK } from "../../../cli/exitCodes.js";
import { SYNTHETIC_STATED, writeStatedCandidatesFile } from "../../statedCandidatesFixture.js";
import { inMemoryWorkstreamStore } from "../../workstreamStoreFake.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** A throwaway home — never the ambient one. */
function scratch(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-ws-stated-"));
  homes.push(home);
  return home;
}

/** The fields of the listing document these cases read. */
interface ListedDocument {
  readonly candidates: { id: string }[];
  readonly counts: { unanswered: number };
  readonly mined: unknown;
  readonly registerExists: boolean;
}

/** One `workstreams candidates --json` run over `home`, its exit, its diagnostics and its parsed document. */
async function listed({
  home,
}: {
  home: string;
}): Promise<{ exit: number; diagnostics: readonly string[]; document: ListedDocument }> {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const exit = await runWorkstreamsCandidates({
    deps: {
      store: inMemoryWorkstreamStore({ nowIso: "2026-11-10T00:00:00.000Z" }),
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: (line) => out.push(line),
    },
    rest: ["--home", home, "--json"],
  });
  return { diagnostics, document: JSON.parse(out[0]!) as ListedDocument, exit };
}

describe("workstreams candidates before any mine", () => {
  it("lists the owner's stated outcomes, unanswered, with no provenance and nothing written", async () => {
    const home = scratch();
    writeStatedCandidatesFile({ home });

    const { exit, diagnostics, document } = await listed({ home });

    expect([exit, diagnostics]).toEqual([EXIT_OK, []]);
    expect(document.candidates.map((one) => one.id)).toEqual(SYNTHETIC_STATED.map((one) => one.id));
    expect([document.counts.unanswered, document.mined, document.registerExists]).toEqual([
      SYNTHETIC_STATED.length,
      null,
      false,
    ]);
    expect(readdirSync(join(home, "workstreams"))).toEqual(["stated-candidates.json"]);
  });

  it("lists no candidate on a home with no stated outcome either, and writes nothing", async () => {
    const home = scratch();

    const { exit, diagnostics, document } = await listed({ home });

    expect([exit, diagnostics]).toEqual([EXIT_OK, []]);
    expect([document.candidates, document.counts.unanswered, document.mined]).toEqual([[], 0, null]);
    expect(existsSync(join(home, "workstreams"))).toBe(false);
  });
});
