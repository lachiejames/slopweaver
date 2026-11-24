/**
 * The description door withholds a credential-shaped line at its WRITERS: `github pr`'s description operation and
 * `github stack push` wrap the writers they were given at their own boundary, so an exit nobody wrapped by hand is
 * still filtered. The adapters are proven here, and one `pr update` exit is driven through `runGithubPr` with a plain
 * recording writer, so what filters it is the boundary and nothing in the test.
 */
import { rmSync } from "node:fs";
import { errAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import {
  withholdingGithubPrDescriptionWriters,
  withholdingGitWriter,
} from "../../../../../cli/commands/github/prDeps.js";
import { runGithubPr } from "../../../../../cli/commands/github/run.js";
import { withholdingGithubStackPushDescriptionWriters } from "../../../../../cli/commands/github/stackPushDeps.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";
import type { GithubWriteApi } from "../../../../../corpus/github/write.js";
import { fakeApi, harnessDeps } from "../../../../githubPrHarness.js";
import { homeDeclaringNoPrivateTerms } from "../../../../privateTermsFixture.js";
import { harness } from "./stackPushRun/harness.js";

/** A synthetic credential shape, built at runtime so no token-shaped literal sits in this file. */
const TOKEN = `ghp_${"a".repeat(30)}`;

/** The line a credential-shaped line is forwarded as. */
const WITHHELD =
  "a refusal here quotes text carrying a credential shape, so it is withheld from this log. Remove the credential " +
  "the secret scan names, and the refusal prints in full";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("withholdingGithubPrDescriptionWriters", () => {
  it("filters both writers and carries every other edge by identity", () => {
    const { deps, lines } = harnessDeps({ api: fakeApi({}) });
    const errs: string[] = [];
    const given = { ...deps, err: ({ line }: { line: string }) => errs.push(line) };
    const wrapped = withholdingGithubPrDescriptionWriters({ deps: given });
    wrapped.out({ line: `refused: ${TOKEN}` });
    wrapped.out({ line: "refused: fine" });
    wrapped.err({ line: `patch quotes ${TOKEN}` });
    expect(lines).toStrictEqual([WITHHELD, "refused: fine"]);
    expect(errs).toStrictEqual([WITHHELD]);
    expect(wrapped.makeApi).toBe(given.makeApi);
    expect(wrapped.now).toBe(given.now);
    expect(wrapped.doorLedger).toBe(given.doorLedger);
  });
});

describe("withholdingGithubStackPushDescriptionWriters", () => {
  it("filters the verb's writer and the Git edges' writer, carrying the rest by identity", () => {
    const { deps, lines } = harness({ api: {} as GithubWriteApi });
    const wrapped = withholdingGithubStackPushDescriptionWriters({ deps });
    wrapped.out({ line: `refused: ${TOKEN}` });
    wrapped.git.out({ line: `pre-push: ${TOKEN}` });
    wrapped.git.out({ line: "amended a → b" });
    expect(lines).toStrictEqual([WITHHELD, WITHHELD, "amended a → b"]);
    expect(wrapped.git.readGit).toBe(deps.git.readGit);
    expect(wrapped.git.writeGit).toBe(deps.git.writeGit);
    expect(wrapped.makeApi).toBe(deps.makeApi);
  });
});

describe("withholdingGitWriter", () => {
  it("filters the Git edges' writer, as a measurement closure's private edges use it, carrying the rest by identity", () => {
    const { deps, lines } = harness({ api: {} as GithubWriteApi });
    const wrapped = withholdingGitWriter({ git: deps.git });
    wrapped.out({ line: `warning: could not measure: fatal: '${TOKEN}' does not appear to be a git repository` });
    wrapped.out({ line: "warning: could not delete private ref refs/x" });
    expect(lines).toStrictEqual([WITHHELD, "warning: could not delete private ref refs/x"]);
    expect(wrapped.readGit).toBe(deps.git.readGit);
    expect(wrapped.writeGit).toBe(deps.git.writeGit);
  });
});

describe("`github pr update` withholds a credential-shaped refusal at its boundary", () => {
  it("prints the withheld line when the live read's refusal quotes a credential shape", async () => {
    const home = homeDeclaringNoPrivateTerms({ prefix: "github-pr-writers-home-" });
    fixtureDirs.push(home);
    const api = fakeApi({
      getPr: () => errAsync({ kind: "http" as const, message: `Bad credentials for ${TOKEN}`, operation: "getPr" }),
    });
    const { deps, lines } = harnessDeps({ api });
    const explainer = [{ kind: "text", text: "Widget export now keeps the last entry of every sheet." }];
    const code = await runGithubPr({
      argv: [
        "node",
        "slopweaver",
        "github",
        "pr",
        "update",
        "--edit",
        JSON.stringify({ explainer }),
        "--repo",
        "o/r",
        "--number",
        "42",
        "--home",
        home,
      ],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(lines.filter((line) => line.includes(TOKEN))).toStrictEqual([]);
    expect(lines).toStrictEqual([WITHHELD]);
  });
});
