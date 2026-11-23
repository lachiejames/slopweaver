/**
 * `fleet landed`'s argument parsing and its run against injected seams: the default window and refs, `--ref`
 * replacing the defaults rather than joining them, and `--json` writing an absent field as `null`.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LANDED_LIMIT,
  type FleetLandedDeps,
  landedJson,
  parseFleetLandedArgs,
  runFleetLanded,
} from "../../../../../cli/commands/fleet/landedRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { LandedErrors } from "../../../../../fleet/landedErrors.js";
import type { LandedReport } from "../../../../../fleet/landedTypes.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";

const REPORT: LandedReport = {
  landings: [
    {
      branch: undefined,
      mergedIso: "2026-10-05T03:29:37Z",
      number: 1838,
      proof: { kind: "unrecorded", why: "slopweaver's PR ledger holds no record of #1838" },
      row: undefined,
      sha: "c".repeat(40),
      title: "Lock file maintenance",
      under: { kind: "none" },
      url: "https://github.com/lachiejames/slopweaver/pull/1838",
      words: { kind: "not-joined", why: "slopweaver's PR ledger holds no record of #1838" },
    },
  ],
  ledgerUnread: [],
  limit: 30,
  observedAtIso: "2026-10-05T04:00:00.000Z",
  ref: "origin/main",
  refSha: "d".repeat(40),
  repo: "lachiejames/slopweaver",
};

/** Seams that record what the run asked for and printed. */
function seams({ result }: { result: Awaited<ReturnType<FleetLandedDeps["readReport"]>> }): {
  deps: FleetLandedDeps;
  asked: Parameters<FleetLandedDeps["readReport"]>[0][];
  out: string[];
  diagnostics: string[];
} {
  const asked: Parameters<FleetLandedDeps["readReport"]>[0][] = [];
  const out: string[] = [];
  const diagnostics: string[] = [];
  return {
    asked,
    deps: {
      defaultDir: () => "/checkout",
      defaultHome: () => "/home",
      now: () => "2026-10-05T04:00:00.000Z",
      readReport: (request) => {
        asked.push(request);
        return Promise.resolve(result);
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
  };
}

describe("parseFleetLandedArgs", () => {
  it("defaults to the console's window", () => {
    expect(unwrap(parseFleetLandedArgs({ rest: [] }))).toEqual({
      dir: undefined,
      home: undefined,
      json: false,
      limit: DEFAULT_LANDED_LIMIT,
      ref: undefined,
    });
  });

  it("refuses a limit outside 1 to 100 and an empty ref, both at once", () => {
    const parsed = parseFleetLandedArgs({ rest: ["--limit", "101", "--ref="] });
    expect(parsed._unsafeUnwrapErr()).toEqual([
      "--limit must be a whole number from 1 to 100, got 101",
      '--ref must name a ref, got ""',
    ]);
  });
});

describe("runFleetLanded", () => {
  it("tries origin/main then main when no ref is named", async () => {
    const run = seams({ result: ok(REPORT) });
    expect(await runFleetLanded({ deps: run.deps, rest: [] })).toBe(EXIT_OK);
    expect(run.asked).toEqual([
      { dir: "/checkout", home: "/home", limit: 30, nowIso: "2026-10-05T04:00:00.000Z", refs: ["origin/main", "main"] },
    ]);
  });

  it("reads only the named ref when one is given", async () => {
    const run = seams({ result: ok(REPORT) });
    await runFleetLanded({ deps: run.deps, rest: ["--ref", "upstream/main", "--limit", "5"] });
    expect([run.asked[0]!.refs, run.asked[0]!.limit]).toEqual([["upstream/main"], 5]);
  });

  it("prints the refusal and exits 1 when main will not resolve", async () => {
    const run = seams({ result: err(LandedErrors.refUnresolved({ ref: "origin/main or main" })) });
    expect(await runFleetLanded({ deps: run.deps, rest: [] })).toBe(EXIT_ERROR);
    expect(run.diagnostics).toEqual([
      "fleet landed: origin/main or main does not resolve here — fetch, or pass --ref; a worktree's HEAD is never read as main",
    ]);
  });

  it("exits 2 on a usage error without reading anything", async () => {
    const run = seams({ result: ok(REPORT) });
    expect(await runFleetLanded({ deps: run.deps, rest: ["--limit", "x"] })).toBe(EXIT_USAGE);
    expect(run.asked).toEqual([]);
  });

  it("prints one line per landing and its words", async () => {
    const run = seams({ result: ok(REPORT) });
    await runFleetLanded({ deps: run.deps, rest: [] });
    expect(run.out).toEqual([
      `lachiejames/slopweaver origin/main @ ${"d".repeat(10)} — the last 1 landings`,
      "2026-10-05T03:29:37Z  #1838  Lock file maintenance",
      "    not-joined: slopweaver's PR ledger holds no record of #1838",
    ]);
  });

  it("names every PR-ledger file that would not read under the header", async () => {
    const run = seams({ result: ok({ ...REPORT, ledgerUnread: [{ file: "b.json", why: "not JSON" }] }) });
    await runFleetLanded({ deps: run.deps, rest: [] });
    expect(run.out.slice(1, 3)).toEqual(["1 PR-ledger file(s) would not read:", "    b.json: not JSON"]);
  });
});

describe("landedJson", () => {
  it("writes an absent field as null rather than dropping it", () => {
    const parsed = JSON.parse(landedJson({ report: REPORT })) as { landings: Record<string, unknown>[] };
    expect([parsed.landings[0]!["branch"], parsed.landings[0]!["row"]]).toEqual([null, null]);
  });
});
