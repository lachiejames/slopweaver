/**
 * Pure parser, enforcement decision and door request for `slopweaver github code-scanning`.
 *
 * CodeQL on a repository with no workflow file is GitHub's code-scanning DEFAULT SETUP, a repository switch.
 * Rule 3 in AGENTS.md bans a raw API call for the write, and there was no door verb for this object. The
 * switch can be ENFORCED from above by an org or enterprise security configuration, and GitHub documents that
 * a REST change can then report success without changing anything — so `disable` reads the attachment first,
 * refuses under enforcement, and never reports `disabled` without a read-back saying so.
 */

import type { DoorRequest } from "../../../admit/types.js";
import { errorStatus, formatIngestError, type IngestError } from "../../../lib/ingestError.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { DefaultSetup, RepoSecurityConfiguration } from "../../../outbound/github/defaultSetup.js";
import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";
import { GITHUB_REPO_DIGEST_PATTERN } from "./repoPlan.js";

const SUB_VERBS = ["show", "disable", "enable"] as const;

const BOOLEAN_FLAGS = ["dry-run", "json"] as const;
const STRING_FLAGS = ["repo", "approve", "home"] as const;

const GITHUB_CODE_SCANNING_FLAGS: FlagSpec = { boolean: [...BOOLEAN_FLAGS], string: [...STRING_FLAGS] };

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_CODE_SCANNING_FLAG_NAMES: readonly string[] = [...STRING_FLAGS, ...BOOLEAN_FLAGS].map(
  (name) => `--${name}`,
);

/**
 * The resolved operation: `show` never carries a dry run, because it never writes; `enable` previews by
 * default and sends only with `approve`, the preview's digest.
 */
export type GithubCodeScanningArgs = {
  readonly owner: string;
  readonly repo: string;
  readonly json: boolean;
  readonly home: string | undefined;
} & (
  | { readonly subVerb: "show"; readonly dryRun: false }
  | { readonly subVerb: "disable"; readonly dryRun: boolean }
  | { readonly subVerb: "enable"; readonly approve: string | undefined }
);

/** The `disable` arm of {@link GithubCodeScanningArgs}. */
export type GithubCodeScanningDisableArgs = Extract<GithubCodeScanningArgs, { subVerb: "disable" }>;

/** The `enable` arm of {@link GithubCodeScanningArgs}. */
export type GithubCodeScanningEnableArgs = Extract<GithubCodeScanningArgs, { subVerb: "enable" }>;

/**
 * What the configuration read established. `none` is GitHub's 204 and nothing else: a 403/404 is
 * `unavailable`, because a token that cannot see the attachment has not shown that there is none.
 */
export type ConfigurationObservation =
  | { readonly kind: "none" }
  | { readonly kind: "read"; readonly value: RepoSecurityConfiguration }
  | { readonly kind: "unavailable"; readonly error: IngestError };

/** What `disable` does next, decided from the two reads alone. */
export type DisablePlan =
  | { readonly kind: "already-disabled" }
  | { readonly kind: "disable" }
  | { readonly kind: "blocked-enforced"; readonly value: RepoSecurityConfiguration }
  | { readonly kind: "unknown-state" };

/** A narrowing guard for the recognised sub-verbs. */
function isSubVerb(value: string | undefined): value is (typeof SUB_VERBS)[number] {
  return value !== undefined && (SUB_VERBS as readonly string[]).includes(value);
}

/**
 * The flags a sub-verb may not carry: `--dry-run` belongs to `disable` alone, `--approve` to `enable` alone,
 * and an approval names a digest of the shape a preview prints.
 *
 * @param approve the raw `--approve` value, if any
 * @param dryRun whether `--dry-run` was passed
 * @returns every problem, empty when the combination is valid
 */
function subVerbFlagProblems({
  subVerb,
  dryRun,
  approve,
}: {
  subVerb: (typeof SUB_VERBS)[number];
  dryRun: boolean;
  approve: string | boolean | undefined;
}): string[] {
  const problems: string[] = [];
  if (subVerb === "show" && dryRun) {
    problems.push("--dry-run is a `disable` flag; `show` never writes");
  }
  if (subVerb === "enable" && dryRun) {
    problems.push("--dry-run is a `disable` flag; `enable` previews by default and sends only with --approve");
  }
  if (typeof approve !== "string") {
    return problems;
  }
  if (subVerb !== "enable") {
    problems.push("--approve is an `enable` flag; it takes the digest an `enable` preview printed");
  } else if (!GITHUB_REPO_DIGEST_PATTERN.test(approve)) {
    // Refused without echoing it: an approval only ever names a digest, so nothing else belongs there.
    problems.push("--approve takes the digest an `enable` preview printed: ghrepo- and 16 hex characters");
  }
  return problems;
}

/**
 * Parse the operation before resolving a credential.
 *
 * @param argv the verb's own argument tail, after `github code-scanning`
 * @returns the resolved sub-verb and repository, or every usage problem
 */
export function parseGithubCodeScanningArgs({ argv }: { argv: readonly string[] }): Result<GithubCodeScanningArgs> {
  const subVerb = argv[0];
  if (!isSubVerb(subVerb)) {
    // No problem line: the runner prints the whole usage, which already names the sub-verbs.
    return err([]);
  }
  const parsed = parseFlags({ allowPositionals: false, args: argv.slice(1), spec: GITHUB_CODE_SCANNING_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const values = parsed.value.values;
  const repoValue = values["repo"];
  const repo = typeof repoValue === "string" ? parseRepoSlug({ slug: repoValue }) : undefined;
  const dryRun = values["dry-run"] === true;
  const approve = values["approve"];
  const errors: string[] = [];
  if (repo === undefined) {
    errors.push("--repo owner/name is required");
  }
  errors.push(...subVerbFlagProblems({ approve, dryRun, subVerb }));
  if (errors.length > 0 || repo === undefined) {
    return err(errors);
  }
  const homeValue = values["home"];
  const address = {
    home: typeof homeValue === "string" ? homeValue : undefined,
    json: values["json"] === true,
    owner: repo.owner,
    repo: repo.repo,
  };
  if (subVerb === "show") {
    return ok({ ...address, dryRun: false, subVerb });
  }
  if (subVerb === "enable") {
    return ok({ ...address, approve: typeof approve === "string" ? approve : undefined, subVerb });
  }
  return ok({ ...address, dryRun, subVerb });
}

/**
 * Whether an attached configuration enforces its settings — by EITHER signal GitHub carries: the
 * attachment's own `status` or the configuration's `enforcement`. Checking one alone misses the other.
 *
 * @param configuration the attachment as read
 * @returns true when either signal says `enforced`
 */
export function isEnforced({ configuration }: { configuration: RepoSecurityConfiguration }): boolean {
  return configuration.status === "enforced" || configuration.enforcement === "enforced";
}

/**
 * Decide `disable`'s next step from the two fresh reads.
 *
 * An enforced configuration refuses even when its own default-setup setting reads `not_set`: this verb does
 * not assume an enforced configuration permits a change it could silently undo. An absent `state` is
 * unknown, never disabled.
 *
 * @param setup the default setup as just read
 * @param configuration what the configuration read established
 * @returns the plan
 */
export function planDefaultSetupDisable({
  setup,
  configuration,
}: {
  setup: DefaultSetup;
  configuration: ConfigurationObservation;
}): DisablePlan {
  if (setup.state === "not-configured") {
    return { kind: "already-disabled" };
  }
  if (configuration.kind === "read" && isEnforced({ configuration: configuration.value })) {
    return { kind: "blocked-enforced", value: configuration.value };
  }
  if (setup.state === "configured") {
    return { kind: "disable" };
  }
  return { kind: "unknown-state" };
}

/**
 * One line naming the attached configuration, so a refusal says WHICH org setting to take to an admin.
 *
 * @param configuration what the configuration read established
 * @returns a single human line
 */
export function configurationLine({ configuration }: { configuration: ConfigurationObservation }): string {
  if (configuration.kind === "none") {
    return "security configuration: none attached";
  }
  if (configuration.kind === "unavailable") {
    return `security configuration: UNKNOWN — could not read it (${configuration.error.message})`;
  }
  const value = configuration.value;
  const parts: readonly (string | undefined)[] = [
    "security configuration:",
    value.name === undefined ? "(unnamed)" : `"${value.name}"`,
    value.id === undefined ? undefined : `id=${String(value.id)}`,
    value.targetType === undefined ? undefined : `target=${value.targetType}`,
    value.status === undefined ? undefined : `attachment=${value.status}`,
    value.enforcement === undefined ? undefined : `enforcement=${value.enforcement}`,
    value.codeScanningDefaultSetup === undefined ? undefined : `default-setup=${value.codeScanningDefaultSetup}`,
    value.htmlUrl,
  ];
  return parts.filter((part) => part !== undefined).join(" ");
}

/**
 * One line naming the default setup's state.
 *
 * @param setup the default setup as read
 * @returns a single human line
 */
export function setupLine({ setup }: { setup: DefaultSetup }): string {
  let state: string = "UNKNOWN (GitHub reported no state)";
  if (setup.state !== undefined) {
    state = setup.state;
  }
  const parts: readonly (string | undefined)[] = [
    `default setup: ${state}`,
    setup.languages.length === 0 ? undefined : `languages=${setup.languages.join(",")}`,
    setup.querySuite === undefined ? undefined : `suite=${setup.querySuite}`,
    setup.schedule === undefined ? undefined : `schedule=${setup.schedule}`,
    setup.updatedAt === undefined ? undefined : `updated=${setup.updatedAt}`,
  ];
  return parts.filter((part) => part !== undefined).join(" ");
}

/**
 * The external-write door request for switching one repository's default setup off.
 *
 * @param args the parsed disable
 * @param home the Slopweaver state home whose door records the write
 * @returns the exact external-write request admitted by the door
 */
export function codeScanningDoorRequest({
  args,
  home,
}: {
  args: GithubCodeScanningDisableArgs;
  home: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "code-scanning disable" },
    artifact: { id: `${args.owner}/${args.repo} code-scanning/default-setup` },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}

/**
 * The refusal an enforced configuration earns: which setting, and whose hand lifts it.
 *
 * @param args the repository the refusal names
 * @returns one diagnostic line
 */
export function enforcedRefusal({ args }: { args: GithubCodeScanningDisableArgs }): string {
  return (
    `${args.owner}/${args.repo}: an ENFORCED security configuration is attached (named above), so a repository ` +
    "admin cannot switch default setup off — an organisation admin must detach the configuration from this " +
    "repository, or set its code-scanning default setup to not_set, before `disable` can take effect"
  );
}

/**
 * What a failed PATCH means. Neither a dropped connection nor a 5xx proves the change was NOT applied, so
 * this claims neither way — the read-back that follows does. A 422 on this endpoint is the one answer with a
 * known meaning: the org-controlled refusal (MEASURED on a repository under such an organisation: "Code scanning
 * default setup cannot be modified. This setting is controlled by organization administrators.", with the
 * configuration read answering 404 to the same repo-admin token).
 *
 * @param error the provider failure the PATCH returned
 * @returns the formatted error, plus the org-admin line on a 422
 */
export function patchFailureLines({ error }: { error: IngestError }): string[] {
  const lines = [formatIngestError({ error })];
  if (errorStatus({ error }) === 422) {
    lines.push(
      "an organisation-level setting controls default setup here — an organisation admin must lift it " +
        "(detach the enforcing security configuration or set its default setup to not_set); a repository admin cannot",
    );
  }
  return lines;
}
