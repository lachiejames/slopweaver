/**
 * The reads `github pr reviewers` derives from: a moved pull request is caught on every field the table rests
 * on, and a file list short of the reported count is refused rather than derived.
 */
import { describe, expect, it } from "vitest";
import { type PrReviewersFacts, prReviewersFactsOf } from "../../../../../cli/commands/github/prReviewersCore.js";
import {
  changedFiles,
  changedPaths,
  describeMovedSince,
  movedSince,
  type PrAt,
} from "../../../../../cli/commands/github/prReviewersReads.js";
import { ok } from "../../../../../lib/result.js";
import type { GithubReadRest } from "../../../../../live/github/read.js";

const FIRST: PrReviewersFacts = {
  authorLogin: "ada",
  base: "staging",
  baseSha: "c".repeat(40),
  body: "",
  changedFiles: 2,
  headSha: "a".repeat(40),
  open: true,
};

/** A pull request whose compare lists `files`, recording each route asked. */
function at({ files }: { files: readonly string[] }): { at: PrAt; asked: string[] } {
  const asked: string[] = [];
  const rest: GithubReadRest = async ({ route }) => {
    asked.push(route);
    return ok({ data: { files: files.map((filename) => ({ filename })) } });
  };
  return { asked, at: { number: 7, owner: "o", repo: "r", rest } };
}

describe("prReviewersFactsOf", () => {
  /** A pull request response reporting `changed` files. */
  const response = ({ changed, state = "open" }: { changed: number; state?: unknown }): unknown => ({
    data: {
      base: { ref: "staging", sha: FIRST.baseSha },
      body: null,
      changed_files: changed,
      head: { sha: FIRST.headSha },
      state,
      user: { login: "ada" },
    },
  });

  it("reads a whole file count, and a null body as an empty one", () => {
    expect(prReviewersFactsOf({ response: response({ changed: 2 }) })).toEqual(FIRST);
  });

  it("reads a closed pull request as not open, and refuses one reporting no state", () => {
    expect(prReviewersFactsOf({ response: response({ changed: 2, state: "closed" }) })).toEqual({
      ...FIRST,
      open: false,
    });
    expect(prReviewersFactsOf({ response: response({ changed: 2, state: null }) })).toBe(undefined);
  });

  it("refuses a file count that is not a whole number from zero up", () => {
    const counts = [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY];
    expect(counts.map((changed) => prReviewersFactsOf({ response: response({ changed }) }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("movedSince", () => {
  it("holds the same pull request still", () => {
    expect(movedSince({ first: FIRST, now: { ...FIRST, body: "edited" } })).toBe(false);
  });

  it("catches a moved head, base branch or base commit, a close, and a re-read that failed", () => {
    const moves = [
      { ...FIRST, headSha: "b".repeat(40) },
      { ...FIRST, base: "main" },
      { ...FIRST, baseSha: "d".repeat(40) },
      { ...FIRST, open: false },
      "404 Not Found",
    ];
    expect(moves.map((now) => movedSince({ first: FIRST, now }))).toEqual([true, true, true, true, true]);
  });

  it("catches a moved changed-file count", () => {
    expect(movedSince({ first: FIRST, now: { ...FIRST, changedFiles: 3 } })).toBe(true);
  });
});

describe("describeMovedSince", () => {
  const describeNow = (over: Partial<PrReviewersFacts>): string | undefined =>
    describeMovedSince({ first: FIRST, now: { ...FIRST, ...over } });

  it("says nothing moved for the same pull request, whatever its body", () => {
    expect(describeNow({ ...FIRST, body: "edited" })).toBe(undefined);
  });

  it("names the head alone when only the head moved", () => {
    expect(describeNow({ ...FIRST, headSha: "b".repeat(40) })).toBe("head aaaaaaaaa -> bbbbbbbbb");
  });

  it("names the base commit alone when only the base commit moved", () => {
    expect(describeNow({ ...FIRST, baseSha: "d".repeat(40) })).toBe("base commit ccccccccc -> ddddddddd");
  });

  it("names the base branch alone when only the branch moved", () => {
    expect(describeNow({ ...FIRST, base: "main" })).toBe("base branch staging -> main");
  });

  it("names both sides when both moved, head first", () => {
    expect(describeNow({ ...FIRST, baseSha: "d".repeat(40), headSha: "b".repeat(40) })).toBe(
      "head aaaaaaaaa -> bbbbbbbbb; base commit ccccccccc -> ddddddddd",
    );
  });

  it("names a changed-file count, a close and a reopen", () => {
    expect(describeNow({ ...FIRST, changedFiles: 3 })).toBe("changed files 2 -> 3");
    expect(describeNow({ ...FIRST, open: false })).toBe("state open -> closed");
    expect(describeMovedSince({ first: { ...FIRST, open: false }, now: FIRST })).toBe("state closed -> open");
  });

  it("names a re-read that failed rather than a move", () => {
    expect(describeMovedSince({ first: FIRST, now: "404 Not Found" })).toBe("re-read failed: 404 Not Found");
  });
});

describe("changedPaths", () => {
  it("reads every path from the compare of the reported commits", async () => {
    const seam = at({ files: ["a.ts", "b.ts"] });
    expect(await changedPaths({ at: seam.at, facts: FIRST })).toEqual(["a.ts", "b.ts"]);
    expect(seam.asked).toEqual(["GET /repos/{owner}/{repo}/compare/{basehead}"]);
  });

  it("refuses a list short of the count the pull request reported", async () => {
    const seam = at({ files: ["a.ts"] });
    expect(await changedPaths({ at: seam.at, facts: FIRST })).toBe(
      "GitHub listed 1 of the 2 changed files, and a table over part of a diff misleads every row",
    );
  });
});

describe("changedFiles", () => {
  /** A pull request answering its compare, and each 100-file page of its own list, from `listed`; every request recorded. */
  const counted = ({ listed }: { listed: readonly unknown[] }) => {
    const asked: string[] = [];
    const rest: GithubReadRest = async ({ route, params }) => {
      asked.push(`${route} page ${String(params["page"])}`);
      if (route.endsWith("/compare/{basehead}")) {
        return ok({ data: { files: listed } });
      }
      const page = Number(params["page"]);
      return ok({ data: listed.slice((page - 1) * 100, page * 100) });
    };
    return { asked, at: { number: 7, owner: "o", repo: "r", rest } satisfies PrAt };
  };
  const files = ({ count }: { count: number }) =>
    Array.from({ length: count }, (_, index) => ({ additions: index, deletions: 1, filename: `f${String(index)}.ts` }));

  it("reads every file with its line counts from the compare, one request, up to 300 files", async () => {
    const { asked, at: pr } = counted({ listed: files({ count: 101 }) });
    const read = await changedFiles({ at: pr, facts: { ...FIRST, changedFiles: 101 } });
    expect(Array.isArray(read)).toBe(true);
    expect((read as readonly unknown[]).length).toBe(101);
    expect(asked.length).toBe(1);
  });

  it("pages the pull request's own list past 300 files", async () => {
    const { asked, at: pr } = counted({ listed: files({ count: 301 }) });
    const read = await changedFiles({ at: pr, facts: { ...FIRST, changedFiles: 301 } });
    expect(Array.isArray(read)).toBe(true);
    expect((read as readonly unknown[]).at(-1)).toEqual({ additions: 300, deletions: 1, path: "f300.ts" });
    expect(asked.length).toBe(4);
  });

  it("refuses an entry whose line count is not a whole number", async () => {
    const { at: pr } = counted({ listed: [{ additions: 1.5, deletions: 0, filename: "a.ts" }] });
    expect(await changedFiles({ at: pr, facts: { ...FIRST, changedFiles: 1 } })).toBe(
      `the compare of ${FIRST.headSha.slice(0, 9)} is not a file list`,
    );
  });

  it("carries a renamed file's base-side path, which a slice matches as well", async () => {
    const renamed = { additions: 2, deletions: 1, filename: "public/key.ts", previous_filename: "secure/key.ts" };
    const { at: pr } = counted({ listed: [renamed] });
    expect(await changedFiles({ at: pr, facts: { ...FIRST, changedFiles: 1 } })).toStrictEqual([
      { additions: 2, deletions: 1, path: "public/key.ts", previousPath: "secure/key.ts" },
    ]);
  });

  it("refuses an entry with an empty path, which a bare * rule would otherwise count as the owner's", async () => {
    const { at: pr } = counted({ listed: [{ additions: 1, deletions: 0, filename: "" }] });
    expect(await changedFiles({ at: pr, facts: { ...FIRST, changedFiles: 1 } })).toBe(
      `the compare of ${FIRST.headSha.slice(0, 9)} is not a file list`,
    );
  });
});
