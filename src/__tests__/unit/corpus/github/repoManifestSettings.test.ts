/**
 * The settings apply's repository-level reads and writes, through a real Octokit over a recording fake transport: a
 * merge setting GitHub omitted (it returns several only to an admin) is refused by name rather than read as off; a
 * patch sends only the fields it names, with a cleared description as GitHub's empty string; a squash enum GitHub
 * does not accept is refused before anything is sent; and a 404 on the Dependabot read is "off", any other
 * refusal an error.
 */
import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";

import {
  getDependabotAlertsVia,
  getRepoManifestRepositoryVia,
  getRepoTopicsVia,
  replaceRepoTopicsVia,
  setDependabotAlertsVia,
  updateRepoSettingsVia,
} from "../../../../corpus/github/repoManifestSettings.js";
import type { WriteCtx } from "../../../../corpus/github/writeCtx.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  always,
  type FakeAnswer,
  recordingFetch,
  recordingScopeId,
  type SentRequest,
} from "../../../githubRecordingCtx.js";

const INPUT = { owner: "acme", repo: "widget" };

/** A write context over a real Octokit, built in this test file, whose fake transport records every request. */
function recordingCtx(fake: { sent: SentRequest[]; respond: (request: SentRequest) => FakeAnswer }): WriteCtx {
  return {
    client: new Octokit({ auth: "test-token", request: { fetch: recordingFetch(fake) } }),
    scopeId: recordingScopeId(),
  };
}
const REPO_URL = "https://api.github.com/repos/acme/widget";

/** The repository read an admin token gets, every field the apply judges present. */
const ADMIN_READ = {
  allow_auto_merge: false,
  allow_merge_commit: true,
  allow_rebase_merge: true,
  allow_squash_merge: true,
  allow_update_branch: false,
  delete_branch_on_merge: false,
  description: "A widget",
  full_name: "acme/widget",
  has_discussions: false,
  has_issues: true,
  has_projects: true,
  has_wiki: true,
  id: 101,
  is_template: false,
  squash_merge_commit_message: "COMMIT_MESSAGES",
  squash_merge_commit_title: "COMMIT_OR_PR_TITLE",
  visibility: "private",
  web_commit_signoff_required: false,
};

const MERGE = {
  allowAutoMerge: true,
  allowMergeCommit: false,
  allowRebaseMerge: false,
  allowSquashMerge: true,
  allowUpdateBranch: true,
  deleteBranchOnMerge: true,
  squashMergeCommitMessage: "PR_BODY",
  squashMergeCommitTitle: "PR_TITLE",
  webCommitSignoffRequired: false,
};

describe("getRepoManifestRepositoryVia", () => {
  it("reads identity, visibility, description, features and merge settings", async () => {
    const ctx = recordingCtx({ respond: always({ data: ADMIN_READ, status: 200 }), sent: [] });

    expect(unwrap(await getRepoManifestRepositoryVia({ ctx, input: INPUT }))).toStrictEqual({
      description: "A widget",
      features: { hasDiscussions: false, hasIssues: true, hasProjects: true, hasWiki: true, isTemplate: false },
      fullName: "acme/widget",
      id: 101,
      merge: {
        allowAutoMerge: false,
        allowMergeCommit: true,
        allowRebaseMerge: true,
        allowSquashMerge: true,
        allowUpdateBranch: false,
        deleteBranchOnMerge: false,
        squashMergeCommitMessage: "COMMIT_MESSAGES",
        squashMergeCommitTitle: "COMMIT_OR_PR_TITLE",
        webCommitSignoffRequired: false,
      },
      visibility: "private",
    });
  });

  it("refuses a read omitting an admin-only merge setting rather than reading it as off", async () => {
    const { allow_auto_merge: _omitted, ...nonAdminRead } = ADMIN_READ;
    const ctx = recordingCtx({ respond: always({ data: nonAdminRead, status: 200 }), sent: [] });

    expect(unwrapErr(await getRepoManifestRepositoryVia({ ctx, input: INPUT })).message).toContain(
      "GitHub's repository read omitted allow_auto_merge, so it is unknown; read it with an admin token",
    );
  });
});

describe("updateRepoSettingsVia", () => {
  it("sends a cleared description as GitHub's empty string, and nothing else", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ respond: always({ data: ADMIN_READ, status: 200 }), sent });

    unwrap(await updateRepoSettingsVia({ ctx, input: { ...INPUT, patch: { description: null } } }));

    expect(sent).toStrictEqual([{ body: { description: "" }, method: "PATCH", url: REPO_URL }]);
  });

  it("sends the five feature switches alone in GitHub's field names", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ respond: always({ data: ADMIN_READ, status: 200 }), sent });
    const features = { hasDiscussions: true, hasIssues: false, hasProjects: false, hasWiki: false, isTemplate: true };

    unwrap(await updateRepoSettingsVia({ ctx, input: { ...INPUT, patch: { features } } }));

    expect(sent.map((request) => request.body)).toStrictEqual([
      { has_discussions: true, has_issues: false, has_projects: false, has_wiki: false, is_template: true },
    ]);
  });

  it("sends the merge settings alone in GitHub's field names", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ respond: always({ data: ADMIN_READ, status: 200 }), sent });

    unwrap(await updateRepoSettingsVia({ ctx, input: { ...INPUT, patch: { merge: MERGE } } }));

    expect(sent.map((request) => request.body)).toStrictEqual([
      {
        allow_auto_merge: true,
        allow_merge_commit: false,
        allow_rebase_merge: false,
        allow_squash_merge: true,
        allow_update_branch: true,
        delete_branch_on_merge: true,
        squash_merge_commit_message: "PR_BODY",
        squash_merge_commit_title: "PR_TITLE",
        web_commit_signoff_required: false,
      },
    ]);
  });

  it("refuses a squash title GitHub does not accept before anything is sent", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ respond: always({ data: ADMIN_READ, status: 200 }), sent });
    const merge = { ...MERGE, squashMergeCommitTitle: "TITLE" };

    const error = unwrapErr(await updateRepoSettingsVia({ ctx, input: { ...INPUT, patch: { merge } } }));

    expect(error.message).toContain('"TITLE" is not a squash commit title GitHub accepts');
    expect(sent).toStrictEqual([]);
  });

  it("refuses a squash message GitHub does not accept before anything is sent", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ respond: always({ data: ADMIN_READ, status: 200 }), sent });
    const merge = { ...MERGE, squashMergeCommitMessage: "BODY" };

    const error = unwrapErr(await updateRepoSettingsVia({ ctx, input: { ...INPUT, patch: { merge } } }));

    expect(error.message).toContain('"BODY" is not a squash commit message GitHub accepts');
    expect(sent).toStrictEqual([]);
  });
});

describe("topics", () => {
  it("reads the topic names GitHub holds", async () => {
    const ctx = recordingCtx({ respond: always({ data: { names: ["cli", "widgets"] }, status: 200 }), sent: [] });

    expect(unwrap(await getRepoTopicsVia({ ctx, input: INPUT }))).toStrictEqual(["cli", "widgets"]);
  });

  it("replaces the whole set with one PUT", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ respond: always({ data: { names: ["cli"] }, status: 200 }), sent });

    unwrap(await replaceRepoTopicsVia({ ctx, input: { ...INPUT, topics: ["cli"] } }));

    expect(sent).toStrictEqual([{ body: { names: ["cli"] }, method: "PUT", url: `${REPO_URL}/topics` }]);
  });
});

describe("Dependabot alerts", () => {
  it("reads a 204 as on", async () => {
    const ctx = recordingCtx({ respond: always({ data: null, status: 204 }), sent: [] });

    expect(unwrap(await getDependabotAlertsVia({ ctx, input: INPUT }))).toBe(true);
  });

  it("reads a 404 as off", async () => {
    const ctx = recordingCtx({ respond: always({ data: { message: "Not Found" }, status: 404 }), sent: [] });

    expect(unwrap(await getDependabotAlertsVia({ ctx, input: INPUT }))).toBe(false);
  });

  it("carries any other refusal as an error, never as off", async () => {
    const ctx = recordingCtx({ respond: always({ data: { message: "Forbidden" }, status: 403 }), sent: [] });

    expect(unwrapErr(await getDependabotAlertsVia({ ctx, input: INPUT })).status).toBe(403);
  });

  it("turns them on with one PUT", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ respond: always({ data: null, status: 204 }), sent });

    unwrap(await setDependabotAlertsVia({ ctx, input: { ...INPUT, enabled: true } }));

    expect(sent.map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      `PUT ${REPO_URL}/vulnerability-alerts`,
    ]);
  });

  it("turns them off with one DELETE", async () => {
    const sent: SentRequest[] = [];
    // A context of its own: two writes in one rate-limit scope are paced apart by the write lane.
    const ctx = recordingCtx({ respond: always({ data: null, status: 204 }), sent });

    unwrap(await setDependabotAlertsVia({ ctx, input: { ...INPUT, enabled: false } }));

    expect(sent.map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      `DELETE ${REPO_URL}/vulnerability-alerts`,
    ]);
  });
});
