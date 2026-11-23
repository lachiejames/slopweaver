/**
 * `handover set-repo` — the verb that gives a row with no `repo:` the checkout `cmux spawn` needs.
 *
 * The pure half is `setRepoRefusal` (which row may take one); which path a row may be given is
 * `handover/repoCheckout.ts`, tested beside it. The round trip runs the REAL verb over a throwaway board and a
 * real `git init`, because what this verb exists to produce is a doc whose `repo:` PARSES back — the same
 * property `pauseRun.test.ts` pins.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runHandoverSetRepo, setRepoRefusal, writeRepo } from "../../../../../cli/commands/handover/setRepoRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import { gitInTemp } from "../../../../tempGitRepo.js";

/** A clean row's text, optionally naming a repo. */
function rowText({ slug, repo }: { slug: string; repo: string | undefined }): string {
  return [
    "---",
    `slug: ${slug}`,
    "kind: ask",
    "summary: a finding with no repo",
    "status: ready",
    "askedIso: 2026-09-21T08:05:36.467Z",
    "artifact: null",
    ...(repo === undefined ? [] : [`repo: ${repo}`]),
    "---",
    "",
    "# body",
    "",
  ].join("\n");
}

describe("setRepoRefusal", () => {
  it("lets a clean row with no repo through", () => {
    const doc = parseHandoverDoc({ path: "/h/a.md", text: rowText({ repo: undefined, slug: "a" }) });
    expect(setRepoRefusal({ doc })).toBeUndefined();
  });

  it("refuses a row that already names a repo — set-repo never moves one", () => {
    const doc = parseHandoverDoc({ path: "/h/a.md", text: rowText({ repo: "/w/repo", slug: "a" }) });
    expect(setRepoRefusal({ doc })).toBe(
      "a already names repo: /w/repo — set-repo fills a missing one and never moves a row",
    );
  });
});

describe("handover set-repo against a real temp board and a real git checkout", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) {
      rmSync(dirs.pop()!, { force: true, recursive: true });
    }
  });

  function fixture(): { home: string; checkout: string; rowPath: string } {
    const home = mkdtempSync(join(tmpdir(), "set-repo-home-"));
    const checkout = realpathSync(mkdtempSync(join(tmpdir(), "set-repo-checkout-")));
    dirs.push(home, checkout);
    gitInTemp({ args: ["init", "--quiet"], cwd: checkout });
    mkdirSync(join(home, "handovers"), { recursive: true });
    const rowPath = join(home, "handovers", "a-row.md");
    writeFileSync(rowPath, rowText({ repo: undefined, slug: "a-row" }), "utf8");
    return { checkout, home, rowPath };
  }

  const argv = ({ home, rest }: { home: string; rest: readonly string[] }): readonly string[] => [
    "node",
    "slopweaver",
    "handover",
    "set-repo",
    ...rest,
    "--home",
    home,
  ];

  it("writes a repo: that parses back, and refuses a second write to the same row", async () => {
    const { checkout, home, rowPath } = fixture();
    expect(await runHandoverSetRepo(argv({ home, rest: ["a-row", "--repo", checkout] }))).toBe(EXIT_OK);
    const doc = parseHandoverDoc({ path: rowPath, text: readFileSync(rowPath, "utf8") });
    expect(doc.problems).toEqual([]);
    expect(doc.repo).toBe(checkout);
    expect(await runHandoverSetRepo(argv({ home, rest: ["a-row", "--repo", checkout] }))).toBe(EXIT_ERROR);
  });

  it("refuses a subdirectory of the checkout and leaves the row untouched", async () => {
    const { checkout, home, rowPath } = fixture();
    mkdirSync(join(checkout, "src"));
    const before = readFileSync(rowPath, "utf8");
    expect(await runHandoverSetRepo(argv({ home, rest: ["a-row", "--repo", join(checkout, "src")] }))).toBe(EXIT_USAGE);
    expect(readFileSync(rowPath, "utf8")).toBe(before);
  });

  it("writes nothing when the scanned file now holds a different row", () => {
    const { checkout, rowPath } = fixture();
    const scanned = parseHandoverDoc({ path: rowPath, text: readFileSync(rowPath, "utf8") });
    const replacement = rowText({ repo: undefined, slug: "c-row" });
    writeFileSync(rowPath, replacement, "utf8");
    expect(writeRepo({ doc: scanned, repo: checkout })).toEqual([
      `${rowPath} now holds the row "c-row", not "a-row" — nothing was written`,
    ]);
    expect(readFileSync(rowPath, "utf8")).toBe(replacement);
  });

  it("writes nothing when the scanned row was given a repo since the scan", () => {
    const { checkout, rowPath } = fixture();
    const scanned = parseHandoverDoc({ path: rowPath, text: readFileSync(rowPath, "utf8") });
    const since = rowText({ repo: "/w/other", slug: "a-row" });
    writeFileSync(rowPath, since, "utf8");
    expect(writeRepo({ doc: scanned, repo: checkout })).toEqual([
      "a-row already names repo: /w/other — set-repo fills a missing one and never moves a row",
    ]);
    expect(readFileSync(rowPath, "utf8")).toBe(since);
  });

  it("refuses a padded value whose untrimmed path exists, rather than trimming it into the sibling checkout", async () => {
    const { checkout, home, rowPath } = fixture();
    mkdirSync(`${checkout} `);
    dirs.push(`${checkout} `);
    const before = readFileSync(rowPath, "utf8");
    expect(await runHandoverSetRepo(argv({ home, rest: ["a-row", "--repo", `${checkout} `] }))).toBe(EXIT_USAGE);
    expect(readFileSync(rowPath, "utf8")).toBe(before);
  });

  it("refuses a bare repository name no declared checkout carries, rather than reading it as a directory (tick 188)", async () => {
    const { home, rowPath } = fixture();
    const before = readFileSync(rowPath, "utf8");
    expect(await runHandoverSetRepo(argv({ home, rest: ["a-row", "--repo", "slopweaver"] }))).toBe(EXIT_USAGE);
    expect(readFileSync(rowPath, "utf8")).toBe(before);
  });

  it("refuses an owner/name no declared checkout's origin carries", async () => {
    const { home, rowPath } = fixture();
    const before = readFileSync(rowPath, "utf8");
    expect(await runHandoverSetRepo(argv({ home, rest: ["a-row", "--repo", "lachiejames/slopweaver"] }))).toBe(
      EXIT_USAGE,
    );
    expect(readFileSync(rowPath, "utf8")).toBe(before);
  });

  it("refuses a directory that is not a git checkout", async () => {
    const { home, rowPath } = fixture();
    const plain = mkdtempSync(join(tmpdir(), "set-repo-plain-"));
    dirs.push(plain);
    const before = readFileSync(rowPath, "utf8");
    expect(await runHandoverSetRepo(argv({ home, rest: ["a-row", "--repo", plain] }))).toBe(EXIT_USAGE);
    expect(readFileSync(rowPath, "utf8")).toBe(before);
  });

  it("refuses a linked worktree, which a seat's removal would take the row's repo with", async () => {
    const { checkout, home, rowPath } = fixture();
    gitInTemp({
      args: ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--quiet", "--allow-empty", "-m", "root"],
      cwd: checkout,
    });
    const linked = `${checkout}-linked`;
    dirs.push(linked);
    gitInTemp({ args: ["worktree", "add", "--quiet", linked], cwd: checkout });
    const before = readFileSync(rowPath, "utf8");
    expect(await runHandoverSetRepo(argv({ home, rest: ["a-row", "--repo", linked] }))).toBe(EXIT_USAGE);
    expect(readFileSync(rowPath, "utf8")).toBe(before);
  });

  it("refuses a row whose hand-edited empty `repo :` the reader already takes as its repo, and leaves it untouched", async () => {
    const { checkout, home, rowPath } = fixture();
    const spaced = rowText({ repo: undefined, slug: "a-row" }).replace("artifact: null\n", "artifact: null\nrepo :\n");
    writeFileSync(rowPath, spaced, "utf8");
    expect(await runHandoverSetRepo(argv({ home, rest: ["a-row", "--repo", checkout] }))).toBe(EXIT_ERROR);
    expect(readFileSync(rowPath, "utf8")).toBe(spaced);
  });

  it("refuses a slug no row claims", async () => {
    const { checkout, home } = fixture();
    expect(await runHandoverSetRepo(argv({ home, rest: ["no-such-row", "--repo", checkout] }))).toBe(EXIT_ERROR);
  });
});
