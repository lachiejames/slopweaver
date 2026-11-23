/**
 * The pure half of `github code-scanning enable`: what switching CodeQL default setup ON would change, whether
 * it is already on, the digest a preview prints and `--approve` must quote back, and the door gate comparing
 * the two.
 *
 * The digest is `github repo`'s shape (`./repoPlan.ts`): a stable stringify of the plan view, sha256, the first
 * 16 hex characters, `ghrepo-`-prefixed. It binds the repository's IMMUTABLE id beside the typed address,
 * because GitHub follows a moved slug's redirect; the default setup as read, `updatedAt` included, so a change
 * anyone makes after the preview invalidates it; the attached security configuration as read, so one attached
 * after the preview does too; and the exact PATCH body. It is recomputed from FRESH reads at write time, so an
 * approval cannot be transplanted onto a write nobody previewed.
 */

import { sha256Hex } from "#lib/hash.js";
import { stableStringify } from "#lib/stableStringify.js";
import { type ApprovalGate, approvalGate } from "../../../admit/approval.js";
import type { DoorFinding, DoorRequest } from "../../../admit/types.js";
import { DEFAULT_SETUP_ENABLE_BODY, type DefaultSetup } from "../../../outbound/github/defaultSetup.js";
import type { RepoAdministrationState } from "../../../outbound/github/repoAdministration.js";
import { type ConfigurationObservation, isEnforced } from "./codeScanningCore.js";

/** A configuration the enable can be planned over: unreadable is refused before a plan exists. */
type VisibleConfiguration = Extract<ConfigurationObservation, { kind: "none" | "read" }>;

/** What `enable` does next, decided from the two fresh reads alone. */
export type EnableDecision =
  | { readonly kind: "already-enabled" }
  | { readonly kind: "eligible"; readonly configuration: VisibleConfiguration }
  | { readonly kind: "blocked-enforced" }
  | { readonly kind: "unknown-configuration" }
  | { readonly kind: "unknown-state" };

/** Everything one previewed enable binds. */
export interface EnablePlan {
  readonly source: { readonly owner: string; readonly repo: string };
  readonly repository: RepoAdministrationState;
  readonly before: DefaultSetup;
  readonly configuration: VisibleConfiguration;
}

/** The finding code an unapproved or mismatched enable fires. */
const ENABLE_UNAPPROVED_CODE = "github.code-scanning-enable-unapproved";

/**
 * Decide `enable`'s next step from the fresh reads.
 *
 * Already on wins: there is no write to refuse. An enforced configuration refuses whatever its own
 * default-setup setting reads, because it can silently undo a repository-level change. An UNREADABLE one
 * (403/404) refuses too: enforcement cannot be ruled out, and there is nothing whole to bind into an approval.
 * This is deliberately stricter than `disable`. An absent `state` is unknown, never off.
 *
 * @param setup the default setup as just read
 * @param configuration what the configuration read established
 * @returns the decision
 */
export function decideDefaultSetupEnable({
  setup,
  configuration,
}: {
  setup: DefaultSetup;
  configuration: ConfigurationObservation;
}): EnableDecision {
  if (setup.state === "configured") {
    return { kind: "already-enabled" };
  }
  if (configuration.kind === "read" && isEnforced({ configuration: configuration.value })) {
    return { kind: "blocked-enforced" };
  }
  if (setup.state !== "not-configured") {
    return { kind: "unknown-state" };
  }
  if (configuration.kind === "unavailable") {
    return { kind: "unknown-configuration" };
  }
  return { configuration, kind: "eligible" };
}

/** The configuration as the digest binds it: what is attached and how it enforces, never its URL. */
function configurationView({
  configuration,
}: {
  configuration: VisibleConfiguration;
}): Readonly<Record<string, unknown>> {
  if (configuration.kind === "none") {
    return { kind: "none" };
  }
  const { value } = configuration;
  return {
    codeScanningDefaultSetup: value.codeScanningDefaultSetup,
    enforcement: value.enforcement,
    id: value.id,
    kind: "read",
    name: value.name,
    status: value.status,
    targetType: value.targetType,
  };
}

/**
 * The fields the digest binds and a `--json` preview prints: everything that changes what is sent or where,
 * and nothing that does not (a URL, the output mode, the home, the approval itself). Languages are sorted,
 * because their order means nothing.
 *
 * @param plan the reads the preview is over
 * @returns a plain, stably stringifiable view
 */
export function enablePlanView({ plan }: { plan: EnablePlan }): Readonly<Record<string, unknown>> {
  const { before, repository } = plan;
  return {
    action: "code-scanning enable",
    before: {
      languages: before.languages.toSorted(),
      querySuite: before.querySuite,
      schedule: before.schedule,
      state: before.state,
      updatedAt: before.updatedAt,
    },
    configuration: configurationView({ configuration: plan.configuration }),
    patch: DEFAULT_SETUP_ENABLE_BODY,
    repository: { archived: repository.archived, fullName: repository.fullName, id: repository.id },
    source: `${plan.source.owner}/${plan.source.repo}`,
  };
}

/**
 * The approval digest of one previewed enable.
 *
 * @param plan the reads the preview is over
 * @returns `ghrepo-` and the first 16 hex characters of the view's sha256
 */
export function enableWriteDigest({ plan }: { plan: EnablePlan }): string {
  const view = stableStringify({ value: enablePlanView({ plan }) });
  return `ghrepo-${sha256Hex({ bytes: view }).slice(0, 16)}`;
}

/**
 * The door gate between a previewed enable and GitHub: a `hold` unless the supplied digest matches the plan
 * rebuilt from a fresh read. It authenticates no human; it makes the write a second deliberate step over
 * exact content, and records an unapproved attempt in the door ledger.
 *
 * @param expected the digest of the plan as it stands right now
 * @param supplied what the caller passed to `--approve`
 * @param preview the command that prints the preview and its digest, for the correction line
 * @returns an `ApprovalGate` that holds unless the two match exactly
 */
export function enableApprovalGate({
  expected,
  supplied,
  preview,
}: {
  expected: string;
  supplied: string;
  preview: string;
}): ApprovalGate {
  const gate = (): readonly DoorFinding[] => {
    if (supplied === expected) {
      return [];
    }
    return [
      {
        code: ENABLE_UNAPPROVED_CODE,
        correction:
          `run \`${preview}\` to see the write as it stands now, then re-run it with --approve ${expected} once ` +
          "that has been approved. The digest covers the repository's id, name and archive state, its default " +
          "setup and attached security configuration as read, and the exact body sent; any drift invalidates " +
          "it. There is no override — this hold is not waivable by $SLOPWEAVER_DOOR_OVERRIDE",
        severity: "hold",
        summary:
          `the approval ${supplied} does not match this write (${expected}) — the repository, its default ` +
          "setup or its security configuration moved after the preview it was given for",
      },
    ];
  };
  return approvalGate({ gate });
}

/**
 * The approval-backed external-write door request for one enable.
 *
 * @param view the plan view the digest was computed over, recorded so the ledger row names the exact write
 * @param digest the plan's digest as it stands now
 * @param home the Slopweaver state home whose door records the write
 * @returns the request the door admits only past the approval gate
 */
export function enableDoorRequest({
  view,
  digest,
  home,
}: {
  view: Readonly<Record<string, unknown>>;
  digest: string;
  home: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "code-scanning enable" },
    artifact: { ...view, digest },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: true },
  };
}
