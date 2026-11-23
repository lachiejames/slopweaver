import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { errAsync, ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../admit/doorLedgerPort.js";
import { parseGithubReadyArgs } from "../../../../cli/commands/github/readyCore.js";
import { type GithubReadyDeps, runGithubReady } from "../../../../cli/commands/github/readyRun.js";
import { toIngestError } from "../../../../lib/ingestError.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { GithubReadyApi, ReadyPr } from "../../../../outbound/github/ready.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../doorLedgerFixture.js";

const DRAFT: ReadyPr = { draft: true, nodeId: "PR_node", number: 12, url: "https://github.com/o/r/pull/12" };
const READY: ReadyPr = { ...DRAFT, draft: false };

describe("parseGithubReadyArgs", () => {
  it("requires one exact repository and pull-request number", () => {
    expect(unwrap(parseGithubReadyArgs({ rest: ["--repo", "o/r", "--number", "12", "--json"] }))).toEqual({
      dryRun: false,
      home: undefined,
      json: true,
      number: 12,
      owner: "o",
      repo: "r",
      undo: false,
    });
    expect(unwrapErr(parseGithubReadyArgs({ rest: ["--repo", "broken", "--number", "zero"] }))).toEqual([
      "--repo owner/name is required",
      "--number must be a positive whole number",
    ]);
  });
});

/** A plain fake whose second read observes the transition, recording which direction was sent. */
function readyApi({
  reads,
  marks,
  introduced = ["src/index.ts"],
}: {
  reads: ReadyPr[];
  marks: string[];
  introduced?: readonly string[];
}): GithubReadyApi {
  return {
    introducedFiles: () => ResultAsync.fromSafePromise(Promise.resolve(introduced)),
    markDraft: ({ nodeId }) => {
      marks.push(`draft:${nodeId}`);
      return ResultAsync.fromSafePromise(Promise.resolve(undefined));
    },
    markReady: ({ nodeId }) => {
      marks.push(nodeId);
      return ResultAsync.fromSafePromise(Promise.resolve(undefined));
    },
    read: () => ResultAsync.fromSafePromise(Promise.resolve(reads.shift()!)),
  };
}

function depsFor({
  home,
  reads,
  marks,
  out,
  diagnostic,
  introduced,
  env = {},
  doorLedger = memoryDoorLedger().port,
}: {
  home: string;
  reads: ReadyPr[];
  marks: string[];
  out: string[];
  diagnostic: string[];
  introduced?: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
  doorLedger?: DoorLedgerPort;
}): GithubReadyDeps {
  return {
    doorLedger,
    env: () => env,
    home: () => home,
    makeApi: () => readyApi({ marks, reads, ...(introduced === undefined ? {} : { introduced }) }),
    out: (line) => out.push(line),
    token: () => "token",
    writeDiagnostic: (line) => diagnostic.push(line),
  };
}

describe("runGithubReady", () => {
  it("dry-runs after a live read and performs no mutation", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const marks: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-ready-dry-"));
    const code = await runGithubReady({
      deps: depsFor({ diagnostic, home, marks, out, reads: [DRAFT] }),
      rest: ["--repo", "o/r", "--number", "12", "--dry-run"],
    });

    expect(code).toBe(0);
    expect(marks).toEqual([]);
    expect(out).toEqual(["would mark ready #12  https://github.com/o/r/pull/12"]);
    expect(diagnostic).toEqual([]);
    rmSync(home, { force: true, recursive: true });
  });

  it("routes the mutation through the door and confirms ready by a second read", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const marks: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-ready-live-"));
    const code = await runGithubReady({
      deps: depsFor({ diagnostic, home, marks, out, reads: [DRAFT, DRAFT, READY] }),
      rest: ["--repo", "o/r", "--number", "12"],
    });

    expect(code).toBe(0);
    expect(marks).toEqual(["PR_node"]);
    expect(out).toEqual(["marked ready #12  https://github.com/o/r/pull/12"]);
    expect(diagnostic).toEqual([]);
    rmSync(home, { force: true, recursive: true });
  });

  it("marks nothing ready when the door's decision cannot be recorded", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const marks: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-ready-unrecorded-"));
    const code = await runGithubReady({
      deps: depsFor({
        diagnostic,
        doorLedger: unreachableDoorLedger(),
        home,
        marks,
        out,
        reads: [DRAFT, DRAFT, READY],
      }),
      rest: ["--repo", "o/r", "--number", "12"],
    });

    expect(code).toBe(1);
    expect(marks).toEqual([]);
    expect(out).toEqual([]);
    expect(diagnostic).toHaveLength(1);
    expect(diagnostic[0]).toContain("slopweaver github ready not performed:");
    rmSync(home, { force: true, recursive: true });
  });

  it("--undo sends the inverse mutation and confirms draft by a second read", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const marks: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-ready-undo-"));
    const code = await runGithubReady({
      deps: depsFor({ diagnostic, home, marks, out, reads: [READY, READY, DRAFT] }),
      rest: ["--repo", "o/r", "--number", "12", "--undo"],
    });

    expect(code).toBe(0);
    expect(marks).toEqual(["draft:PR_node"]);
    expect(out).toEqual(["returned to draft #12  https://github.com/o/r/pull/12"]);
    expect(diagnostic).toEqual([]);
    rmSync(home, { force: true, recursive: true });
  });

  it("--undo on an already-draft pull request reads back and sends nothing", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const marks: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-ready-undo-noop-"));
    const code = await runGithubReady({
      deps: depsFor({ diagnostic, home, marks, out, reads: [DRAFT] }),
      rest: ["--repo", "o/r", "--number", "12", "--undo"],
    });

    expect(code).toBe(0);
    expect(marks).toEqual([]);
    expect(out).toEqual(["already draft #12  https://github.com/o/r/pull/12"]);
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses to report success when the read-back still says ready", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const marks: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-ready-undo-lie-"));
    const code = await runGithubReady({
      deps: depsFor({ diagnostic, home, marks, out, reads: [READY, READY, READY] }),
      rest: ["--repo", "o/r", "--number", "12", "--undo"],
    });

    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(diagnostic).toEqual(["GitHub accepted the mutation but #12 still reads back as ready"]);
    rmSync(home, { force: true, recursive: true });
  });
});

describe("the proof-path refusal on runGithubReady", () => {
  /** What a real admin change introduced beside its real source. */
  const PROOF_FILES: readonly string[] = ["packages/tool-cli/proof/a.gif", "packages/tool-cli/src/index.ts"];

  /** Run one ready over a fresh home and hand back everything it printed and sent. */
  async function ready({
    rest,
    reads,
    introduced,
    env,
  }: {
    rest: readonly string[];
    reads: ReadyPr[];
    introduced: readonly string[];
    env?: Readonly<Record<string, string | undefined>>;
  }): Promise<{ code: number; marks: string[]; out: string[]; diagnostic: string[] }> {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const marks: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-ready-proof-"));
    try {
      const code = await runGithubReady({
        deps: depsFor({ diagnostic, home, introduced, marks, out, reads, ...(env === undefined ? {} : { env }) }),
        rest: ["--repo", "o/r", "--number", "12", ...rest],
      });
      return { code, diagnostic, marks, out };
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  }

  it("refuses to undraft a pull request that introduces a proof file, naming it, and sends nothing", async () => {
    const run = await ready({ introduced: PROOF_FILES, reads: [DRAFT], rest: [] });
    expect(run.code).toBe(1);
    expect(run.marks).toEqual([]);
    expect(run.out).toEqual([]);
    expect(run.diagnostic.slice(0, 2)).toEqual([
      "pull request #12 carries 1 proof file(s); nothing was sent:",
      "  packages/tool-cli/proof/a.gif",
    ]);
  });

  it("refuses a dry run the same way, since a dry run discloses what a real one would decide", async () => {
    const run = await ready({ introduced: PROOF_FILES, reads: [DRAFT], rest: ["--dry-run"] });
    expect(run.code).toBe(1);
    expect(run.out).toEqual([]);
  });

  it("names the proof file on a pull request that is already ready, rather than reporting it ready", async () => {
    const run = await ready({ introduced: PROOF_FILES, reads: [READY], rest: [] });
    expect(run.code).toBe(1);
    expect(run.marks).toEqual([]);
    expect(run.out).toEqual([]);
    expect(run.diagnostic[1]).toBe("  packages/tool-cli/proof/a.gif");
  });

  it("undrafts once the hatch is open", async () => {
    const run = await ready({
      env: { SLOPWEAVER_ALLOW_PROOF_PATH: "1" },
      introduced: PROOF_FILES,
      reads: [DRAFT, DRAFT, READY],
      rest: [],
    });
    expect(run.code).toBe(0);
    expect(run.marks).toEqual(["PR_node"]);
  });

  it("fails closed when the introduced files cannot all be read", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const marks: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-ready-proof-blind-"));
    const deps = depsFor({ diagnostic, home, marks, out, reads: [DRAFT] });
    const code = await runGithubReady({
      deps: {
        ...deps,
        makeApi: () => ({
          ...readyApi({ marks, reads: [DRAFT] }),
          introducedFiles: () =>
            errAsync(toIngestError({ error: new Error("too many files"), operation: "github.pulls.listFiles" })),
        }),
      },
      rest: ["--repo", "o/r", "--number", "12"],
    });
    rmSync(home, { force: true, recursive: true });
    expect(code).toBe(1);
    expect(marks).toEqual([]);
    expect(diagnostic[0]).toContain(
      "could not list the files pull request #12 introduces, so it was not checked for proof output:",
    );
  });

  it("never blocks --undo, which only returns a pull request to draft", async () => {
    const run = await ready({ introduced: PROOF_FILES, reads: [READY, READY, DRAFT], rest: ["--undo"] });
    expect(run.code).toBe(0);
    expect(run.marks).toEqual(["draft:PR_node"]);
  });
});
