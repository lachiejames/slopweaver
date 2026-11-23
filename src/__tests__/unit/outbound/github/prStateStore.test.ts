/**
 * The snapshot store's round trip, against a real throwaway home — the filesystem is the thing under test,
 * so a fake of it would test nothing.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { PR_STATE_VERSION, type PrState, type PrStateEntry } from "../../../../outbound/github/prStateCore.js";
import { prStatePath, readPrState, writePrState } from "../../../../outbound/github/prStateStore.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway state home nothing else writes to. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-pr-state-"));
  homes.push(home);
  return home;
}

const entry = (over: Partial<PrStateEntry> & { number: number }): PrStateEntry => ({
  baseRef: "main",
  headRef: `branch-${String(over.number)}`,
  kind: "pull-request",
  localBranchSha: null,
  observedBaseSha: "base-sha",
  preparation: { kind: "unchanged" },
  remoteHeadSha: `head-${String(over.number)}`,
  ...over,
});

const state = ({
  entries,
  repo = "lachiejames/slopweaver",
}: {
  entries: readonly PrStateEntry[];
  repo?: string;
}): PrState => ({
  entries,
  header: {
    generationId: "2026-09-09T16-00-00-000Z-abcd1234",
    kind: "header",
    recordedAtIso: "2026-09-09T16:00:00.000Z",
    repo,
    version: PR_STATE_VERSION,
  },
});

describe("readPrState", () => {
  it("answers nothing at all when no snapshot has ever been written", () => {
    const read = readPrState({ gitCommonDir: "/repo/.git", home: freshHome(), repo: "lachiejames/slopweaver" });

    expect(read.isOk()).toBe(true);
    expect(unwrap(read)).toBe(undefined);
  });

  it("round-trips a snapshot with every preparation kind in it", () => {
    const home = freshHome();
    const written = state({
      entries: [
        entry({
          number: 1,
          preparation: { kind: "ready", preparedRef: "refs/slopweaver/restack/g/one", preparedSha: "aaa" },
        }),
        entry({ number: 2, localBranchSha: "bbb", preparation: { kind: "blocked", reason: "its replay conflicted" } }),
        entry({ number: 3, observedBaseSha: null }),
      ],
    });

    expect(writePrState({ gitCommonDir: "/repo/.git", home, state: written }).isOk()).toBe(true);
    const read = unwrap(readPrState({ gitCommonDir: "/repo/.git", home, repo: "lachiejames/slopweaver" }));

    expect(read!.entries).toEqual(written.entries);
    expect(read!.header.generationId).toBe("2026-09-09T16-00-00-000Z-abcd1234");
  });

  it("REPLACES the previous snapshot, so a pull request that merged is simply gone", () => {
    const home = freshHome();
    writePrState({
      gitCommonDir: "/repo/.git",
      home,
      state: state({ entries: [entry({ number: 1 }), entry({ number: 2 })] }),
    });
    writePrState({ gitCommonDir: "/repo/.git", home, state: state({ entries: [entry({ number: 2 })] }) });

    const read = unwrap(readPrState({ gitCommonDir: "/repo/.git", home, repo: "lachiejames/slopweaver" }));

    expect(read!.entries.map((row) => row.number)).toEqual([2]);
  });

  it("keeps two clones of one repository apart, and two worktrees of one clone together", () => {
    const home = freshHome();
    writePrState({ gitCommonDir: "/clone-a/.git", home, state: state({ entries: [entry({ number: 1 })] }) });
    writePrState({ gitCommonDir: "/clone-b/.git", home, state: state({ entries: [entry({ number: 2 })] }) });

    const a = unwrap(readPrState({ gitCommonDir: "/clone-a/.git", home, repo: "lachiejames/slopweaver" }));
    const b = unwrap(readPrState({ gitCommonDir: "/clone-b/.git", home, repo: "lachiejames/slopweaver" }));

    expect(a!.entries.map((row) => row.number)).toEqual([1]);
    expect(b!.entries.map((row) => row.number)).toEqual([2]);
    expect(prStatePath({ gitCommonDir: "/clone-a/.git", home, repo: "lachiejames/slopweaver" })).not.toBe(
      prStatePath({ gitCommonDir: "/clone-b/.git", home, repo: "lachiejames/slopweaver" }),
    );
  });

  it("is case-insensitive about the repository slug, exactly as GitHub is", () => {
    const home = freshHome();
    writePrState({ gitCommonDir: "/repo/.git", home, state: state({ entries: [entry({ number: 4 })] }) });

    const read = unwrap(readPrState({ gitCommonDir: "/repo/.git", home, repo: "LachieJames/SlopWeaver" }));

    expect(read!.entries.map((row) => row.number)).toEqual([4]);
  });

  it("refuses a file whose lines are not JSON rather than reading part of it", () => {
    const home = freshHome();
    const path = prStatePath({ gitCommonDir: "/repo/.git", home, repo: "lachiejames/slopweaver" });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "not json at all\n");

    const read = readPrState({ gitCommonDir: "/repo/.git", home, repo: "lachiejames/slopweaver" });

    expect(read.isErr()).toBe(true);
    expect(read.isErr() ? read.error.code : "").toBe("STATE_INVALID");
  });

  it("refuses a file at this key whose header names another repository", () => {
    const home = freshHome();
    const path = prStatePath({ gitCommonDir: "/repo/.git", home, repo: "lachiejames/slopweaver" });
    mkdirSync(dirname(path), { recursive: true });
    const foreign = state({ entries: [entry({ number: 1 })], repo: "acme/acme-admin" });
    writeFileSync(path, `${JSON.stringify(foreign.header)}\n${JSON.stringify(foreign.entries[0])}\n`);

    const read = readPrState({ gitCommonDir: "/repo/.git", home, repo: "lachiejames/slopweaver" });

    expect(read.isErr()).toBe(true);
    expect(read.isErr() ? read.error.message : "").toContain("describes acme/acme-admin");
  });

  it("writes a repository's snapshot under ITS OWN key, whatever key the caller read with", () => {
    const home = freshHome();
    writePrState({
      gitCommonDir: "/repo/.git",
      home,
      state: state({ entries: [entry({ number: 1 })], repo: "acme/acme-admin" }),
    });

    // The write is keyed by the header's repo, so the slopweaver key is simply absent rather than wrong.
    expect(unwrap(readPrState({ gitCommonDir: "/repo/.git", home, repo: "lachiejames/slopweaver" }))).toBe(undefined);
    expect(unwrap(readPrState({ gitCommonDir: "/repo/.git", home, repo: "acme/acme-admin" }))!.entries).toHaveLength(1);
  });
});
