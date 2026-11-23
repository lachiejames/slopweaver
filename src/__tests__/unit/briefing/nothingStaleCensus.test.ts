import { describe, expect, it } from "vitest";

import { censusHoles, draftsBound, endedIdentities, matchKey } from "../../../briefing/nothingStaleCensus.js";
import type { LandingBriefingDocument, LandingRowView } from "../../../briefing/nothingStaleTypes.js";

const row = (over: Partial<LandingRowView> = {}): LandingRowView => ({
  action: "spawn-ci",
  blockedOn: [],
  boardRowSlug: undefined,
  dispatch: { kind: "act", verdict: "merge-now", why: "green and approved" },
  headOid: "abcdef1234567890",
  latestAskRecipients: [],
  number: 1,
  queueKind: "not-queued",
  repoSlug: "org/repo",
  title: "A change",
  url: "https://github.com/org/repo/pull/1",
  ...over,
});

const document = (over: Partial<LandingBriefingDocument> = {}): LandingBriefingDocument => ({
  census: [],
  people: {},
  presses: [],
  residue: [],
  rows: [],
  selection: { author: "@me", includeDrafts: true, repos: ["org/repo"] },
  ...over,
});

const open = ({ number, author = "me", isDraft = false }: { number: number; author?: string; isDraft?: boolean }) => ({
  author,
  isDraft,
  number,
});

describe("matchKey", () => {
  it("lower-cases the repository and keeps the number", () => {
    expect(matchKey({ number: 7, repoSlug: "Org/Repo" })).toBe("pull-request:org/repo#7");
  });
});

describe("censusHoles", () => {
  it("names a selected repository whose open list is missing", () => {
    expect(censusHoles({ document: document() })).toStrictEqual([
      "GitHub's open list for org/repo is not in the landing read, so a pull request it dropped is unseen",
    ]);
  });

  it("names only the owner's open pull request no row carries, matching the repository in any case", () => {
    const holes = censusHoles({
      document: document({
        census: [
          {
            kind: "read",
            pullRequests: [open({ number: 1 }), open({ number: 2 }), open({ author: "someone", number: 3 })],
            repo: "ORG/repo",
            viewer: "ME",
          },
        ],
        rows: [row({ number: 1 })],
      }),
    });
    expect(holes).toStrictEqual(["org/repo#2 is open on GitHub and the landing read did not place it"]);
  });

  it("is empty when the rows place every open pull request of the owner's", () => {
    const census = [{ kind: "read" as const, pullRequests: [open({ number: 1 })], repo: "org/repo", viewer: "me" }];
    expect(censusHoles({ document: document({ census, rows: [row({ number: 1 })] }) })).toStrictEqual([]);
  });
});

describe("draftsBound", () => {
  it("counts each open draft of the owner's once across every read list", () => {
    const list = { kind: "read" as const, pullRequests: [open({ isDraft: true, number: 4 })], repo: "org/repo" };
    const bound = draftsBound({
      document: document({
        census: [
          { ...list, viewer: "me" },
          { ...list, viewer: "me" },
        ],
        selection: { author: "@me", includeDrafts: false, repos: ["org/repo"] },
      }),
    });
    expect(bound).toBe(
      "the landing read left drafts out, so 1 open draft(s) of yours that GitHub listed are not counted here",
    );
  });
});

describe("endedIdentities", () => {
  it("ends a row no read list for its repository carries, and nothing in a repository with no read list", () => {
    const ended = endedIdentities({
      document: document({
        census: [
          { kind: "read", pullRequests: [open({ number: 1 })], repo: "org/repo", viewer: "me" },
          { kind: "unread", repo: "org/other", why: "the read timed out" },
        ],
        rows: [row({ number: 1 }), row({ number: 2 }), row({ number: 3, repoSlug: "org/other" })],
      }),
    });
    expect([...ended]).toStrictEqual(["pull-request:org/repo#2"]);
  });

  it("ends a pressed press, and never one that failed, which placed nothing", () => {
    const press = { detail: "refused", number: 7, repoSlug: "org/repo", url: "https://github.com/org/repo/pull/7" };
    const ended = endedIdentities({
      document: document({
        census: [{ kind: "read", pullRequests: [], repo: "ORG/REPO", viewer: "me" }],
        presses: [
          { ...press, outcome: "failed" },
          { ...press, number: 8, outcome: "pressed" },
        ],
      }),
    });
    expect([...ended]).toStrictEqual(["pull-request:org/repo#8"]);
  });
});
