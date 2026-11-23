/**
 * The upload index of `github exposure sweep`: every uploaded asset a repository's text links, with every place that
 * links it, written to the state home only. Every URL, id and locator here is synthetic.
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { identifierScanner } from "../../../../hygiene/identifierScan.js";
import { err, ok, unwrap } from "../../../../lib/result.js";
import {
  GITHUB_EXPOSURE_SUMMARY_FILE,
  GITHUB_EXPOSURE_UPLOADS_FILE,
  githubExposureRunDirectory,
  writeGithubExposureSweep,
} from "../../../../live/github/exposureFindingsStore.js";
import type { GithubExposureSurfaceResult } from "../../../../live/github/exposureModel.js";
import { githubExposureScanner } from "../../../../live/github/exposureScan.js";
import { type GithubExposureSweep, sweepGithubExposure } from "../../../../live/github/exposureSweep.js";
import { githubExposureSweepCoverage } from "../../../../live/github/exposureSweepCoverage.js";
import { githubExposureSweepLines, githubExposureUploadsLine } from "../../../../live/github/exposureSweepReport.js";
import type { GithubExposureText } from "../../../../live/github/exposureTexts.js";
import {
  createGithubExposureUploadIndex,
  type GithubExposureUpload,
  githubExposureUploadCounts,
  githubExposureUploadLinks,
} from "../../../../live/github/exposureUploads.js";
import { GithubJobLogErrors } from "../../../../live/github/jobLogErrors.js";
import type { StreamJobLog } from "../../../../live/github/jobLogRead.js";
import { fakeGithubExposureSeam } from "../../../githubExposureFake.js";

const ASSET = "https://github.com/user-attachments/assets/0a0a0a0a-1111-2222-3333-444444444444";
const FILE = "https://github.com/user-attachments/files/123456/notes.log";
const PRIVATE = "https://private-user-images.githubusercontent.com/42/0b0b0b0b-5555.png";

/** One text on a surface, at a locator and field. */
function text({
  locator,
  field = "body",
  body,
}: {
  locator: string;
  field?: string;
  body: string;
}): GithubExposureText {
  return { field, locator, surface: "pull-requests", text: body };
}

/** The uploads, each upload's links sorted by locator then field, uploads sorted by URL: order-free comparison. */
function sorted({ uploads }: { uploads: readonly GithubExposureUpload[] }): readonly GithubExposureUpload[] {
  return uploads
    .map((upload) => ({
      linkedFrom: upload.linkedFrom.toSorted((left, right) =>
        `${left.locator}\u0000${left.field}`.localeCompare(`${right.locator}\u0000${right.field}`),
      ),
      url: upload.url,
    }))
    .toSorted((left, right) => left.url.localeCompare(right.url));
}

describe("githubExposureUploadLinks", () => {
  it("lists each upload once with every place linking it, a repeat in one field counted once", () => {
    const uploads = githubExposureUploadLinks({
      texts: [
        text({ body: `![shot](${ASSET}) and again ${ASSET}`, locator: "pull #7" }),
        text({ body: `see ${ASSET}`, field: "title", locator: "pull #7" }),
        text({ body: `log at ${FILE}`, locator: "pull #9" }),
        text({ body: "https://example.com/x.png is not an upload", locator: "pull #10" }),
      ],
    });
    expect(uploads).toEqual([
      {
        linkedFrom: [
          { field: "body", locator: "pull #7", surface: "pull-requests" },
          { field: "title", locator: "pull #7", surface: "pull-requests" },
        ],
        url: ASSET,
      },
      { linkedFrom: [{ field: "body", locator: "pull #9", surface: "pull-requests" }], url: FILE },
    ]);
  });

  it("drops a signing query and a fragment, so one image read under two tokens is one upload", () => {
    const uploads = githubExposureUploadLinks({
      texts: [
        text({ body: `![a](${PRIVATE}?jwt=first-token)`, locator: "pull #1" }),
        text({ body: `${PRIVATE}?jwt=second-token#frag`, locator: "pull #2" }),
      ],
    });
    expect(uploads.map((upload) => upload.url)).toEqual([PRIVATE]);
    expect(JSON.stringify(uploads).includes("token")).toBe(false);
  });

  it("finds the older upload host and the repository-scoped upload paths, and no ordinary repository link", () => {
    const uploads = githubExposureUploadLinks({
      texts: [
        text({
          body: [
            "![old](https://user-images.githubusercontent.com/42/abc.png?token=signed#frag)",
            "https://github.com/acme/widgets/files/987/trace.txt",
            "https://github.com/acme/widgets/assets/42/0c0c0c0c-6666",
            "https://github.com/acme/widgets/pull/7 https://github.com/acme/widgets/blob/main/README.md",
          ].join("\n"),
          locator: "issue #3",
        }),
      ],
    });
    expect(uploads.map((upload) => upload.url)).toEqual([
      "https://user-images.githubusercontent.com/42/abc.png",
      "https://github.com/acme/widgets/files/987/trace.txt",
      "https://github.com/acme/widgets/assets/42/0c0c0c0c-6666",
    ]);
  });

  it("keeps two URL shapes ending in the same id as two uploads", () => {
    const uploads = githubExposureUploadLinks({
      texts: [
        text({
          body: "https://github.com/user-attachments/assets/abc-1 https://github.com/user-attachments/files/abc-1",
          locator: "pull #1",
        }),
      ],
    });
    expect(uploads.map((upload) => upload.url)).toEqual([
      "https://github.com/user-attachments/assets/abc-1",
      "https://github.com/user-attachments/files/abc-1",
    ]);
  });

  it("finds none in text that links none", () => {
    expect(githubExposureUploadLinks({ texts: [] })).toEqual([]);
    expect(githubExposureUploadLinks({ texts: [text({ body: "plain words", locator: "pull #1" })] })).toEqual([]);
  });
});

describe("createGithubExposureUploadIndex", () => {
  it("taken a batch at a time, matches the one-shot reading, and an earlier snapshot never changes", () => {
    const texts = [text({ body: ASSET, locator: "pull #1" }), text({ body: `${ASSET} ${FILE}`, locator: "pull #2" })];
    const index = createGithubExposureUploadIndex();
    index.take({ texts: texts.slice(0, 1) });
    const first = index.uploads();
    index.take({ texts: texts.slice(1) });
    expect(index.uploads()).toEqual(githubExposureUploadLinks({ texts }));
    expect(first).toEqual([
      { linkedFrom: [{ field: "body", locator: "pull #1", surface: "pull-requests" }], url: ASSET },
    ]);
  });
});

describe("githubExposureUploadCounts", () => {
  it("counts uploads and the places linking them", () => {
    const uploads = githubExposureUploadLinks({
      texts: [text({ body: ASSET, locator: "pull #1" }), text({ body: `${ASSET} ${FILE}`, locator: "pull #2" })],
    });
    expect(githubExposureUploadCounts({ uploads })).toEqual({ links: 3, uploads: 2 });
    expect(githubExposureUploadCounts({ uploads: [] })).toEqual({ links: 0, uploads: 0 });
  });
});

describe("githubExposureSweepCoverage for attachments", () => {
  const counted: GithubExposureSurfaceResult = {
    state: { count: 0, detail: "0 distinct uploaded asset(s) referenced", kind: "counted", limits: [] },
    surface: "attachments",
  };

  it("is not swept when the sweep found an upload the inventory's body-only count did not", () => {
    expect(
      githubExposureSweepCoverage({ result: counted, sweepGaps: [], sweepLimits: [], texts: 0, uploadCount: 1 }),
    ).toEqual({
      kind: "not-swept",
      texts: 0,
      why: [
        "each upload found is listed with every read place that links it in uploads.jsonl; its bytes are not read or analysed and are left for a visible session to look at",
      ],
    });
  });

  it("is swept when no text links an upload", () => {
    expect(
      githubExposureSweepCoverage({ result: counted, sweepGaps: [], sweepLimits: [], texts: 0, uploadCount: 0 }),
    ).toEqual({
      kind: "swept",
      limits: [],
      texts: 0,
    });
  });

  it("is not swept, carrying the listing's failure, when the body listings failed but another text linked an upload", () => {
    const failed: GithubExposureSurfaceResult = {
      state: { detail: "pulls could not be listed", kind: "read-failed", why: ["pulls: page 1 failed"] },
      surface: "attachments",
    };
    expect(
      githubExposureSweepCoverage({ result: failed, sweepGaps: [], sweepLimits: [], texts: 0, uploadCount: 1 }),
    ).toEqual({
      kind: "not-swept",
      texts: 0,
      why: [
        "each upload found is listed with every read place that links it in uploads.jsonl; its bytes are not read or analysed and are left for a visible session to look at",
        "pulls: page 1 failed",
      ],
    });
    expect(
      githubExposureSweepCoverage({ result: failed, sweepGaps: [], sweepLimits: [], texts: 0, uploadCount: 0 }),
    ).toEqual({ kind: "read-failed", why: ["pulls: page 1 failed"] });
  });

  it("leaves a failed artifact listing read-failed, as before the move", () => {
    const failed: GithubExposureSurfaceResult = {
      state: { detail: "artifacts could not be listed", kind: "read-failed", why: ["actions-artifacts: 500"] },
      surface: "actions-artifacts",
    };
    expect(
      githubExposureSweepCoverage({ result: failed, sweepGaps: [], sweepLimits: [], texts: 0, uploadCount: 3 }),
    ).toEqual({ kind: "read-failed", why: ["actions-artifacts: 500"] });
  });
});

/** A job log seam: job 11's log links the file upload, any other job is a fixture defect. */
const LOGS: StreamJobLog = ({ jobId }) => {
  if (jobId !== 11) {
    return Promise.resolve(err(GithubJobLogErrors.logUnavailable({ jobId })));
  }
  return Promise.resolve(
    ok(
      (async function* chunks(): AsyncIterable<string> {
        yield `uploading done, see ${FILE}\n`;
      })(),
    ),
  );
};

/** A repository linking uploads from a pull body, a commit message, a file version, a discussion and a job log. */
async function sweepWithUploads(): Promise<GithubExposureSweep> {
  const { seam } = fakeGithubExposureSeam({
    graphql: () =>
      ok({
        repository: {
          discussions: {
            nodes: [
              { body: `screenshot ${PRIVATE}?jwt=t`, comments: { nodes: [], totalCount: 0 }, number: 4, title: "q" },
            ],
            totalCount: 1,
          },
        },
      }),
    handlers: {
      "actions-jobs": () => ok({ jobs: [{ id: 11, name: "build" }], total_count: 1 }),
      "actions-runs": () => ok({ total_count: 1, workflow_runs: [{ id: 5, name: "ci" }] }),
      commits: () => ok([{ commit: { message: `fix, before: ${ASSET}`, tree: { sha: "tree-1" } }, sha: "sha-1" }]),
      "commit-detail": () =>
        ok({ files: [{ filename: "a.md", patch: `@@ -0,0 +1 @@\n+${FILE}`, sha: "blob-a", status: "added" }] }),
      "git-tree": () => ok({ tree: [{ path: "a.md", sha: "blob-a", type: "blob" }], truncated: false }),
      "matching-refs": ({ params }) =>
        ok(params["ref"] === "heads" ? [{ object: { sha: "sha-1", type: "commit" }, ref: "refs/heads/main" }] : []),
      pulls: () => ok([{ body: `![shot](${ASSET})`, head: { ref: "feature" }, number: 7, title: "add it" }]),
      repository: () => ok({ has_discussions: true, has_pages: false, has_wiki: false, topics: [] }),
    },
  });
  const scanner = githubExposureScanner({
    denylist: [],
    identifiers: identifierScanner({
      rules: {
        hashed: {
          embeddedUpper: [],
          exactIds: [],
          exemptTicketReferences: [],
          spanHeads: [],
          substringCi: [],
          substringCs: [],
          teamKeys: [],
          wordCi: [],
          wordCs: [],
        },
        providerLocations: [],
      },
    }),
    ownHome: ["", "Users", "sweeper"].join("/"),
  });
  return unwrap(
    await sweepGithubExposure({
      nowIso: () => "2026-11-19T00:00:00.000Z",
      owner: "acme",
      repo: "widgets",
      scanner,
      seam,
      streamLog: LOGS,
    }),
  );
}

describe("sweepGithubExposure uploads", () => {
  it("indexes every upload from every kind of text it reads, its bytes never fetched", async () => {
    const sweep = await sweepWithUploads();
    expect(sorted({ uploads: sweep.uploads })).toEqual([
      {
        linkedFrom: [
          { field: "commit.message", locator: "commit sha-1", surface: "commits" },
          { field: "body", locator: "pull #7", surface: "pull-requests" },
        ],
        url: ASSET,
      },
      {
        linkedFrom: [
          { field: "patch", locator: "commit sha-1 file a.md", surface: "file-history" },
          { field: "log", locator: "job 11 log", surface: "actions-jobs" },
        ],
        url: FILE,
      },
      { linkedFrom: [{ field: "body", locator: "discussion #4", surface: "discussions" }], url: PRIVATE },
    ]);
    expect(sweep.surfaces.find((surface) => surface.surface === "attachments")!.coverage.kind).toBe("not-swept");
  });

  it("prints the upload counts and where they are listed, and no URL or locator", async () => {
    const sweep = await sweepWithUploads();
    expect(githubExposureUploadsLine({ reportPath: "evidence/github-exposure/run-1", sweep })).toBe(
      "  3 upload(s) linked from 5 read place(s); bytes not read or analysed, left for a visible session to look at; listed in evidence/github-exposure/run-1/uploads.jsonl under the state home",
    );
    const printed = githubExposureSweepLines({ reportPath: "evidence/github-exposure/run-1", sweep }).join("\n");
    expect(
      ["user-attachments", "private-user-images", "pull #7", "job 11", "discussion #4"].filter((leak) =>
        printed.includes(leak),
      ),
    ).toEqual([]);
  });
});

describe("writeGithubExposureSweep uploads", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("writes every upload owner-only beside the findings, and only its counts into the summary", async () => {
    const home = mkdtempSync(join(tmpdir(), "exposure-uploads-"));
    homes.push(home);
    const sweep = await sweepWithUploads();
    const directory = githubExposureRunDirectory({
      home,
      nonce: "n0nce000",
      readAtIso: sweep.readAtIso,
      repository: sweep.repository,
    });
    expect(writeGithubExposureSweep({ complete: false, directory: directory.absolute, sweep }).isOk()).toBe(true);
    const uploadsPath = join(directory.absolute, GITHUB_EXPOSURE_UPLOADS_FILE);
    const written = readFileSync(uploadsPath, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line): unknown => JSON.parse(line));
    expect(written).toEqual(sweep.uploads);
    expect(statSync(uploadsPath).mode & 0o777).toBe(0o600);
    const summaryText = readFileSync(join(directory.absolute, GITHUB_EXPOSURE_SUMMARY_FILE), "utf8");
    expect(JSON.parse(summaryText)).toMatchObject({ schemaVersion: 2, uploadLinks: 5, uploads: 3 });
    expect(["user-attachments", "private-user-images", "jwt"].filter((leak) => summaryText.includes(leak))).toEqual([]);
  });
});
