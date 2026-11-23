/**
 * `fresh-cut accept` and the reviewed-residue list over real git: an accepted owner-address line is taken out of the
 * next verify and counted, the same line changed refuses again, a second acceptance of one line and a line of
 * another class are refused, and the report binds the exact list bytes it subtracted.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../admit/operationLock.js";
import { acceptReviewedResidue, REVIEWED_RESIDUE_LOCK_KEY } from "../../../freshCut/accept.js";
import type { FreshCutRecord } from "../../../freshCut/core.js";
import { produceFreshCut } from "../../../freshCut/produce.js";
import { reviewedResiduePath } from "../../../freshCut/reviewedResidueStore.js";
import { verifyFreshCut } from "../../../freshCut/verify.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { githubNoReplyAddress } from "../../../live/github/viewerIdentity.js";
import { writePrivateTerms } from "../../privateTermsFixture.js";
import { gitInTemp, REAL_GIT_SUITE } from "../../tempGitRepo.js";

const LOGIN = "acme-dev";
const IDENTITY = { address: githubNoReplyAddress({ identity: { databaseId: 4242, login: LOGIN } }), login: LOGIN };
const NOW = new Date("2026-11-20T01:02:03.000Z");
const SESSION = "session-under-test";

/** An owner-address row that over-reads a dotted version string, and a topic row. */
const ROWS = ["owner-address\t-\t\\d{1,3}(?:\\.\\d{1,3}){3}\tsynthetic", "topic\ti\tquillfeather\tsynthetic"];

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A source repository whose one commit holds `files`, a home with the rows, and a cut of that commit. */
function cutOf({ files }: { files: Readonly<Record<string, string>> }): {
  home: string;
  repo: string;
  root: string;
  record: FreshCutRecord;
} {
  const root = mkdtempSync(join(tmpdir(), "fresh-accept-"));
  roots.push(root);
  const repo = join(root, "source");
  gitInTemp({ args: ["init", "-q", "-b", "main", repo], cwd: root });
  gitInTemp({ args: ["config", "user.email", "fixture@example.invalid"], cwd: repo });
  gitInTemp({ args: ["config", "user.name", "Fixture"], cwd: repo });
  gitInTemp({ args: ["config", "commit.gpgsign", "false"], cwd: repo });
  for (const [path, text] of Object.entries(files)) {
    writeFileSync(join(repo, path), text);
  }
  gitInTemp({ args: ["add", "-A"], cwd: repo });
  gitInTemp({ args: ["commit", "-q", "-m", "only"], cwd: repo });
  const tip = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: repo });
  const home = join(root, "home");
  mkdirSync(home);
  writePrivateTerms({ home, rows: ROWS });
  const record = unwrap(
    produceFreshCut({
      commit: tip,
      destination: join(root, `cut-${tip.slice(0, 7)}`),
      identity: IDENTITY,
      now: NOW,
      recordId: "0b7e7f8e-1f4a-4c2b-9d3e-5a6b7c8d9e0f",
      source: repo,
    }),
  );
  return { home, record, repo, root };
}

/** Accept one line of a cut as a version string. */
const accept = ({
  home,
  record,
  repo,
  path,
  line,
}: {
  home: string;
  record: FreshCutRecord;
  repo: string;
  path: string;
  line: number;
}) =>
  acceptReviewedResidue({
    home,
    judgement: "not-an-address",
    line,
    now: NOW,
    path,
    record,
    sessionId: SESSION,
    source: repo,
  });

describe("fresh-cut accept and verify", REAL_GIT_SUITE, () => {
  it("takes an accepted line out of the next verify, counts it, and binds the list's exact bytes", () => {
    const { home, record, repo } = cutOf({ files: { "VERSION.md": "intro\nbuild 7.12.3.40\n" } });
    const before = unwrap(verifyFreshCut({ home, now: NOW, record, source: repo }));
    expect([before.status, before.findings, before.reviewedAccepted]).toEqual([
      "refused",
      [{ className: "owner-address", kind: "private-term", line: 2, path: "VERSION.md" }],
      0,
    ]);

    const accepted = unwrap(accept({ home, line: 2, path: "VERSION.md", record, repo }));
    expect([accepted.entry.className, accepted.entry.reviewedBySessionId, accepted.entry.lineSha256]).toEqual([
      "owner-address",
      SESSION,
      createHash("sha256").update("build 7.12.3.40").digest("hex"),
    ]);

    const after = unwrap(verifyFreshCut({ home, now: NOW, record, source: repo }));
    expect([after.status, after.findings, after.reviewedAccepted, after.reviewedResidueSha256]).toEqual([
      "clear",
      [],
      1,
      createHash("sha256")
        .update(readFileSync(reviewedResiduePath({ home })))
        .digest("hex"),
    ]);
  });

  it("refuses the verify, rather than subtracting, when a matching entry sits beside a blank line", () => {
    const { home, record, repo } = cutOf({ files: { "VERSION.md": "build 7.12.3.40\n" } });
    unwrap(accept({ home, line: 1, path: "VERSION.md", record, repo }));
    appendFileSync(reviewedResiduePath({ home }), "\n");
    expect(unwrapErr(verifyFreshCut({ home, now: NOW, record, source: repo })).code).toBe(
      "REVIEWED_RESIDUE_UNREADABLE",
    );
  });

  it("refuses, and appends nothing, while another accept holds the list's lock", () => {
    const { home, record, repo } = cutOf({ files: { "VERSION.md": "build 7.12.3.40\n" } });
    const held = unwrap(acquireOperationLock({ home, key: REVIEWED_RESIDUE_LOCK_KEY, nowIso: NOW.toISOString() }));
    try {
      expect(unwrapErr(accept({ home, line: 1, path: "VERSION.md", record, repo })).code).toBe(
        "REVIEWED_RESIDUE_WRITE_FAILED",
      );
    } finally {
      held.release();
    }
    expect(existsSync(reviewedResiduePath({ home }))).toBe(false);
    expect(unwrap(accept({ home, line: 1, path: "VERSION.md", record, repo })).entry.lineNumberAtReview).toBe(1);
  });

  it("refuses a second acceptance of the same line", () => {
    const { home, record, repo } = cutOf({ files: { "VERSION.md": "build 7.12.3.40\n" } });
    unwrap(accept({ home, line: 1, path: "VERSION.md", record, repo }));
    expect(unwrapErr(accept({ home, line: 1, path: "VERSION.md", record, repo })).code).toBe(
      "REVIEWED_RESIDUE_CANDIDATE_REFUSED",
    );
  });

  it("refuses a line holding only a finding of another class", () => {
    const { home, record, repo } = cutOf({ files: { "NOTES.md": "about quillfeather\n" } });
    expect(unwrapErr(accept({ home, line: 1, path: "NOTES.md", record, repo })).code).toBe(
      "REVIEWED_RESIDUE_CANDIDATE_REFUSED",
    );
  });

  it("refuses again once the accepted line changes, in a new cut over the same home", () => {
    const first = cutOf({ files: { "VERSION.md": "build 7.12.3.40\n" } });
    unwrap(accept({ home: first.home, line: 1, path: "VERSION.md", record: first.record, repo: first.repo }));
    const second = cutOf({ files: { "VERSION.md": "build 7.12.3.41\n" } });
    const list = readFileSync(reviewedResiduePath({ home: first.home }));
    mkdirSync(join(second.home, "fresh-cuts"), { recursive: true });
    writeFileSync(reviewedResiduePath({ home: second.home }), list);

    const verification = unwrap(
      verifyFreshCut({ home: second.home, now: NOW, record: second.record, source: second.repo }),
    );
    expect([verification.status, verification.findings, verification.reviewedAccepted]).toEqual([
      "refused",
      [{ className: "owner-address", kind: "private-term", line: 1, path: "VERSION.md" }],
      0,
    ]);
  });
});
