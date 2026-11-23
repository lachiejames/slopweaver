import { describe, expect, it } from "vitest";

import {
  classifyTurnPathPaths,
  isTurnPathPath,
  parseGithubTurnPathArgs,
  validatedHeadRefName,
} from "../../../../../cli/commands/github/turnPathCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("isTurnPathPath", () => {
  it("matches an exact prefix path", () => {
    expect(isTurnPathPath({ path: "src/live" })).toBe(true);
  });

  it("matches a file under a turn-path prefix", () => {
    expect(isTurnPathPath({ path: "src/outbound/notion/pageLedger.ts" })).toBe(true);
  });

  it("does not match a sibling directory that merely shares a prefix string", () => {
    expect(isTurnPathPath({ path: "src/livesomethingelse/x.ts" })).toBe(false);
  });

  it("does not match a path that only contains a turn-path segment mid-string", () => {
    expect(isTurnPathPath({ path: "src/__tests__/unit/live/turn/run.test.ts" })).toBe(false);
  });

  it("does not match an unrelated path", () => {
    expect(isTurnPathPath({ path: "README.md" })).toBe(false);
  });
});

describe("classifyTurnPathPaths", () => {
  it("reports clean when no path matches", () => {
    expect(classifyTurnPathPaths({ paths: ["README.md", "docs/security.md"] })).toEqual({
      matched: [],
      turnPath: false,
    });
  });

  it("reports turn-path with the matched paths, in order", () => {
    expect(
      classifyTurnPathPaths({
        paths: ["README.md", "src/live/github/checks.ts", "src/outbound/linear/schema.ts"],
      }),
    ).toEqual({
      matched: ["src/live/github/checks.ts", "src/outbound/linear/schema.ts"],
      turnPath: true,
    });
  });

  it("reports clean for an empty path list", () => {
    expect(classifyTurnPathPaths({ paths: [] })).toEqual({ matched: [], turnPath: false });
  });
});

describe("validatedHeadRefName", () => {
  it("passes through a real branch name, trimmed", () => {
    expect(unwrap(validatedHeadRefName({ headRefName: "  a-branch  " }))).toBe("a-branch");
  });

  it("refuses an empty headRefName", () => {
    expect(unwrapErr(validatedHeadRefName({ headRefName: "" })).message).toBe(
      "headRefName is empty or whitespace — refusing before it reaches a refspec",
    );
  });

  it("refuses a whitespace-only headRefName", () => {
    expect(unwrapErr(validatedHeadRefName({ headRefName: "   " })).message).toBe(
      "headRefName is empty or whitespace — refusing before it reaches a refspec",
    );
  });
});

describe("parseGithubTurnPathArgs", () => {
  it("requires --head and defaults every other flag", () => {
    expect(unwrap(parseGithubTurnPathArgs({ rest: ["--head", "a-branch"] }))).toEqual({
      base: "origin/main",
      cwd: undefined,
      head: "a-branch",
      json: false,
      number: undefined,
      remote: "origin",
      repo: undefined,
    });
  });

  it("parses every flag when given", () => {
    expect(
      unwrap(
        parseGithubTurnPathArgs({
          rest: [
            "--head",
            "a-branch",
            "--base",
            "origin/develop",
            "--repo",
            "acme/widget",
            "--number",
            "145",
            "--cwd",
            "/repo",
            "--remote",
            "upstream",
            "--json",
          ],
        }),
      ),
    ).toEqual({
      base: "origin/develop",
      cwd: "/repo",
      head: "a-branch",
      json: true,
      number: 145,
      remote: "upstream",
      repo: "acme/widget",
    });
  });

  it("refuses a missing --head", () => {
    expect(unwrapErr(parseGithubTurnPathArgs({ rest: [] }))).toEqual(["--head is required and must name a branch"]);
  });

  it("refuses a whitespace-only --head", () => {
    expect(unwrapErr(parseGithubTurnPathArgs({ rest: ["--head", "   "] }))).toEqual([
      "--head is required and must name a branch",
    ]);
  });

  it("refuses a non-positive --number", () => {
    expect(unwrapErr(parseGithubTurnPathArgs({ rest: ["--head", "a-branch", "--number", "0"] }))).toEqual([
      "--number must be a positive whole number",
    ]);
  });
});
