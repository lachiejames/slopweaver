import { describe, expect, it } from "vitest";

import { GithubPushDoorErrors } from "../../../admit/githubPushErrors.js";
import {
  type CommitMessageHygiene,
  commitMessageRefusal,
  commitsToPublish,
  parseCommitLog,
  refuseUnpublishableCommitMessages,
  submitCommitMessageRefusal,
} from "../../../admit/pushCommitMessageGate.js";
import { err, ok } from "../../../lib/result.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const HYGIENE: CommitMessageHygiene = {
  denylist: [],
  installationIdentifiers: undefined,
  ownRepository: "acme/app",
  privateTerms: [],
};
const FIRST_PERSON_FIX = 'name who acted — "the owner", or "an agent" for a session — or say what the change does';
const HOLD =
  "This is a hold, with no override: reword each message (`git commit --amend` for the head commit, a reword " +
  "rebase for an older one), then run the command again.";

/** One log record exactly as `--format=%x1e%H%x00%B` prints it. */
function record({ sha, message }: { sha: string; message: string }): string {
  return `\u001e${sha}\0${message}\n`;
}

/** A reader answering every `log` read with `output`, recording each argument list it was asked. */
function logReader({ output, asked }: { output: Readonly<Record<string, string>>; asked: string[][] }) {
  return ({ args }: { cwd: string; args: readonly string[] }): string => {
    asked.push([...args]);
    const answer = output[args[6]!];
    if (answer === undefined) throw new Error(`fatal: bad revision ${args[6]!}`);
    return answer;
  };
}

describe("parseCommitLog", () => {
  it("splits records and keeps a multi-line body whole, trimmed", () => {
    expect(
      parseCommitLog({
        output: `${record({ message: "Add the gate\n\nBody line one.\nBody two.\n", sha: SHA_A })}${record({ message: "Fix", sha: SHA_B })}`,
      }),
    ).toEqual([
      { message: "Add the gate\n\nBody line one.\nBody two.", sha: SHA_A },
      { message: "Fix", sha: SHA_B },
    ]);
  });

  it("reads an empty log as no commits", () => {
    expect(parseCommitLog({ output: "" })).toEqual([]);
    expect(parseCommitLog({ output: "\n" })).toEqual([]);
  });
});

describe("commitsToPublish", () => {
  it("reads the head against every tracking ref and the remote branch sha", () => {
    const asked: string[][] = [];
    const read = commitsToPublish({
      localSha: SHA_A,
      readGit: logReader({ asked, output: { [SHA_A]: record({ message: "Add it", sha: SHA_A }) } }),
      remote: "origin",
      remoteSha: SHA_B,
      repoRoot: "/repo",
    });
    expect(read).toEqual(ok([{ message: "Add it", sha: SHA_A }]));
    expect(asked).toEqual([
      [
        "--no-replace-objects",
        "log",
        "--ignore-missing",
        "--no-show-signature",
        "--encoding=UTF-8",
        "--format=%x1e%H%x00%B",
        SHA_A,
        "--not",
        "--remotes=origin",
        SHA_B,
      ],
    ]);
  });

  it("omits the remote sha when the remote has no such branch", () => {
    const asked: string[][] = [];
    commitsToPublish({
      localSha: SHA_A,
      readGit: logReader({ asked, output: { [SHA_A]: "" } }),
      remote: "upstream",
      remoteSha: undefined,
      repoRoot: "/repo",
    });
    expect(asked[0]!.slice(-2)).toEqual(["--not", "--remotes=upstream"]);
  });

  it("refuses closed when the read fails", () => {
    expect(
      commitsToPublish({
        localSha: SHA_A,
        readGit: logReader({ asked: [], output: {} }),
        remote: "origin",
        remoteSha: undefined,
        repoRoot: "/repo",
      }),
    ).toEqual(
      err(GithubPushDoorErrors.commitMessagesUnread({ cause: `fatal: bad revision ${SHA_A}`, localSha: SHA_A })),
    );
  });
});

describe("commitMessageRefusal", () => {
  it("passes clean messages, a quoted owner line and a pronoun inside code", () => {
    expect(
      commitMessageRefusal({
        commits: [
          { message: "Add the publication scan", sha: SHA_A },
          { message: 'Reword the hint\n\nThe owner asked "can we drop it"; `us` stays.', sha: SHA_B },
        ],
        hygiene: HYGIENE,
      }),
    ).toEqual([]);
  });

  it("names every refused commit once, each finding under it, then the hold", () => {
    expect(
      commitMessageRefusal({
        commits: [
          { message: "We fixed the retry", sha: SHA_A },
          { message: "Clean subject\n\nRuns on this Mac now.", sha: SHA_B },
          { message: "We fixed the retry", sha: SHA_A },
        ],
        hygiene: HYGIENE,
      }),
    ).toEqual([
      "2 commit message(s) cannot be published as written; nothing was sent:",
      `  commit ${SHA_A.slice(0, 12)}:`,
      `    commit message line 1: "We" is first person — ${FIRST_PERSON_FIX}`,
      `  commit ${SHA_B.slice(0, 12)}:`,
      '    commit message line 3: "this Mac" names the host by its make — write "this machine"',
      HOLD,
    ]);
  });

  it("refuses a denylisted term without echoing it", () => {
    const lines = commitMessageRefusal({
      commits: [{ message: "Wire the Zorblat sync", sha: SHA_A }],
      hygiene: { ...HYGIENE, denylist: ["zorblat"] },
    });
    expect(lines[2]).toBe("    commit message line 1: a denylisted term (redacted here) — remove it");
    expect(lines.join("\n")).not.toContain("Zorblat");
  });
});

describe("refuseUnpublishableCommitMessages", () => {
  it("passes when every message is clean", () => {
    expect(
      refuseUnpublishableCommitMessages({
        hygiene: HYGIENE,
        localSha: SHA_A,
        readGit: logReader({ asked: [], output: { [SHA_A]: record({ message: "Add it", sha: SHA_A }) } }),
        remote: "origin",
        remoteSha: undefined,
        repoRoot: "/repo",
      }),
    ).toEqual(ok(undefined));
  });

  it("refuses as a commit-message fact carrying every line", () => {
    const result = refuseUnpublishableCommitMessages({
      hygiene: HYGIENE,
      localSha: SHA_A,
      readGit: logReader({ asked: [], output: { [SHA_A]: record({ message: "Our fix", sha: SHA_A }) } }),
      remote: "origin",
      remoteSha: undefined,
      repoRoot: "/repo",
    });
    expect(result).toEqual(
      err(
        GithubPushDoorErrors.commitMessageUnpublishable({
          refusal: [
            "1 commit message(s) cannot be published as written; nothing was sent:",
            `  commit ${SHA_A.slice(0, 12)}:`,
            `    commit message line 1: "Our" is first person — ${FIRST_PERSON_FIX}`,
            HOLD,
          ],
        }),
      ),
    );
  });
});

describe("submitCommitMessageRefusal", () => {
  it("reads every head, judges a shared lower commit once, and names an unreadable head", () => {
    const shared = record({ message: "My base change", sha: SHA_A });
    const lines = submitCommitMessageRefusal({
      hygiene: HYGIENE,
      plan: {
        pushes: [
          { branch: "one", expectedRemoteSha: "", toSha: "head-one" },
          { branch: "two", expectedRemoteSha: SHA_B, toSha: "head-two" },
          { branch: "three", expectedRemoteSha: "", toSha: "head-three" },
        ],
      },
      readGit: logReader({ asked: [], output: { "head-one": shared, "head-two": shared } }),
      remote: "origin",
      repoRoot: "/repo",
    });
    expect(lines).toEqual([
      "refused: three: could not read the commit messages head-three would publish: fatal: bad revision head-three; nothing was sent",
      "1 commit message(s) cannot be published as written; nothing was sent:",
      `  commit ${SHA_A.slice(0, 12)}:`,
      `    commit message line 1: "My" is first person — ${FIRST_PERSON_FIX}`,
      HOLD,
    ]);
  });

  it("returns nothing when every head is clean", () => {
    expect(
      submitCommitMessageRefusal({
        hygiene: HYGIENE,
        plan: { pushes: [{ branch: "one", expectedRemoteSha: "", toSha: "head-one" }] },
        readGit: logReader({ asked: [], output: { "head-one": record({ message: "Add it", sha: SHA_A }) } }),
        remote: "origin",
        repoRoot: "/repo",
      }),
    ).toEqual([]);
  });
});
