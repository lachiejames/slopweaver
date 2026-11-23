/**
 * `github pr update`'s `runUpdate`, called directly — the half of its order that runs BEFORE any provider read.
 *
 * Its contract is "parse → token → address → …": a description input is decoded before a token is resolved,
 * and nothing past the token is reached without one. The description-write success paths are `run.test.ts`'s,
 * through the verb entrypoint. Here every edge the early stops must not reach is a landmine that throws, so a
 * reordering would fail these tests rather than pass them quietly.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { type GithubPrArgs, parseGithubPrArgs } from "../../../../../cli/commands/github/core.js";
import { clearDescriptionReview } from "../../../../../cli/commands/github/descriptionReviewCheck.js";
import { GithubVerbErrors, githubVerbErrorLines } from "../../../../../cli/commands/github/errors.js";
import type { GithubPrDeps } from "../../../../../cli/commands/github/prDeps.js";
import { runUpdate } from "../../../../../cli/commands/github/updateFlow.js";
import { unwrap } from "../../../../../lib/result.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { memoryIdentityRosterPort } from "../../../../identityRosterFixture.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "github-update-flow-home-"));
  fixtureDirs.push(home);
  return home;
}

/** An edge these early stops must never reach — calling one throws, naming it. */
function landmine({ name }: { name: string }): () => never {
  return () => {
    throw new Error(`update must not reach ${name} here`);
  };
}

/** What one run observed: its printed lines and every home a token was asked for. */
interface Observed {
  readonly deps: GithubPrDeps;
  readonly lines: string[];
  readonly tokenHomes: string[];
}

/** Deps whose only live edges are the output sink, the inline form reader and a token resolver. */
function harness({ tokenResolves }: { tokenResolves: boolean }): Observed {
  const lines: string[] = [];
  const tokenHomes: string[] = [];
  const deps: GithubPrDeps = {
    autonomy: {
      appendRecord: landmine({ name: "autonomy.appendRecord" }),
      readRecords: landmine({ name: "autonomy.readRecords" }),
    },
    cwd: landmine({ name: "cwd" }),
    descriptionReview: clearDescriptionReview,
    doorLedger: memoryDoorLedger().port,
    identityRoster: memoryIdentityRosterPort(),
    installationIdentifiers: landmine({ name: "installationIdentifiers" }),
    env: landmine({ name: "env" }),
    err: landmine({ name: "err" }),
    makeApi: landmine({ name: "makeApi" }),
    measureAlreadyLanded: landmine({ name: "measureAlreadyLanded" }),
    measureBaseFreshness: landmine({ name: "measureBaseFreshness" }),
    now: landmine({ name: "now" }),
    out: ({ line }) => lines.push(line),
    readFileSource: landmine({ name: "readFileSource" }),
    readForm: ({ source }) => source,
    sleep: landmine({ name: "sleep" }),
    token: ({ home }) => {
      tokenHomes.push(home);
      return tokenResolves ? "fake-test-token" : undefined;
    },
    writeFileOut: landmine({ name: "writeFileOut" }),
  };
  return { deps, lines, tokenHomes };
}

/** `update` against the example pull request with the given description flags, parsed by the verb's own parser. */
function updateArgs({ flags, home }: { flags: readonly string[]; home: string }): GithubPrArgs {
  return unwrap(parseGithubPrArgs({ argv: ["update", ...flags, "--repo", "o/r", "--number", "42", "--home", home] }));
}

/** What `JSON.parse` throws for `raw` — the cause the `--form` refusal carries. */
function jsonParseFailure({ raw }: { raw: string }): unknown {
  try {
    JSON.parse(raw);
  } catch (cause: unknown) {
    return cause;
  }
  throw new Error(`${raw} parsed as JSON`);
}

describe("runUpdate — before the token", () => {
  it("refuses with exit 1 and builds no API when no token resolves for a well-formed edit", async () => {
    const home = tempHome();
    const observed = harness({ tokenResolves: false });
    const code = await runUpdate({
      args: updateArgs({ flags: ["--edit", JSON.stringify({ title: "a new title" })], home }),
      deps: observed.deps,
      home,
    });
    expect(code).toBe(1);
    expect(observed.lines).toEqual([
      "refused: no GitHub token resolved ($SLOPWEAVER_HOME/secrets/github-token, or gh auth token)",
    ]);
    expect(observed.tokenHomes).toEqual([home]);
  });

  it("refuses an --edit that is not a JSON object with exit 2, before asking for a token", async () => {
    const home = tempHome();
    const observed = harness({ tokenResolves: true });
    const code = await runUpdate({ args: updateArgs({ flags: ["--edit", "[]"], home }), deps: observed.deps, home });
    expect(code).toBe(2);
    expect(observed.lines).toEqual(["--edit must be a JSON object naming the fields to change"]);
    expect(observed.lines).toEqual(githubVerbErrorLines({ error: GithubVerbErrors.editNotObject({ got: "[]" }) }));
    expect(observed.tokenHomes).toEqual([]);
  });

  it("refuses a --form that is not JSON with exit 2, before asking for a token", async () => {
    const home = tempHome();
    const observed = harness({ tokenResolves: true });
    const code = await runUpdate({
      args: updateArgs({ flags: ["--form", "{not json"], home }),
      deps: observed.deps,
      home,
    });
    expect(code).toBe(2);
    expect(observed.lines).toEqual([
      GithubVerbErrors.flagNotJson({ cause: jsonParseFailure({ raw: "{not json" }), flag: "--form" }).message,
    ]);
    expect(observed.lines[0]).toMatch(/^--form is not valid JSON: /);
    expect(observed.tokenHomes).toEqual([]);
  });
});
