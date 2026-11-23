import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../admit/doorLedgerPort.js";
import {
  closeCommentWindowStartIso,
  closeHeadRefusal,
  closeIdentityRefusal,
  closeStateRefusal,
  hasCommentSince,
  parseGithubCloseArgs,
} from "../../../../cli/commands/github/closeCore.js";
import { type GithubCloseDeps, runGithubClose } from "../../../../cli/commands/github/closeRun.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { ClosePr, GithubCloseApi, RecentComment } from "../../../../outbound/github/close.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../doorLedgerFixture.js";

const HEAD = "a".repeat(40);
const PUSHED = "b".repeat(40);
const OPEN: ClosePr = {
  headSha: HEAD,
  mergedAtIso: undefined,
  number: 12,
  state: "open",
  url: "https://github.com/o/r/pull/12",
};
const CLOSED: ClosePr = { ...OPEN, state: "closed" };
const MERGED: ClosePr = { ...OPEN, mergedAtIso: "2026-08-01T00:00:00.000Z", state: "closed" };

describe("parseGithubCloseArgs", () => {
  it("requires one exact repository and pull-request number", () => {
    expect(unwrap(parseGithubCloseArgs({ rest: ["--repo", "o/r", "--number", "12", "--json"] }))).toEqual({
      dryRun: false,
      expectHead: undefined,
      home: undefined,
      json: true,
      number: 12,
      owner: "o",
      repo: "r",
      why: undefined,
    });
    expect(unwrapErr(parseGithubCloseArgs({ rest: ["--repo", "broken", "--number", "zero"] }))).toEqual([
      "--repo owner/name is required",
      "--number must be a positive whole number",
    ]);
  });

  it("carries --why, and refuses a blank one", () => {
    expect(unwrap(parseGithubCloseArgs({ rest: ["--repo", "o/r", "--number", "12", "--why", "superseded"] })).why).toBe(
      "superseded",
    );
    expect(unwrapErr(parseGithubCloseArgs({ rest: ["--repo", "o/r", "--number", "12", "--why", "  "] }))).toEqual([
      "--why must not be blank",
    ]);
  });

  it("carries a full --expect-head, and refuses an abbreviated one", () => {
    const rest = ["--repo", "o/r", "--number", "12", "--expect-head"];
    expect(unwrap(parseGithubCloseArgs({ rest: [...rest, HEAD] })).expectHead).toBe(HEAD);
    expect(unwrapErr(parseGithubCloseArgs({ rest: [...rest, "aaaaaaa"] }))).toEqual([
      "--expect-head must be a full 40-character lowercase commit sha",
    ]);
  });
});

describe("closeIdentityRefusal", () => {
  const args = unwrap(parseGithubCloseArgs({ rest: ["--repo", "o/r", "--number", "12"] }));

  it("refuses a read that answered about another pull request, or another repository", () => {
    expect(closeIdentityRefusal({ args, number: 13, url: "https://github.com/o/r/pull/13" })).toEqual({
      reason:
        "the read of https://github.com/o/r/pull/12 answered about https://github.com/o/r/pull/13 (#13) — nothing closed",
    });
    expect(closeIdentityRefusal({ args, number: 12, url: "https://github.com/o/other/pull/12" })!.reason).toContain(
      "o/other",
    );
  });

  it("refuses a read whose number disagrees with the asked url it carries", () => {
    expect(closeIdentityRefusal({ args, number: 13, url: "https://github.com/o/r/pull/12" })).toEqual({
      reason:
        "the read of https://github.com/o/r/pull/12 answered about https://github.com/o/r/pull/12 (#13) — nothing closed",
    });
  });

  it("permits the asked pull request, read case-insensitively", () => {
    expect(closeIdentityRefusal({ args, number: 12, url: "https://github.com/O/R/pull/12" })).toBeUndefined();
  });
});

describe("closeHeadRefusal", () => {
  it("refuses a live head other than the one expected, naming both", () => {
    expect(closeHeadRefusal({ expectHead: HEAD, headSha: PUSHED, number: 12 })).toEqual({
      reason: `#12 is at ${PUSHED}, not the expected head ${HEAD} — it moved`,
    });
  });

  it("permits the expected head, and any head when none was expected", () => {
    expect(closeHeadRefusal({ expectHead: HEAD, headSha: HEAD, number: 12 })).toBeUndefined();
    expect(closeHeadRefusal({ expectHead: undefined, headSha: PUSHED, number: 12 })).toBeUndefined();
  });
});

describe("closeStateRefusal", () => {
  it("names the merged state, not the plain closed one, for a merged pull request", () => {
    expect(closeStateRefusal({ mergedAtIso: "2026-08-01T00:00:00.000Z", number: 12, state: "closed" })).toEqual({
      reason: "#12 was merged at 2026-08-01T00:00:00.000Z (state: closed) — nothing to close",
    });
  });

  it("names the closed state for a pull request closed without merging", () => {
    expect(closeStateRefusal({ mergedAtIso: undefined, number: 12, state: "closed" })).toEqual({
      reason: "#12 is already closed (state: closed)",
    });
  });

  it("permits an open pull request", () => {
    expect(closeStateRefusal({ mergedAtIso: undefined, number: 12, state: "open" })).toBeUndefined();
  });
});

describe("recent-comment window", () => {
  it("keeps a comment from inside the last hour and drops one from before it", () => {
    const cutoffIso = closeCommentWindowStartIso({ nowIso: "2026-08-15T12:00:00.000Z" });
    expect(cutoffIso).toBe("2026-08-15T11:00:00.000Z");
    expect(hasCommentSince({ comments: [{ createdAtIso: "2026-08-15T11:30:00.000Z" }], cutoffIso })).toBe(true);
    expect(hasCommentSince({ comments: [{ createdAtIso: "2026-08-15T10:59:00.000Z" }], cutoffIso })).toBe(false);
    expect(hasCommentSince({ comments: [], cutoffIso })).toBe(false);
  });
});

/** A plain fake tracking every call the run makes. */
function closeApi({
  reads,
  recent,
  comments,
  closes,
}: {
  reads: ClosePr[];
  recent: readonly RecentComment[];
  comments: string[];
  closes: number[];
}): GithubCloseApi {
  return {
    close: ({ number }) => {
      closes.push(number);
      return ResultAsync.fromSafePromise(Promise.resolve(reads[reads.length - 1]!));
    },
    comment: ({ body }) => {
      comments.push(body);
      return ResultAsync.fromSafePromise(Promise.resolve(undefined));
    },
    read: () => ResultAsync.fromSafePromise(Promise.resolve(reads.shift()!)),
    recentComments: () => ResultAsync.fromSafePromise(Promise.resolve(recent)),
  };
}

function depsFor({
  home,
  reads,
  recent,
  comments,
  closes,
  out,
  diagnostic,
  doorLedger = memoryDoorLedger().port,
}: {
  home: string;
  reads: ClosePr[];
  recent: readonly RecentComment[];
  comments: string[];
  closes: number[];
  out: string[];
  diagnostic: string[];
  doorLedger?: DoorLedgerPort;
}): GithubCloseDeps {
  return {
    doorLedger,
    home: () => home,
    makeApi: () => closeApi({ closes, comments, reads, recent }),
    nowIso: () => "2026-08-15T12:00:00.000Z",
    out: (line) => out.push(line),
    token: () => "token",
    writeDiagnostic: (line) => diagnostic.push(line),
  };
}

describe("runGithubClose", () => {
  it("refuses a merged pull request, naming the merge", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-close-merged-"));
    const code = await runGithubClose({
      deps: depsFor({ closes: [], comments: [], diagnostic, home, out, reads: [MERGED], recent: [] }),
      rest: ["--repo", "o/r", "--number", "12"],
    });

    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(diagnostic).toEqual([
      "refused: #12 was merged at 2026-08-01T00:00:00.000Z (state: closed) — nothing to close",
    ]);
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a pull request already closed without merging", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-close-closed-"));
    const code = await runGithubClose({
      deps: depsFor({ closes: [], comments: [], diagnostic, home, out, reads: [CLOSED], recent: [] }),
      rest: ["--repo", "o/r", "--number", "12"],
    });

    expect(code).toBe(1);
    expect(diagnostic).toEqual(["refused: #12 is already closed (state: closed)"]);
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a silent close: open, no recent comment, no --why", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-close-silent-"));
    const code = await runGithubClose({
      deps: depsFor({ closes: [], comments: [], diagnostic, home, out, reads: [OPEN], recent: [] }),
      rest: ["--repo", "o/r", "--number", "12"],
    });

    expect(code).toBe(1);
    expect(diagnostic).toEqual([
      "refused: #12 has no comment from the last hour and no --why was given — a silent close is refused; " +
        'pass --why "…" or comment on the pull request first',
    ]);
    rmSync(home, { force: true, recursive: true });
  });

  it("dry-runs after a live read and performs no mutation", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const closes: number[] = [];
    const comments: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-close-dry-"));
    const code = await runGithubClose({
      deps: depsFor({ closes, comments, diagnostic, home, out, reads: [OPEN], recent: [] }),
      rest: ["--repo", "o/r", "--number", "12", "--why", "superseded by #13", "--dry-run"],
    });

    expect(code).toBe(0);
    expect(closes).toEqual([]);
    expect(comments).toEqual([]);
    expect(out).toEqual(["would close #12  https://github.com/o/r/pull/12"]);
    expect(diagnostic).toEqual([]);
    rmSync(home, { force: true, recursive: true });
  });

  it("closes through the door on a standing recent comment, with no --why needed", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const closes: number[] = [];
    const comments: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-close-recent-"));
    const code = await runGithubClose({
      deps: depsFor({
        closes,
        comments,
        diagnostic,
        home,
        out,
        reads: [OPEN, CLOSED],
        recent: [{ createdAtIso: "2026-08-15T11:45:00.000Z", id: 1 }],
      }),
      rest: ["--repo", "o/r", "--number", "12"],
    });

    expect(code).toBe(0);
    expect(closes).toEqual([12]);
    expect(comments).toEqual([]);
    expect(out).toEqual(["closed #12  https://github.com/o/r/pull/12"]);
    expect(diagnostic).toEqual([]);
    rmSync(home, { force: true, recursive: true });
  });

  it("closes nothing when the door's decision cannot be recorded", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const closes: number[] = [];
    const comments: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-close-unrecorded-"));
    const code = await runGithubClose({
      deps: depsFor({
        closes,
        comments,
        diagnostic,
        doorLedger: unreachableDoorLedger(),
        home,
        out,
        reads: [OPEN, OPEN, CLOSED],
        recent: [{ createdAtIso: "2026-08-15T11:45:00.000Z", id: 1 }],
      }),
      rest: ["--repo", "o/r", "--number", "12"],
    });

    expect(code).toBe(1);
    expect(closes).toEqual([]);
    expect(comments).toEqual([]);
    expect(out).toEqual([]);
    expect(diagnostic).toHaveLength(1);
    expect(diagnostic[0]).toContain("slopweaver github close not performed:");
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a pull request pushed to since its caller judged it, before any comment or close", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const closes: number[] = [];
    const comments: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-close-moved-"));
    const code = await runGithubClose({
      deps: depsFor({ closes, comments, diagnostic, home, out, reads: [{ ...OPEN, headSha: PUSHED }], recent: [] }),
      rest: ["--repo", "o/r", "--number", "12", "--why", "superseded by #13", "--expect-head", HEAD],
    });

    expect(code).toBe(1);
    expect(comments).toEqual([]);
    expect(closes).toEqual([]);
    expect(diagnostic).toEqual([`refused: #12 is at ${PUSHED}, not the expected head ${HEAD} — it moved`]);
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a read about another pull request at the same head, before any comment or close", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const closes: number[] = [];
    const comments: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-close-other-"));
    const other = { ...OPEN, number: 13, url: "https://github.com/o/r/pull/13" };
    const code = await runGithubClose({
      deps: depsFor({ closes, comments, diagnostic, home, out, reads: [other], recent: [] }),
      rest: ["--repo", "o/r", "--number", "12", "--why", "superseded by #14", "--expect-head", HEAD],
    });

    expect(code).toBe(1);
    expect(comments).toEqual([]);
    expect(closes).toEqual([]);
    expect(diagnostic).toEqual([
      "refused: the read of https://github.com/o/r/pull/12 answered about https://github.com/o/r/pull/13 (#13) — nothing closed",
    ]);
    rmSync(home, { force: true, recursive: true });
  });

  it("posts --why as the closing comment, then closes and confirms by a fresh read", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const closes: number[] = [];
    const comments: string[] = [];
    const home = mkdtempSync(join(tmpdir(), "slopweaver-close-why-"));
    const code = await runGithubClose({
      deps: depsFor({ closes, comments, diagnostic, home, out, reads: [OPEN, CLOSED], recent: [] }),
      rest: ["--repo", "o/r", "--number", "12", "--why", "superseded by #13", "--expect-head", HEAD],
    });

    expect(code).toBe(0);
    expect(comments).toEqual(["superseded by #13"]);
    expect(closes).toEqual([12]);
    expect(out).toEqual(["closed #12  https://github.com/o/r/pull/12"]);
    expect(diagnostic).toEqual([]);
    rmSync(home, { force: true, recursive: true });
  });
});
