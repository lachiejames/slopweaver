/**
 * The Queue ask whose question names only pull requests that have ENDED — the pure half of the sweep's `PR_ENDED`
 * verdict.
 *
 * ## The defect
 *
 * A card went stale: it asked whether to close a draft as superseded by another pull request when GitHub had
 * already closed the draft and merged the other, and the owner dropped it by hand. `sweep board` read it UNWITNESSED
 * (an ask declares no probe), and `../review/landingClosure.ts`, which does settle a row whose pull request ended,
 * only recognises a LANDING registration slug — so an ask about a pull request under any other slug was checked by
 * nothing. Reproduce the class: `slopweaver sweep board --verdict PR_ENDED`.
 *
 * ## Only the QUESTION names its subject, and EVERY pull request it names must have ended
 *
 * The question is `summary:`. `stillReal:`, `problem:` and `evidence:` cite pull requests as evidence — the voice
 * card's still-real line cited a merged pull request for a fix still unlanded — and an ended pull request cited as evidence
 * says nothing about whether the ask is still owed. And a question naming two ("close #A as superseded by #B") is
 * still owed while #A is open, so one open pull request keeps the row.
 *
 * ## Only a question that asks to END the pull request
 *
 * A pull request ending answers "close it?" and "land it?" and nothing else. "Should we revert the changes from #2?"
 * is still owed once #2 merges, so is a question that only mentions one in passing, and
 * so is "close #2 and revert #3?" once both end. So the WHOLE question must match
 * {@link ASKS_TO_END}, a closed grammar whose failure direction is keeping the card, which the morning seat then reads
 * (`./recheck.ts`). Its one residue: the label it admits in parentheses after a pull request link is free text, so a
 * demand written there (`#<n> (https://…/pull/<n>, revert it first)`) is read as a label.
 *
 * ## Only a row nobody is on
 *
 * The rail `closureHeldWhy` holds for landing rows, called rather than restated: a `ready` row whose run never
 * started, or finished its own cycle. An active run ends with its own seat, a `waiting-on-owner` run is a seat's
 * question that seat answers, a paused row waits on a person, and an orphaned or unreadable run is a session's to
 * judge. The automatic settle asks it again over the row as it reads at the write.
 *
 * ## `answered`, never `declined`
 *
 * A decline is the owner's, with a reason. The pull request ending is the ask answered by the world, exactly as
 * `landingClosure.ts` reasons, and the witness names the merge commit or the close instant GitHub reports.
 *
 * Pure. No I/O.
 */
import type { BoardModel } from "../handover/boardTypes.js";
import type { PrClosure } from "../live/github/prClosure.js";
import { closureHeldWhy, closureWitness } from "../review/landingClosure.js";
import { findPrLinks } from "../review/prLink.js";

/** One pull request a question names. */
export interface QuestionPullRequest {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/**
 * The key one pull request is read and looked up under — `owner/repo#number`, lowercased, since GitHub matches an
 * owner and a repository name case-insensitively.
 *
 * @param pr the pull request
 * @returns its lookup key
 */
export function pullRequestKey({ pr }: { pr: QuestionPullRequest }): string {
  return `${pr.owner}/${pr.repo}#${String(pr.number)}`.toLowerCase();
}

/**
 * A GitHub pull or issue URL in any case — owner, repository, number. Broader than the link matcher on purpose: it
 * only ever stops a settle.
 */
const URL_REFERENCE = /github\.com\/([^\s/]+)\/([^\s/]+)\/(?:pull|issues)\/(\d+)/giu;

/**
 * A pull request named by number alone: `#7`, or `PR 7` / `PRs 7` / `pull request 7` with any run of spaces,
 * `#`, `-` or `:` between any two of its words. No word boundary, so markdown emphasis (`_PR 3_`) or a joined `PR3` is still caught; a
 * false match only ever keeps a row.
 */
const BARE_REFERENCE = /(?:#|(?:prs?|pull[\s#:-]*requests?)[\s#:-]*)(\d+)/giu;

/** One pull request link, the only spelling the grammar below accepts beside a bare `#7`. */
const PR_URL = String.raw`https://github\.com/[^\s/()]+/[^\s/()]+/pull/\d+`;
/** A pull request reference, optionally followed by a parenthesised label that OPENS on a pull request link: `#<n> (https://…/pull/<n>, the backup)`. */
const PR_REF = String.raw`(?:#\d+|${PR_URL})(?:\s*\(\s*${PR_URL}(?:,(?:(?!github\.com)[^()#?])*)?\))?`;
/** The words that may sit in front of a reference: `the`, `this`, `draft`, `PR`, `pull request`. */
const PR_QUALIFIER = String.raw`(?:(?:the|this|draft|pr|pull\s+request)\s+)*`;
/** One or more references joined by commas, `and` or `or`. */
const PR_LIST = String.raw`${PR_QUALIFIER}${PR_REF}(?:(?:\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+)${PR_QUALIFIER}${PR_REF})*`;

/**
 * A question that is, WHOLE, a request to end the pull requests it names: an ending verb, the references, an
 * optional `as superseded by …`, an optional `now`, and nothing else. `Close #2 and revert #3?` does not match, nor
 * does `Land #2 now, or hold other work?`; each keeps its card for the morning seat. The one free text admitted is a
 * label inside parentheses that opens on a pull request link, the shape the stale card had.
 */
const ASKS_TO_END = new RegExp(
  String.raw`^\s*(?:should\s+(?:we|the\s+fleet)\s+)?(?:close|merge|land|abandon)\s+${PR_LIST}(?:\s+as\s+superseded\s+by\s+${PR_LIST})?(?:\s+now)?\s*\??\s*$`,
  "iu",
);

/**
 * Every pull request a live ask's question names, or none when the row is not one this check reads: not an ask, its
 * question does not ask to end one, names none, names one the link matcher did not read, or somebody is on it.
 *
 * @param model the composed row
 * @returns the pull requests to read, deduped, in the order the question names them
 */
export function questionPullRequests({ model }: { model: BoardModel }): readonly QuestionPullRequest[] {
  const question = model.doc.summary;
  if (model.doc.kind !== "ask" || question === undefined || !ASKS_TO_END.test(question)) {
    return [];
  }
  if (closureHeldWhy({ run: model.run.kind, status: model.derived.status }) !== undefined) {
    return [];
  }
  const named = findPrLinks({ haystack: question });
  const keys = new Set(named.map((pr) => pullRequestKey({ pr })));
  const numbers = new Set(named.map((pr) => pr.number));
  // Fails closed on a reference the link matcher did not read — `#7`, `PR 7`, a host in capitals — since an
  // unread pull request may be the open one the question still waits on. A URL names its repository,
  // so it must match a read one WHOLE; a bare number names none, so its number must be one read.
  const unreadUrl = [...question.matchAll(URL_REFERENCE)].some(
    (match) => !keys.has(pullRequestKey({ pr: { number: Number(match[3]), owner: match[1]!, repo: match[2]! } })),
  );
  const unreadNumber = [...question.matchAll(BARE_REFERENCE)].some((match) => !numbers.has(Number(match[1])));
  return unreadUrl || unreadNumber ? [] : named;
}

/**
 * The settle witness for a row whose every named pull request has ended, or undefined while any is open or unread.
 *
 * @param model the composed row
 * @param closures what GitHub said about each pull request this pass read, keyed by {@link pullRequestKey}
 * @returns every pull request's ending, joined, or undefined when the row is still owed or was not fully read
 */
export function endedPullRequestWitness({
  model,
  closures,
}: {
  model: BoardModel;
  closures: ReadonlyMap<string, PrClosure>;
}): string | undefined {
  const named = questionPullRequests({ model });
  if (named.length === 0) {
    return undefined;
  }
  // Keyed, so one pull request spelled twice — `/issues/` beside `/pull/`, or in another case — is one ending.
  const endings = new Map<string, string>();
  for (const pr of named) {
    const key = pullRequestKey({ pr });
    const closure = closures.get(key);
    const ending = closure === undefined ? undefined : closureWitness({ closure });
    if (ending === undefined) {
      return undefined;
    }
    endings.set(key, ending);
  }
  return [...endings.values()].join("; ");
}
