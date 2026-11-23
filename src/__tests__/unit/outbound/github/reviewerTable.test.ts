/**
 * The Who reviews what table, derived from a diff against CODEOWNERS, and the anchor each row is named by. The table
 * no longer travels in a pull-request description: `github pr reviewers` derives and prints it.
 */
// deleted-with-code: REVIEWER_FILE_NOT_CHANGED, readingOrderFormErrors
import { describe, expect, it } from "vitest";

import {
  deriveReviewerTable,
  type ReviewerRow,
  reviewerRowAnchors,
} from "../../../../outbound/github/reviewerTable.js";

/** A CODEOWNERS in the work repository's shape: a team default, narrower teams and people, a removal. */
const CODEOWNERS = [
  "* @org/eng",
  "/apps/helpbot/ @lionel",
  "/packages/infra/ @org/platform",
  "/packages/infra/cloud/index.ts # Remove ownership of the main index",
  "/packages/otel/ @author @jonah",
  ".yarnrc.yml @org/platform @quinn",
  "/packages/otel/src/attributes.ts @org/eng",
].join("\n");

/** Derive with no picks, authored by `@author`. */
function derived({ paths, picks = [] }: { paths: readonly string[]; picks?: { owner: string; person: string }[] }) {
  return deriveReviewerTable({ authorLogin: "author", codeowners: CODEOWNERS, erroredLines: [], paths, picks });
}

/** The rows of a derivation that must have reached a table. */
function rowsOf({ table }: { table: ReturnType<typeof derived> }): readonly ReviewerRow[] {
  expect(table.kind).toBe("table");
  return (table as Extract<typeof table, { kind: "table" }>).rows;
}

describe("deriveReviewerTable", () => {
  it("lists each narrower owner's files, fewest first, and names everything else once, last", () => {
    const table = derived({
      paths: ["apps/helpbot/a.ts", "packages/infra/x.ts", "packages/infra/y.ts", "src/main.ts", "README.md"],
    });
    expect(rowsOf({ table })).toEqual([
      { look: { files: ["apps/helpbot/a.ts"], kind: "files" }, standsInFor: [], who: ["@lionel"] },
      {
        look: { files: ["packages/infra/x.ts", "packages/infra/y.ts"], kind: "files" },
        standsInFor: [],
        who: ["@org/platform"],
      },
      { look: { kind: "rest" }, standsInFor: [], who: ["@org/eng"] },
    ]);
  });

  it("names no everything-else row when no changed file falls to the catch-all", () => {
    const table = derived({ paths: ["apps/helpbot/a.ts", "packages/infra/x.ts"] });
    expect(rowsOf({ table }).map((row) => row.who)).toEqual([["@lionel"], ["@org/platform"]]);
  });

  it("takes the author off a rule, so their co-owner is the one asked", () => {
    const table = derived({ paths: ["packages/otel/span.ts", "src/main.ts"] });
    expect(rowsOf({ table })[0]).toEqual({
      look: { files: ["packages/otel/span.ts"], kind: "files" },
      standsInFor: [],
      who: ["@jonah"],
    });
  });

  it("folds a rule naming the default owners into everything else", () => {
    const table = derived({ paths: ["packages/otel/src/attributes.ts", "apps/helpbot/a.ts"] });
    expect(rowsOf({ table })).toEqual([
      { look: { files: ["apps/helpbot/a.ts"], kind: "files" }, standsInFor: [], who: ["@lionel"] },
      { look: { kind: "rest" }, standsInFor: [], who: ["@org/eng"] },
    ]);
  });

  it("puts a removal rule's file on no row, and names the catch-all's files rather than everything else", () => {
    const table = derived({
      paths: ["packages/infra/cloud/index.ts", "packages/otel/src/attributes.ts", "apps/helpbot/a.ts"],
    });
    expect(rowsOf({ table })).toEqual([
      { look: { files: ["apps/helpbot/a.ts"], kind: "files" }, standsInFor: [], who: ["@lionel"] },
      { look: { files: ["packages/otel/src/attributes.ts"], kind: "files" }, standsInFor: [], who: ["@org/eng"] },
    ]);
    expect(table.unowned).toEqual(["packages/infra/cloud/index.ts"]);
  });

  it("names every team a merged everything-else row stands in for, not only the catch-all's", () => {
    const table = deriveReviewerTable({
      erroredLines: [],
      authorLogin: "author",
      codeowners: "* @org/default\n/same/ @org/special\n/other/ @org/other",
      paths: ["root.ts", "same/a.ts", "other/b.ts"],
      picks: [
        { owner: "@org/default", person: "@seth" },
        { owner: "@org/special", person: "@seth" },
      ],
    });
    expect(rowsOf({ table })).toEqual([
      { look: { files: ["other/b.ts"], kind: "files" }, standsInFor: [], who: ["@org/other"] },
      { look: { kind: "rest" }, standsInFor: ["@org/default", "@org/special"], who: ["@seth"] },
    ]);
  });

  it("never gives the catch-all a file only the author owns", () => {
    const table = deriveReviewerTable({
      erroredLines: [],
      authorLogin: "author",
      codeowners: "* @org/eng\n/web/ @org/web\n/mine/ @author",
      paths: ["web/a.ts", "src/b.ts", "mine/c.ts"],
      picks: [],
    });
    expect(rowsOf({ table })).toEqual([
      { look: { files: ["web/a.ts"], kind: "files" }, standsInFor: [], who: ["@org/web"] },
      { look: { files: ["src/b.ts"], kind: "files" }, standsInFor: [], who: ["@org/eng"] },
    ]);
    expect(table.unowned).toEqual(["mine/c.ts"]);
  });

  it("says one reviewer covers it when one owner covers every file", () => {
    expect(derived({ paths: ["src/a.ts", "src/b.ts", "src/a.ts"] })).toEqual({
      emailOwned: [],
      erroredRule: [],
      kind: "one-reviewer",
      unowned: [],
      unusedPicks: [],
      who: ["@org/eng"],
    });
  });

  it("reads two rules naming the same logins in different case and order as one reviewer group", () => {
    const table = deriveReviewerTable({
      authorLogin: "author",
      codeowners: "/a/ @Alice @bob\n/b/ @alice @Bob",
      erroredLines: [],
      paths: ["a/x.ts", "b/x.ts"],
      picks: [],
    });
    expect(table.kind).toBe("one-reviewer");
  });

  it("reads one login spelled twice in different case on one rule as one reviewer", () => {
    const table = deriveReviewerTable({
      authorLogin: "author",
      codeowners: "/a/ @Alice @alice @Bob\n/b/ @bob @ALICE",
      erroredLines: [],
      paths: ["a/x.ts", "b/x.ts"],
      picks: [],
    });
    expect(table).toEqual({
      emailOwned: [],
      erroredRule: [],
      kind: "one-reviewer",
      unowned: [],
      unusedPicks: [],
      who: ["@Alice", "@Bob"],
    });
  });

  it("names the files nobody owns when there is no catch-all to take them", () => {
    const table = deriveReviewerTable({
      erroredLines: [],
      authorLogin: "author",
      codeowners: "/infra/ @org/platform\n/docs/ @author\n/web/ @org/web",
      paths: ["infra/a.tf", "docs/x.md", "README.md", "web/b.ts"],
      picks: [],
    });
    expect(table.kind).toBe("table");
    expect(table.unowned).toEqual(["README.md", "docs/x.md"]);
  });

  it("is no reviewer at all when only the author owns what changed", () => {
    const table = deriveReviewerTable({
      authorLogin: "author",
      codeowners: "* @author",
      erroredLines: [],
      paths: ["a.ts"],
      picks: [],
    });
    expect(table).toEqual({ emailOwned: [], erroredRule: [], kind: "no-reviewer", unowned: ["a.ts"], unusedPicks: [] });
  });

  it("never reads an anchored `/*` as the catch-all, so a nested file stays the default owner's", () => {
    const table = deriveReviewerTable({
      authorLogin: "author",
      codeowners: "* @default\n/* @root\n/docs/ @docs",
      erroredLines: [],
      paths: ["src/a.ts", "docs/x.md"],
      picks: [],
    });
    expect(rowsOf({ table })).toEqual([
      { look: { files: ["docs/x.md"], kind: "files" }, standsInFor: [], who: ["@docs"] },
      { look: { kind: "rest" }, standsInFor: [], who: ["@default"] },
    ]);
  });

  it("names a file decided by a line GitHub reports an error on, with that line", () => {
    const table = deriveReviewerTable({
      authorLogin: "author",
      codeowners: "* @org/eng\n/docs/ @outsider\n/web/ @org/web",
      erroredLines: [2],
      paths: ["docs/a.md", "web/b.ts", "README.md"],
      picks: [],
    });
    expect(table.erroredRule).toEqual([{ line: 2, path: "docs/a.md" }]);
  });

  it("gives a `?` rule's file to that rule's owner, so the change asks two reviewers", () => {
    const table = deriveReviewerTable({
      erroredLines: [],
      authorLogin: "author",
      codeowners: "* @default\n/src/file?.ts @special",
      paths: ["src/file1.ts", "README.md"],
      picks: [],
    });
    expect(rowsOf({ table })).toEqual([
      { look: { files: ["src/file1.ts"], kind: "files" }, standsInFor: [], who: ["@special"] },
      { look: { kind: "rest" }, standsInFor: [], who: ["@default"] },
    ]);
  });

  it("names a file whose deciding rule owns it by email, which GitHub resolves and a row cannot tag", () => {
    const table = deriveReviewerTable({
      erroredLines: [],
      authorLogin: "author",
      codeowners: "* @org/eng\n*.js reviewer@example.com\n/web/ @org/web",
      paths: ["src/a.js", "web/b.js", "src/c.ts"],
      picks: [],
    });
    expect(table.emailOwned).toEqual(["src/a.js"]);
  });

  it("never lets a pick hand the author a row, and reports that pick unused", () => {
    const table = derived({
      paths: ["packages/infra/x.ts", "src/main.ts"],
      picks: [{ owner: "@org/platform", person: "@Author" }],
    });
    expect(rowsOf({ table })[0]!.who).toEqual(["@org/platform"]);
    expect(table.unusedPicks).toEqual([{ owner: "@org/platform", person: "@Author" }]);
  });

  it("stands a picked person in for a team, and merges rows that end up asking the same person", () => {
    const table = derived({
      paths: [".yarnrc.yml", "packages/infra/x.ts", "src/main.ts"],
      picks: [
        { owner: "@org/platform", person: "@quinn" },
        { owner: "@org/eng", person: "@lionel" },
        { owner: "@org/sql", person: "@smith" },
      ],
    });
    expect(rowsOf({ table })).toEqual([
      {
        look: { files: [".yarnrc.yml", "packages/infra/x.ts"], kind: "files" },
        standsInFor: ["@org/platform"],
        who: ["@quinn"],
      },
      { look: { kind: "rest" }, standsInFor: ["@org/eng"], who: ["@lionel"] },
    ]);
    expect(table.unusedPicks).toEqual([{ owner: "@org/sql", person: "@smith" }]);
  });
});

describe("reviewerRowAnchors", () => {
  it("names a row by every token it tags, so a DM can deep-link to it", () => {
    const row: ReviewerRow = { look: { kind: "rest" }, standsInFor: [], who: ["@Org/Platform.Core", "@quinn"] };
    expect(reviewerRowAnchors({ rows: [row] })).toEqual(["reviewers-org-platform-core-quinn"]);
  });

  it("numbers a repeat when two different sets spell one anchor", () => {
    const joined: ReviewerRow = { look: { files: ["a.ts"], kind: "files" }, standsInFor: [], who: ["@a-b"] };
    const split: ReviewerRow = { look: { kind: "rest" }, standsInFor: [], who: ["@a", "@b"] };
    expect(reviewerRowAnchors({ rows: [joined, split] })).toEqual(["reviewers-a-b", "reviewers-a-b-2"]);
  });
});
