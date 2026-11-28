/**
 * The packet repository a fresh reviewer reads before a pull-request description reaches GitHub.
 *
 * Its BASE commit holds only `.gitattributes` and every image at its declared digest (`images/`). Its HEAD commit adds
 * every text file the review judges: the orientation (`README.md`), the written rules (`rules/`), the change set as a
 * patch and as the exact tree delta its digest hashes (`change/`), the records the author cites and the comments
 * already on the pull request (`evidence/`), and the description itself (`description/title.txt`,
 * `description/body.md`, `description/comments.json`, `description/images.json` pairing each image with the line it
 * proves). So `codex review --repo <packet> --base <base>` judges the description and its evidence in one text diff.
 *
 * ## Why the evidence sits in the DIFF, and the images do not
 *
 * A review's packet is the base..head diff and nothing else: Codex's `review-packet.md` (`../../codex/artifactStore.ts`)
 * and the visible-Claude fallback's (`../../codex/fallbackPacket.ts`) both carry exactly that text. Evidence committed
 * at the base reached a reviewer only if it went and browsed the repository; the page review came back BROKEN on
 * exactly that, with its inputs at the base (`../../pages/reviewRepo.ts`). The images stay at the base because a
 * review diff carrying binary bytes is refused (`../../codex/diff.ts`), and the property tells the reviewer to open
 * them from the repository. A preparation written before this layout is schema 2, and is still read
 * (`./descriptionReviewCarry.ts`).
 *
 * Each packet is its own immutable directory under `preparations/`, created exclusively and removed whole on any
 * failure, so a half-built packet never sits where `review-record` could resolve it. Every git call goes through
 * `../../codex/gitRun.ts`, the runner whose canonical config the review's own diff digest was taken under.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";
import { stableStringify } from "#lib/stableStringify.js";

import { gitCommitDiffCommand } from "../../codex/diff.js";
import { runGitChecked } from "../../codex/gitRun.js";
import type { SupervisorSession } from "../../supervisor/session.js";
import { canonicalImages, manifestSha256Of, textSha256 } from "./descriptionReview.js";
import {
  descriptionCommentsText,
  existingCommentsDigestText,
  existingCommentsEvidenceText,
} from "./descriptionReviewCommentText.js";
import { type DescriptionReviewError, DescriptionReviewErrors } from "./descriptionReviewErrors.js";
import { historicalReviewThreadIds } from "./descriptionReviewHistory.js";
import {
  PACKET_BODY_PATH,
  PACKET_COMMENTS_PATH,
  PACKET_DELTA_PATH,
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
  type DescriptionRulesOrigin,
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

/**
 * Committed first, so `git add` neither converts line endings nor runs a clean filter on any packet byte. `diff` is
 * SET so every text file diffs as text: a user's global attributes file marking `*.md -diff` would otherwise turn a
 * rule into `Binary files … differ`, and a repository's own `.gitattributes` outranks that file. The images are never
 * in the diff, so setting it costs them nothing.
 */
const GITATTRIBUTES = "* -text -filter diff\n";

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
  /** The tree `rules` was read from, which the README names. */
  readonly rulesOrigin: DescriptionRulesOrigin;
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
      textSha256({ text: existingCommentsDigestText({ comments: contents.existingComments }) }) &&
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

/** One text file the head commits, by its packet path. */
interface PacketTextFile {
  readonly path: string;
  readonly contents: string;
}

/**
 * Every text file the head commits, in one list: the writer and the NUL check both read it, so the check can never
 * judge a set the writer did not commit.
 */
function headTextFiles({ contents }: { contents: PacketContents }): readonly PacketTextFile[] {
  const readme = descriptionReviewPacketReadme({
    attachUploadPermitted: contents.attachUploadPermitted,
    rulesOrigin: contents.rulesOrigin,
  });
  const images = contents.images.map((image) => ({ ...image.image, file: imageFile({ image }) }));
  return [
    { contents: readme, path: "README.md" },
    ...contents.rules.map((rule, index) => ({
      contents: rule.contents,
      path: `rules/${numberedName({ index, name: rule.path })}`,
    })),
    { contents: contents.change.patch, path: "change/diff.patch" },
    {
      contents: [`changeDigest ${contents.manifest.changeDigest}`, ...contents.change.deltaLines, ""].join("\n"),
      path: PACKET_DELTA_PATH,
    },
    ...contents.evidence.map((one, index) => ({
      contents: one.contents,
      path: `evidence/${numberedName({ index, name: one.name })}`,
    })),
    {
      contents: existingCommentsEvidenceText({ comments: contents.existingComments }),
      path: PACKET_EXISTING_COMMENTS_PATH,
    },
    // An empty directory is not committed, so it carries a marker saying it was left empty on purpose.
    { contents: "evidence/ is empty when the author cited no record\n", path: "evidence/.kept" },
    { contents: contents.title, path: PACKET_TITLE_PATH },
    { contents: contents.body, path: PACKET_BODY_PATH },
    { contents: descriptionCommentsText({ comments: contents.comments }), path: PACKET_COMMENTS_PATH },
    { contents: `${stableStringify({ value: images })}\n`, path: "description/images.json" },
  ];
}

/**
 * The first head file the review's diff could not carry as text, or `undefined` when none. A NUL would reach the
 * diff raw under `GITATTRIBUTES`, so any NUL is refused, wherever it sits.
 */
function firstNonTextPath({ files }: { files: readonly PacketTextFile[] }): string | undefined {
  return files.find((file) => file.contents.includes("\0"))?.path;
}

/** Write the base tree: the attributes and the images, the one thing a review diff cannot carry. */
function writeBase({ repo, contents }: { repo: string; contents: PacketContents }): void {
  mkdirSync(join(repo, "images"), { recursive: true });
  writeFileSync(join(repo, ".gitattributes"), GITATTRIBUTES);
  for (const image of contents.images) {
    writeFileSync(join(repo, imageFile({ image })), image.bytes);
  }
}

/** Write the head tree: every text file the review judges. */
function writeHead({ repo, files }: { repo: string; files: readonly PacketTextFile[] }): void {
  for (const file of files) {
    const path = join(repo, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.contents);
  }
}

/** Commit the base, then the head, and answer both commits and the review diff's size. */
function commitPacket({
  repo,
  contents,
  files,
}: {
  repo: string;
  contents: PacketContents;
  files: readonly PacketTextFile[];
}): {
  readonly baseSha: string;
  readonly headSha: string;
  readonly diffBytes: number;
} {
  const git = ({ args }: { args: readonly string[] }): string =>
    runGitChecked({ args, cwd: repo, label: `git ${args.find((arg) => !arg.startsWith("-"))!}` });
  writeBase({ contents, repo });
  // `--template=`: a user's init template could install `.git/info/attributes`, which outranks `GITATTRIBUTES`.
  git({ args: ["init", "--quiet", "--template=", "--initial-branch=main"] });
  // `--force`: a user's global excludes file must never drop a packet file from the commit a review is bound to.
  git({ args: ["add", "--force", "--all"] });
  git({ args: [...COMMIT_CONFIG, "commit", "--quiet", "--no-verify", "-m", "the images the description shows"] });
  const baseSha = git({ args: ["rev-parse", "HEAD"] }).trim();
  writeHead({ files, repo });
  git({ args: ["add", "--force", "--all"] });
  git({
    args: [...COMMIT_CONFIG, "commit", "--quiet", "--no-verify", "-m", "the description and what it answers to"],
  });
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
  const files = headTextFiles({ contents });
  const binary = firstNonTextPath({ files });
  if (binary !== undefined) {
    return err(DescriptionReviewErrors.fileNotText({ path: binary }));
  }
  const directory = join(preparationsDirectory({ home }), preparationId);
  if (existsSync(directory)) {
    return err(DescriptionReviewErrors.preparationFailed({ detail: `${directory} already exists` }));
  }
  const repo = join(directory, PACKET_REPO_DIRNAME);
  try {
    mkdirSync(repo, { recursive: true });
    const { baseSha, diffBytes, headSha } = commitPacket({ contents, files, repo });
    const preparation: DescriptionReviewPreparation = {
      baseSha,
      createdAtIso,
      headSha,
      historicalReviewThreadIds: historicalReviewThreadIds({ comments: contents.existingComments }),
      manifest: contents.manifest,
      manifestSha256: manifestSha256Of({ manifest: contents.manifest }),
      preparationId,
      preparedBy,
      schemaVersion: 4,
    };
    writePreparationRecord({ directory, preparation });
    return ok({ diffBytes, preparation, repoRoot: realpathSync(repo) });
  } catch (error: unknown) {
    rmSync(directory, { force: true, recursive: true });
    return err(DescriptionReviewErrors.preparationFailed({ detail: errorMessage({ error }) }));
  }
}
