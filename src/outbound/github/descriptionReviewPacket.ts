/**
 * The packet repository a fresh reviewer reads before a pull-request description reaches GitHub.
 *
 * Its BASE commit holds everything the description answers to: the written rules (`rules/`), the change set as a
 * patch and as the exact tree delta its digest hashes (`change/`), every image at its declared digest (`images/`)
 * and any records the author cites for an act credited to the owner (`evidence/`). Its HEAD commit adds the
 * description itself (`description/title.txt`, `description/body.md`, `description/images.json` pairing each
 * image with the line it proves). So `codex review --repo <packet> --base <base>` judges exactly the description,
 * as a text diff against its evidence, and the images sit at the base because a review diff carrying binary
 * bytes is refused (`../../codex/diff.ts`).
 *
 * Each packet is its own immutable directory under `preparations/`, created exclusively and removed whole on any
 * failure, so a half-built packet never sits where `review-record` could resolve it. Every git call goes through
 * `../../codex/gitRun.ts`, the runner whose canonical config the review's own diff digest was taken under.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";
import { stableStringify } from "#lib/stableStringify.js";

import { gitCommitDiffCommand } from "../../codex/diff.js";
import { runGitChecked } from "../../codex/gitRun.js";
import type { SupervisorSession } from "../../supervisor/session.js";
import {
  canonicalImages,
  descriptionCommentsText,
  existingCommentsText,
  manifestSha256Of,
  textSha256,
} from "./descriptionReview.js";
import { type DescriptionReviewError, DescriptionReviewErrors } from "./descriptionReviewErrors.js";
import {
  PACKET_BODY_PATH,
  PACKET_COMMENTS_PATH,
  PACKET_EXISTING_COMMENTS_PATH,
  PACKET_REPO_DIRNAME,
  PACKET_TITLE_PATH,
  preparationsDirectory,
  writePreparationRecord,
} from "./descriptionReviewStore.js";
import {
  type DescriptionImage,
  type DescriptionReviewComment,
  type DescriptionReviewManifest,
  type DescriptionReviewPreparation,
  descriptionReviewPacketReadme,
  type ExistingPullRequestComment,
} from "./descriptionReviewTypes.js";

/** A fixed identity, no signing and no hooks, so a user's git setup can neither block a commit nor run code. */
const COMMIT_CONFIG: readonly string[] = [
  "-c",
  "user.name=slopweaver description review",
  "-c",
  "user.email=description-review@slopweaver.invalid",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.hooksPath=/dev/null",
];

/** Committed first, so `git add` neither converts line endings nor runs a clean filter on any packet byte. */
const GITATTRIBUTES = "* -text -filter\n";

/** One image as the packet commits it: its entry and its exact bytes. */
export interface PacketImage {
  readonly image: DescriptionImage;
  readonly bytes: Buffer;
  /** The file extension the bytes are committed under, without the dot (`png`). */
  readonly extension: string;
}

/** One evidence file, named for the reviewer. */
export interface PacketEvidence {
  readonly name: string;
  readonly contents: string;
}

/** Everything one packet commits. */
export interface PacketContents {
  readonly manifest: DescriptionReviewManifest;
  readonly title: string;
  readonly body: string;
  /** The inline comments the same write posts, exactly as GitHub receives them. */
  readonly comments: readonly DescriptionReviewComment[];
  /** Every comment already on the pull request; `[]` for one not yet opened. */
  readonly existingComments: readonly ExistingPullRequestComment[];
  readonly images: readonly PacketImage[];
  readonly rules: readonly { readonly path: string; readonly contents: string }[];
  readonly change: { readonly patch: string; readonly deltaLines: readonly string[] };
  readonly evidence: readonly PacketEvidence[];
  /** Whether `github attach upload` is permitted on this install; when not, the README says no picture can come. */
  readonly attachUploadPermitted: boolean;
}

/** A packet file name with anything path-like flattened and a two-digit order prefix. */
function numberedName({ index, name }: { index: number; name: string }): string {
  return `${String(index + 1).padStart(2, "0")}-${basename(name).replace(/[^A-Za-z0-9._-]/g, "-")}`;
}

/** The packet path an image's bytes are committed under. */
function imageFile({ image }: { image: PacketImage }): string {
  return `images/${image.image.sha256}.${image.extension.replace(/[^A-Za-z0-9]/g, "")}`;
}

/** Refuse an image whose bytes are not the digest its entry declares, before anything is written. */
function checkImages({ images }: { images: readonly PacketImage[] }): Result<true, DescriptionReviewError> {
  for (const image of images) {
    const actual = createHash("sha256").update(image.bytes).digest("hex");
    if (actual !== image.image.sha256) {
      return err(
        DescriptionReviewErrors.imageMismatch({ actual, declared: image.image.sha256, path: image.image.url }),
      );
    }
  }
  return ok(true);
}

/** Refuse contents whose title, body, comments or images are not the ones its manifest names. */
function checkManifest({ contents }: { contents: PacketContents }): Result<true, DescriptionReviewError> {
  const { manifest } = contents;
  const images = canonicalImages({ images: contents.images.map((one) => one.image) });
  const agrees =
    manifest.titleSha256 === textSha256({ text: contents.title }) &&
    manifest.bodySha256 === textSha256({ text: contents.body }) &&
    manifest.commentsSha256 === textSha256({ text: descriptionCommentsText({ comments: contents.comments }) }) &&
    manifest.existingCommentsSha256 ===
      textSha256({ text: existingCommentsText({ comments: contents.existingComments }) }) &&
    stableStringify({ value: images }) === stableStringify({ value: manifest.images });
  if (!agrees) {
    return err(
      DescriptionReviewErrors.preparationFailed({
        detail: "the manifest does not name this title, body, comment set and image set; build it from the same values",
      }),
    );
  }
  return ok(true);
}

/** Write the base tree: orientation, rules, change set, images and evidence. */
function writeBase({ repo, contents }: { repo: string; contents: PacketContents }): void {
  for (const directory of ["rules", "change", "images", "evidence"]) {
    mkdirSync(join(repo, directory), { recursive: true });
  }
  writeFileSync(join(repo, ".gitattributes"), GITATTRIBUTES);
  const readme = descriptionReviewPacketReadme({ attachUploadPermitted: contents.attachUploadPermitted });
  writeFileSync(join(repo, "README.md"), readme);
  contents.rules.forEach((rule, index) => {
    writeFileSync(join(repo, "rules", numberedName({ index, name: rule.path })), rule.contents);
  });
  writeFileSync(join(repo, "change", "diff.patch"), contents.change.patch);
  writeFileSync(
    join(repo, "change", "delta.txt"),
    [`changeDigest ${contents.manifest.changeDigest}`, ...contents.change.deltaLines, ""].join("\n"),
  );
  for (const image of contents.images) {
    writeFileSync(join(repo, imageFile({ image })), image.bytes);
  }
  contents.evidence.forEach((one, index) => {
    writeFileSync(join(repo, "evidence", numberedName({ index, name: one.name })), one.contents);
  });
  writeFileSync(
    join(repo, PACKET_EXISTING_COMMENTS_PATH),
    existingCommentsText({ comments: contents.existingComments }),
  );
  // An empty directory is not committed, so each one carries a marker saying it was left empty on purpose.
  writeFileSync(join(repo, "evidence", ".kept"), "evidence/ is empty when the author cited no record\n");
}

/** Write the head tree: the description under review. */
function writeHead({ repo, contents }: { repo: string; contents: PacketContents }): void {
  mkdirSync(join(repo, "description"), { recursive: true });
  writeFileSync(join(repo, PACKET_TITLE_PATH), contents.title);
  writeFileSync(join(repo, PACKET_BODY_PATH), contents.body);
  writeFileSync(join(repo, PACKET_COMMENTS_PATH), descriptionCommentsText({ comments: contents.comments }));
  const images = contents.images.map((image) => ({ ...image.image, file: imageFile({ image }) }));
  writeFileSync(join(repo, "description", "images.json"), `${stableStringify({ value: images })}\n`);
}

/** Commit the base, then the head, and answer both commits and the review diff's size. */
function commitPacket({ repo, contents }: { repo: string; contents: PacketContents }): {
  readonly baseSha: string;
  readonly headSha: string;
  readonly diffBytes: number;
} {
  const git = ({ args }: { args: readonly string[] }): string =>
    runGitChecked({ args, cwd: repo, label: `git ${args.find((arg) => !arg.startsWith("-"))!}` });
  writeBase({ contents, repo });
  git({ args: ["init", "--quiet", "--initial-branch=main"] });
  git({ args: ["add", "--all"] });
  git({ args: [...COMMIT_CONFIG, "commit", "--quiet", "--no-verify", "-m", "evidence the description answers to"] });
  const baseSha = git({ args: ["rev-parse", "HEAD"] }).trim();
  writeHead({ contents, repo });
  git({ args: ["add", "--", "description"] });
  git({ args: [...COMMIT_CONFIG, "commit", "--quiet", "--no-verify", "-m", "the description under review"] });
  const headSha = git({ args: ["rev-parse", "HEAD"] }).trim();
  const diff = git({ args: gitCommitDiffCommand({ commit: headSha, mergeBase: baseSha }).args });
  return { baseSha, diffBytes: Buffer.byteLength(diff, "utf8"), headSha };
}

/**
 * Build one packet: the repository, its two commits, and the record of what was committed.
 *
 * @param home the state home
 * @param preparationId a fresh id naming this packet's directory
 * @param createdAtIso when it was prepared
 * @param preparedBy the visible session preparing it, or null when none can be named
 * @param contents everything the packet commits
 * @returns the preparation, the repository root a reviewer is pointed at, and the size of the diff it will read
 */
export function prepareDescriptionPacket({
  home,
  preparationId,
  createdAtIso,
  preparedBy,
  contents,
}: {
  home: string;
  preparationId: string;
  createdAtIso: string;
  preparedBy: SupervisorSession | null;
  contents: PacketContents;
}): Result<
  { readonly preparation: DescriptionReviewPreparation; readonly repoRoot: string; readonly diffBytes: number },
  DescriptionReviewError
> {
  const checked = checkImages({ images: contents.images }).andThen(() => checkManifest({ contents }));
  if (checked.isErr()) {
    return err(checked.error);
  }
  const directory = join(preparationsDirectory({ home }), preparationId);
  if (existsSync(directory)) {
    return err(DescriptionReviewErrors.preparationFailed({ detail: `${directory} already exists` }));
  }
  const repo = join(directory, PACKET_REPO_DIRNAME);
  try {
    mkdirSync(repo, { recursive: true });
    const { baseSha, diffBytes, headSha } = commitPacket({ contents, repo });
    const preparation: DescriptionReviewPreparation = {
      baseSha,
      createdAtIso,
      headSha,
      manifest: contents.manifest,
      manifestSha256: manifestSha256Of({ manifest: contents.manifest }),
      preparationId,
      preparedBy,
      schemaVersion: 2,
    };
    writePreparationRecord({ directory, preparation });
    return ok({ diffBytes, preparation, repoRoot: realpathSync(repo) });
  } catch (error: unknown) {
    rmSync(directory, { force: true, recursive: true });
    return err(DescriptionReviewErrors.preparationFailed({ detail: errorMessage({ error }) }));
  }
}
