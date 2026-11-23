/**
 * `github exposure sweep` over a synthetic repository and SYNTHETIC identifier rules: every forbidden token is
 * invented and hashed here, every address is on an invented domain, and the denylist word is a canary.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type ForbiddenIdentifierRules,
  identifierDigest,
  identifierScanner,
} from "../../../../hygiene/identifierScan.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { githubExposureDiscussionTexts } from "../../../../live/github/exposureDiscussionTexts.js";
import {
  GITHUB_EXPOSURE_FINDINGS_FILE,
  GITHUB_EXPOSURE_SUMMARY_FILE,
  githubExposureRunDirectory,
  writeGithubExposureSweep,
} from "../../../../live/github/exposureFindingsStore.js";
import type { GithubExposureCallId } from "../../../../live/github/exposureModel.js";
import { githubExposureScanner, isMailboxAddress } from "../../../../live/github/exposureScan.js";
import { type GithubExposureSweep, sweepGithubExposure } from "../../../../live/github/exposureSweep.js";
import {
  githubExposureFindingsByRule,
  githubExposureSweepComplete,
  githubExposureSweepLines,
} from "../../../../live/github/exposureSweepReport.js";
import { githubExposureTexts } from "../../../../live/github/exposureTexts.js";
import { GithubJobLogErrors } from "../../../../live/github/jobLogErrors.js";
import type { StreamJobLog } from "../../../../live/github/jobLogRead.js";
import { fakeGithubExposureSeam, type GithubExposureFakeHandler } from "../../../githubExposureFake.js";

const d = ({ text }: { text: string }): string => identifierDigest({ text });

const RULES: ForbiddenIdentifierRules = {
  hashed: {
    embeddedUpper: [],
    exactIds: [],
    exemptTicketReferences: [],
    spanHeads: [],
    substringCi: [{ hash: d({ text: "quuxcorp" }), length: 8 }],
    substringCs: [],
    teamKeys: [],
    wordCi: [d({ text: "zorblatt" })],
    wordCs: [],
  },
  providerLocations: [],
};

const CANARY_ADDRESS = "owner-canary@acme-mail.io";
const CANARY_WORD = "SECRET-CANARY-BODY";
const NOW = (): string => "2026-11-19T00:00:00.000Z";

/** The sweeping account's home, built at runtime: a literal home path in a committed file is the gate's own finding. */
const OWN_HOME = ["", "Users", "sweeper"].join("/");

const scanner = githubExposureScanner({
  denylist: [CANARY_WORD],
  identifiers: identifierScanner({ rules: RULES }),
  ownHome: OWN_HOME,
});

/** A small repository whose text carries one hit of each rule, on five different surfaces. */
function syntheticRepository(): Partial<Record<GithubExposureCallId, GithubExposureFakeHandler>> {
  return {
    commits: () =>
      ok([
        {
          commit: {
            author: { email: CANARY_ADDRESS, name: "Owner" },
            committer: { email: "noreply@github.com", name: "GitHub" },
            message: "init",
            tree: { sha: "tree-1" },
          },
          sha: "sha-main",
        },
      ]),
    "commit-detail": () =>
      ok({
        files: [
          {
            filename: "notes/quuxcorp-plan.md",
            patch: "@@ -0,0 +1,2 @@\n+hello\n+zorblatt here",
            sha: "blob-a",
            status: "added",
          },
        ],
      }),
    "git-tree": () => ok({ tree: [{ path: "notes/quuxcorp-plan.md", sha: "blob-a", type: "blob" }], truncated: false }),
    issues: () =>
      ok([
        { body: "the same pull request again", number: 7, pull_request: {} },
        { body: `mail me at ${CANARY_ADDRESS}`, number: 8, title: "bug" },
      ]),
    "matching-refs": ({ params }) =>
      ok(params["ref"] === "heads" ? [{ object: { sha: "sha-main", type: "commit" }, ref: "refs/heads/main" }] : []),
    pulls: () => ok([{ body: `the token is ${CANARY_WORD}`, head: { ref: "feature" }, number: 7, title: "add it" }]),
    repository: () =>
      ok({ description: "all about zorblatt", has_discussions: true, has_pages: false, has_wiki: false, topics: [] }),
  };
}

/** A discussions answer holding one discussion with two comments, of which GitHub sent one. */
function discussionsAnswer(): unknown {
  return {
    repository: {
      discussions: {
        nodes: [
          {
            body: "opening post",
            comments: { nodes: [{ body: "first reply", replies: { nodes: [], totalCount: 0 } }], totalCount: 2 },
            number: 4,
            title: "a question",
          },
        ],
        totalCount: 1,
      },
    },
  };
}

/** A log seam for a repository that ran no jobs: any call is a fixture defect, so it answers a failure. */
const NO_LOGS: StreamJobLog = ({ jobId }) => Promise.resolve(err(GithubJobLogErrors.logUnavailable({ jobId })));

/** The sweep of the synthetic repository. */
async function sweepSynthetic(): Promise<GithubExposureSweep> {
  const { seam } = fakeGithubExposureSeam({ graphql: () => ok(discussionsAnswer()), handlers: syntheticRepository() });
  return unwrap(
    await sweepGithubExposure({ nowIso: NOW, owner: "acme", repo: "widgets", scanner, seam, streamLog: NO_LOGS }),
  );
}

describe("githubExposureTexts", () => {
  it("reads a pull request's title, body and branch names under its number", () => {
    const data = [
      { base: { ref: "main" }, body: "why", head: { label: "acme:feat", ref: "feat" }, number: 3, title: "t" },
    ];
    expect(githubExposureTexts({ call: "pulls", data, params: {} })).toEqual([
      { field: "title", locator: "pull #3", surface: "pull-requests", text: "t" },
      { field: "body", locator: "pull #3", surface: "pull-requests", text: "why" },
      { field: "head.ref", locator: "pull #3", surface: "pull-requests", text: "feat" },
      { field: "base.ref", locator: "pull #3", surface: "pull-requests", text: "main" },
    ]);
  });

  it("leaves a pull-request-shaped issue to the pull listing and a draft release unread", () => {
    expect(
      githubExposureTexts({ call: "issues", data: [{ body: "x", number: 1, pull_request: {} }], params: {} }),
    ).toEqual([]);
    expect(githubExposureTexts({ call: "releases", data: [{ body: "x", draft: true, id: 9 }], params: {} })).toEqual(
      [],
    );
  });

  it("files a commit's message under commits and its identities under commit-identities", () => {
    const data = [{ commit: { author: { email: "a@acme-mail.io", name: "A" }, message: "m" }, sha: "s1" }];
    expect(githubExposureTexts({ call: "commits", data, params: {} })).toEqual([
      { field: "commit.message", locator: "commit s1", surface: "commits", text: "m" },
      { field: "commit.author.name", locator: "commit s1", surface: "commit-identities", text: "A" },
      { field: "commit.author.email", locator: "commit s1", surface: "commit-identities", text: "a@acme-mail.io" },
    ]);
  });

  it("names a fanned-out review by the pull request its parameters asked about", () => {
    expect(
      githubExposureTexts({ call: "pull-reviews", data: [{ body: "lgtm", id: 5 }], params: { pull_number: 2 } }),
    ).toEqual([{ field: "body", locator: "review 5 on pull #2", surface: "pull-reviews", text: "lgtm" }]);
  });

  it("reads the commits a push event carries, which no ref may reach any more", () => {
    const data = [{ id: "e1", payload: { commits: [{ author: { email: "x@acme-mail.io" }, message: "gone" }] } }];
    expect(githubExposureTexts({ call: "events", data, params: {} })).toEqual([
      { field: "message", locator: "event e1 commit 1 ?", surface: "events", text: "gone" },
      { field: "author.email", locator: "event e1 commit 1 ?", surface: "events", text: "x@acme-mail.io" },
    ]);
  });

  it("gives two comments with the same body two locators, so neither is deduplicated away", () => {
    const data = {
      repository: {
        discussions: {
          nodes: [
            {
              comments: {
                nodes: [
                  { body: "hello", replies: { nodes: [{ body: "hello" }], totalCount: 1 } },
                  { body: "hello", replies: { nodes: [], totalCount: 0 } },
                ],
                totalCount: 2,
              },
              number: 4,
            },
          ],
          totalCount: 1,
        },
      },
    };
    expect(githubExposureDiscussionTexts({ data }).texts.map((text) => text.locator)).toEqual([
      "discussion #4 comment 1",
      "discussion #4 comment 1 reply 1",
      "discussion #4 comment 2",
    ]);
  });

  it("gives each job step and each push-event commit its own locator", () => {
    const job = [{ id: 3, steps: [{ name: "test" }, { name: "test" }] }];
    expect(
      githubExposureTexts({ call: "actions-jobs", data: { jobs: job }, params: {} }).map((text) => text.locator),
    ).toEqual(["job 3 step 1", "job 3 step 2"]);
    const event = [
      {
        id: "e2",
        payload: {
          commits: [
            { message: "same", sha: "c1" },
            { message: "same", sha: "c2" },
          ],
        },
      },
    ];
    expect(githubExposureTexts({ call: "events", data: event, params: {} }).map((text) => text.locator)).toEqual([
      "event e2 commit 1 c1",
      "event e2 commit 2 c2",
    ]);
  });

  it("counts every discussion connection GitHub held more of than it sent", () => {
    expect(githubExposureDiscussionTexts({ data: discussionsAnswer() }).gaps).toEqual([
      "1 discussion(s) hold more comments than were read",
    ]);
  });

  it("never names the comment whose replies were cut off, since that gap is printed", () => {
    const data = {
      repository: {
        discussions: {
          nodes: [
            {
              comments: { nodes: [{ body: CANARY_ADDRESS, replies: { nodes: [], totalCount: 1 } }], totalCount: 1 },
              number: 4,
            },
          ],
          totalCount: 1,
        },
      },
    };
    const read = githubExposureDiscussionTexts({ data });
    expect(read.texts.map((text) => text.locator)).toEqual(["discussion #4 comment 1"]);
    expect(read.gaps).toEqual(["1 comment(s) hold more replies than were read"]);
  });
});

describe("githubExposureScanner", () => {
  it("leaves GitHub's relays, the SSH remote and reserved example domains out of the mailbox rule", () => {
    expect(
      ["1+o@users.noreply.github.com", "noreply@anthropic.com", "git@github.com", "a@example.com", CANARY_ADDRESS].map(
        (address) => isMailboxAddress({ address }),
      ),
    ).toEqual([false, false, false, false, true]);
  });

  it("reports a denylist word, a forbidden word and an address, each with its line and matched text", () => {
    const text = { field: "body", locator: "pull #1", surface: "pull-requests" as const };
    expect(
      scanner.scan({ text: { ...text, text: `fine\n${CANARY_WORD} and zorblatt\nwrite ${CANARY_ADDRESS}` } }),
    ).toEqual([
      { ...text, line: 2, match: CANARY_WORD, rule: "denylist" },
      { ...text, line: 2, match: "zorblatt", rule: "forbidden-word-ci" },
      { ...text, line: 3, match: CANARY_ADDRESS, rule: "mailbox-address" },
    ]);
  });
});

describe("githubExposureScanner on a home directory", () => {
  it("reports the sweeping account's own home and no placeholder, runner or repository path", () => {
    const placeholder = ["", "home", "someone", "notes"].join("/");
    const runner = ["", "home", "runner", "work"].join("/");
    const text = {
      field: "log",
      locator: "job 1 log",
      surface: "actions-jobs" as const,
      text: `${placeholder}\nskills${placeholder}\n${runner}\n${OWN_HOME}/dev/widgets\n${OWN_HOME}2/x`,
    };
    expect(scanner.scan({ text }).map((hit) => [hit.line, hit.rule, hit.match])).toEqual([
      [4, "absolute-home-path", OWN_HOME],
    ]);
    expect(scanner.scan({ text: { ...text, field: "path", text: `skills${placeholder}` } })).toEqual([]);
  });
});

describe("sweepGithubExposure", () => {
  it("finds hits on five surfaces, a file's added line included, each with the locator it sits at", async () => {
    const sweep = await sweepSynthetic();
    expect(sweep.findings).toEqual([
      {
        field: "description",
        line: 1,
        locator: "repository",
        match: "zorblatt",
        rule: "forbidden-word-ci",
        surface: "repository-settings",
      },
      { field: "body", line: 1, locator: "pull #7", match: CANARY_WORD, rule: "denylist", surface: "pull-requests" },
      {
        field: "commit.author.email",
        line: 1,
        locator: "commit sha-main",
        match: CANARY_ADDRESS,
        rule: "mailbox-address",
        surface: "commit-identities",
      },
      {
        field: "path",
        line: 1,
        locator: "path notes/quuxcorp-plan.md",
        match: "quuxcorp",
        rule: "forbidden-substring-ci",
        surface: "file-history",
      },
      {
        field: "body",
        line: 1,
        locator: "issue #8",
        match: CANARY_ADDRESS,
        rule: "mailbox-address",
        surface: "issues",
      },
      {
        field: "patch",
        line: 2,
        locator: "commit sha-main file notes/quuxcorp-plan.md",
        match: "zorblatt",
        rule: "forbidden-word-ci",
        surface: "file-history",
      },
    ]);
  });

  it("calls file contents swept and a cut-off discussion partial, and so the sweep incomplete", async () => {
    const sweep = await sweepSynthetic();
    const coverageOf = ({ surface }: { surface: string }): unknown =>
      sweep.surfaces.find((entry) => entry.surface === surface)!.coverage;
    expect(coverageOf({ surface: "file-history" })).toEqual({
      kind: "swept",
      limits: ["an object no ref reaches is held by GitHub and enumerated by no API"],
      texts: 2,
    });
    expect(coverageOf({ surface: "discussions" })).toEqual({
      kind: "partial",
      texts: 3,
      why: ["1 discussion(s) hold more comments than were read"],
    });
    expect(coverageOf({ surface: "pull-requests" })).toEqual({ kind: "swept", limits: [], texts: 3 });
    expect(coverageOf({ surface: "wiki" })).toEqual({
      detail: "the wiki is off in the repository settings",
      kind: "not-enabled",
    });
    expect(githubExposureSweepComplete({ sweep })).toBe(false);
  });

  it("is an error when the repository document cannot be read", async () => {
    const { seam } = fakeGithubExposureSeam({
      handlers: { repository: () => err({ message: "Bad credentials", status: 401 }) },
    });
    const swept = await sweepGithubExposure({
      nowIso: NOW,
      owner: "acme",
      repo: "widgets",
      scanner,
      seam,
      streamLog: NO_LOGS,
    });
    expect(unwrapErr(swept)).toEqual({ message: "Bad credentials", status: 401 });
  });
});

describe("githubExposureSweepLines", () => {
  it("prints counts by rule and surface and the report's name, and no match", async () => {
    const sweep = await sweepSynthetic();
    const lines = githubExposureSweepLines({ reportPath: "evidence/github-exposure/run-1", sweep });
    expect(lines.slice(0, 2)).toEqual([
      `acme/widgets: INCOMPLETE — 1 of 28 surfaces not fully swept, 6 finding(s) (${String(sweep.calls)} reads at 2026-11-19T00:00:00.000Z)`,
      "  by rule: forbidden-word-ci 2, mailbox-address 2, denylist 1, forbidden-substring-ci 1",
    ]);
    expect(lines.at(-1)).toBe(
      "  findings, with where each one sits: evidence/github-exposure/run-1 under the state home",
    );
    const printed = lines.join("\n");
    expect(
      ["owner-canary", "SECRET-CANARY", "zorblatt", "quuxcorp", "sha-main", "#8"].filter((leak) =>
        printed.includes(leak),
      ),
    ).toEqual([]);
    expect(githubExposureFindingsByRule({ sweep })[0]).toEqual(["forbidden-word-ci", 2]);
  });
});

describe("writeGithubExposureSweep", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("writes every finding and the summary owner-only, under a directory that does not name the repository", async () => {
    const home = mkdtempSync(join(tmpdir(), "exposure-sweep-"));
    homes.push(home);
    const sweep = await sweepSynthetic();
    const directory = githubExposureRunDirectory({
      home,
      nonce: "n0nce000",
      readAtIso: sweep.readAtIso,
      repository: sweep.repository,
    });
    const digest = createHash("sha256").update("acme/widgets").digest("hex").slice(0, 12);
    expect(directory.homeRelative).toBe(`evidence/github-exposure/20261119T000000000Z-${digest}-n0nce000`);
    expect(writeGithubExposureSweep({ complete: false, directory: directory.absolute, sweep }).isOk()).toBe(true);
    const findingsPath = join(directory.absolute, GITHUB_EXPOSURE_FINDINGS_FILE);
    const written = readFileSync(findingsPath, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line): unknown => JSON.parse(line));
    expect(written).toEqual(sweep.findings);
    const summary: unknown = JSON.parse(readFileSync(join(directory.absolute, GITHUB_EXPOSURE_SUMMARY_FILE), "utf8"));
    expect(summary).toMatchObject({ complete: false, findings: 6, repository: "acme/widgets", schemaVersion: 2 });
    expect(statSync(findingsPath).mode & 0o777).toBe(0o600);
    expect(statSync(join(directory.absolute, GITHUB_EXPOSURE_SUMMARY_FILE)).mode & 0o777).toBe(0o600);
    expect(statSync(directory.absolute).mode & 0o777).toBe(0o700);
  });
});
