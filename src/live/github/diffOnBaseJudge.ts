/**
 * Whether a pull request's diff is already on its base branch's CURRENT tip — the pure half of `./diffOnBase.ts`.
 *
 * GitHub draws a pull request's diff against its merge base, which stops moving the moment the branch stops being
 * rebased. So a change that reached the base another way (a squash of a sibling, a cherry-pick, someone writing the
 * same line) still reads as an open +1/−1. MEASURED: an acme/acme-admin pull request showed exactly that while
 * staging had held its one line since an earlier merge, and the console page drawing the +1/−1 made a true "it is
 * already in" read as a lie. This judges each hunk of GitHub's own patch against the base tip's file text instead.
 *
 * It is CONSERVATIVE on purpose, because "already in" is the claim it licenses. A hunk is on the base only when its
 * whole post-image (context and added lines, in order) appears exactly once, both on the base and in the pull
 * request's own head copy, there at the line the hunk's header names (else a copy already standing on the base could
 * be passed off as it, or the patch is not the pull request's file), its pre-image appears
 * nowhere outside that one place, and no line it deletes survives outside it; on-base hunks must also sit in the
 * patch's own order. A hunk with no post-image (a context-free deletion) is landed only when no line it deletes is
 * left on the base or in the head's own copy. A hunk with no pre-image at all (a context-free insertion) names no place to check, so it is
 * `unknown`. Anything else that is not a clear "still to land" — a context that drifted, a repeated block, a binary
 * or truncated file, a rename — is `unknown`, never a guess. Whitespace inside a line is significant; only the line ending (CRLF or LF) is normalised, and only where the base and the head end every line the same way.
 *
 * The one thing it TRUSTS: that GitHub's account of its own diff is whole — every changed file listed, and each patch
 * the whole diff of the head blob it names against the merge base. Every hunk is checked against that head copy, a
 * patch whose headers cannot describe one file's edit is refused, and a list short of any count GitHub gave for it is
 * partial; but a file or hunk GitHub silently left out, with every count agreeing, could only be caught by diffing the
 * merge base's tree ourselves, which this does not. Each patch is bound to the head by its blob
 * oid, so this trusts GitHub's own diff of a blob it served, not a copy that could have drifted.
 *
 * What it does NOT close, by construction: it matches by CONTENT, and a base tip moved by other commits has no line
 * numbers to hold it to. So a hunk whose own site on the base was rewritten (a context line edited away) while an
 * unrelated block elsewhere on the base already reads exactly as its whole post-image is called on-base.
 * Telling that block apart from a landed change needs the base's history — which commit put the block there — and this
 * reads only the tip. A patch's three lines of context make an accidental whole-post-image twin rare.
 *
 * Nor does it bind the file list to the base tip it judges against: GitHub diffed the list against the merge base
 * as the base stood at that read, and the tip is read a moment later. A base that only moved FORWARD in between
 * keeps that merge base, so the list still holds; one FORCE-MOVED off it in that window (which a protected base
 * branch refuses) leaves a list against a merge base the new tip no longer shares. Closing it needs the
 * merge base itself, which neither read returns.
 *
 * Reading a patch and a file into the lines compared here is `./diffOnBaseLines.ts`; judging one hunk of it is
 * `./diffOnBaseHunk.ts`.
 */

import { judgeHunk } from "./diffOnBaseHunk.js";
import { lineEndingOf, linesOf, parsePatch } from "./diffOnBaseLines.js";

/** The four answers, file by file and for the whole pull request. */
export type DiffOnBaseVerdict = "on-base" | "partly" | "not-on-base" | "unknown";

/** One changed file's answer, and why when it is not a plain yes or no. */
export interface DiffOnBaseFileVerdict {
  readonly filename: string;
  readonly verdict: DiffOnBaseVerdict;
  readonly reason?: string;
}

/** What the base tip holds at one path. */
export type BaseFileSnapshot =
  | { readonly kind: "missing" }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "unread"; readonly reason: string };

/** One changed file as GitHub's file list wrote it, with what the base tip holds at its path. */
export interface DiffOnBaseFileInput {
  readonly filename: string;
  /** `added`, `removed`, `modified`, `renamed`, `copied`, `changed` or `unchanged`, as GitHub writes it. */
  readonly status: string;
  /** GitHub's patch; `undefined` for a binary file or one too large for GitHub to diff. */
  readonly patch: string | undefined;
  readonly base: BaseFileSnapshot;
  /** What the pull request's own head holds at the path, read in the same query. */
  readonly head: BaseFileSnapshot;
}

/** The whole pull request's answer. */
export interface DiffOnBaseJudgement {
  readonly verdict: DiffOnBaseVerdict;
  readonly files: readonly DiffOnBaseFileVerdict[];
  /** The first thing that kept the answer from a plain yes or no, prefixed with its file; absent when nothing did. */
  readonly reason?: string;
}

/** Fold several answers into one: all one way is that way, a mix of yes and no is partly, any unknown is unknown. */
function fold({ verdicts }: { verdicts: readonly DiffOnBaseVerdict[] }): DiffOnBaseVerdict {
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

/** A file's answer with no reason, or with one. */
function answer({
  filename,
  verdict,
  reason,
}: {
  filename: string;
  verdict: DiffOnBaseVerdict;
  reason?: string;
}): DiffOnBaseFileVerdict {
  if (reason === undefined) {
    return { filename, verdict };
  }
  return { filename, reason, verdict };
}

/** Judge a modified file hunk by hunk, holding the on-base hunks to the patch's own order. */
function judgeModified({
  filename,
  patch,
  text,
  headText,
}: {
  filename: string;
  patch: string;
  text: string;
  headText: string;
}): DiffOnBaseFileVerdict {
  const hunks = parsePatch({ patch });
  if (hunks === undefined || hunks.length === 0) {
    return answer({ filename, reason: "GitHub's patch for it did not parse", verdict: "unknown" });
  }
  const base = linesOf({ text });
  const head = linesOf({ text: headText });
  const answers = hunks.map((hunk) => judgeHunk({ base, head, hunk }));
  let previousEnd = 0;
  for (const one of answers) {
    if (one.at !== undefined) {
      if (one.at.start < previousEnd) {
        return answer({ filename, reason: "its changes sit in a different order on the base", verdict: "unknown" });
      }
      previousEnd = one.at.end;
    }
  }
  const verdict = fold({ verdicts: answers.map((one) => one.verdict) });
  const firstReason = answers.find((one) => one.reason !== undefined)?.reason;
  if (verdict === "unknown" && firstReason !== undefined) {
    return answer({ filename, reason: firstReason, verdict });
  }
  return answer({ filename, verdict });
}

/** Judge a file GitHub says the pull request added: the base must hold it with exactly the patch's lines. */
function judgeAdded({
  filename,
  patch,
  text,
  headText,
}: {
  filename: string;
  patch: string;
  text: string;
  headText: string;
}): DiffOnBaseFileVerdict {
  const hunks = parsePatch({ patch });
  const only = hunks?.length === 1 ? hunks[0] : undefined;
  // A whole new file is git's one shape, `@@ -0,0 +1,N @@`: nothing before it, starting at line one.
  if (only?.pre.length !== 0 || only.oldStart !== 0 || only.newStart !== 1) {
    return answer({ filename, reason: "GitHub's patch for it is not one whole new file", verdict: "unknown" });
  }
  const isPost = ({ lines }: { lines: readonly string[] }): boolean =>
    lines.length === only.post.length && lines.every((line, index) => line === only.post[index]);
  // The patch is only GitHub's account of the head, so the head's own copy must say the same.
  if (!isPost({ lines: linesOf({ text: headText }) })) {
    return answer({ filename, reason: "GitHub's patch for it is not the pull request's own copy", verdict: "unknown" });
  }
  if (isPost({ lines: linesOf({ text }) })) {
    return answer({ filename, verdict: "on-base" });
  }
  return answer({ filename, reason: "the base has a different file at that path", verdict: "unknown" });
}

/** Judge a removed file: landed when the base no longer has the path, still to land when it does. */
function judgeRemoved({ input }: { input: DiffOnBaseFileInput }): DiffOnBaseFileVerdict {
  const { filename, base, head, patch } = input;
  if (patch !== undefined) {
    const hunks = parsePatch({ patch });
    // An empty file's deletion is the one with no hunk at all; the verdict below asks only whether the path is gone
    // from both sides, which holds whatever the file held.
    const wholeDeletion =
      hunks !== undefined &&
      hunks.length <= 1 &&
      hunks.every((hunk) => hunk.post.length === 0 && hunk.oldStart === 1 && hunk.newStart === 0);
    if (!wholeDeletion) {
      return answer({ filename, reason: "GitHub's patch for it is not one whole deleted file", verdict: "unknown" });
    }
  }
  if (head.kind !== "missing") {
    return answer({ filename, reason: "the pull request's own head still has the file", verdict: "unknown" });
  }
  return answer({ filename, verdict: base.kind === "missing" ? "on-base" : "not-on-base" });
}

/**
 * True when the base and the head do not end every line the same way. Normalised lines compare equal only where the
 * bytes do when both sides end every line alike, so a line `b` on the base and `b\r` in the head is not taken for one
 * change already landed.
 */
function endLinesDifferently({ baseText, headText }: { baseText: string; headText: string }): boolean {
  const baseEnding = lineEndingOf({ text: baseText });
  const headEnding = lineEndingOf({ text: headText });
  if (baseEnding === "mixed" || headEnding === "mixed") {
    return true;
  }
  const oneSideUnbroken = baseEnding === "none" || headEnding === "none";
  return !oneSideUnbroken && baseEnding !== headEnding;
}

/** Judge one changed file. */
function judgeFile({ input }: { input: DiffOnBaseFileInput }): DiffOnBaseFileVerdict {
  const { filename, status, base, patch } = input;
  // A removal asks only whether the path is still there, so an entry whose contents did not read still counts — but
  // a patch it does carry must be git's whole-file deletion, `@@ -1,N +0,0 @@`, or nothing.
  if (status === "removed") {
    return judgeRemoved({ input });
  }
  if (status !== "modified" && status !== "changed" && status !== "added") {
    return answer({
      filename,
      reason: `GitHub calls it ${status}, which this check does not judge`,
      verdict: "unknown",
    });
  }
  if (patch === undefined) {
    return answer({ filename, reason: "GitHub gave no patch for it (binary, or too large)", verdict: "unknown" });
  }
  if (base.kind === "unread") {
    return answer({ filename, reason: base.reason, verdict: "unknown" });
  }
  if (base.kind === "missing") {
    if (status === "added") {
      return answer({ filename, verdict: "not-on-base" });
    }
    return answer({ filename, reason: "the base no longer has the file", verdict: "unknown" });
  }
  const { head } = input;
  if (head.kind === "unread") {
    return answer({ filename, reason: head.reason, verdict: "unknown" });
  }
  if (head.kind === "missing") {
    return answer({ filename, reason: "the pull request's own head has no such file", verdict: "unknown" });
  }
  if (endLinesDifferently({ baseText: base.text, headText: head.text })) {
    return answer({ filename, reason: "the base and the head end its lines differently", verdict: "unknown" });
  }
  if (status === "added") {
    return judgeAdded({ filename, headText: head.text, patch, text: base.text });
  }
  return judgeModified({ filename, headText: head.text, patch, text: base.text });
}

/**
 * Judge whether every change in a pull request's diff is already on its base branch's current tip.
 *
 * @param files each changed file GitHub listed, with what the base tip holds at its path
 * @param fileListComplete false when GitHub's file list was cut short of the pull request's own changed-file count
 * @param headMoved true when the head moved between reading the patches and reading the base, so they may not match
 * @returns the whole pull request's verdict, each file's, and the first reason the answer is not a plain yes or no
 */
export function judgeDiffOnBase({
  files,
  fileListComplete,
  headMoved,
}: {
  files: readonly DiffOnBaseFileInput[];
  fileListComplete: boolean;
  headMoved: boolean;
}): DiffOnBaseJudgement {
  const judged = files.map((input) => judgeFile({ input }));
  if (headMoved) {
    return { files: judged, reason: "the head moved while it was read — read it again", verdict: "unknown" };
  }
  if (!fileListComplete) {
    return { files: judged, reason: "GitHub listed only part of its changed files", verdict: "unknown" };
  }
  if (files.length === 0) {
    return { files: judged, reason: "the pull request reports no changed files", verdict: "unknown" };
  }
  const verdict = fold({ verdicts: judged.map((one) => one.verdict) });
  const limiting = judged.find((one) => one.reason !== undefined);
  if (verdict !== "unknown" || limiting?.reason === undefined) {
    return { files: judged, verdict };
  }
  return { files: judged, reason: `${limiting.filename}: ${limiting.reason}`, verdict };
}
