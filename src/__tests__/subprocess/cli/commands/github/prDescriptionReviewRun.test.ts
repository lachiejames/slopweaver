/*
 * `github pr review-prepare`, `github pr review-record` and the write verbs' check, end to end over a real pull
 * request checkout, a real packet repository and a real receipt store. Only the reviewer is a fixture: a Codex
 * pass record or a Claude fallback receipt built over the packet's own commits, handed in through the deps seam.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runGithubPrReviewPrepare } from "../../../../../cli/commands/github/prDescriptionReviewPrepareRun.js";
import {
  type GithubPrDescriptionReviewDeps,
  runGithubPrReviewRecord,
} from "../../../../../cli/commands/github/prDescriptionReviewRun.js";
import type { FallbackReceiptScan } from "../../../../../codex/fallbackDocuments.js";
import type { ClaudeFallbackReviewReceipt } from "../../../../../codex/fallbackReview.js";
import type { CodexArtifactRecord } from "../../../../../codex/types.js";
import type { AttachUploadStanding } from "../../../../../handover/attachUploadRuling.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { textSha256 } from "../../../../../outbound/github/descriptionReview.js";
import { DescriptionReviewErrors } from "../../../../../outbound/github/descriptionReviewErrors.js";
import {
  type DescriptionUnderReview,
  requireCleanDescriptionReview,
} from "../../../../../outbound/github/descriptionReviewGate.js";
import {
  PACKET_COMMENTS_PATH,
  PACKET_EXISTING_COMMENTS_PATH,
  packetCommitFacts,
  preparationsDirectory,
  readPreparationAtRoot,
} from "../../../../../outbound/github/descriptionReviewStore.js";
import {
  DESCRIPTION_REVIEW_PROPERTY,
  DESCRIPTION_REVIEW_PROPERTY_ID,
  DESCRIPTION_RULE_FILES,
  type DescriptionReviewComment,
  type DescriptionReviewPreparation,
  descriptionReviewPacketReadme,
  type ExistingPullRequestComment,
} from "../../../../../outbound/github/descriptionReviewTypes.js";
import { PERMITTED_ATTACH_UPLOAD } from "../../../../attachRunFixture.js";
import { FIXTURE_REVIEW_SCOPE, fixtureCodexRecord, fixtureFallbackReceipt } from "../../../../pageReviewFixture.js";
import { gitInTemp } from "../../../../tempGitRepo.js";

/** A fixed identity, no signing and no hooks, for every command that writes a commit. */
const IDENTITY: readonly string[] = [
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
const BODY = "Counts each widget once.\n\n## Test evidence\n\n| Check | Result |\n| --- | --- |\n| unit | pass |\n";
const PROPERTY = { id: DESCRIPTION_REVIEW_PROPERTY_ID, statement: DESCRIPTION_REVIEW_PROPERTY };

/** The one walkthrough comment the write posts. */
const WALKTHROUGH: DescriptionReviewComment = {
  body: "💡 The counter now reads each widget once.",
  line: 1,
  path: "src/count.ts",
};

/** A conversation comment already on the open pull request. */
const ON_THE_PR: ExistingPullRequestComment = {
  authorLogin: "zorvane",
  body: "Does this count a widget shared by two boards twice?",
  createdAtIso: "2026-11-17T00:30:00Z",
  id: "IC_1",
  kind: "issue-comment",
  updatedAtIso: "2026-11-17T00:30:00Z",
  url: "https://github.com/acme/widgets/pull/7#issuecomment-1",
};

/** Commit everything in a working tree. */
function commitAll({ repo, message }: { repo: string; message: string }): void {
  gitInTemp({ args: ["add", "--all"], cwd: repo });
  gitInTemp({ args: [...IDENTITY, "commit", "--quiet", "--no-verify", "-m", message], cwd: repo });
}

describe("github pr review-prepare and review-record", () => {
  let root = "";
  let repo = "";
  let rules = "";
  let home = "";
  let bodyFile = "";
  let commentsFile = "";
  let ids = 0;
  const passes = new Map<string, CodexArtifactRecord>();
  const fallbacks: ClaudeFallbackReviewReceipt[] = [];
  let diagnostics: string[] = [];
  /** What the comment reader answers for the open pull request, and every number it was asked for. */
  let onThePr: readonly ExistingPullRequestComment[] = [];
  let commentsAskedFor: number[] = [];
  /** The home's attach-upload standing; permitted unless a test refuses it. */
  let attachUpload: AttachUploadStanding = PERMITTED_ATTACH_UPLOAD;

  beforeEach(() => {
    attachUpload = PERMITTED_ATTACH_UPLOAD;
    root = mkdtempSync(join(tmpdir(), "sw-pr-desc-review-"));
    repo = join(root, "repo");
    rules = join(root, "rules");
    home = join(root, "home");
    bodyFile = join(root, "body.md");
    commentsFile = join(root, "comments.json");
    ids = 0;
    passes.clear();
    fallbacks.length = 0;
    diagnostics = [];
    onThePr = [];
    commentsAskedFor = [];
    mkdirSync(join(repo, "src"), { recursive: true });
    mkdirSync(home);
    gitInTemp({ args: ["init", "--quiet", "--initial-branch=main"], cwd: repo });
    writeFileSync(join(repo, "src", "count.ts"), "export const count = 1;\n");
    writeFileSync(join(repo, "src", "other.ts"), "export const other = 1;\n");
    commitAll({ message: "base", repo });
    gitInTemp({ args: ["checkout", "--quiet", "-b", "feature"], cwd: repo });
    writeFileSync(join(repo, "src", "count.ts"), "export const count = 2;\n");
    commitAll({ message: "count once", repo });
    for (const file of DESCRIPTION_RULE_FILES) {
      mkdirSync(dirname(join(rules, file)), { recursive: true });
      writeFileSync(join(rules, file), `# ${file}\n\nA written rule.\n`);
    }
    writeFileSync(bodyFile, BODY);
    writeFileSync(commentsFile, "[]\n");
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  /** The deps one session runs the verbs with. */
  function depsFor({ session }: { session: string }): GithubPrDescriptionReviewDeps {
    return {
      attachUploadStanding: () => attachUpload,
      cwd: repo,
      env: { CLAUDE_CODE_SESSION_ID: session },
      installedRulesRoot: rules,
      newId: () => {
        ids += 1;
        return `id-${String(ids)}`;
      },
      nowIso: () => "2026-11-17T01:00:00.000Z",
      out: () => undefined,
      readComments: ({ number }) => {
        commentsAskedFor.push(number);
        return Promise.resolve(ok(onThePr));
      },
      readPass: ({ artifactId }) => ok(passes.get(artifactId)),
      scanFallback: () => {
        const scan: FallbackReceiptScan = {
          foreign: 0,
          foreignModes: [],
          foreignReceipts: [],
          pending: 0,
          pendingPlans: 0,
          planReceipts: [],
          problems: [],
          receipts: fallbacks,
          unboundReceipts: [],
          unreadable: 0,
        };
        return Promise.resolve(ok(scan));
      },
      writeDiagnostic: ({ line }) => {
        diagnostics.push(line);
      },
    };
  }

  /** The full prepare argv over the fixture checkout, for a new pull request unless one is named. */
  function prepareArgs({ number }: { number?: number } = {}): string[] {
    const which = number === undefined ? ["--new"] : ["--number", String(number)];
    return [
      ...which,
      "--comments",
      commentsFile,
      "--repo",
      "acme/widgets",
      "--base",
      "main",
      "--base-ref",
      "main",
      "--head",
      "feature",
      "--cwd",
      repo,
      "--title",
      TITLE,
      "--body-file",
      bodyFile,
      "--home",
      home,
    ];
  }

  /** Prepare the packet as the writing session, and read back what it wrote. */
  async function prepare({ number }: { number?: number } = {}): Promise<{
    exit: number;
    preparation: DescriptionReviewPreparation;
    repoRoot: string;
  }> {
    const rest = number === undefined ? prepareArgs() : prepareArgs({ number });
    const exit = await runGithubPrReviewPrepare({ deps: depsFor({ session: "writer" }), rest });
    const repoRoot = join(preparationsDirectory({ home }), `id-${String(ids)}`, "repo");
    const preparation = unwrap(readPreparationAtRoot({ home, repoRoot }))!;
    return { exit, preparation, repoRoot };
  }

  /** Record one review id as the named session. */
  function record({ reviewId, session }: { reviewId: string; session: string }): Promise<number> {
    return runGithubPrReviewRecord({ deps: depsFor({ session }), rest: ["--review", reviewId, "--home", home] });
  }

  /** The commits and diff digest a reviewer of this packet would record. */
  function scopeOf({ preparation, repoRoot }: { preparation: DescriptionReviewPreparation; repoRoot: string }): {
    baseSha: string;
    diffSha256: string;
    headSha: string;
  } {
    const { baseSha, headSha } = preparation;
    const facts = unwrap(packetCommitFacts({ baseSha, headSha, repoRoot }));
    return { baseSha, diffSha256: facts.diffSha256, headSha };
  }

  /** Store a Codex pass over the packet, under its artifact id. */
  function codexPass({
    artifactId,
    preparation,
    repoRoot,
    verdict,
  }: {
    artifactId: string;
    preparation: DescriptionReviewPreparation;
    repoRoot: string;
    verdict: "CLEAN" | "BROKEN";
  }): void {
    const { baseSha, diffSha256, headSha } = scopeOf({ preparation, repoRoot });
    const scope = { ...FIXTURE_REVIEW_SCOPE, baseRef: baseSha, baseSha, diffSha256, headSha, property: PROPERTY };
    const answer = {
      counterexample: "",
      evidence: "read description/body.md against change/diff.patch",
      propertyId: DESCRIPTION_REVIEW_PROPERTY_ID,
      summary: `the description is ${verdict}.`,
      verdict,
    };
    const outcome = { answer, kind: "answered" as const, rawFinalResponse: "{}" };
    passes.set(artifactId, { ...fixtureCodexRecord({ artifactId, outcome, scope }), repoRoot });
  }

  /** Store a Claude fallback receipt over the packet. */
  function fallbackReview({
    preparation,
    receiptId,
    repoRoot,
  }: {
    preparation: DescriptionReviewPreparation;
    receiptId: string;
    repoRoot: string;
  }): void {
    const base = fixtureFallbackReceipt({ receiptId, requestId: `${receiptId}-request` });
    const { baseSha, diffSha256, headSha } = scopeOf({ preparation, repoRoot });
    fallbacks.push({
      ...base,
      answer: { ...base.answer, propertyId: DESCRIPTION_REVIEW_PROPERTY_ID },
      request: { ...base.request, baseRef: baseSha, baseSha, diffSha256, headSha, property: PROPERTY, repoRoot },
    });
  }

  /** What the write verb would send, as it stands in the checkout now. */
  function described(over: Partial<DescriptionUnderReview> = {}): DescriptionUnderReview {
    return {
      baseBranch: "main",
      baseRef: "main",
      body: BODY,
      comments: [],
      existingComments: [],
      headRef: "feature",
      images: [],
      installedRulesRoot: rules,
      repoDir: repo,
      repository: "acme/widgets",
      title: TITLE,
      ...over,
    };
  }

  it("opens the write over a CLEAN Codex review of these exact bytes", async () => {
    const prepared = await prepare();
    expect(prepared.exit).toBe(0);
    expect(prepared.preparation.preparedBy).toStrictEqual({ host: "claude-code", id: "writer" });
    codexPass({ ...prepared, artifactId: "pass-1", verdict: "CLEAN" });
    const recorded = await record({ reviewId: "pass-1", session: "writer" });
    expect(diagnostics).toStrictEqual([]);
    expect(recorded).toBe(0);
    const receipt = unwrap(requireCleanDescriptionReview({ description: described(), home }));
    expect(receipt.verdict).toBe("CLEAN");
    expect(receipt.reviewer).toBe("codex");
    expect(receipt.reviewId).toBe("pass-1");
    expect(receipt.manifestSha256).toBe(prepared.preparation.manifestSha256);
  });

  it("refuses the write with no review, and names what changed since the last one", async () => {
    expect(unwrapErr(requireCleanDescriptionReview({ description: described(), home })).code).toBe("REVIEW_MISSING");
    const prepared = await prepare();
    codexPass({ ...prepared, artifactId: "pass-1", verdict: "CLEAN" });
    expect(await record({ reviewId: "pass-1", session: "writer" })).toBe(0);
    const failure = unwrapErr(
      requireCleanDescriptionReview({ description: described({ body: `${BODY}One more line.\n` }), home }),
    );
    expect(failure.code).toBe("REVIEW_MISSING");
    expect(failure.message).toContain("against the last review of this repository's description, the body changed.");
    expect(failure.message).toContain("There is no escape hatch");
  });

  it("refuses the write when the change set's content moves after the review", async () => {
    const prepared = await prepare();
    codexPass({ ...prepared, artifactId: "pass-1", verdict: "CLEAN" });
    expect(await record({ reviewId: "pass-1", session: "writer" })).toBe(0);
    writeFileSync(join(repo, "src", "count.ts"), "export const count = 3;\n");
    commitAll({ message: "count again", repo });
    const failure = unwrapErr(requireCleanDescriptionReview({ description: described(), home }));
    expect(failure.code).toBe("REVIEW_MISSING");
    expect(failure.message).toContain("the change set's content changed");
  });

  it("keeps the write open across a pure rebase onto a base that moved elsewhere", async () => {
    const prepared = await prepare();
    codexPass({ ...prepared, artifactId: "pass-1", verdict: "CLEAN" });
    expect(await record({ reviewId: "pass-1", session: "writer" })).toBe(0);
    gitInTemp({ args: ["checkout", "--quiet", "main"], cwd: repo });
    writeFileSync(join(repo, "src", "other.ts"), "export const other = 2;\n");
    commitAll({ message: "base moves", repo });
    gitInTemp({ args: ["checkout", "--quiet", "feature"], cwd: repo });
    gitInTemp({ args: [...IDENTITY, "rebase", "--quiet", "main"], cwd: repo });
    expect(unwrap(requireCleanDescriptionReview({ description: described(), home })).reviewId).toBe("pass-1");
  });

  it("takes one review per packet: a second record and a second prepare are both refused", async () => {
    const prepared = await prepare();
    codexPass({ ...prepared, artifactId: "pass-1", verdict: "CLEAN" });
    codexPass({ ...prepared, artifactId: "pass-2", verdict: "CLEAN" });
    expect(await record({ reviewId: "pass-1", session: "writer" })).toBe(0);
    expect(await record({ reviewId: "pass-2", session: "writer" })).toBe(1);
    expect(diagnostics.at(-1)).toContain("already has its review (receipt id-2, CLEAN)");
    expect(await runGithubPrReviewPrepare({ deps: depsFor({ session: "writer" }), rest: prepareArgs() })).toBe(1);
    expect(diagnostics.at(-1)).toContain("already has its review (receipt id-2, CLEAN)");
  });

  it("stores a BROKEN review, and the write stays shut on it", async () => {
    const prepared = await prepare();
    codexPass({ ...prepared, artifactId: "pass-1", verdict: "BROKEN" });
    expect(await record({ reviewId: "pass-1", session: "writer" })).toBe(1);
    const failure = unwrapErr(requireCleanDescriptionReview({ description: described(), home }));
    expect(failure.code).toBe("REVIEW_BROKEN");
    expect(failure.message).toContain("came back BROKEN (receipt id-2): the description is BROKEN.");
  });

  it("refuses a Claude fallback review recorded by the session that prepared the packet", async () => {
    const prepared = await prepare();
    fallbackReview({ ...prepared, receiptId: "fallback-1" });
    expect(await record({ reviewId: "fallback-1", session: "writer" })).toBe(1);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain("the review is not from a fresh reviewer: session");
    expect(diagnostics[0]).toContain("prepared this packet and is recording its own review");
    expect(unwrapErr(requireCleanDescriptionReview({ description: described(), home })).code).toBe("REVIEW_MISSING");
  });

  it("records a Claude fallback review taken by a separate visible session", async () => {
    const prepared = await prepare();
    fallbackReview({ ...prepared, receiptId: "fallback-1" });
    const recorded = await record({ reviewId: "fallback-1", session: "reviewer" });
    expect(diagnostics).toStrictEqual([]);
    expect(recorded).toBe(0);
    const receipt = unwrap(requireCleanDescriptionReview({ description: described(), home }));
    expect(receipt.reviewer).toBe("claude-fallback");
    expect(receipt.recordedBy).toStrictEqual({ host: "claude-code", id: "reviewer" });
  });

  it("commits the outgoing comments at the head and the pull request's own comments at the base", async () => {
    writeFileSync(commentsFile, JSON.stringify([WALKTHROUGH]));
    onThePr = [ON_THE_PR];
    const prepared = await prepare({ number: 7 });
    expect(prepared.exit).toBe(0);
    expect(commentsAskedFor).toStrictEqual([7]);
    const show = ({ ref }: { ref: string }): unknown =>
      JSON.parse(gitInTemp({ args: ["show", ref], cwd: prepared.repoRoot }));
    expect(show({ ref: `${prepared.preparation.headSha}:${PACKET_COMMENTS_PATH}` })).toStrictEqual([WALKTHROUGH]);
    expect(show({ ref: `${prepared.preparation.baseSha}:${PACKET_EXISTING_COMMENTS_PATH}` })).toStrictEqual([
      ON_THE_PR,
    ]);
  });

  it("tells the reviewer no picture can come when attach upload is not permitted, and only then", async () => {
    const permitted = await prepare();
    attachUpload = { because: "unruled", kind: "refused" };
    writeFileSync(bodyFile, `${BODY}\n`);
    const refused = await prepare();
    const readme = ({ prepared }: { prepared: { preparation: DescriptionReviewPreparation; repoRoot: string } }) =>
      gitInTemp({ args: ["show", `${prepared.preparation.baseSha}:README.md`], cwd: prepared.repoRoot });
    // gitInTemp trims its stdout, so each expected README is trimmed the same way.
    // Another repository's rules come from the installed tree, and its README says so.
    expect([readme({ prepared: permitted }), readme({ prepared: refused })]).toEqual([
      descriptionReviewPacketReadme({ attachUploadPermitted: true, rulesOrigin: { kind: "installed" } }).trim(),
      descriptionReviewPacketReadme({ attachUploadPermitted: false, rulesOrigin: { kind: "installed" } }).trim(),
    ]);
  });

  it("reads no comment for a pull request not yet opened", async () => {
    onThePr = [ON_THE_PR];
    const prepared = await prepare();
    expect(prepared.exit).toBe(0);
    expect(commentsAskedFor).toStrictEqual([]);
    expect(prepared.preparation.manifest.existingCommentsSha256).toBe(textSha256({ text: "[]\n" }));
  });

  it("shuts the write when the comments it would post are not the ones reviewed", async () => {
    writeFileSync(commentsFile, JSON.stringify([WALKTHROUGH]));
    const prepared = await prepare();
    codexPass({ ...prepared, artifactId: "pass-1", verdict: "CLEAN" });
    expect(await record({ reviewId: "pass-1", session: "writer" })).toBe(0);
    expect(
      unwrap(requireCleanDescriptionReview({ description: described({ comments: [WALKTHROUGH] }), home })).reviewId,
    ).toBe("pass-1");
    const reworded = { ...WALKTHROUGH, body: "💡 The counter reads each widget once." };
    const failure = unwrapErr(
      requireCleanDescriptionReview({ description: described({ comments: [reworded] }), home }),
    );
    expect(failure.code).toBe("REVIEW_MISSING");
    expect(failure.message).toContain("the comments this write would post changed");
  });

  it("shuts the write when a comment arrives on the pull request after the review", async () => {
    onThePr = [ON_THE_PR];
    const prepared = await prepare({ number: 7 });
    codexPass({ ...prepared, artifactId: "pass-1", verdict: "CLEAN" });
    expect(await record({ reviewId: "pass-1", session: "writer" })).toBe(0);
    const reviewed = described({ existingComments: [ON_THE_PR] });
    expect(unwrap(requireCleanDescriptionReview({ description: reviewed, home })).reviewId).toBe("pass-1");
    const arrived = { ...ON_THE_PR, body: "It does not, the board id is the key.", id: "IC_2" };
    const failure = unwrapErr(
      requireCleanDescriptionReview({ description: described({ existingComments: [ON_THE_PR, arrived] }), home }),
    );
    expect(failure.code).toBe("REVIEW_MISSING");
    expect(failure.message).toContain("the pull request's existing comments changed");
  });

  it("refuses to prepare when the pull request's comments cannot be read whole", async () => {
    const deps: GithubPrDescriptionReviewDeps = {
      ...depsFor({ session: "writer" }),
      readComments: () =>
        Promise.resolve(
          err(DescriptionReviewErrors.commentsReadFailed({ detail: "the review threads has more than 100 nodes" })),
        ),
    };
    expect(await runGithubPrReviewPrepare({ deps, rest: prepareArgs({ number: 7 }) })).toBe(1);
    expect(diagnostics.at(-1)).toContain("the review threads has more than 100 nodes");
  });

  it("refuses a review whose record names some other repository than the packet", async () => {
    const prepared = await prepare();
    codexPass({ ...prepared, artifactId: "pass-1", verdict: "CLEAN" });
    passes.set("pass-1", { ...passes.get("pass-1")!, repoRoot: repo });
    expect(await record({ reviewId: "pass-1", session: "writer" })).toBe(1);
    expect(diagnostics[0]).toContain("review pass-1 is not a review of this packet");
  });
});
