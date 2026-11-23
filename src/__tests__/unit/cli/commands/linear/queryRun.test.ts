import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type LinearQueryDeps,
  productionLinearQueryDeps,
  runLinearQuery,
} from "../../../../../cli/commands/linear/queryRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { LinearQueryErrors } from "../../../../../corpus/linear/queryErrors.js";
import { linearBronzeDir, scanLinearBronze } from "../../../../../corpus/linear/queryScan.js";
import type { CorpusRecord } from "../../../../../corpus/types.js";
import { err, ok, unwrapErr } from "../../../../../lib/result.js";

const NOW = "2026-09-06T12:00:00.000Z";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A bronze dir holding exactly these records, one JSON object per line. */
function bronzeWith({ records }: { records: readonly CorpusRecord[] }): string {
  const dir = mkdtempSync(join(tmpdir(), "lq-"));
  dirs.push(dir);
  writeFileSync(join(dir, "window.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
  return dir;
}

function issueRecord({
  sourceId,
  state,
  assignee = "kim.lee",
  tsIso = "2026-09-01T00:00:00.000Z",
}: {
  sourceId: string;
  state: string;
  assignee?: string;
  tsIso?: string;
}): CorpusRecord {
  return {
    attrs: {
      assignee,
      state,
      stateType: "started",
      // `split` with a separator always yields at least one element, so the first is never absent.
      team: sourceId.split("-")[0]!,
    },
    container: "linear/ENG",
    kind: "issue",
    refs: [],
    source: "linear",
    sourceId,
    text: "body",
    title: `${sourceId} Fix the pool`,
    tsIso,
    url: `https://linear.app/acme/issue/${sourceId}`,
  };
}

/** Deps whose scan is the REAL one, pointed at a fixture dir; everything else is a plain fake. */
function depsOver({
  out,
  diagnostics,
  verify,
  ownerHandle = async () => ok("kim.lee"),
}: {
  out: string[];
  diagnostics: string[];
  verify: LinearQueryDeps["verify"];
  ownerHandle?: LinearQueryDeps["ownerHandle"];
}): LinearQueryDeps {
  return {
    nowIso: () => NOW,
    ownerHandle: ownerHandle,
    // The fixture dir is its own home: nothing here is a real home's bronze, and the empty list reads no registry.
    scan: ({ home, corpus, filter }) => {
      const dir = linearBronzeDir({ corpus, home });
      return scanLinearBronze({ dir, filter, home: dir, protection: () => ok([]) });
    },
    verify,
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  };
}

describe("runLinearQuery", () => {
  it("answers from the fixture corpus and marks each cited row with the live verdict", async () => {
    const dir = bronzeWith({
      records: [
        issueRecord({ sourceId: "ENG-1", state: "In Review" }),
        issueRecord({ sourceId: "ENG-2", state: "Todo" }),
      ],
    });
    const out: string[] = [];
    const diagnostics: string[] = [];
    const code = await runLinearQuery({
      deps: depsOver({
        diagnostics,
        out,
        verify: () =>
          Promise.resolve(
            ok({
              requests: 1,
              verifiedAtIso: NOW,
              verifications: [
                { drifts: [], identifier: "ENG-1", status: "confirmed" as const },
                {
                  drifts: [{ field: "state" as const, live: "Done", local: "Todo" }],
                  identifier: "ENG-2",
                  status: "changed" as const,
                },
              ],
            }),
          ),
      }),
      rest: ["--corpus", dir, "--assignee", "kim.lee"],
    });
    expect(code).toBe(EXIT_OK);
    expect(out.length).toBe(1);
    expect(out[0]!).toContain("ENG-1  [confirmed]");
    expect(out[0]!).toContain("ENG-2  [changed]");
    expect(out[0]!).toContain("state: Todo → Done");
    expect(out[0]!).toContain("1 confirmed, 1 changed, 0 gone, 0 unverified");
  });

  it("says the citations are UNVERIFIED, in words, when no credential is configured", async () => {
    const dir = bronzeWith({ records: [issueRecord({ sourceId: "ENG-1", state: "In Review" })] });
    const out: string[] = [];
    const code = await runLinearQuery({
      deps: depsOver({ diagnostics: [], out, verify: () => Promise.resolve({ skipped: "no-token" as const }) }),
      rest: ["--corpus", dir],
    });
    expect(code).toBe(EXIT_OK);
    expect(out[0]!).toContain("citations UNVERIFIED — no Linear token configured");
    expect(out[0]!).toContain("ENG-1  [unchecked]");
  });

  it("makes no live call at all for --no-verify, and says so", async () => {
    const dir = bronzeWith({ records: [issueRecord({ sourceId: "ENG-1", state: "In Review" })] });
    const out: string[] = [];
    let verifyCalls = 0;
    const code = await runLinearQuery({
      deps: depsOver({
        diagnostics: [],
        out,
        verify: () => {
          verifyCalls += 1;
          return Promise.resolve({ skipped: "not-requested" as const });
        },
      }),
      rest: ["--corpus", dir, "--no-verify"],
    });
    expect(code).toBe(EXIT_OK);
    expect(verifyCalls).toBe(0);
    expect(out[0]!).toContain("citations UNVERIFIED — --no-verify was passed");
  });

  it("verifies nothing and says nothing matched when the filter selects no record", async () => {
    const dir = bronzeWith({ records: [issueRecord({ sourceId: "ENG-1", state: "In Review" })] });
    const out: string[] = [];
    let verifyCalls = 0;
    const code = await runLinearQuery({
      deps: depsOver({
        diagnostics: [],
        out,
        verify: () => {
          verifyCalls += 1;
          return Promise.resolve({ skipped: "no-hits" as const });
        },
      }),
      rest: ["--corpus", dir, "--assignee", "someone.else"],
    });
    expect(code).toBe(EXIT_OK);
    expect(verifyCalls).toBe(0);
    expect(out[0]!).toContain("no matching Linear object in the local corpus");
  });

  it("collapses a superseded capture, so one edited ticket is cited once", async () => {
    const dir = bronzeWith({
      records: [
        issueRecord({ sourceId: "ENG-1", state: "Todo", tsIso: "2026-09-01T00:00:00.000Z" }),
        issueRecord({ sourceId: "ENG-1", state: "Done", tsIso: "2026-09-02T00:00:00.000Z" }),
      ],
    });
    const out: string[] = [];
    await runLinearQuery({
      deps: depsOver({
        diagnostics: [],
        out,
        verify: () => Promise.resolve({ skipped: "no-token" as const }),
      }),
      rest: ["--corpus", dir, "--json"],
    });
    const document = JSON.parse(out[0]!) as { matched: number; hits: readonly { state: string }[] };
    expect(document.matched).toBe(1);
    expect(document.hits[0]!.state).toBe("Done");
  });

  it("exits USAGE on a bad facet value and prints the usage beneath the refusal", async () => {
    const out: string[] = [];
    const diagnostics: string[] = [];
    const code = await runLinearQuery({
      deps: depsOver({ diagnostics, out, verify: () => Promise.resolve({ skipped: "no-token" as const }) }),
      rest: ["--state-type", "strted"],
    });
    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics[0]!).toContain("--state-type does not accept");
    expect(out).toEqual([]);
  });

  it("exits ERROR without scanning when --assignee me cannot be resolved", async () => {
    const diagnostics: string[] = [];
    const out: string[] = [];
    const code = await runLinearQuery({
      deps: depsOver({
        diagnostics,
        out,
        ownerHandle: async () => err(LinearQueryErrors.ownerUnresolved({ profileId: "me" })),
        verify: () => Promise.resolve({ skipped: "no-token" as const }),
      }),
      rest: ["--assignee", "me"],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics[0]!).toContain("--assignee me needs a Linear handle");
    expect(out).toEqual([]);
  });

  it("exits ERROR without scanning when the identity roster store cannot answer for --assignee me", async () => {
    const diagnostics: string[] = [];
    const out: string[] = [];
    const code = await runLinearQuery({
      deps: depsOver({
        diagnostics,
        out,
        ownerHandle: async () =>
          err(LinearQueryErrors.rosterUnreadable({ message: "the identity roster store is down" })),
        verify: () => Promise.resolve({ skipped: "no-token" as const }),
      }),
      rest: ["--assignee", "me"],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics).toEqual(["--assignee me cannot resolve the owner: the identity roster store is down"]);
    expect(out).toEqual([]);
  });

  it("exits ERROR when the bronze directory holds nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lq-empty-"));
    dirs.push(dir);
    const diagnostics: string[] = [];
    const code = await runLinearQuery({
      deps: depsOver({ diagnostics, out: [], verify: () => Promise.resolve({ skipped: "no-token" as const }) }),
      rest: ["--corpus", dir],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics[0]!).toContain("no Linear bronze under");
  });
});

describe("productionLinearQueryDeps().ownerHandle", () => {
  it("names a corrupt profile.json as unreadable, never as absent", async () => {
    const home = mkdtempSync(join(tmpdir(), "lq-profile-"));
    dirs.push(home);
    writeFileSync(join(home, "profile.json"), "{");
    const error = unwrapErr(await productionLinearQueryDeps().ownerHandle({ home }));
    expect(error.code).toBe("PROFILE_UNREADABLE");
    expect(error.message).toContain(join(home, "profile.json"));
  });

  it("still says there is no profile.json when there is none", async () => {
    const home = mkdtempSync(join(tmpdir(), "lq-profile-absent-"));
    dirs.push(home);
    const error = unwrapErr(await productionLinearQueryDeps().ownerHandle({ home }));
    expect(error.code).toBe("OWNER_UNRESOLVED");
    expect(error.message).toContain("(no profile.json in this home)");
  });
});
