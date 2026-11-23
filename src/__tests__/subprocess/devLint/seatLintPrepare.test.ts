/**
 * `prepareSeatLint` over a real throwaway repository: it resolves the merge-base itself, proves when origin/main
 * was last fetched from the reflog or a FETCH_HEAD that names it, refuses past the bound or on a reflog entry no fetch wrote, and narrows oxlint to
 * what the branch changed — committed, in the working tree, or untracked, never a deleted file.
 */
import { mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prepareSeatLint, SEAT_FETCH_MAX_AGE_MS } from "../../../devLint/seatLint.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { gitInTemp, REAL_GIT_SUITE, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

let dir = "";
let originMain = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "seat-lint-"));
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: dir });
  gitInTemp({ args: ["config", "user.email", "fixture@example.com"], cwd: dir });
  gitInTemp({ args: ["config", "user.name", "fixture"], cwd: dir });
  writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
  writeFileSync(join(dir, "gone.ts"), "export const gone = 1;\n");
  writeFileSync(join(dir, "notes.md"), "# notes\n");
  gitInTemp({ args: ["add", "."], cwd: dir });
  gitInTemp({ args: ["commit", "-q", "-m", "seed"], cwd: dir });
  gitInTemp({
    args: ["update-ref", "-m", "fetch origin main: storing head", "refs/remotes/origin/main", "HEAD"],
    cwd: dir,
  });
  originMain = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir });
  gitInTemp({ args: ["checkout", "-q", "-b", "work"], cwd: dir });
  writeFileSync(join(dir, "a.ts"), "export const a = 2;\n");
  gitInTemp({ args: ["rm", "-q", "gone.ts"], cwd: dir });
  writeFileSync(join(dir, "notes.md"), "# notes, changed\n");
  gitInTemp({ args: ["commit", "-q", "-am", "work"], cwd: dir });
  writeFileSync(join(dir, "new.mts"), "export const n = 1;\n");
}, REAL_GIT_TIMEOUT_MS);

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

const reflog = (): string => join(dir, ".git", "logs", "refs", "remotes", "origin", "main");

/** An hour on, when the seed's reflog fetch entry reads as past the bound. */
const AN_HOUR_ON = (): number => Date.now() + 60 * 60_000;

/** Write a FETCH_HEAD stamped at `atMs`. */
const fetchHead = ({ text, atMs }: { text: string; atMs: number }): void => {
  const path = join(dir, ".git", "FETCH_HEAD");
  writeFileSync(path, text);
  utimesSync(path, atMs / 1000, atMs / 1000);
};

describe("prepareSeatLint", REAL_GIT_SUITE, () => {
  it("resolves the merge-base, dates the fetch from origin/main's reflog and narrows oxlint to the changes", () => {
    const seat = unwrap(prepareSeatLint({ cwd: dir, nowMs: Date.now() }));
    expect(seat.baseSha).toBe(originMain);
    expect(seat.changedOxlintFiles).toEqual(["a.ts", "new.mts"]);
    expect(seat.fetch.source).toBe("origin/main reflog");
  });

  it("refuses when origin/main was fetched past the bound", () => {
    const refusal = unwrapErr(prepareSeatLint({ cwd: dir, nowMs: Date.now() + SEAT_FETCH_MAX_AGE_MS + 60_000 }));
    expect(refusal.code).toBe("FETCH_STALE");
  });

  it("dates the fetch from a FETCH_HEAD that names origin/main's commit when it is newer than the reflog", () => {
    const nowMs = AN_HOUR_ON();
    fetchHead({ atMs: nowMs, text: `${originMain}\t\tbranch 'main' of example.com:acme/example\n` });
    const seat = unwrap(prepareSeatLint({ cwd: dir, nowMs }));
    expect(seat.fetch.source).toBe("FETCH_HEAD");
  });

  it("does not let a fresh FETCH_HEAD of another branch make a stale origin/main look fresh", () => {
    const nowMs = AN_HOUR_ON();
    fetchHead({ atMs: nowMs, text: `${originMain}\t\tbranch 'feature' of example.com:acme/example\n` });
    expect(unwrapErr(prepareSeatLint({ cwd: dir, nowMs })).code).toBe("FETCH_STALE");
  });

  it("does not let a hand update-ref, which rewrites the reflog with no fetch, make origin/main look fresh", () => {
    const work = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir });
    gitInTemp({ args: ["update-ref", "refs/remotes/origin/main", work], cwd: dir });
    gitInTemp({ args: ["update-ref", "refs/remotes/origin/main", originMain], cwd: dir });
    expect(unwrapErr(prepareSeatLint({ cwd: dir, nowMs: Date.now() })).code).toBe("FETCH_AGE_UNREADABLE");
  });

  it("refuses when nothing proves a fetch at all", () => {
    unlinkSync(reflog());
    expect(unwrapErr(prepareSeatLint({ cwd: dir, nowMs: Date.now() }))).toEqual({
      code: "FETCH_AGE_UNREADABLE",
      message:
        `dev lint --lane seat: cannot tell when origin/main was last fetched — no FETCH_HEAD names its ${originMain} ` +
        "and no reflog entry records a fetch to it — run `git fetch origin main`, then re-run `slopweaver dev lint --lane seat`",
    });
  });

  it("refuses a checkout with no origin/main rather than guessing a base", () => {
    gitInTemp({ args: ["update-ref", "-d", "refs/remotes/origin/main"], cwd: dir });
    expect(unwrapErr(prepareSeatLint({ cwd: dir, nowMs: Date.now() }))).toEqual({
      code: "BASE_UNREADABLE",
      detail: "refs/remotes/origin/main does not resolve",
      message:
        "dev lint --lane seat: cannot resolve the merge-base of HEAD and origin/main " +
        "(refs/remotes/origin/main does not resolve) — run `git fetch origin main`, then re-run " +
        "`slopweaver dev lint --lane seat`",
    });
  });
});
