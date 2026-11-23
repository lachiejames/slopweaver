import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runSweepList, type SweepListDeps } from "../../../cli/commands/sweep/listRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { unwrap } from "../../../lib/result.js";
import type { SweepJournalRow } from "../../../sweep/journalRow.js";
import { appendSweepRow, sweepLedgerPath } from "../../../sweep/journalStore.js";

const dirs: string[] = [];

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "sweep-list-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});
/** The ledger row every case starts from — one performed `close`, as `sweep apply` would have written it. */
const DEFAULT_ROW: SweepJournalRow = {
  act: "close",
  atIso: "2026-09-19T12:04:05.000Z",
  id: "sw-20260919120405-some-row",
  path: "/h/some-row.md",
  session: "workspace:151",
  slug: "some-row",
  verbLine: "slopweaver handover close some-row --summary the work is in",
  verdict: "SHIPPED",
  witness: "all 1 declared probe(s) pass against the tree",
};

/**
 * One ledger row. Overriding the slug re-derives the path and the verb line from it, because a row whose verb
 * line names a different slug than the row does could never have been written by `sweep apply`.
 */
function row(over: Partial<SweepJournalRow> = {}): SweepJournalRow {
  const merged = { ...DEFAULT_ROW, ...over };
  if (over.slug === undefined || over.verbLine !== undefined) {
    return merged;
  }
  return {
    ...merged,
    path: `/h/${over.slug}.md`,
    verbLine: `slopweaver handover close ${over.slug} --summary the work is in`,
  };
}

function capture(): { deps: SweepListDeps; out: string[]; diagnostics: string[] } {
  const out: string[] = [];
  const diagnostics: string[] = [];
  return {
    deps: {
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    diagnostics,
    out,
  };
}

describe("runSweepList", () => {
  it("says plainly that nothing has been swept, rather than printing an empty list", () => {
    const { deps, out } = capture();
    expect(runSweepList({ deps, rest: ["--home", home()] })).toBe(EXIT_OK);
    expect(out).toEqual(["sweep list: no acts recorded."]);
  });

  it("prints every act, newest last, with the verb line and the witness", () => {
    const dir = home();
    const path = sweepLedgerPath({ home: dir });
    expect(unwrap(appendSweepRow({ path, row: row({ id: "sw-1", slug: "first-row" }) }))).toBe(true);
    expect(unwrap(appendSweepRow({ path, row: row({ id: "sw-2", slug: "second-row" }) }))).toBe(true);
    const { deps, out } = capture();
    expect(runSweepList({ deps, rest: ["--home", dir] })).toBe(EXIT_OK);
    expect(out[0]).toBe("sweep list: 2 act(s)");
    expect(out[1]).toContain("sw-1");
    expect(out[1]).toContain("slopweaver handover close first-row");
    expect(out[2]).toContain("sw-2");
  });

  it("narrows to one row's history when --slug names one", () => {
    const dir = home();
    const path = sweepLedgerPath({ home: dir });
    expect(unwrap(appendSweepRow({ path, row: row({ id: "sw-1", slug: "first-row" }) }))).toBe(true);
    expect(unwrap(appendSweepRow({ path, row: row({ id: "sw-2", slug: "second-row" }) }))).toBe(true);
    const { deps, out } = capture();
    expect(runSweepList({ deps, rest: ["--home", dir, "--slug", "second-row"] })).toBe(EXIT_OK);
    expect(out[0]).toBe("sweep list: 1 act(s)");
    expect(out[1]).toContain("second-row");
  });

  it("emits one JSON object per act under --json", () => {
    const dir = home();
    expect(unwrap(appendSweepRow({ path: sweepLedgerPath({ home: dir }), row: row() }))).toBe(true);
    const { deps, out } = capture();
    expect(runSweepList({ deps, rest: ["--home", dir, "--json"] })).toBe(EXIT_OK);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain(String.raw`"verbLine":"slopweaver handover close some-row --summary the work is in"`);
  });

  it("refuses an unknown flag as a caller mistake, before reading anything", () => {
    const { deps, diagnostics } = capture();
    expect(runSweepList({ deps, rest: ["--nope"] })).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toBe("unknown flag: --nope");
  });

  it("prints its own usage on --help and reads no ledger", () => {
    const { deps, out } = capture();
    expect(runSweepList({ deps, rest: ["--help"] })).toBe(EXIT_OK);
    expect(out[0]).toContain("usage: slopweaver sweep list");
  });
});
