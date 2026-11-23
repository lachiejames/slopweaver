/*
 * The pure half of `github pr review-prepare` and `review-record`: their arguments, the `--images` and `--comments`
 * files (`prDescriptionReviewFiles.ts`), the session a process runs in, and the commands printed for the fresh
 * reviewer.
 */
import { describe, expect, it } from "vitest";

import {
  descriptionReviewCommands,
  parseGithubPrReviewPrepareArgs,
  parseGithubPrReviewRecordArgs,
  visibleSessionOf,
} from "../../../../../cli/commands/github/prDescriptionReviewCore.js";
import {
  parseDescriptionComments,
  parseDescriptionImages,
} from "../../../../../cli/commands/github/prDescriptionReviewFiles.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { DESCRIPTION_REVIEW_PROPERTY_ID } from "../../../../../outbound/github/descriptionReviewTypes.js";

const IDENTITY = ["--repo", "acme/widgets", "--base", "main", "--title", "fix: a title", "--body-file", "/tmp/b.md"];
const REQUIRED = [...IDENTITY, "--comments", "/tmp/c.json", "--new"];

describe("parseGithubPrReviewPrepareArgs", () => {
  it("defaults the base ref to the remote branch and the head to HEAD", () => {
    const args = unwrap(parseGithubPrReviewPrepareArgs({ rest: REQUIRED }));
    expect(args.baseRef).toBe("origin/main");
    expect(args.headRef).toBe("HEAD");
    expect(args.cwd).toBe(undefined);
    expect(args.evidenceFiles).toStrictEqual([]);
    expect(args.json).toBe(false);
    expect(args.commentsFile).toBe("/tmp/c.json");
    expect(args.pullRequest).toStrictEqual({ kind: "new" });
  });

  it("names an open pull request by number", () => {
    const rest = [...IDENTITY, "--comments", "/tmp/c.json", "--number", "42"];
    expect(unwrap(parseGithubPrReviewPrepareArgs({ rest })).pullRequest).toStrictEqual({
      kind: "existing",
      number: 42,
    });
  });

  it("refuses both --new and --number, and neither", () => {
    const both = [...REQUIRED, "--number", "42"];
    const neither = [...IDENTITY, "--comments", "/tmp/c.json"];
    const expected = "name exactly one of --new (a pull request not yet opened) or --number <n> (an open one)";
    expect(unwrapErr(parseGithubPrReviewPrepareArgs({ rest: both })).message).toBe(expected);
    expect(unwrapErr(parseGithubPrReviewPrepareArgs({ rest: neither })).message).toBe(expected);
  });

  it("refuses a number that is not a positive integer", () => {
    const rest = [...IDENTITY, "--comments", "/tmp/c.json", "--number", "0"];
    expect(unwrapErr(parseGithubPrReviewPrepareArgs({ rest })).message).toBe(
      '--number must be a positive integer; got "0"',
    );
  });

  it("takes every optional flag as given", () => {
    const rest = [
      ...REQUIRED,
      "--base-ref",
      "upstream/main",
      "--head",
      "feature",
      "--branch",
      "a-branch",
      "--cwd",
      "/tmp/checkout",
      "--images",
      "/tmp/images.json",
      "--evidence",
      "/tmp/a.md,/tmp/b.md",
      "--json",
      "--home",
      "/tmp/home",
    ];
    const args = unwrap(parseGithubPrReviewPrepareArgs({ rest }));
    expect(args.baseRef).toBe("upstream/main");
    expect(args.headRef).toBe("feature");
    expect(args.branch).toBe("a-branch");
    expect(args.cwd).toBe("/tmp/checkout");
    expect(args.imagesFile).toBe("/tmp/images.json");
    expect(args.evidenceFiles).toStrictEqual(["/tmp/a.md", "/tmp/b.md"]);
    expect(args.home).toBe("/tmp/home");
    expect(args.json).toBe(true);
  });

  it("names every missing required flag at once", () => {
    const failure = unwrapErr(parseGithubPrReviewPrepareArgs({ rest: ["--repo", "acme/widgets"] }));
    expect(failure.code).toBe("USAGE");
    expect(failure.message).toBe(
      "--base is required; --title is required; --body-file is required; --comments is required; " +
        "name exactly one of --new (a pull request not yet opened) or --number <n> (an open one)",
    );
  });

  it("refuses a repository that is not owner/name", () => {
    const rest = ["--repo", "widgets", ...REQUIRED.slice(2)];
    expect(rest).toContain("--new");
    expect(unwrapErr(parseGithubPrReviewPrepareArgs({ rest })).message).toBe(
      '--repo must be owner/name; got "widgets"',
    );
  });
});

describe("parseDescriptionComments", () => {
  const SOURCE = "/tmp/c.json";

  it("reads each entry into a comment", () => {
    const text = JSON.stringify([{ body: "💡 Why this branch exists.", line: 4, path: "src/a.ts" }]);
    expect(unwrap(parseDescriptionComments({ source: SOURCE, text }))).toStrictEqual([
      { body: "💡 Why this branch exists.", line: 4, path: "src/a.ts" },
    ]);
  });

  it("reads an empty array as no comments", () => {
    expect(unwrap(parseDescriptionComments({ source: SOURCE, text: "[]\n" }))).toStrictEqual([]);
  });

  it("refuses an unknown field rather than dropping it from what the review binds", () => {
    const text = JSON.stringify([{ body: "b", line: 4, path: "src/a.ts", side: "LEFT" }]);
    expect(unwrapErr(parseDescriptionComments({ source: SOURCE, text })).message).toBe(
      "/tmp/c.json[0] carries unknown fields: side",
    );
  });

  it("refuses a line that is not a positive integer", () => {
    const text = JSON.stringify([{ body: "b", line: 0, path: "src/a.ts" }]);
    expect(unwrapErr(parseDescriptionComments({ source: SOURCE, text })).message).toBe(
      "/tmp/c.json[0] must be { path, line, body } with a positive integer line",
    );
  });

  it("refuses a file that is not a JSON array", () => {
    expect(unwrapErr(parseDescriptionComments({ source: SOURCE, text: "{}" })).message).toBe(
      "/tmp/c.json must be a JSON array of comments",
    );
  });
});

describe("parseGithubPrReviewRecordArgs", () => {
  it("takes the review id", () => {
    const args = unwrap(parseGithubPrReviewRecordArgs({ rest: ["--review", "pass-1", "--json"] }));
    expect(args.reviewId).toBe("pass-1");
    expect(args.json).toBe(true);
  });

  it("refuses with no review id", () => {
    const failure = unwrapErr(parseGithubPrReviewRecordArgs({ rest: [] }));
    expect(failure.message).toBe("--review is required: the Codex artifact or Claude fallback receipt id");
  });
});

describe("parseDescriptionImages", () => {
  const entry = {
    file: "/tmp/shot.png",
    proves: "The page loads.",
    receiptId: "upload-1",
    sha256: "a".repeat(64),
    url: "https://github.com/user-attachments/assets/1",
  };

  it("reads each entry into an image and its file", () => {
    const images = unwrap(parseDescriptionImages({ source: "images.json", text: JSON.stringify([entry]) }));
    expect(images).toStrictEqual([
      {
        file: "/tmp/shot.png",
        image: {
          proves: "The page loads.",
          receiptId: "upload-1",
          sha256: "a".repeat(64),
          url: "https://github.com/user-attachments/assets/1",
        },
      },
    ]);
  });

  it("names the missing fields of an entry", () => {
    const text = JSON.stringify([{ ...entry, proves: "", receiptId: undefined }]);
    const failure = unwrapErr(parseDescriptionImages({ source: "images.json", text }));
    expect(failure.message).toBe("images.json[0] is missing proves, receiptId");
  });

  it("refuses a digest that is not sha256 hex", () => {
    const text = JSON.stringify([{ ...entry, sha256: "ABC" }]);
    const failure = unwrapErr(parseDescriptionImages({ source: "images.json", text }));
    expect(failure.message).toBe("images.json[0].sha256 must be 64 lowercase hex characters");
  });

  it("refuses a file that is not a JSON array", () => {
    expect(unwrapErr(parseDescriptionImages({ source: "images.json", text: "{}" })).message).toBe(
      "images.json must be a JSON array of images",
    );
    expect(unwrapErr(parseDescriptionImages({ source: "images.json", text: "nope" })).message).toBe(
      "images.json is not JSON: invalid JSON",
    );
  });
});

describe("visibleSessionOf", () => {
  it("names a Claude Code session", () => {
    expect(visibleSessionOf({ env: { CLAUDE_CODE_SESSION_ID: "s-1" } })).toStrictEqual({
      host: "claude-code",
      id: "s-1",
    });
  });

  it("names no session when the environment names two", () => {
    expect(visibleSessionOf({ env: { CLAUDE_CODE_SESSION_ID: "s-1", CODEX_THREAD_ID: "t-1" } })).toBe(null);
  });

  it("names no session when the environment names none", () => {
    expect(visibleSessionOf({ env: {} })).toBe(null);
  });
});

describe("descriptionReviewCommands", () => {
  const commands = descriptionReviewCommands({
    home: "/tmp/home",
    maxDiffBytes: 5000,
    preparation: {
      baseSha: "1".repeat(40),
      createdAtIso: "2026-11-17T01:00:00.000Z",
      headSha: "2".repeat(40),
      manifest: {
        baseBranch: "main",
        bodySha256: "b".repeat(64),
        changeDigest: "c".repeat(64),
        commentsSha256: "d".repeat(64),
        existingCommentsSha256: "e".repeat(64),
        images: [],
        repository: "acme/widgets",
        rulesSha256: "r".repeat(64),
        schemaVersion: 2,
        titleSha256: "t".repeat(64),
      },
      manifestSha256: "m".repeat(64),
      preparationId: "prep-1",
      preparedBy: null,
      schemaVersion: 2,
    },
    repoRoot: "/tmp/home/pr-description-reviews/preparations/prep-1/repo",
  });

  it("points Codex at the packet with the five-question property and its base commit", () => {
    expect(commands.review).toContain("slopweaver codex review --pass r1");
    expect(commands.review).toContain(`--property-id ${DESCRIPTION_REVIEW_PROPERTY_ID}`);
    expect(commands.review).toContain("never stop at the first violation");
    expect(commands.review).toContain(`--base ${"1".repeat(40)} --max-diff-bytes 5000`);
    expect(commands.review).toContain("--repo /tmp/home/pr-description-reviews/preparations/prep-1/repo");
  });

  it("offers the visible Claude fallback over the same packet and property", () => {
    expect(commands.fallbackPrepare).toContain("slopweaver codex review-fallback prepare --pass r1");
    expect(commands.fallbackPrepare).toContain(`--property-id ${DESCRIPTION_REVIEW_PROPERTY_ID}`);
    expect(commands.fallbackPrepare).toContain("never stop at the first violation");
    expect(commands.fallbackRecord).toContain("slopweaver codex review-fallback record --request");
  });

  it("ends on the record that writes the receipt", () => {
    expect(commands.record).toBe(
      "slopweaver github pr review-record --review '<artifact-or-receipt-id>' --home /tmp/home",
    );
  });
});
