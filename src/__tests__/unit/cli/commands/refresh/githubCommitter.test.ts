/**
 * The GitHub run committer over a throwaway home: which runs get one at all, the two seams writing through ONE
 * dedup index into real bronze, the per-repo cursor each finished repo earns, and the note a run reports.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  githubDurabilityNotes,
  githubRunCommitter,
  repoKeyOf,
} from "../../../../../cli/commands/refresh/githubCommitter.js";
import type { OwnerProtectionResolver } from "../../../../../corpus/bronzeProtection.js";
import { readCorpusDir } from "../../../../../corpus/corpusDirRead.js";
import { bronzeSourceDir } from "../../../../../corpus/corpusPaths.js";
import { type GithubExportItem, projectGithubRecords } from "../../../../../corpus/github/project.js";
import { advanceGithubRepoWatermarks, readGithubRepoWatermarks } from "../../../../../corpus/github/repoWatermark.js";
import type { ExportWindow } from "../../../../../corpus/types.js";
import { ok, unwrap } from "../../../../../lib/result.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

const window: ExportWindow = { since: "2026-01-01", until: "2026-02-01" };
const REPO = { owner: "acme", repo: "widget" } as const;

/** One un-enriched issue, which projects to exactly one atom record keyed `#<number>`. */
function issue({ number, tsIso }: { number: number; tsIso: string }): GithubExportItem {
  return {
    kind: "issue",
    number,
    title: `Issue ${String(number)}`,
    tsIso,
    url: `https://github.com/acme/widget/issues/${String(number)}`,
  };
}

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "gh-committer-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The GitHub sourceIds bronze holds, read back through the production reader. */
function bronzeGithubIds(): readonly string[] {
  return unwrap(
    readCorpusDir({ dir: bronzeSourceDir({ home, source: "github" }), home, protection: NO_ENTRIES }),
  ).records.map((record) => record.sourceId);
}

describe("repoKeyOf", () => {
  it("files a repository under owner/repo", () => {
    expect(repoKeyOf({ repo: { owner: "acme", repo: "widget" } })).toBe("acme/widget");
  });
});

describe("githubRunCommitter — which runs get a committer", () => {
  it("returns undefined for each of the three bounded or cursor-isolated combinations, and writes nothing", () => {
    const combos = [
      { bounded: true, cursorIsolated: false },
      { bounded: false, cursorIsolated: true },
      { bounded: true, cursorIsolated: true },
    ];

    expect(combos.map((combo) => githubRunCommitter({ ...combo, home, window }))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(readdirSync(home, { recursive: true })).toEqual([]);
  });
});

describe("githubRunCommitter — the two seams over one bronze committer", () => {
  it("banks a batch, dedups the repo commit against it, and tallies both", () => {
    const committer = githubRunCommitter({ bounded: false, cursorIsolated: false, home, window })!;
    const first = issue({ number: 1, tsIso: "2026-01-15T00:00:00Z" });
    const second = issue({ number: 2, tsIso: "2026-01-20T00:00:00Z" });

    expect(unwrap(committer.commitBatch({ items: [first], repo: REPO }))).toEqual({ written: 1 });
    const repoRecords = projectGithubRecords({ items: [first, second], repo: "acme/widget" });
    expect(committer.commitRepo({ records: repoRecords, repoKey: "acme/widget" })).toEqual({
      banked: true,
      warnings: [],
    });

    expect(bronzeGithubIds()).toEqual(["#1", "#2"]);
    expect(committer.tally()).toEqual({ committedCursor: "2026-01-20T00:00:00Z", projected: 3, written: 2 });
  });

  it("answers an empty batch with zero written, opens no bronze file, and leaves the tally at zero", () => {
    const committer = githubRunCommitter({ bounded: false, cursorIsolated: false, home, window })!;

    expect(unwrap(committer.commitBatch({ items: [], repo: REPO }))).toEqual({ written: 0 });
    expect(readdirSync(home, { recursive: true })).toEqual([]);
    expect(committer.tally()).toEqual({ committedCursor: undefined, projected: 0, written: 0 });
  });

  it("writes rows from a batch but no repo cursor — a prefix of a repo is not a finished repo", () => {
    const committer = githubRunCommitter({ bounded: false, cursorIsolated: false, home, window })!;

    committer.commitBatch({ items: [issue({ number: 1, tsIso: "2026-01-15T00:00:00Z" })], repo: REPO });

    expect(bronzeGithubIds()).toEqual(["#1"]);
    expect([...readGithubRepoWatermarks({ home })]).toEqual([]);
  });
});

describe("githubRunCommitter — the per-repo cursor a finished repo earns", () => {
  it("marks the repo at its newest row and keeps another repo's seeded cursor", () => {
    unwrap(advanceGithubRepoWatermarks({ advances: [{ cursor: "2026-01-05T00:00:00Z", repo: "acme/other" }], home }));
    const committer = githubRunCommitter({ bounded: false, cursorIsolated: false, home, window })!;
    const records = projectGithubRecords({
      items: [issue({ number: 1, tsIso: "2026-01-15T00:00:00Z" }), issue({ number: 2, tsIso: "2026-01-20T00:00:00Z" })],
      repo: "acme/widget",
    });

    committer.commitRepo({ records, repoKey: "acme/widget" });

    expect([...readGithubRepoWatermarks({ home })]).toEqual([
      ["acme/other", "2026-01-05T00:00:00Z"],
      ["acme/widget", "2026-01-20T00:00:00Z"],
    ]);
  });

  it("marks a read-but-empty repo at the window end", () => {
    const committer = githubRunCommitter({ bounded: false, cursorIsolated: false, home, window })!;

    expect(committer.commitRepo({ records: [], repoKey: "acme/quiet" })).toEqual({ banked: true, warnings: [] });

    expect([...readGithubRepoWatermarks({ home })]).toEqual([["acme/quiet", "2026-02-01"]]);
  });

  it("keeps a seeded cursor that is newer than the repo's newest row", () => {
    unwrap(advanceGithubRepoWatermarks({ advances: [{ cursor: "2026-01-25T00:00:00Z", repo: "acme/widget" }], home }));
    const committer = githubRunCommitter({ bounded: false, cursorIsolated: false, home, window })!;
    const records = projectGithubRecords({
      items: [issue({ number: 1, tsIso: "2026-01-15T00:00:00Z" })],
      repo: "acme/widget",
    });

    committer.commitRepo({ records, repoKey: "acme/widget" });

    expect([...readGithubRepoWatermarks({ home })]).toEqual([["acme/widget", "2026-01-25T00:00:00Z"]]);
  });
});

describe("githubDurabilityNotes", () => {
  it("says nothing for a write-once run", () => {
    expect(githubDurabilityNotes({ tally: undefined })).toEqual([]);
  });

  it("says nothing when the commits were offered no record", () => {
    expect(githubDurabilityNotes({ tally: { committedCursor: undefined, projected: 0, written: 0 } })).toEqual([]);
  });

  it("names what was banked and what was offered when the commits saw records", () => {
    expect(
      githubDurabilityNotes({ tally: { committedCursor: "2026-01-20T00:00:00Z", projected: 3, written: 2 } }),
    ).toEqual(["durability: banked 2 record(s) to bronze during the crawl (3 offered) — an interruption keeps them"]);
  });
});
