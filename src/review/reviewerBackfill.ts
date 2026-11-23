/**
 * The reviewer register's backfill — every ask the local corpus holds on one author's pull requests, as the
 * `asked` rows a landing reading would have written had one been recorded while each was open.
 *
 * ## Why the corpus, and not the readings ledger
 *
 * The landing writes an ask only for a pull request OPEN at a recorded reading, so a register fed by readings
 * alone starts with a handful of asks. MEASURED on a real home: the
 * union of every reading's `rows[].askTrail[]` was exactly the register's few dozen keys — nothing more to
 * fold — while one corpus scan over the owner's thousands of authored pull requests certified hundreds of asks,
 * nearly all of them not held:
 *
 * ```bash
 * slopweaver github reviewer backfill --repo acme/acme-admin --author <login> --json | jq '.asks, .fresh'
 * ```
 *
 * ## The same classifier, and GitHub's own teams
 *
 * An ask here is exactly an ask on the landing: the same corpus scan (`./slackEvidenceScan.ts`), the same
 * recorded readings laid over it (`./readingMerge.ts`), the same `askTrailOf`. What differs is
 * `codeOwnerTeams`. A live row takes the teams GitHub still has PENDING; a closed pull request has none
 * pending, so a backfilled row takes GitHub's whole code-owner answer instead — approved teams from each
 * review's `onBehalfOf` plus any request still open (`./githubCodeowners.ts`). That is the team GitHub
 * applied to the change, which is what `team-history` asks. A pull request whose GitHub read failed writes
 * NONE of its asks, because the register keeps the first writer of an ask and a row written with no teams
 * could never be corrected.
 *
 * A backfilled row is the same shape as any other, deliberately: the schema is strict, and a seat running an
 * older build reads the same register. Its `recordedAtIso` long after its `atIso` is what marks it.
 *
 * Pure. The corpus, GitHub and the register file are the run module's.
 */
import type { CorpusRecord } from "../corpus/types.js";

import { askTrailOf } from "./askTrail.js";
import type { PrLinkRef } from "./prLink.js";
import { applyReadings } from "./readingMerge.js";
import { type ReviewerAskedRow, type ReviewerRow, readingsByPr } from "./reviewerRegister.js";
import type { SlackMention } from "./slackEvidenceTypes.js";

/** A GitHub pull-request URL: owner, repository and number. */
const PR_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/;

/**
 * The deduplicated pull requests one author opened in one repository, from GitHub bronze records.
 *
 * @param records GitHub bronze records of any kind; only pull requests are read
 * @param author the GitHub login whose pull requests are wanted
 * @param repo `owner/name`
 * @returns one reference per pull request, ordered by number
 */
export function authoredPrRefsOf({
  records,
  author,
  repo,
}: {
  records: readonly CorpusRecord[];
  author: string;
  repo: string;
}): readonly PrLinkRef[] {
  const byNumber = new Map<number, PrLinkRef>();
  for (const record of records) {
    if (record.source !== "github" || record.kind !== "pr" || record.author !== author) {
      continue;
    }
    const match = PR_URL.exec(record.url);
    if (match === null || `${match[1]!}/${match[2]!}` !== repo) {
      continue;
    }
    const number = Number(match[3]!);
    byNumber.set(number, { number, owner: match[1]!, repo: match[2]! });
  }
  return [...byNumber.values()].toSorted((a, b) => a.number - b.number);
}

/**
 * Mentions grouped by pull request, each group newest first — the order `askTrailOf` expects.
 *
 * @param mentions every mention the scan found, in any order
 * @returns `prKey` → its mentions, newest first
 */
export function mentionsByPr({
  mentions,
}: {
  mentions: readonly SlackMention[];
}): ReadonlyMap<string, readonly SlackMention[]> {
  const grouped = new Map<string, SlackMention[]>();
  for (const mention of mentions) {
    const held = grouped.get(mention.prKey);
    if (held === undefined) {
      grouped.set(mention.prKey, [mention]);
    } else {
      held.push(mention);
    }
  }
  const sorted = new Map<string, readonly SlackMention[]>();
  for (const [prKey, group] of grouped) {
    sorted.set(
      prKey,
      group.toSorted((a, b) => b.atIso.localeCompare(a.atIso)),
    );
  }
  return sorted;
}

/**
 * The scan joined with the register: each pull request's mentions with the recorded readings laid over them,
 * exactly as the landing lays them, and every ask the register already holds.
 *
 * @param mentions every mention the scan found, in any order
 * @param rows the whole register, whose `read` rows are laid over the scan and whose `asked` rows are held
 * @returns the mentions by pull request, newest first, and every held `prKey|messageKey`
 */
export function askGroupsOf({ mentions, rows }: { mentions: readonly SlackMention[]; rows: readonly ReviewerRow[] }): {
  readonly grouped: ReadonlyMap<string, readonly SlackMention[]>;
  readonly held: ReadonlySet<string>;
} {
  const readings = readingsByPr({ rows });
  const grouped = new Map(
    [...mentionsByPr({ mentions })].map(([prKey, group]) => [
      prKey,
      applyReadings({ mentions: group, readings: readings.get(prKey) }),
    ]),
  );
  const held = new Set(rows.flatMap((row) => (row.kind === "asked" ? [`${row.prKey}|${row.messageKey}`] : [])));
  return { grouped, held };
}

/**
 * The pull requests carrying at least one certified ask the register does not hold yet — the only ones worth
 * a GitHub read, so a rerun reads only what a failed read left behind.
 *
 * @param grouped mentions by pull request, newest first
 * @param held every `prKey|messageKey` the register already holds an ask for
 * @returns their `prKey`s, sorted
 */
export function prKeysNeedingTeamsOf({
  grouped,
  held,
}: {
  grouped: ReadonlyMap<string, readonly SlackMention[]>;
  held: ReadonlySet<string>;
}): readonly string[] {
  return [...grouped]
    .filter(([prKey, mentions]) =>
      askTrailOf({ asks: mentions }).some((ask) => !held.has(`${prKey}|${ask.messageKey}`)),
    )
    .map(([prKey]) => prKey)
    .toSorted();
}

/**
 * The `asked` rows for every pull request GitHub's teams were read for. A pull request missing from
 * `teamsByPr` — its read failed — contributes nothing, so a rerun can still write it whole.
 *
 * @param grouped mentions by pull request, newest first
 * @param teamsByPr `prKey` → the `@org/team` code owners GitHub applied to it
 * @param authorLogin the pull requests' author
 * @param nameForSlackId the roster's names, for the row's `names`
 * @param recordedAtIso when the backfill ran
 * @returns one row per certified ask, pull requests in key order and each newest first
 */
export function backfillAskedRowsOf({
  grouped,
  teamsByPr,
  authorLogin,
  nameForSlackId,
  recordedAtIso,
}: {
  grouped: ReadonlyMap<string, readonly SlackMention[]>;
  teamsByPr: ReadonlyMap<string, readonly string[]>;
  authorLogin: string;
  nameForSlackId: ReadonlyMap<string, string>;
  recordedAtIso: string;
}): readonly ReviewerAskedRow[] {
  const rows: ReviewerAskedRow[] = [];
  for (const prKey of [...grouped.keys()].toSorted()) {
    const teams = teamsByPr.get(prKey);
    if (teams === undefined) {
      continue;
    }
    const [repoSlug, numberText] = prKey.split("#");
    for (const ask of askTrailOf({ asks: grouped.get(prKey)! })) {
      const names: Record<string, string> = {};
      for (const id of ask.recipients) {
        const name = nameForSlackId.get(id);
        if (name !== undefined) {
          names[id] = name;
        }
      }
      rows.push({
        atIso: ask.atIso,
        authorLogin,
        channel: ask.channel,
        codeOwnerTeams: teams,
        isDirectMessage: ask.isDirectMessage,
        kind: "asked",
        messageKey: ask.messageKey,
        names,
        number: Number(numberText!),
        permalink: ask.permalink,
        prKey,
        recipients: ask.recipients,
        recordedAtIso,
        repoSlug: repoSlug!,
        schema: 1,
      });
    }
  }
  return rows;
}
