import { describe, expect, it } from "vitest";

import { githubRepoWriteApprovalGate } from "../../../../../cli/commands/github/repoApproval.js";
import {
  GITHUB_REPO_DIGEST_PATTERN,
  type GithubRepoAdministrationAction,
  githubRepoPlanView,
  githubRepoWriteDigest,
  isAlreadyDone,
  planRepoAdministration,
} from "../../../../../cli/commands/github/repoPlan.js";
import type { RepoAdministrationState } from "../../../../../outbound/github/repoAdministration.js";

const CURRENT: RepoAdministrationState = {
  archived: false,
  fullName: "acme/widgets",
  htmlUrl: "https://github.com/acme/widgets",
  id: 4242,
  name: "widgets",
  ownerLogin: "acme",
};

const SOURCE = { owner: "acme", repo: "widgets" };

/** The plan for one action over a state, from the typed source address. */
function planFor({
  action,
  current = CURRENT,
}: {
  action: GithubRepoAdministrationAction;
  current?: RepoAdministrationState;
}): ReturnType<typeof planRepoAdministration> {
  return planRepoAdministration({ action, current, source: SOURCE });
}

describe("planRepoAdministration", () => {
  it("targets the same owner under the new name for a rename", () => {
    expect(planFor({ action: { kind: "rename", newName: "gadgets" } }).targetFullName).toBe("acme/gadgets");
  });

  it("targets the new owner under the same name for a transfer", () => {
    expect(planFor({ action: { kind: "transfer", newOwner: "fixture-owner" } }).targetFullName).toBe(
      "fixture-owner/widgets",
    );
  });

  it("targets the repository where it stands for an archive", () => {
    expect(planFor({ action: { kind: "archive" } }).targetFullName).toBe("acme/widgets");
  });
});

describe("isAlreadyDone", () => {
  it("is done for a rename to the current name, and not for a case-only rename", () => {
    expect(isAlreadyDone({ plan: planFor({ action: { kind: "rename", newName: "widgets" } }) })).toBe(true);
    expect(isAlreadyDone({ plan: planFor({ action: { kind: "rename", newName: "Widgets" } }) })).toBe(false);
  });

  it("is done for a transfer to the current owner in any case", () => {
    expect(isAlreadyDone({ plan: planFor({ action: { kind: "transfer", newOwner: "ACME" } }) })).toBe(true);
    expect(isAlreadyDone({ plan: planFor({ action: { kind: "transfer", newOwner: "fixture-owner" } }) })).toBe(false);
  });

  it("is done for an archive only once the repository is archived", () => {
    expect(isAlreadyDone({ plan: planFor({ action: { kind: "archive" } }) })).toBe(false);
    expect(
      isAlreadyDone({ plan: planFor({ action: { kind: "archive" }, current: { ...CURRENT, archived: true } }) }),
    ).toBe(true);
  });
});

describe("githubRepoWriteDigest", () => {
  const rename = planFor({ action: { kind: "rename", newName: "gadgets" } });

  it("is ghrepo- and 16 hex characters, pinned for one fixed plan", () => {
    const digest = githubRepoWriteDigest({ plan: rename });
    expect(GITHUB_REPO_DIGEST_PATTERN.test(digest)).toBe(true);
    expect(digest).toBe("ghrepo-5e75dcc9d49c5d58");
  });

  it("changes with the repository id, so a redirected slug cannot inherit an approval", () => {
    const moved = planFor({ action: { kind: "rename", newName: "gadgets" }, current: { ...CURRENT, id: 9999 } });
    expect(githubRepoWriteDigest({ plan: moved })).not.toBe(githubRepoWriteDigest({ plan: rename }));
  });

  it("changes with the archive state, the action and the destination", () => {
    const base = githubRepoWriteDigest({ plan: rename });
    const archivedSince = planFor({
      action: { kind: "rename", newName: "gadgets" },
      current: { ...CURRENT, archived: true },
    });
    expect(githubRepoWriteDigest({ plan: archivedSince })).not.toBe(base);
    expect(githubRepoWriteDigest({ plan: planFor({ action: { kind: "rename", newName: "gizmos" } }) })).not.toBe(base);
    expect(githubRepoWriteDigest({ plan: planFor({ action: { kind: "archive" } }) })).not.toBe(base);
  });

  it("ignores the URL, which changes nothing sent", () => {
    const elsewhere = planFor({
      action: { kind: "rename", newName: "gadgets" },
      current: { ...CURRENT, htmlUrl: "https://github.example/acme/widgets" },
    });
    expect(githubRepoWriteDigest({ plan: elsewhere })).toBe(githubRepoWriteDigest({ plan: rename }));
  });
});

describe("githubRepoPlanView", () => {
  it("names the typed source, the live identity, the action and the target", () => {
    expect(githubRepoPlanView({ plan: planFor({ action: { kind: "transfer", newOwner: "fixture-owner" } }) })).toEqual({
      action: { kind: "transfer", newOwner: "fixture-owner" },
      current: { archived: false, fullName: "acme/widgets", id: 4242, name: "widgets", ownerLogin: "acme" },
      source: "acme/widgets",
      target: "fixture-owner/widgets",
    });
  });
});

describe("githubRepoWriteApprovalGate", () => {
  const request = {
    action: { kind: "verb" as const, noun: "github", verb: "repo archive" },
    artifact: {},
    meta: { createsWorkItem: false, effect: "external-write" as const, home: "/tmp/home", requiresApproval: true },
  };

  it("passes when the supplied digest is the current one", () => {
    const gate = githubRepoWriteApprovalGate({
      expected: "ghrepo-0123456789abcdef",
      preview: "slopweaver github repo --repo acme/widgets --archive",
      supplied: "ghrepo-0123456789abcdef",
    });
    expect(gate(request)).toEqual([]);
  });

  it("holds on a stale digest and names the current one in its correction", () => {
    const gate = githubRepoWriteApprovalGate({
      expected: "ghrepo-0123456789abcdef",
      preview: "slopweaver github repo --repo acme/widgets --archive",
      supplied: "ghrepo-fedcba9876543210",
    });
    const findings = gate(request);
    expect(findings.map((finding) => finding.code)).toEqual(["github.repo-write-unapproved"]);
    expect(findings[0]!.severity).toBe("hold");
    expect(findings[0]!.correction).toContain("--approve ghrepo-0123456789abcdef");
  });
});
