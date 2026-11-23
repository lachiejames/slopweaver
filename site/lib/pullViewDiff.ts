/**
 * The current-base receipt `./pullView.ts` reads out of the document, and the verdict it folds from the per-file list.
 * Split out of it.
 */

import { type Bag, bags, str, sub } from "./bag";
import { nodesOf, optionalStr } from "./pullViewFields";
import type { PullDiffOnBase, PullDiffOnBaseVerdict } from "./pullViewTypes";

const DIFF_ON_BASE_VERDICTS: ReadonlySet<string> = new Set(["on-base", "partly", "not-on-base", "unknown"]);

// The file statuses the CLI's judge answers anything but `unknown` for (`judgeFile`, src/live/github/diffOnBaseJudge.ts).
const DIFF_ON_BASE_JUDGED_STATUSES: ReadonlySet<string> = new Set(["added", "changed", "modified", "removed"]);

/** True for one of the four receipt verdicts. */
function isDiffOnBaseVerdict(value: unknown): value is PullDiffOnBaseVerdict {
  return typeof value === "string" && DIFF_ON_BASE_VERDICTS.has(value);
}

/** The CLI's fold of per-file answers: none or any unknown is unknown, all one way is that way, a mix is partly. */
function foldedVerdict({ verdicts }: { verdicts: readonly unknown[] }): PullDiffOnBaseVerdict {
  if (verdicts.length === 0 || verdicts.includes("unknown")) {
    return "unknown";
  }
  if (verdicts.every((verdict) => verdict === "on-base")) {
    return "on-base";
  }
  if (verdicts.every((verdict) => verdict === "not-on-base")) {
    return "not-on-base";
  }
  return "partly";
}

/**
 * The current-base receipt, absent as `undefined` and refused when present in a shape the CLI does not write — a
 * receipt against another branch than the pull request's own base would be a confident answer to the wrong question.
 *
 * @returns the receipt or its absence, or `{ ok: false }` when it will not read
 */
export function diffOnBaseOf({
  data,
  baseRef,
}: {
  data: Bag;
  baseRef: string;
}): { ok: true; value: PullDiffOnBase | undefined } | { ok: false } {
  if (data["diffOnBase"] === undefined) {
    // The CLI writes the receipt and its per-file list together, so a list with no receipt is not its document.
    return data["diffOnBaseFiles"] === undefined ? { ok: true, value: undefined } : { ok: false };
  }
  const receipt = sub({ bag: data, key: "diffOnBase" });
  // The CLI never checks a merged pull request: its lifecycle already says where the change is.
  const merged = data["merged"] === true || data["state"] === "MERGED";
  if (receipt === undefined || merged) {
    return { ok: false };
  }
  const verdict = receipt["verdict"];
  const ref = str({ bag: receipt, key: "baseRef" });
  // Only an `unknown` may carry no base tip: every other verdict was judged against one.
  const unreadBase = receipt["baseOid"] === null && verdict === "unknown";
  let baseOid: string | null | undefined = str({ bag: receipt, key: "baseOid" });
  if (unreadBase) {
    baseOid = null;
  }
  const checkedAtIso = str({ bag: receipt, key: "checkedAtIso" });
  const reason = optionalStr({ bag: receipt, key: "reason" });
  if (!isDiffOnBaseVerdict(verdict) || ref !== baseRef || baseOid === undefined || checkedAtIso === undefined) {
    return { ok: false };
  }
  // The page draws no per-file verdict, but a receipt without the `diffOnBaseFiles` list the CLI always writes beside
  // it is not one it wrote.
  const files = bags({ bag: data, key: "diffOnBaseFiles" });
  if (files === undefined) {
    return { ok: false };
  }
  const everyFileWritten = files.every((file) => {
    const fileReason = optionalStr({ bag: file, key: "reason" });
    // As with the receipt's own, a file carries a reason exactly when it reads unknown.
    return (
      str({ bag: file, key: "filename" }) !== undefined &&
      isDiffOnBaseVerdict(file["verdict"]) &&
      fileReason.ok &&
      (fileReason.value !== undefined) === (file["verdict"] === "unknown")
    );
  });
  if (!everyFileWritten) {
    return { ok: false };
  }
  // A receipt that read a base tip judged exactly the files the read listed, in their order, and one that never read
  // it judged none, so an answer about another file, or no answer beside a tip, is not one the CLI wrote. A file whose status the judge does not answer for reads unknown, so any other answer about one, a
  // rename's included, is not the CLI's either.
  const listed = nodesOf({ bag: data, key: "files" });
  const judgedListed =
    listed?.length === files.length &&
    listed.every((node, index) => {
      const file = files[index];
      const status = str({ bag: node, key: "status" });
      const answerable = status !== undefined && DIFF_ON_BASE_JUDGED_STATUSES.has(status);
      return (
        str({ bag: node, key: "filename" }) === str({ bag: file, key: "filename" }) &&
        (answerable || file["verdict"] === "unknown")
      );
    });
  const sameFiles = baseOid === null ? files.length === 0 : judgedListed;
  if (!sameFiles) {
    return { ok: false };
  }
  // The CLI answers only `unknown` over a list short of any count GitHub gave for it: a page after this one, the
  // connection's own total, or the pull request's changed-file count when it carries one.
  const connection = sub({ bag: data, key: "files" });
  const pageInfo = connection === undefined ? undefined : sub({ bag: connection, key: "pageInfo" });
  const changedFiles = data["changedFiles"];
  const listWhole =
    pageInfo?.["hasNextPage"] === false &&
    connection?.["totalCount"] === files.length &&
    (typeof changedFiles !== "number" || changedFiles === files.length);
  if (verdict !== "unknown" && !listWhole) {
    return { ok: false };
  }
  // A plain answer is the fold of its files' answers, so it needs at least one; only `unknown` stands on its own.
  if (verdict !== "unknown" && verdict !== foldedVerdict({ verdicts: files.map((file) => file["verdict"]) })) {
    return { ok: false };
  }
  // The CLI gives a reason exactly when it could not tell.
  if (!reason.ok) {
    return { ok: false };
  }
  const reasonFits = (reason.value !== undefined) === (verdict === "unknown");
  if (!reasonFits) {
    return { ok: false };
  }
  return { ok: true, value: { baseOid, baseRef: ref, checkedAtIso, reason: reason.value, verdict } };
}
