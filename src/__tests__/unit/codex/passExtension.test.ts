/*
 * The review-pass extension row: decoded strictly, so a damaged row grants nothing and says why; matched on branch,
 * repository, lane and the exact diff together, so a row for one diff never admits another; and read per run and
 * lane, which is what decides whether the next extension must name the one before it.
 */
import { describe, expect, it } from "vitest";

import {
  approvalFor,
  type CodexPassExtension,
  decodePassExtension,
  isFullSha256,
  runExtensions,
} from "../../../codex/passExtension.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const DIFF = "a".repeat(64);
const OTHER_DIFF = "b".repeat(64);

const ROW: CodexPassExtension = {
  after: undefined,
  atIso: "2026-11-27T01:00:00.000Z",
  branch: "feature",
  diffSha256: DIFF,
  gitCommonDir: "/repos/acme/.git",
  grantedBy: { host: "claude-code", id: "4c829e9d-d903-49b4-b446-6bb88b198511" },
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  lane: "general",
  reason: "the fix moved the parser",
  repoRoot: "/repos/acme",
  run: "acme-parser",
  schemaVersion: 1,
};

describe("decodePassExtension", () => {
  it("round-trips a row the verb writes", () => {
    const decoded = decodePassExtension({ value: JSON.parse(JSON.stringify(ROW)) });
    expect(decoded.isOk()).toBe(true);
    expect(unwrap(decoded)).toEqual(ROW);
  });

  it("round-trips a second row naming the one before it", () => {
    const second = { ...ROW, after: ROW.id, diffSha256: OTHER_DIFF, id: "second" };
    expect(unwrap(decodePassExtension({ value: JSON.parse(JSON.stringify(second)) }))).toEqual(second);
  });

  it("refuses another schema version", () => {
    expect(unwrapErr(decodePassExtension({ value: { ...ROW, schemaVersion: 2 } })).message).toBe(
      "schemaVersion 2 is not one this build reads",
    );
  });

  it("refuses a lane this build holds no cap for", () => {
    expect(unwrapErr(decodePassExtension({ value: { ...ROW, lane: "unbounded" } })).message).toBe(
      "lane unbounded is not a review lane",
    );
  });

  it("refuses a grantor that is no visible session", () => {
    const decoded = decodePassExtension({ value: { ...ROW, grantedBy: { host: "explicit", id: "x" } } });
    expect(unwrapErr(decoded).message).toBe("grantedBy names no visible session");
  });

  it("refuses an instant that is not strict ISO", () => {
    expect(unwrapErr(decodePassExtension({ value: { ...ROW, atIso: "yesterday" } })).message).toBe(
      "atIso is not a strict ISO instant",
    );
  });

  it("refuses a diff that is short, uppercase or absent", () => {
    const messages = [DIFF.slice(0, 12), DIFF.toUpperCase(), undefined].map(
      (diffSha256) => unwrapErr(decodePassExtension({ value: { ...ROW, diffSha256 } })).message,
    );
    expect(messages).toEqual(Array(3).fill("diffSha256 is not a full lowercase sha256"));
  });

  it("refuses an after that names nothing", () => {
    expect(unwrapErr(decodePassExtension({ value: { ...ROW, after: " " } })).message).toBe(
      "after is present and names no extension id",
    );
  });

  it("names every blank or missing field at once", () => {
    const { run: _run, ...withoutRun } = ROW;
    const failure = unwrapErr(decodePassExtension({ value: { ...withoutRun, reason: " ​ " } }));
    expect(failure.code).toBe("MISSING_FIELDS");
    expect(failure.message).toBe("missing or blank: reason, run");
  });

  it("refuses a line that is not an object", () => {
    expect(unwrapErr(decodePassExtension({ value: [ROW] })).code).toBe("NOT_AN_OBJECT");
  });
});

describe("isFullSha256", () => {
  it("accepts exactly 64 lowercase hex digits", () => {
    expect([DIFF, `${DIFF}0`, DIFF.slice(1), "g".repeat(64), 7].map((value) => isFullSha256(value))).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("approvalFor", () => {
  const rows: readonly CodexPassExtension[] = [
    { ...ROW, gitCommonDir: "/repos/elsewhere/.git", id: "other-repo" },
    { ...ROW, branch: "other", id: "other-branch" },
    { ...ROW, id: "witness", lane: "baseline-bump-witness" },
    { ...ROW, diffSha256: OTHER_DIFF, id: "other-diff" },
    ROW,
  ];

  it("finds the row naming this exact diff on this branch, repository and lane", () => {
    const found = approvalFor({
      branch: "feature",
      diffSha256: DIFF,
      gitCommonDir: "/repos/acme/.git",
      lane: "general",
      rows,
    });
    expect(found!.id).toBe(ROW.id);
  });

  it("finds nothing for a diff no row names, though the branch holds an extension", () => {
    const diffSha256 = "c".repeat(64);
    expect(
      approvalFor({ branch: "feature", diffSha256, gitCommonDir: "/repos/acme/.git", lane: "general", rows }),
    ).toBeUndefined();
  });

  it("finds nothing in another repository sharing the branch name", () => {
    const gitCommonDir = "/repos/third/.git";
    expect(approvalFor({ branch: "feature", diffSha256: DIFF, gitCommonDir, lane: "general", rows })).toBeUndefined();
  });

  it("finds nothing for an empty register", () => {
    expect(
      approvalFor({ branch: "feature", diffSha256: DIFF, gitCommonDir: "/repos/acme/.git", lane: "general", rows: [] }),
    ).toBeUndefined();
  });
});

describe("runExtensions", () => {
  const rows: readonly CodexPassExtension[] = [
    ROW,
    { ...ROW, id: "other-run", run: "acme-other" },
    { ...ROW, id: "witness", lane: "baseline-bump-witness" },
    { ...ROW, gitCommonDir: "/repos/elsewhere/.git", id: "other-repo" },
    { ...ROW, after: ROW.id, diffSha256: OTHER_DIFF, id: "second" },
  ];

  it("keeps the run's rows in this lane from every repository, oldest first, so --repo starts no fresh sequence", () => {
    const found = runExtensions({ lane: "general", rows, run: "acme-parser" });
    expect(found.map((row) => row.id)).toEqual([ROW.id, "other-repo", "second"]);
  });

  it("holds nothing for a run never extended", () => {
    expect(runExtensions({ lane: "general", rows, run: "acme-new" })).toEqual([]);
  });
});
