/*
 * `github pr review-prepare`, `github pr review-record` and the write verbs' check, end to end over a real pull
 * request checkout, a real packet repository and a real receipt store. Only the reviewer is a fixture: a Codex
 * pass record or a Claude fallback receipt built over the packet's own commits, handed in through the deps seam
 * (`./prDescriptionReviewWorld.ts`).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runGithubPrReviewPrepare } from "../../../../../cli/commands/github/prDescriptionReviewPrepareRun.js";
import type { GithubPrDescriptionReviewDeps } from "../../../../../cli/commands/github/prDescriptionReviewRun.js";
import type { CodexArtifactRecord } from "../../../../../codex/types.js";
import { err, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { safeJsonStringify } from "../../../../../lib/safeJson.js";
import { textSha256 } from "../../../../../outbound/github/descriptionReview.js";
import { DescriptionReviewErrors } from "../../../../../outbound/github/descriptionReviewErrors.js";
import { requireCleanDescriptionReview } from "../../../../../outbound/github/descriptionReviewGate.js";
import {
  listReadableReceipts,
  PACKET_COMMENTS_PATH,
  PACKET_EXISTING_COMMENTS_PATH,
  preparationsDirectory,
  readPreparationAtRoot,
  receiptsDirectory,
  writeReceiptOnce,
} from "../../../../../outbound/github/descriptionReviewStore.js";
import {
  type DescriptionReviewReceipt,
  descriptionReviewPacketReadme,
  type StoredDescriptionReviewPreparation,
} from "../../../../../outbound/github/descriptionReviewTypes.js";
import { gitInTemp } from "../../../../tempGitRepo.js";
import {
  BODY,
  commitAll,
  type DescriptionReviewWorld,
  descriptionReviewWorld,
  IDENTITY,
  ON_THE_PR,
  WALKTHROUGH,
} from "./prDescriptionReviewWorld.js";

describe("github pr review-prepare and review-record", () => {
  let world: DescriptionReviewWorld;
  let repo = "";
  let home = "";
  let bodyFile = "";
  let commentsFile = "";
  let passes = new Map<string, CodexArtifactRecord>();
  let diagnostics: string[] = [];
  let commentsAskedFor: number[] = [];

  beforeEach(() => {
    world = descriptionReviewWorld();
    ({ bodyFile, commentsAskedFor, commentsFile, diagnostics, home, passes, repo } = world);
  });

  afterEach(() => {
    world.cleanUp();
  });

  const depsFor: DescriptionReviewWorld["depsFor"] = (options) => world.depsFor(options);
  const prepareArgs: DescriptionReviewWorld["prepareArgs"] = (options) => world.prepareArgs(options);
  const prepare: DescriptionReviewWorld["prepare"] = (options) => world.prepare(options);
  const record: DescriptionReviewWorld["record"] = (options) => world.record(options);
  const codexPass: DescriptionReviewWorld["codexPass"] = (options) => {
    world.codexPass(options);
  };
  const fallbackReview: DescriptionReviewWorld["fallbackReview"] = (options) => {
    world.fallbackReview(options);
  };
  const described: DescriptionReviewWorld["described"] = (over) => world.described(over);

  it("opens the write over a CLEAN Codex review of these exact bytes", async () => {
    const prepared = await prepare();
    expect(prepared.exit).toBe(0);
    expect(prepared.preparation.preparedBy).toStrictEqual({ host: "claude-code", id: "writer" });
    codexPass({ ...prepared, artifactId: "pass-1", verdict: "CLEAN" });
    const recorded = await record({ reviewId: "pass-1", session: "writer" });
    expect(diagnostics).toStrictEqual([]);
    expect(recorded).toBe(0);
    const { receipt } = unwrap(requireCleanDescriptionReview({ description: described(), home }));
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
    expect(failure.message).toContain("the change set's content changed, src/count.ts changed and is not Markdown");
  });

  /** Review a description over a branch that also adds a guide, then trim one sentence from the guide. */
  async function reviewThenTrimGuide({ body }: { body: string }): Promise<void> {
    mkdirSync(join(repo, "docs"));
    writeFileSync(join(repo, "docs", "guide.md"), "# Guide\n\nCounts once. Retries three times.\n");
    commitAll({ message: "guide", repo });
    writeFileSync(bodyFile, body);
    const prepared = await prepare();
    codexPass({ ...prepared, artifactId: "pass-1", verdict: "CLEAN" });
    expect(await record({ reviewId: "pass-1", session: "writer" })).toBe(0);
    writeFileSync(join(repo, "docs", "guide.md"), "# Guide\n\nCounts once.\n");
    commitAll({ message: "trim the guide", repo });
  }

  it("carries the CLEAN review over a sentence trimmed from Markdown the unchanged description never names", async () => {
    await reviewThenTrimGuide({ body: BODY });
    const carried = unwrap(requireCleanDescriptionReview({ description: described(), home }));
    expect([carried.kind, carried.receipt.reviewId]).toStrictEqual(["carried", "pass-1"]);
    expect(carried).toMatchObject({
      notice:
        "description review: the description is unchanged, so CLEAN receipt id-2 still covers it over a change set " +
        "that moved only in docs/guide.md. Blind spot: a claim about prose in a changed Markdown file the " +
        "description never names can ride this earlier review unread.",
    });
  });

  it("asks for a fresh review when the unchanged description names the trimmed file", async () => {
    const naming = `${BODY}The guide.md page says it counts once.\n`;
    await reviewThenTrimGuide({ body: naming });
    const failure = unwrapErr(requireCleanDescriptionReview({ description: described({ body: naming }), home }));
    expect(failure.message).toContain(
      "the change set's content changed, docs/guide.md changed and the description names it. Run",
    );
  });

  it("asks for a fresh review when the description itself moves alongside the trim", async () => {
    await reviewThenTrimGuide({ body: BODY });
    const failure = unwrapErr(requireCleanDescriptionReview({ description: described({ body: `${BODY}x\n` }), home }));
    expect(failure.message).toContain("the body changed, the change set's content changed. Run");
  });

  it("carries nothing past a stored receipt that does not read, rather than skipping it for an older CLEAN one", async () => {
    await reviewThenTrimGuide({ body: BODY });
    writeFileSync(join(receiptsDirectory({ home }), `${"7".repeat(64)}.json`), "{");
    const failure = unwrapErr(requireCleanDescriptionReview({ description: described(), home }));
    expect(failure.code).toBe("REVIEW_MISSING");
    expect(failure.message).toContain("a stored description review does not read, so none is carried (");
  });

  it("fails closed when the reviewed change set can no longer be read back", async () => {
    await reviewThenTrimGuide({ body: BODY });
    rmSync(preparationsDirectory({ home }), { force: true, recursive: true });
    const failure = unwrapErr(requireCleanDescriptionReview({ description: described(), home }));
    expect(failure.code).toBe("REVIEW_MISSING");
    expect(failure.message).toContain("the change set id-2 reviewed cannot be read back (description review packet:");
  });

  /**
   * Rewrite the one stored receipt and its preparation as main wrote them before the packet carried thread history:
   * a schema-2 receipt over a schema-3 preparation, the shape of every receipt already in flight.
   */
  function storeAsLegacy(): void {
    const receipt = listReadableReceipts({ home })[0]!;
    rmSync(join(receiptsDirectory({ home }), `${receipt.manifestSha256}.json`));
    const legacyReceipt: DescriptionReviewReceipt = {
      manifest: receipt.manifest,
      manifestSha256: receipt.manifestSha256,
      preparationId: receipt.preparationId,
      preparedBy: receipt.preparedBy,
      receiptId: receipt.receiptId,
      recordedAtIso: receipt.recordedAtIso,
      recordedBy: receipt.recordedBy,
      reviewId: receipt.reviewId,
      reviewer: receipt.reviewer,
      schemaVersion: 2,
      summary: receipt.summary,
      verdict: receipt.verdict,
    };
    unwrap(writeReceiptOnce({ home, receipt: legacyReceipt }));
    const directory = join(preparationsDirectory({ home }), receipt.preparationId);
    const preparation = unwrap(readPreparationAtRoot({ home, repoRoot: join(directory, "repo") }))!;
    const legacyPreparation = {
      baseSha: preparation.baseSha,
      createdAtIso: preparation.createdAtIso,
      headSha: preparation.headSha,
      manifest: preparation.manifest,
      manifestSha256: preparation.manifestSha256,
      preparationId: preparation.preparationId,
      preparedBy: preparation.preparedBy,
      schemaVersion: 3,
    } satisfies StoredDescriptionReviewPreparation;
    writeFileSync(
      join(directory, "preparation.json"),
      `${safeJsonStringify({ label: "legacy preparation", space: 2, value: legacyPreparation })}\n`,
    );
  }

  it("opens the write on the exact path over a CLEAN receipt written before the packet carried history", async () => {
    const prepared = await prepare();
    codexPass({ ...prepared, artifactId: "pass-1", verdict: "CLEAN" });
    expect(await record({ reviewId: "pass-1", session: "writer" })).toBe(0);
    storeAsLegacy();
    const admitted = unwrap(requireCleanDescriptionReview({ description: described(), home }));
    expect([admitted.kind, admitted.receipt.schemaVersion, admitted.receipt.reviewId]).toStrictEqual([
      "exact",
      2,
      "pass-1",
    ]);
  });

  it("carries a CLEAN receipt written before the packet carried history over an immaterial trim", async () => {
    await reviewThenTrimGuide({ body: BODY });
    storeAsLegacy();
    const carried = unwrap(requireCleanDescriptionReview({ description: described(), home }));
    expect([carried.kind, carried.receipt.schemaVersion, carried.receipt.reviewId]).toStrictEqual([
      "carried",
      2,
      "pass-1",
    ]);
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
    const rebased = unwrap(requireCleanDescriptionReview({ description: described(), home }));
    expect([rebased.kind, rebased.receipt.reviewId]).toStrictEqual(["exact", "pass-1"]);
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
    const { receipt } = unwrap(requireCleanDescriptionReview({ description: described(), home }));
    expect(receipt.reviewer).toBe("claude-fallback");
    expect(receipt.recordedBy).toStrictEqual({ host: "claude-code", id: "reviewer" });
  });

  it("commits the outgoing comments and the pull request's own comments at the head, inside the diff", async () => {
    writeFileSync(commentsFile, JSON.stringify([WALKTHROUGH]));
    world.onThePr = [ON_THE_PR];
    const prepared = await prepare({ number: 7 });
    expect(prepared.exit).toBe(0);
    expect(commentsAskedFor).toStrictEqual([7]);
    const show = ({ ref }: { ref: string }): unknown =>
      JSON.parse(gitInTemp({ args: ["show", ref], cwd: prepared.repoRoot }));
    expect(show({ ref: `${prepared.preparation.headSha}:${PACKET_COMMENTS_PATH}` })).toStrictEqual([WALKTHROUGH]);
    expect(show({ ref: `${prepared.preparation.headSha}:${PACKET_EXISTING_COMMENTS_PATH}` })).toStrictEqual([
      ON_THE_PR,
    ]);
  });

  it("tells the reviewer no picture can come when attach upload is not permitted, and only then", async () => {
    const permitted = await prepare();
    world.attachUpload = { because: "unruled", kind: "refused" };
    writeFileSync(bodyFile, `${BODY}\n`);
    const refused = await prepare();
    const readme = ({
      prepared,
    }: {
      prepared: { preparation: StoredDescriptionReviewPreparation; repoRoot: string };
    }) => gitInTemp({ args: ["show", `${prepared.preparation.headSha}:README.md`], cwd: prepared.repoRoot });
    // gitInTemp trims its stdout, so each expected README is trimmed the same way.
    // Another repository's rules come from the installed tree, and its README says so.
    expect([readme({ prepared: permitted }), readme({ prepared: refused })]).toEqual([
      descriptionReviewPacketReadme({ attachUploadPermitted: true, rulesOrigin: { kind: "installed" } }).trim(),
      descriptionReviewPacketReadme({ attachUploadPermitted: false, rulesOrigin: { kind: "installed" } }).trim(),
    ]);
  });

  it("reads no comment for a pull request not yet opened", async () => {
    world.onThePr = [ON_THE_PR];
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
      unwrap(requireCleanDescriptionReview({ description: described({ comments: [WALKTHROUGH] }), home })).receipt
        .reviewId,
    ).toBe("pass-1");
    const reworded = { ...WALKTHROUGH, body: "💡 The counter reads each widget once." };
    const failure = unwrapErr(
      requireCleanDescriptionReview({ description: described({ comments: [reworded] }), home }),
    );
    expect(failure.code).toBe("REVIEW_MISSING");
    expect(failure.message).toContain("the comments this write would post changed");
  });

  it("shuts the write when a comment arrives on the pull request after the review", async () => {
    world.onThePr = [ON_THE_PR];
    const prepared = await prepare({ number: 7 });
    codexPass({ ...prepared, artifactId: "pass-1", verdict: "CLEAN" });
    expect(await record({ reviewId: "pass-1", session: "writer" })).toBe(0);
    const reviewed = described({ existingComments: [ON_THE_PR] });
    expect(unwrap(requireCleanDescriptionReview({ description: reviewed, home })).receipt.reviewId).toBe("pass-1");
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
