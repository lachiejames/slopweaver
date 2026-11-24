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
import type { FreshCutRecord, FreshCutVerification } from "../../../freshCut/core.js";
import { produceFreshCut } from "../../../freshCut/produce.js";
import type { ReviewedResidueDecision } from "../../../freshCut/reviewedResidue.js";
import { reviewedResiduePath } from "../../../freshCut/reviewedResidueStore.js";
import { writeFreshCutVerification } from "../../../freshCut/store.js";
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

/** The synthetic transcript an owner anchor resolves in, and the owner turn inside it. */
const OWNER_SESSION = "11111111-0000-4333-8444-555555555555";
const OWNER_TURN = "66666666-0000-4888-9999-aaaaaaaaaaaa";
const ANCHOR = `transcript:${OWNER_SESSION}#${OWNER_TURN}`;

/** A throwaway transcripts root holding one transcript with one owner turn, written the way Claude Code writes one. */
function projectsWithOwnerTurn(): string {
  const root = mkdtempSync(join(tmpdir(), "fresh-accept-claude-"));
  roots.push(root);
  const project = join(root, "projects", "-repo");
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, `${OWNER_SESSION}.jsonl`),
    `${JSON.stringify({
      cwd: "/repo",
      message: { content: [{ text: "yes, those lines are fine", type: "text" }], role: "user" },
      timestamp: "2026-11-20T00:00:00.000Z",
      type: "user",
      uuid: OWNER_TURN,
    })}\n`,
  );
  return join(root, "projects");
}

/** A transcripts root nothing is written under, so no anchor resolves in it. */
const noTranscripts = (): string => join(tmpdir(), "no-transcripts-here");

/** Verify a cut and keep the verification its report stores, dropping the count that is only printed. */
const verificationOf = (options: Parameters<typeof verifyFreshCut>[0]): FreshCutVerification =>
  unwrap(verifyFreshCut(options)).verification;

/** Accept one line of a cut: as a version string by default, or on a decision a case names. */
const accept = ({
  home,
  record,
  repo,
  path,
  line,
  decision = { className: "owner-address", judgement: "not-an-address" },
  projectsDir = noTranscripts(),
}: {
  home: string;
  record: FreshCutRecord;
  repo: string;
  path: string;
  line: number;
  decision?: ReviewedResidueDecision;
  projectsDir?: string;
}) =>
  acceptReviewedResidue({
    decision,
    home,
    line,
    now: NOW,
    path,
    projectsDir,
    record,
    sessionId: SESSION,
    source: repo,
  });

describe("fresh-cut accept and verify", REAL_GIT_SUITE, () => {
  it("takes an accepted line out of the next verify, counts it, and binds the list's exact bytes", () => {
    const { home, record, repo } = cutOf({ files: { "VERSION.md": "intro\nbuild 7.12.3.40\n" } });
    const before = verificationOf({ home, now: NOW, projectsDir: noTranscripts(), record, source: repo });
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

    const after = verificationOf({ home, now: NOW, projectsDir: noTranscripts(), record, source: repo });
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
    expect(unwrapErr(verifyFreshCut({ home, now: NOW, projectsDir: noTranscripts(), record, source: repo })).code).toBe(
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

  it("clears only the accepted copy of two identical lines, and leaves the other open to its own acceptance", () => {
    const { home, record, repo } = cutOf({ files: { "VERSION.md": "intro\nbuild 7.12.3.40\nbuild 7.12.3.40\n" } });
    const accepted = unwrap(accept({ home, line: 3, path: "VERSION.md", record, repo }));
    const verified = unwrap(verifyFreshCut({ home, now: NOW, projectsDir: noTranscripts(), record, source: repo }));
    expect(accepted.entry).toMatchObject({ lineNumberAtReview: 3, occurrence: 2, schemaVersion: 1 });
    expect([
      verified.verification.findings,
      verified.verification.reviewedAccepted,
      verified.reviewedUnmatched,
    ]).toEqual([[{ className: "owner-address", kind: "private-term", line: 2, path: "VERSION.md" }], 1, 0]);
    expect(unwrapErr(accept({ home, line: 3, path: "VERSION.md", record, repo })).code).toBe(
      "REVIEWED_RESIDUE_CANDIDATE_REFUSED",
    );
    expect(unwrap(accept({ home, line: 2, path: "VERSION.md", record, repo })).entry.lineNumberAtReview).toBe(2);
  });

  it("clears neither of two identical lines for an older entry from another cut, and stores no unmatched count", () => {
    const { home, record, repo } = cutOf({ files: { "VERSION.md": "intro\nbuild 7.12.3.40\nbuild 7.12.3.40\n" } });
    const older = {
      className: "owner-address",
      entryId: "5c4d3e2f-1a0b-4c9d-8e7f-6a5b4c3d2e1f",
      judgement: "not-an-address",
      lineNumberAtReview: 3,
      lineSha256: createHash("sha256").update("build 7.12.3.40").digest("hex"),
      path: "VERSION.md",
      reviewedAtIso: NOW.toISOString(),
      reviewedBySessionId: SESSION,
      reviewedRecordId: "4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d",
      reviewedTreeSha: "b".repeat(40),
      schemaVersion: 1,
    };
    mkdirSync(join(home, "fresh-cuts"), { recursive: true });
    writeFileSync(reviewedResiduePath({ home }), `${JSON.stringify(older)}\n`, { mode: 0o600 });
    const { verification, reviewedUnmatched } = unwrap(
      verifyFreshCut({ home, now: NOW, projectsDir: noTranscripts(), record, source: repo }),
    );
    expect([verification.status, verification.findings, verification.reviewedAccepted, reviewedUnmatched]).toEqual([
      "refused",
      [
        { className: "owner-address", kind: "private-term", line: 2, path: "VERSION.md" },
        { className: "owner-address", kind: "private-term", line: 3, path: "VERSION.md" },
      ],
      0,
      1,
    ]);
    const report = JSON.parse(
      readFileSync(unwrap(writeFreshCutVerification({ home, verification })), "utf8"),
    ) as Record<string, unknown>;
    expect([report["schemaVersion"], Object.keys(report).includes("reviewedUnmatched")]).toEqual([3, false]);
  });

  it("refuses a reader's owner-address judgement on a line holding only a finding of another class", () => {
    const { home, record, repo } = cutOf({ files: { "NOTES.md": "about quillfeather\n" } });
    expect(unwrapErr(accept({ home, line: 1, path: "NOTES.md", record, repo })).code).toBe(
      "REVIEWED_RESIDUE_CANDIDATE_REFUSED",
    );
  });

  it("accepts a topic line on a resolved owner anchor, storing no text, and the verify clears and says so by class", () => {
    const { home, record, repo } = cutOf({ files: { "NOTES.md": "intro\nabout quillfeather\n" } });
    const projectsDir = projectsWithOwnerTurn();
    const accepted = unwrap(
      accept({
        decision: { className: "topic", ownerAnchor: ANCHOR },
        home,
        line: 2,
        path: "NOTES.md",
        projectsDir,
        record,
        repo,
      }),
    );
    const stored = readFileSync(reviewedResiduePath({ home }), "utf8");
    expect([
      accepted.entry.schemaVersion,
      accepted.entry.className,
      Object.keys(JSON.parse(stored) as object).toSorted(),
      stored.includes("quillfeather"),
      stored.includes("those lines are fine"),
    ]).toEqual([
      2,
      "topic",
      [
        "className",
        "entryId",
        "lineNumberAtReview",
        "lineSha256",
        "ownerAnchor",
        "path",
        "reviewedAtIso",
        "reviewedBySessionId",
        "reviewedRecordId",
        "reviewedTreeSha",
        "schemaVersion",
      ],
      false,
      false,
    ]);

    const after = verificationOf({ home, now: NOW, projectsDir, record, source: repo });
    expect([
      after.status,
      after.findings,
      after.reviewedAccepted,
      after.acceptedOnAnchor.topic,
      after.schemaVersion,
    ]).toEqual(["clear", [], 1, 1, 3]);
  });

  it("refuses the whole verify when an anchored entry's owner turn no longer resolves", () => {
    const { home, record, repo } = cutOf({ files: { "NOTES.md": "about quillfeather\n" } });
    const projectsDir = projectsWithOwnerTurn();
    unwrap(
      accept({
        decision: { className: "topic", ownerAnchor: ANCHOR },
        home,
        line: 1,
        path: "NOTES.md",
        projectsDir,
        record,
        repo,
      }),
    );
    expect(verificationOf({ home, now: NOW, projectsDir, record, source: repo }).status).toBe("clear");
    const refused = unwrapErr(verifyFreshCut({ home, now: NOW, projectsDir: noTranscripts(), record, source: repo }));
    expect([refused.code, refused.message.includes("could not be read")]).toEqual([
      "REVIEWED_RESIDUE_UNREADABLE",
      true,
    ]);
  });

  it("refuses the whole verify over a hand-written anchored entry whose owner turn is not in its transcript", () => {
    const { home, record, repo } = cutOf({ files: { "NOTES.md": "about quillfeather\n" } });
    const forged = {
      className: "topic",
      entryId: "2d9a7a6e-8c0c-4f5a-9d3f-4b6c8e0a2c3d",
      lineNumberAtReview: 1,
      lineSha256: createHash("sha256").update("about quillfeather").digest("hex"),
      ownerAnchor: `transcript:${OWNER_SESSION}#${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}`,
      path: "NOTES.md",
      reviewedAtIso: NOW.toISOString(),
      reviewedBySessionId: SESSION,
      reviewedRecordId: record.recordId,
      reviewedTreeSha: record.treeSha,
      schemaVersion: 2,
    };
    mkdirSync(join(home, "fresh-cuts"), { recursive: true });
    writeFileSync(reviewedResiduePath({ home }), `${JSON.stringify(forged)}\n`, { mode: 0o600 });
    const refused = unwrapErr(
      verifyFreshCut({ home, now: NOW, projectsDir: projectsWithOwnerTurn(), record, source: repo }),
    );
    expect([refused.code, refused.message.includes(`entry ${forged.entryId} rests on an owner anchor`)]).toEqual([
      "REVIEWED_RESIDUE_UNREADABLE",
      true,
    ]);
  });

  it("refuses, and appends nothing, when the anchor names no owner turn in its transcript", () => {
    const { home, record, repo } = cutOf({ files: { "NOTES.md": "about quillfeather\n" } });
    const refused = unwrapErr(
      accept({
        decision: {
          className: "topic",
          ownerAnchor: `transcript:${OWNER_SESSION}#${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}`,
        },
        home,
        line: 1,
        path: "NOTES.md",
        projectsDir: projectsWithOwnerTurn(),
        record,
        repo,
      }),
    );
    expect([refused.code, existsSync(reviewedResiduePath({ home }))]).toEqual(["OWNER_ANCHOR_REFUSED", false]);
  });

  it("refuses, and appends nothing, when the anchor's transcript is not there to read", () => {
    const { home, record, repo } = cutOf({ files: { "NOTES.md": "about quillfeather\n" } });
    const refused = unwrapErr(
      accept({ decision: { className: "topic", ownerAnchor: ANCHOR }, home, line: 1, path: "NOTES.md", record, repo }),
    );
    expect([refused.code, existsSync(reviewedResiduePath({ home }))]).toEqual(["OWNER_ANCHOR_UNREADABLE", false]);
  });

  it("never forgives the same anchored line in another record over the same home", () => {
    const first = cutOf({ files: { "NOTES.md": "about quillfeather\n" } });
    unwrap(
      accept({
        decision: { className: "topic", ownerAnchor: ANCHOR },
        home: first.home,
        line: 1,
        path: "NOTES.md",
        projectsDir: projectsWithOwnerTurn(),
        record: first.record,
        repo: first.repo,
      }),
    );
    const other: FreshCutRecord = { ...first.record, recordId: "4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d" };
    const verification = verificationOf({
      home: first.home,
      now: NOW,
      projectsDir: noTranscripts(),
      record: other,
      source: first.repo,
    });
    expect([verification.status, verification.findings, verification.reviewedAccepted]).toEqual([
      "refused",
      [{ className: "topic", kind: "private-term", line: 1, path: "NOTES.md" }],
      0,
    ]);
  });

  it("refuses again once the accepted line changes, in a new cut over the same home", () => {
    const first = cutOf({ files: { "VERSION.md": "build 7.12.3.40\n" } });
    unwrap(accept({ home: first.home, line: 1, path: "VERSION.md", record: first.record, repo: first.repo }));
    const second = cutOf({ files: { "VERSION.md": "build 7.12.3.41\n" } });
    const list = readFileSync(reviewedResiduePath({ home: first.home }));
    mkdirSync(join(second.home, "fresh-cuts"), { recursive: true });
    writeFileSync(reviewedResiduePath({ home: second.home }), list);

    const verification = verificationOf({
      home: second.home,
      now: NOW,
      projectsDir: noTranscripts(),
      record: second.record,
      source: second.repo,
    });
    expect([verification.status, verification.findings, verification.reviewedAccepted]).toEqual([
      "refused",
      [{ className: "owner-address", kind: "private-term", line: 1, path: "VERSION.md" }],
      0,
    ]);
  });
});
