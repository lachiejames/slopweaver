/*
 * The world `github pr review-prepare`, `github pr review-record` and the write verbs' check run in, end to end: a real
 * pull request checkout, a real rules tree, a real packet repository and receipt store under a throwaway home. Only
 * the reviewer is a fixture: a Codex pass record or a Claude fallback receipt built over the packet's own commits,
 * handed in through the deps seam.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { runGithubPrReviewPrepare } from "../../../../../cli/commands/github/prDescriptionReviewPrepareRun.js";
import {
  type GithubPrDescriptionReviewDeps,
  runGithubPrReviewRecord,
} from "../../../../../cli/commands/github/prDescriptionReviewRun.js";
import type { FallbackReceiptScan } from "../../../../../codex/fallbackDocuments.js";
import type { ClaudeFallbackReviewReceipt } from "../../../../../codex/fallbackReview.js";
import type { CodexArtifactRecord } from "../../../../../codex/types.js";
import type { AttachUploadStanding } from "../../../../../handover/attachUploadRuling.js";
import { ok, unwrap } from "../../../../../lib/result.js";
import type { DescriptionUnderReview } from "../../../../../outbound/github/descriptionReviewGate.js";
import {
  packetCommitFacts,
  preparationsDirectory,
  readPreparationAtRoot,
} from "../../../../../outbound/github/descriptionReviewStore.js";
import {
  DESCRIPTION_REVIEW_PROPERTY,
  DESCRIPTION_REVIEW_PROPERTY_ID,
  DESCRIPTION_RULE_FILES,
  type DescriptionReviewComment,
  type ExistingPullRequestComment,
  type StoredDescriptionReviewPreparation,
} from "../../../../../outbound/github/descriptionReviewTypes.js";
import { PERMITTED_ATTACH_UPLOAD } from "../../../../attachRunFixture.js";
import { FIXTURE_REVIEW_SCOPE, fixtureCodexRecord, fixtureFallbackReceipt } from "../../../../pageReviewFixture.js";
import { gitInTemp } from "../../../../tempGitRepo.js";

/** A fixed identity, no signing and no hooks, for every command that writes a commit. */
export const IDENTITY: readonly string[] = [
  "-c",
  "user.name=fixture",
  "-c",
  "user.email=fixture@example.invalid",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.hooksPath=/dev/null",
];

const TITLE = "fix(widgets): count every widget once";
export const BODY =
  "Counts each widget once.\n\n## Test evidence\n\n| Check | Result |\n| --- | --- |\n| unit | pass |\n";
const PROPERTY = { id: DESCRIPTION_REVIEW_PROPERTY_ID, statement: DESCRIPTION_REVIEW_PROPERTY };

/** The one walkthrough comment the write posts. */
export const WALKTHROUGH: DescriptionReviewComment = {
  body: "💡 The counter now reads each widget once.",
  line: 1,
  path: "src/count.ts",
};

/** A conversation comment already on the open pull request. */
export const ON_THE_PR: ExistingPullRequestComment = {
  authorLogin: "zorvane",
  body: "Does this count a widget shared by two boards twice?",
  createdAtIso: "2026-11-17T00:30:00Z",
  id: "IC_1",
  kind: "issue-comment",
  updatedAtIso: "2026-11-17T00:30:00Z",
  url: "https://github.com/acme/widgets/pull/7#issuecomment-1",
};

/**
 * Commit everything in a working tree.
 *
 * @param repo the working tree to commit
 */
export function commitAll({ repo, message }: { repo: string; message: string }): void {
  gitInTemp({ args: ["add", "--all"], cwd: repo });
  gitInTemp({ args: [...IDENTITY, "commit", "--quiet", "--no-verify", "-m", message], cwd: repo });
}

/** A packet the writing session prepared, and what it wrote. */
interface PreparedPacket {
  readonly exit: number;
  readonly preparation: StoredDescriptionReviewPreparation;
  readonly repoRoot: string;
}

/** One world's paths, its reviewer fixtures, what it observed, and the verbs run inside it. */
export interface DescriptionReviewWorld {
  readonly repo: string;
  readonly home: string;
  readonly bodyFile: string;
  readonly commentsFile: string;
  readonly passes: Map<string, CodexArtifactRecord>;
  /** Every diagnostic line a verb wrote, in order. */
  readonly diagnostics: string[];
  /** Every pull-request number the comment reader was asked for. */
  readonly commentsAskedFor: number[];
  /** What the comment reader answers for the open pull request. */
  onThePr: readonly ExistingPullRequestComment[];
  /** The home's attach-upload standing; permitted unless a test refuses it. */
  attachUpload: AttachUploadStanding;
  /** The deps one session runs the verbs with. */
  readonly depsFor: (options: { session: string }) => GithubPrDescriptionReviewDeps;
  /** The full prepare argv over the checkout, for a new pull request unless one is named. */
  readonly prepareArgs: (options?: { number?: number }) => string[];
  /** Prepare the packet as the writing session, and read back what it wrote. */
  readonly prepare: (options?: { number?: number }) => Promise<PreparedPacket>;
  /** Record one review id as the named session. */
  readonly record: (options: { reviewId: string; session: string }) => Promise<number>;
  /** Store a Codex pass over the packet, under its artifact id. */
  readonly codexPass: (options: PreparedPacket & { artifactId: string; verdict: "CLEAN" | "BROKEN" }) => void;
  /** Store a Claude fallback receipt over the packet. */
  readonly fallbackReview: (options: PreparedPacket & { receiptId: string }) => void;
  /** What the write verb would send, as it stands in the checkout now. */
  readonly described: (over?: Partial<DescriptionUnderReview>) => DescriptionUnderReview;
  /** Remove everything the world wrote. */
  readonly cleanUp: () => void;
}

/** The world's paths under one throwaway root. */
interface WorldPaths {
  readonly root: string;
  readonly repo: string;
  readonly rules: string;
  readonly home: string;
  readonly bodyFile: string;
  readonly commentsFile: string;
}

/** Mint the root and lay out a `main` branch with two files, a `feature` branch changing one, and the rules tree. */
function seedWorld(): WorldPaths {
  const root = mkdtempSync(join(tmpdir(), "sw-pr-desc-review-"));
  const paths = {
    bodyFile: join(root, "body.md"),
    commentsFile: join(root, "comments.json"),
    home: join(root, "home"),
    repo: join(root, "repo"),
    root,
    rules: join(root, "rules"),
  };
  const { repo } = paths;
  mkdirSync(join(repo, "src"), { recursive: true });
  mkdirSync(paths.home);
  gitInTemp({ args: ["init", "--quiet", "--initial-branch=main"], cwd: repo });
  writeFileSync(join(repo, "src", "count.ts"), "export const count = 1;\n");
  writeFileSync(join(repo, "src", "other.ts"), "export const other = 1;\n");
  commitAll({ message: "base", repo });
  gitInTemp({ args: ["checkout", "--quiet", "-b", "feature"], cwd: repo });
  writeFileSync(join(repo, "src", "count.ts"), "export const count = 2;\n");
  commitAll({ message: "count once", repo });
  for (const file of DESCRIPTION_RULE_FILES) {
    mkdirSync(dirname(join(paths.rules, file)), { recursive: true });
    writeFileSync(join(paths.rules, file), `# ${file}\n\nA written rule.\n`);
  }
  writeFileSync(paths.bodyFile, BODY);
  writeFileSync(paths.commentsFile, "[]\n");
  return paths;
}

/** The commits and diff digest a reviewer of this packet would record. */
function scopeOf({ preparation, repoRoot }: PreparedPacket): { baseSha: string; diffSha256: string; headSha: string } {
  const { baseSha, headSha } = preparation;
  const facts = unwrap(packetCommitFacts({ baseSha, headSha, repoRoot }));
  return { baseSha, diffSha256: facts.diffSha256, headSha };
}

/** A Codex pass record over the packet, answering the verdict asked for. */
function codexPassRecord(
  packet: PreparedPacket & { artifactId: string; verdict: "CLEAN" | "BROKEN" },
): CodexArtifactRecord {
  const { baseSha, diffSha256, headSha } = scopeOf(packet);
  const scope = { ...FIXTURE_REVIEW_SCOPE, baseRef: baseSha, baseSha, diffSha256, headSha, property: PROPERTY };
  const answer = {
    counterexample: "",
    evidence: "read description/body.md against change/diff.patch",
    propertyId: DESCRIPTION_REVIEW_PROPERTY_ID,
    summary: `the description is ${packet.verdict}.`,
    verdict: packet.verdict,
  };
  const outcome = { answer, kind: "answered" as const, rawFinalResponse: "{}" };
  return { ...fixtureCodexRecord({ artifactId: packet.artifactId, outcome, scope }), repoRoot: packet.repoRoot };
}

/** A Claude fallback receipt over the packet. */
function fallbackReceiptOver(packet: PreparedPacket & { receiptId: string }): ClaudeFallbackReviewReceipt {
  const base = fixtureFallbackReceipt({ receiptId: packet.receiptId, requestId: `${packet.receiptId}-request` });
  const { baseSha, diffSha256, headSha } = scopeOf(packet);
  const request = { ...base.request, baseRef: baseSha, baseSha, diffSha256, headSha, property: PROPERTY };
  return {
    ...base,
    answer: { ...base.answer, propertyId: DESCRIPTION_REVIEW_PROPERTY_ID },
    request: { ...request, repoRoot: packet.repoRoot },
  };
}

/** A fallback scan holding exactly the receipts given. */
function scanOf({ receipts }: { receipts: ClaudeFallbackReviewReceipt[] }): FallbackReceiptScan {
  return {
    foreign: 0,
    foreignModes: [],
    foreignReceipts: [],
    pending: 0,
    pendingPlans: 0,
    planReceipts: [],
    problems: [],
    receipts,
    unboundReceipts: [],
    unreadable: 0,
  };
}

/** The full prepare argv over the world's checkout, for a new pull request unless one is named. */
function prepareArgv({ paths, number }: { paths: WorldPaths; number?: number | undefined }): string[] {
  const which = number === undefined ? ["--new"] : ["--number", String(number)];
  const { bodyFile, commentsFile, home, repo } = paths;
  const where = ["--repo", "acme/widgets", "--base", "main", "--base-ref", "main", "--head", "feature", "--cwd", repo];
  return [...which, "--comments", commentsFile, ...where, "--title", TITLE, "--body-file", bodyFile, "--home", home];
}

/** What the write verb would send over the world's checkout, with any field replaced. */
function describedIn({
  paths,
  over,
}: {
  paths: WorldPaths;
  over: Partial<DescriptionUnderReview>;
}): DescriptionUnderReview {
  return {
    baseBranch: "main",
    baseRef: "main",
    body: BODY,
    comments: [],
    existingComments: [],
    headRef: "feature",
    images: [],
    installedRulesRoot: paths.rules,
    repoDir: paths.repo,
    repository: "acme/widgets",
    title: TITLE,
    ...over,
  };
}

/**
 * Build a fresh world: the seeded checkout and rules tree, an empty home, the body file and an empty
 * outgoing-comments file.
 *
 * @returns the world, which the caller removes with `cleanUp`
 */
export function descriptionReviewWorld(): DescriptionReviewWorld {
  const paths = seedWorld();
  const { home, repo } = paths;
  const counter = { ids: 0 };
  const fallbacks: ClaudeFallbackReviewReceipt[] = [];
  const world: DescriptionReviewWorld = {
    attachUpload: PERMITTED_ATTACH_UPLOAD,
    bodyFile: paths.bodyFile,
    cleanUp: () => {
      rmSync(paths.root, { force: true, recursive: true });
    },
    codexPass: (packet) => {
      world.passes.set(packet.artifactId, codexPassRecord(packet));
    },
    commentsAskedFor: [],
    commentsFile: paths.commentsFile,
    depsFor: ({ session }) => ({
      attachUploadStanding: () => world.attachUpload,
      cwd: repo,
      env: { CLAUDE_CODE_SESSION_ID: session },
      installedRulesRoot: paths.rules,
      newId: () => {
        counter.ids += 1;
        return `id-${String(counter.ids)}`;
      },
      nowIso: () => "2026-11-17T01:00:00.000Z",
      out: () => undefined,
      readComments: ({ number }) => {
        world.commentsAskedFor.push(number);
        return Promise.resolve(ok({ comments: world.onThePr, pullRequestId: "PR_7" }));
      },
      readPass: ({ artifactId }) => ok(world.passes.get(artifactId)),
      scanFallback: () => Promise.resolve(ok(scanOf({ receipts: fallbacks }))),
      writeDiagnostic: ({ line }) => {
        world.diagnostics.push(line);
      },
    }),
    described: (over = {}) => describedIn({ over, paths }),
    diagnostics: [],
    fallbackReview: (packet) => {
      fallbacks.push(fallbackReceiptOver(packet));
    },
    home,
    onThePr: [],
    passes: new Map(),
    prepare: async ({ number }: { number?: number } = {}) => {
      const rest = prepareArgv({ number, paths });
      const exit = await runGithubPrReviewPrepare({ deps: world.depsFor({ session: "writer" }), rest });
      const repoRoot = join(preparationsDirectory({ home }), `id-${String(counter.ids)}`, "repo");
      return { exit, preparation: unwrap(readPreparationAtRoot({ home, repoRoot }))!, repoRoot };
    },
    prepareArgs: ({ number }: { number?: number } = {}) => prepareArgv({ number, paths }),
    record: ({ reviewId, session }) =>
      runGithubPrReviewRecord({ deps: world.depsFor({ session }), rest: ["--review", reviewId, "--home", home] }),
    repo,
  };
  return world;
}
