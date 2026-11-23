/**
 * `github exposure sweep` — run the hygiene scan over every piece of text a repository publishes when it is switched
 * public, and say for each surface whether its text was all read.
 *
 * ## The sweep reads what the inventory reads, through a tap
 *
 * It runs the inventory itself (`./exposureInventory.ts`) over a seam that hands every answered page to the text
 * table (`./exposureTexts.ts`) on its way back. So the sweep has no listing logic of its own to drift: a surface's
 * page ceiling, failed page or under-count is the inventory's finding, and the sweep inherits it as `partial` or
 * `read-failed`. A sum over an incomplete parent list stays incomplete for the same reason it does there.
 *
 * ## Two stages read past the inventory
 *
 * The tap remembers every commit the commits listing returned and every job the jobs listing returned. Once the
 * inventory is done, `./exposureContents.ts` reads each commit's diff (every line of every file version) and
 * `./exposureLogs.ts` streams each job's log. Their texts go through the same scan, once each, and their gaps and
 * limits land on `file-history` and `actions-jobs`.
 *
 * ## What this sweep does not read, said per surface
 *
 * Two surfaces publish content this sweep counts but does not fetch: each artifact's archive and each uploaded
 * asset (`./exposureSweepCoverage.ts`). Every text the scan takes also feeds the upload index
 * (`./exposureUploads.ts`), so each upload comes back listed with every place that links it, its bytes left for a
 * visible session to look at.
 */

import { createHash } from "node:crypto";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { readGithubExposureContents } from "./exposureContents.js";
import { githubExposureDiscussionTexts } from "./exposureDiscussionTexts.js";
import { inventoryGithubExposure } from "./exposureInventory.js";
import { type GithubExposureSeam, numberAt, pageItems, stringAt } from "./exposureListing.js";
import { readGithubExposureLogs } from "./exposureLogs.js";
import type {
  GithubExposureCallId,
  GithubExposureReadFailure,
  GithubExposureSurfaceId,
  GithubExposureSurfaceResult,
} from "./exposureModel.js";
import type { GithubExposureFinding, GithubExposureScanner } from "./exposureScan.js";
import { type GithubExposureSweepSurface, githubExposureSweepCoverage } from "./exposureSweepCoverage.js";
import { type GithubExposureText, githubExposureTexts } from "./exposureTexts.js";
import {
  createGithubExposureUploadIndex,
  type GithubExposureUpload,
  type GithubExposureUploadIndex,
} from "./exposureUploads.js";
import type { StreamJobLog } from "./jobLogRead.js";

/** How many 100-file pages of one commit's file list are read: GitHub serves at most 3,000 files of a commit. */
const COMMIT_FILE_PAGES = 30;

/** A whole sweep. `findings` and `uploads` carry matched text and locators, and go only to the state home. */
export interface GithubExposureSweep {
  readonly repository: string;
  readonly readAtIso: string;
  readonly calls: number;
  readonly surfaces: readonly GithubExposureSweepSurface[];
  readonly findings: readonly GithubExposureFinding[];
  readonly uploads: readonly GithubExposureUpload[];
}

/** What the tap gathered while the inventory read. */
interface Gathered {
  readonly texts: Map<GithubExposureSurfaceId, number>;
  readonly gaps: Map<GithubExposureSurfaceId, string[]>;
  readonly limits: Map<GithubExposureSurfaceId, string[]>;
  readonly findings: GithubExposureFinding[];
  /** Every distinct commit the commits listing returned, for the contents stage. */
  readonly commitShas: Set<string>;
  /** Each listed commit's root tree, for a commit whose file list comes back in part. */
  readonly commitTrees: Map<string, string>;
  /** Every distinct job the jobs listing returned, for the log stage. */
  readonly jobIds: Set<number>;
  /** Every distinct blob the tree walk returned, with the first path it sat at, for the contents stage. */
  readonly treeBlobs: Map<string, string>;
}

/** Remember every blob a tree answer lists, at the first path it was seen. */
function rememberTreeBlobs({ data, gathered }: { data: unknown; gathered: Gathered }): void {
  const entries = isRecord(data) ? data["tree"] : undefined;
  if (!Array.isArray(entries)) {
    return;
  }
  for (const entry of entries) {
    const sha = stringAt({ path: ["sha"], value: entry });
    const path = stringAt({ path: ["path"], value: entry });
    const blob = stringAt({ path: ["type"], value: entry }) === "blob";
    if (blob && sha !== undefined && path !== undefined && !gathered.treeBlobs.has(sha)) {
      gathered.treeBlobs.set(sha, path);
    }
  }
}

/** Remember what a later stage reads from an answered listing page: the commits' SHAs and the jobs' ids. */
function rememberSubjects({
  call,
  data,
  gathered,
}: {
  call: GithubExposureCallId;
  data: unknown;
  gathered: Gathered;
}): void {
  if (call === "git-tree") {
    rememberTreeBlobs({ data, gathered });
    return;
  }
  if (call !== "commits" && call !== "actions-jobs") {
    return;
  }
  const page = pageItems({ call, data });
  if (page.isErr()) {
    return;
  }
  for (const item of page.value.items) {
    if (call === "commits") {
      rememberCommit({ gathered, item });
    } else {
      rememberJob({ gathered, item });
    }
  }
}

/** Remember one listed commit's SHA, and its root tree when the listing carries one. */
function rememberCommit({ item, gathered }: { item: unknown; gathered: Gathered }): void {
  const sha = stringAt({ path: ["sha"], value: item });
  if (sha === undefined) {
    return;
  }
  gathered.commitShas.add(sha);
  const tree = stringAt({ path: ["commit", "tree", "sha"], value: item });
  if (tree !== undefined) {
    gathered.commitTrees.set(sha, tree);
  }
}

/** Remember one listed job's id. */
function rememberJob({ item, gathered }: { item: unknown; gathered: Gathered }): void {
  const id = numberAt({ path: ["id"], value: item });
  if (id !== undefined) {
    gathered.jobIds.add(id);
  }
}

/**
 * The scan, once per distinct text.
 *
 * The same commit is listed from many ref tips and the same path sits in many trees, so a text is keyed by its
 * surface, locator, field, line offset and content, and scanned the first time only. A text taken also feeds the
 * upload index, once.
 */
function textTaker({
  scanner,
  gathered,
  uploads,
}: {
  scanner: GithubExposureScanner;
  gathered: Gathered;
  uploads: GithubExposureUploadIndex;
}): (args: { texts: readonly GithubExposureText[] }) => void {
  const seen = new Set<string>();
  return ({ texts }) => {
    for (const text of texts) {
      const key = createHash("sha256")
        .update([text.surface, text.locator, text.field, String(text.lineOffset), text.text].join("\u0000"))
        .digest("hex");
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const before = gathered.texts.get(text.surface);
      gathered.texts.set(text.surface, before === undefined ? 1 : before + 1);
      gathered.findings.push(...scanner.scan({ text }));
      uploads.take({ texts: [text] });
    }
  };
}

/**
 * A seam that hands every answered page's texts to `take` and remembers the later stages' subjects, before handing
 * the page back unchanged.
 */
function tappingSeam({
  seam,
  take,
  gathered,
}: {
  seam: GithubExposureSeam;
  take: (args: { texts: readonly GithubExposureText[] }) => void;
  gathered: Gathered;
}): GithubExposureSeam {
  return {
    get: async (args) => {
      const read = await seam.get(args);
      if (read.isOk()) {
        take({ texts: githubExposureTexts({ call: args.call, data: read.value, params: args.params }) });
        rememberSubjects({ call: args.call, data: read.value, gathered });
      }
      return read;
    },
    graphql: async (args) => {
      const read = await seam.graphql(args);
      if (read.isOk()) {
        const discussions = githubExposureDiscussionTexts({ data: read.value });
        take({ texts: discussions.texts });
        gathered.gaps.set("discussions", [...discussions.gaps]);
      }
      return read;
    },
  };
}

/** The gaps the sweep recorded for a surface: none is the normal answer, since only three surfaces can record one. */
function gapsFor({ gathered, surface }: { gathered: Gathered; surface: GithubExposureSurfaceId }): readonly string[] {
  const gaps = gathered.gaps.get(surface);
  if (gaps === undefined) {
    return [];
  }
  return gaps;
}

/** The limits a later stage met on a surface, beyond the inventory's: only job logs can meet one. */
function limitsFor({ gathered, surface }: { gathered: Gathered; surface: GithubExposureSurfaceId }): readonly string[] {
  const limits = gathered.limits.get(surface);
  if (limits === undefined) {
    return [];
  }
  return limits;
}

/** How many distinct texts the tap scanned on a surface; a surface whose answers carried no text scanned none. */
function textsFor({ gathered, surface }: { gathered: Gathered; surface: GithubExposureSurfaceId }): number {
  const texts = gathered.texts.get(surface);
  if (texts === undefined) {
    return 0;
  }
  return texts;
}

/**
 * Sweep every surface of one repository.
 *
 * @param seam the read seam
 * @param streamLog the run-log verb's log seam, for the job-log stage
 * @param scanner the scan, bound to this run's denylist and identifier rules
 * @param owner the repository owner
 * @param repo the repository name
 * @param nowIso the clock, read once
 * @param maxPages the page ceiling per listing, as the inventory takes it
 * @returns the sweep, or the failure to read the repository document every surface depends on
 */
export async function sweepGithubExposure({
  seam,
  streamLog,
  scanner,
  owner,
  repo,
  nowIso,
  maxPages,
}: {
  seam: GithubExposureSeam;
  streamLog: StreamJobLog;
  scanner: GithubExposureScanner;
  owner: string;
  repo: string;
  nowIso: () => string;
  maxPages?: number;
}): Promise<Result<GithubExposureSweep, GithubExposureReadFailure>> {
  const gathered = emptyGathered();
  const uploadIndex = createGithubExposureUploadIndex();
  const take = textTaker({ gathered, scanner, uploads: uploadIndex });
  const inventory = await inventoryGithubExposure({
    nowIso,
    owner,
    repo,
    seam: tappingSeam({ gathered, seam, take }),
    ...(maxPages === undefined ? {} : { maxPages }),
  });
  if (inventory.isErr()) {
    return err(inventory.error);
  }
  const contents = await readGithubExposureContents({
    commitShas: [...gathered.commitShas],
    commitTrees: gathered.commitTrees,
    maxPages: COMMIT_FILE_PAGES,
    owner,
    repo,
    seam,
    take,
    treeBlobs: gathered.treeBlobs,
  });
  gathered.gaps.set("file-history", [...contents.gaps]);
  const logs = await readGithubExposureLogs({ jobIds: [...gathered.jobIds], owner, repo, streamLog, take });
  gathered.gaps.set("actions-jobs", [...logs.gaps]);
  gathered.limits.set("actions-jobs", [...logs.limits]);
  const uploads = uploadIndex.uploads();
  return ok({
    calls: inventory.value.calls + contents.calls + logs.calls,
    findings: gathered.findings,
    readAtIso: inventory.value.readAtIso,
    repository: inventory.value.repository,
    surfaces: sweptSurfaces({ gathered, results: inventory.value.surfaces, uploadCount: uploads.length }),
    uploads,
  });
}

/** A fresh record for one sweep to gather into. */
function emptyGathered(): Gathered {
  return {
    commitShas: new Set(),
    commitTrees: new Map(),
    findings: [],
    gaps: new Map(),
    jobIds: new Set(),
    limits: new Map(),
    texts: new Map(),
    treeBlobs: new Map(),
  };
}

/**
 * Every inventoried surface with its sweep coverage and finding count, from what the stages gathered. Pure.
 *
 * `uploadCount` is the sweep's own count of distinct uploads linked anywhere, which decides `attachments`.
 */
function sweptSurfaces({
  gathered,
  results,
  uploadCount,
}: {
  gathered: Gathered;
  results: readonly GithubExposureSurfaceResult[];
  uploadCount: number;
}): GithubExposureSweepSurface[] {
  return results.map((result) => ({
    coverage: githubExposureSweepCoverage({
      result,
      sweepGaps: gapsFor({ gathered, surface: result.surface }),
      sweepLimits: limitsFor({ gathered, surface: result.surface }),
      texts: textsFor({ gathered, surface: result.surface }),
      uploadCount,
    }),
    findings: gathered.findings.filter((finding) => finding.surface === result.surface).length,
    surface: result.surface,
  }));
}
