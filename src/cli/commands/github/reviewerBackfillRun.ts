/**
 * `slopweaver github reviewer backfill` — the effectful shell over `../../../review/reviewerBackfill.ts`: the
 * GitHub bronze for whose pull requests, one Slack corpus scan for every ask on them, one GitHub read per pull
 * request still owed a row for the code-owner teams GitHub applied, and the register append under `--apply`.
 *
 * Every refusal to read — the bronze, the register, the scan — is `EXIT_ERROR` before anything is written,
 * because the register keeps the first writer of an ask: a row written without the recorded readings a session
 * already made, or without its teams, would stand wrong for good. A GitHub read that fails for ONE pull
 * request writes none of that pull request's asks, writes the rest, and exits `EXIT_ERROR` naming it, so a rerun
 * reads only what is still owed. A read GitHub answers with more code-owner requests or reviews than the fixed
 * page carries is HELD BACK instead: its teams could be a lower bound, and a rerun reads the same page, so it is
 * named and never retried as a failure. MEASURED: one of 186 acme-admin pull requests read
 * (`slopweaver github reviewer backfill --repo acme/acme-admin --author octocat --json`).
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonStringify } from "#lib/safeJson.js";

import { githubToken } from "../../../config.js";
import { parseRow } from "../../../corpus/corpusRowCore.js";
import { readJsonlLines } from "../../../corpus/corpusStore.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { githubReadGraphql } from "../../../live/github/read.js";
import { type GithubReviewStateApi, makeGithubReviewStateApi } from "../../../live/github/reviewState.js";
import { loadProfile } from "../../../profileStore.js";
import { reviewErrorLines } from "../../../review/errors.js";
import { githubCodeownerRequirement } from "../../../review/githubCodeowners.js";
import type { PrLinkRef } from "../../../review/prLink.js";
import {
  askGroupsOf,
  authoredPrRefsOf,
  backfillAskedRowsOf,
  prKeysNeedingTeamsOf,
} from "../../../review/reviewerBackfill.js";
import { rowsToAppend } from "../../../review/reviewerRegister.js";
import { scanCorpusMentions } from "../../../review/slackEvidenceScan.js";
import type { SlackMention } from "../../../review/slackEvidenceTypes.js";
import { stateHomePaths } from "../../../stateHome.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";

import type { GithubReviewerBackfillArgs } from "./reviewerArgs.js";
import { reviewerHomeOf } from "./reviewerAsk.js";
import {
  GithubReviewerErrors,
  type ReviewerBronzeUnreadableError,
  type ReviewerTeamsTruncatedError,
  type ReviewerTeamsUnreadError,
} from "./reviewerErrors.js";
import type { GithubReviewerDeps } from "./reviewerRun.js";
import { slackIdentityOf } from "./reviewStateSlack.js";

/** The fewest check contexts and changed paths GitHub accepts: this read wants the code owners only. */
const SMALLEST_PAGE = 1;

/** The seams only `backfill` reaches, beside the register, roster, clock and output channels the others share. */
export interface ReviewerBackfillDeps {
  /** The GitHub bronze pull-request records by this author — a superset the pure core narrows. */
  readonly githubRecords: (args: {
    home: string | undefined;
    author: string;
  }) => Result<readonly CorpusRecord[], ReviewerBronzeUnreadableError>;
  /** One Slack corpus scan for every mention of these pull requests, as the landing's corpus leg makes it. */
  readonly corpusMentions: (args: {
    home: string | undefined;
    refs: readonly PrLinkRef[];
  }) => Result<readonly SlackMention[]>;
  /** The `@org/team` code owners GitHub applied to one pull request, approved or still pending. */
  readonly codeownerTeams: (args: {
    home: string | undefined;
    ref: PrLinkRef;
  }) => Promise<Result<readonly string[], ReviewerTeamsUnreadError | ReviewerTeamsTruncatedError>>;
}

/** What `backfill` reports, dry or applied. */
interface BackfillReport {
  readonly repo: string;
  readonly author: string;
  readonly applied: boolean;
  /** Pull requests by the author the GitHub corpus holds. */
  readonly prs: number;
  /** Of those, how many any Slack message reaches. */
  readonly prsMentioned: number;
  /** How many carry an ask the register does not hold yet — each one GitHub read. */
  readonly prsRead: number;
  /** Asks built for the pull requests whose teams were read. */
  readonly asks: number;
  /** Of those, the ones the register does not already hold. */
  readonly fresh: number;
  /** Rows actually appended — zero on a dry run. */
  readonly written: number;
  /** Pull requests whose GitHub read failed, so none of their asks were built — a rerun reads them again. */
  readonly unread: readonly { readonly prKey: string; readonly why: string }[];
  /** Pull requests whose code owners overflowed the fixed page, so none of their asks were built, for good. */
  readonly heldBack: readonly { readonly prKey: string; readonly why: string }[];
}

/** One pull request whose asks were not built, and why. */
interface Missed {
  readonly prKey: string;
  readonly why: string;
}

/**
 * Read GitHub's code-owner teams for each pull request still owed an ask, one at a time, sorting every miss by
 * whether a rerun could change it.
 *
 * @param grouped mentions by pull request, the recorded readings laid over them
 * @param held every `prKey|messageKey` the register already holds an ask for
 * @param refs the author's pull requests from the bronze, which address each read
 * @returns the owed pull requests, the teams read, the reads that failed, and the pull requests held back
 */
async function readTeams({
  deps,
  grouped,
  held,
  home,
  refs,
}: {
  deps: GithubReviewerDeps;
  grouped: ReadonlyMap<string, readonly SlackMention[]>;
  held: ReadonlySet<string>;
  home: string | undefined;
  refs: readonly PrLinkRef[];
}): Promise<{
  owed: readonly string[];
  teamsByPr: Map<string, readonly string[]>;
  unread: Missed[];
  heldBack: Missed[];
}> {
  const owed = prKeysNeedingTeamsOf({ grouped, held });
  const teamsByPr = new Map<string, readonly string[]>();
  const unread: Missed[] = [];
  const heldBack: Missed[] = [];
  const byKey = new Map(refs.map((ref) => [`${ref.owner}/${ref.repo}#${String(ref.number)}`, ref]));
  for (const prKey of owed) {
    const ref = byKey.get(prKey);
    if (ref === undefined) {
      unread.push({ prKey, why: "the scan reached a pull request the GitHub corpus does not list" });
      continue;
    }
    const teams = await deps.backfill.codeownerTeams({ home, ref });
    if (teams.isErr()) {
      const missed = teams.error.code === "TEAMS_TRUNCATED" ? heldBack : unread;
      missed.push({ prKey, why: teams.error.message });
      continue;
    }
    teamsByPr.set(prKey, teams.value);
  }
  return { heldBack, owed, teamsByPr, unread };
}

/**
 * Print why `backfill` stopped before its report.
 *
 * @param code the exit code saying which kind of stop it was — `EXIT_ERROR` unless given
 * @returns that exit code
 */
function refuse({ deps, why, code = EXIT_ERROR }: { deps: GithubReviewerDeps; why: string; code?: number }): number {
  deps.writeDiagnostic(`github reviewer backfill: ${why}`);
  return code;
}

/** Append the fresh rows under `--apply`: how many were written (none without it), or the store's refusal. */
function applyFresh({
  apply,
  deps,
  home,
  nowIso,
  rows,
}: Parameters<GithubReviewerDeps["appendRows"]>[0] & {
  apply: boolean;
  deps: GithubReviewerDeps;
}): number | { readonly refusal: string } {
  if (!apply) {
    return 0;
  }
  const appended = deps.appendRows({ home, nowIso, rows });
  if (appended.isErr()) {
    return { refusal: appended.error.message };
  }
  return appended.value.appended;
}

/**
 * `backfill`: find every ask the corpus holds on the author's pull requests, read each one's teams, and write
 * the new rows under `--apply`.
 *
 * @returns the exit code
 */
export async function runBackfill({
  args,
  deps,
}: {
  args: GithubReviewerBackfillArgs;
  deps: GithubReviewerDeps;
}): Promise<number> {
  const { home } = args;
  const records = deps.backfill.githubRecords({ author: args.author, home });
  if (records.isErr()) {
    return refuse({ deps, why: records.error.message });
  }
  const refs = authoredPrRefsOf({ author: args.author, records: records.value, repo: args.repo });
  if (refs.length === 0) {
    const why = `the GitHub corpus holds no pull request by ${args.author} in ${args.repo}`;
    return refuse({ code: EXIT_EXPECTED_EMPTY, deps, why });
  }
  const register = deps.readRegister({ home });
  if (register.isErr()) {
    return refuse({ deps, why: register.error.message });
  }
  const scanned = deps.backfill.corpusMentions({ home, refs });
  if (scanned.isErr()) {
    return refuse({ deps, why: scanned.error.join("; ") });
  }
  const { grouped, held } = askGroupsOf({ mentions: scanned.value, rows: register.value });
  const { owed, teamsByPr, unread, heldBack } = await readTeams({ deps, grouped, held, home, refs });
  const nowIso = deps.now();
  const rosterNames = await deps.rosterNames({ home });
  if (rosterNames.isErr()) {
    return refuse({ deps, why: rosterNames.error.message });
  }
  const rows = backfillAskedRowsOf({
    authorLogin: args.author,
    grouped,
    nameForSlackId: rosterNames.value,
    recordedAtIso: nowIso,
    teamsByPr,
  });
  const fresh = rowsToAppend({ candidates: rows, held: register.value });
  const written = applyFresh({ apply: args.apply, deps, home, nowIso, rows: fresh });
  if (typeof written !== "number") {
    return refuse({ deps, why: written.refusal });
  }
  const report: BackfillReport = {
    applied: args.apply,
    asks: rows.length,
    author: args.author,
    fresh: fresh.length,
    heldBack,
    prs: refs.length,
    prsMentioned: grouped.size,
    prsRead: owed.length,
    repo: args.repo,
    unread,
    written,
  };
  printReport({ deps, json: args.json, report });
  return unread.length > 0 ? EXIT_ERROR : EXIT_OK;
}

/** Print the report as one JSON document or as lines, and every unread pull request as a diagnostic. */
function printReport({
  deps,
  json,
  report,
}: {
  deps: GithubReviewerDeps;
  json: boolean;
  report: BackfillReport;
}): void {
  for (const miss of report.unread) {
    deps.writeDiagnostic(`github reviewer backfill: ${miss.prKey} not written — ${miss.why}; a rerun reads it again`);
  }
  for (const held of report.heldBack) {
    deps.writeDiagnostic(`github reviewer backfill: ${held.prKey} held back — ${held.why}`);
  }
  if (json) {
    deps.writeOut(safeJsonStringify({ label: "the reviewer backfill report", value: report }));
    return;
  }
  const did = report.applied ? `wrote ${String(report.written)}` : `would write ${String(report.fresh)} (pass --apply)`;
  deps.writeOut(
    `github reviewer backfill: ${report.author} in ${report.repo} — ${String(report.prs)} pull request(s), ` +
      `${String(report.prsMentioned)} reached from Slack, ${String(report.prsRead)} read for teams; ` +
      `${String(report.asks)} ask(s) found, ${String(report.fresh)} new; ${did}`,
  );
}

/**
 * Every GitHub bronze pull-request record by one author. The line is substring-tested before it is parsed, as
 * the Slack scan does, because the GitHub bronze runs to gigabytes.
 *
 * @returns the records, or why the bronze could not be read
 */
function githubRecordsIn({
  home,
  author,
}: {
  home: string;
  author: string;
}): Result<readonly CorpusRecord[], ReviewerBronzeUnreadableError> {
  const dir = join(stateHomePaths({ home }).corpus.bronze, "github");
  const kept: CorpusRecord[] = [];
  const needle = `"author":${safeJsonStringify({ label: "an author login", value: author })}`;
  try {
    for (const name of readdirSync(dir)
      .filter((file) => file.endsWith(".jsonl"))
      .toSorted()) {
      readJsonlLines({
        onLine: ({ line }) => {
          if (!line.includes(needle) || !line.includes('"kind":"pr"')) {
            return;
          }
          const decoded = parseRow({ line });
          if ("record" in decoded) {
            kept.push(decoded.record);
          }
        },
        path: join(dir, name),
      });
    }
  } catch (cause) {
    return err(GithubReviewerErrors.bronzeUnreadable({ cause: errorMessage({ error: cause }), path: dir }));
  }
  return ok(kept);
}

/**
 * GitHub's own code-owner teams for one pull request. A truncated read could have lost an approved team, so it
 * is a failure rather than a short answer.
 *
 * @returns the `@org/team` tokens, or why they could not be read whole
 */
async function teamsOf({
  api,
  ref,
}: {
  api: GithubReviewStateApi;
  ref: PrLinkRef;
}): Promise<Result<readonly string[], ReviewerTeamsUnreadError | ReviewerTeamsTruncatedError>> {
  const state = await api.pr({
    checkLimit: SMALLEST_PAGE,
    fileLimit: SMALLEST_PAGE,
    number: ref.number,
    owner: ref.owner,
    repo: ref.repo,
    withBodies: false,
  });
  if (state.isErr()) {
    return err(GithubReviewerErrors.teamsUnread({ cause: state.error.message }));
  }
  const pr = state.value;
  if (pr.codeownerRequestsTruncated || pr.reviewsTruncated) {
    return err(GithubReviewerErrors.teamsTruncated());
  }
  return ok(
    githubCodeownerRequirement({
      requests: pr.codeownerRequests,
      requestsTruncated: false,
      reviews: pr.reviews,
      reviewsTruncated: false,
    }).teams,
  );
}

/**
 * The real backfill seams. The GitHub client is built once, on the first read.
 *
 * @returns the seams
 */
export function productionBackfillDeps(): ReviewerBackfillDeps {
  let api: GithubReviewStateApi | undefined;
  return {
    codeownerTeams: async ({ home, ref }) => {
      if (api === undefined) {
        const token = githubToken({ home: reviewerHomeOf({ home }) });
        if (token === undefined) {
          return err(GithubReviewerErrors.noGithubToken());
        }
        api = makeGithubReviewStateApi({ graphql: githubReadGraphql({ token }) });
      }
      return teamsOf({ api, ref });
    },
    corpusMentions: ({ home, refs }) => {
      const at = reviewerHomeOf({ home });
      const identity = slackIdentityOf({ slackBot: loadProfile({ home: at })?.slackBot });
      return scanCorpusMentions({ home: at, identity, refs }).mapErr((error) => reviewErrorLines({ error }));
    },
    githubRecords: ({ home, author }) => githubRecordsIn({ author, home: reviewerHomeOf({ home }) }),
  };
}
