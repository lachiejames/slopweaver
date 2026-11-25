/**
 * `slopweaver github enqueue`'s private-terms preflight inside the verb: a dry run sweeps and writes nothing, a
 * refused sweep presses nothing and records no door entry, a named waiver reaches the door ledger, `--json` stays
 * one document, and `--dequeue` and an already-queued pull request read nothing.
 */
import { afterEach, describe, expect, it } from "vitest";
import { prospectiveTreeLine } from "../../../../../../cli/commands/github/enqueuePrivateTerms.js";
import { runGithubEnqueue } from "../../../../../../cli/commands/github/enqueueRun.js";
import type { LocalCodexLoopRead } from "../../../../../../codex/landingGateTypes.js";
import { hatchFor } from "../../../../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../../../../hatch/render.js";
import type { ChangeSetPrivateTermsVerdict } from "../../../../../../hygiene/changeSetPrivateTerms.js";
import { memoryDoorLedger } from "../../../../../doorLedgerFixture.js";
import { pr, QUEUED } from "./fixtures.js";
import { api, type Calls, depsFor, FETCHED_BASE_SHA, noCalls, removeHomes, scratchHome } from "./harness.js";

afterEach(() => {
  removeHomes();
});

const UNCHECKED: ChangeSetPrivateTermsVerdict = {
  detail: "the private terms file is not present at /h/hygiene/private-terms.tsv",
  kind: "unchecked",
  terms: [],
};
const HOLD: ChangeSetPrivateTermsVerdict = {
  hits: [{ className: "owner-name", line: 3, locus: "src/feature.ts" }],
  kind: "hold",
  reasons: [],
  terms: [],
};
const ARGV = ["--pr", "9", "--repo", "acme/widget"];

describe("runGithubEnqueue — the private-terms preflight", () => {
  it("sweeps the pinned head into the fetched landing branch on a dry run, and writes nothing", async () => {
    const out: string[] = [];
    const calls: Calls = noCalls();
    const sweeps: unknown[] = [];
    const door = memoryDoorLedger();
    const home = scratchHome({ label: "terms-dry" });
    const code = await runGithubEnqueue({
      deps: depsFor({ diagnostic: [], door: door.port, home, out, surface: api({ calls, reads: [pr()] }), sweeps }),
      rest: [...ARGV, "--dry-run"],
    });

    expect(code).toBe(0);
    expect(sweeps).toEqual([
      {
        measure: {
          cwd: "/w/repo",
          remote: "origin",
          target: { base: "main", head: "feature", owner: "acme", repo: "widget" },
        },
      },
      { sweep: { base: { kind: "fetched", sha: FETCHED_BASE_SHA }, headSha: "cafe1234", home, repoRoot: "/w/repo" } },
    ]);
    expect(out[0]).toBe(prospectiveTreeLine({ landingBranch: "main" }));
    expect(calls.enqueued).toEqual([]);
    expect(door.records()).toEqual([]);
  });

  it("refuses a hold before the door, pressing nothing and printing no press line", async () => {
    const out: string[] = [];
    const calls: Calls = noCalls();
    const door = memoryDoorLedger();
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic: [],
        door: door.port,
        home: scratchHome({ label: "terms-hold" }),
        out,
        surface: api({ calls, reads: [pr()] }),
        terms: HOLD,
      }),
      rest: [...ARGV, "--acknowledge-all", "--reason", "everything"],
    });

    expect(code).toBe(1);
    expect(calls.enqueued).toEqual([]);
    expect(calls.stackEnqueued).toEqual([]);
    expect(door.records()).toEqual([]);
    expect(out.slice(0, 4)).toEqual([
      prospectiveTreeLine({ landingBranch: "main" }),
      "private terms: HOLD — this landing is refused",
      "  src/feature.ts:3: [private-term] owner-name",
      "private terms have no acknowledgement and no escape hatch: --acknowledge and --acknowledge-all do not reach " +
        "this hold. Reword each line named above (or repair the terms file), push, and land again; if a term is not " +
        "private, ask the chair to narrow that terms row.",
    ]);
    expect(out).toHaveLength(4);
  });

  it.each([
    { mode: "a dry run", flags: ["--dry-run"] },
    { mode: "a real press", flags: [] },
  ])("refuses an unchecked set under --acknowledge-all on $mode, pressing nothing", async ({ flags }) => {
    const out: string[] = [];
    const calls: Calls = noCalls();
    const door = memoryDoorLedger();
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic: [],
        door: door.port,
        home: scratchHome({ label: "terms-unchecked" }),
        out,
        surface: api({ calls, reads: [pr()] }),
        terms: UNCHECKED,
      }),
      rest: [...ARGV, ...flags, "--acknowledge-all", "--reason", "everything"],
    });

    expect(code).toBe(1);
    expect(calls.enqueued).toEqual([]);
    expect(calls.stackEnqueued).toEqual([]);
    expect(door.records()).toEqual([]);
    expect(out).toEqual([
      prospectiveTreeLine({ landingBranch: "main" }),
      `private terms: NOT CHECKED — ${UNCHECKED.detail}`,
      ...hatchRefusalLines({ detail: UNCHECKED.detail, hatch: hatchFor({ id: "private-terms-unchecked" }) }),
    ]);
  });

  it("presses an unchecked set named with a reason, and the door ledger records the waiver", async () => {
    const out: string[] = [];
    const calls: Calls = noCalls();
    const door = memoryDoorLedger();
    const queued = pr({ entry: { estimatedSecondsToMerge: 120, position: 1, state: "QUEUED" } });
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic: [],
        door: door.port,
        home: scratchHome({ label: "terms-named" }),
        out,
        surface: api({ calls, reads: [pr(), queued] }),
        terms: UNCHECKED,
      }),
      rest: [...ARGV, "--acknowledge", "private-terms-unchecked", "--reason", "a fork"],
    });

    expect(code).toBe(0);
    expect(calls.enqueued).toEqual([{ expectedHeadOid: "cafe1234", nodeId: "PR_kwabc" }]);
    expect(out.slice(0, 3)).toEqual([
      prospectiveTreeLine({ landingBranch: "main" }),
      `private terms: NOT CHECKED — ${UNCHECKED.detail}`,
      "ACKNOWLEDGED: private-terms-unchecked by name — reason: a fork",
    ]);
    expect(door.records().map((record) => record["acknowledgements"])).toEqual([
      [{ reason: "a fork", subject: "private-terms-unchecked" }],
    ]);
  });

  it("records the terms waiver beside the pairing floor's on one press, the floor's re-read last", async () => {
    const calls: Calls = noCalls();
    const door = memoryDoorLedger();
    const unpaired: LocalCodexLoopRead = {
      evidence: {
        baseSha: "ba5e0000",
        branch: "feature",
        failures: ["no planning pass has run"],
        headSha: "cafe1234",
        leftovers: [],
        repository: "acme/widget",
        roots: ["/w/repo"],
      },
      kind: "read",
    };
    const queued = pr({ entry: { estimatedSecondsToMerge: 120, position: 1, state: "QUEUED" } });
    const code = await runGithubEnqueue({
      deps: depsFor({
        codexLoop: unpaired,
        diagnostic: [],
        door: door.port,
        home: scratchHome({ label: "terms-both" }),
        out: [],
        surface: api({ calls, reads: [pr(), queued] }),
        terms: UNCHECKED,
      }),
      rest: [...ARGV, "--acknowledge", "codex-loop-incomplete,private-terms-unchecked", "--reason", "a fork"],
    });

    expect(code).toBe(0);
    expect(calls.enqueued).toEqual([{ expectedHeadOid: "cafe1234", nodeId: "PR_kwabc" }]);
    expect(door.records().map((record) => record["acknowledgements"])).toEqual([
      [
        { reason: "a fork", subject: "private-terms-unchecked" },
        { reason: "a fork", subject: "codex-loop-incomplete" },
      ],
    ]);
  });

  it("answers a refusal under --json with one document carrying the preflight's lines", async () => {
    const out: string[] = [];
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic: [],
        home: scratchHome({ label: "terms-json" }),
        out,
        surface: api({ calls: noCalls(), reads: [pr()] }),
        terms: HOLD,
      }),
      rest: [...ARGV, "--json"],
    });

    expect(code).toBe(1);
    expect(out).toHaveLength(1);
    const report = JSON.parse(out[0]!) as { readonly lines: unknown; readonly outcome: unknown };
    expect(report.outcome).toBe("refused");
    expect(report.lines).toEqual([
      prospectiveTreeLine({ landingBranch: "main" }),
      "private terms: HOLD — this landing is refused",
      "  src/feature.ts:3: [private-term] owner-name",
      "private terms have no acknowledgement and no escape hatch: --acknowledge and --acknowledge-all do not reach " +
        "this hold. Reword each line named above (or repair the terms file), push, and land again; if a term is not " +
        "private, ask the chair to narrow that terms row.",
    ]);
  });

  it("reads nothing for --dequeue or an already-queued pull request", async () => {
    const sweeps: unknown[] = [];
    const queued = pr({ entry: { estimatedSecondsToMerge: 120, position: 3, state: "QUEUED" } });
    const dequeued = await runGithubEnqueue({
      deps: depsFor({
        diagnostic: [],
        home: scratchHome({ label: "terms-dequeue" }),
        out: [],
        surface: api({ calls: noCalls(), reads: [queued, pr()] }),
        sweeps,
        terms: HOLD,
      }),
      rest: [...ARGV, "--dequeue"],
    });
    const already = await runGithubEnqueue({
      deps: depsFor({
        diagnostic: [],
        home: scratchHome({ label: "terms-already" }),
        out: [],
        surface: api({ calls: noCalls(), reads: [QUEUED] }),
        sweeps,
        terms: HOLD,
      }),
      rest: ARGV,
    });

    expect(dequeued).toBe(0);
    expect(already).toBe(0);
    expect(sweeps).toEqual([]);
  });
});
