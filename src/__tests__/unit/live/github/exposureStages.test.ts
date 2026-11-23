/**
 * The two stages `github exposure sweep` reads past the inventory — every file version as commit diffs, and every
 * job's log as a stream — over plain fake seams and SYNTHETIC identifier rules. Every token here is invented.
 */
import { describe, expect, it } from "vitest";

import {
  type ForbiddenIdentifierRules,
  identifierDigest,
  identifierScanner,
} from "../../../../hygiene/identifierScan.js";
import { err, ok } from "../../../../lib/result.js";
import { addedLinesText, blobScanText, readGithubExposureContents } from "../../../../live/github/exposureContents.js";
import { EXPOSURE_LOG_BATCH_LINES, readGithubExposureLogs } from "../../../../live/github/exposureLogs.js";
import { githubExposureBlobsQuery } from "../../../../live/github/exposureModel.js";
import { githubExposureScanner } from "../../../../live/github/exposureScan.js";
import type { GithubExposureText } from "../../../../live/github/exposureTexts.js";
import { GithubJobLogErrors } from "../../../../live/github/jobLogErrors.js";
import type { StreamJobLog } from "../../../../live/github/jobLogRead.js";
import { fakeGithubExposureSeam, GITHUB_EXPOSURE_NOT_FOUND } from "../../../githubExposureFake.js";

const RULES: ForbiddenIdentifierRules = {
  hashed: {
    embeddedUpper: [],
    exactIds: [],
    exemptTicketReferences: [],
    spanHeads: [],
    substringCi: [],
    substringCs: [],
    teamKeys: [],
    wordCi: [identifierDigest({ text: "zorblatt" })],
    wordCs: [],
  },
  providerLocations: [],
};

const scanner = githubExposureScanner({
  denylist: [],
  identifiers: identifierScanner({ rules: RULES }),
  ownHome: ["", "Users", "sweeper"].join("/"),
});

/** A sink recording every text a stage hands over. */
function collector(): { taken: GithubExposureText[]; take: (args: { texts: readonly GithubExposureText[] }) => void } {
  const taken: GithubExposureText[] = [];
  return {
    take: ({ texts }) => {
      taken.push(...texts);
    },
    taken,
  };
}

describe("addedLinesText", () => {
  it("keeps each added line at its new-file line number and blanks every other line", () => {
    const patch = [
      "@@ -1,3 +1,4 @@",
      " keep",
      "-old",
      "+new1",
      "+new2",
      " keep2",
      "@@ -10,2 +11,2 @@",
      " ctx",
      "+late",
      "\\ No newline at end of file",
    ].join("\n");
    expect(addedLinesText({ patch }).split("\n")).toEqual(["", "new1", "new2", "", "", "", "", "", "", "", "", "late"]);
  });

  it("reads a patch that removes everything as no text", () => {
    expect(addedLinesText({ patch: "@@ -1,2 +0,0 @@\n-a\n-b" })).toBe("");
  });
});

describe("blobScanText", () => {
  it("reads a text blob as its UTF-8", () => {
    expect(blobScanText({ bytes: Buffer.from("plain text\n") })).toEqual({ binary: false, text: "plain text\n" });
  });

  it("reduces a binary blob to its printable runs of eight or more", () => {
    const bytes = Buffer.concat([
      Buffer.from([0, 1, 2]),
      Buffer.from("hidden-token-value"),
      Buffer.from([0, 255]),
      Buffer.from("ab"),
    ]);
    expect(blobScanText({ bytes })).toEqual({ binary: true, text: "hidden-token-value" });
  });
});

describe("githubExposureBlobsQuery", () => {
  it("reads each blob under its own alias from its own variable, splicing no id into the text", () => {
    expect(githubExposureBlobsQuery({ count: 2 })).toBe(
      [
        "query($owner: String!, $repo: String!, $o0: GitObjectID!, $o1: GitObjectID!) {",
        "  repository(owner: $owner, name: $repo) {",
        "    b0: object(oid: $o0) { ... on Blob { isBinary isTruncated text } }",
        "    b1: object(oid: $o1) { ... on Blob { isBinary isTruncated text } }",
        "  }",
        "}",
      ].join("\n"),
    );
  });
});

describe("readGithubExposureContents", () => {
  it("scans each patch, then reads every blob no patch covered: as text, or over REST when binary or cut off", async () => {
    const binary = Buffer.concat([Buffer.from([0]), Buffer.from("zorblatt-in-a-png")]).toString("base64");
    const { seam, asked } = fakeGithubExposureSeam({
      graphql: () =>
        ok({
          repository: {
            b0: { isBinary: false, isTruncated: true, text: "cut off" },
            b1: { isBinary: false, isTruncated: false, text: "zorblatt only in the root commit" },
            b2: { isBinary: true, isTruncated: false, text: null },
          },
        }),
      handlers: {
        "commit-detail": ({ params }) =>
          ok({
            files:
              params["ref"] === "sha-1"
                ? [
                    { filename: "a.md", patch: "@@ -0,0 +1 @@\n+zorblatt", sha: "blob-a", status: "added" },
                    { filename: "logo.png", sha: "blob-1", status: "added" },
                    { filename: "gone.txt", patch: "@@ -1 +0,0 @@\n-old", sha: "blob-2", status: "removed" },
                  ]
                : [{ filename: "logo.png", sha: "blob-1", status: "modified" }],
          }),
        "git-blob": ({ params }) =>
          ok({
            content: params["file_sha"] === "blob-1" ? binary : Buffer.from("full zorblatt").toString("base64"),
            encoding: "base64",
          }),
      },
    });
    const { taken, take } = collector();
    const read = await readGithubExposureContents({
      commitShas: ["sha-1", "sha-2"],
      commitTrees: new Map(),
      maxPages: 30,
      owner: "acme",
      repo: "widgets",
      seam,
      take,
      treeBlobs: new Map([
        ["blob-a", "a.md"],
        ["blob-1", "logo.png"],
        ["blob-4", "big.txt"],
        ["blob-5", "root-only.txt"],
      ]),
    });
    expect(read).toEqual({ calls: 5, gaps: [] });
    expect(asked.filter((call) => call.call === "git-blob").map((call) => call.params["file_sha"])).toEqual([
      "blob-4",
      "blob-1",
    ]);
    expect(taken.map((text) => [text.locator, text.field, text.text])).toEqual([
      ["commit sha-1 file a.md", "patch", "zorblatt"],
      ["blob blob-5 file root-only.txt", "content", "zorblatt only in the root commit"],
      ["blob blob-4 file big.txt", "content", "full zorblatt"],
      ["blob blob-1 file logo.png", "printable runs", "zorblatt-in-a-png"],
    ]);
    expect(taken.flatMap((text) => scanner.scan({ text })).map((finding) => finding.locator)).toEqual([
      "commit sha-1 file a.md",
      "blob blob-5 file root-only.txt",
      "blob blob-4 file big.txt",
      "blob blob-1 file logo.png",
    ]);
  });

  it("reads whole every blob of a commit listed in part, even one a later patch restored", async () => {
    // C1's list fails, so the line C1 introduced into X was in no patch; C3 restoring X must not cover it.
    const { seam } = fakeGithubExposureSeam({
      graphql: () => ok({ repository: { b0: { isBinary: false, isTruncated: false, text: "zorblatt\nold" } } }),
      handlers: {
        "commit-detail": ({ params }) => {
          if (params["ref"] === "c1") {
            return err(GITHUB_EXPOSURE_NOT_FOUND);
          }
          const [sha, line] = params["ref"] === "c2" ? ["blob-y", "+new"] : ["blob-x", "+old"];
          return ok({
            files: [{ filename: "f.txt", patch: `@@ -1,2 +1,2 @@\n zorblatt\n${line}`, sha, status: "modified" }],
          });
        },
        "git-tree": () => ok({ tree: [{ path: "f.txt", sha: "blob-x", type: "blob" }], truncated: false }),
      },
    });
    const { taken, take } = collector();
    const read = await readGithubExposureContents({
      commitShas: ["c1", "c2", "c3"],
      commitTrees: new Map([["c1", "tree-1"]]),
      maxPages: 30,
      owner: "acme",
      repo: "widgets",
      seam,
      take,
      treeBlobs: new Map([
        ["blob-x", "f.txt"],
        ["blob-y", "f.txt"],
      ]),
    });
    expect(read).toEqual({ calls: 5, gaps: [] });
    expect(taken.flatMap((text) => scanner.scan({ text })).map((finding) => [finding.locator, finding.line])).toEqual([
      ["blob blob-x file f.txt", 1],
    ]);
  });

  it("reads a patchless blob whole even when another commit's patch produced the same blob", async () => {
    const { seam } = fakeGithubExposureSeam({
      graphql: () => ok({ repository: { b0: { isBinary: false, isTruncated: false, text: "zorblatt" } } }),
      handlers: {
        "commit-detail": ({ params }) =>
          ok({
            files: [
              params["ref"] === "c1"
                ? { filename: "big.txt", sha: "blob-x", status: "added" }
                : { filename: "big.txt", patch: "@@ -1 +1 @@\n-other\n+tail", sha: "blob-x", status: "modified" },
            ],
          }),
      },
    });
    const { taken, take } = collector();
    await readGithubExposureContents({
      commitShas: ["c1", "c3"],
      commitTrees: new Map(),
      maxPages: 30,
      owner: "acme",
      repo: "widgets",
      seam,
      take,
      treeBlobs: new Map([["blob-x", "big.txt"]]),
    });
    expect(taken.map((text) => text.locator)).toEqual(["commit c3 file big.txt", "blob blob-x file big.txt"]);
  });

  it("counts a commit listed in part whose tree cannot be read, and a blob it could not read, naming none", async () => {
    const { seam, asked } = fakeGithubExposureSeam({
      handlers: { "commit-detail": () => err(GITHUB_EXPOSURE_NOT_FOUND) },
    });
    const read = await readGithubExposureContents({
      commitShas: ["sha-bad"],
      commitTrees: new Map([["sha-bad", "tree-bad"]]),
      maxPages: 30,
      owner: "acme",
      repo: "widgets",
      seam,
      take: collector().take,
      treeBlobs: new Map([["blob-9", "secret-name.bin"]]),
    });
    expect(asked.map((call) => call.call)).toEqual(["commit-detail", "git-tree", "git-blob"]);
    expect(read.gaps).toEqual([
      "1 commit(s) listed in part had a tree that could not be read whole",
      "1 file version(s) no patch covered could not be read",
    ]);
  });
});

/** A log stream of the given chunks. */
async function* chunksOf({ chunks }: { chunks: readonly string[] }): AsyncIterable<string> {
  for (const chunk of chunks) {
    yield await Promise.resolve(chunk);
  }
}

/** A stream that yields one line and then fails mid-body. */
async function* brokenStream(): AsyncIterable<string> {
  yield await Promise.resolve("first line\n");
  throw new Error("connection reset");
}

describe("readGithubExposureLogs", () => {
  it("scans a long log in batches whose findings carry the log's own line numbers", async () => {
    const lines = Array.from({ length: EXPOSURE_LOG_BATCH_LINES + 3 }, (_, index) =>
      index === EXPOSURE_LOG_BATCH_LINES + 1 ? "2026-11-19T00:00:00.0000000Z leaked zorblatt" : `line ${String(index)}`,
    );
    const body = lines.join("\n");
    const streamLog: StreamJobLog = () =>
      Promise.resolve(ok(chunksOf({ chunks: [body.slice(0, 7), body.slice(7, 5000), body.slice(5000)] })));
    const { taken, take } = collector();
    const read = await readGithubExposureLogs({ jobIds: [5], owner: "acme", repo: "widgets", streamLog, take });
    expect(read).toEqual({ calls: 1, gaps: [], limits: [] });
    expect(taken.map((text) => [text.locator, text.lineOffset])).toEqual([
      ["job 5 log", 0],
      ["job 5 log", EXPOSURE_LOG_BATCH_LINES],
    ]);
    expect(taken.flatMap((text) => scanner.scan({ text })).map((finding) => [finding.line, finding.match])).toEqual([
      [EXPOSURE_LOG_BATCH_LINES + 2, "zorblatt"],
    ]);
  });

  it("counts a cut line as a gap, the last one with no newline after it included", async () => {
    const streamLog: StreamJobLog = ({ jobId }) =>
      Promise.resolve(
        ok(
          chunksOf({
            chunks: jobId === 1 ? ["0123456789", "abc zorblatt\nshort\n"] : ["fine\n", "0123456789 zorblatt"],
          }),
        ),
      );
    const { taken, take } = collector();
    const read = await readGithubExposureLogs({
      jobIds: [1, 2],
      lineChars: 12,
      owner: "acme",
      repo: "widgets",
      streamLog,
      take,
    });
    expect(taken.map((text) => text.text)).toEqual(["0123456789ab\nshort", "fine\n0123456789 z"]);
    expect(read.gaps).toEqual(["2 log line(s) were longer than the scan keeps and read only in part"]);
  });

  it("calls an expired log a limit and every other failure a counted gap", async () => {
    const streamLog: StreamJobLog = ({ jobId }) => {
      if (jobId === 1) {
        return Promise.resolve(err(GithubJobLogErrors.logUnavailable({ jobId })));
      }
      if (jobId === 2) {
        return Promise.resolve(err(GithubJobLogErrors.logFetchFailed({ cause: undefined, message: "503" })));
      }
      return Promise.resolve(ok(brokenStream()));
    };
    const { taken, take } = collector();
    const read = await readGithubExposureLogs({ jobIds: [1, 2, 3], owner: "acme", repo: "widgets", streamLog, take });
    expect(read).toEqual({
      calls: 3,
      gaps: ["2 job log(s) could not be read in full"],
      limits: ["1 job log(s) GitHub no longer serves, so none will be public"],
    });
    expect(taken.map((text) => text.text)).toEqual(["first line"]);
  });
});
