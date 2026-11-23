/**
 * `slopweaver github reviewer list|pick` — the pure half: the list document and its rendering, and the pick
 * row a valid invocation writes. The invocation itself is `./reviewerArgs.ts`.
 *
 * `list` joins the LAST recorded `github landing` reading with the reviewer register: per open pull request,
 * who it is on the hook with (`../../../review/reviewerHook.ts`) and, when nobody usefully is, a suggested
 * reviewer (`../../../review/reviewerSuggest.ts`). `pick` records the owner's approve or decline of one suggestion
 * and SENDS NOTHING — an approve parks the ask for the owner's yes (`../../../review/reviewAskDraft.ts`), and sending
 * it stays the owner's. Reading and writing files is the run module's.
 */
import { err, ok, type Result } from "#lib/result.js";

import { prKeyOfRow, type ReviewHook, reviewHookOf } from "../../../review/reviewerHook.js";
import type { ReviewerReading, ReviewerReadingRow } from "../../../review/reviewerReading.js";
import type {
  ReviewerAskedRow,
  ReviewerPickRow,
  ReviewerReadRow,
  ReviewerRow,
} from "../../../review/reviewerRegister.js";
import { type ReviewerSuggestionSet, suggestReviewer } from "../../../review/reviewerSuggest.js";

import type { GithubReviewerPickArgs, GithubReviewerReadArgs } from "./reviewerArgs.js";
import { type GithubReviewerError, GithubReviewerErrors } from "./reviewerErrors.js";

/** One open pull request as `list` reports it. */
interface ReviewerListRow {
  readonly repoSlug: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly hook: ReviewHook;
  /** Absent when none is wanted, or no evidence names anybody. */
  readonly suggestion?: ReviewerSuggestionSet;
}

/** What `list --json` prints. */
export interface ReviewerListDocument {
  /** When this join was made. */
  readonly observedAtIso: string;
  /** The landing reading it was made over — the page says so when its own reading differs. */
  readonly readingId: string;
  readonly readingObservedAtIso: string;
  /** How many asks the register holds — a short history is a young register, never an absence of asks. */
  readonly registerAsks: number;
  readonly rows: readonly ReviewerListRow[];
  /** Slack id → name for every id a hook or a suggestion names, where anything resolved one. */
  readonly people: Readonly<Record<string, string>>;
}

/**
 * Every Slack id one row's hook and suggestion name.
 *
 * @returns the ids
 */
function idsIn({ row }: { row: ReviewerListRow }): readonly string[] {
  const ids: string[] = [];
  if (row.hook.kind === "asked") {
    ids.push(...row.hook.newest.recipients);
  }
  if (row.hook.kind === "picked") {
    ids.push(row.hook.reviewer);
  }
  if (row.suggestion !== undefined) {
    ids.push(row.suggestion.primary.reviewer, ...row.suggestion.alternatives.map((alt) => alt.reviewer));
  }
  return ids;
}

/**
 * Join the last reading with the register.
 *
 * @param reading the parsed last landing reading
 * @param readingId the reading's ledger id
 * @param readingObservedAtIso when the reading was true of GitHub
 * @param register every row the reviewer register holds
 * @param excluded Slack ids never suggested — the owner and the owner's bot
 * @param samePerson Slack id → every id of the same person, from the roster
 * @param nowIso when the join is made
 * @returns the document
 */
export function reviewerListOf({
  reading,
  readingId,
  readingObservedAtIso,
  register,
  excluded,
  samePerson,
  nowIso,
}: {
  reading: ReviewerReading;
  readingId: string;
  readingObservedAtIso: string;
  register: readonly ReviewerRow[];
  excluded: ReadonlySet<string>;
  samePerson: ReadonlyMap<string, readonly string[]>;
  nowIso: string;
}): ReviewerListDocument {
  const asks = register.filter((row): row is ReviewerAskedRow => row.kind === "asked");
  const picks = register.filter((row): row is ReviewerPickRow => row.kind === "pick");
  const rows = reading.rows.map((row: ReviewerReadingRow): ReviewerListRow => {
    const hook = reviewHookOf({ picks, row });
    const suggestion = suggestReviewer({
      asks,
      excluded,
      hook,
      logins: reading.logins,
      picks,
      row,
      samePerson,
      slackIdsForLogin: reading.slackIdsForLogin,
    });
    const base = { hook, number: row.number, repoSlug: row.repoSlug, title: row.title, url: row.url };
    if (suggestion === undefined) {
      return base;
    }
    return { ...base, suggestion };
  });
  const known = new Map<string, string>();
  for (const ask of asks) {
    for (const [id, name] of Object.entries(ask.names)) {
      known.set(id, name);
    }
  }
  for (const [id, name] of reading.people) {
    known.set(id, name);
  }
  const people: Record<string, string> = {};
  for (const id of rows.flatMap((row) => idsIn({ row }))) {
    const name = known.get(id);
    if (name !== undefined) {
      people[id] = name;
    }
  }
  return { observedAtIso: nowIso, people, readingId, readingObservedAtIso, registerAsks: asks.length, rows };
}

/**
 * A Slack id as a person: their name with the id, or the id alone.
 *
 * @returns the label
 */
function who({ id, people }: { id: string; people: Readonly<Record<string, string>> }): string {
  const name = people[id];
  if (name === undefined) {
    return id;
  }
  return `${name} (${id})`;
}

/**
 * The hook as one phrase.
 *
 * @returns the phrase
 */
function hookPhrase({ hook, people }: { hook: ReviewHook; people: Readonly<Record<string, string>> }): string {
  switch (hook.kind) {
    case "not-due":
      return `not due — ${hook.why}`;
    case "picked":
      return `picked ${who({ id: hook.reviewer, people })}, no ask seen since`;
    case "asked": {
      let again = "";
      if (hook.bump !== undefined) {
        again = ` · ask again: ${hook.bump.kind}`;
      }
      return `asked ${who({ id: hook.primary, people })} ${hook.newest.channel} ${hook.newest.atIso}${again}`;
    }
    case "nobody-asked":
      return "nobody asked in Slack yet";
    case "unknown":
      return `not known — ${hook.why}`;
    default: {
      const never: never = hook;
      return never;
    }
  }
}

/**
 * The human rendering of `list`: one line per pull request, then its suggestion when it has one.
 *
 * @returns the lines
 */
export function renderReviewerList({ document }: { document: ReviewerListDocument }): readonly string[] {
  const head = `github reviewer: ${String(document.rows.length)} open pull request(s) from reading ${document.readingId} (${document.readingObservedAtIso}); the register holds ${String(document.registerAsks)} ask(s)`;
  const lines = document.rows.flatMap((row) => {
    const line = `${row.repoSlug}#${String(row.number)}  ${hookPhrase({ hook: row.hook, people: document.people })}`;
    if (row.suggestion === undefined) {
      return [line];
    }
    const { primary } = row.suggestion;
    return [line, `    suggest ${who({ id: primary.reviewer, people: document.people })} — ${primary.basis}`];
  });
  return [head, ...lines];
}

/**
 * The row a checked `pick` writes, keyed to the reading's own slug for the pull request.
 *
 * @param args the checked invocation
 * @param row the reading row it resolved to
 * @param nowIso when it is recorded
 * @returns the pick row
 */
export function pickRowOf({
  args,
  row,
  nowIso,
}: {
  args: GithubReviewerPickArgs;
  row: ReviewerReadingRow;
  nowIso: string;
}): ReviewerPickRow {
  const base = {
    atIso: nowIso,
    bySession: args.bySession,
    kind: "pick",
    number: row.number,
    prKey: prKeyOfRow({ row }),
    repoSlug: row.repoSlug,
    reviewer: args.reviewer,
    schema: 1,
    verdict: args.verdict,
  } as const;
  if (args.feedback === undefined) {
    return base;
  }
  return { ...base, feedback: args.feedback };
}

/**
 * The one reading row `--repo` and `--number` name: the repository by owner/name or by its name alone.
 *
 * @returns the row, or why none was chosen
 */
export function pickTargetOf({
  reading,
  repo,
  number,
}: {
  reading: ReviewerReading;
  repo: string;
  number: number;
}): Result<ReviewerReadingRow, GithubReviewerError> {
  const target = `${repo}#${String(number)}`;
  const matches = reading.rows.filter(
    (row) => row.number === number && (row.repoSlug === repo || row.repoSlug.endsWith(`/${repo}`)),
  );
  const [only, second] = matches;
  if (only === undefined) {
    return err(GithubReviewerErrors.notInReading({ target }));
  }
  if (second !== undefined) {
    return err(GithubReviewerErrors.ambiguous({ target }));
  }
  return ok(only);
}

/** The message `read` names, as the Slack door returned it — the pure half needs nothing else. */
export interface ReadMessage {
  /** The conversation id, `C…`, `G…` or `D…`. */
  readonly channelId: string;
  readonly ts: string;
  readonly atIso: string;
  /** The message's own text, markup as Slack holds it (`<@U…>`, `<url|label>`). */
  readonly text: string;
  /** The text of every OTHER message in the thread it sits in, root included; empty for a lone message. */
  readonly threadTexts: readonly string[];
}

/**
 * Whether a message's text links one pull request — by its GitHub URL, as `pull/` or `issues/`, which is how
 * a Slack unfurl and a hand-typed link both spell it.
 *
 * @returns whether it does
 */
function linksPr({ text, repoSlug, number }: { text: string; repoSlug: string; number: number }): boolean {
  const n = String(number);
  const lower = text.toLowerCase();
  return [`github.com/${repoSlug}/pull/${n}`, `github.com/${repoSlug}/issues/${n}`].some((url) => {
    const needle = url.toLowerCase();
    for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + 1)) {
      if (!/\d/.test(lower.charAt(at + needle.length))) {
        return true;
      }
    }
    return false;
  });
}

/**
 * The row a checked `read` writes: the quote must be in the message's own words, and the message — or any
 * message of its thread, as the landing associates a thread — must link the pull request. Both are refusals rather than warnings, because the risk
 * the owner named is a status mention recorded as an ask, and the quote is how a later reader checks it.
 *
 * @param args the checked invocation
 * @param row the reading row it resolved to
 * @param message what the Slack door returned for `--message`
 * @param nowIso when it is recorded
 * @returns the reading row, or the refusal naming what failed
 */
export function readRowOf({
  args,
  row,
  message,
  nowIso,
}: {
  args: GithubReviewerReadArgs;
  row: ReviewerReadingRow;
  message: ReadMessage;
  nowIso: string;
}): Result<ReviewerReadRow, GithubReviewerError> {
  if (!message.text.includes(args.quote)) {
    return err(GithubReviewerErrors.quoteNotInMessage({ permalink: args.permalink }));
  }
  const target = prKeyOfRow({ row });
  const linked = [message.text, ...message.threadTexts].some((text) =>
    linksPr({ number: row.number, repoSlug: row.repoSlug, text }),
  );
  if (!linked) {
    return err(GithubReviewerErrors.doesNotLink({ permalink: args.permalink, target }));
  }
  const base = {
    atIso: message.atIso,
    bySession: args.bySession,
    channel: message.channelId,
    isDirectMessage: message.channelId.startsWith("D"),
    kind: "read",
    messageKey: `${message.channelId}:${message.ts}`,
    number: row.number,
    permalink: args.permalink,
    prKey: target,
    quote: args.quote,
    readAtIso: nowIso,
    recipients: args.recipients,
    repoSlug: row.repoSlug,
    schema: 1,
    verdict: args.verdict,
  } as const;
  if (args.why === undefined) {
    return ok(base);
  }
  return ok({ ...base, why: args.why });
}
