import { describe, expect, it } from "vitest";

import { err, ok, unwrap } from "../../../../lib/result.js";
import { diffOnBaseQuery, withDiffOnBase } from "../../../../live/github/diffOnBase.js";
import { GithubLiveErrors } from "../../../../live/github/errors.js";
import type { GithubReadGraphql } from "../../../../live/github/read.js";
import type { ProviderReadDocument } from "../../../../live/providerRead.js";

const HEAD = "head0000";
const TIP = "tip11111";
const CHECKED = "2026-10-15T19:49:37.146Z";

/** The `contents_url` GitHub writes on a file entry diffed at `ref`. */
function contentsUrl({ path, ref = HEAD }: { path: string; ref?: string }): string {
  return `https://api.github.com/repos/o/r/contents/${encodeURIComponent(path)}?ref=${ref}`;
}

const LANDED = {
  contents_url: contentsUrl({ path: "a.ts" }),
  filename: "a.ts",
  patch: "@@ -1,3 +1,3 @@\n a\n-old\n+new\n b",
  sha: "blobA",
  status: "modified",
};
const RENAMED = {
  contents_url: contentsUrl({ path: "b.ts" }),
  filename: "b.ts",
  patch: "@@ -1 +1 @@\n-x\n+y",
  previous_filename: "old.ts",
  sha: "blobB",
  status: "renamed",
};
const GONE = { contents_url: contentsUrl({ path: "c.png" }), filename: "c.png", sha: "blobC", status: "removed" };

/** The head commit's blob at a path, with LANDED's post-image as its text, as the query's `h<index>` alias answers it. */
const AT_HEAD = {
  mode: 0o100644,
  object: { __typename: "Blob", isBinary: false, isTruncated: false, text: "a\nnew\nb\n" },
  oid: "blobA",
};

/** A pull request's `--files` read, in the field order `read.ts` and `pullFiles.ts` write. */
function pullDocument({
  merged = false,
  files,
  totalCount = files.length,
  changedFiles = files.length,
}: {
  merged?: boolean;
  files: readonly unknown[];
  totalCount?: number;
  changedFiles?: number;
}): ProviderReadDocument {
  return {
    coverage: { detail: "one named object", kind: "bounded", residue: [] },
    data: {
      __typename: "PullRequest",
      state: merged ? "MERGED" : "OPEN",
      merged,
      baseRefName: "staging",
      changedFiles,
      commits: { nodes: [{ commit: { oid: HEAD } }], totalCount: 1 },
      body: "the description",
      comments: { nodes: [] },
      files: { nodes: files, pageInfo: { endCursor: null, hasNextPage: false }, totalCount },
    },
    readAtIso: "2026-10-15T19:49:30.000Z",
    source: "github",
    target: { address: "https://github.com/o/r/pull/7", identity: "o/r#7", kind: "pull-request" },
  };
}

/** A GraphQL seam answering one document and recording what it was asked. */
function graphqlAnswering({ answer, asked }: { answer: unknown; asked: unknown[] }): GithubReadGraphql {
  return ({ query, variables, missingFileReadsNull }) => {
    asked.push({ missingFileReadsNull, query, variables });
    return Promise.resolve(ok(answer));
  };
}

/** GitHub's answer: the head now with its blob per alias, and the base tip with one tree entry per alias. */
function answerWith({
  head = HEAD,
  baseRefName = "staging",
  headEntries,
  entries,
}: {
  head?: string;
  baseRefName?: string;
  headEntries: Record<string, unknown>;
  entries: Record<string, unknown>;
}): unknown {
  return {
    repository: {
      pullRequest: {
        baseRefName,
        commits: { nodes: [{ commit: { oid: head, ...headEntries } }] },
        headRefOid: head,
      },
      ref: { target: { __typename: "Commit", oid: TIP, ...entries } },
    },
  };
}

/** A readable text blob as GitHub answers one, a plain file unless `mode` names another. */
function blob({ text, mode = 0o100644 }: { text: string; mode?: number }): unknown {
  return { mode, object: { __typename: "Blob", isBinary: false, isTruncated: false, text } };
}

/** The receipt a read carries, joined with the per-file list it carries separately as `files`. */
function receiptOf({ read }: { read: ProviderReadDocument }): unknown {
  const data = read.data as Record<string, unknown>;
  return { ...(data["diffOnBase"] as Record<string, unknown>), files: data["diffOnBaseFiles"] };
}

/** What a landed file's read answers when its head blob is `headEntry`. */
async function landedWithHead({ headEntry }: { headEntry: unknown }): Promise<unknown> {
  const read = unwrap(
    await withDiffOnBase({
      document: pullDocument({ files: [LANDED] }),
      graphql: graphqlAnswering({
        answer: answerWith({ entries: { f0: blob({ text: "a\nnew\nb\n" }) }, headEntries: { h0: headEntry } }),
        asked: [],
      }),
      nowIso: () => CHECKED,
    }),
  );
  return receiptOf({ read });
}

describe("withDiffOnBase", () => {
  it("reads every judged path from the one base commit, the receipt ahead of the CI rollup and its files last", async () => {
    const asked: unknown[] = [];

    const read = unwrap(
      await withDiffOnBase({
        document: pullDocument({ files: [LANDED, RENAMED, GONE] }),
        graphql: graphqlAnswering({
          answer: answerWith({
            entries: { f0: blob({ text: "a\nnew\nb\n" }), f1: null },
            headEntries: { h0: AT_HEAD, h1: null },
          }),
          asked,
        }),
        nowIso: () => CHECKED,
      }),
    );

    expect(asked).toEqual([
      {
        // A path a side does not hold comes back as GitHub's NOT_FOUND beside a null alias, so it asks for that data.
        missingFileReadsNull: true,
        query: diffOnBaseQuery({ paths: ["a.ts", "c.png"] }),
        variables: { base: "refs/heads/staging", number: 7, owner: "o", p0: "a.ts", p1: "c.png", repo: "r" },
      },
    ]);
    expect(Object.keys(read.data as Record<string, unknown>)).toEqual([
      "__typename",
      "state",
      "merged",
      "baseRefName",
      "changedFiles",
      "diffOnBase",
      "commits",
      "body",
      "comments",
      "files",
      "diffOnBaseFiles",
    ]);
    // The verdict leads, so a prefix cut loses detail before it loses the answer.
    expect(Object.keys((read.data as Record<string, unknown>)["diffOnBase"] as Record<string, unknown>)).toEqual([
      "verdict",
      "reason",
      "baseRef",
      "baseOid",
      "checkedAtIso",
    ]);
    expect(receiptOf({ read })).toEqual({
      baseOid: TIP,
      baseRef: "staging",
      checkedAtIso: CHECKED,
      files: [
        { filename: "a.ts", verdict: "on-base" },
        { filename: "b.ts", reason: "GitHub calls it renamed, which this check does not judge", verdict: "unknown" },
        { filename: "c.png", verdict: "on-base" },
      ],
      reason: "b.ts: GitHub calls it renamed, which this check does not judge",
      verdict: "unknown",
    });
  });

  it("selects each file under the base ref's commit and the head commit, never as a branch expression", () => {
    const query = diffOnBaseQuery({ paths: ["a.ts", "b.ts"] });

    expect(query).toContain("$base: String!, $p0: String!, $p1: String!");
    expect(query).toContain("ref(qualifiedName: $base)");
    expect(query).toContain("f1: file(path: $p1)");
    expect(query).toContain(
      "h1: file(path: $p1) { oid mode object { __typename ... on Blob { text isBinary isTruncated } } }",
    );
    expect(query).toContain(
      "f1: file(path: $p1) { mode object { __typename ... on Blob { text isBinary isTruncated } } }",
    );
    expect(query).not.toContain("expression");
  });

  it("certifies a landed file whose head blob is the one the list carried", async () => {
    expect(await landedWithHead({ headEntry: AT_HEAD })).toEqual({
      baseOid: TIP,
      baseRef: "staging",
      checkedAtIso: CHECKED,
      files: [{ filename: "a.ts", verdict: "on-base" }],
      verdict: "on-base",
    });
  });

  it("answers unknown when the base holds the head's text under another file mode, or GitHub gave none", async () => {
    const fileFor = async ({ baseEntry }: { baseEntry: unknown }) => {
      const read = unwrap(
        await withDiffOnBase({
          document: pullDocument({ files: [LANDED] }),
          graphql: graphqlAnswering({
            answer: answerWith({ entries: { f0: baseEntry }, headEntries: { h0: { ...AT_HEAD, mode: 0o100755 } } }),
            asked: [],
          }),
          nowIso: () => CHECKED,
        }),
      );
      return (receiptOf({ read }) as { files: readonly unknown[] }).files[0];
    };

    expect([
      await fileFor({ baseEntry: blob({ text: "a\nnew\nb\n" }) }),
      await fileFor({ baseEntry: { object: { __typename: "Blob", isBinary: false, isTruncated: false, text: "x" } } }),
      await fileFor({ baseEntry: blob({ mode: 0o100755, text: "a\nnew\nb\n" }) }),
    ]).toEqual([
      { filename: "a.ts", reason: "the base holds it as mode 100644, the head as 100755", verdict: "unknown" },
      { filename: "a.ts", reason: "GitHub answered no file mode for it", verdict: "unknown" },
      { filename: "a.ts", verdict: "on-base" },
    ]);
  });

  it("answers unknown when the list holds fewer files than GitHub counted, even on its last page", async () => {
    const receiptFor = async ({ totalCount, changedFiles }: { totalCount: number; changedFiles: number }) => {
      const read = unwrap(
        await withDiffOnBase({
          document: pullDocument({ changedFiles, files: [LANDED], totalCount }),
          graphql: graphqlAnswering({
            answer: answerWith({ entries: { f0: blob({ text: "a\nnew\nb\n" }) }, headEntries: { h0: AT_HEAD } }),
            asked: [],
          }),
          nowIso: () => CHECKED,
        }),
      );
      return receiptOf({ read }) as Record<string, unknown>;
    };
    const shortOfTotal = await receiptFor({ changedFiles: 1, totalCount: 2 });
    const shortOfChanged = await receiptFor({ changedFiles: 2, totalCount: 1 });

    expect([shortOfTotal["reason"], shortOfChanged["reason"]]).toEqual([
      "GitHub listed only part of its changed files",
      "GitHub listed only part of its changed files",
    ]);
  });

  it("answers unknown when the head's oid moved between the file list and the base read", async () => {
    const read = unwrap(
      await withDiffOnBase({
        document: pullDocument({ files: [LANDED] }),
        graphql: graphqlAnswering({
          answer: answerWith({
            entries: { f0: blob({ text: "a\nnew\nb\n" }) },
            head: "moved999",
            headEntries: { h0: AT_HEAD },
          }),
          asked: [],
        }),
        nowIso: () => CHECKED,
      }),
    );

    expect(receiptOf({ read })).toEqual({
      baseOid: TIP,
      baseRef: "staging",
      checkedAtIso: CHECKED,
      files: [{ filename: "a.ts", verdict: "on-base" }],
      reason: "the head moved while it was read — read it again",
      verdict: "unknown",
    });
  });

  it("answers unknown, naming no tip, when the pull request was retargeted between the two reads", async () => {
    const read = unwrap(
      await withDiffOnBase({
        document: pullDocument({ files: [LANDED] }),
        graphql: graphqlAnswering({
          answer: answerWith({
            baseRefName: "main",
            entries: { f0: blob({ text: "a\nnew\nb\n" }) },
            headEntries: { h0: AT_HEAD },
          }),
          asked: [],
        }),
        nowIso: () => CHECKED,
      }),
    );

    expect(receiptOf({ read })).toEqual({
      baseOid: null,
      baseRef: "staging",
      checkedAtIso: CHECKED,
      files: [],
      reason: "the pull request's base changed while it was read — read it again",
      verdict: "unknown",
    });
  });

  it("answers unknown when the head's oid is back where it was but its blob is not the listed one (A→B→A)", async () => {
    const receipt = (await landedWithHead({ headEntry: { oid: "blobFromAnotherHead" } })) as Record<string, unknown>;

    expect(receipt["verdict"]).toBe("unknown");
    expect(receipt["reason"]).toBe("the head moved while it was read — read it again");
  });

  it("answers unknown when the head holds no blob at a path the list called modified", async () => {
    const receipt = (await landedWithHead({ headEntry: null })) as Record<string, unknown>;

    expect(receipt["verdict"]).toBe("unknown");
    expect(receipt["reason"]).toBe("the head moved while it was read — read it again");
  });

  it("answers unknown when the head still holds a file the list called removed", async () => {
    const read = unwrap(
      await withDiffOnBase({
        document: pullDocument({ files: [GONE] }),
        graphql: graphqlAnswering({
          answer: answerWith({ entries: { f0: null }, headEntries: { h0: AT_HEAD } }),
          asked: [],
        }),
        nowIso: () => CHECKED,
      }),
    );

    expect((receiptOf({ read }) as Record<string, unknown>)["reason"]).toBe(
      "the head moved while it was read — read it again",
    );
  });

  it("answers unknown when the list was diffed at another head, even with the same blobs", async () => {
    const read = unwrap(
      await withDiffOnBase({
        document: pullDocument({
          files: [{ ...LANDED, contents_url: contentsUrl({ path: "a.ts", ref: "headB999" }) }],
        }),
        graphql: graphqlAnswering({
          answer: answerWith({ entries: { f0: blob({ text: "a\nnew\nb\n" }) }, headEntries: { h0: AT_HEAD } }),
          asked: [],
        }),
        nowIso: () => CHECKED,
      }),
    );

    expect((receiptOf({ read }) as Record<string, unknown>)["reason"]).toBe(
      "the head moved while it was read — read it again",
    );
  });

  it("answers unknown when the list carried no blob sha to bind it to the head", async () => {
    const { sha: _sha, ...unbound } = LANDED;
    const read = unwrap(
      await withDiffOnBase({
        document: pullDocument({ files: [unbound] }),
        graphql: graphqlAnswering({
          answer: answerWith({ entries: { f0: blob({ text: "a\nnew\nb\n" }) }, headEntries: { h0: AT_HEAD } }),
          asked: [],
        }),
        nowIso: () => CHECKED,
      }),
    );

    expect((receiptOf({ read }) as Record<string, unknown>)["verdict"]).toBe("unknown");
  });

  it("reads a binary, truncated or missing-from-the-answer base copy as unread rather than throwing", async () => {
    const read = unwrap(
      await withDiffOnBase({
        document: pullDocument({ files: [LANDED, { ...LANDED, filename: "d.ts" }, { ...LANDED, filename: "e.ts" }] }),
        graphql: graphqlAnswering({
          answer: answerWith({
            entries: {
              f0: { object: { __typename: "Blob", isBinary: true, isTruncated: false, text: null } },
              f1: { object: { __typename: "Blob", isBinary: false, isTruncated: true, text: "a" } },
            },
            headEntries: { h0: AT_HEAD, h1: AT_HEAD, h2: AT_HEAD },
          }),
          asked: [],
        }),
        nowIso: () => CHECKED,
      }),
    );

    expect((receiptOf({ read }) as { files: unknown }).files).toEqual([
      { filename: "a.ts", reason: "the base's copy is binary", verdict: "unknown" },
      { filename: "d.ts", reason: "GitHub cut the base's copy short", verdict: "unknown" },
      { filename: "e.ts", reason: "GitHub answered nothing for that path", verdict: "unknown" },
    ]);
  });

  it("leaves a merged pull request untouched and asks GitHub nothing", async () => {
    const asked: unknown[] = [];
    const document = pullDocument({ files: [LANDED], merged: true });

    const read = unwrap(
      await withDiffOnBase({ document, graphql: graphqlAnswering({ answer: {}, asked }), nowIso: () => CHECKED }),
    );

    expect(read).toEqual(document);
    expect(asked).toEqual([]);
  });

  it("keeps the files and says unknown, naming no tip, when the base branch is not there", async () => {
    const document = pullDocument({ files: [LANDED] });
    const read = unwrap(
      await withDiffOnBase({
        document,
        graphql: graphqlAnswering({
          answer: {
            repository: {
              pullRequest: {
                baseRefName: "staging",
                commits: { nodes: [{ commit: { h0: AT_HEAD, oid: HEAD } }] },
                headRefOid: HEAD,
              },
              ref: null,
            },
          },
          asked: [],
        }),
        nowIso: () => CHECKED,
      }),
    );

    expect(receiptOf({ read })).toEqual({
      baseOid: null,
      baseRef: "staging",
      checkedAtIso: CHECKED,
      files: [],
      reason: "GitHub found no branch staging to read",
      verdict: "unknown",
    });
    expect((read.data as Record<string, unknown>)["files"]).toEqual(
      (document.data as Record<string, unknown>)["files"],
    );
  });

  it("keeps the files and says unknown with GitHub's own words when the check itself fails", async () => {
    const document = pullDocument({ files: [LANDED] });

    const read = unwrap(
      await withDiffOnBase({
        document,
        graphql: () => Promise.resolve(err(GithubLiveErrors.readFailed({ message: "GitHub said 502" }))),
        nowIso: () => CHECKED,
      }),
    );

    expect(receiptOf({ read })).toEqual({
      baseOid: null,
      baseRef: "staging",
      checkedAtIso: CHECKED,
      files: [],
      reason: "GitHub did not answer the check: GitHub said 502",
      verdict: "unknown",
    });
    expect((read.data as Record<string, unknown>)["files"]).toEqual(
      (document.data as Record<string, unknown>)["files"],
    );
  });

  it("keeps the files and says unknown when GitHub answers no head commit", async () => {
    const read = unwrap(
      await withDiffOnBase({
        document: pullDocument({ files: [LANDED] }),
        graphql: graphqlAnswering({
          answer: { repository: { pullRequest: null, ref: { target: { __typename: "Commit", oid: TIP } } } },
          asked: [],
        }),
        nowIso: () => CHECKED,
      }),
    );

    expect((receiptOf({ read }) as Record<string, unknown>)["reason"]).toBe("GitHub answered no head commit for it");
  });
});
