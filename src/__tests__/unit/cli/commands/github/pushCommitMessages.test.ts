import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  commitMessagePolicy,
  stackPushCommitMessagesRefused,
  stackSubmitCommitMessageRefusal,
} from "../../../../../cli/commands/github/pushCommitMessages.js";
import { ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { writePrivateTerms } from "../../../../privateTermsFixture.js";

const SHA = "c".repeat(40);
const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) rmSync(dir, { force: true, recursive: true });
});

/**
 * A throwaway state home, optionally carrying a denylist, and private-term rows — a header-only file declaring none
 * unless `terms` is `"absent"`.
 */
function home({ denylist, terms = [] }: { denylist?: string; terms?: readonly string[] | "absent" } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "push-commit-messages-"));
  homes.push(dir);
  if (denylist !== undefined) writeFileSync(stateHomePaths({ home: dir }).hygieneDenylist, denylist);
  if (terms !== "absent") writePrivateTerms({ home: dir, rows: terms });
  return dir;
}

/** A private term of the `place` class, invented. */
const PLACE_ROW = "place\ti\tzorvane\tsynthetic";

/** A reader answering every `log` read with one commit carrying `message`. */
function oneCommit({ message }: { message: string }) {
  return ({ args }: { cwd: string; args: readonly string[] }): string => {
    if (args[1] !== "log") throw new Error(`unexpected git ${args.join(" ")}`);
    return `\u001e${SHA}\0${message}\n`;
  };
}

describe("commitMessagePolicy", () => {
  it("reads an absent denylist as empty and a present one line by line", () => {
    expect(commitMessagePolicy({ home: home() })).toEqual(ok({ denylist: [], privateTerms: [] }));
    expect(unwrap(commitMessagePolicy({ home: home({ denylist: "zorblat\nquuxco\n" }) })).denylist).toEqual([
      "zorblat",
      "quuxco",
    ]);
  });

  it("refuses a denylist that exists and cannot be read", () => {
    const dir = home();
    mkdirSync(stateHomePaths({ home: dir }).hygieneDenylist);
    const loaded = commitMessagePolicy({ home: dir });
    expect(loaded.isErr()).toBe(true);
    expect(unwrapErr(loaded)).toContain("hygiene-denylist.txt");
  });

  it("refuses when the private terms file is absent, naming it", () => {
    const loaded = commitMessagePolicy({ home: home({ terms: "absent" }) });
    expect(unwrapErr(loaded)).toContain("private-terms.tsv does not exist");
  });

  it("loads the private terms the file declares", () => {
    const terms = unwrap(commitMessagePolicy({ home: home({ terms: [PLACE_ROW] }) })).privateTerms;
    expect(terms.map((term) => term.className)).toEqual(["place"]);
  });
});

describe("stackSubmitCommitMessageRefusal", () => {
  const plan = { pushes: [{ branch: "one", expectedRemoteSha: "", toSha: "head-one" }] };

  it("refuses a denylisted term the private list names", () => {
    const lines = stackSubmitCommitMessageRefusal({
      home: home({ denylist: "zorblat\n" }),
      plan,
      readGit: oneCommit({ message: "Wire the Zorblat sync" }),
      remote: "origin",
      repo: "acme/app",
      repoRoot: "/repo",
    });
    expect(lines.slice(0, 3)).toEqual([
      "1 commit message(s) cannot be published as written; nothing was sent:",
      `  commit ${SHA.slice(0, 12)}:`,
      "    commit message line 1: a denylisted term (redacted here) — remove it",
    ]);
  });

  it("refuses a private term by class, and refuses outright with no terms file", () => {
    const termLines = stackSubmitCommitMessageRefusal({
      home: home({ terms: [PLACE_ROW] }),
      plan,
      readGit: oneCommit({ message: "Map the Zorvane office" }),
      remote: "origin",
      repo: "acme/app",
      repoRoot: "/repo",
    });
    expect(termLines[2]).toBe(
      "    commit message line 1: a private place term (redacted here) — remove or generalise it, or if it is not private ask the chair to narrow that terms row",
    );
    const absentLines = stackSubmitCommitMessageRefusal({
      home: home({ terms: "absent" }),
      plan,
      readGit: oneCommit({ message: "Add the gate" }),
      remote: "origin",
      repo: "acme/app",
      repoRoot: "/repo",
    });
    expect(absentLines).toHaveLength(1);
    expect(absentLines[0]).toContain("refused: hygiene: the private terms file");
    expect(absentLines[0]).toContain("nothing was sent.");
  });

  it("returns nothing for a clean message", () => {
    expect(
      stackSubmitCommitMessageRefusal({
        home: home(),
        plan,
        readGit: oneCommit({ message: "Add the gate" }),
        remote: "origin",
        repo: "acme/app",
        repoRoot: "/repo",
      }),
    ).toEqual([]);
  });
});

describe("stackPushCommitMessagesRefused", () => {
  it("prints the refusal with its first line marked and answers true", () => {
    const lines: string[] = [];
    const refused = stackPushCommitMessagesRefused({
      deps: { out: ({ line }) => lines.push(line), readGit: oneCommit({ message: "I moved it" }) },
      facts: { headSha: SHA, repo: "acme/app", repoRoot: "/repo" },
      home: home(),
      installationIdentifiers: undefined,
      remote: "origin",
    });
    expect(refused).toBe(true);
    expect(lines.slice(0, 2)).toEqual([
      "refused: 1 commit message(s) cannot be published as written; nothing was sent:",
      `  commit ${SHA.slice(0, 12)}:`,
    ]);
  });

  it("prints nothing and answers false for a clean message", () => {
    const lines: string[] = [];
    const refused = stackPushCommitMessagesRefused({
      deps: { out: ({ line }) => lines.push(line), readGit: oneCommit({ message: "Move the guard" }) },
      facts: { headSha: SHA, repo: "acme/app", repoRoot: "/repo" },
      home: home(),
      installationIdentifiers: undefined,
      remote: "origin",
    });
    expect(refused).toBe(false);
    expect(lines).toEqual([]);
  });
});
