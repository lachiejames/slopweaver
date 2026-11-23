/**
 * Pure parser and door request for `slopweaver github alert`.
 *
 * One flag spec across both sub-verbs, following `threadCore.ts`'s lead: `list` and `dismiss` address the
 * same repository and differ only in which flags each requires. The parsed result is a UNION rather than one
 * shape with everything optional, so `list` never carries a dismissal reason it cannot act on and `dismiss`
 * never carries a `--pr`/`--state` filter it would silently ignore.
 *
 * A CodeQL false positive otherwise blocks a pull request with nowhere to go but a human's own click —
 * rule 3 in AGENTS.md bans raw `gh`/the API for a mutation, and there was no door verb for this object.
 */

import type { DoorRequest } from "../../../admit/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { CodeScanningAlertState, CodeScanningDismissedReason } from "../../../outbound/github/codeScanning.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";
import { type GithubVerbError, GithubVerbErrors, githubVerbErrorLines } from "./errors.js";

const SUB_VERBS = ["list", "dismiss"] as const;

/**
 * Which alert sub-verb an invocation named.
 *
 * @internal
 */
export type GithubAlertSubVerb = (typeof SUB_VERBS)[number];

/** The states `list --state` accepts — exactly GitHub's own `code-scanning-alert-state` query enum. */
const ALERT_STATES = ["open", "dismissed", "fixed"] as const;

/** The CLI-facing dismissal reasons — underscored, unlike GitHub's own space- and apostrophe-carrying enum. */
const DISMISS_REASONS = ["false_positive", "wont_fix", "used_in_tests"] as const;

/**
 * The longest `--comment` GitHub's own dismissal endpoint accepts before refusing the PATCH with a 422 —
 * measured live on a real dismissal ("Only 280 characters are allowed; 555 were supplied"). Checked locally so an over-length comment fails fast rather than round-tripping to GitHub.
 */
const DISMISSED_COMMENT_MAX_CHARS = 280;

/** One `dismiss --reason` value, before translation to what GitHub's API accepts. */
export type GithubAlertDismissReason = (typeof DISMISS_REASONS)[number];

/** The exact translation `dismiss` sends — GitHub refuses any string outside its own three-member enum. */
const DISMISS_REASON_TO_GITHUB: Readonly<Record<GithubAlertDismissReason, CodeScanningDismissedReason>> = {
  false_positive: "false positive",
  used_in_tests: "used in tests",
  wont_fix: "won't fix",
};

/**
 * Translate a CLI dismissal reason to the exact string GitHub's own enum accepts.
 *
 * @param reason the CLI-facing reason `dismiss --reason` was given
 * @returns the string GitHub's `dismissed_reason` field accepts
 */
export function githubDismissedReasonOf({ reason }: { reason: GithubAlertDismissReason }): CodeScanningDismissedReason {
  return DISMISS_REASON_TO_GITHUB[reason];
}

const GITHUB_ALERT_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json"],
  string: ["repo", "pr", "state", "number", "reason", "comment", "home"],
};

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_ALERT_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_ALERT_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_ALERT_FLAGS }),
].map((name) => `--${name}`);

/** The repository and modes every sub-verb shares. */
interface GithubAlertAddress {
  readonly owner: string;
  readonly repo: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** `list` — every alert on the repository, optionally scoped to one pull request and one state. */
export interface GithubAlertListArgs extends GithubAlertAddress {
  readonly subVerb: "list";
  readonly pr: number | undefined;
  readonly state: CodeScanningAlertState | undefined;
}

/** `dismiss` — one exact alert, the reason GitHub's enum accepts, and the comment recording why. */
export interface GithubAlertDismissArgs extends GithubAlertAddress {
  readonly subVerb: "dismiss";
  readonly number: number;
  readonly reason: GithubAlertDismissReason;
  readonly comment: string;
}

/** The resolved alert operation. */
export type GithubAlertArgs = GithubAlertListArgs | GithubAlertDismissArgs;

/** A narrowing guard for the fixed set of recognised sub-verbs. */
function isSubVerb(value: string | undefined): value is GithubAlertSubVerb {
  return value !== undefined && (SUB_VERBS as readonly string[]).includes(value);
}

/** A narrowing guard for GitHub's own `code-scanning-alert-state` query enum. */
function isAlertState(value: string): value is CodeScanningAlertState {
  return (ALERT_STATES as readonly string[]).includes(value);
}

/** A narrowing guard for the CLI-facing dismissal reasons. */
function isDismissReason(value: string): value is GithubAlertDismissReason {
  return (DISMISS_REASONS as readonly string[]).includes(value);
}

/** The raw flag values every sub-verb's own rules are checked against. */
interface AlertPayload {
  readonly pr: string | undefined;
  readonly state: string | undefined;
  readonly number: string | undefined;
  readonly reason: string | undefined;
  readonly comment: string | undefined;
}

/** `list` addresses the repository, so a dismissal flag on it is a mistake rather than a no-op. */
function listProblems({ payload }: { payload: AlertPayload }): readonly string[] {
  const errors: string[] = [
    payload.number === undefined ? "" : "--number is not a `list` flag",
    payload.reason === undefined ? "" : "--reason is not a `list` flag",
    payload.comment === undefined ? "" : "--comment is not a `list` flag",
  ].filter((problem) => problem.length > 0);
  if (payload.pr !== undefined && (!Number.isInteger(Number(payload.pr)) || Number(payload.pr) <= 0)) {
    errors.push("--pr must be a positive whole number");
  }
  if (payload.state !== undefined && !isAlertState(payload.state)) {
    errors.push(`--state must be one of ${ALERT_STATES.join(", ")}`);
  }
  return errors;
}

/** `dismiss` addresses one alert, so a `list`-only filter on it is a mistake rather than a no-op. */
function dismissProblems({ payload }: { payload: AlertPayload }): readonly string[] {
  const errors: string[] = [
    payload.pr === undefined ? "" : "--pr is not a `dismiss` flag",
    payload.state === undefined ? "" : "--state is not a `dismiss` flag",
  ].filter((problem) => problem.length > 0);
  const number = payload.number === undefined ? Number.NaN : Number(payload.number);
  if (!Number.isInteger(number) || number <= 0) {
    errors.push("--number must be a positive whole number");
  }
  if (payload.reason === undefined || !isDismissReason(payload.reason)) {
    errors.push(`--reason must be one of ${DISMISS_REASONS.join(", ")}`);
  }
  if (payload.comment === undefined || payload.comment.length === 0) {
    errors.push("--comment <text> is required");
  } else if (payload.comment.length > DISMISSED_COMMENT_MAX_CHARS) {
    errors.push(
      `--comment must be at most ${String(DISMISSED_COMMENT_MAX_CHARS)} characters — GitHub's own dismissal ` +
        `comment field refuses more (${String(payload.comment.length)} given)`,
    );
  }
  return errors;
}

/** The repository and modes every sub-verb shares, or every problem with how they were given. */
function parseAddress({
  values,
}: {
  values: Readonly<Record<string, string | boolean | undefined>>;
}): Result<GithubAlertAddress, GithubVerbError> {
  const repoValue = values["repo"];
  const repo = typeof repoValue === "string" ? parseRepoSlug({ slug: repoValue }) : undefined;
  if (repo === undefined) {
    return err(GithubVerbErrors.repoRequired());
  }
  const home = values["home"];
  return ok({
    dryRun: values["dry-run"] === true,
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    owner: repo.owner,
    repo: repo.repo,
  });
}

/** One raw flag value, narrowed to a string (a boolean switch given for a string flag reads as absent). */
function stringValue({
  values,
  key,
}: {
  values: Readonly<Record<string, string | boolean | undefined>>;
  key: string;
}): string | undefined {
  const value = values[key];
  return typeof value === "string" ? value : undefined;
}

/** The five sub-verb-specific flags as given, before any sub-verb's own rules are applied to them. */
function readPayload({ values }: { values: Readonly<Record<string, string | boolean | undefined>> }): AlertPayload {
  return {
    comment: stringValue({ key: "comment", values }),
    number: stringValue({ key: "number", values }),
    pr: stringValue({ key: "pr", values }),
    reason: stringValue({ key: "reason", values }),
    state: stringValue({ key: "state", values }),
  };
}

/**
 * Build `list`'s args once its own rules have already passed.
 *
 * `listProblems` already required `--state` to be one of `ALERT_STATES` when present; re-checked with the
 * same guard here rather than coalesced, so the narrowing is real rather than an assertion.
 */
function buildListArgs({
  address,
  payload,
}: {
  address: GithubAlertAddress;
  payload: AlertPayload;
}): GithubAlertListArgs {
  return {
    ...address,
    pr: payload.pr === undefined ? undefined : Number(payload.pr),
    state: payload.state !== undefined && isAlertState(payload.state) ? payload.state : undefined,
    subVerb: "list",
  };
}

/**
 * Build `dismiss`'s args once its own rules have already passed.
 *
 * `dismissProblems` already required `--number`/`--reason`/`--comment` above; narrowed here rather than
 * coalesced, so a future edit that drops that rule fails loud instead of dismissing an alert with a blank
 * comment. `undefined` here means that rule broke without this one being updated to match.
 */
function buildDismissArgs({
  address,
  payload,
}: {
  address: GithubAlertAddress;
  payload: AlertPayload;
}): GithubAlertDismissArgs | undefined {
  if (
    payload.number === undefined ||
    payload.reason === undefined ||
    !isDismissReason(payload.reason) ||
    payload.comment === undefined
  ) {
    return undefined;
  }
  return {
    ...address,
    comment: payload.comment,
    number: Number(payload.number),
    reason: payload.reason,
    subVerb: "dismiss",
  };
}

/**
 * Parse the alert operation before resolving a credential.
 *
 * @param argv the verb's own argument tail, after `github alert`
 * @returns the resolved sub-verb, repository and payload, or every usage problem
 */
export function parseGithubAlertArgs({ argv }: { argv: readonly string[] }): Result<GithubAlertArgs, GithubVerbError> {
  const subVerb = argv[0];
  if (!isSubVerb(subVerb)) {
    return err(GithubVerbErrors.usage({ command: "alert", shape: `<${SUB_VERBS.join("|")}>` }));
  }
  const parsed = parseFlags({ allowPositionals: false, args: argv.slice(1), spec: GITHUB_ALERT_FLAGS });
  if (parsed.isErr()) {
    return err(GithubVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const payload = readPayload({ values: parsed.value.values });
  const address = parseAddress({ values: parsed.value.values });
  const rules = subVerb === "list" ? listProblems({ payload }) : dismissProblems({ payload });
  if (address.isErr() || rules.length > 0) {
    const addressLines = address.isErr() ? githubVerbErrorLines({ error: address.error }) : [];
    return err(GithubVerbErrors.argumentsRefused({ reasons: [...addressLines, ...rules] }));
  }
  if (subVerb === "list") {
    return ok(buildListArgs({ address: address.value, payload }));
  }
  const dismissArgs = buildDismissArgs({ address: address.value, payload });
  return dismissArgs === undefined ? err(GithubVerbErrors.alertDismissFieldsMissing()) : ok(dismissArgs);
}

/**
 * The external-write door request for one exact alert dismissal.
 *
 * @param args the parsed dismissal
 * @param home the Slopweaver state home whose door records the write
 * @returns the exact external-write request admitted by the door
 */
export function alertDoorRequest({ args, home }: { args: GithubAlertDismissArgs; home: string }): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "alert dismiss" },
    artifact: { id: `${args.owner}/${args.repo} code-scanning-alert#${String(args.number)}` },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}
