import { describe, expect, it } from "vitest";

import { parseGithubRunLogArgs } from "../../../../../cli/commands/github/runLogCore.js";
import { type GithubRunLogDeps, runGithubRunLog } from "../../../../../cli/commands/github/runLogRun.js";
import { GITHUB_RUN_LOG_USAGE } from "../../../../../cli/commands/github/runLogUsage.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { GithubJobLogErrors } from "../../../../../live/github/jobLogErrors.js";
import type { JobLogDocument } from "../../../../../live/github/jobLogRead.js";

/** Every usage-issue code one invocation reported. */
function codesOf({ rest }: { rest: readonly string[] }): readonly string[] {
  return unwrapErr(parseGithubRunLogArgs({ rest })).map((issue) => issue.code);
}

const DOCUMENT: JobLogDocument = {
  jobs: [
    {
      conclusion: "failure",
      failedStep: { conclusion: "failure", name: "Lint", number: 8 },
      htmlUrl: undefined,
      jobId: 7,
      log: {
        annotations: [],
        annotationsDropped: 0,
        closed: true,
        from: undefined,
        linesTruncated: 0,
        regionLines: 3,
        tail: ["dev lint: FAIL"],
        testFilePaths: [],
        testFilePathsDropped: 0,
      },
      name: "lint",
    },
  ],
  readAtIso: "2026-09-20T10:00:00.000Z",
  repo: "o/r",
  residue: [],
  run: {
    conclusion: "failure",
    headBranch: "a-branch",
    headSha: "abc1234",
    htmlUrl: undefined,
    id: 42,
    name: "CI",
  },
  tailLines: 40,
};

/** The command edges as plain fakes. */
function depsFor({
  out,
  diagnostic,
  read = () => Promise.resolve(ok(DOCUMENT)),
  reads = [],
}: {
  out: string[];
  diagnostic: string[];
  read?: GithubRunLogDeps["read"];
  reads?: { runId: number; job: string | undefined; lines: number; from?: string | undefined }[];
}): GithubRunLogDeps {
  return {
    read: (args) => {
      reads.push({ from: args.from, job: args.job, lines: args.lines, runId: args.runId });
      return read(args);
    },
    resolveRepo: () => ok({ owner: "o", repo: "r" }),
    writeDiagnostic: (line) => diagnostic.push(line),
    writeOut: (line) => out.push(line),
  };
}

describe("parseGithubRunLogArgs", () => {
  it("takes the run id from the sole positional and defaults the rest", () => {
    const args = unwrap(parseGithubRunLogArgs({ rest: ["35502228255"] }));

    expect(args.runId).toBe(35502228255);
    expect(args.lines).toBe(40);
    expect(args.job).toBeUndefined();
    expect(args.repo).toBeUndefined();
    expect(args.json).toBe(false);
  });

  it("reads every flag it accepts", () => {
    const args = unwrap(
      parseGithubRunLogArgs({
        rest: [
          "42",
          "--repo",
          "o/r",
          "--job",
          "lint",
          "--lines",
          "5",
          "--from",
          "dev lint: x",
          "--json",
          "--home",
          "/tmp/h",
        ],
      }),
    );

    expect(args).toStrictEqual({
      from: "dev lint: x",
      home: "/tmp/h",
      job: "lint",
      json: true,
      lines: 5,
      repo: "o/r",
      runId: 42,
    });
  });

  it("keeps --from exactly as typed, because an indent is part of the log line it matches", () => {
    expect(unwrap(parseGithubRunLogArgs({ rest: ["42", "--from", "  ✗ max-function-lines"] })).from).toBe(
      "  ✗ max-function-lines",
    );
  });

  it("leaves --from unset when it is not given, so the read keeps a tail", () => {
    expect(unwrap(parseGithubRunLogArgs({ rest: ["42"] })).from).toBeUndefined();
  });

  it("refuses a whitespace-only --from rather than matching every line", () => {
    expect(codesOf({ rest: ["42", "--from", "   "] })).toEqual(["BLANK_FLAG_VALUE"]);
  });

  it("refuses a missing run id", () => {
    expect(codesOf({ rest: [] })).toEqual(["RUN_ID_INVALID"]);
  });

  it("refuses two positionals rather than guessing which is the run id", () => {
    expect(codesOf({ rest: ["42", "43"] })).toEqual(["RUN_ID_INVALID"]);
  });

  it("refuses a run id that is not a whole positive number", () => {
    expect(codesOf({ rest: ["lint"] })).toEqual(["RUN_ID_INVALID"]);
    expect(codesOf({ rest: ["0"] })).toEqual(["RUN_ID_INVALID"]);
  });

  it("refuses --lines above the measured ceiling rather than clamping it", () => {
    expect(codesOf({ rest: ["42", "--lines", "2001"] })).toEqual(["TAIL_LINES_OUT_OF_RANGE"]);
  });

  it("accepts --lines 0, which is a caller asking for annotations alone", () => {
    expect(unwrap(parseGithubRunLogArgs({ rest: ["42", "--lines", "0"] })).lines).toBe(0);
  });

  it("refuses a blank string flag, which is a typo and never a request for the default", () => {
    expect(codesOf({ rest: ["42", "--job", ""] })).toEqual(["BLANK_FLAG_VALUE"]);
  });

  it("reports every problem from one invocation rather than the first", () => {
    expect(codesOf({ rest: ["--lines", "9999", "--job", ""] })).toEqual([
      "RUN_ID_INVALID",
      "TAIL_LINES_OUT_OF_RANGE",
      "BLANK_FLAG_VALUE",
    ]);
  });

  it("forwards an unknown flag as a parser problem", () => {
    expect(codesOf({ rest: ["42", "--tail", "5"] })).toEqual(["FLAG_PARSE"]);
  });
});

describe("GITHUB_RUN_LOG_USAGE", () => {
  it("names every flag the parser accepts, so help and behaviour cannot disagree", () => {
    for (const flag of ["--repo", "--job", "--lines", "--from", "--json", "--home"]) {
      expect(GITHUB_RUN_LOG_USAGE).toContain(flag);
    }
  });

  it("says why the whole log is never printed, which is the bound a caller has to know", () => {
    expect(GITHUB_RUN_LOG_USAGE).toContain("no byte range");
  });
});

describe("runGithubRunLog", () => {
  it("prints the report and exits OK, passing the parsed selection through untouched", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const reads: { runId: number; job: string | undefined; lines: number }[] = [];

    const code = await runGithubRunLog({
      deps: depsFor({ diagnostic, out, reads }),
      rest: ["42", "--job", "lint", "--lines", "5"],
    });

    expect(code).toBe(EXIT_OK);
    expect(reads).toEqual([{ job: "lint", lines: 5, runId: 42 }]);
    expect(out[0]).toContain('job lint (7) failure at step 8 "Lint"');
  });

  it("forwards --from to the read unchanged, so the window opens where the caller asked", async () => {
    const reads: { runId: number; job: string | undefined; lines: number; from?: string | undefined }[] = [];

    const code = await runGithubRunLog({
      deps: depsFor({ diagnostic: [], out: [], reads }),
      rest: ["42", "--job", "lint", "--from", "dev lint: max-function-lines"],
    });

    expect(code).toBe(EXIT_OK);
    expect(reads).toStrictEqual([{ from: "dev lint: max-function-lines", job: "lint", lines: 40, runId: 42 }]);
  });

  it("emits one JSON document under --json instead of the text report", async () => {
    const out: string[] = [];

    await runGithubRunLog({ deps: depsFor({ diagnostic: [], out }), rest: ["42", "--json"] });

    expect(out[0]!.slice(0, 1)).toBe("{");
    expect(out[0]).toContain('"jobId": 7');
  });

  it("refuses a usage problem with the usage text, before any read", async () => {
    const diagnostic: string[] = [];
    const reads: { runId: number; job: string | undefined; lines: number }[] = [];

    const code = await runGithubRunLog({ deps: depsFor({ diagnostic, out: [], reads }), rest: [] });

    expect(code).toBe(EXIT_USAGE);
    expect(reads).toEqual([]);
    expect(diagnostic[1]).toBe(GITHUB_RUN_LOG_USAGE);
  });

  it("reports a read failure's own message and exits error", async () => {
    const diagnostic: string[] = [];

    const code = await runGithubRunLog({
      deps: depsFor({
        diagnostic,
        out: [],
        read: () => Promise.resolve(err(GithubJobLogErrors.logUnavailable({ jobId: 7 }))),
      }),
      rest: ["42"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(diagnostic[0]).toContain("Actions logs expire");
  });
});
