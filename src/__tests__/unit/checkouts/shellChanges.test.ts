import { describe, expect, it } from "vitest";

import { LOG_FIELD, parseMainline } from "../../../checkouts/consoleBuild.js";
import {
  CONSOLE_PATHSPEC,
  parseShaLines,
  pathChangeLogArgs,
  SHELL_PATHSPEC,
  withPathChanges,
} from "../../../checkouts/shellChanges.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const REPO = "https://github.com/lachiejames/slopweaver";

/** One `git log --format=%H%x1f%cI%x1f%s` line. */
const logLine = ({ sha, subject }: { sha: string; subject: string }): string =>
  [sha, "2026-09-28T06:00:00+00:00", subject].join(LOG_FIELD);

describe("pathChangeLogArgs", () => {
  it("bounds a cut window to exactly its own commits, over the pathspec it is given", () => {
    expect(pathChangeLogArgs({ limit: 50, pathspec: CONSOLE_PATHSPEC, sha: SHA_A, truncated: true })).toEqual([
      "log",
      "--first-parent",
      "--format=%H",
      `${SHA_A}~50..${SHA_A}`,
      "--",
      ...CONSOLE_PATHSPEC,
    ]);
  });

  it("names the tip alone when the window is the whole history", () => {
    expect(pathChangeLogArgs({ limit: 50, pathspec: SHELL_PATHSPEC, sha: SHA_A, truncated: false })[3]).toBe(SHA_A);
  });
});

describe("SHELL_PATHSPEC", () => {
  it("covers what the app is built from and leaves its README and tests out", () => {
    expect(SHELL_PATHSPEC).toContain("desktop/src/");
    expect(SHELL_PATHSPEC.some((path) => path.includes("README") || path.includes("__tests__"))).toBe(false);
  });
});

describe("CONSOLE_PATHSPEC", () => {
  it("is the site and the talk runtime, less the site's tests and docs pages", () => {
    expect(CONSOLE_PATHSPEC).toEqual([
      "site/",
      "src/talk/",
      "src/cli/commands/talk/",
      ":(exclude)site/__tests__/",
      ":(exclude)site/app/(docs)/",
      ":(exclude)site/components/diagrams/",
      ":(exclude)site/content/",
      ":(exclude)site/fixtures/",
      ":(exclude)site/AGENTS.md",
    ]);
  });
});

describe("parseShaLines", () => {
  it("reads one sha per line", () => {
    expect([...parseShaLines({ text: `${SHA_A}\n${SHA_C}\n` })!]).toEqual([SHA_A, SHA_C]);
  });

  it("reads empty output as no commits", () => {
    expect(parseShaLines({ text: "" })!.size).toBe(0);
  });

  it("refuses a line that is not a sha", () => {
    expect(parseShaLines({ text: `${SHA_A}\nfatal: bad revision` })).toBe(undefined);
  });
});

describe("withPathChanges", () => {
  const commits = parseMainline({
    limit: 3,
    repositoryUrl: REPO,
    text: [logLine({ sha: SHA_A, subject: "glow (#1888)" }), logLine({ sha: SHA_B, subject: "docs" })].join("\n"),
  })!.commits;

  it("marks the commits that change the app and only those, leaving the console flag unread", () => {
    const marked = withPathChanges({ changing: new Set([SHA_A]), commits, field: "changesShell" });
    expect(marked.map((commit) => commit.changesShell)).toEqual([true, false]);
    expect(marked.map((commit) => commit.changesConsole)).toEqual([undefined, undefined]);
  });

  it("marks the console flag on top of the shell's without altering it", () => {
    const shell = withPathChanges({ changing: new Set([SHA_A]), commits, field: "changesShell" });
    const both = withPathChanges({ changing: new Set([SHA_B]), commits: shell, field: "changesConsole" });
    expect(both.map((commit) => [commit.changesShell, commit.changesConsole])).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it("leaves the commits as they were when the changes could not be read", () => {
    const shell = withPathChanges({ changing: new Set([SHA_A]), commits, field: "changesShell" });
    const marked = withPathChanges({ changing: undefined, commits: shell, field: "changesConsole" });
    expect(marked.map((commit) => [commit.changesShell, commit.changesConsole])).toEqual([
      [true, undefined],
      [false, undefined],
    ]);
  });
});
