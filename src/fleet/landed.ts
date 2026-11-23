/**
 * What landed on main, each change beside the words of the owner that asked for it and the proof it worked — the pure
 * half of `slopweaver fleet landed`, which the console's Fleet page draws as its Past view's release history.
 *
 * The owner comes back to the machine after a while and wants to know what has landed since they last looked.
 * GitHub's twenty merged pull requests give them no confidence at a glance; a direct quote of theirs beside each one
 * does. So every entry carries three things, each saying plainly when it has nothing: the change, the owner's words,
 * and the proof.
 *
 * **The join is exact, and a miss says which step missed.** A squash commit names its pull request as a trailing
 * `(#N)`. The PR ledger keys that number, within this checkout's `origin` repository, to the branch locus it was
 * opened from; the branch is a row's slug by the default `cmux spawn` gives a run. MEASURED over 30
 * landings: 30 named a pull request, 29 had a ledger record, 28 joined a row by exact slug and 21 carried the owner's words.
 * A row whose branch is not its slug is not found by resemblance — `../handover/findingGate.ts` gives the reason
 * fuzzy matching is forbidden here — so it reads `not-joined`, naming the branch.
 *
 * **A merge licence is not the owner's words on the change.** Nearly every landing is pressed under the owner's standing
 * self-merge rule, which says they want their pull requests landed and nothing about what is in them. It is carried as
 * `under`, beside the words, never as them: drawn as words it would make every fleet finding read as asked for,
 * which the row's own risk line forbids — a change with no words of the owner behind it reads as unasked, because it was.
 *
 * Pure: git's text, ledger hits, rows and acts in; entries out. The shapes are `./landedTypes.ts`; whose words stand
 * behind a row is `./landedWords.ts`.
 */
import { err, ok, type Result } from "#lib/result.js";

import { classIdOf } from "../autonomy/classSteer.js";
import { settlingClass } from "../autonomy/query.js";
import type { LedgerForm, PrLedgerHit, PrLedgerRead } from "../outbound/github/prLedgerByNumber.js";
import type { ImageRun, Inline, ProofSlot } from "../outbound/github/types.js";
import { type LandedError, LandedErrors } from "./landedErrors.js";
import type {
  LandedActs,
  LandedClaim,
  LandedCommit,
  LandedEntry,
  LandedProof,
  LandedReads,
  LandedRow,
  LandedRowRef,
  LandedSide,
  LandedUnder,
} from "./landedTypes.js";
import { landedWordsOf } from "./landedWords.js";

/** A full commit id, as `%H` prints it. */
const SHA = /^[0-9a-f]{40}$/u;

/** A squash subject's trailing pull-request number — the LAST `(#N)`, since a title may carry its own `(INC-33)`. */
const TRAILING_PR = /^(?<title>.*) \(#(?<number>\d+)\)$/u;

/**
 * Read `git log --format=%H%x09%cI%x09%s` output. A line that is not that shape REFUSES the whole history rather
 * than being skipped, because a page that silently drops a landing reads exactly like one that had none.
 *
 * @param text the command's stdout
 * @returns the commits newest first, or the first line that did not read
 */
export function landedCommitsOf({ text }: { text: string }): Result<readonly LandedCommit[], LandedError> {
  const commits: LandedCommit[] = [];
  for (const line of text.split("\n")) {
    if (line === "") {
      continue;
    }
    const [sha, mergedIso, ...rest] = line.split("\t");
    const placed = mergedIso !== undefined && !Number.isNaN(Date.parse(mergedIso));
    if (sha === undefined || !SHA.test(sha) || !placed || rest.length === 0) {
      return err(LandedErrors.gitLineMalformed({ line }));
    }
    commits.push({ mergedIso, sha, subject: rest.join("\t") });
  }
  return ok(commits);
}

/**
 * The pull request a squash subject names, and the title without it.
 *
 * @param subject the commit's subject line
 * @returns the number and title, or `undefined` when the subject names no pull request
 */
export function prNumberOf({ subject }: { subject: string }): { number: number; title: string } | undefined {
  const groups = TRAILING_PR.exec(subject)?.groups;
  if (groups === undefined) {
    return undefined;
  }
  return { number: Number(groups["number"]), title: groups["title"]! };
}

/**
 * The head branch a ledger locus names — `owner/repo#base...head`.
 *
 * @param locus the record's branch locus
 * @returns the head branch, or `undefined` when the locus is not that shape
 */
export function branchOfLocus({ locus }: { locus: string }): string | undefined {
  const refs = locus.slice(locus.indexOf("#") + 1);
  const split = refs.indexOf("...");
  if (!locus.includes("#") || split < 0) {
    return undefined;
  }
  const head = refs.slice(split + 3);
  if (head === "") {
    return undefined;
  }
  return head;
}

/**
 * A description's runs as one line of plain text: code, emphasis and links read as their words, an image as its alt.
 *
 * @param content the runs
 * @returns the text
 */
export function contentText({ content }: { content: readonly (Inline | ImageRun)[] }): string {
  return content
    .map((run) => {
      if (run.kind === "image") {
        return `[image: ${run.alt}]`;
      }
      return run.text;
    })
    .join("")
    .trim();
}

/**
 * The proof a stored description carried.
 *
 * @param form what the ledger holds of the record's form
 * @returns the proof, or why there is none to show
 */
export function landedProofOf({ form }: { form: LedgerForm }): LandedProof {
  if (form.kind === "absent") {
    return {
      kind: "unrecorded",
      why: "the ledger records the pull request but not the description it was written from",
    };
  }
  if (form.kind === "undecodable") {
    return { kind: "unrecorded", why: `the stored description no longer reads: ${form.why}` };
  }
  const body = form.form;
  const checked = body.checks.map((check): LandedClaim => ({
    claim: contentText({ content: check }),
    detail: "",
    verdict: "proven",
  }));
  const unchecked = body.notChecked.map((item): LandedClaim => ({
    claim: contentText({ content: item.check }),
    detail: contentText({ content: item.why }),
    verdict: "gap",
  }));
  return {
    after: landedSideOf({ slot: body.solutionProof }),
    before: landedSideOf({ slot: body.problemProof }),
    claims: [...checked, ...unchecked],
    kind: "recorded",
    problem: contentText({ content: body.explainer }),
  };
}

/**
 * One proof slot as a side of the before-and-after: a screenshot says who ran it and what it proves, a reason
 * slot says why there is no screenshot. A description publishes no grade, so none is read here.
 *
 * @param slot the description's proof of the problem or of the solution
 * @returns the side as text
 */
function landedSideOf({ slot }: { slot: ProofSlot }): LandedSide {
  if (slot.kind === "screenshot") {
    return {
      evidence: `${contentText({ content: slot.proves })} ${contentText({ content: [slot.image] })}`,
      where: `a screenshot the ${slot.runBy} ran`,
    };
  }
  return { evidence: contentText({ content: slot.reason }), where: "no screenshot" };
}

/**
 * The owner's standing rule the newest act on this pull request was settled by, if one was.
 *
 * Only the NEWEST act is asked. When the owner steered that act directly, or one of their pattern words governs it, an older
 * act's rule is not what the change landed under, so the answer is `none` rather than the older rule. The subject is
 * compared case-insensitively because a landing press stores it lowercased (`landingPressRow.ts`).
 *
 * @param acts the autonomy register as read
 * @param url the pull request's address, as an act records it for a subject
 * @returns the rule, that there was none, or that the register would not say
 */
export function landedUnderOf({ acts, url }: { acts: LandedActs; url: string }): LandedUnder {
  if (acts.kind === "unread") {
    return { kind: "unread", why: acts.why };
  }
  const subject = url.toLowerCase();
  const newest = acts.acts
    .filter((act) => act.action.subject.toLowerCase() === subject)
    .toSorted((a, b) => Date.parse(b.action.doneIso) - Date.parse(a.action.doneIso))[0];
  if (newest === undefined) {
    return { kind: "none" };
  }
  const rule = settlingClass({ action: newest });
  if (rule === undefined) {
    return { kind: "none" };
  }
  return {
    actKind: newest.action.kind,
    anchor: rule.anchor,
    classId: classIdOf({ row: rule }),
    kind: "rule",
    words: rule.steer,
  };
}

/**
 * The branch a ledger hit names, which is the slug the reader looks a row up by.
 *
 * @param hit the PR ledger's record for a number, `undefined` when it holds none
 * @returns the branch, or `undefined` when there is no single record naming one
 */
export function landedBranchOf({ hit }: { hit: PrLedgerHit | undefined }): string | undefined {
  if (hit === undefined || hit.kind === "ambiguous") {
    return undefined;
  }
  return branchOfLocus({ locus: hit.locus });
}

/** An entry whose row could not be reached, saying why for both the words and the proof. */
function unjoined({
  commit,
  title,
  number,
  url,
  under,
  why,
}: {
  commit: LandedCommit;
  title: string;
  number: number | undefined;
  url: string | undefined;
  under: LandedUnder;
  why: string;
}): LandedEntry {
  return {
    branch: undefined,
    mergedIso: commit.mergedIso,
    number,
    proof: { kind: "unrecorded", why },
    row: undefined,
    sha: commit.sha,
    title,
    under,
    url,
    words: { kind: "not-joined", why },
  };
}

/** The one ledger record for a number, or why the join stops at the ledger. */
function ledgerRecordOf({
  ledger,
  number,
}: {
  ledger: PrLedgerRead;
  number: number;
}): Extract<PrLedgerHit, { kind: "one" }> | { kind: "miss"; why: string } {
  if (ledger.kind === "unreadable") {
    return { kind: "miss", why: `slopweaver's PR ledger would not list: ${ledger.why}` };
  }
  const hit = ledger.hits.get(number);
  if (hit === undefined) {
    let why = `slopweaver's PR ledger holds no record of #${String(number)}`;
    if (ledger.unread.length > 0) {
      why = `slopweaver's PR ledger holds no readable record of #${String(number)}, and ${String(ledger.unread.length)} of its files would not read`;
    }
    return { kind: "miss", why };
  }
  if (hit.kind === "ambiguous") {
    return { kind: "miss", why: `${String(hit.count)} PR-ledger records claim #${String(number)}, so none is read` };
  }
  return hit;
}

/**
 * One landed change, joined as far as the evidence goes.
 *
 * @param commit the first-parent commit
 * @param repo `owner/name` of the checkout's origin
 * @param ledger the PR ledger as read for every number in the window
 * @param row the row {@link landedBranchOf} names, read by exact slug — `undefined` when it names none
 * @param acts the autonomy register as read
 * @param reads the owner's words at a ruling's anchor, and whether a transcript turn was typed outside the chair
 * @returns the entry
 */
export function landedEntryOf({
  commit,
  repo,
  ledger,
  row,
  acts,
  reads,
}: {
  commit: LandedCommit;
  repo: string;
  ledger: PrLedgerRead;
  row: LandedRow | undefined;
  acts: LandedActs;
  reads: LandedReads;
}): LandedEntry {
  const pr = prNumberOf({ subject: commit.subject });
  if (pr === undefined) {
    return unjoined({
      commit,
      number: undefined,
      title: commit.subject,
      under: { kind: "none" },
      url: undefined,
      why: "the commit names no pull request",
    });
  }
  const url = `https://github.com/${repo}/pull/${String(pr.number)}`;
  const base = { commit, number: pr.number, title: pr.title, under: landedUnderOf({ acts, url }), url };
  const hit = ledgerRecordOf({ ledger, number: pr.number });
  if (hit.kind === "miss") {
    return unjoined({ ...base, why: hit.why });
  }
  const branch = branchOfLocus({ locus: hit.locus });
  if (branch === undefined || row === undefined) {
    return {
      ...unjoined({ ...base, why: `the ledger locus ${hit.locus} names no branch` }),
      proof: landedProofOf({ form: hit.form }),
    };
  }
  let found: LandedRowRef | undefined;
  if (row.kind === "read") {
    found = { archived: row.archived, slug: row.doc.slug };
  }
  return {
    branch,
    mergedIso: commit.mergedIso,
    number: pr.number,
    proof: landedProofOf({ form: hit.form }),
    row: found,
    sha: commit.sha,
    title: pr.title,
    under: base.under,
    url,
    words: landedWordsOf({ branch, mergedIso: commit.mergedIso, reads, row }),
  };
}
