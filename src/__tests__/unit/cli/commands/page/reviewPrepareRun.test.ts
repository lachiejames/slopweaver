/*
 * `page review-prepare`: build the review repository for a page, and print the review, its capped fallback and the
 * publish that cites it — every command carrying the same `--repo` and `--home`, which is what binds them.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { reviewPrepareCommands, runPageReviewPrepare } from "../../../../../cli/commands/page/reviewPrepareRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { fixturePreparation } from "../../../../pageReviewFixture.js";
import { REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";

const NOW = "2026-11-03T06:00:00.000Z";

describe("reviewPrepareCommands", () => {
  const commands = reviewPrepareCommands({
    home: "/h",
    maxDiffBytes: 5000,
    pagePath: "/s/page.html",
    preparation: fixturePreparation(),
    repoRoot: "/h/page-reviews/queue/prep-1/repo",
  });

  it("points the Codex review at the prepared base, repository and home", () => {
    expect(commands.review).toContain(`--base ${"b".repeat(40)} --max-diff-bytes 5000 --bound-seconds 600`);
    expect(commands.review).toContain("--repo /h/page-reviews/queue/prep-1/repo --home /h");
    expect(commands.review.startsWith("slopweaver codex review --pass r1 --property-id page-answers-inputs")).toBe(
      true,
    );
  });

  it("gives the fallback's prepare and record the same --repo and --home, which a record needs to find its request", () => {
    expect(commands.fallbackPrepare).toContain("codex review-fallback prepare --pass r1");
    expect(commands.fallbackPrepare).toContain("--repo /h/page-reviews/queue/prep-1/repo --home /h");
    expect(commands.fallbackRecord).toContain("codex review-fallback record --request");
    expect(commands.fallbackRecord).toContain("--repo /h/page-reviews/queue/prep-1/repo --home /h");
  });

  it("ends in a publish citing the review", () => {
    expect(commands.publish).toBe(
      "slopweaver page publish queue --page /s/page.html --review '<artifact-or-receipt-id>' --home /h",
    );
  });
});

describe("runPageReviewPrepare", () => {
  let home = "";
  let page = "";
  let words = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sw-rprep-"));
    page = join(home, "page.html");
    words = join(home, "words.md");
    writeFileSync(page, "<title>Queue</title><p>hi</p>");
    writeFileSync(words, "every briefing gets a review\n");
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** One run against collected sinks. */
  function run({ rest }: { rest: readonly string[] }): { code: number; out: string[]; diagnostics: string[] } {
    const out: string[] = [];
    const diagnostics: string[] = [];
    const code = runPageReviewPrepare({
      nowIso: NOW,
      preparationId: "prep-1",
      rest,
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: (line) => out.push(line),
    });
    return { code, diagnostics, out };
  }

  it(
    "builds the repository and prints the commands that take it to publish",
    () => {
      const { code, out } = run({ rest: ["queue", "--page", page, "--inputs", words, "--home", home] });
      expect(code).toBe(EXIT_OK);
      expect(out[0]!.endsWith("/page-reviews/queue/prep-1/repo")).toBe(true);
      expect(existsSync(join(out[0]!, "page.html"))).toBe(true);
      expect(out[1]).toContain("holds the review's README; head");
      expect(out[1]).toContain("adds 1 input(s) and page.html");
      expect(out.some((line) => line.includes("slopweaver codex review --pass r1"))).toBe(true);
      expect(out.some((line) => line.includes("slopweaver page publish queue"))).toBe(true);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "commits the page linked exactly as publish will write it, so the review reads the published bytes",
    () => {
      const pull = '<a href="https://github.com/acme/acme-admin/pull/18158">the PR</a>';
      writeFileSync(page, `<p>${pull}, then #18160.</p>`);
      const { code, out } = run({ rest: ["queue", "--page", page, "--inputs", words, "--home", home] });
      expect(code).toBe(EXIT_OK);
      expect(readFileSync(join(out[0]!, "page.html"), "utf8")).toBe(
        `<p>${pull}, then <a href="https://github.com/acme/acme-admin/issues/18160">#18160</a>.</p>`,
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it("refuses a missing --inputs, since a page reviewed against nothing proves nothing", () => {
    const { code, diagnostics } = run({ rest: ["queue", "--page", page, "--home", home] });
    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toContain("--inputs is required");
  });

  it("refuses a slug a page could not publish under", () => {
    const { code, diagnostics } = run({ rest: ["Not A Slug", "--page", page, "--inputs", words, "--home", home] });
    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toContain('"Not A Slug" is not a page slug');
  });

  it("reports an input it cannot read, and builds nothing", () => {
    const { code, diagnostics } = run({
      rest: ["queue", "--page", page, "--inputs", join(home, "absent.md"), "--home", home],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain("could not read --inputs file");
    expect(existsSync(join(home, "page-reviews"))).toBe(false);
  });
});
