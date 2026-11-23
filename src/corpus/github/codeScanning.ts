/**
 * Code-scanning (CodeQL) alerts — list them, read one, and dismiss one with a reason GitHub's own enum
 * accepts. Split out of `./write.ts` to keep it under the repo's 700-code-line file-size ratchet
 * (`src/devLint/fileSizeRatchet.ts`).
 */
import type { RestEndpointMethodTypes } from "@octokit/rest";

import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import type { RepoRef, WriteCtx } from "./write.js";

/** A code-scanning alert's state, as GitHub reports it. `undefined` mirrors GitHub's own `null`. */
export type CodeScanningAlertState = "open" | "dismissed" | "fixed";

/** The exact reason string GitHub's own dismissal enum accepts — spaces and the apostrophe are load-bearing. */
export type CodeScanningDismissedReason = "false positive" | "won't fix" | "used in tests";

/** Where a code-scanning alert's most recent instance was found. A field is `undefined` when GitHub omits it. */
interface CodeScanningAlertLocation {
  readonly path: string | undefined;
  readonly startLine: number | undefined;
  readonly endLine: number | undefined;
}

/** The rule that fired, narrowed to what a caller needs to recognise and triage the alert. */
interface CodeScanningAlertRule {
  readonly id: string | undefined;
  readonly name: string | undefined;
  readonly severity: string | undefined;
  readonly securitySeverityLevel: string | undefined;
}

/** One code-scanning (CodeQL) alert, as `github alert list|dismiss` shows it. */
export interface CodeScanningAlert {
  readonly number: number;
  readonly state: CodeScanningAlertState | undefined;
  readonly rule: CodeScanningAlertRule;
  readonly location: CodeScanningAlertLocation;
  readonly htmlUrl: string;
  readonly dismissedReason: string | undefined;
  readonly dismissedComment: string | undefined;
}

/** A paginated code-scanning alert read, and whether it was truncated. */
export interface CodeScanningAlertPage {
  readonly alerts: readonly CodeScanningAlert[];
  readonly truncated: boolean;
}

/** How many pages `codeScanningAlertsVia` reads before stopping — a ceiling, never an unbounded fetch. */
const CODE_SCANNING_ALERTS_MAX_PAGES = 5;
const CODE_SCANNING_ALERTS_PAGE_SIZE = 100;

/**
 * GitHub's own single-alert payload type, taken from Octokit's generated definitions rather than restated.
 *
 * `getAlert` and `updateAlert` both answer with this shape; `listAlertsForRepo`'s items carry a narrower
 * rule projection (`code-scanning-alert-rule-summary` vs `code-scanning-alert-rule`) but every field this
 * module reads is present on both, so one projection covers all three call sites.
 */
type RawAlert = RestEndpointMethodTypes["codeScanning"]["getAlert"]["response"]["data"];

/** The narrower shape `listAlertsForRepo` answers with — a subset of {@link RawAlert}'s fields. */
type RawAlertSummary = RestEndpointMethodTypes["codeScanning"]["listAlertsForRepo"]["response"]["data"][number];

/** Either alert shape GitHub answers with; every field the projectors below read is on both. */
type AnyRawAlert = RawAlert | RawAlertSummary;

/** The rule half of either alert shape. */
type AnyRawRule = AnyRawAlert["rule"];

/** The dismissal comment, or `undefined` for an undismissed alert or one dismissed without a comment. */
function dismissedCommentOf({ data }: { data: AnyRawAlert }): string | undefined {
  if (data.dismissed_comment === null) {
    return undefined;
  }
  return data.dismissed_comment;
}

/** The dismissal reason, or `undefined` while the alert has not been dismissed — GitHub sends `null` then. */
function dismissedReasonOf({ data }: { data: AnyRawAlert }): string | undefined {
  if (data.dismissed_reason === null) {
    return undefined;
  }
  return data.dismissed_reason;
}

/**
 * The rule's security severity level. GitHub grades only a rule tagged `security`, so a quality rule (a
 * maintainability or correctness query) carries `null` here, read as `undefined`.
 */
function ruleSecuritySeverityOf({ rule }: { rule: AnyRawRule }): string | undefined {
  if (rule.security_severity_level === null) {
    return undefined;
  }
  return rule.security_severity_level;
}

/** Project GitHub's alert payload down to what a caller needs to recognise, triage and dismiss it. */
function alertOf({ data }: { data: AnyRawAlert }): CodeScanningAlert {
  const location = data.most_recent_instance.location;
  return {
    dismissedComment: dismissedCommentOf({ data }),
    dismissedReason: dismissedReasonOf({ data }),
    htmlUrl: data.html_url,
    location: {
      endLine: location?.end_line,
      path: location?.path,
      startLine: location?.start_line,
    },
    number: data.number,
    rule: {
      id: data.rule.id ?? undefined,
      name: data.rule.name,
      securitySeverityLevel: ruleSecuritySeverityOf({ rule: data.rule }),
      severity: data.rule.severity ?? undefined,
    },
    state: data.state ?? undefined,
  };
}

/**
 * Every code-scanning alert for a repository, optionally scoped to one git ref and filtered to one state.
 *
 * Capped at {@link CODE_SCANNING_ALERTS_MAX_PAGES} pages (500 alerts). A repository past that ceiling
 * reports the truncation to the caller rather than silently answering a partial list as complete.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the repository, an optional ref to scope to (a pull request's head, say), and an optional
 *   state filter
 * @returns the alerts and whether the read was truncated, or the provider failure
 */
export function codeScanningAlertsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { ref?: string | undefined; state?: CodeScanningAlertState | undefined };
}): ResultAsync<CodeScanningAlertPage, IngestError> {
  const { owner, repo, ref, state } = input;
  return safeProviderCall({
    execute: async () => {
      const alerts: CodeScanningAlert[] = [];
      let truncated = true;
      for (let page = 1; page <= CODE_SCANNING_ALERTS_MAX_PAGES; page += 1) {
        const res = await ctx.client.rest.codeScanning.listAlertsForRepo({
          owner,
          page,
          per_page: CODE_SCANNING_ALERTS_PAGE_SIZE,
          repo,
          ...(ref === undefined ? {} : { ref }),
          ...(state === undefined ? {} : { state }),
        });
        for (const item of res.data) {
          alerts.push(alertOf({ data: item }));
        }
        if (res.data.length < CODE_SCANNING_ALERTS_PAGE_SIZE) {
          truncated = false;
          break;
        }
      }
      return { alerts, truncated };
    },
    operation: "github.codeScanning.listAlertsForRepo",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Read one code-scanning alert by number. Repeatable, so transient retries are allowed.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the repository and the alert's number
 * @returns the alert, or the provider failure
 */
export function codeScanningAlertVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { alertNumber: number };
}): ResultAsync<CodeScanningAlert, IngestError> {
  const { owner, repo, alertNumber } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.codeScanning.getAlert({ alert_number: alertNumber, owner, repo });
      return alertOf({ data: res.data });
    },
    operation: "github.codeScanning.getAlert",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Dismiss one code-scanning alert with a reason and comment. Sent once; the response IS the read-back, so
 * the caller confirms the write without a second round trip.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the repository, the alert's number, the dismissal reason and the comment recording why
 * @returns the alert as GitHub stored it after the dismissal, or the provider failure
 */
export function dismissCodeScanningAlertVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { alertNumber: number; reason: CodeScanningDismissedReason; comment: string };
}): ResultAsync<CodeScanningAlert, IngestError> {
  const { owner, repo, alertNumber, reason, comment } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.codeScanning.updateAlert({
        alert_number: alertNumber,
        dismissed_comment: comment,
        dismissed_reason: reason,
        owner,
        repo,
        state: "dismissed",
      });
      return alertOf({ data: res.data });
    },
    operation: "github.codeScanning.updateAlert",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}
