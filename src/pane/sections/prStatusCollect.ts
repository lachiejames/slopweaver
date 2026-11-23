/**
 * PULL REQUESTS — the `gh` collection edge.
 *
 * Split out of {@link ./prStatus.js} (the file-size ratchet, step 2): this is the thin, effectful shell that
 * shells `gh` per watched repository, joins the Slack ask record in, and hands the result to
 * {@link ./prStatus.js}'s pure `buildPrStatusSection`. Everything decoded here comes from
 * {@link ./prStatusDecode.js}; the spend accounting comes from {@link ./prStatusRateLimit.js}; the identity
 * gap and the omission line, both pure, from {@link ./prStatusIdentity.js}.
 */

import type { CommandReader } from "../../measurement/measure.js";
import { type Measured, measured, unmeasurable } from "../../measurement/status.js";
import type { SectionResult } from "../section.js";
import { buildPrStatusSection, type PrRecord } from "./prStatus.js";
import {
  nestedLogin,
  OPEN_COUNT_LIMIT,
  PR_FETCH_LIMIT,
  PR_FIELDS,
  type PrRepo,
  parsePrList,
} from "./prStatusDecode.js";
import { identityGap, identityGapNotes, type OpenPr, omissionLine, parseGhAccounts } from "./prStatusIdentity.js";
import { rateLimitLine, readRateLimit } from "./prStatusRateLimit.js";
import { gatherAsks } from "./slackAsk.js";

/** The cadence the budget line plans for: one `gh pr list` per repository per this long. */
const PR_STATUS_TTL_MS = 60_000;

/** What one repository contributed, including the reason it contributed nothing. */
interface RepoResult {
  readonly prs: readonly PrRecord[];
  readonly notes: readonly string[];
  /** How many pull requests are open there in total, whoever opened them, or why that is unknown. */
  readonly openTotal: Measured<number>;
}

/** The token for one repository's account, or the reason it could not be read. */
function tokenFor({
  repo,
  cwd,
  read,
}: {
  repo: PrRepo;
  cwd: string;
  read: CommandReader;
}): Measured<string | undefined> {
  if (repo.tokenUser === undefined) {
    return measured({ value: undefined });
  }
  const token = read({ args: ["auth", "token", "--user", repo.tokenUser], command: "gh", cwd });
  return token.known
    ? measured({ value: token.value })
    : unmeasurable({
        why: `no token for gh account "${repo.tokenUser}" (${repo.nameWithOwner}) — \`gh auth login --user ${repo.tokenUser}\``,
      });
}

/** Run one `gh pr list` against a repository under its own account's token. */
function listPrs({
  repo,
  cwd,
  token,
  args,
  read,
}: {
  repo: PrRepo;
  cwd: string;
  token: string | undefined;
  args: readonly string[];
  read: CommandReader;
}): Measured<string> {
  return read({
    args: ["pr", "list", "--repo", repo.nameWithOwner, "--state", "open", ...args],
    command: "gh",
    cwd,
    ...(token === undefined ? {} : { extraEnv: { GH_TOKEN: token } }),
  });
}

/**
 * Every pull request open in a repository, with its author — whoever opened it.
 *
 * One extra call asking for `number` and `author` alone, and it is the honesty of the whole section: it turns
 * "these are the rows" into "these are the rows, here is how many are open that are NOT, and which of those
 * are yours under another login". Measured on the work repository — 266 open, answered in 2.1s —
 * against 11.2s and a reproducible HTTP 504 for the same list carrying `statusCheckRollup`. So the cheap scan
 * is affordable exactly where the full list is not.
 */
function openScanFor({
  repo,
  cwd,
  token,
  read,
}: {
  repo: PrRepo;
  cwd: string;
  token: string | undefined;
  read: CommandReader;
}): Measured<readonly OpenPr[]> {
  const stdout = listPrs({
    args: ["--limit", String(OPEN_COUNT_LIMIT), "--json", "number,author"],
    cwd,
    read,
    repo,
    token,
  });
  if (!stdout.known) {
    return unmeasurable({ why: stdout.why });
  }
  try {
    const parsed: unknown = JSON.parse(stdout.value);
    if (!Array.isArray(parsed)) {
      return unmeasurable({ why: "`gh pr list --json number,author` did not return an array" });
    }
    return measured({
      value: parsed
        .filter((entry: unknown): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
        .map((entry) => ({
          author: nestedLogin({ value: entry["author"] }),
          number: numberOr({ value: entry["number"] }),
        })),
    });
  } catch {
    return unmeasurable({ why: "`gh pr list --json number,author` returned output that is not JSON" });
  }
}

/** A number field, or -1 — a sentinel that can never collide with a real pull-request number. */
function numberOr({ value }: { value: unknown }): number {
  return typeof value === "number" ? value : -1;
}

/** The logins this machine is authenticated as, or the reason they could not be read. */
function ghAccounts({ cwd, read }: { cwd: string; read: CommandReader }): Measured<readonly string[]> {
  const status = read({ args: ["auth", "status"], command: "gh", cwd });
  return status.known
    ? measured({ value: parseGhAccounts({ stdout: status.value }) })
    : unmeasurable({ why: status.why });
}

/** Ask one repository for the owner's open pull requests, and for everything open there. */
function fetchRepo({
  repo,
  cwd,
  accounts,
  read,
}: {
  repo: PrRepo;
  cwd: string;
  accounts: Measured<readonly string[]>;
  read: CommandReader;
}): RepoResult {
  const token = tokenFor({ cwd, read, repo });
  if (!token.known) {
    return { notes: [`${repo.nameWithOwner}: ${token.why}`], openTotal: unmeasurable({ why: token.why }), prs: [] };
  }
  const scan = openScanFor({ cwd, read, repo, token: token.value });
  const openTotal: Measured<number> = scan.known
    ? measured({ value: scan.value.length })
    : unmeasurable({ why: scan.why });
  const stdout = listPrs({
    // `@me` resolves against the TOKEN's own login, which is why the per-repository account matters so much
    // here — see {@link PrRepo.tokenUser}. The owner reviews other people's pull requests when they are tagged in
    // Slack, not when GitHub records a review request, so enrolling the team's rows off that field would put
    // 259 pull requests on a page built to hold one screen and still miss the ones they are actually asked about.
    args: ["--author", "@me", "--limit", String(PR_FETCH_LIMIT), "--json", PR_FIELDS],
    cwd,
    read,
    repo,
    token: token.value,
  });
  if (!stdout.known) {
    return {
      notes: [`${repo.nameWithOwner}: ${stdout.why} — it was NOT read, so it is not "no open pull requests"`],
      openTotal,
      prs: [],
    };
  }
  const parsed = parsePrList({ repo: repo.nameWithOwner, stdout: stdout.value });
  if (typeof parsed === "string") {
    return { notes: [`${repo.nameWithOwner}: ${parsed}`], openTotal, prs: [] };
  }
  return {
    notes: [
      ...parsed.refused.map((refusal) => `${repo.nameWithOwner}: ${refusal}`),
      ...gapNotes({ accounts, parsed, repo, scan }),
    ],
    openTotal,
    prs: parsed.prs,
  };
}

/** The cap breach and the identity gap — the two ways this repository's list can be short. */
function gapNotes({
  repo,
  parsed,
  scan,
  accounts,
}: {
  repo: PrRepo;
  parsed: { prs: readonly PrRecord[]; refused: readonly string[] };
  scan: Measured<readonly OpenPr[]>;
  accounts: Measured<readonly string[]>;
}): readonly string[] {
  const capped =
    parsed.prs.length >= PR_FETCH_LIMIT
      ? [`${repo.nameWithOwner}: hit the ${String(PR_FETCH_LIMIT)}-pull-request fetch cap, so this list may be SHORT`]
      : [];
  if (!scan.known || !accounts.known) {
    // Stated rather than skipped: without the scan or the account list this check DID NOT RUN, so its silence
    // means nothing. Reporting it as clean would be the collapse the whole section exists to prevent.
    const blockers = [
      scan.known ? undefined : scan.why,
      accounts.known ? undefined : "`gh auth status` could not be read",
    ];
    return [
      ...capped,
      `${repo.nameWithOwner}: the own-login check did NOT run (${blockers.filter((why) => why !== undefined).join("; ")}), so a pull request of yours under another login would be missing from this page without saying so.`,
    ];
  }
  return [
    ...capped,
    ...identityGapNotes({
      gaps: identityGap({
        accounts: accounts.value,
        open: scan.value,
        shown: parsed.prs.map((pr) => pr.number),
      }),
      repo,
    }),
  ];
}

/**
 * Ask every watched repository for the owner's open pull requests and build the section.
 *
 * @param repos the repositories to watch, each with the account that can read it
 * @param cwd the directory `gh` is run from
 * @param nowMs the instant this collection is stamped with
 * @param home the state home whose Slack corpus the asks are read from
 * @param read how `gh` is run — `readCommand` from the verb, a plain fake in a unit test
 * @returns the section, ranked closest-to-merge first across every repository
 */
export function collectPrStatus({
  repos,
  cwd,
  nowMs,
  home,
  read,
}: {
  repos: readonly PrRepo[];
  cwd: string;
  nowMs: number;
  home: string;
  read: CommandReader;
}): SectionResult {
  if (repos.length === 0) {
    return {
      ...buildPrStatusSection({
        asks: [],
        measuredAtIso: unmeasurable({ why: "no repository is being watched" }),
        prs: [],
        window: { newestIso: unmeasurable({ why: "no repository is being watched" }), startIso: "" },
      }),
      unavailable: "no repository is being watched — pass `--pr-repo owner/name[@gh-account]`. Nothing was asked.",
    };
  }
  const accounts = ghAccounts({ cwd, read });
  const results = repos.map((repo) => fetchRepo({ accounts, cwd, read, repo }));
  const prs = results.flatMap((result) => result.prs);
  const notes = results.flatMap((result) => result.notes);
  const answered = results.filter((result) => result.notes.length === 0).length;
  const gathered = gatherAsks({ home, nowMs, prUrls: prs.map((pr) => pr.url) });
  const built = buildPrStatusSection({
    asks: gathered.asks,
    measuredAtIso: measured({ value: new Date(nowMs).toISOString() }),
    prs,
    window: gathered.window,
  });
  const budget = rateLimitLine({
    limits: readRateLimit({ cwd, read }),
    repoCount: repos.length,
    ttlMs: PR_STATUS_TTL_MS,
  });
  // `results` is `repos` mapped one to one — a hole in `repos` is a hole in `results`, and `map` visits neither —
  // so every index this callback sees has its answer.
  const watched = repos.map((repo, index) => ({
    mine: results[index]!.prs.length,
    nameWithOwner: repo.nameWithOwner,
    openTotal: results[index]!.openTotal,
    tokenUser: repo.tokenUser,
  }));
  return {
    ...built,
    blurb: `${built.blurb} ${omissionLine({ watched })} ${budget}`,
    unavailable:
      notes.length === 0
        ? undefined
        : `${String(repos.length - answered)} of ${String(repos.length)} repo(s) did not fully answer — ${notes.join("; ")}`,
  };
}
