/**
 * A row read by the exact slug a landed change's branch names: live, then archived, its journal beside it, and a
 * branch that cannot be a slug said to be one rather than opened.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AutonomyLedgerPort } from "../../../autonomy/port.js";
import { readLandedReport, readLandedRow } from "../../../fleet/landedRead.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  AUTONOMY_FIXTURE_OUTAGE,
  memoryAutonomyLedgerPort,
  unavailableAutonomyLedgerPort,
} from "../../autonomyLedgerFixture.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A home with a handovers directory, its archive and a runs directory. */
function dirs(): { handoverDir: string; runsDir: string } {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-landedread-"));
  fixtureDirs.push(home);
  const handoverDir = join(home, "handovers");
  const runsDir = join(home, "runs");
  mkdirSync(join(handoverDir, "archive"), { recursive: true });
  mkdirSync(runsDir, { recursive: true });
  return { handoverDir, runsDir };
}

/** A minimal row's text. */
function docText({ slug }: { slug: string }): string {
  return `---\nslug: ${slug}\nkind: ask\nstatus: "ready"\naskedIso: "2026-10-05T01:00:00.000Z"\n---\n\nBody.\n`;
}

describe("readLandedRow", () => {
  it("reads an archived row, saying it was archived", () => {
    const { handoverDir, runsDir } = dirs();
    writeFileSync(join(handoverDir, "archive", "shipped.md"), docText({ slug: "shipped" }));
    const row = readLandedRow({ handoverDir, runsDir, slug: "shipped" });
    expect(row).toMatchObject({ archived: true, doc: { slug: "shipped" }, events: [], kind: "read", undecoded: 0 });
  });

  it("counts the journal lines it could not decode rather than reading past them", () => {
    const { handoverDir, runsDir } = dirs();
    writeFileSync(join(handoverDir, "ruled.md"), docText({ slug: "ruled" }));
    writeFileSync(
      join(runsDir, "ruled.jsonl"),
      'not json\n{"kind":"a-kind-from-the-future","atIso":"2026-10-05T01:00:00.000Z"}\n',
    );
    expect(readLandedRow({ handoverDir, runsDir, slug: "ruled" })).toMatchObject({ kind: "read", undecoded: 2 });
  });

  it("reads no row for a branch nobody filed", () => {
    const { handoverDir, runsDir } = dirs();
    expect(readLandedRow({ handoverDir, runsDir, slug: "nobody-filed-this" })).toEqual({ kind: "absent" });
  });

  it("says a branch that cannot be a slug is not one, without opening a path", () => {
    const { handoverDir, runsDir } = dirs();
    expect(readLandedRow({ handoverDir, runsDir, slug: "renovate/lock-file-maintenance" })).toEqual({
      kind: "not-a-slug",
    });
  });

  it("says a row whose front-matter names another slug would not read", () => {
    const { handoverDir, runsDir } = dirs();
    writeFileSync(join(handoverDir, "named.md"), docText({ slug: "other" }));
    const row = readLandedRow({ handoverDir, runsDir, slug: "named" });
    expect(row.kind).toBe("unreadable");
    expect(JSON.stringify(row)).toContain("its front-matter names slug other");
  });
});

/** A checkout with a GitHub `origin` and two commits on main, one naming a pull request; and an empty state home. */
function checkout(): { dir: string; home: string; headSha: string } {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-landedrepo-"));
  const home = mkdtempSync(join(tmpdir(), "slopweaver-landedhome-"));
  fixtureDirs.push(dir, home);
  const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: dir });
  git("init", "--initial-branch=main", ".");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  git("remote", "add", "origin", "git@github.com:lachiejames/slopweaver.git");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git("add", ".");
  git("commit", "-m", "A direct commit");
  writeFileSync(join(dir, "a.txt"), "two\n");
  git("add", ".");
  git("commit", "-m", "What landed reads beside the owner's words (#7)");
  return { dir, headSha: git("rev-parse", "HEAD"), home };
}

describe("readLandedReport", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("lists main newest first, saying of each landing which step of the join it reached", async () => {
    const { dir, home, headSha } = checkout();
    const report = unwrap(
      await readLandedReport({
        autonomy: memoryAutonomyLedgerPort(),
        dir,
        home,
        limit: 5,
        nowIso: "2026-10-05T04:00:00.000Z",
        refs: ["origin/main", "main"],
      }),
    );
    expect([report.repo, report.ref, report.refSha, report.limit]).toEqual([
      "lachiejames/slopweaver",
      "main",
      headSha,
      5,
    ]);
    expect(report.landings.map((landing) => [landing.number, landing.url, landing.words])).toEqual([
      [
        7,
        "https://github.com/lachiejames/slopweaver/pull/7",
        { kind: "not-joined", why: "slopweaver's PR ledger holds no record of #7" },
      ],
      [undefined, undefined, { kind: "not-joined", why: "the commit names no pull request" }],
    ]);
  });

  it("names an autonomy store outage on the landing that needed the ledger", async () => {
    const { dir, home } = checkout();
    const report = unwrap(
      await readLandedReport({
        autonomy: unavailableAutonomyLedgerPort(),
        dir,
        home,
        limit: 1,
        nowIso: "2026-10-05T04:00:00.000Z",
        refs: ["main"],
      }),
    );
    expect(report.landings.map((landing) => landing.under)).toEqual([
      { kind: "unread", why: AUTONOMY_FIXTURE_OUTAGE.message },
    ]);
  });

  it("never reads the autonomy ledger for a window in which no landing names a pull request", async () => {
    const { dir, home } = checkout();
    const outage = unavailableAutonomyLedgerPort();
    let reads = 0;
    const counted: AutonomyLedgerPort = {
      ...outage,
      readRecords: (request) => {
        reads += 1;
        return outage.readRecords(request);
      },
    };
    const report = unwrap(
      await readLandedReport({
        autonomy: counted,
        dir,
        home,
        limit: 1,
        nowIso: "2026-10-05T04:00:00.000Z",
        refs: ["main~1"],
      }),
    );
    expect([reads, report.landings.map((landing) => [landing.title, landing.under])]).toEqual([
      0,
      [["A direct commit", { kind: "none" }]],
    ]);
  });

  it("refuses when main does not resolve, never reading the checkout's HEAD in its place", async () => {
    const { dir, home } = checkout();
    const report = await readLandedReport({
      autonomy: memoryAutonomyLedgerPort(),
      dir,
      home,
      limit: 5,
      nowIso: "2026-10-05T04:00:00.000Z",
      refs: ["trunk"],
    });
    expect(unwrapErr(report).code).toBe("REF_UNRESOLVED");
  });
});
