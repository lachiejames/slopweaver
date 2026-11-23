import { describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";
import { inventoryGithubExposure } from "../../../../live/github/exposureInventory.js";
import { listAll, surfaceState } from "../../../../live/github/exposureListing.js";
import {
  GITHUB_EXPOSURE_SURFACES,
  type GithubExposureCallId,
  type GithubExposureInventory,
  type GithubExposureReadFailure,
  type GithubExposureState,
} from "../../../../live/github/exposureModel.js";
import { githubExposureComplete, githubExposureLines } from "../../../../live/github/exposureReport.js";
import { referencedUploads } from "../../../../live/github/exposureUploads.js";
import {
  fakeGithubExposureSeam as fakeSeam,
  type GithubExposureFakeHandler as Handler,
  GITHUB_EXPOSURE_NOT_FOUND as NOT_FOUND,
} from "../../../githubExposureFake.js";

type Params = Readonly<Record<string, string | number>>;

/** A full page of placeholder items. */
function fullPage({ start }: { start: number }): readonly unknown[] {
  return Array.from({ length: 100 }, (_, index) => ({ id: start + index }));
}

/** The state one surface landed in. */
function stateOf({ inventory, surface }: { inventory: GithubExposureInventory; surface: string }): GithubExposureState {
  return inventory.surfaces.find((result) => result.surface === surface)!.state;
}

const CANARY_EMAIL = "owner-canary@example.com";
const CANARY_BODY = "SECRET-CANARY-BODY";
const UPLOAD = "https://github.com/user-attachments/assets/a0000073-0000-4000-8000-000000000079";

/** A small synthetic repository: two branches, three pull requests (one from a deleted branch, one with no ref). */
function syntheticRepository(): Partial<Record<GithubExposureCallId, Handler>> {
  return {
    commits: ({ params }) =>
      ok(
        params["sha"] === "sha-main"
          ? [
              {
                commit: {
                  author: { email: CANARY_EMAIL },
                  committer: { email: "noreply@github.com" },
                  tree: { sha: "tree-1" },
                },
                sha: "sha-main",
              },
            ]
          : [
              {
                commit: {
                  author: { email: "a@users.noreply.github.com" },
                  committer: { email: "noreply@github.com" },
                  tree: { sha: "tree-2" },
                },
                sha: String(params["sha"]),
              },
              {
                commit: {
                  author: { email: CANARY_EMAIL },
                  committer: { email: "noreply@github.com" },
                  tree: { sha: "tree-1" },
                },
                sha: "sha-main",
              },
            ],
      ),
    "git-ref": ({ params }) =>
      params["ref"] === "pull/3/head" ? ok({ object: { sha: "sha-pull-3", type: "commit" } }) : err(NOT_FOUND),
    "git-tree": ({ params }) =>
      ok({
        tree:
          params["tree_sha"] === "tree-1"
            ? [
                { sha: "blob-a", type: "blob" },
                { sha: "blob-b", type: "blob" },
                { sha: "sub", type: "tree" },
              ]
            : [
                { sha: "blob-a", type: "blob" },
                { sha: "blob-c", type: "blob" },
              ],
        truncated: false,
      }),
    "issue-comments": () => ok([{ body: `see ${UPLOAD}` }, { body: `again ${UPLOAD}` }]),
    issues: () => ok([{ body: "an issue" }, { body: CANARY_BODY, pull_request: {} }]),
    "matching-refs": ({ params }) => {
      if (params["ref"] === "heads") {
        return ok([{ object: { sha: "sha-main", type: "commit" }, ref: "refs/heads/main" }]);
      }
      return params["ref"] === "pull"
        ? ok([{ object: { sha: "sha-pull-1", type: "commit" }, ref: "refs/pull/1/head" }])
        : ok([]);
    },
    pulls: () =>
      ok([
        { body: CANARY_BODY, head: { ref: "deleted-branch" }, number: 1 },
        { body: null, head: { ref: "never-pushed" }, number: 2 },
        { body: "third", head: { ref: "main" }, number: 3 },
      ]),
    repository: () =>
      ok({
        description: "",
        has_discussions: false,
        has_pages: false,
        has_wiki: true,
        topics: ["a"],
        visibility: "private",
      }),
  };
}

const NOW = (): string => "2026-11-19T00:00:00.000Z";

describe("listAll", () => {
  it("ends at the first short page, reading every page before it", async () => {
    const { seam } = fakeSeam({
      handlers: { labels: ({ params }) => ok(params["page"] === 1 ? fullPage({ start: 0 }) : [{ id: 100 }]) },
    });
    const listing = await listAll({ call: "labels", maxPages: 5, params: {}, seam });
    expect(listing.outcome).toBe("complete");
    expect(listing.items.length).toBe(101);
  });

  it("reports a ceiling, never completion, when every page it may read is full", async () => {
    const { seam } = fakeSeam({
      handlers: { labels: ({ params }) => ok(fullPage({ start: Number(params["page"]) * 100 })) },
    });
    const listing = await listAll({ call: "labels", maxPages: 2, params: {}, seam });
    expect(listing.outcome).toBe("ceiling");
    expect(listing.items.length).toBe(200);
  });

  it("keeps every item already read when a later page fails", async () => {
    const failure = { message: "boom", status: 502 };
    const { seam } = fakeSeam({
      handlers: { labels: ({ params }) => (params["page"] === 1 ? ok(fullPage({ start: 0 })) : err(failure)) },
    });
    const listing = await listAll({ call: "labels", maxPages: 5, params: {}, seam });
    expect(listing).toEqual({ failure, items: fullPage({ start: 0 }), outcome: "failed" });
  });

  it("reads an unpaged listing once even when it holds more than a page", async () => {
    const { seam, asked } = fakeSeam({ handlers: { "matching-refs": () => ok(fullPage({ start: 0 })) } });
    const listing = await listAll({ call: "matching-refs", maxPages: 5, params: { ref: "heads" }, seam });
    expect(listing.outcome).toBe("complete");
    expect(asked.length).toBe(1);
  });
});

describe("surfaceState", () => {
  it("is counted only with no gap", () => {
    expect(surfaceState({ count: 0, detail: "d", gaps: [] })).toEqual({
      count: 0,
      detail: "d",
      kind: "counted",
      limits: [],
    });
  });

  it("is a lower bound when something was observed before a gap", () => {
    expect(surfaceState({ count: 4, detail: "d", gaps: ["g"] })).toEqual({
      detail: "d",
      kind: "partial",
      observedAtLeast: 4,
      why: ["g"],
    });
  });

  it("is a failure, never a zero, when nothing was observed and a gap stands", () => {
    expect(surfaceState({ count: 0, detail: "d", gaps: ["g"] })).toEqual({
      detail: "d",
      kind: "read-failed",
      why: ["g"],
    });
  });
});

describe("inventoryGithubExposure", () => {
  it("reports every declared surface exactly once, in the declared order", async () => {
    const inventory = unwrap(
      await inventoryGithubExposure({
        nowIso: NOW,
        owner: "acme",
        repo: "widgets",
        seam: fakeSeam({ handlers: syntheticRepository() }).seam,
      }),
    );
    expect(inventory.surfaces.map((result) => result.surface)).toEqual([...GITHUB_EXPOSURE_SURFACES]);
  });

  it("keeps a deleted branch's pull ref, probes an unlisted one, and counts a pull request with none", async () => {
    const inventory = unwrap(
      await inventoryGithubExposure({
        nowIso: NOW,
        owner: "acme",
        repo: "widgets",
        seam: fakeSeam({ handlers: syntheticRepository() }).seam,
      }),
    );
    expect(stateOf({ inventory, surface: "refs" })).toEqual({
      count: 3,
      detail: "1 branch(es), 0 tag(s), 2 pull head(s), 0 other pull ref(s)",
      kind: "counted",
      limits: [],
    });
    expect(stateOf({ inventory, surface: "pull-refs-of-deleted-branches" })).toEqual({
      count: 1,
      detail: "1 pull head ref(s) whose source branch is gone; 1 pull request(s) carry no head ref",
      kind: "counted",
      limits: [],
    });
  });

  it("dedups commits and blobs across tips and counts identities without carrying one", async () => {
    const inventory = unwrap(
      await inventoryGithubExposure({
        nowIso: NOW,
        owner: "acme",
        repo: "widgets",
        seam: fakeSeam({ handlers: syntheticRepository() }).seam,
      }),
    );
    expect(stateOf({ inventory, surface: "commits" })).toMatchObject({ count: 3, kind: "counted" });
    expect(stateOf({ inventory, surface: "commit-identities" })).toMatchObject({
      count: 3,
      detail:
        "2 distinct author address(es), 1 distinct committer address(es); 1 commit(s) carry an address that is not a GitHub no-reply",
    });
    expect(stateOf({ inventory, surface: "file-history" })).toMatchObject({
      count: 3,
      detail: "3 distinct file version(s) across 2 root tree(s)",
      kind: "counted",
    });
  });

  it("decides wiki, Pages and discussions from the repository's own flags", async () => {
    const inventory = unwrap(
      await inventoryGithubExposure({
        nowIso: NOW,
        owner: "acme",
        repo: "widgets",
        seam: fakeSeam({ handlers: syntheticRepository() }).seam,
      }),
    );
    expect(stateOf({ inventory, surface: "wiki" }).kind).toBe("not-readable-by-api");
    expect(stateOf({ inventory, surface: "pages" }).kind).toBe("not-enabled");
    expect(stateOf({ inventory, surface: "discussions" }).kind).toBe("not-enabled");
    expect(githubExposureComplete({ inventory })).toBe(true);
  });

  it("counts a referenced upload once however often it is referenced", async () => {
    const inventory = unwrap(
      await inventoryGithubExposure({
        nowIso: NOW,
        owner: "acme",
        repo: "widgets",
        seam: fakeSeam({ handlers: syntheticRepository() }).seam,
      }),
    );
    expect(stateOf({ inventory, surface: "attachments" })).toMatchObject({ count: 1, kind: "counted" });
  });

  it("prints no identity, body or upload URL in either output form", async () => {
    const inventory = unwrap(
      await inventoryGithubExposure({
        nowIso: NOW,
        owner: "acme",
        repo: "widgets",
        seam: fakeSeam({ handlers: syntheticRepository() }).seam,
      }),
    );
    const printed = [...githubExposureLines({ inventory }), JSON.stringify(inventory)].join("\n");
    expect(printed).toContain("commit-identities");
    expect(printed).not.toContain(CANARY_EMAIL);
    expect(printed).not.toContain(CANARY_BODY);
    expect(printed).not.toContain(UPLOAD);
  });

  it("marks a surface whose listing failed mid-way partial, and the whole report incomplete", async () => {
    const handlers = {
      ...syntheticRepository(),
      labels: ({ params }: { params: Params }) =>
        params["page"] === 1 ? ok(fullPage({ start: 0 })) : err({ message: "boom", status: 502 }),
    };
    const inventory = unwrap(
      await inventoryGithubExposure({ nowIso: NOW, owner: "acme", repo: "widgets", seam: fakeSeam({ handlers }).seam }),
    );
    expect(stateOf({ inventory, surface: "labels" })).toMatchObject({ kind: "partial", observedAtLeast: 100 });
    expect(githubExposureComplete({ inventory })).toBe(false);
    expect(githubExposureLines({ inventory })[0]).toBe(
      "acme/widgets: INCOMPLETE — 1 of 28 surfaces not fully counted (" +
        String(inventory.calls) +
        " reads at 2026-11-19T00:00:00.000Z)",
    );
  });

  it("makes a per-commit sum a lower bound when the commit listing behind it was incomplete", async () => {
    const synthetic = syntheticRepository();
    const handlers = {
      ...synthetic,
      "commit-statuses": () => ok([{ id: 1 }]),
      commits: ({ params }: { params: Params }) =>
        params["sha"] === "sha-main" ? err({ message: "boom", status: 502 }) : synthetic.commits!({ params }),
    };
    const inventory = unwrap(
      await inventoryGithubExposure({ nowIso: NOW, owner: "acme", repo: "widgets", seam: fakeSeam({ handlers }).seam }),
    );
    expect(stateOf({ inventory, surface: "commits" }).kind).toBe("partial");
    expect(stateOf({ inventory, surface: "commit-statuses" })).toMatchObject({ kind: "partial", observedAtLeast: 3 });
    expect(stateOf({ inventory, surface: "file-history" }).kind).toBe("partial");
  });

  it("never counts reviews over a pull listing that failed part-way, even when every review read is empty", async () => {
    const pulls = Array.from({ length: 100 }, (_, index) => ({ body: "", head: { ref: "main" }, number: index + 1 }));
    const handlers = {
      ...syntheticRepository(),
      pulls: ({ params }: { params: Params }) =>
        params["page"] === 1 ? ok(pulls) : err({ message: "boom", status: 502 }),
    };
    const inventory = unwrap(
      await inventoryGithubExposure({ nowIso: NOW, owner: "acme", repo: "widgets", seam: fakeSeam({ handlers }).seam }),
    );
    expect(stateOf({ inventory, surface: "pull-reviews" }).kind).toBe("read-failed");
    expect(githubExposureComplete({ inventory })).toBe(false);
  });

  it("counts the events feed only when GitHub refuses the page past its 300-event cap", async () => {
    const refused = {
      ...syntheticRepository(),
      events: ({ params }: { params: Params }) =>
        Number(params["page"]) <= 3
          ? ok(fullPage({ start: 0 }))
          : err({ message: "pagination is limited", status: 422 }),
    };
    const fourFull = { ...syntheticRepository(), events: () => ok(fullPage({ start: 0 })) };
    const atCap = unwrap(
      await inventoryGithubExposure({
        nowIso: NOW,
        owner: "acme",
        repo: "widgets",
        seam: fakeSeam({ handlers: refused }).seam,
      }),
    );
    const pastCap = unwrap(
      await inventoryGithubExposure({
        nowIso: NOW,
        owner: "acme",
        repo: "widgets",
        seam: fakeSeam({ handlers: fourFull }).seam,
      }),
    );
    expect(stateOf({ inventory: atCap, surface: "events" })).toMatchObject({ count: 300, kind: "counted" });
    expect(stateOf({ inventory: pastCap, surface: "events" })).toMatchObject({ kind: "partial", observedAtLeast: 400 });
  });

  it("reads discussions and Pages when the repository turns them on", async () => {
    const handlers = {
      ...syntheticRepository(),
      pages: () => ok({ status: "built" }),
      repository: () => ok({ has_discussions: true, has_pages: true, has_wiki: false }),
    };
    const graphql = (): Result<unknown, GithubExposureReadFailure> =>
      ok({
        repository: {
          discussions: { nodes: [{ comments: { totalCount: 3 } }, { comments: { totalCount: 1 } }], totalCount: 2 },
        },
      });
    const inventory = unwrap(
      await inventoryGithubExposure({
        nowIso: NOW,
        owner: "acme",
        repo: "widgets",
        seam: fakeSeam({ graphql, handlers }).seam,
      }),
    );
    expect(stateOf({ inventory, surface: "discussions" })).toEqual({
      count: 2,
      detail: "2 discussion(s), 4 comment(s) on those read",
      kind: "counted",
      limits: [],
    });
    expect(stateOf({ inventory, surface: "pages" })).toMatchObject({ count: 1, kind: "counted" });
    expect(stateOf({ inventory, surface: "wiki" }).kind).toBe("not-enabled");
  });

  it("refuses the whole inventory when the repository document cannot be read", async () => {
    const failure = unwrapErr(
      await inventoryGithubExposure({
        nowIso: NOW,
        owner: "acme",
        repo: "widgets",
        seam: fakeSeam({ handlers: {} }).seam,
      }),
    );
    expect(failure).toEqual(NOT_FOUND);
  });

  it("asks for every pull request's reviews and every run's jobs with filter=all", async () => {
    const handlers = {
      ...syntheticRepository(),
      "actions-runs": () => ok({ total_count: 1, workflow_runs: [{ id: 77 }] }),
    };
    const { seam, asked } = fakeSeam({ handlers });
    unwrap(await inventoryGithubExposure({ nowIso: NOW, owner: "acme", repo: "widgets", seam }));
    expect(asked.filter((call) => call.call === "pull-reviews").map((call) => call.params["pull_number"])).toEqual([
      1, 2, 3,
    ]);
    expect(asked.filter((call) => call.call === "actions-jobs").map((call) => call.params["filter"])).toEqual(["all"]);
  });
});

describe("referencedUploads", () => {
  it("finds both upload forms once each, signing query removed, and nothing else", () => {
    const legacy = "https://private-user-images.githubusercontent.com/1/abc.png";
    expect(
      referencedUploads({
        texts: [`${UPLOAD} ${UPLOAD}`, `![a](${legacy}?jwt=x)`, `${legacy}?jwt=y`, "https://example.com/x.png"],
      }),
    ).toEqual([UPLOAD, legacy]);
  });
});
