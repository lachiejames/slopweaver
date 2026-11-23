import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ResultAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import {
  type GithubRequiredContextsDeps,
  runGithubRequiredContexts,
} from "../../../../../cli/commands/github/requiredContextsRun.js";
import type { MergeGroupObservation, RequiredStatusChecks } from "../../../../../corpus/github/protection.js";
import { ok } from "../../../../../lib/result.js";
import type { GithubRequiredContextsApi } from "../../../../../outbound/github/requiredContextsWrite.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

const homes: string[] = [];

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

/** A throwaway state home the door records into. */
function newHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-required-contexts-"));
  homes.push(home);
  return home;
}

function observation({ names, entries }: { names: readonly string[]; entries: number }): MergeGroupObservation {
  return { contexts: names.map((name) => ({ headSha: "abc1234", name })), entries, queueRefSuites: entries };
}

/** A plain fake whose read observes whatever the previous write stored. */
function api({
  stored,
  observed,
  writes,
}: {
  stored: { contexts: string[]; strict: boolean };
  observed: MergeGroupObservation;
  writes: string[][];
}): GithubRequiredContextsApi {
  const current = (): RequiredStatusChecks => ({
    contexts: [...stored.contexts],
    kind: "required",
    strict: stored.strict,
  });
  return {
    mergeGroupContexts: () => ResultAsync.fromSafePromise(Promise.resolve(observed)),
    read: () => ResultAsync.fromSafePromise(Promise.resolve(current())),
    setContexts: ({ contexts }) => {
      writes.push([...contexts]);
      stored.contexts = [...contexts];
      return ResultAsync.fromSafePromise(Promise.resolve(current()));
    },
  };
}

function depsFor({
  door = memoryDoorLedger().port,
  home,
  out,
  diagnostic,
  stored,
  observed,
  writes,
  env = {},
}: {
  door?: DoorLedgerPort;
  home: string;
  out: string[];
  diagnostic: string[];
  stored: { contexts: string[]; strict: boolean };
  observed: MergeGroupObservation;
  writes: string[][];
  env?: Record<string, string | undefined>;
}): GithubRequiredContextsDeps {
  return {
    doorLedger: door,
    env: () => env,
    home: () => home,
    makeApi: () => api({ observed, stored, writes }),
    out: (line) => out.push(line),
    resolveRepo: () => ok({ owner: "o", repo: "r" }),
    token: () => "token",
    writeDiagnostic: (line) => diagnostic.push(line),
  };
}

describe("runGithubRequiredContexts", () => {
  it("reads and writes nothing when no change is named", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const writes: string[][] = [];
    const home = newHome();

    const code = await runGithubRequiredContexts({
      deps: depsFor({
        diagnostic,
        home,
        observed: observation({ entries: 3, names: ["build"] }),
        out,
        stored: { contexts: ["integration", "build"], strict: true },
        writes,
      }),
      rest: ["--repo", "o/r", "--home", home, "--json"],
    });

    expect(code).toBe(0);
    expect(writes).toEqual([]);
    expect(out).toHaveLength(1);
    const document: unknown = JSON.parse(out[0]!);
    expect(document).toEqual({
      branch: "main",
      current: ["build", "integration"],
      mergeGroup: { entries: 3, observed: ["build"], queueRefSuites: 3 },
      next: ["build", "integration"],
      outcome: "read",
      repo: "o/r",
    });
  });

  it("refuses a context no merge-group entry has run, and writes nothing", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const writes: string[][] = [];
    const home = newHome();

    const code = await runGithubRequiredContexts({
      deps: depsFor({
        diagnostic,
        home,
        observed: observation({ entries: 5, names: ["build", "integration"] }),
        out,
        stored: { contexts: ["build", "integration"], strict: true },
        writes,
      }),
      rest: ["--repo", "o/r", "--home", home, "--require", "CodeQL"],
    });

    expect(code).toBe(1);
    expect(writes).toEqual([]);
    expect(out[0]).toBe("refused o/r@main");
    expect(diagnostic[0]).toContain("CodeQL; 5 merge-group entries carried: build, integration");
  });

  it("writes the UNION, never just the added name, so nothing already required is dropped", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const writes: string[][] = [];
    const home = newHome();

    const code = await runGithubRequiredContexts({
      deps: depsFor({
        diagnostic,
        home,
        observed: observation({ entries: 5, names: ["build", "integration", "typecheck"] }),
        out,
        stored: { contexts: ["build", "integration"], strict: true },
        writes,
      }),
      rest: ["--repo", "o/r", "--home", home, "--require", "typecheck"],
    });

    expect(code).toBe(0);
    expect(writes).toEqual([["build", "integration", "typecheck"]]);
    expect(out[0]).toBe("set o/r@main");
  });

  it("writes nothing when the door cannot record the write", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const writes: string[][] = [];
    const home = newHome();

    const code = await runGithubRequiredContexts({
      deps: depsFor({
        diagnostic,
        door: unreachableDoorLedger(),
        home,
        observed: observation({ entries: 5, names: ["build", "integration", "typecheck"] }),
        out,
        stored: { contexts: ["build", "integration"], strict: true },
        writes,
      }),
      rest: ["--repo", "o/r", "--home", home, "--require", "typecheck"],
    });

    expect(code).toBe(1);
    expect(writes).toEqual([]);
    expect(diagnostic.join("\n")).toContain("not performed:");
  });

  it("performs no write on --dry-run, having judged the addition safe", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const writes: string[][] = [];
    const home = newHome();

    const code = await runGithubRequiredContexts({
      deps: depsFor({
        diagnostic,
        home,
        observed: observation({ entries: 5, names: ["build", "typecheck"] }),
        out,
        stored: { contexts: ["build"], strict: false },
        writes,
      }),
      rest: ["--repo", "o/r", "--home", home, "--require", "typecheck", "--dry-run"],
    });

    expect(code).toBe(0);
    expect(writes).toEqual([]);
    expect(out[0]).toBe("would set o/r@main");
  });

  it("refuses to leave the branch requiring nothing at all", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const writes: string[][] = [];
    const home = newHome();

    const code = await runGithubRequiredContexts({
      deps: depsFor({
        diagnostic,
        home,
        observed: observation({ entries: 5, names: ["build"] }),
        out,
        stored: { contexts: ["build"], strict: true },
        writes,
      }),
      rest: ["--repo", "o/r", "--home", home, "--drop", "build"],
    });

    expect(code).toBe(1);
    expect(writes).toEqual([]);
    expect(diagnostic[0]).toContain("refusing to leave main requiring no context at all");
  });

  it("lets the declared hatch through, and still writes the union", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const writes: string[][] = [];
    const home = newHome();

    const code = await runGithubRequiredContexts({
      deps: depsFor({
        diagnostic,
        env: { SLOPWEAVER_ALLOW_UNOBSERVED_REQUIRED_CONTEXT: "1" },
        home,
        observed: observation({ entries: 5, names: ["build"] }),
        out,
        stored: { contexts: ["build"], strict: true },
        writes,
      }),
      rest: ["--repo", "o/r", "--home", home, "--require", "CodeQL"],
    });

    expect(code).toBe(0);
    expect(writes).toEqual([["CodeQL", "build"]]);
  });

  it("refuses a branch with no status-check rule rather than creating protection", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const home = newHome();
    const deps: GithubRequiredContextsDeps = {
      doorLedger: memoryDoorLedger().port,
      env: () => ({}),
      home: () => home,
      makeApi: () => ({
        mergeGroupContexts: () => ResultAsync.fromSafePromise(Promise.resolve(observation({ entries: 0, names: [] }))),
        read: () => ResultAsync.fromSafePromise(Promise.resolve<RequiredStatusChecks>({ kind: "unprotected" })),
        setContexts: () => ResultAsync.fromSafePromise(Promise.resolve<RequiredStatusChecks>({ kind: "unprotected" })),
      }),
      out: (line) => out.push(line),
      resolveRepo: () => ok({ owner: "o", repo: "r" }),
      token: () => "token",
      writeDiagnostic: (line) => diagnostic.push(line),
    };

    const code = await runGithubRequiredContexts({ deps, rest: ["--repo", "o/r", "--home", home, "--require", "x"] });

    expect(code).toBe(1);
    expect(diagnostic[0]).toContain("has no classic status-check rule");
  });

  it("refuses a branch its plan cannot protect in the plan's own words, distinct from an unprotected one", async () => {
    const diagnostic: string[] = [];
    const observed: string[] = [];
    const home = newHome();
    const deps: GithubRequiredContextsDeps = {
      doorLedger: memoryDoorLedger().port,
      env: () => ({}),
      home: () => home,
      makeApi: () => ({
        mergeGroupContexts: () => {
          observed.push("mergeGroupContexts");
          return ResultAsync.fromSafePromise(Promise.resolve(observation({ entries: 0, names: [] })));
        },
        read: () => ResultAsync.fromSafePromise(Promise.resolve<RequiredStatusChecks>({ kind: "plan-unavailable" })),
        setContexts: () => {
          observed.push("setContexts");
          return ResultAsync.fromSafePromise(Promise.resolve<RequiredStatusChecks>({ kind: "plan-unavailable" }));
        },
      }),
      out: () => undefined,
      resolveRepo: () => ok({ owner: "o", repo: "r" }),
      token: () => "token",
      writeDiagnostic: (line) => diagnostic.push(line),
    };

    const code = await runGithubRequiredContexts({ deps, rest: ["--repo", "o/r", "--home", home, "--require", "x"] });

    expect(code).toBe(1);
    expect(observed).toEqual([]);
    expect(diagnostic[0]).toContain("main cannot be protected on this repository's GitHub plan");
    expect(diagnostic[0]).toContain("there is no status-check rule to govern, and none can be written");
  });
});
