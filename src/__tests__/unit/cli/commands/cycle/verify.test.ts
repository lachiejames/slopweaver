/**
 * The `--verify` leg over a recording reader in place of the live GitHub door: only an attached pull-request
 * URL the corpus could not resolve is read, each once and in first-seen order, all through one client; a
 * merged flag wins over any state, the three states map exactly, and a document without one or a failed read
 * stays unknown; and a pass reads exactly forty URLs, the forty-first left unread and reported unknown.
 *
 * `GITHUB_TOKEN` is set for the test and restored after it, so resolving the credential never shells out to
 * `gh`; the reader is never the real one, so nothing reaches the network.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  VERIFY_MAX,
  type VerifyGithubReader,
  verifyUnresolvedPullRequests,
} from "../../../../../cli/commands/cycle/verify.js";
import type { PullRequestState } from "../../../../../cycle/classify.js";
import type { CycleIssue } from "../../../../../cycle/issue.js";
import { err, ok } from "../../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../../live/github/errors.js";

const SAVED_ENV = { GH_TOKEN: process.env["GH_TOKEN"], GITHUB_TOKEN: process.env["GITHUB_TOKEN"] };

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cycle-verify-"));
  process.env["GITHUB_TOKEN"] = "test-token";
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
  for (const [name, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

/** One issue carrying the given attachments, every other field fixed. */
function issue({ identifier, attachmentUrls }: { identifier: string; attachmentUrls: readonly string[] }): CycleIssue {
  return {
    assigneeId: undefined,
    attachmentUrls,
    cycleId: undefined,
    identifier,
    priority: "No priority",
    projectId: undefined,
    projectName: undefined,
    recordTsIso: "2026-10-01T00:00:00.000Z",
    stateName: "In Progress",
    stateType: "started",
    team: "ENG",
    title: identifier,
    updatedAt: "2026-10-01T00:00:00.000Z",
    url: `https://linear.app/acme/issue/${identifier}`,
  };
}

/** A reader answering each address from a table (an absent address fails), recording every read. */
function tableReader({
  reads,
  graphqls,
  table,
}: {
  reads: string[];
  graphqls: unknown[];
  table: ReadonlyMap<string, unknown>;
}): VerifyGithubReader {
  return async ({ address, graphql, limit }) => {
    reads.push(`${address} limit=${String(limit)}`);
    graphqls.push(graphql);
    if (!table.has(address)) {
      return err(GithubLiveErrors.readFailed({ message: "HTTP 502" }));
    }
    return ok({
      coverage: { detail: "one pull request", kind: "bounded", residue: [] },
      data: table.get(address),
      readAtIso: "2026-10-01T00:00:00.000Z",
      source: "github",
      target: { address, identity: address, kind: "pull_request" },
    });
  };
}

/** The pull-request URL numbered `n` in the fixture repository. */
function pr({ n }: { n: number }): string {
  return `https://github.com/acme/widgets/pull/${String(n)}`;
}

const PR1 = pr({ n: 1 });
const PR2 = pr({ n: 2 });
const PR3 = pr({ n: 3 });
const PR4 = pr({ n: 4 });
const PR5 = pr({ n: 5 });
const PR6 = pr({ n: 6 });
const PR7 = pr({ n: 7 });

describe("VERIFY_MAX", () => {
  it("bounds a pass at forty live reads", () => {
    expect(VERIFY_MAX).toBe(40);
  });
});

describe("verifyUnresolvedPullRequests", () => {
  it("reads nothing when every attachment is a non-PR URL or one the corpus already resolved", async () => {
    const reads: string[] = [];

    const outcome = await verifyUnresolvedPullRequests({
      home,
      issues: [
        issue({
          attachmentUrls: [
            "https://github.com/acme/widgets/issues/7",
            "https://github.com/acme/widgets/pull/8/files",
            "https://notion.so/a-page",
            PR1,
          ],
          identifier: "ENG-1",
        }),
      ],
      known: new Map<string, PullRequestState>([[PR1, "OPEN"]]),
      read: tableReader({ graphqls: [], reads, table: new Map() }),
    });

    expect(reads).toEqual([]);
    expect(outcome).toEqual({ attempted: 0, states: new Map(), stillUnknown: [] });
  });

  it("reads each unresolved PR once in first-seen order through one client, mapping every state exactly", async () => {
    const reads: string[] = [];
    const graphqls: unknown[] = [];
    const table = new Map<string, unknown>([
      [PR1, { merged: true, state: "CLOSED" }],
      [PR2, { state: "MERGED" }],
      [PR3, { state: "CLOSED" }],
      [PR4, { state: "OPEN" }],
      [PR5, { state: "DRAFT" }],
      [PR6, "not an object"],
    ]);

    const outcome = await verifyUnresolvedPullRequests({
      home,
      issues: [
        issue({ attachmentUrls: [PR1, PR2, PR3, PR1], identifier: "ENG-1" }),
        issue({ attachmentUrls: [PR4, PR2, PR5, PR6, PR7], identifier: "ENG-2" }),
      ],
      known: new Map(),
      read: tableReader({ graphqls, reads, table }),
    });

    expect(reads).toEqual([
      "https://github.com/acme/widgets/pull/1 limit=1",
      "https://github.com/acme/widgets/pull/2 limit=1",
      "https://github.com/acme/widgets/pull/3 limit=1",
      "https://github.com/acme/widgets/pull/4 limit=1",
      "https://github.com/acme/widgets/pull/5 limit=1",
      "https://github.com/acme/widgets/pull/6 limit=1",
      "https://github.com/acme/widgets/pull/7 limit=1",
    ]);
    expect(new Set(graphqls).size).toBe(1);
    expect([...outcome.states.entries()]).toEqual([
      [PR1, "MERGED"],
      [PR2, "MERGED"],
      [PR3, "CLOSED"],
      [PR4, "OPEN"],
    ]);
    expect(outcome.stillUnknown).toEqual([PR5, PR6, PR7]);
    expect(outcome.attempted).toBe(7);
  });

  it("reads exactly forty and reports the forty-first unread and unknown", async () => {
    const reads: string[] = [];
    const urls = Array.from({ length: 41 }, (_unused, index) => pr({ n: index + 1 }));
    const table = new Map<string, unknown>(urls.map((url) => [url, { state: "OPEN" }]));

    const outcome = await verifyUnresolvedPullRequests({
      home,
      issues: [issue({ attachmentUrls: urls, identifier: "ENG-1" })],
      known: new Map(),
      read: tableReader({ graphqls: [], reads, table }),
    });

    expect(outcome.attempted).toBe(40);
    expect(reads).toEqual(urls.slice(0, 40).map((url) => `${url} limit=1`));
    expect([...outcome.states.keys()]).toEqual(urls.slice(0, 40));
    expect(outcome.stillUnknown).toEqual(["https://github.com/acme/widgets/pull/41"]);
  });
});
