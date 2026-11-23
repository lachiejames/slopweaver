import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { type GithubLabelDeps, runGithubLabel } from "../../../../../cli/commands/github/labelRun.js";
import type { DefinedLabels, GithubLabelApi, IssueLabels } from "../../../../../outbound/github/labels.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

const URL = "https://github.com/o/r/pull/7";
const DEFINED: DefinedLabels = { names: ["bug", "e2e-local"], truncated: false };

/** A plain fake whose second read observes the write. */
function labelApi({
  defined,
  reads,
  adds,
}: {
  defined: DefinedLabels;
  reads: IssueLabels[];
  adds: string[][];
}): GithubLabelApi {
  return {
    add: ({ labels }) => {
      adds.push([...labels]);
      return ResultAsync.fromSafePromise(Promise.resolve(labels));
    },
    definedLabels: () => ResultAsync.fromSafePromise(Promise.resolve(defined)),
    read: () => ResultAsync.fromSafePromise(Promise.resolve(reads.shift()!)),
  };
}

function depsFor({
  door = memoryDoorLedger().port,
  home,
  defined,
  reads,
  adds,
  out,
  diagnostic,
}: {
  door?: DoorLedgerPort;
  home: string;
  defined: DefinedLabels;
  reads: IssueLabels[];
  adds: string[][];
  out: string[];
  diagnostic: string[];
}): GithubLabelDeps {
  return {
    doorLedger: door,
    home: () => home,
    makeApi: () => labelApi({ adds, defined, reads }),
    out: (line) => out.push(line),
    token: () => "token",
    writeDiagnostic: (line) => diagnostic.push(line),
  };
}

const ADD_ARGS = ["--repo", "o/r", "--number", "7", "--add", "e2e-local"];

describe("runGithubLabel", () => {
  it("is a no-op when the label is already on the pull request", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const adds: string[][] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-label-noop-"));
    const code = await runGithubLabel({
      deps: depsFor({
        adds,
        defined: DEFINED,
        diagnostic,
        home,
        out,
        reads: [{ htmlUrl: URL, labels: ["e2e-local"] }],
      }),
      rest: ADD_ARGS,
    });

    expect(code).toBe(0);
    expect(adds).toEqual([]);
    expect(out).toEqual([`already labelled #7  e2e-local  ${URL}`]);
    expect(diagnostic).toEqual([]);
    rmSync(home, { force: true, recursive: true });
  });

  it("dry-runs after a live read and performs no mutation", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const adds: string[][] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-label-dry-"));
    const code = await runGithubLabel({
      deps: depsFor({ adds, defined: DEFINED, diagnostic, home, out, reads: [{ htmlUrl: URL, labels: [] }] }),
      rest: [...ADD_ARGS, "--dry-run"],
    });

    expect(code).toBe(0);
    expect(adds).toEqual([]);
    expect(out).toEqual([`would label #7  e2e-local  ${URL}`]);
    expect(diagnostic).toEqual([]);
    rmSync(home, { force: true, recursive: true });
  });

  it("routes the mutation through the door and confirms it by a second read", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const adds: string[][] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-label-live-"));
    const code = await runGithubLabel({
      deps: depsFor({
        adds,
        defined: DEFINED,
        diagnostic,
        home,
        out,
        reads: [
          { htmlUrl: URL, labels: [] },
          { htmlUrl: URL, labels: ["e2e-local"] },
        ],
      }),
      rest: ADD_ARGS,
    });

    expect(code).toBe(0);
    expect(adds).toEqual([["e2e-local"]]);
    expect(out).toEqual([`labelled #7  e2e-local  ${URL}`]);
    expect(diagnostic).toEqual([]);
    rmSync(home, { force: true, recursive: true });
  });

  it("adds nothing when the door cannot record the label", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const adds: string[][] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-label-down-"));
    const code = await runGithubLabel({
      deps: depsFor({
        adds,
        defined: DEFINED,
        diagnostic,
        door: unreachableDoorLedger(),
        home,
        out,
        reads: [{ htmlUrl: URL, labels: [] }],
      }),
      rest: ADD_ARGS,
    });

    expect(code).toBe(1);
    expect(adds).toEqual([]);
    expect(diagnostic.join("\n")).toContain("not performed:");
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a label the repository does not define rather than letting GitHub create it", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const adds: string[][] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-label-undefined-"));
    const code = await runGithubLabel({
      deps: depsFor({ adds, defined: DEFINED, diagnostic, home, out, reads: [{ htmlUrl: URL, labels: [] }] }),
      rest: ["--repo", "o/r", "--number", "7", "--add", "e2e-locl"],
    });

    expect(code).toBe(1);
    expect(adds).toEqual([]);
    expect(out).toEqual([]);
    expect(diagnostic).toEqual([
      "o/r does not define e2e-locl; create the label in the repository first rather than letting this " +
        "call invent it",
    ]);
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses when the defined-label read was truncated, because absence stops meaning undefined", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const adds: string[][] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-label-truncated-"));
    const code = await runGithubLabel({
      deps: depsFor({
        adds,
        defined: { names: ["bug"], truncated: true },
        diagnostic,
        home,
        out,
        reads: [{ htmlUrl: URL, labels: [] }],
      }),
      rest: ADD_ARGS,
    });

    expect(code).toBe(1);
    expect(adds).toEqual([]);
    expect(diagnostic).toEqual(["o/r defines more labels than this read covers; cannot verify --add"]);
    rmSync(home, { force: true, recursive: true });
  });

  it("reports a usage error for a missing --add without touching the network", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const code = await runGithubLabel({
      deps: depsFor({ adds: [], defined: DEFINED, diagnostic, home: "/unused", out, reads: [] }),
      rest: ["--repo", "o/r", "--number", "7"],
    });

    expect(code).toBe(2);
    expect(diagnostic[0]).toBe("--add needs at least one label name");
  });
});
