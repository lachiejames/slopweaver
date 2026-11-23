/*
 * The pull-request view's current-base receipt: whether the diff is already on the base, as `github read --files`
 * checked it, and every receipt refused whose answer its own files do not add up to.
 */

import { describe, expect, it } from "vitest";

import { type PullView, pullDiffOnBaseNotice, readPullDocument } from "../../../lib/pullView";
import { DATA, document, nodes, VIEW } from "./harness";

describe("the current-base receipt", () => {
  /**
   * The receipt `github read --files` carries, as `src/live/github/diffOnBase.ts` writes it, with the per-file list it
   * writes beside it at `diffOnBaseFiles` held here as `files`.
   */
  const RECEIPT = {
    baseOid: "99598fbdb469a1b4ec1f08f037e706f4bc79a0a2",
    baseRef: "main",
    checkedAtIso: "2026-09-29T05:00:04Z",
    files: [{ filename: "a.ts", verdict: "on-base" }],
    verdict: "on-base",
  };

  /** A whole `--files` list of these nodes: its last page, its total agreeing, as `./pullFiles.ts` writes one. */
  const wholeList = (...items: readonly object[]): unknown => ({
    ...nodes(...items),
    pageInfo: { hasNextPage: false },
    totalCount: items.length,
  });

  /** A whole `--files` list of these paths, each one changed line. */
  const listedFiles = ({ filenames }: { filenames: readonly string[] }): unknown =>
    wholeList(
      ...filenames.map((filename) => ({
        additions: 1,
        deletions: 1,
        filename,
        patch: "@@ -1 +1 @@\n-x\n+y",
        status: "modified",
      })),
    );

  /**
   * The fixture read with a receipt in place, its `files` written where the CLI writes them, over a read that listed
   * `listed` (just `a.ts` unless named), the pull request's changed-file count agreeing.
   */
  const withReceipt = ({ files, listed = ["a.ts"], ...receipt }: Record<string, unknown>): PullView | undefined =>
    readPullDocument({
      payload: document({
        ...DATA,
        changedFiles: (listed as readonly string[]).length,
        diffOnBase: receipt,
        diffOnBaseFiles: files,
        files: listedFiles({ filenames: listed as readonly string[] }),
      }),
    });

  it("reads the receipt, keeping the whole tip and its own check instant", () => {
    expect(withReceipt(RECEIPT)!.diffOnBase).toEqual({
      baseOid: "99598fbdb469a1b4ec1f08f037e706f4bc79a0a2",
      baseRef: "main",
      checkedAtIso: "2026-09-29T05:00:04Z",
      reason: undefined,
      verdict: "on-base",
    });
  });

  it("says every change is already on the base, against the tip and the instant the base was checked", () => {
    expect(pullDiffOnBaseNotice({ view: withReceipt(RECEIPT)! })).toEqual({
      receipt: { checkedAtIso: "2026-09-29T05:00:04Z", shortOid: "99598fb" },
      text: "Every change in this diff is already on main. The diff below is against the branch's old merge base",
      tone: "success",
    });
  });

  it("says partly, not yet, and why it could not tell", () => {
    const partlyFiles = [
      { filename: "a.ts", verdict: "on-base" },
      { filename: "b.ts", verdict: "not-on-base" },
    ];
    const notFiles = [{ filename: "a.ts", verdict: "not-on-base" }];
    const partly = pullDiffOnBaseNotice({
      view: withReceipt({ ...RECEIPT, files: partlyFiles, listed: ["a.ts", "b.ts"], verdict: "partly" })!,
    });
    const not = pullDiffOnBaseNotice({ view: withReceipt({ ...RECEIPT, files: notFiles, verdict: "not-on-base" })! });
    const unknown = pullDiffOnBaseNotice({
      view: withReceipt({ ...RECEIPT, reason: "yarn.lock: GitHub cut the base's copy short", verdict: "unknown" })!,
    });

    expect([partly!.tone, partly!.text]).toEqual(["warning", "Some of this diff is already on main, not all of it"]);
    expect([not!.tone, not!.text]).toEqual(["muted", "This diff is not on main yet"]);
    expect(unknown!.text).toBe(
      "Could not tell whether this diff is already on main (yarn.lock: GitHub cut the base's copy short)",
    );
  });

  it("says a read without the receipt was not checked, and says nothing for a merged pull request", () => {
    expect(pullDiffOnBaseNotice({ view: VIEW })).toEqual({
      receipt: undefined,
      text: "Not checked whether this diff is already on main. This read predates that check",
      tone: "muted",
    });
    const merged = readPullDocument({ payload: document({ ...DATA, state: "MERGED" }) })!;
    expect(pullDiffOnBaseNotice({ view: merged })).toBeUndefined();
  });

  it("says why it could not tell, naming no tip, when the check never read the base", () => {
    const view = withReceipt({
      ...RECEIPT,
      baseOid: null,
      files: [],
      reason: "GitHub did not answer the check: GitHub said 502",
      verdict: "unknown",
    })!;

    expect(pullDiffOnBaseNotice({ view })).toEqual({
      receipt: undefined,
      text: "Could not tell whether this diff is already on main (GitHub did not answer the check: GitHub said 502)",
      tone: "muted",
    });
  });

  it("refuses a receipt against another branch, or with a verdict or tip it does not know", () => {
    expect(withReceipt({ ...RECEIPT, baseOid: null })).toBeUndefined();
    expect(withReceipt({ ...RECEIPT, files: "not-an-array" })).toBeUndefined();
    expect(withReceipt({ ...RECEIPT, files: [null] })).toBeUndefined();
    expect(withReceipt({ ...RECEIPT, files: [{ filename: "a.ts", verdict: "probably" }] })).toBeUndefined();
    expect(withReceipt({ ...RECEIPT, files: [{ filename: "a.ts", reason: 7, verdict: "unknown" }] })).toBeUndefined();
    expect(withReceipt({ ...RECEIPT, baseRef: "staging" })).toBeUndefined();
    expect(withReceipt({ ...RECEIPT, verdict: "probably" })).toBeUndefined();
    expect(withReceipt({ ...RECEIPT, baseOid: 7 })).toBeUndefined();
    expect(readPullDocument({ payload: document({ ...DATA, diffOnBase: "on-base" }) })).toBeUndefined();
  });

  it("refuses a receipt on a merged pull request, which the CLI never checks", () => {
    const { files, ...bare } = RECEIPT;

    const merged = { ...DATA, merged: true, state: "MERGED" };
    // The same merged read without the receipt is one the page accepts, so the refusal is the receipt's alone.
    expect(readPullDocument({ payload: document(merged) })!.diffOnBase).toBeUndefined();
    expect(
      readPullDocument({ payload: document({ ...merged, diffOnBase: bare, diffOnBaseFiles: files }) }),
    ).toBeUndefined();
  });

  it("refuses a per-file list with no receipt, and a receipt with no per-file list", () => {
    const { files: _files, ...bare } = RECEIPT;

    expect(readPullDocument({ payload: document({ ...DATA, diffOnBaseFiles: RECEIPT.files }) })).toBeUndefined();
    expect(readPullDocument({ payload: document({ ...DATA, diffOnBase: bare }) })).toBeUndefined();
  });

  it("refuses a plain answer its own files do not add up to, an empty list included", () => {
    const notOnBase = [{ filename: "a.ts", verdict: "not-on-base" }];

    expect(withReceipt({ ...RECEIPT, files: [] })).toBeUndefined();
    expect(withReceipt({ ...RECEIPT, files: notOnBase })).toBeUndefined();
    expect(withReceipt({ ...RECEIPT, files: notOnBase, verdict: "partly" })).toBeUndefined();
    expect(withReceipt({ ...RECEIPT, verdict: "not-on-base" })).toBeUndefined();
  });

  it("refuses a reason on a plain answer, none on an unknown, and judged files without a base", () => {
    expect(withReceipt({ ...RECEIPT, reason: "x" })).toBeUndefined();
    expect(withReceipt({ ...RECEIPT, verdict: "unknown" })).toBeUndefined();
    expect(withReceipt({ ...RECEIPT, baseOid: null, reason: "x", verdict: "unknown" })).toBeUndefined();
  });

  it("refuses a file's reason on a plain answer, and an unknown file with none", () => {
    const unknown = { reason: "x", verdict: "unknown" };

    expect(
      withReceipt({ ...RECEIPT, files: [{ filename: "a.ts", reason: "bogus", verdict: "on-base" }] }),
    ).toBeUndefined();
    expect(withReceipt({ ...RECEIPT, ...unknown, files: [{ filename: "a.ts", verdict: "unknown" }] })).toBeUndefined();
    const kept = withReceipt({
      ...RECEIPT,
      ...unknown,
      files: [{ filename: "a.ts", reason: "y", verdict: "unknown" }],
    });
    expect(kept!.diffOnBase!.reason).toBe("x");
  });

  it("refuses answers about other files than the read listed, or in another order", () => {
    const both = [
      { filename: "a.ts", verdict: "on-base" },
      { filename: "b.ts", verdict: "on-base" },
    ];

    expect(withReceipt({ ...RECEIPT, files: [{ filename: "b.ts", verdict: "on-base" }] })).toBeUndefined();
    expect(withReceipt({ ...RECEIPT, files: both })).toBeUndefined();
    expect(withReceipt({ ...RECEIPT, files: both, listed: ["b.ts", "a.ts"] })).toBeUndefined();
    expect(withReceipt({ ...RECEIPT, files: both, listed: ["a.ts", "b.ts"] })!.diffOnBase!.verdict).toBe("on-base");
  });

  it("refuses an unknown that read a base tip yet judged none of the listed files", () => {
    const unknown = { ...RECEIPT, reason: "x", verdict: "unknown" };

    expect(withReceipt({ ...unknown, files: [] })).toBeUndefined();
    expect(withReceipt({ ...unknown, baseOid: null, files: [] })!.diffOnBase!.baseOid).toBeNull();
  });

  it("refuses any answer but unknown about a file whose status the judge does not answer for", () => {
    const { files: _files, ...bare } = RECEIPT;
    const renamed = ({ verdict, ...reason }: { verdict: string; reason?: string }): PullView | undefined =>
      readPullDocument({
        payload: document({
          ...DATA,
          changedFiles: 1,
          diffOnBase: { ...bare, ...reason, verdict },
          diffOnBaseFiles: [{ filename: "new.ts", ...reason, verdict }],
          files: wholeList({
            additions: 1,
            deletions: 1,
            filename: "new.ts",
            patch: "@@ -1 +1 @@\n-x\n+y",
            previous_filename: "old.ts",
            status: "renamed",
          }),
        }),
      });

    expect(renamed({ verdict: "on-base" })).toBeUndefined();
    expect(renamed({ verdict: "not-on-base" })).toBeUndefined();
    expect(renamed({ reason: "GitHub calls it renamed", verdict: "unknown" })!.diffOnBase!.verdict).toBe("unknown");
  });

  it("refuses any answer but unknown over a list short of a count GitHub gave for it", () => {
    const { files, ...bare } = RECEIPT;
    const over = ({ list, changedFiles = 1 }: { list: object; changedFiles?: number }): PullView | undefined =>
      readPullDocument({
        payload: document({ ...DATA, changedFiles, diffOnBase: bare, diffOnBaseFiles: files, files: list }),
      });
    const node = { additions: 1, deletions: 1, filename: "a.ts", patch: "@@ -1 +1 @@\n-x\n+y", status: "modified" };

    expect(over({ list: { ...nodes(node), pageInfo: { hasNextPage: true }, totalCount: 1 } })).toBeUndefined();
    expect(over({ list: { ...nodes(node), pageInfo: { hasNextPage: false }, totalCount: 2 } })).toBeUndefined();
    const whole = { ...nodes(node), pageInfo: { hasNextPage: false }, totalCount: 1 };
    expect(over({ changedFiles: 101, list: whole })).toBeUndefined();
    expect(over({ list: whole })!.diffOnBase!.verdict).toBe("on-base");
  });
});
