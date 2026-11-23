/**
 * Dependabot alerts — list every one on a repository, and read one in full.
 *
 * Its own module rather than a section of `./write.ts`, for the same reason `./codeScanning.ts` is: that
 * file sits close to the repo's 700-code-line file-size ratchet (`src/devLint/fileSizeRatchet.ts`).
 *
 * ## Why this is a separate family from code scanning
 *
 * A code-scanning alert is about a line of OUR source; a Dependabot alert is about a version of SOMEONE
 * ELSE'S package that our lockfile resolved to. They share the word "alert" and nothing else — different
 * endpoints, different severity vocabulary (CVSS, not a rule's severity level), different remedy, and
 * different citation path. Merging them behind one verb would mean one `--state` flag standing for two
 * different enums, so they stay apart.
 *
 * ## Why one projection covers both calls
 *
 * GitHub answers `listAlertsForRepo` and `getAlert` with the SAME `dependabot-alert` schema at repository
 * scope, so a single {@link alertOf} serves both. That is why `github vuln get` can promise everything the
 * alert's own page shows without a second, richer projection: the list already carries it, and `get` differs
 * only in printing all of it rather than one line.
 *
 * ## Why this pages by CURSOR while `./codeScanning.ts` pages by number
 *
 * Not a style choice, and not a guess. MEASURED against the live endpoint on this repository:
 * passing `page` returns HTTP 422 with GitHub's own words, `"Pagination using the `page` parameter is not
 * supported."` — so the page-number loop its sibling module uses is refused outright here. This endpoint is
 * cursor-paged: `first` sets the page size and `after` carries the opaque cursor, which arrives in the
 * response's own `Link` header rather than in the body.
 *
 * Termination is decided by the CURSOR alone ({@link nextAfterCursor} returning nothing, or returning one
 * already seen), never by whether a page happened to be empty — `src/lib/paging.ts` records what that
 * distinction cost the cursor-paged connectors, and the same reasoning applies unchanged here. A cursor that
 * repeats stops the walk and reports the read PARTIAL rather than spinning to the ceiling.
 */
import type { RestEndpointMethodTypes } from "@octokit/rest";

import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import type { RepoRef, WriteCtx } from "./write.js";

/** How many pages `dependabotAlertsVia` reads before stopping — a ceiling, never an unbounded fetch. */
const DEPENDABOT_ALERTS_MAX_PAGES = 10;
/** GitHub's own maximum for this endpoint's `first` parameter. */
const DEPENDABOT_ALERTS_PAGE_SIZE = 100;

/** GitHub's own `dependabot-alert-state` query enum, verbatim — the four states its own filter accepts. */
export const DEPENDABOT_ALERT_STATES = ["auto_dismissed", "dismissed", "fixed", "open"] as const;

/** One state a Dependabot alert can be in, exactly as GitHub's own enum spells it. */
export type DependabotAlertState = (typeof DEPENDABOT_ALERT_STATES)[number];

/** GitHub's own `dependabot-alert-severity` query enum, verbatim — lowest to highest. */
export const DEPENDABOT_SEVERITIES = ["low", "medium", "high", "critical"] as const;

/** One advisory severity, exactly as GitHub's own enum spells it. */
export type DependabotSeverity = (typeof DEPENDABOT_SEVERITIES)[number];

/**
 * Whether the vulnerable package is depended on directly, pulled in by a parent, or unknown to GitHub.
 *
 * @internal
 */
export interface DependabotDependency {
  readonly ecosystem: string | undefined;
  readonly packageName: string | undefined;
  /** The manifest the dependency was found in — the file a fix has to edit, or reach through a parent. */
  readonly manifestPath: string | undefined;
  /** `development` or `runtime`, when GitHub reports it — the first thing blast radius turns on. */
  readonly scope: string | undefined;
  /** `direct`, `transitive` or `unknown` — which rung of the fix ladder is even available. */
  readonly relationship: string | undefined;
}

/**
 * The advisory itself, narrowed to what deciding and describing a fix needs.
 *
 * @internal
 */
export interface DependabotAdvisory {
  readonly ghsaId: string;
  readonly cveId: string | undefined;
  readonly summary: string;
  readonly severity: string | undefined;
  /**
   * The advisory's CVSS base score.
   *
   * NOT optional, and that is the SDK's claim rather than ours: GitHub's own schema declares
   * `dependabot-alert-security-advisory.cvss.score` as a required `number` while declaring the sibling
   * `vector_string` `string | null`, so the two are spelled differently here for the same reason they are
   * spelled differently there. An earlier cut made this `number | undefined` and normalised a null that the
   * schema says cannot arrive; oxlint reported the resulting guard unreachable, and the guard was not the
   * thing that was wrong — the declaration was. If GitHub ever contradicts its own schema here, this fails
   * loudly at the first read rather than quietly ranking a fabricated score.
   */
  readonly cvssScore: number;
  readonly cvssVector: string | undefined;
  readonly cweIds: readonly string[];
  /** Every reference the advisory cites — the changelog trail a reviewer asks for starts here. */
  readonly referenceUrls: readonly string[];
  readonly publishedAt: string | undefined;
  readonly updatedAt: string | undefined;
  readonly withdrawnAt: string | undefined;
}

/**
 * Which versions are vulnerable, and the first release that is not.
 *
 * @internal
 */
export interface DependabotVulnerableRange {
  readonly vulnerableVersionRange: string | undefined;
  /**
   * The lowest version that closes this advisory, or `undefined` when none exists yet.
   *
   * Deliberately NOT called "the version to take": it is a floor, not a recommendation. Taking the newest
   * release the repository can resolve is a judgement the skill owns, and this field is one input to it.
   */
  readonly firstPatchedVersion: string | undefined;
}

/** One Dependabot alert, as `github vuln list|get` shows it. */
export interface DependabotAlert {
  readonly number: number;
  readonly state: DependabotAlertState | undefined;
  readonly dependency: DependabotDependency;
  readonly advisory: DependabotAdvisory;
  readonly vulnerableRange: DependabotVulnerableRange;
  /** GitHub's own page for this alert — the citation, never reconstructed from an id. */
  readonly htmlUrl: string;
  readonly createdAt: string | undefined;
  readonly updatedAt: string | undefined;
  readonly fixedAt: string | undefined;
  readonly dismissedAt: string | undefined;
  readonly dismissedReason: string | undefined;
  readonly dismissedComment: string | undefined;
}

/** A paginated Dependabot alert read, and whether it stopped short of the whole set. */
export interface DependabotAlertPage {
  readonly alerts: readonly DependabotAlert[];
  readonly truncated: boolean;
}

/**
 * GitHub's own alert payload type, taken from Octokit's generated definitions rather than restated.
 *
 * One alias covers BOTH calls, and that is checkable rather than assumed: the list endpoint's item type,
 * `RestEndpointMethodTypes["dependabot"]["listAlertsForRepo"]["response"]["data"][number]`, is the identical
 * `dependabot-alert` schema at repository scope — writing the union of the two is refused by oxlint as a
 * duplicated constituent. Its code-scanning sibling needs two aliases because there the list really does
 * carry a narrower rule projection.
 */
type RawAlert = RestEndpointMethodTypes["dependabot"]["getAlert"]["response"]["data"];

/** A narrowing guard for GitHub's own `dependabot-alert-state` enum. */
function isAlertState(value: string | undefined): value is DependabotAlertState {
  return value !== undefined && (DEPENDABOT_ALERT_STATES as readonly string[]).includes(value);
}

/** The advisory half of GitHub's payload. */
type RawAdvisory = RawAlert["security_advisory"];

/** The advisory's CVE id, or `undefined` for an advisory no CVE has been assigned to — GitHub sends `null`. */
function cveIdOf({ advisory }: { advisory: RawAdvisory }): string | undefined {
  if (advisory.cve_id === null) {
    return undefined;
  }
  return advisory.cve_id;
}

/**
 * The CVSS vector. An advisory nobody has run a CVSS assessment on carries a `score` of 0 and a `null` vector,
 * read as `undefined`.
 */
function cvssVectorOf({ advisory }: { advisory: RawAdvisory }): string | undefined {
  if (advisory.cvss.vector_string === null) {
    return undefined;
  }
  return advisory.cvss.vector_string;
}

/** When the advisory was withdrawn, or `undefined` for one that stands — GitHub sends `null`. */
function withdrawnAtOf({ advisory }: { advisory: RawAdvisory }): string | undefined {
  if (advisory.withdrawn_at === null) {
    return undefined;
  }
  return advisory.withdrawn_at;
}

/** Project the advisory half of GitHub's payload down to what deciding and describing a fix needs. */
function advisoryOf({ data }: { data: RawAlert }): DependabotAdvisory {
  const advisory = data.security_advisory;
  return {
    cveId: cveIdOf({ advisory }),
    cvssScore: advisory.cvss.score,
    cvssVector: cvssVectorOf({ advisory }),
    cweIds: advisory.cwes.map((cwe) => cwe.cwe_id),
    ghsaId: advisory.ghsa_id,
    publishedAt: advisory.published_at,
    referenceUrls: advisory.references.map((reference) => reference.url),
    severity: advisory.severity,
    summary: advisory.summary,
    updatedAt: advisory.updated_at,
    withdrawnAt: withdrawnAtOf({ advisory }),
  };
}

/** When the alert was dismissed, or `undefined` for an alert never dismissed — GitHub sends `null`. */
function dismissedAtOf({ data }: { data: RawAlert }): string | undefined {
  if (data.dismissed_at === null) {
    return undefined;
  }
  return data.dismissed_at;
}

/** The dismissal comment, or `undefined` for an undismissed alert or one dismissed without a comment. */
function dismissedCommentOf({ data }: { data: RawAlert }): string | undefined {
  if (data.dismissed_comment === null) {
    return undefined;
  }
  return data.dismissed_comment;
}

/** The dismissal reason, or `undefined` for an alert never dismissed — GitHub sends `null`. */
function dismissedReasonOf({ data }: { data: RawAlert }): string | undefined {
  if (data.dismissed_reason === null) {
    return undefined;
  }
  return data.dismissed_reason;
}

/** When the alert was fixed, or `undefined` for an alert not (yet) fixed — GitHub sends `null`. */
function fixedAtOf({ data }: { data: RawAlert }): string | undefined {
  if (data.fixed_at === null) {
    return undefined;
  }
  return data.fixed_at;
}

/**
 * Project GitHub's alert payload down to what a caller needs to triage it, cite it and decide a fix.
 *
 * The dependency's `package` is optional in GitHub's schema, but its `ecosystem` and `name` are required once
 * it is there, so each is read directly behind the optional package. `first_patched_version` is `null` while
 * no fix exists, which the optional chain reads as `undefined`; its `identifier` is required once it is there,
 * so it is read directly too.
 *
 * @param data one alert, from either the list or the single-alert endpoint
 * @returns the projected alert
 */
export function dependabotAlertOf({ data }: { data: RawAlert }): DependabotAlert {
  const dependency = data.dependency;
  return {
    advisory: advisoryOf({ data }),
    createdAt: data.created_at,
    dependency: {
      ecosystem: dependency.package?.ecosystem,
      manifestPath: dependency.manifest_path,
      packageName: dependency.package?.name,
      relationship: dependency.relationship ?? undefined,
      scope: dependency.scope ?? undefined,
    },
    dismissedAt: dismissedAtOf({ data }),
    dismissedComment: dismissedCommentOf({ data }),
    dismissedReason: dismissedReasonOf({ data }),
    fixedAt: fixedAtOf({ data }),
    htmlUrl: data.html_url,
    number: data.number,
    state: isAlertState(data.state) ? data.state : undefined,
    updatedAt: data.updated_at,
    vulnerableRange: {
      firstPatchedVersion: data.security_vulnerability.first_patched_version?.identifier,
      vulnerableVersionRange: data.security_vulnerability.vulnerable_version_range,
    },
  };
}

/**
 * The `Link` header of a response, whatever casing the transport gave it, or the empty string.
 *
 * @param headers the response headers
 * @returns the raw `Link` header value, or `""` when the response carried none
 */
function linkHeaderOf({ headers }: { headers: Readonly<Record<string, unknown>> }): string {
  const value = headers["link"] ?? headers["Link"];
  return typeof value === "string" ? value : "";
}

/**
 * The opaque `after` cursor GitHub's own `rel="next"` link carries, or nothing when this page is the last.
 *
 * Exported because it is the whole termination decision and the one part of this walk a unit test can hold
 * still: a `Link` header with no `rel="next"` means exhausted, and anything else means keep going.
 *
 * @param link the raw `Link` response header
 * @returns the value of the next link's `after` query parameter, or `undefined` when there is no next page
 */
export function nextAfterCursor({ link }: { link: string }): string | undefined {
  for (const part of link.split(",")) {
    if (!/rel="next"/.test(part)) {
      continue;
    }
    const url = /<([^>]+)>/.exec(part)?.[1];
    if (url === undefined) {
      continue;
    }
    const after = new URL(url).searchParams.get("after");
    // A next link carrying no `after` parameter gives the walk nothing to continue from: exhausted.
    if (after === null) {
      return undefined;
    }
    return after;
  }
  return undefined;
}

/** The request this walk sends for one page — GitHub's own optional filters omitted rather than sent empty. */
function listParams({
  owner,
  repo,
  state,
  severity,
  after,
}: {
  owner: string;
  repo: string;
  state: DependabotAlertState | undefined;
  severity: DependabotSeverity | undefined;
  after: string | undefined;
}): { owner: string; repo: string; first: number; after?: string; severity?: string; state?: string } {
  return {
    first: DEPENDABOT_ALERTS_PAGE_SIZE,
    owner,
    repo,
    ...(after === undefined ? {} : { after }),
    ...(severity === undefined ? {} : { severity }),
    ...(state === undefined ? {} : { state }),
  };
}

/**
 * What one page's own `Link` header says about continuing.
 *
 * Three outcomes rather than two, because "there is no next page" and "the next page is one we already
 * walked" are different facts with different consequences: the first means the read is WHOLE, the second
 * means it is partial. Collapsing them is the shape `src/lib/paging.ts` records as a real defect.
 */
type CursorStep = { kind: "exhausted" } | { kind: "repeated" } | { kind: "advance"; after: string };

/**
 * Classify one page's cursor against the cursors this walk has already followed. Pure and total.
 *
 * @param headers the response headers, for their `Link` value
 * @param seen every cursor this walk has already followed
 * @returns whether the walk is exhausted, has stopped advancing, or should continue from a new cursor
 */
function cursorStepOf({
  headers,
  seen,
}: {
  headers: Readonly<Record<string, unknown>>;
  seen: ReadonlySet<string>;
}): CursorStep {
  const next = nextAfterCursor({ link: linkHeaderOf({ headers }) });
  if (next === undefined) {
    return { kind: "exhausted" };
  }
  return seen.has(next) ? { kind: "repeated" } : { after: next, kind: "advance" };
}

/**
 * Every Dependabot alert on a repository, filtered to GitHub's own state and severity enums.
 *
 * Capped at {@link DEPENDABOT_ALERTS_MAX_PAGES} pages. A repository past that ceiling — or one whose cursor
 * stops advancing — reports the truncation to the caller rather than silently answering a partial list as
 * complete.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the repository, and GitHub's own optional state and severity filters
 * @returns the alerts and whether the read was truncated, or the provider failure
 */
export function dependabotAlertsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { state?: DependabotAlertState | undefined; severity?: DependabotSeverity | undefined };
}): ResultAsync<DependabotAlertPage, IngestError> {
  const { owner, repo, state, severity } = input;
  return safeProviderCall({
    execute: async () => {
      const alerts: DependabotAlert[] = [];
      const seenCursors = new Set<string>();
      let after: string | undefined = undefined;
      let truncated = true;
      for (let page = 0; page < DEPENDABOT_ALERTS_MAX_PAGES; page += 1) {
        const res = await ctx.client.rest.dependabot.listAlertsForRepo(
          listParams({ after, owner, repo, severity, state }),
        );
        for (const item of res.data) {
          alerts.push(dependabotAlertOf({ data: item }));
        }
        const step = cursorStepOf({ headers: res.headers, seen: seenCursors });
        if (step.kind === "exhausted") {
          truncated = false;
          break;
        }
        if (step.kind === "repeated") {
          break;
        }
        seenCursors.add(step.after);
        after = step.after;
      }
      return { alerts, truncated };
    },
    operation: "github.dependabot.listAlertsForRepo",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Read one Dependabot alert by number. Repeatable, so transient retries are allowed.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the repository and the alert's own number, as `list` prints it
 * @returns the alert, or the provider failure
 */
export function dependabotAlertVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { alertNumber: number };
}): ResultAsync<DependabotAlert, IngestError> {
  const { owner, repo, alertNumber } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.dependabot.getAlert({ alert_number: alertNumber, owner, repo });
      return dependabotAlertOf({ data: res.data });
    },
    operation: "github.dependabot.getAlert",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}
