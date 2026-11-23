/**
 * Effectful shell for `slopweaver github pr review-prepare`: read the exact title and body, the comments the write
 * posts, the comments already on the pull request, the images, the evidence and the change set, refuse a packet that already has its one review, build the packet a fresh reviewer reads
 * (`../../../outbound/github/descriptionReviewPacket.ts`) and print the Codex review, the visible Claude fallback and
 * the `review-record` that follow. It runs no model and writes nothing to GitHub; for `--number` it reads the pull
 * request's comments through the typed live reader.
 *
 * The shared edges and `review-record` live in `./prDescriptionReviewRun.ts`; the pure half in
 * `./prDescriptionReviewCore.ts`.
 */
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

import { changePatch, treeDeltaLines } from "../../../outbound/github/descriptionChangeDigest.js";
import { findingPacketEvidence } from "../../../outbound/github/descriptionFindingEvidence.js";
import {
  type DescriptionReviewError,
  DescriptionReviewErrors,
} from "../../../outbound/github/descriptionReviewErrors.js";
import {
  type DescriptionManifestReading,
  descriptionManifestFor,
} from "../../../outbound/github/descriptionReviewGate.js";
import {
  type PacketContents,
  type PacketEvidence,
  type PacketImage,
  prepareDescriptionPacket,
} from "../../../outbound/github/descriptionReviewPacket.js";
import { readReceipt } from "../../../outbound/github/descriptionReviewStore.js";
import type {
  DescriptionReviewComment,
  DescriptionReviewPreparation,
  ExistingPullRequestComment,
} from "../../../outbound/github/descriptionReviewTypes.js";
import { EXIT_OK } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { readFindingBoard } from "./findingRulingGate.js";
import {
  type DescriptionImageInput,
  DIFF_HEADROOM_BYTES,
  descriptionReviewCommands,
  type GithubPrReviewPrepareArgs,
  parseGithubPrReviewPrepareArgs,
  preparedPacketLines,
  visibleSessionOf,
} from "./prDescriptionReviewCore.js";
import { parseDescriptionComments, parseDescriptionImages } from "./prDescriptionReviewFiles.js";
import { failDescriptionReviewVerb, type GithubPrDescriptionReviewDeps } from "./prDescriptionReviewRun.js";
import { GITHUB_PR_REVIEW_PREPARE_USAGE } from "./prDescriptionReviewUsage.js";

/** Read one file as UTF-8 text, or name it. */
function readText({ path }: { path: string }): Result<string, DescriptionReviewError> {
  try {
    return ok(readFileSync(path, "utf8"));
  } catch (error: unknown) {
    return err(DescriptionReviewErrors.inputUnreadable({ detail: errorMessage({ error }), path }));
  }
}

/** Read every image entry's bytes, or the first file that could not be read. */
function readImages({
  inputs,
}: {
  inputs: readonly DescriptionImageInput[];
}): Result<PacketImage[], DescriptionReviewError> {
  const images: PacketImage[] = [];
  for (const input of inputs) {
    const extension = extname(input.file).replace(/^\./, "");
    try {
      images.push({
        bytes: readFileSync(input.file),
        extension: extension === "" ? "bin" : extension,
        image: input.image,
      });
    } catch (error: unknown) {
      return err(DescriptionReviewErrors.inputUnreadable({ detail: errorMessage({ error }), path: input.file }));
    }
  }
  return ok(images);
}

/** Read the `--images` file, then every image it names. */
function imagesFrom({ imagesFile }: { imagesFile: string | undefined }): Result<PacketImage[], DescriptionReviewError> {
  if (imagesFile === undefined) {
    return ok([]);
  }
  return readText({ path: imagesFile })
    .andThen((text) => parseDescriptionImages({ source: imagesFile, text }))
    .andThen((inputs) => readImages({ inputs }));
}

/** Read every `--evidence` file. */
function evidenceFrom({ paths }: { paths: readonly string[] }): Result<PacketEvidence[], DescriptionReviewError> {
  const evidence: PacketEvidence[] = [];
  for (const path of paths) {
    const text = readText({ path });
    if (text.isErr()) {
      return err(text.error);
    }
    evidence.push({ contents: text.value, name: basename(path) });
  }
  return ok(evidence);
}

/** What a prepare reads from disk. */
interface PrepareInputs {
  readonly body: string;
  readonly comments: readonly DescriptionReviewComment[];
  readonly evidence: PacketEvidence[];
  readonly images: PacketImage[];
}

/**
 * The body, outgoing comments, images and evidence a prepare names, each read from disk, with the fleet-finding
 * record for `--branch` placed first among the evidence.
 */
function readPrepareInputs({
  args,
  home,
}: {
  args: GithubPrReviewPrepareArgs;
  home: string;
}): Result<PrepareInputs, DescriptionReviewError> {
  return readText({ path: args.bodyFile }).andThen((body) =>
    readText({ path: args.commentsFile })
      .andThen((text) => parseDescriptionComments({ source: args.commentsFile, text }))
      .andThen((comments) =>
        imagesFrom({ imagesFile: args.imagesFile }).andThen((images) =>
          evidenceFrom({ paths: args.evidenceFiles })
            .andThen((cited) => withFindingEvidence({ branch: args.branch, cited, home }))
            .map((evidence) => ({ body, comments, evidence, images })),
        ),
      ),
  );
}

/**
 * The fleet-finding record for `--branch`, first, then every `--evidence` file in the order named. No `--branch`, or
 * a branch no finding row claims, leaves the cited files alone.
 */
function withFindingEvidence({
  branch,
  cited,
  home,
}: {
  branch: string | undefined;
  cited: readonly PacketEvidence[];
  home: string;
}): Result<PacketEvidence[], DescriptionReviewError> {
  if (branch === undefined) {
    return ok([...cited]);
  }
  const board = readFindingBoard({ home });
  if (board.isErr()) {
    const { handovers, why } = board.error;
    return err(DescriptionReviewErrors.inputUnreadable({ detail: why, path: handovers }));
  }
  return findingPacketEvidence({ branch, ...board.value }).map((record) =>
    record === undefined ? [...cited] : [record, ...cited],
  );
}

/** The comments already on the pull request: none for one not yet opened, else read whole from GitHub. */
async function existingCommentsFor({
  args,
  deps,
  home,
}: {
  args: GithubPrReviewPrepareArgs;
  deps: GithubPrDescriptionReviewDeps;
  home: string;
}): Promise<Result<readonly ExistingPullRequestComment[], DescriptionReviewError>> {
  if (args.pullRequest.kind === "new") {
    return ok([]);
  }
  const [owner, repo] = args.repository.split("/");
  return deps.readComments({ home, number: args.pullRequest.number, owner: owner!, repo: repo! });
}

/** What a prepared packet hands the shell to print. */
interface PreparedPacket {
  readonly diffBytes: number;
  readonly preparation: DescriptionReviewPreparation;
  readonly repoRoot: string;
}

/**
 * Read the inputs, refuse a packet that already has its review, and commit the packet repository.
 *
 * @returns the prepared packet, or the first reason it could not be built
 */
async function preparePacket({
  args,
  deps,
  home,
}: {
  args: GithubPrReviewPrepareArgs;
  deps: GithubPrDescriptionReviewDeps;
  home: string;
}): Promise<Result<PreparedPacket, DescriptionReviewError>> {
  const inputs = readPrepareInputs({ args, home });
  if (inputs.isErr()) {
    return err(inputs.error);
  }
  const { body, comments, evidence, images } = inputs.value;
  const existingComments = await existingCommentsFor({ args, deps, home });
  if (existingComments.isErr()) {
    return err(existingComments.error);
  }
  const repoDir = typeof args.cwd === "string" ? args.cwd : deps.cwd;
  const reading = descriptionManifestFor({
    description: {
      baseBranch: args.baseBranch,
      baseRef: args.baseRef,
      body,
      comments,
      existingComments: existingComments.value,
      headRef: args.headRef,
      images: images.map((one) => one.image),
      repoDir,
      repository: args.repository,
      rulesRoot: deps.rulesRoot,
      title: args.title,
    },
  });
  if (reading.isErr()) {
    return err(reading.error);
  }
  const existing = readReceipt({ home, manifestSha256: reading.value.manifestSha256 });
  if (existing.isErr()) {
    return err(existing.error);
  }
  if (existing.value !== undefined) {
    const { receiptId, verdict } = existing.value;
    const { manifestSha256 } = reading.value;
    return err(DescriptionReviewErrors.alreadyReviewed({ manifestSha256, receiptId, verdict }));
  }
  const contents = {
    attachUploadPermitted: deps.attachUploadStanding({ home }).kind === "permitted",
    body,
    comments,
    evidence,
    existingComments: existingComments.value,
    images,
    title: args.title,
  };
  return commitPacket({ contents, deps, home, reading: reading.value, repoDir });
}

/** The change set's patch read, then the packet repository committed over everything the review binds. */
function commitPacket({
  contents,
  deps,
  home,
  reading,
  repoDir,
}: {
  contents: Omit<PacketContents, "change" | "manifest" | "rules">;
  deps: GithubPrDescriptionReviewDeps;
  home: string;
  reading: DescriptionManifestReading;
  repoDir: string;
}): Result<PreparedPacket, DescriptionReviewError> {
  const { change, manifest, rules } = reading;
  const patch = changePatch({ headSha: change.headSha, mergeBaseSha: change.mergeBaseSha, repoDir });
  if (patch.isErr()) {
    return err(patch.error);
  }
  return prepareDescriptionPacket({
    contents: {
      ...contents,
      change: { deltaLines: treeDeltaLines({ entries: change.entries }), patch: patch.value },
      manifest,
      rules,
    },
    createdAtIso: deps.nowIso(),
    home,
    preparationId: deps.newId(),
    preparedBy: visibleSessionOf({ env: deps.env }),
  });
}

/**
 * Run `github pr review-prepare`.
 *
 * @param deps the injected edges
 * @param rest argv after `github pr review-prepare`
 * @returns the process exit code
 */
export async function runGithubPrReviewPrepare({
  deps,
  rest,
}: {
  deps: GithubPrDescriptionReviewDeps;
  rest: readonly string[];
}): Promise<number> {
  const usage = GITHUB_PR_REVIEW_PREPARE_USAGE;
  const parsed = parseGithubPrReviewPrepareArgs({ rest });
  if (parsed.isErr()) {
    return failDescriptionReviewVerb({ deps, error: parsed.error, usage });
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  const prepared = await preparePacket({ args, deps, home });
  if (prepared.isErr()) {
    return failDescriptionReviewVerb({ deps, error: prepared.error, usage });
  }
  const { diffBytes, preparation, repoRoot } = prepared.value;
  const maxDiffBytes = diffBytes + DIFF_HEADROOM_BYTES;
  const commands = descriptionReviewCommands({ home, maxDiffBytes, preparation, repoRoot });
  if (args.json) {
    deps.out({ line: JSON.stringify({ commands, preparation, repoRoot }) });
    return EXIT_OK;
  }
  for (const line of preparedPacketLines({ commands, preparation, repoRoot })) {
    deps.out({ line });
  }
  return EXIT_OK;
}
