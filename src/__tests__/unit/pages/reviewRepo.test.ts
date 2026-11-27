/*
 * The review repository, over real git: what `page review-prepare` commits, and what `page publish` reads back to
 * bind a cited review to it. Real git because the digest a review recorded is git's own diff, and only git can
 * say whether the two agree.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { gitCommitDiffCommand } from "../../../codex/diff.js";
import { runGitChecked } from "../../../codex/gitRun.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  fragmentSha256,
  pageReviewSlugDirectory,
  preparedCommitFacts,
  preparePageReview,
  readPreparationAt,
} from "../../../pages/reviewRepo.js";
import { REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const FRAGMENT = "<title>Queue</title>\r\n<p>Three things need you.</p>";

describe("preparePageReview", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sw-prep-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** One preparation of slug `queue` under the test home. */
  function prepare({ preparationId = "prep-1" }: { preparationId?: string } = {}) {
    return preparePageReview({
      createdAtIso: "2026-11-03T06:00:00.000Z",
      fragment: FRAGMENT,
      home,
      inputs: [{ contents: "make every briefing reviewed\n", name: "../owner words.md" }],
      preparationId,
      slug: "queue",
    });
  }

  it(
    "commits only the README at base and the inputs with the exact fragment at head, so the review's diff carries both",
    () => {
      const { preparation, repoRoot, diffBytes } = unwrap(prepare());
      const git = ({ args }: { args: readonly string[] }): string =>
        runGitChecked({ args, cwd: repoRoot, label: "test git" });
      const lines = ({ text }: { text: string }): string[] => text.split("\n").filter((line) => line !== "");
      expect(lines({ text: git({ args: ["ls-tree", "--name-only", preparation.baseSha] }) })).toStrictEqual([
        ".gitattributes",
        "README.md",
      ]);
      expect(
        lines({ text: git({ args: ["diff", "--name-only", preparation.baseSha, preparation.headSha, "--"] }) }),
      ).toStrictEqual(["inputs/01-owner-words.md", "page.html"]);
      const diff = git({
        args: gitCommitDiffCommand({ commit: preparation.headSha, mergeBase: preparation.baseSha }).args,
      });
      expect(diff).toContain("+make every briefing reviewed");
      expect(diffBytes).toBe(Buffer.byteLength(diff, "utf8"));
      expect(preparation.fragmentSha256).toBe(fragmentSha256({ fragment: FRAGMENT }));
      expect(readFileSync(join(repoRoot, "inputs", "01-owner-words.md"), "utf8")).toBe(
        "make every briefing reviewed\n",
      );
      expect(readFileSync(join(repoRoot, "page.html"), "utf8")).toBe(FRAGMENT);
      const facts = unwrap(
        preparedCommitFacts({ baseSha: preparation.baseSha, headSha: preparation.headSha, repoRoot }),
      );
      expect(facts.fragmentSha256).toBe(preparation.fragmentSha256);
      expect(facts.diffSha256).toMatch(/^[0-9a-f]{64}$/);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "diffs an input as text even when a global attributes file marks it -diff",
    () => {
      const { preparation, repoRoot } = unwrap(prepare());
      const globalAttributes = join(home, "global-attributes");
      writeFileSync(globalAttributes, "*.md -diff\n");
      const diff = runGitChecked({
        args: [
          "-c",
          `core.attributesFile=${globalAttributes}`,
          ...gitCommitDiffCommand({ commit: preparation.headSha, mergeBase: preparation.baseSha }).args,
        ],
        cwd: repoRoot,
        label: "test git",
      });
      expect(diff).toContain("+make every briefing reviewed");
      expect(diff).not.toContain("Binary files");
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "reads its own preparation back from the repository root a review records",
    () => {
      const { preparation, repoRoot } = unwrap(prepare());
      expect(unwrap(readPreparationAt({ home, repoRoot, slug: "queue" }))).toStrictEqual(preparation);
      expect(unwrap(readPreparationAt({ home, repoRoot, slug: "other" }))).toBe(undefined);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it("does not read a repository outside this slug's preparations as one", () => {
    const stray = join(home, "elsewhere", "repo");
    mkdirSync(stray, { recursive: true });
    mkdirSync(pageReviewSlugDirectory({ home, slug: "queue" }), { recursive: true });
    writeFileSync(join(home, "elsewhere", "preparation.json"), "{}");
    expect(unwrap(readPreparationAt({ home, repoRoot: stray, slug: "queue" }))).toBe(undefined);
  });

  it("names a preparation of this slug whose record is not the shape it wrote, rather than calling it foreign", () => {
    const repoRoot = join(pageReviewSlugDirectory({ home, slug: "queue" }), "prep-9", "repo");
    mkdirSync(repoRoot, { recursive: true });
    writeFileSync(join(repoRoot, "..", "preparation.json"), "{}");
    const failure = unwrapErr(readPreparationAt({ home, repoRoot, slug: "queue" }));
    expect(failure.code).toBe("PREPARATION_FAILED");
    expect(failure.message).toContain("is not the preparation record this verb writes");
  });

  it(
    "refuses to reuse a preparation id, and leaves the first one intact",
    () => {
      const first = unwrap(prepare());
      const second = prepare();
      expect(unwrapErr(second).code).toBe("PREPARATION_FAILED");
      expect(unwrapErr(second).message).toContain("already exists");
      expect(existsSync(join(first.repoRoot, "page.html"))).toBe(true);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it("refuses an input holding a NUL byte, which git would diff as binary with none of its contents, and builds nothing", () => {
    const result = preparePageReview({
      createdAtIso: "2026-11-03T06:00:00.000Z",
      fragment: FRAGMENT,
      home,
      inputs: [
        { contents: "plain words\n", name: "doc.md" },
        { contents: "claim\0evidence\n", name: "capture.md" },
      ],
      preparationId: "prep-nul",
      slug: "queue",
    });
    const failure = unwrapErr(result);
    expect(failure.code).toBe("FILE_NOT_TEXT");
    expect(failure.message).toBe(
      "capture.md holds a NUL byte, and the diff a reviewer reads is text, so it would arrive as a raw control byte or as a binary marker — pass it as text",
    );
    expect(existsSync(pageReviewSlugDirectory({ home, slug: "queue" }))).toBe(false);
  });

  it("refuses a page holding a NUL byte for the same reason", () => {
    const result = preparePageReview({
      createdAtIso: "2026-11-03T06:00:00.000Z",
      fragment: "<p>a\0b</p>",
      home,
      inputs: [{ contents: "plain words\n", name: "doc.md" }],
      preparationId: "prep-nul-page",
      slug: "queue",
    });
    expect(unwrapErr(result).code).toBe("FILE_NOT_TEXT");
    expect(unwrapErr(result).message).toContain("the page holds a NUL byte");
  });

  it("names a commit the repository does not hold rather than inventing facts", () => {
    const result = preparedCommitFacts({ baseSha: "0".repeat(40), headSha: "1".repeat(40), repoRoot: home });
    expect(unwrapErr(result).code).toBe("PREPARATION_FAILED");
  });
});
