/**
 * The discuss-first nudge as `talk relay` carries it: when the voice put the question "did you actually discuss this
 * first?" on a fix the owner asked for on a TEAM repository, the row and the chair's line open on a hold, so no fix
 * starts before their answer; when their next words on it arrive, they open on that instead, and the ask stands.
 *
 * The owner wants a nudge before a fix is raised on a team repository, in case it was not discussed first, and an
 * explicit ask from the owner overrides pretty much anything else. The page decides whether the question is put
 * (`site/lib/discussFirst.ts`, once a call per repository); this side only says so where the chair reads it. Doctrine:
 * `docs/doctrine-rationale/rule-10-team-facing.md` § Fixes wait on the owner's word.
 */
import { workspaceOfRepository } from "../handover/workspace.js";
import type { Organisation } from "../organisation/core.js";

/**
 * The question, in the owner's own words. The page speaks this sentence (`site/lib/discussFirst.ts`) and the chair asks it
 * on a direct ask (`skills/supervisor/reference/routing.md`); `talk/discussFirst.test.ts` holds all three to it.
 */
export const DISCUSS_FIRST_QUESTION =
  "Did you actually discuss this with the team first? If you did, I'm not aware of it.";

/** The longest thread link a relay carries, the page's own bound (`site/lib/discussFirst.ts`'s `FIX_THREAD_MAX`). */
const FIX_THREAD_MAX = 200;

/**
 * A Slack message permalink exactly as the page admits one (`site/lib/discussFirst.ts`'s `isFixThread`): no path past
 * the message's own `p` segment and no whitespace in its query. The shared parser reads past a trailing segment.
 */
const SLACK_MESSAGE_LINK = /^https:\/\/[a-z0-9-]+\.slack\.com\/archives\/[A-Z0-9]+\/p[0-9]{16}(?:\?\S*)?$/u;

/** What a relay says about the nudge: the question put on this relay, or the owner's answer to one put earlier on the call. */
export type DiscussFirstRecord =
  | { readonly status: "put"; readonly repository: string; readonly thread: string | undefined }
  | {
      readonly status: "override";
      readonly repository: string;
      readonly thread: string | undefined;
      /** The relay that put the question, whose row the owner's answer settles. */
      readonly priorTurnId: string;
    };

/** A relay's turn id, the page-minted v4 UUID, in either case as the page admits it (`site/lib/discussFirst.ts`). */
const TURN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * The record out of `talk relay`'s four flags, or why they are refused: all of them absent, or `--discuss-first` and
 * `--team-fix` together, `--fix-thread` optional, `--discuss-first-turn` with `override` only.
 *
 * @param status `--discuss-first`, put or override
 * @param repository `--team-fix`, a team repository as lower-case `owner/repo`
 * @param thread `--fix-thread`, the Slack link of the conversation about it
 * @param priorTurn `--discuss-first-turn`, the relay that put the question
 * @returns the record (`undefined` when no flag was passed), or every problem found
 */
export function discussFirstRecordOf({
  status,
  repository,
  thread,
  priorTurn,
}: {
  status: string | undefined;
  repository: string | undefined;
  thread: string | undefined;
  priorTurn: string | undefined;
}): { readonly record: DiscussFirstRecord | undefined } | { readonly problems: readonly string[] } {
  if (status === undefined) {
    const stray = [repository, thread, priorTurn].some((value) => value !== undefined);
    if (stray) {
      return {
        problems: ["--team-fix, --fix-thread and --discuss-first-turn go only with --discuss-first put|override"],
      };
    }
    return { record: undefined };
  }
  const problems = recordProblems({ priorTurn, repository, status, thread });
  if (problems.length > 0 || repository === undefined) {
    return { problems };
  }
  if (status === "put") {
    return { record: { repository, status, thread } };
  }
  return { record: { priorTurnId: priorTurn!, repository, status: "override", thread } };
}

/**
 * An exact lower-case `owner/repo`, no `.git` suffix: the bare slug the page sends. Whose repository it is needs the
 * organisation, which a pure parse of flags or of a stored record does not hold — {@link teamFixRefusal} asks that at
 * the verb's edge.
 */
const TEAM_FIX_SLUG = /^[a-z0-9-]+\/(?!\.+$)[a-z0-9._-]+$/u;

/** Whether a slug is shaped as a team fix may name: lower-case, exact, no `.git` suffix. */
function isFixSlug({ repository }: { repository: string }): boolean {
  return TEAM_FIX_SLUG.test(repository) && !repository.endsWith(".git");
}

/**
 * Why a relay's `--team-fix` is refused once the organisation is read: it names Slopweaver's own repository, or one
 * outside the organisation — or `undefined` when it is a team repository and stands.
 *
 * @param organisation the organisation, read once by the verb's edge (`../organisation/read.ts`)
 * @param record what the relay says about the nudge
 * @returns the problem line, or `undefined`
 */
export function teamFixRefusal({
  organisation,
  record,
}: {
  organisation: Organisation;
  record: DiscussFirstRecord;
}): string | undefined {
  if (workspaceOfRepository({ organisation, repository: record.repository }) === "team") {
    return undefined;
  }
  return `--team-fix ${record.repository} is not a team repository of ${organisation.displayName}: never Slopweaver's own, never one outside the organisation`;
}

/** Every problem with a relay's discuss-first flags once `--discuss-first` was passed; empty when they stand. */
function recordProblems({
  status,
  repository,
  thread,
  priorTurn,
}: {
  status: string;
  repository: string | undefined;
  thread: string | undefined;
  priorTurn: string | undefined;
}): string[] {
  const problems: string[] = [];
  if (status !== "put" && status !== "override") {
    problems.push(`--discuss-first must be put or override, got ${status}`);
  }
  // The bare slug the page sends, never a clone address: `workspaceOfRepository` drops one `.git`, so a doubled one
  // would read as a team repository no name could be.
  const fixSlug = repository !== undefined && isFixSlug({ repository });
  if (!fixSlug) {
    problems.push(
      "--discuss-first needs --team-fix <owner/repo>: a team repository, lower-case, never Slopweaver's own",
    );
  }
  const threadRefused = thread !== undefined && (thread.length > FIX_THREAD_MAX || !SLACK_MESSAGE_LINK.test(thread));
  if (threadRefused) {
    problems.push(`--fix-thread must be a Slack message link of at most ${String(FIX_THREAD_MAX)} characters`);
  }
  const turnNamed = priorTurn !== undefined && TURN_ID.test(priorTurn);
  if (status === "override" && !turnNamed) {
    problems.push("--discuss-first override needs --discuss-first-turn <uuid>: the relay that put the question");
  }
  if (status === "put" && priorTurn !== undefined) {
    problems.push("--discuss-first-turn goes only with --discuss-first override");
  }
  return problems;
}

/** What `talk relay` found on record for the turn an answer names as the one that put the question. */
export type PriorPutRead =
  /** The turn's record; its discuss-first field as stored, `undefined` on a record written before it was. */
  | { readonly kind: "read"; readonly discussFirst: DiscussFirstRecord | null | undefined }
  /** No readable record carries that turn. */
  | { readonly kind: "unreadable" };

/**
 * What a relay may say about the nudge once its prior turn is checked. An answer stands only when the turn it names
 * really put the question for the same repository; any other is HELD, saying why, so a forged or stale marker can
 * never open a row on a go-ahead and the owner's words still reach the chair.
 */
export type DiscussFirstStanding =
  | { readonly kind: "held"; readonly record: Extract<DiscussFirstRecord, { status: "put" }> }
  | { readonly kind: "answered"; readonly record: Extract<DiscussFirstRecord, { status: "override" }> }
  | {
      readonly kind: "unverified";
      readonly record: Extract<DiscussFirstRecord, { status: "override" }>;
      readonly why: string;
    }
  /** An answer that checks out, relayed before the owner finished speaking (`./relayCutHold.ts`), so no go-ahead. */
  | {
      readonly kind: "cut";
      readonly record: Extract<DiscussFirstRecord, { status: "override" }>;
      readonly why: string;
    };

/**
 * Check an answer against the relay it names, so a marker naming any well-formed turn id never reads as an answer. A
 * put needs no check: holding is the safe side.
 *
 * @param record what the relay says about the nudge
 * @param readPrior reads the turn an answer names, from the turn store
 * @param hold why this relay's words may end before the owner did (`./relayCutHold.ts`), or `undefined` when whole:
 *   an answer that would stand is held instead, since a go-ahead may be followed by a "no, wait"
 * @returns the standing the row and the chair's line state
 */
export function discussFirstStandingOf({
  record,
  readPrior,
  hold,
}: {
  record: DiscussFirstRecord;
  readPrior: (turn: { turnId: string }) => PriorPutRead;
  hold: string | undefined;
}): DiscussFirstStanding {
  if (record.status === "put") {
    return { kind: "held", record };
  }
  const prior = readPrior({ turnId: record.priorTurnId });
  if (prior.kind === "unreadable") {
    return { kind: "unverified", record, why: "is not on record" };
  }
  const put = prior.discussFirst;
  if (put === null || put === undefined || put.status !== "put") {
    return { kind: "unverified", record, why: "put no such question" };
  }
  if (put.repository !== record.repository) {
    return { kind: "unverified", record, why: `asked it about ${put.repository}` };
  }
  if (hold !== undefined) {
    return { kind: "cut", record, why: hold };
  }
  return { kind: "answered", record };
}

/**
 * The clause a relay's row and the chair's line open on: a hold while the question waits on the owner, else that their
 * words are their answer to it and a go-ahead stands. The row carries the thread link whole; the chair's line, whose lead is
 * cut at 240 characters (`./supervisorDelivery.ts`), says it is on the row. What to do comes before the repository,
 * so the cut can only ever land on the name.
 *
 * @param standing what the relay may say about the nudge, its answer checked; `undefined` when it names no team fix
 * @param linked whether the clause carries the thread link itself (the row), or points at the row for it (the line)
 * @returns the clause, one line, or `undefined` when there is no standing
 */
export function discussFirstLead({
  standing,
  linked,
}: {
  standing: DiscussFirstStanding | undefined;
  linked: boolean;
}): string | undefined {
  if (standing === undefined) {
    return undefined;
  }
  const { record } = standing;
  let thread = "";
  if (record.thread !== undefined) {
    thread = linked ? ` · thread ${record.thread}` : " · thread on the row";
  }
  if (standing.kind === "held") {
    return (
      "DISCUSS-FIRST HOLD: the voice asked the owner whether the team discussed this first — start no fix until their " +
      `answer · fix to ${record.repository}${thread}`
    );
  }
  if (standing.kind === "unverified") {
    return (
      "DISCUSS-FIRST HOLD: start no fix until the owner answers whether the team discussed this first — this relay claims " +
      `to answer it, but talk:${standing.record.priorTurnId} ${standing.why} · fix to ${record.repository}${thread}`
    );
  }
  if (standing.kind === "cut") {
    return (
      "DISCUSS-FIRST HOLD: start no fix yet — this relay answers whether the team discussed this first " +
      `(talk:${standing.record.priorTurnId}), but ${standing.why} · fix to ${record.repository}${thread}`
    );
  }
  return (
    "DISCUSS-FIRST ANSWER: the owner's words here answer whether the team discussed this first, and a go-ahead stands " +
    `(talk:${standing.record.priorTurnId}) · fix to ${record.repository}${thread}`
  );
}

/**
 * Two leads as one, the discuss-first clause first: it decides whether anything starts at all.
 *
 * @param first the discuss-first clause, or `undefined`
 * @param second the lead the relay's channel read found, or `undefined`
 * @returns the joined lead, or `undefined` when neither was there
 */
export function joinedLead({
  first,
  second,
}: {
  first: string | undefined;
  second: string | undefined;
}): string | undefined {
  if (first === undefined) {
    return second;
  }
  if (second === undefined || second === "") {
    return first;
  }
  return `${first} — ${second}`;
}
