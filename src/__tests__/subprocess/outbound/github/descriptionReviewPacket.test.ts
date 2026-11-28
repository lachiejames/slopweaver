/*
 * The packet a fresh reviewer reads, built over real git: the images alone in the base commit, every text file (the
 * README, rules, change set, records and the description) in the head so the review's diff carries it, and nothing
 * written when an image's bytes, the manifest or a NUL byte disagree with what the author declared.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { gitCommitDiffCommand } from "../../../../codex/diff.js";
import { runGitChecked } from "../../../../codex/gitRun.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { buildDescriptionManifest, rulesSha256Of } from "../../../../outbound/github/descriptionReview.js";
import {
  type PacketContents,
  type PacketImage,
  prepareDescriptionPacket,
} from "../../../../outbound/github/descriptionReviewPacket.js";
import { preparationsDirectory } from "../../../../outbound/github/descriptionReviewStore.js";
import {
  DESCRIPTION_REVIEW_EVERY_VIOLATION,
  type DescriptionReviewComment,
  type ExistingPullRequestComment,
} from "../../../../outbound/github/descriptionReviewTypes.js";
import { gitInTemp } from "../../../tempGitRepo.js";

/**
 * The line git prints in place of a file it will not diff as text. Matched at a line start, because the packet's own
 * README says "Binary files appear in the delta" as an added `+` line.
 */
const GIT_BINARY_MARKER = /^Binary files /m;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const PNG_SHA = createHash("sha256").update(PNG).digest("hex");
const RULES = [{ contents: "# rule\n\nNo walls of text.\n", path: "skills/github/reference/pull-requests.md" }];
const IMAGE: PacketImage = {
  bytes: PNG,
  extension: "png",
  image: {
    proves: "The widget count reads 2.",
    receiptId: "upload-1",
    sha256: PNG_SHA,
    url: "https://github.com/user-attachments/assets/fixture-1",
  },
};

/** Packet contents whose manifest is built from the same title, body and images. */
function contentsWith({
  images,
  comments = [],
}: {
  images: readonly PacketImage[];
  comments?: readonly DescriptionReviewComment[];
}): PacketContents {
  const title = "fix(widgets): count every widget once";
  const body = "Counts each widget once.\n";
  return {
    attachUploadPermitted: true,
    body,
    comments,
    change: { deltaLines: ["M 100644 100644 src/count.ts"], patch: "diff --git a/src/count.ts b/src/count.ts\n" },
    evidence: [{ contents: "The owner asked for this.\n", name: "owner-words.md" }],
    existingComments: [],
    images,
    manifest: buildDescriptionManifest({
      baseBranch: "main",
      body,
      changeDigest: "c".repeat(64),
      comments,
      existingComments: [],
      images: images.map((one) => one.image),
      repository: "acme/widgets",
      rulesSha256: rulesSha256Of({ files: RULES }),
      title,
    }),
    rules: RULES,
    rulesOrigin: { kind: "installed" },
    title,
  };
}

describe("prepareDescriptionPacket", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sw-desc-packet-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** Prepare one packet under the test home. */
  function prepare({ contents, preparationId }: { contents: PacketContents; preparationId: string }) {
    return prepareDescriptionPacket({
      contents,
      createdAtIso: "2026-11-17T01:00:00.000Z",
      home,
      preparationId,
      preparedBy: { host: "claude-code", id: "writer" },
    });
  }

  /** The exact diff a review of a packet reads, untrimmed, through the runner the packet's digest was taken under. */
  function reviewDiff({ repoRoot, baseSha, headSha }: { repoRoot: string; baseSha: string; headSha: string }) {
    return runGitChecked({
      args: gitCommitDiffCommand({ commit: headSha, mergeBase: baseSha }).args,
      cwd: repoRoot,
      label: "git diff",
    });
  }

  it("commits only the attributes and the images as the base, and every text file as the head", () => {
    const { diffBytes, preparation, repoRoot } = unwrap(
      prepare({ contents: contentsWith({ images: [IMAGE] }), preparationId: "p1" }),
    );
    const baseFiles = gitInTemp({ args: ["ls-tree", "-r", "--name-only", preparation.baseSha], cwd: repoRoot });
    expect(baseFiles.split("\n")).toStrictEqual([".gitattributes", `images/${PNG_SHA}.png`]);
    const headOnly = gitInTemp({
      args: ["diff", "--name-only", preparation.baseSha, preparation.headSha],
      cwd: repoRoot,
    });
    expect(headOnly.split("\n")).toStrictEqual([
      "README.md",
      "change/delta.txt",
      "change/diff.patch",
      "description/body.md",
      "description/comments.json",
      "description/images.json",
      "description/title.txt",
      "evidence/.kept",
      "evidence/01-owner-words.md",
      "evidence/pull-request-comments.json",
      "rules/01-pull-requests.md",
    ]);
    expect(readFileSync(join(repoRoot, "images", `${PNG_SHA}.png`)).equals(PNG)).toBe(true);
    expect(preparation.schemaVersion).toBe(4);
    expect(preparation.historicalReviewThreadIds).toStrictEqual([]);
    expect(preparation.preparedBy).toStrictEqual({ host: "claude-code", id: "writer" });
    const diff = reviewDiff({ baseSha: preparation.baseSha, headSha: preparation.headSha, repoRoot });
    expect(Buffer.byteLength(diff, "utf8")).toBe(diffBytes);
  });

  it("shows a resolved thread's history in the evidence and records it, binding the same manifest as its open form", () => {
    const open: ExistingPullRequestComment = {
      authorLogin: "quillfeather",
      body: "It used to count each widget twice.",
      createdAtIso: "2026-11-17T00:00:00Z",
      id: "PRRC_1",
      kind: "review-comment",
      originalLine: 4,
      path: "src/count.ts",
      supersededByThisWrite: false,
      threadId: "PRRT_1",
      threadResolved: false,
      updatedAtIso: "2026-11-17T00:00:00Z",
      url: "https://github.com/acme/widgets/pull/7#discussion_r1",
    };
    const base = contentsWith({ images: [] });
    const contents: PacketContents = {
      ...base,
      existingComments: [{ ...open, threadResolved: true }],
      manifest: buildDescriptionManifest({
        baseBranch: "main",
        body: base.body,
        changeDigest: "c".repeat(64),
        comments: [],
        existingComments: [open],
        images: [],
        repository: "acme/widgets",
        rulesSha256: rulesSha256Of({ files: RULES }),
        title: base.title,
      }),
    };
    const { preparation, repoRoot } = unwrap(prepare({ contents, preparationId: "p-history" }));
    expect(preparation.historicalReviewThreadIds).toStrictEqual(["PRRT_1"]);
    const evidence = gitInTemp({
      args: ["show", `${preparation.headSha}:evidence/pull-request-comments.json`],
      cwd: repoRoot,
    });
    expect(evidence).toContain('"threadResolved":true');
    expect(evidence).toContain('"threadId":"PRRT_1"');
  });

  it("carries every piece of text evidence in the diff a reviewer reads, and no image bytes", () => {
    const { preparation, repoRoot } = unwrap(
      prepare({ contents: contentsWith({ images: [IMAGE] }), preparationId: "p-diff" }),
    );
    const diff = reviewDiff({ baseSha: preparation.baseSha, headSha: preparation.headSha, repoRoot });
    expect([
      diff.includes("+No walls of text."),
      diff.includes("+The owner asked for this."),
      diff.includes("+diff --git a/src/count.ts b/src/count.ts"),
      diff.includes("+M 100644 100644 src/count.ts"),
      diff.includes("+Counts each widget once."),
      diff.includes("+# A pull-request description review"),
      diff.includes(`images/${PNG_SHA}.png`),
      GIT_BINARY_MARKER.test(diff),
    ]).toStrictEqual([true, true, true, true, true, true, true, false]);
  });

  it("still diffs every text file as text under a global attributes file marking them -diff", () => {
    const { preparation, repoRoot } = unwrap(
      prepare({ contents: contentsWith({ images: [] }), preparationId: "p-attrs" }),
    );
    const attributes = join(home, "global-attributes");
    writeFileSync(attributes, "*.md -diff\n*.txt -diff\n*.json -diff\n*.patch -diff\n");
    const diff = gitInTemp({
      args: [
        "-c",
        `core.attributesFile=${attributes}`,
        ...gitCommitDiffCommand({ commit: preparation.headSha, mergeBase: preparation.baseSha }).args,
      ],
      cwd: repoRoot,
    });
    expect([diff.includes("+No walls of text."), GIT_BINARY_MARKER.test(diff)]).toStrictEqual([true, false]);
  });

  it("commits every packet file as text under a user's global excludes file and init template", () => {
    const userHome = join(home, "user-home");
    mkdirSync(join(userHome, "template", "info"), { recursive: true });
    writeFileSync(join(userHome, "template", "info", "attributes"), "*.md -diff\n*.txt -diff\n*.json -diff\n");
    writeFileSync(join(userHome, "ignored"), "README.md\n*.md\n*.json\n*.patch\n*.txt\n*.png\n.kept\n");
    writeFileSync(
      join(userHome, ".gitconfig"),
      `[core]\n\texcludesFile = ${join(userHome, "ignored")}\n[init]\n\ttemplateDir = ${join(userHome, "template")}\n`,
    );
    const saved = { HOME: process.env["HOME"], XDG_CONFIG_HOME: process.env["XDG_CONFIG_HOME"] };
    process.env["HOME"] = userHome;
    process.env["XDG_CONFIG_HOME"] = join(userHome, "xdg");
    try {
      const { preparation, repoRoot } = unwrap(
        prepare({ contents: contentsWith({ images: [IMAGE] }), preparationId: "p-excluded" }),
      );
      const git = ({ args }: { args: readonly string[] }) => runGitChecked({ args, cwd: repoRoot, label: "git" });
      expect([
        git({ args: ["ls-tree", "-r", "--name-only", preparation.baseSha] }).split("\n").length,
        git({ args: ["diff", "--name-only", preparation.baseSha, preparation.headSha] }).split("\n").length,
      ]).toStrictEqual([3, 12]);
      const { baseSha, headSha } = preparation;
      expect(GIT_BINARY_MARKER.test(reviewDiff({ baseSha, headSha, repoRoot }))).toBe(false);
    } finally {
      process.env["HOME"] = saved.HOME;
      if (saved.XDG_CONFIG_HOME === undefined) {
        delete process.env["XDG_CONFIG_HOME"];
      } else {
        process.env["XDG_CONFIG_HOME"] = saved.XDG_CONFIG_HOME;
      }
    }
  });

  it("refuses a text file holding a NUL byte, and writes nothing", () => {
    const contents = {
      ...contentsWith({ images: [] }),
      evidence: [{ contents: "a\0b\n", name: "owner-words.md" }],
    };
    const failure = unwrapErr(prepare({ contents, preparationId: "p-nul" }));
    expect(failure.code).toBe("FILE_NOT_TEXT");
    expect(failure.message).toBe(
      "evidence/01-owner-words.md holds a NUL byte, so the review's diff cannot carry it as text; nothing was prepared",
    );
    expect(existsSync(preparationsDirectory({ home }))).toBe(false);
  });

  it("commits a README telling the reviewer to list every violation, not the first", () => {
    const { preparation, repoRoot } = unwrap(
      prepare({ contents: contentsWith({ images: [IMAGE] }), preparationId: "p-readme" }),
    );
    const readme = gitInTemp({ args: ["show", `${preparation.headSha}:README.md`], cwd: repoRoot });
    expect(readme).toContain(`${DESCRIPTION_REVIEW_EVERY_VIOLATION}.`);
    expect(readme).toContain("never stop at the first violation");
  });

  it("binds the README line naming the head the rules were read at into the diff", () => {
    const headSha = "a".repeat(40);
    const contents = {
      ...contentsWith({ images: [] }),
      rulesOrigin: { headRef: "feature", headSha, kind: "head" } as const,
    };
    const { preparation, repoRoot } = unwrap(prepare({ contents, preparationId: "p-head-rules" }));
    const diff = reviewDiff({ baseSha: preparation.baseSha, headSha: preparation.headSha, repoRoot });
    expect(diff).toContain(`+\`rules/\` was read from the head under review, ref "feature" at commit ${headSha}`);
  });

  it("binds the closed-upload README into the diff, so a review of one packet never reads as the other's", () => {
    const permitted = unwrap(prepare({ contents: contentsWith({ images: [] }), preparationId: "p-permitted" }));
    const refusedContents = { ...contentsWith({ images: [] }), attachUploadPermitted: false };
    const refused = unwrap(prepare({ contents: refusedContents, preparationId: "p-refused" }));
    const diff = reviewDiff({
      baseSha: refused.preparation.baseSha,
      headSha: refused.preparation.headSha,
      repoRoot: refused.repoRoot,
    });
    expect([
      permitted.preparation.headSha === refused.preparation.headSha,
      diff.includes("+## No picture can be attached from this install"),
    ]).toEqual([false, true]);
  });

  it("refuses an image whose bytes are not the digest its entry declares, and writes nothing", () => {
    const declared = "a".repeat(64);
    const lying: PacketImage = { ...IMAGE, image: { ...IMAGE.image, sha256: declared } };
    const failure = unwrapErr(prepare({ contents: contentsWith({ images: [lying] }), preparationId: "p1" }));
    expect(failure.code).toBe("IMAGE_MISMATCH");
    expect(failure.message).toBe(
      `${IMAGE.image.url} holds bytes ${PNG_SHA.slice(0, 12)}…, not the ${declared.slice(0, 12)}… its entry declares`,
    );
    expect(existsSync(preparationsDirectory({ home }))).toBe(false);
  });

  it("refuses contents whose manifest names another body", () => {
    const contents = { ...contentsWith({ images: [] }), body: "Another body.\n" };
    const failure = unwrapErr(prepare({ contents, preparationId: "p1" }));
    expect(failure.code).toBe("PREPARATION_FAILED");
    expect(failure.message).toContain("the manifest does not name this title, body, comment set and image set");
  });

  it("refuses contents whose comments are not the ones its manifest names", () => {
    const comment = { body: "💡 Counts once.", line: 1, path: "src/count.ts" };
    const contents = { ...contentsWith({ images: [] }), comments: [comment] };
    expect(unwrapErr(prepare({ contents, preparationId: "p1" })).code).toBe("PREPARATION_FAILED");
    expect(existsSync(preparationsDirectory({ home }))).toBe(false);
  });

  it("refuses to reuse a preparation id", () => {
    unwrap(prepare({ contents: contentsWith({ images: [] }), preparationId: "p1" }));
    const failure = unwrapErr(prepare({ contents: contentsWith({ images: [] }), preparationId: "p1" }));
    expect(failure.code).toBe("PREPARATION_FAILED");
    expect(failure.message).toContain("already exists");
  });
});
