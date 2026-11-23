/**
 * Pure parser for `slopweaver github vuln` — Dependabot alerts, read and composed.
 *
 * Three sub-verbs, one flag spec, following `./alertCore.ts`'s lead: the parsed result is a UNION rather
 * than one shape with everything optional, so `list` never carries an alert number it cannot act on and
 * `get` never carries a severity filter it would silently ignore.
 *
 * ## Why this is not `github alert`
 *
 * `github alert` reads CODE-SCANNING alerts. The two families share the word and nothing else: different
 * endpoints, a different severity vocabulary (CVSS against a rule severity level), a different remedy and a
 * different citation path. One `--state` flag standing for two different enums is exactly how a caller
 * filters the wrong family and reads a confident empty list.
 *
 * ## Why `--repo` is required and never derived
 *
 * The convention of the pull-request verbs this sits beside — `pr update`, `pr retarget`, `alert list` —
 * is an explicit `--repo owner/name`. Owner ruling: follow the convention the existing verbs
 * already have rather than invent one. It also makes the verb generic: this reads any repository the token
 * can see, with no repository baked into the tool.
 */

import { DEFAULT_EVERYWHERE_AT } from "../../../appSurfaces/threshold.js";
import { err, ok } from "../../../lib/result.js";
import {
  DEPENDABOT_ALERT_STATES,
  DEPENDABOT_SEVERITIES,
  type DependabotAlertState,
  type DependabotSeverity,
} from "../../../outbound/github/dependabot.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";
import { GithubVerbErrors, type GithubVerbResult, githubVerbErrorLines } from "./errors.js";

const SUB_VERBS = ["list", "get", "body", "surfaces"] as const;

/**
 * Which vuln sub-verb an invocation named.
 *
 * @internal
 */
export type GithubVulnSubVerb = (typeof SUB_VERBS)[number];

const GITHUB_VULN_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: [
    "repo",
    "state",
    "severity",
    "number",
    "form",
    "file",
    "out",
    "home",
    "package",
    "checkout",
    "everywhere-at",
  ],
};

/**
 * Every accepted flag for the help-truth ratchet.
 *
 * @internal
 */
export const GITHUB_VULN_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_VULN_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_VULN_FLAGS }),
].map((name) => `--${name}`);

/**
 * The modes every sub-verb shares.
 *
 * @internal
 */
export interface GithubVulnModes {
  readonly json: boolean;
  readonly home: string | undefined;
}

/** `list` — every alert on one repository, optionally filtered to one state and one severity. */
export interface GithubVulnListArgs extends GithubVulnModes {
  readonly subVerb: "list";
  readonly owner: string;
  readonly repo: string;
  /** Always one of GitHub's four states — {@link LIST_DEFAULT_STATE} when the caller named none. */
  readonly state: DependabotAlertState;
  readonly severity: DependabotSeverity | undefined;
}

/** `get` — one exact alert, in full. */
export interface GithubVulnGetArgs extends GithubVulnModes {
  readonly subVerb: "get";
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/**
 * Where `body` reads its form from — exactly one, decided at the parse: `--form` inline, or `--file` a path.
 * Either may be `-`, for stdin.
 */
type GithubVulnFormSource =
  { readonly from: "form"; readonly text: string } | { readonly from: "file"; readonly path: string };

/** `body` — compile a vulnerability-fix form; the repository comes from the form's own target. */
export interface GithubVulnBodyArgs extends GithubVulnModes {
  readonly subVerb: "body";
  readonly source: GithubVulnFormSource;
  readonly out: string | undefined;
}

/** `surfaces` — where on the app one package is reached, derived from a local checkout's import graph. */
export interface GithubVulnSurfacesArgs extends GithubVulnModes {
  readonly subVerb: "surfaces";
  readonly packageName: string;
  /** The checkout to walk — required and never derived, like `--repo`. */
  readonly checkout: string;
  /** The count of direct importers, or of features, at which the answer becomes `everywhere`. */
  readonly everywhereAt: number;
}

/** The resolved vuln operation. */
export type GithubVulnArgs = GithubVulnListArgs | GithubVulnGetArgs | GithubVulnBodyArgs | GithubVulnSurfacesArgs;

/** A narrowing guard for the fixed set of recognised sub-verbs. */
function isSubVerb(value: string | undefined): value is GithubVulnSubVerb {
  return value !== undefined && (SUB_VERBS as readonly string[]).includes(value);
}

/**
 * The state `list` filters to when the caller names none — what the usage line and `skills/vulnerability-fix`
 * have both always promised.
 *
 * Sending no `state` to GitHub is not a wider version of the same read: the endpoint then returns every state
 * and the page cap lands on a mixed set, so the open alerts themselves get TRUNCATED. MEASURED on
 * `acme/acme-admin` — no `--state` reported 192 open alerts inside a capped mixed page, `--state open`
 * reported 278 with `truncated: false`. Reproduce either way:
 *
 * ```bash
 * slopweaver github vuln list --repo acme/acme-admin --json | jq '{n: (.alerts|length), .truncated}'
 * ```
 */
const LIST_DEFAULT_STATE: DependabotAlertState = "open";

/** A narrowing guard for GitHub's own `dependabot-alert-state` query enum. */
function isAlertState(value: string): value is DependabotAlertState {
  return (DEPENDABOT_ALERT_STATES as readonly string[]).includes(value);
}

/** A narrowing guard for GitHub's own `dependabot-alert-severity` query enum. */
function isSeverity(value: string): value is DependabotSeverity {
  return (DEPENDABOT_SEVERITIES as readonly string[]).includes(value);
}

/** The raw flag values each sub-verb's own rules are checked against. */
interface VulnPayload {
  readonly state: string | undefined;
  readonly severity: string | undefined;
  readonly number: string | undefined;
  readonly form: string | undefined;
  readonly file: string | undefined;
  readonly out: string | undefined;
  readonly packageName: string | undefined;
  readonly checkout: string | undefined;
  readonly everywhereAt: string | undefined;
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

/** The sub-verb-specific flags as given, before any sub-verb's own rules are applied to them. */
function readPayload({ values }: { values: Readonly<Record<string, string | boolean | undefined>> }): VulnPayload {
  return {
    checkout: stringValue({ key: "checkout", values }),
    everywhereAt: stringValue({ key: "everywhere-at", values }),
    file: stringValue({ key: "file", values }),
    form: stringValue({ key: "form", values }),
    number: stringValue({ key: "number", values }),
    out: stringValue({ key: "out", values }),
    packageName: stringValue({ key: "package", values }),
    severity: stringValue({ key: "severity", values }),
    state: stringValue({ key: "state", values }),
  };
}

/** `list` addresses the repository, so a `get`/`body` flag on it is a mistake rather than a no-op. */
function listProblems({ payload }: { payload: VulnPayload }): readonly string[] {
  const errors: string[] = [
    payload.number === undefined ? "" : "--number is not a `list` flag; use `github vuln get --number <n>`",
    payload.form === undefined ? "" : "--form is not a `list` flag",
    payload.file === undefined ? "" : "--file is not a `list` flag",
    payload.out === undefined ? "" : "--out is not a `list` flag",
  ].filter((problem) => problem.length > 0);
  if (payload.state !== undefined && !isAlertState(payload.state)) {
    errors.push(`--state must be one of ${DEPENDABOT_ALERT_STATES.join(", ")}`);
  }
  if (payload.severity !== undefined && !isSeverity(payload.severity)) {
    errors.push(`--severity must be one of ${DEPENDABOT_SEVERITIES.join(", ")}`);
  }
  return errors;
}

/** `get` addresses one alert, so a `list`-only filter on it is a mistake rather than a no-op. */
function getProblems({ payload }: { payload: VulnPayload }): readonly string[] {
  const errors: string[] = [
    payload.state === undefined ? "" : "--state is not a `get` flag",
    payload.severity === undefined ? "" : "--severity is not a `get` flag",
    payload.form === undefined ? "" : "--form is not a `get` flag",
    payload.file === undefined ? "" : "--file is not a `get` flag",
  ].filter((problem) => problem.length > 0);
  const number = payload.number === undefined ? Number.NaN : Number(payload.number);
  if (!Number.isInteger(number) || number <= 0) {
    errors.push("--number must be a positive whole number — the Dependabot alert's own number, not a PR number");
  }
  return errors;
}

/** `body` reads a form, so an alert filter on it is a mistake rather than a no-op. */
function bodyProblems({ payload }: { payload: VulnPayload }): readonly string[] {
  const errors: string[] = [
    payload.state === undefined ? "" : "--state is not a `body` flag",
    payload.severity === undefined ? "" : "--severity is not a `body` flag",
    payload.number === undefined ? "" : "--number is not a `body` flag",
  ].filter((problem) => problem.length > 0);
  return errors;
}

/**
 * The one place `body`'s form comes from, or why the tail named none or two. None is a missing flag and an
 * empty value is a malformed one: two codes, so a caller can tell a forgotten source from a blank one.
 */
function formSource({ payload }: { payload: VulnPayload }): GithubVerbResult<GithubVulnFormSource> {
  // An empty value is named before exclusivity, so a malformed flag never hides behind the pair it came in.
  if (payload.form === "" || payload.file === "") {
    return err(GithubVerbErrors.flagValueEmpty({ flag: payload.form === "" ? "--form" : "--file" }));
  }
  if (payload.form !== undefined && payload.file !== undefined) {
    return err(GithubVerbErrors.argumentsRefused({ reasons: ["--form and --file are exclusive; give the form once"] }));
  }
  if (payload.form !== undefined) {
    return ok({ from: "form" as const, text: payload.form });
  }
  if (payload.file !== undefined) {
    return ok({ from: "file" as const, path: payload.file });
  }
  return err(GithubVerbErrors.vulnFormSourceMissing());
}

/** The `surfaces` flags given to a sub-verb that reads GitHub, where they would be silently ignored. */
function surfacesFlagsElsewhere({ payload, subVerb }: { payload: VulnPayload; subVerb: string }): readonly string[] {
  return [
    payload.packageName === undefined ? "" : `--package is not a \`${subVerb}\` flag; it belongs to \`surfaces\``,
    payload.checkout === undefined ? "" : `--checkout is not a \`${subVerb}\` flag; it belongs to \`surfaces\``,
    payload.everywhereAt === undefined ? "" : `--everywhere-at is not a \`${subVerb}\` flag`,
  ].filter((problem) => problem.length > 0);
}

/** `surfaces` reads a checkout, so an alert or form flag on it is a mistake rather than a no-op. */
function surfacesProblems({ payload }: { payload: VulnPayload }): readonly string[] {
  const errors: string[] = [
    payload.state === undefined ? "" : "--state is not a `surfaces` flag",
    payload.severity === undefined ? "" : "--severity is not a `surfaces` flag",
    payload.number === undefined ? "" : "--number is not a `surfaces` flag",
    payload.form === undefined ? "" : "--form is not a `surfaces` flag",
    payload.file === undefined ? "" : "--file is not a `surfaces` flag",
    payload.out === undefined ? "" : "--out is not a `surfaces` flag",
    payload.packageName === undefined ? "`surfaces` needs --package <name>, as the manifest names it" : "",
    payload.checkout === undefined ? "`surfaces` needs --checkout <dir>, the checkout to walk" : "",
  ].filter((problem) => problem.length > 0);
  const threshold = payload.everywhereAt === undefined ? DEFAULT_EVERYWHERE_AT : Number(payload.everywhereAt);
  if (!Number.isInteger(threshold) || threshold <= 0) {
    errors.push("--everywhere-at must be a positive whole number of importers or features");
  }
  return errors;
}

/** The modes every sub-verb shares. */
function parseModes({ values }: { values: Readonly<Record<string, string | boolean | undefined>> }): GithubVulnModes {
  const home = values["home"];
  return { home: typeof home === "string" ? home : undefined, json: values["json"] === true };
}

/** The repository `list` and `get` both require, or the problem with how it was given. */
function parseRepo({
  values,
}: {
  values: Readonly<Record<string, string | boolean | undefined>>;
}): GithubVerbResult<{ owner: string; repo: string }> {
  const repoValue = values["repo"];
  const parsed = typeof repoValue === "string" ? parseRepoSlug({ slug: repoValue }) : undefined;
  return parsed === undefined ? err(GithubVerbErrors.repoRequired()) : ok(parsed);
}

/**
 * The state `list` will really filter to.
 *
 * Written as an `if` rather than a `??` or a parameter default because the substitution is the point: an
 * absent `--state` is not "no filter", it is {@link LIST_DEFAULT_STATE}, and the two differ in what GitHub
 * returns rather than only in how it is spelled.
 *
 * @param declared the raw `--state` value, already validated by the caller's own rules
 * @returns the declared state, or the default when the caller named none
 */
function listState({ declared }: { declared: string | undefined }): DependabotAlertState {
  if (declared !== undefined && isAlertState(declared)) {
    return declared;
  }
  return LIST_DEFAULT_STATE;
}

/** Build `list`'s args once its own rules have already passed. */
function buildListArgs({
  modes,
  address,
  payload,
}: {
  modes: GithubVulnModes;
  address: { owner: string; repo: string };
  payload: VulnPayload;
}): GithubVulnListArgs {
  return {
    ...modes,
    owner: address.owner,
    repo: address.repo,
    severity: payload.severity !== undefined && isSeverity(payload.severity) ? payload.severity : undefined,
    state: listState({ declared: payload.state }),
    subVerb: "list",
  };
}

/** `body` resolved from its flags — the one place its form comes from — or every problem with them. */
function bodyArgs({
  payload,
  modes,
}: {
  payload: VulnPayload;
  modes: GithubVulnModes;
}): GithubVerbResult<GithubVulnBodyArgs> {
  const source = formSource({ payload });
  // The source is refused first and alone, so its typed code (missing or empty) reaches the caller intact.
  if (source.isErr()) {
    return err(source.error);
  }
  const others = [...bodyProblems({ payload }), ...surfacesFlagsElsewhere({ payload, subVerb: "body" })];
  if (others.length > 0) {
    return err(GithubVerbErrors.argumentsRefused({ reasons: others }));
  }
  return ok({ ...modes, out: payload.out, source: source.value, subVerb: "body" });
}

/** `surfaces` resolved from its flags, or every problem with them. */
function surfacesArgs({
  payload,
  modes,
  repoGiven,
}: {
  payload: VulnPayload;
  modes: GithubVulnModes;
  repoGiven: boolean;
}): GithubVerbResult<GithubVulnSurfacesArgs> {
  const rules = [
    ...surfacesProblems({ payload }),
    ...(repoGiven ? ["--repo is not a `surfaces` flag; --checkout names the tree it walks"] : []),
  ];
  if (rules.length > 0 || payload.packageName === undefined || payload.checkout === undefined) {
    return err(GithubVerbErrors.argumentsRefused({ reasons: rules }));
  }
  return ok({
    ...modes,
    checkout: payload.checkout,
    everywhereAt: payload.everywhereAt === undefined ? DEFAULT_EVERYWHERE_AT : Number(payload.everywhereAt),
    packageName: payload.packageName,
    subVerb: "surfaces",
  });
}

/**
 * Parse the vuln operation before resolving a credential.
 *
 * @param argv the verb's own argument tail, after `github vuln`
 * @returns the resolved sub-verb, repository and payload, or every usage problem
 */
export function parseGithubVulnArgs({ argv }: { argv: readonly string[] }): GithubVerbResult<GithubVulnArgs> {
  const subVerb = argv[0];
  if (!isSubVerb(subVerb)) {
    return err(GithubVerbErrors.usage({ command: "vuln", shape: `<${SUB_VERBS.join("|")}>` }));
  }
  const parsed = parseFlags({ allowPositionals: false, args: argv.slice(1), spec: GITHUB_VULN_FLAGS });
  if (parsed.isErr()) {
    return err(GithubVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const payload = readPayload({ values: parsed.value.values });
  const modes = parseModes({ values: parsed.value.values });
  if (subVerb === "surfaces") {
    const repoGiven = stringValue({ key: "repo", values: parsed.value.values }) !== undefined;
    return surfacesArgs({ modes, payload, repoGiven });
  }
  if (subVerb === "body") {
    return bodyArgs({ modes, payload });
  }
  const address = parseRepo({ values: parsed.value.values });
  const rules = [
    ...(subVerb === "list" ? listProblems({ payload }) : getProblems({ payload })),
    ...surfacesFlagsElsewhere({ payload, subVerb }),
  ];
  if (address.isErr() || rules.length > 0) {
    const addressLines = address.isErr() ? githubVerbErrorLines({ error: address.error }) : [];
    return err(GithubVerbErrors.argumentsRefused({ reasons: [...addressLines, ...rules] }));
  }
  if (subVerb === "list") {
    return ok(buildListArgs({ address: address.value, modes, payload }));
  }
  return ok({
    ...modes,
    number: Number(payload.number),
    owner: address.value.owner,
    repo: address.value.repo,
    subVerb: "get",
  });
}
