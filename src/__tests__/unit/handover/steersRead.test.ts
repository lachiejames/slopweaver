/*
 * The effectful half of `handover steers`. `landingsOf`, the join from main's history to the PR ledger: every landed PR
 * is reachable by its number, and only a ledger record naming a head branch makes it reachable by branch — a PR the
 * ledger never recorded is counted as unjoined rather than dropped, so a settlement witness on it still reads as
 * landed. `readSteersReport` over a throwaway home and a real git checkout: a repository whose origin will not read is
 * named on the report and its rows read `landing-unknown`, never "not landed".
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { LandedCommit } from "../../../fleet/landedTypes.js";
import { type HisWords, hisWordsFields } from "../../../handover/hisWords.js";
import { landingsOf, readSteersReport } from "../../../handover/steersRead.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { PrLedgerHit, PrLedgerRead } from "../../../outbound/github/prLedgerByNumber.js";
import { stateHomePaths } from "../../../stateHome.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const REPO = "lachiejames/slopweaver";

const WORDS: HisWords = {
  anchor: "talk-call:a0000055-0000-4000-8000-000000000061#turn_000000000000000000005",
  atIso: "2020-01-01T00:00:00.000Z",
  cut: "none",
  where: "call",
  words: "one page listing every steer given, oldest first",
};

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp directory, removed after the test. */
function tempDir({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  fixtureDirs.push(dir);
  return dir;
}

/** A checkout with a GitHub `origin` and one commit on main naming PR 5. */
function checkout(): string {
  const dir = tempDir({ prefix: "steers-repo-" });
  const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: dir });
  git("init", "--initial-branch=main", ".");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  git("remote", "add", "origin", "git@github.com:acme/widgets.git");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git("add", ".");
  git("commit", "-m", "Ship the widget (#5)");
  return dir;
}

/** A checkout with a GitHub `origin` and nothing committed, so its main will not resolve. */
function emptyCheckout(): string {
  const dir = tempDir({ prefix: "steers-empty-repo-" });
  gitInTemp({ args: ["init", "--initial-branch=main", "."], cwd: dir });
  gitInTemp({ args: ["remote", "add", "origin", "git@github.com:acme/empty.git"], cwd: dir });
  return dir;
}

/** A call-anchored row on the board in `home`, naming `repo` when given, and recording when it was asked unless not. */
function steerRow({
  home,
  slug,
  repo,
  asked = true,
}: {
  home: string;
  slug: string;
  repo?: string;
  asked?: boolean;
}): void {
  const words = hisWordsFields({ record: { hisWords: WORDS, kind: "held" } }).map(
    (field) => `${field.key}: ${field.value}`,
  );
  const repoLines = repo === undefined ? [] : [`repo: ${repo}`];
  const askedLines = asked ? [`askedIso: "${WORDS.atIso}"`] : [];
  const lines = ["---", `slug: ${slug}`, "kind: doc", "status: ready", `anchor: "${WORDS.anchor}"`];
  const text = [...lines, ...askedLines, ...repoLines, ...words, "---", "", `# ${slug}`, ""].join("\n");
  const { handovers } = stateHomePaths({ home });
  mkdirSync(handovers, { recursive: true });
  writeFileSync(join(handovers, `${slug}.md`), text);
}

/** One squash-merged commit on main, its subject carrying the PR number the way GitHub writes it. */
function commit({ number, mergedIso }: { number: number; mergedIso: string }): LandedCommit {
  return { mergedIso, sha: `sha-${String(number)}`, subject: `Change ${String(number)} (#${String(number)})` };
}

/** A ledger record for one PR, its locus naming `base...head` the way the ledger stores it. */
function recorded({ branch }: { branch: string }): PrLedgerHit {
  return { form: { kind: "absent" }, kind: "one", locus: `lachiejames/slopweaver#main...${branch}` };
}

/** The ledger read, holding exactly the records given. */
function ledger({ hits }: { hits: ReadonlyMap<number, PrLedgerHit> }): PrLedgerRead {
  return { hits, kind: "read", unread: [] };
}

describe("landingsOf", () => {
  it("joins a recorded PR by branch and number, and an unrecorded one by number only", () => {
    const commits = [
      commit({ mergedIso: "2026-10-05T12:00:00+00:00", number: 20 }),
      commit({ mergedIso: "2026-10-05T11:00:00+00:00", number: 19 }),
    ];
    const { byBranch, byNumber, unjoined } = landingsOf({
      commits,
      hits: ledger({ hits: new Map([[20, recorded({ branch: "a-console-page" })]]) }),
      repo: REPO,
    });
    expect([...byBranch.keys()]).toEqual(["a-console-page"]);
    expect(byBranch.get("a-console-page")).toEqual({
      branch: "a-console-page",
      mergedIso: "2026-10-05T12:00:00+00:00",
      number: 20,
      title: "Change 20",
      url: "https://github.com/lachiejames/slopweaver/pull/20",
    });
    expect([...byNumber.keys()]).toEqual([20, 19]);
    expect(byNumber.get(19)!.branch).toBe(undefined);
    expect(unjoined).toBe(1);
  });

  it("keeps a branch's newest landing when it landed twice", () => {
    const { byBranch } = landingsOf({
      commits: [
        commit({ mergedIso: "2026-10-05T12:00:00+00:00", number: 30 }),
        commit({ mergedIso: "2026-10-04T12:00:00+00:00", number: 29 }),
      ],
      hits: ledger({
        hits: new Map([
          [30, recorded({ branch: "twice" })],
          [29, recorded({ branch: "twice" })],
        ]),
      }),
      repo: REPO,
    });
    expect(byBranch.get("twice")!.number).toBe(30);
  });

  it("counts an ambiguous record as unjoined, never guessing a branch", () => {
    const { byBranch, byNumber, unjoined } = landingsOf({
      commits: [commit({ mergedIso: "2026-10-05T12:00:00+00:00", number: 40 })],
      hits: ledger({ hits: new Map([[40, { count: 2, kind: "ambiguous" }]]) }),
      repo: REPO,
    });
    expect(byBranch.size).toBe(0);
    expect(byNumber.get(40)!.number).toBe(40);
    expect(unjoined).toBe(1);
  });

  it("skips a commit whose subject names no pull request", () => {
    const { byNumber, unjoined } = landingsOf({
      commits: [{ mergedIso: "2026-10-05T12:00:00+00:00", sha: "direct", subject: "A direct push" }],
      hits: ledger({ hits: new Map() }),
      repo: REPO,
    });
    expect(byNumber.size).toBe(0);
    expect(unjoined).toBe(0);
  });
});

describe("readSteersReport", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("reads each named main, names one that will not read, and states every row against what was read", () => {
    const home = tempDir({ prefix: "steers-home-" });
    const repo = checkout();
    const notARepo = tempDir({ prefix: "steers-bare-" });
    steerRow({ home, repo, slug: "on-a-read-main" });
    steerRow({ home, repo: notARepo, slug: "on-an-unread-main" });
    steerRow({ home, slug: "no-repo" });

    const report = unwrap(readSteersReport({ home, nowIso: "2026-10-06T02:00:00.000Z" }));

    expect(report.observedAtIso).toBe("2026-10-06T02:00:00.000Z");
    expect(report.unreadableDocs).toBe(0);
    expect(report.unreadableJournals).toEqual([]);
    const read = report.repos.find((entry) => entry.dir === repo)!;
    expect(read).toMatchObject({ commits: 1, kind: "read", ledgerUnread: 0, repo: "acme/widgets", unjoined: 1 });
    const unread = report.repos.find((entry) => entry.dir === notARepo)!;
    expect(unread.kind).toBe("unread");
    const states = Object.fromEntries(report.steers.map((steer) => [steer.slug, steer.state.kind]));
    expect(states).toEqual({
      "no-repo": "landing-unknown",
      "on-a-read-main": "waiting",
      "on-an-unread-main": "landing-unknown",
    });
  });

  it("names a main with no commits, a PR ledger that will not list, and a journal that will not read", () => {
    const home = tempDir({ prefix: "steers-broken-" });
    const empty = emptyCheckout();
    const repo = checkout();
    steerRow({ home, repo: empty, slug: "on-an-empty-main" });
    steerRow({ home, repo, slug: "behind-a-broken-ledger" });
    steerRow({ asked: false, home, slug: "never-asked" });
    const { ledgers, runs } = stateHomePaths({ home });
    // A directory where a file belongs, and a file where a directory belongs: neither lists or reads.
    mkdirSync(join(runs, "never-asked.jsonl"), { recursive: true });
    mkdirSync(ledgers, { recursive: true });
    writeFileSync(join(ledgers, "github-prs"), "not a directory\n");

    const report = unwrap(readSteersReport({ home, nowIso: "2026-10-06T02:00:00.000Z" }));

    expect(report.unreadableJournals).toEqual(["never-asked"]);
    expect(Object.fromEntries(report.repos.map((entry) => [entry.dir, entry.kind]))).toEqual({
      [empty]: "unread",
      [repo]: "unread",
    });
    const brokenLedger = report.repos.find((entry) => entry.dir === repo)!;
    expect(brokenLedger).toMatchObject({ kind: "unread" });
    expect(JSON.stringify(brokenLedger)).toContain("PR ledger would not list");
    const emptyMain = report.repos.find((entry) => entry.dir === empty)!;
    expect(JSON.stringify(emptyMain)).toContain("acme/empty's main would not read");
    expect(report.steers.map((steer) => steer.state.kind)).toEqual([
      "landing-unknown",
      "landing-unknown",
      "landing-unknown",
    ]);
  });

  it("names every main unread when no row records when it was asked", () => {
    const home = tempDir({ prefix: "steers-unasked-" });
    const repo = checkout();
    steerRow({ asked: false, home, repo, slug: "unasked" });

    const report = unwrap(readSteersReport({ home, nowIso: "2026-10-06T02:00:00.000Z" }));

    expect(report.repos).toEqual([
      {
        dir: repo,
        kind: "unread",
        why: "no candidate row records when it was asked, so no window of main could be chosen",
      },
    ]);
  });

  it("refuses when the board itself will not scan", () => {
    const home = tempDir({ prefix: "steers-noboard-" });
    writeFileSync(stateHomePaths({ home }).handovers, "not a directory\n");

    const refused = unwrapErr(readSteersReport({ home, nowIso: "2026-10-06T02:00:00.000Z" }));

    expect(refused.message).toContain("handovers");
  });

  it("reads an empty board as no steers and no repositories", () => {
    const home = tempDir({ prefix: "steers-empty-" });
    mkdirSync(stateHomePaths({ home }).handovers, { recursive: true });

    const report = unwrap(readSteersReport({ home, nowIso: "2026-10-06T02:00:00.000Z" }));

    expect([report.steers, report.repos]).toEqual([[], []]);
  });
});
