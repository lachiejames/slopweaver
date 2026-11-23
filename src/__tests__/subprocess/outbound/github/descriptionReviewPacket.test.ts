/*
 * The packet a fresh reviewer reads, built over real git: evidence (rules, change set, images, records) in the base
 * commit, the description alone in the head, and nothing written when an image's bytes or the manifest disagree with
 * what the author declared.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
} from "../../../../outbound/github/descriptionReviewTypes.js";
import { gitInTemp } from "../../../tempGitRepo.js";

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

  it("commits the evidence as the base and only the description as the head", () => {
    const { preparation, repoRoot } = unwrap(
      prepare({ contents: contentsWith({ images: [IMAGE] }), preparationId: "p1" }),
    );
    const baseFiles = gitInTemp({ args: ["ls-tree", "-r", "--name-only", preparation.baseSha], cwd: repoRoot });
    expect(baseFiles.split("\n")).toStrictEqual([
      ".gitattributes",
      "README.md",
      "change/delta.txt",
      "change/diff.patch",
      "evidence/.kept",
      "evidence/01-owner-words.md",
      "evidence/pull-request-comments.json",
      `images/${PNG_SHA}.png`,
      "rules/01-pull-requests.md",
    ]);
    const headOnly = gitInTemp({
      args: ["diff", "--name-only", preparation.baseSha, preparation.headSha],
      cwd: repoRoot,
    });
    expect(headOnly.split("\n")).toStrictEqual([
      "description/body.md",
      "description/comments.json",
      "description/images.json",
      "description/title.txt",
    ]);
    expect(readFileSync(join(repoRoot, "images", `${PNG_SHA}.png`)).equals(PNG)).toBe(true);
    expect(preparation.preparedBy).toStrictEqual({ host: "claude-code", id: "writer" });
  });

  it("commits a README telling the reviewer to list every violation, not the first", () => {
    const { preparation, repoRoot } = unwrap(
      prepare({ contents: contentsWith({ images: [IMAGE] }), preparationId: "p-readme" }),
    );
    const readme = gitInTemp({ args: ["show", `${preparation.baseSha}:README.md`], cwd: repoRoot });
    expect(readme).toContain(`${DESCRIPTION_REVIEW_EVERY_VIOLATION}.`);
    expect(readme).toContain("never stop at the first violation");
  });

  it("binds the closed-upload README into the base commit, so a review of one packet never reads as the other's", () => {
    const permitted = unwrap(prepare({ contents: contentsWith({ images: [] }), preparationId: "p-permitted" }));
    const refusedContents = { ...contentsWith({ images: [] }), attachUploadPermitted: false };
    const refused = unwrap(prepare({ contents: refusedContents, preparationId: "p-refused" }));
    const readme = gitInTemp({ args: ["show", `${refused.preparation.baseSha}:README.md`], cwd: refused.repoRoot });
    expect([
      permitted.preparation.baseSha === refused.preparation.baseSha,
      readme.includes("## No picture can be attached from this install"),
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
