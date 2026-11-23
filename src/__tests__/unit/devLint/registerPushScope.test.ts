/*
 * Which register docs a push may report without being failed by them: a doc is exempt only on positive
 * evidence that it names a different repository, or a different branch of the same one. An unknown push, a
 * doc with no repository, and a doc with no branch all stay blocking.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pushExemptPaths } from "../../../devLint/registerPushScope.js";
import { doc } from "../handover/boardState/harness.js";

let root = "";
let thisRepo = "";
let otherRepo = "";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "push-scope-"));
  thisRepo = mkdtempSync(join(root, "this-"));
  otherRepo = mkdtempSync(join(root, "other-"));
});

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("pushExemptPaths", () => {
  it("exempts nothing when the push's own repository is unknown", () => {
    const docs = [doc({ branch: "feature", repo: otherRepo, slug: "unknown-push" })];
    expect(pushExemptPaths({ currentBranch: "main", currentRepo: undefined, docs })).toEqual(new Set<string>());
  });

  it("keeps a doc that names no repository blocking", () => {
    const docs = [doc({ slug: "no-repo" })];
    expect(pushExemptPaths({ currentBranch: "main", currentRepo: thisRepo, docs })).toEqual(new Set<string>());
  });

  it("exempts a doc about a different repository", () => {
    const docs = [doc({ branch: "main", repo: otherRepo, slug: "different-repo" })];
    expect(pushExemptPaths({ currentBranch: "main", currentRepo: thisRepo, docs })).toEqual(
      new Set(["/h/different-repo.md"]),
    );
  });

  it("exempts a doc about a different branch of the same repository", () => {
    const docs = [doc({ branch: "feature", repo: thisRepo, slug: "different-branch" })];
    expect(pushExemptPaths({ currentBranch: "main", currentRepo: thisRepo, docs })).toEqual(
      new Set(["/h/different-branch.md"]),
    );
  });

  it("keeps a doc about the same repository and branch blocking", () => {
    const docs = [doc({ branch: "main", repo: thisRepo, slug: "same-branch" })];
    expect(pushExemptPaths({ currentBranch: "main", currentRepo: thisRepo, docs })).toEqual(new Set<string>());
  });

  it("keeps a doc in the same repository that names no branch blocking", () => {
    const docs = [doc({ repo: thisRepo, slug: "no-branch" })];
    expect(pushExemptPaths({ currentBranch: "main", currentRepo: thisRepo, docs })).toEqual(new Set<string>());
  });

  it("exempts only the unrelated docs out of a mixed register", () => {
    const docs = [
      doc({ branch: "main", repo: thisRepo, slug: "related" }),
      doc({ branch: "main", repo: otherRepo, slug: "other-repo" }),
      doc({ branch: "feature", repo: thisRepo, slug: "other-branch" }),
    ];
    expect(pushExemptPaths({ currentBranch: "main", currentRepo: thisRepo, docs })).toEqual(
      new Set(["/h/other-repo.md", "/h/other-branch.md"]),
    );
  });
});
