/**
 * Which tree a description's written rules are read from: the head under review on this source repository, the
 * installed tree on any other, matched as a whole `owner/repo` so a fork under another owner is not this one.
 */
import { describe, expect, it } from "vitest";

import { SOURCE_REPOSITORY } from "../../../../hygiene/ownRepository.js";
import { descriptionRulesSourceFor } from "../../../../outbound/github/descriptionReviewRules.js";

const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";
const REPO_NAME = SOURCE_REPOSITORY.slice(SOURCE_REPOSITORY.indexOf("/") + 1);

/** Select for one repository, every other input fixed. */
function sourceFor({ repository }: { repository: string }): ReturnType<typeof descriptionRulesSourceFor> {
  return descriptionRulesSourceFor({
    headRef: "feature",
    headSha: HEAD_SHA,
    installedRoot: "/installed",
    repoDir: "/checkout",
    repository,
  });
}

describe("descriptionRulesSourceFor", () => {
  it("reads this source repository's rules at the resolved head commit", () => {
    expect(sourceFor({ repository: SOURCE_REPOSITORY })).toStrictEqual({
      headRef: "feature",
      headSha: HEAD_SHA,
      kind: "head",
      repoDir: "/checkout",
    });
  });

  it("matches the source repository case-insensitively, as GitHub does", () => {
    expect(sourceFor({ repository: SOURCE_REPOSITORY.toUpperCase() }).kind).toBe("head");
  });

  it("reads a fork under another owner from the installed tree", () => {
    expect(sourceFor({ repository: `acme/${REPO_NAME}` })).toStrictEqual({ kind: "installed", root: "/installed" });
  });

  it("reads any other repository from the installed tree", () => {
    expect(sourceFor({ repository: "acme/widgets" })).toStrictEqual({ kind: "installed", root: "/installed" });
  });

  it("does not take the bare repository name for the source repository", () => {
    expect(sourceFor({ repository: REPO_NAME }).kind).toBe("installed");
  });
});
